// ─────────────────────────────────────────────────────
//  FEATURE: Arrival/Depart Order Check
//  Safety net for every SP*_arrival_date / SP*_depart_date pair:
//  flags a row where depart lands BEFORE arrival (ETD < ETA).
//  date-step-buttons.js already prevents this when using its
//  +/- buttons, but that only guards ITS OWN writes — this
//  catches everything else that can set a date directly (typing,
//  paste, Tradetech's own autofill/async port lookups), none of
//  which go through that guard. Runs at load too, so a service
//  opened with a bad pair already autofilled gets flagged
//  immediately, not just after the next edit.
// ─────────────────────────────────────────────────────
const ArrivalDepartOrderCheck = {
    HIGHLIGHT: {
        outline:         "2px solid #cc0000",
        backgroundColor: "#fff0f0"
    },

    check() {
        // Only ever clear fields THIS feature previously flagged — other
        // features (port-highlighting.js, etc.) style these same date
        // fields too, and a blanket reset would silently wipe those out.
        document.querySelectorAll("input[data-tt-order-flagged]").forEach(f => {
            f.style.outline = "";
            f.style.backgroundColor = "";
            delete f.dataset.ttOrderFlagged;
        });

        const violations = [];

        document.querySelectorAll('input[name^="SP"][name$="_arrival_date"]:not([name^="PV_"])').forEach(arrivalField => {
            const rowMatch = arrivalField.name.match(/^SP(\d+)_arrival_date$/);
            if (!rowMatch) return;
            const row = rowMatch[1];

            const departField = document.querySelector(`input[name="SP${row}_depart_date"]`);
            if (!departField) return;

            const arrival = DateUtils.parse(arrivalField.value);
            const depart  = DateUtils.parse(departField.value);
            if (!arrival || !depart) return; // nothing to compare yet

            if (depart < arrival) {
                [arrivalField, departField].forEach(f => {
                    f.style.outline = this.HIGHLIGHT.outline;
                    f.style.backgroundColor = this.HIGHLIGHT.backgroundColor;
                    f.dataset.ttOrderFlagged = "1";
                });
                violations.push(`SP${row}`);
            }
        });

        setWarning("arrival-depart-order", violations.length > 0 ? {
            title:   "⏱ Depart before Arrival",
            message: `${violations.join(", ")} — check ${violations.length > 1 ? "these dates" : "this date"}`
        } : null);
    },

    init() {
        this.check();
    },

    handle(event) {
        const { name } = event.target;
        if (name && /^SP\d+_(arrival|depart)_date$/.test(name)) this.check();
    }
};
