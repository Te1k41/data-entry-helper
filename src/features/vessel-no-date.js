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
            // Always clear the previous highlight first — including when
            // the field is now empty. If we skip empty fields before
            // this line, deleting a vessel name leaves a stale red
            // outline behind forever since nothing ever un-highlights it.
            field.style.outline         = "";
            field.style.backgroundColor = "";

            if (!field.value.trim()) continue; // nothing to flag on an empty name

            const match = field.name.match(/^SV(\d+)_vessel_name$/);
            const num = match[1];
            const dateField = document.querySelector(`input[name="SV${num}_depart_date"]`);

            if (!dateField || !dateField.value.trim()) {
                missing.push(field.value.trim());
                field.style.outline         = "2px solid #cc0000";
                field.style.backgroundColor = "#fff0f0";
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