// ─────────────────────────────────────────────────────
//  FEATURE: Fix Vessel Dates
//  Powers the "🛠 Fix Vessel Dates" button. Pushes any vessel
//  whose date is lagging behind SP001 forward in weekly
//  increments from the latest ("furthest") vessel date, and
//  bumps each corrected vessel's voyage code.
//
//  Only registers its Toolbar button when the "Enable Fix
//  Vessel Dates" Custom Rule is ON (default OFF) — this used
//  to be an always-on feature, removed as no longer needed,
//  then brought back as opt-in rather than reintroducing it
//  unconditionally. applyVisibility() is re-run whenever any
//  Custom Rule is toggled (see custom-rules-settings.js), so
//  flipping the rule adds/removes the button immediately
//  without needing a page reload — see Toolbar.unregister()
//  in src/utils/toolbar.js, its counterpart to register().
// ─────────────────────────────────────────────────────
const FixVesselDates = {
    BUTTON_ID: "tt-fix-vessels-btn",

    init() {
        if (!isOnScheduleForm()) return;
        this.applyVisibility();
    },

    applyVisibility() {
        if (CustomRules.isEnabled("enableFixVesselDates")) {
            this.registerButton();
        } else {
            Toolbar.unregister(this.BUTTON_ID);
        }
    },

    registerButton() {
        Toolbar.register({
            id:      this.BUTTON_ID,
            label:   "🛠 Fix Vessel Dates",
            title:   "Recalculate vessel departure dates from matching port calls",
            group:   "vessel",
            onClick: () => {
                console.log("🖱 Fix Vessel Dates clicked");
                this.fixVesselDates();
            }
        });
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

        const voyageIncrement = VoyageUtils.getIncrement();
        const svDateFields    = document.querySelectorAll('input[name^="SV"][name$="_depart_date"]');

        // Collect every vessel with a valid, parseable date, plus its
        // matching voyage field.
        const allVessels = [];

        for (const dateField of svDateFields) {
            const date = DateUtils.parse(dateField.value);
            if (!date) continue;

            // One-off vessels are excluded entirely — not just skipped
            // from being pushed forward, but also never considered for
            // `baseDate` (the "furthest vessel" anchor below), since an
            // intentionally-standalone one-off call shouldn't silently
            // become the reference point every lagging vessel gets
            // cascaded from either.
            const rowMatch = dateField.name.match(/^SV(\d+)_depart_date$/);
            if (rowMatch) {
                const oneOffField = document.querySelector(`input[name="SV${rowMatch[1]}_one-off"]`);
                if (oneOffField?.checked) continue;
            }

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

        beginSync(); // guard against triggering other listeners mid-write
        try {
            lagging.forEach((vessel, index) => {
                // Each lagging vessel gets pushed to a date one week
                // later than the previous one, cascading from baseDate.
                const newDate    = DateUtils.addDays(baseDate, (index + 1) * 7);
                const newDateStr = DateUtils.format(newDate);

                setFieldValue(vessel.dateField, newDateStr);
                console.log(`📅 ${vessel.dateField.name} → ${newDateStr}`);

                if (vessel.voyageField) {
                    const newCode = VoyageUtils.step(vessel.voyageField.value, voyageIncrement);

                    if (newCode !== vessel.voyageField.value) {
                        setFieldValue(vessel.voyageField, newCode);
                        mirrorPvShadow(vessel.voyageField, newCode);
                        console.log(`🔢 ${vessel.voyageField.name} → ${newCode}`);
                    }
                }
            });
        } finally {
            endSync();
        }

        console.log("🎉 Vessel date correction complete.");
        SP001DateValidation.validate(); // vessel dates changed — re-check the mismatch banner
    },

    handle(_event) {}
};
