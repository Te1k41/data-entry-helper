// ─────────────────────────────────────────────────────
//  FEATURE: Port Date Order Check
//  Safety net across the whole itinerary: it's a schedule, so every
//  date should only move forward as you go down the port list — never
//  backward relative to anything on the nearest PREVIOUS filled port.
//  Three relationships all have to hold between a port and the one
//  before it:
//    - this arrival  >= previous arrival
//    - this depart   >= previous depart
//    - this arrival  >= previous depart   (can't arrive at the next
//                                          port before leaving the one
//                                          before it)
//  Any one of these failing is a violation — they're additive checks,
//  not alternatives to each other.
//
//  A blank port row (e.g. one insert-port.js just created, waiting to
//  be filled in) is skipped entirely — it's neither compared against
//  anything, nor treated as a broken link in the chain. The next
//  filled port after it is compared against the last filled port
//  BEFORE it, same as if the gap wasn't there.
//
//  This is a different check from arrival-depart-order-check.js: that
//  one compares WITHIN a single row (depart before its own arrival);
//  this one compares ACROSS rows (this port before the previous one).
// ─────────────────────────────────────────────────────
const PortDateOrderCheck = {
    HIGHLIGHT: {
        outline:         "2px solid #cc0000",
        backgroundColor: "#fff0f0"
    },

    check() {
        document.querySelectorAll("input[data-tt-port-date-order-flagged]").forEach(f => {
            f.style.outline = "";
            f.style.backgroundColor = "";
            delete f.dataset.ttPortDateOrderFlagged;
        });

        const rows = Array.from(document.querySelectorAll('input[name^="SP"][name$="_arrival_date"]:not([name^="PV_"])'))
            .map(arrivalField => {
                const match = arrivalField.name.match(/^SP(\d+)_arrival_date$/);
                if (!match) return null;
                const row = match[1];
                const departField = document.querySelector(`input[name="SP${row}_depart_date"]:not([name^="PV_"])`);
                return { row, arrivalField, departField };
            })
            .filter(Boolean)
            .sort((a, b) => parseInt(a.row, 10) - parseInt(b.row, 10));

        const violations = [];
        let prev = null; // nearest previous FILLED row, skipping blanks

        rows.forEach(curr => {
            const arrival = DateUtils.parse(curr.arrivalField.value);
            const depart  = curr.departField ? DateUtils.parse(curr.departField.value) : null;

            if (prev) {
                const prevArrival = DateUtils.parse(prev.arrivalField.value);
                const prevDepart  = prev.departField ? DateUtils.parse(prev.departField.value) : null;

                const violated =
                    (arrival && prevArrival && arrival < prevArrival) ||
                    (depart  && prevDepart  && depart  < prevDepart)  ||
                    (arrival && prevDepart  && arrival < prevDepart);

                if (violated) {
                    [prev.arrivalField, prev.departField, curr.arrivalField, curr.departField].forEach(f => {
                        if (!f) return;
                        f.style.outline = this.HIGHLIGHT.outline;
                        f.style.backgroundColor = this.HIGHLIGHT.backgroundColor;
                        f.dataset.ttPortDateOrderFlagged = "1";
                    });
                    violations.push(`SP${curr.row}`);
                }
            }

            // A blank row (nothing parseable yet) doesn't become the new
            // "prev" — the next filled row still compares against
            // whatever the last REAL port was, gap or no gap.
            if (arrival || depart) prev = curr;
        });

        setWarning("port-date-order", violations.length > 0 ? {
            title:   "⏱ Port Out of Order",
            message: `${violations.join(", ")} — dates go backward relative to the previous port`
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
