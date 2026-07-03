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

    // Splits a voyage code like "0042A" into its numeric part (42),
    // any trailing letter suffix ("A"), and the original digit width
    // (4) so it can be re-padded correctly later.
    parseVoyageCode(code) {
        if (!code) return null;
        const match = code.trim().match(/^(\d+)([A-Za-z]*)$/);
        if (!match) return null;
        return { num: parseInt(match[1], 10), suffix: match[2], width: match[1].length };
    },

    // Rebuilds a voyage code string from a parsed object + new number,
    // re-padding with leading zeros to match the original width.
    buildVoyageCode(parsed, newNum) {
        return String(newNum).padStart(parsed.width, "0") + parsed.suffix;
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
                    const parsed = this.parseVoyageCode(vessel.voyageField.value);
                    if (parsed) {
                        const newCode = this.buildVoyageCode(parsed, parsed.num + voyageIncrement);
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
        createButton({
        id:      "tt-fix-vessels-btn",
        label:   "🛠 Fix Vessel Dates",
        top:     "312px",
        left:    "30px",
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
