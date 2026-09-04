// ─────────────────────────────────────────────────────
//  FEATURE: Live Check (community edition — local-only)
//  The full extension's Live Check also fact-checks vessel names,
//  voyage numbers, and dates against the relay's proof/DOM-scrape
//  data — that part needs the optional local relay server, which
//  this community build doesn't include, so it's omitted here
//  rather than shipped as permanently-disabled dead code.
//
//  What's kept is the duplicate-IMO consistency check: when the
//  same real ship (same SV*_lloyds_code/IMO) appears in more than
//  one SV row, exactly one of those rows should be left unticked
//  SV*_one-off — the rest mark it as an exception call, not a
//  second regular rotation slot. This is pure page-internal logic
//  that never touched the relay in the full version either (see
//  the full src/features/live-check.js's own comment on
//  checkDuplicateImos: "doesn't touch relay data at all").
//
//  Keep this file's checkDuplicateImos()/highlight/banner/dismiss
//  logic in sync with the full extension's live-check.js if that
//  logic changes there.
// ─────────────────────────────────────────────────────
const LiveCheck = {
    _activeFields: new Set(),

    // IDs the clerk has dismissed via "I know what I'm doing" -- in-memory
    // only, never persisted, so a tab refresh (a fresh content-script load)
    // clears it and the check starts flagging again.
    _dismissed: new Set(),

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
        // Delegated on document, not on #tt-banner itself -- banner.js
        // tears down and rebuilds that element on every render, so a
        // listener attached directly to it wouldn't survive the next
        // compareAll() pass.
        document.addEventListener("click", (event) => this.handleDismissClick(event));

        // Run once at load so an already-filled-in page gets checked
        // immediately, not just after the next relevant field change.
        this.compareAll();
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

    compareAll() {
        const items = []; // { id, fields: Field[], line } -- mismatches
        const add = (id, fieldOrFields, line) => {
            const fields = Array.isArray(fieldOrFields) ? fieldOrFields.filter(Boolean) : (fieldOrFields ? [fieldOrFields] : []);
            items.push({ id, fields, line });
        };

        this.checkDuplicateImos(add);

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
    },

    // ── module interface ──

    RELEVANT_PATTERN: /^SV\d+_(lloyds_codeD|one-off)$/,

    handle(event) {
        const { name } = event.target;
        if (!name) return;

        if (this.RELEVANT_PATTERN.test(name)) {
            this.compareAll();
        }
    },
};
