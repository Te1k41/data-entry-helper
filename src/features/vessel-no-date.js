// ─────────────────────────────────────────────────────
//  FEATURE: Your Feature Name
//  One sentence describing what this does
// ─────────────────────────────────────────────────────
const DetectVesselNoDate = {

    init() {
        this.check();
    },

    handle(event) {
        const { name } = event.target;

        const relevant =
            /^SV\d+_vessel_name$/.test(name) ||
            /^SV\d+_depart_date$/.test(name);

        if (relevant) this.check();
    },

    check() {
        const vesselFields = Array.from(document.querySelectorAll(
            'input[name^="SV"][name$="_vessel_name"]:not([name^="PV_"])'
        ));

        const missing = [];  // ← collect flagged vessels here, BEFORE the loop

        for (const field of vesselFields) {
            // Only clear styling THIS feature previously applied (marked
            // via a data attribute) — never blindly reset every vessel
            // field's outline/background, since other features (basing-on,
            // vessel suggestions) also style these same fields and would
            // get silently wiped out otherwise.
            if (field.dataset.ttVesselNoDateFlagged) {
                field.style.outline = "";
                field.style.backgroundColor = "";
                delete field.dataset.ttVesselNoDateFlagged;
            }

            if (!field.value.trim()) continue; // nothing to flag on an empty name

            const match = field.name.match(/^SV(\d+)_vessel_name$/);
            const num = match[1];
            const dateField = document.querySelector(`input[name="SV${num}_depart_date"]`);

            if (!dateField || !dateField.value.trim()) {
                missing.push(field.value.trim());
                field.style.outline = "2px solid #cc0000";
                field.style.backgroundColor = TradetechStars.darkModeOn ? "" : "#fff0f0";
                field.dataset.ttVesselNoDateFlagged = "1";
            }
        }

        // after the loop — register or clear this feature's own warning
        if (missing.length > 0) {
            setWarning("missing-vessel-dates", {
                title:   "🚢 Missing vessel dates",
                message: `No date found for: ${missing.join(", ")}`
            });
        } else {
            setWarning("missing-vessel-dates", null);
        }
    }
};