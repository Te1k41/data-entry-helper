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
    if (!field.value.trim()) continue;

        // clear previous highlight
        field.style.outline         = "";
        field.style.backgroundColor = "";

            const match = field.name.match(/^SV(\d+)_vessel_name$/);
            const num = match[1];
            const dateField = document.querySelector(`input[name="SV${num}_depart_date"]`);

        if (!dateField || !dateField.value.trim()) {
            missing.push(field.value.trim());
            field.style.outline         = "2px solid #cc0000";
            field.style.backgroundColor = "#fff0f0";
        }
    }

        // after the loop — show or hide banner
        if (missing.length > 0) {
            showBanner({
                title:   "🚢 Missing vessel dates",
                message: `No date found for: ${missing.join(", ")}`
            });
        } else {
            removeBanner();
        }
    }
};
