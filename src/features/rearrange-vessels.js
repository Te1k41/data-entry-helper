// ─────────────────────────────────────────────────────
//  FEATURE: Rearrange Vessels
//  Button that physically reorders the SV vessel table
//  rows by departure date (soonest first). Moves the actual
//  <tr> elements — field NAMES stay attached to whichever
//  row they're already in, so any hidden fields in that row
//  travel with it automatically. Vessels with no parseable
//  date are pushed to the end, keeping their relative order.
//
//  Manual trigger only — reordering rows is more invasive
//  than anything else this extension does, so it never
//  happens automatically.
// ─────────────────────────────────────────────────────
const RearrangeVessels = {

    init() {
        createButton({
            id:      "tt-rearrange-vessels",
            position: "fixed",
            label:   "🔀 Rearrange Vessels",
            top:     "140px",
            left:    "20px",
            onClick: () => this.rearrange()
        });
    },

    rearrange() {
        const nameFields = Array.from(document.querySelectorAll(
            'input[name^="SV"][name$="_vessel_name"]:not([name^="PV_"])'
        ));

        if (nameFields.length === 0) {
            console.warn("⚠ Rearrange Vessels: no SV vessel rows found");
            return;
        }

        // Pair each row with its parsed depart date (or null if missing/
        // unparseable), keeping a reference to the actual <tr> to move.
        const rows = nameFields.map(nameField => {
            const rowMatch = nameField.name.match(/^SV(\d+)_vessel_name$/);
            const num = rowMatch ? rowMatch[1] : null;
            const dateField = num ? document.querySelector(`input[name="SV${num}_depart_date"]`) : null;
            const date = dateField ? DateUtils.parse(dateField.value) : null;
            const tr = nameField.closest("tr");

            return { tr, date, name: nameField.value.trim() || `(SV${num})` };
        }).filter(r => r.tr); // skip anything not inside a real row

        if (rows.length === 0) {
            console.warn("⚠ Rearrange Vessels: no rows found to move");
            return;
        }

        // Stable sort: dated rows first (soonest → latest), undated rows
        // pushed to the end in their original relative order.
        const sorted = rows
            .map((row, index) => ({ ...row, index })) // preserve original order for the stable tie-break
            .sort((a, b) => {
                if (a.date && b.date) return a.date - b.date;
                if (a.date && !b.date) return -1;
                if (!a.date && b.date) return 1;
                return a.index - b.index; // both undated — keep original order
            });

        const parent = rows[0].tr.parentNode;
        if (!parent) {
            console.warn("⚠ Rearrange Vessels: rows have no common parent — aborting");
            return;
        }

        // appendChild on an element ALREADY in the DOM moves it rather
        // than duplicating it — calling this in sorted order leaves the
        // parent's children in exactly that final order.
        sorted.forEach(row => parent.appendChild(row.tr));

        console.log(
            "🔀 Rearranged vessels by depart date:",
            sorted.map(r => `${r.name}${r.date ? ` (${DateUtils.format(r.date)})` : " (no date)"}`).join(", ")
        );

        showTemporaryBanner({
            title:   "🔀 Vessels rearranged",
            message: `Sorted ${sorted.length} row(s) by departure date`
        });
    },

    handle(_event)     {},
    handleBlur(_event) {}
};