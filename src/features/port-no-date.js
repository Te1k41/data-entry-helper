// ─────────────────────────────────────────────────────
//  FEATURE: Detect Port No Date
//  Warns when a port row has a port name filled in but
//  BOTH its arrival and departure dates are blank. Mirrors
//  vessel-no-date.js's structure, applied to SP (port) rows
//  instead of SV (vessel) rows. Checks every SP row on the
//  page — not just the active-route subset.
// ─────────────────────────────────────────────────────
const DetectPortNoDate = {

    init() {
        this.check();
    },

    handle(event) {
        const { name } = event.target;

        const relevant =
            /^SP\d+_port_name$/.test(name) ||
            /^SP\d+_arrival_date$/.test(name) ||
            /^SP\d+_depart_date$/.test(name);

        if (relevant) this.check();
    },

    check() {
        const portFields = Array.from(document.querySelectorAll(
            'input[name^="SP"][name$="_port_name"]:not([name^="PV_"])'
        ));

        const missing = []; // ← collect flagged ports here, BEFORE the loop

        for (const field of portFields) {
            // Only clear styling THIS feature previously applied (marked
            // via a data attribute) — never blindly reset every port
            // field's outline/background, since PortHighlighting also
            // styles these same fields (its orange region-change
            // highlight) and would get silently wiped out otherwise.
            if (field.dataset.ttPortNoDateFlagged) {
                field.style.outline = "";
                field.style.backgroundColor = "";
                delete field.dataset.ttPortNoDateFlagged;
            }

            if (!field.value.trim()) continue; // nothing to flag on an empty port

            const match = field.name.match(/^SP(\d+)_port_name$/);
            const num = match[1];
            const arrivalField = document.querySelector(`input[name="SP${num}_arrival_date"]`);
            const departField  = document.querySelector(`input[name="SP${num}_depart_date"]`);

            const hasArrival = arrivalField && arrivalField.value.trim();
            const hasDepart  = departField && departField.value.trim();

            // Only flag when BOTH are missing — a port with just one of
            // the two dates set (e.g. final port with no departure) is
            // normal and shouldn't trigger this warning.
            if (!hasArrival && !hasDepart) {
                missing.push(field.value.trim());
                field.style.outline = "2px solid #cc0000";
                field.style.backgroundColor = TradetechStars.darkModeOn ? "" : "#fff0f0";
                field.dataset.ttPortNoDateFlagged = "1";
            }
        }

        // after the loop — register or clear this feature's own warning
        if (missing.length > 0) {
            setWarning("missing-port-dates", {
                title:   "⚓ Missing port dates",
                message: `No arrival or departure date for: ${missing.join(", ")}`
            });
        } else {
            setWarning("missing-port-dates", null);
        }
    }
};