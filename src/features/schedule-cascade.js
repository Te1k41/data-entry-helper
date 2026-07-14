// ─────────────────────────────────────────────────────
//  FEATURE: Schedule Cascade
//  Snapshots date diffs, then cascades all port dates
//  forward from SP001 arrival when requested.
// ─────────────────────────────────────────────────────
const ScheduleCascade = {

    diffs: {},

    init() {
        this.storeDiffs();
        createButton({
            id:      "tt-snapshot-diffs",
            label:   "📸 Snapshot Diffs",
            top:     "390px",
            left:    "30px",
            onClick: () => {
                this.storeDiffs();
                showTemporaryBanner({
                    title:   "📸 Diffs Snapshotted",
                    message: `Stored ${Object.keys(this.diffs).length} port intervals`
                });
            }
        });

        createButton({
            id:      "tt-cascade-dates",
            label:   "🌊 Cascade Dates",
            top:     "430px",
            left:    "30px",
            onClick: () => {
                this.cascade();
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
        showBanner({
            title:   "⚠ Cascade failed",
            message: "SP001 arrival date is not set"
        });
        return;
    }

    const sp001Date = DateUtils.parse(sp001ArrivalField.value);
    if (!sp001Date) return;

    if (Object.keys(this.diffs).length === 0) {
        showBanner({
            title:   "⚠ No snapshot",
            message: "Click 📸 Snapshot Diffs first"
        });
        return;
    }

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

    showTemporaryBanner({
        title:   "🌊 Cascade complete",
        message: `Ports recalculated from SP001 ${DateUtils.format(sp001Date)}`
    });
},

    handle(_event) {
        // fully manual — no auto triggers
    }
};