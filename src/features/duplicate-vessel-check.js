// ─────────────────────────────────────────────────────
//  FEATURE: Duplicate Vessel Check
//  Safety net for the SV### vessel rows: flags every row that has
//  the EXACT same Lloyds code AND the exact same voyage number as
//  another row — both have to match, not just one. Keyed by Lloyds
//  code (SV{row}_lloyds_codeD), not vessel name — same identity model
//  as duplicate-vessel.js's Duplicate/Delete buttons and the port side
//  (insert-port.js keys off port_code). A Lloyds code reused with a
//  different voyage (or the same voyage number reused for a different
//  vessel) is normal and not flagged.
//
//  Same pattern as arrival-depart-order-check.js: highlights the
//  offending fields red and reports through the shared warning
//  banner, re-checking on every relevant change and once at load
//  (so a page that already has a duplicate on open gets flagged
//  immediately, not just after the next edit).
// ─────────────────────────────────────────────────────
const DuplicateVesselCheck = {
    HIGHLIGHT: {
        outline:         "2px solid #cc0000",
        backgroundColor: "#fff0f0"
    },

    check() {
        // Only ever clear fields THIS feature previously flagged — other
        // features style these same fields too, and a blanket reset
        // would silently wipe those out.
        document.querySelectorAll("input[data-tt-dup-vessel-flagged]").forEach(f => {
            f.style.outline = "";
            f.style.backgroundColor = "";
            delete f.dataset.ttDupVesselFlagged;
        });

        // Group every row that has BOTH a Lloyds code and a voyage
        // number by the exact "code|voyage" pair.
        const groups = new Map();

        document.querySelectorAll('input[name^="SV"][name$="_vessel_name"]:not([name^="PV_"])').forEach(nameField => {
            const rowMatch = nameField.name.match(/^SV(\d+)_vessel_name$/);
            if (!rowMatch) return;
            const row = rowMatch[1];

            const codeField   = vesselCodeField(row);
            const voyageField = document.querySelector(`input[name="SV${row}_start_voyage"]:not([name^="PV_"])`);
            if (!codeField || !voyageField) return;

            const code   = codeField.value.trim();
            const voyage = voyageField.value.trim();
            if (!code || !voyage) return; // nothing meaningful to compare yet

            const key = `${code}|${voyage}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push({ row, nameField, codeField, voyageField });
        });

        const violations = [];

        groups.forEach(entries => {
            if (entries.length < 2) return; // no duplicate

            entries.forEach(({ row, codeField, voyageField }) => {
                [codeField, voyageField].forEach(f => {
                    f.style.outline = this.HIGHLIGHT.outline;
                    f.style.backgroundColor = this.HIGHLIGHT.backgroundColor;
                    f.dataset.ttDupVesselFlagged = "1";
                });
                violations.push(`SV${row}`);
            });
        });

        setWarning("duplicate-vessel", violations.length > 0 ? {
            title:   "🚢 Duplicate Vessel",
            message: `${violations.join(", ")} — same Lloyds code AND voyage number`
        } : null);
    },

    init() {
        this.check();
    },

    handle(event) {
        const { name } = event.target;
        if (name && !name.startsWith("PV_") && /^SV\d+_(vessel_name|lloyds_codeD|start_voyage)$/.test(name)) this.check();
    }
};
