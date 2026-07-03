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
    this.diffs = {};

    document.querySelectorAll('input[name^="SP"][name$="_arrival_date_diff"]')
        .forEach(field => {
            const match = field.name.match(/^SP(\d+)_arrival_date_diff$/);
            if (!match) return;
            const arrVal = field.value.trim();
            if (!arrVal) return;  // empty → skip entirely, don't store
            const row = match[1];
            if (!this.diffs[row]) this.diffs[row] = {};
            this.diffs[row].arrival = parseInt(arrVal, 10);
        });

    document.querySelectorAll('input[name^="SP"][name$="_depart_date_diff"]')
        .forEach(field => {
            const match = field.name.match(/^SP(\d+)_depart_date_diff$/);
            if (!match) return;
            const depVal = field.value.trim();
            if (!depVal) return;  // empty → skip entirely, don't store
            const row = match[1];
            if (!this.diffs[row]) this.diffs[row] = {};
            this.diffs[row].depart = parseInt(depVal, 10);
        });

    console.log("📦 Diffs stored:", JSON.stringify(this.diffs));
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