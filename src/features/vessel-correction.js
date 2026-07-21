// ─────────────────────────────────────────────────────
//  FEATURE: Vessel Voyage Correction
//  Powers the "🛠 Fix Vessel Dates" button. Pushes any
//  vessel whose date is lagging behind SP001 forward in
//  weekly increments from the latest ("furthest") vessel
//  date, and bumps each corrected vessel's voyage code.
// ─────────────────────────────────────────────────────
const VesselVoyageCorrection = {

    // Reads how much to bump each voyage code by. Defaults to 1
    // if the field is missing or not a valid number.
    getVoyageIncrement() {
        const field = document.querySelector('input[name="voyage_increment_by"]');
        if (!field) return 1;
        const val = parseInt(field.value.trim(), 10);
        return isNaN(val) ? 1 : val;
    },

    fixVesselDates() {
        const sp001Field = document.querySelector('input[name="SP001_depart_date"]');

        if (!sp001Field?.value.trim()) {
            alert("SP001 departure date is not set.");
            return;
        }

        const sp001Date = DateUtils.parse(sp001Field.value);
        if (!sp001Date) {
            alert("Invalid SP001 departure date.");
            return;
        }

        const voyageIncrement = this.getVoyageIncrement();
        const svDateFields    = document.querySelectorAll('input[name^="SV"][name$="_depart_date"]');

        // Collect every vessel with a valid, parseable date, plus its
        // matching voyage field.
        const allVessels = [];

        for (const dateField of svDateFields) {
            const date = DateUtils.parse(dateField.value);
            if (!date) continue;

            const voyageName  = dateField.name.replace("_depart_date", "_start_voyage");
            const voyageField = document.querySelector(
                `input[name="${voyageName}"]:not([name^="PV_"])`
            );

            allVessels.push({ dateField, voyageField, date });
        }

        if (allVessels.length === 0) { alert("No vessel dates found."); return; }

        // Vessels whose date falls before SP001 are considered "lagging"
        // and need to be pushed forward. Sort earliest-first so the
        // cascade below applies increasing offsets in the right order.
        const lagging = allVessels
            .filter(v => v.date < sp001Date)
            .sort((a, b) => a.date - b.date);

        if (lagging.length === 0) { alert("No vessels found before SP001."); return; }

        // Anchor point: the vessel with the LATEST date among ALL
        // vessels. Lagging vessels get pushed forward from this date.
        const furthestVessel = allVessels.reduce((max, v) => v.date > max.date ? v : max);
        const baseDate = furthestVessel.date;

        console.log(`📅 SP001: ${DateUtils.format(sp001Date)}`);
        console.log(`📅 Base (furthest vessel): ${DateUtils.format(baseDate)}`);
        console.log(`🚢 Lagging vessels: ${lagging.length}`);

        syncing = true; // guard against triggering other listeners mid-write
        try {
            lagging.forEach((vessel, index) => {
                // Each lagging vessel gets pushed to a date one week
                // later than the previous one, cascading from baseDate.
                const newDate    = DateUtils.addDays(baseDate, (index + 1) * 7);
                const newDateStr = DateUtils.format(newDate);

                setFieldValue(vessel.dateField, newDateStr);
                console.log(`📅 ${vessel.dateField.name} → ${newDateStr}`);

                if (vessel.voyageField) {
                    // VoyageUtils.step() bumps EVERY digit run in the
                    // code (see src/utils/voyage.js) — this used to be
                    // a single-number-plus-letter-suffix parser that
                    // silently skipped the whole bump for any code with
                    // more than one number in it (e.g. "2698-102"), since
                    // that shape just failed to parse. Sharing the same
                    // stepping logic the [-][+] voyage buttons use keeps
                    // this button consistent with those, for every
                    // voyage code shape they both handle.
                    const newCode = VoyageUtils.step(vessel.voyageField.value, voyageIncrement);

                    if (newCode !== vessel.voyageField.value) {
                        setFieldValue(vessel.voyageField, newCode);

                        // Tradetech keeps a hidden PV_ duplicate of this
                        // field — mirror the value directly since it has
                        // no listeners that need notifying.
                        const pvField = document.querySelector(
                            `input[name="PV_${vessel.voyageField.name}"]`
                        );
                        if (pvField) pvField.value = newCode;

                        console.log(`🔢 ${vessel.voyageField.name} → ${newCode}`);
                    }
                }
            });
        } finally {
            syncing = false;
        }

        console.log("🎉 Vessel date correction complete.");
        SP001DateValidation.validate(); // vessel dates changed — re-check the mismatch banner
    },

    init() {
        Toolbar.register({
        id:      "tt-fix-vessels-btn",
        label:   "🛠 Fix Vessel Dates",
        onClick: () => {
            console.log("🖱 Fix Vessel Dates clicked");
            this.fixVesselDates();
        }
        });
    },

    handle(_event) {
        // This feature is entirely button-driven; nothing to do on change
    }
};