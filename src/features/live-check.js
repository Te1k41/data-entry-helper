// Live Check: local duplicate-IMO checks, warnings, dismissal, and guarded fills.
// Optional comparisons are registered by live-check-relay.js.
const LiveCheck = {
    _activeFields: new Set(),
    _extraComparisons: [],

    // IDs the clerk has dismissed via "I know what I'm doing" -- in-memory
    // only, never persisted, so a tab refresh (a fresh content-script load)
    // clears it and the check starts flagging again. Deliberate: this is
    // an acknowledgment for THIS sitting at the record, not a permanent
    // "never check this again" setting.
    _dismissed: new Set(),

    // Separate from the SHARED `syncing` flag (declared in main.js) --
    // that one is set by many DIFFERENT write-capable features (date-
    // syncing.js, date-step-buttons.js's +/- buttons, vessel-correction.js,
    // ...) whenever ANY of them is mid-write, to stop each other from
    // cascading into loops. Confirmed real: date-step-buttons.js wraps
    // every non-SP001 date write inside the shared sync guard, so if this feature
    // also bailed on the shared flag, it would never notice a +/- click on
    // an SV*_depart_date field at all. This flag is true ONLY while THIS
    // feature's own applyFills() is writing -- it's what handle()/
    // handleInput() actually need to guard against (their own write
    // re-triggering themselves), not every other feature's writes too.
    _ownWriteInProgress: false,

    MISMATCH_HIGHLIGHT: {
        outline:         "2px solid #b00020",
        backgroundColor: "#ffd6d6"
    },

    applyMismatchHighlight(field) {
        if (!field) return;
        field.style.outline         = this.MISMATCH_HIGHLIGHT.outline;
        field.style.backgroundColor = this.MISMATCH_HIGHLIGHT.backgroundColor;
        field.dataset.ttLiveCheckMismatch = "1";
    },

    clearMismatchHighlight(field) {
        if (!field) return;
        field.style.outline = "";
        field.style.backgroundColor = "";
        delete field.dataset.ttLiveCheckMismatch;
    },

    init() {
        // Document delegation survives banner replacement.
        document.addEventListener("click", (event) => this.handleDismissClick(event));
        this.compareAll(); // Run local IMO checks even without the relay companion.
    },

    handleDismissClick(event) {
        const button = event.target.closest("[data-tt-live-check-dismiss]");
        if (!button) return;
        this._dismissed.add(button.dataset.ttLiveCheckDismiss);
        this.compareAll();
    },

    // Same physical ship (same lloyds_code/IMO) shouldn't hold two REGULAR
    // rotation slots at once -- a repeat occurrence should be ticked
    // SV*_one-off (the field vessel-correction.js already reads/excludes
    // on, same convention reused here) to mark it as the exception, not
    // the normal recurring entry. Pure page-internal consistency check --
    // doesn't touch relay data at all.
    checkDuplicateImos(add) {
        const groups = new Map(); // imo -> [{ n, oneOffField, checked }]
        // Keyed on lloyds_codeD, NOT the hidden lloyds_code -- same
        // canonical identity field duplicate-vessel.js uses
        // (vesselCodeField()), so a code typed/duplicated just now is
        // seen immediately rather than waiting on Tradetech's own sync
        // into the hidden mirror field.
        document.querySelectorAll('input[name^="SV"][name$="_lloyds_codeD"]').forEach(field => {
            const match = field.name.match(/^SV(\d+)_lloyds_codeD$/);
            if (!match) return;
            const imo = field.value.trim();
            if (!/^\d{7}$/.test(imo)) return;

            const n = match[1];
            const oneOffField = document.querySelector(`input[name="SV${n}_one-off"]`);
            if (!groups.has(imo)) groups.set(imo, []);
            groups.get(imo).push({ n, oneOffField, checked: Boolean(oneOffField?.checked) });
        });

        for (const [imo, rows] of groups) {
            if (rows.length < 2) continue;

            const notOneOff = rows.filter(r => !r.checked);
            if (notOneOff.length === 1) continue; // exactly one regular entry -- correct

            const rowList = rows.map(r => `SV${r.n}`).join(", ");
            if (notOneOff.length === 0) {
                add(`dup-imo-${imo}`, rows.map(r => r.oneOffField), `IMO ${imo} (${rowList}): all ${rows.length} ticked One-off — exactly one should stay unticked`);
            } else {
                const offenders = notOneOff.map(r => `SV${r.n}`).join(", ");
                add(`dup-imo-${imo}`, notOneOff.map(r => r.oneOffField), `IMO ${imo} (${rowList}): ${offenders} not ticked One-off — only one of ${rows.length} should be unticked`);
            }
        }
    },

    DISMISS_BUTTON_STYLE: "margin-left:6px;font-size:9px;padding:0 3px;cursor:pointer;background:#fff;color:#000;border:1px solid #000;border-radius:0;",

    // One line of banner text plus its own "I know what I'm doing" button
    // -- clicking it (handleDismissClick(), delegated on document since
    // banner.js rebuilds this element every render) adds item.id to
    // _dismissed and re-runs compareAll(), which drops it from both the
    // banner and the red highlight until the tab reloads.
    renderItemLine(item) {
        return `${item.line}<button data-tt-live-check-dismiss="${item.id}" style="${this.DISMISS_BUTTON_STYLE}">I know what I'm doing</button>`;
    },

    // Every mismatch collapses into ONE setWarning key with one short line
    // each -- not a separate title+message block per field. With several
    // vessels on a record, one block per issue would stack into a huge
    // card; a red outline on the actual field (below) already points at
    // exactly where each problem is, so the banner text only needs to be
    // a compact list.
    compareAll() {
        const items = []; // { id, fields: Field[], line } -- mismatches
        const fills = [];  // { row, date }                -- field is EMPTY and we have a real value for it
        const add = (id, fieldOrFields, line) => {
            const fields = Array.isArray(fieldOrFields) ? fieldOrFields.filter(Boolean) : (fieldOrFields ? [fieldOrFields] : []);
            items.push({ id, fields, line });
        };

        // Pure page-internal consistency check -- doesn't need relay data
        // at all, so it runs regardless of whether fill data loaded.
        this.checkDuplicateImos(add);

        this._extraComparisons.forEach(compare => compare(add, fills));

        // A dismissed id is dropped entirely -- no banner line, no
        // highlight -- until the tab reloads (see _dismissed above).
        const visibleItems = items.filter(item => !this._dismissed.has(item.id));

        // Clear the highlight on any field no longer flagged, apply it to
        // whatever's flagged now -- and show the whole list as one banner.
        const nextFields = new Set(visibleItems.flatMap(item => item.fields));
        for (const field of this._activeFields) {
            if (!nextFields.has(field)) this.clearMismatchHighlight(field);
        }
        for (const field of nextFields) this.applyMismatchHighlight(field);
        this._activeFields = nextFields;

        setWarning("live-check", visibleItems.length ? {
            title:   `🚢 Live Check — ${visibleItems.length} issue${visibleItems.length > 1 ? "s" : ""}`,
            message: visibleItems.map(item => this.renderItemLine(item)).join("<br>"),
        } : null);

        // Filling happens LAST, after warnings/highlights are settled --
        // setFieldValue() dispatches real "input"/"change" events, which
        // would otherwise re-enter compareAll() (via handle()/handleInput()
        // below) mid-loop. Their `if (this._ownWriteInProgress) return`
        // guard is what actually stops that reentrancy; doing the writes
        // last just keeps this pass's own bookkeeping simple.
        if (fills.length) this.applyFills(fills);
    },

    // One syncing guard around the whole batch (not per-field) and ONE
    // confirmation banner listing everything filled -- several separate
    // banners firing in a row would just overwrite each other anyway
    // (showTemporaryBanner owns a single element), and per-field toasts
    // are exactly the "big notif card" noise this feature already avoids
    // for mismatches.
    applyFills(fills) {
        const applied = [];
        // Sets BOTH: the shared `syncing` flag so OTHER features (date-
        // syncing.js, etc.) correctly ignore these writes, and our own
        // _ownWriteInProgress so THIS feature's handle()/handleInput()
        // ignore the resulting events too -- see _ownWriteInProgress above
        // for why these can't just be the same flag.
        beginSync();
        this._ownWriteInProgress = true;
        try {
            for (const { row, date } of fills) {
                // Per-item try/catch -- one bad write must never silently
                // swallow the rest of the batch (a thrown error inside a
                // for-loop stops iteration entirely, not just that item).
                try {
                    setFieldValue(row.departField, date);
                    console.log(`✏️ Live Check: filled empty SV${row.n}_depart_date with ${date} from proof data`);
                    applied.push({ row, date });
                } catch (err) {
                    console.error(`❌ Live Check: fill failed for SV${row.n} —`, err);
                }
            }
        } finally {
            endSync();
            this._ownWriteInProgress = false;
        }
        if (!applied.length) return;
        showTemporaryBanner({
            title:   `✏️ Live Check filled ${applied.length} date${applied.length > 1 ? "s" : ""}`,
            message: applied.map(({ row, date }) => `SV${row.n}: ${date}`).join("<br>"),
        });
    },

    // ── module interface ──

    // Local duplicate-IMO inputs; relay inputs are handled by the companion.
    RELEVANT_PATTERN: /^SV\d+_(lloyds_codeD|one-off)$/,

    handle(event) {
        // Guards against OUR OWN applyFills() writes re-entering compareAll()
        // mid-batch -- deliberately NOT the shared `syncing` flag (see
        // _ownWriteInProgress above): that one is also set by unrelated
        // write-capable features (date-step-buttons.js's +/- buttons,
        // vessel-correction.js, date-syncing.js's cascades), and this
        // feature needs to react to THEIR writes, not just its own.
        if (this._ownWriteInProgress) return;

        const { name } = event.target;
        if (!name) return;

        if (this.RELEVANT_PATTERN.test(name)) {
            this.compareAll();
        }
    },
};
