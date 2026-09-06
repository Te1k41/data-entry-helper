// ─────────────────────────────────────────────────────
//  FEATURE: Schedule Cascade
//  Snapshots date diffs, then cascades all port dates
//  forward from SP001 arrival when requested.
// ─────────────────────────────────────────────────────
const ScheduleCascade = {

    diffs: {},
    lastEditedField: null, // name of the last SPxxx_arrival/depart_date field the user actually typed a change into — anchor for Cascade Back
    _cascading: false,     // true while OUR OWN writes are in flight, so handle() doesn't mistake them for fresh user input

    init() {
        this.storeDiffs();
        Toolbar.register({
            id:      "tt-snapshot-diffs",
            label:   "📸 Snapshot Diffs",
            title:   "Save the current intervals between port dates for later cascading",
            group:   "date",
            onClick: () => {
                this.storeDiffs();
                showTemporaryBanner({
                    title:   "📸 Diffs Snapshotted",
                    message: `Stored ${Object.keys(this.diffs).length} port intervals`
                });
            }
        });

        Toolbar.register({
            id:      "tt-cascade-dates",
            label:   "🌊 Cascade Dates",
            title:   "Rebuild port dates forward from SP001 using the saved intervals",
            group:   "date",
            onClick: () => {
                this.cascade();
            }
        });

        Toolbar.register({
            id:      "tt-cascade-back",
            label:   "⏪ Cascade Back",
            title:   "Rebuild earlier port dates backward from the last edited date",
            group:   "date",
            onClick: () => {
                this.cascadeBack();
            }
        });
    },

    storeDiffs() {
    const sp001Field = document.querySelector('input[name="SP001_arrival_date"]');
    const sp001Date  = sp001Field ? DateUtils.parse(sp001Field.value) : null;

    if (!sp001Date) {
        console.warn("⚠ SP001 arrival date not set — snapshot skipped");
        return;
    }

    // First pass: collect the raw diff values per row (keeping the
    // original zero-padded row string, e.g. "001", for building field
    // names later).
    const rawDiffs = {};   // { rowNum: { rowStr, arrival?, depart? } }

    document.querySelectorAll('input[name^="SP"][name$="_arrival_date_diff"]')
        .forEach(field => {
            const match = field.name.match(/^SP(\d+)_arrival_date_diff$/);
            if (!match) return;
            const val = field.value.trim();
            if (!val) return; // empty → skip entirely, don't store
            const rowStr = match[1];
            const rowNum = parseInt(rowStr, 10);
            if (!rawDiffs[rowNum]) rawDiffs[rowNum] = { rowStr };
            rawDiffs[rowNum].arrival = parseInt(val, 10);
        });

    document.querySelectorAll('input[name^="SP"][name$="_depart_date_diff"]')
        .forEach(field => {
            const match = field.name.match(/^SP(\d+)_depart_date_diff$/);
            if (!match) return;
            const val = field.value.trim();
            if (!val) return; // empty → skip entirely, don't store
            const rowStr = match[1];
            const rowNum = parseInt(rowStr, 10);
            if (!rawDiffs[rowNum]) rawDiffs[rowNum] = { rowStr };
            rawDiffs[rowNum].depart = parseInt(val, 10);
        });

    // Second pass: walk the rows in order and enforce the real-world
    // rule this schedule always follows —
    //   arrival_001 ≤ depart_001 ≤ arrival_002 ≤ depart_002 ≤ ...
    // Each reconstructed date must be >= the one before it in the
    // chain. If a diff would push the date BACKWARD, that's the sign
    // Tradetech hasn't recalculated it yet (or it's just bad data) —
    // skip that one value only, rather than trusting a broken sequence.
    const newDiffs = {};
    let previousDate = sp001Date; // arrival_001 is the anchor of the whole chain

    const orderedRows = Object.keys(rawDiffs).map(Number).sort((a, b) => a - b);

    for (const rowNum of orderedRows) {
        const { rowStr, arrival, depart } = rawDiffs[rowNum];

        if (arrival !== undefined) {
            const candidate = DateUtils.addDays(sp001Date, arrival);
            if (candidate >= previousDate) {
                if (!newDiffs[rowStr]) newDiffs[rowStr] = {};
                newDiffs[rowStr].arrival = arrival;
                previousDate = candidate;
            } else {
                console.warn(`⚠ SP${rowStr} arrival diff (${arrival}) goes backward in the sequence — skipped`);
            }
        }

        if (depart !== undefined) {
            const candidate = DateUtils.addDays(sp001Date, depart);
            if (candidate >= previousDate) {
                if (!newDiffs[rowStr]) newDiffs[rowStr] = {};
                newDiffs[rowStr].depart = depart;
                previousDate = candidate;
            } else {
                console.warn(`⚠ SP${rowStr} depart diff (${depart}) goes backward in the sequence — skipped`);
            }
        }
    }

    this.diffs = newDiffs;
    console.log("📦 Diffs stored:", JSON.stringify(this.diffs));

    // storeDiffs() only ever runs from this feature's own button click —
    // there's no field-change event VesselRecommendation could otherwise
    // hear to know fresh diff data just became available, so trigger it
    // directly.
    VesselRecommendation.suggest();
    },

    cascade() {
    const sp001ArrivalField = document.querySelector(
        'input[name="SP001_arrival_date"]'
    );
    if (!sp001ArrivalField?.value.trim()) {
        this.flashCascadeError("⚠ Cascade failed", "SP001 arrival date is not set");
        return;
    }

    const sp001Date = DateUtils.parse(sp001ArrivalField.value);
    if (!sp001Date) return;

    if (Object.keys(this.diffs).length === 0) {
        this.flashCascadeError("⚠ No snapshot", "Click 📸 Snapshot Diffs first");
        return;
    }

    this.applyCascade(sp001Date);

    showTemporaryBanner({
        title:   "🌊 Cascade complete",
        message: `Ports recalculated from SP001 ${DateUtils.format(sp001Date)}`
    });
},

    // Writes every stored diff's date, anchored at the given SP001
    // date — shared by both Cascade Dates (anchor read directly off
    // SP001) and Cascade Back (anchor derived backward from whichever
    // field was just typed into). Guarded by _cascading so these
    // writes don't get mistaken by handle() (below) for a fresh
    // by-hand edit — same idea as main.js's `syncing` guard, but
    // scoped to this feature's own tracking rather than the shared
    // reentrancy flag, so other features (validation, highlighting,
    // etc.) still see and react to these writes exactly as before.
    applyCascade(sp001Date) {
    this._cascading = true;
    try {
        console.log("🌊 Cascading from SP001:", DateUtils.format(sp001Date));

        for (const [row, diff] of Object.entries(this.diffs)) {

            if (diff.arrival !== undefined) {
                const newArrival   = DateUtils.addDays(sp001Date, diff.arrival);
                const arrivalField = document.querySelector(`input[name="SP${row}_arrival_date"]`);
                if (arrivalField) {
                    setFieldValue(arrivalField, DateUtils.format(newArrival));
                    console.log(`📅 SP${row} arrival → ${DateUtils.format(newArrival)}`);
                }
            }

            if (diff.depart !== undefined) {
                const newDepart   = DateUtils.addDays(sp001Date, diff.depart);
                const departField = document.querySelector(`input[name="SP${row}_depart_date"]`);
                if (departField) {
                    setFieldValue(departField, DateUtils.format(newDepart));
                    console.log(`📅 SP${row} depart → ${DateUtils.format(newDepart)}`);
                }
            }
        }
    } finally {
        this._cascading = false;
    }
},

    // "Cascade Back": anchors on whichever port date field you last
    // typed a real change into (tracked by handle(), below) instead of
    // always requiring SP001 to be set first. Works backward from that
    // field's new value and its snapshotted offset from SP001 to figure
    // out what SP001's arrival date must now be, writes that, then runs
    // the normal forward cascade from there — so every row (including
    // SP001 itself) lines back up with the diffs.
    cascadeBack() {
    if (!this.lastEditedField) {
        this.flashCascadeError("⚠ Cascade Back failed", "Type a date into a port field first");
        return;
    }

    if (Object.keys(this.diffs).length === 0) {
        this.flashCascadeError("⚠ No snapshot", "Click 📸 Snapshot Diffs first");
        return;
    }

    const field      = document.querySelector(`input[name="${this.lastEditedField}"]`);
    const anchorDate = field ? DateUtils.parse(field.value) : null;
    if (!anchorDate) {
        this.flashCascadeError("⚠ Cascade Back failed", `${this.lastEditedField} is empty or unreadable`);
        return;
    }

    const [, rowStr, kind] = this.lastEditedField.match(/^SP(\d+)_(arrival|depart)_date$/);
    const diff = this.diffs[rowStr]?.[kind];
    if (diff === undefined) {
        this.flashCascadeError("⚠ Cascade Back failed", `No stored diff for SP${rowStr} ${kind}`);
        return;
    }

    const sp001Date  = DateUtils.addDays(anchorDate, -diff);
    const sp001Field = document.querySelector('input[name="SP001_arrival_date"]');

    this._cascading = true;
    try {
        if (sp001Field) setFieldValue(sp001Field, DateUtils.format(sp001Date));
    } finally {
        this._cascading = false;
    }

    this.applyCascade(sp001Date);

    showTemporaryBanner({
        title:   "⏪ Cascade Back complete",
        message: `SP001 → ${DateUtils.format(sp001Date)}, recalculated from SP${rowStr} ${kind}`
    });
},

    // These two failures used to call showBanner() directly, which
    // bypasses the setWarning registry entirely (see banner.js's own
    // warning about that) — it would silently clobber whatever real
    // warning (SP001 mismatch, missing dates, etc.) was already
    // showing, and then get clobbered right back the next time any
    // OTHER feature's setWarning ran. Routed through the registry
    // instead, with a short auto-clear since these are one-off
    // click-triggered errors, not a standing problem to leave up
    // until something explicitly resolves it.
    flashCascadeError(title, message) {
        setWarning("cascade-error", { title, message });
        setTimeout(() => setWarning("cascade-error", null), 4000);
    },

    // Only tracking here — the actual cascade actions stay fully
    // manual (button-triggered). Records the last SPxxx_arrival/
    // depart_date field a real "change" event fired on, so Cascade
    // Back knows what to anchor on. `syncing` excludes every other
    // feature's own writes (date-syncing's auto-copy, DateStepButtons'
    // non-SP001 nudges); `_cascading` excludes this feature's own
    // writes for the same reason. PV_ shadow fields never match the
    // name pattern below, same exclusion every other feature applies.
    handle(event) {
        if (isSyncing() || this._cascading) return;

        const target = event.target;
        if (target.tagName !== "INPUT" || !target.name) return;

        if (/^SP\d+_(arrival|depart)_date$/.test(target.name)) {
            this.lastEditedField = target.name;
        }
    }
};
