// ─────────────────────────────────────────────────────
//  FEATURE: Last Foreign Port Check
//  Last Foreign Port must be filled IF AND ONLY IF both of these are
//  true:
//    - the AWR ("All Water Route") radio is set to Yes
//    - First USA Port of Call (first_us_port) is filled in
//  If both are true and Last Foreign Port is blank → error, highlight
//  Last Foreign Port. If NOT both are true (either one is missing)
//  and Last Foreign Port has text in it anyway → also an error,
//  same highlight. Only Last Foreign Port itself ever gets flagged —
//  this doesn't touch the AWR radio or First USA Port fields.
// ─────────────────────────────────────────────────────
const LastForeignPortCheck = {
    HIGHLIGHT: {
        outline:         "2px solid #cc0000",
        backgroundColor: "#fff0f0"
    },

    getFields() {
        return {
            awrYes:          document.querySelector('input[name="allWater"][value="Yes"]'),
            firstUsPort:     document.querySelector('input[name="first_us_port"]'),
            lastForeignPort: document.querySelector('input[name="last_foreign_port"]')
        };
    },

    check() {
        const { awrYes, firstUsPort, lastForeignPort } = this.getFields();
        if (!awrYes || !firstUsPort || !lastForeignPort) return; // not a page with all three fields

        const qualifies = awrYes.checked && !!firstUsPort.value.trim();
        const hasText   = !!lastForeignPort.value.trim();

        // Mismatch either way: qualifies but blank, or doesn't qualify but filled in.
        const violated = qualifies !== hasText;

        if (violated) {
            lastForeignPort.style.outline = this.HIGHLIGHT.outline;
            lastForeignPort.style.backgroundColor = this.HIGHLIGHT.backgroundColor;
            lastForeignPort.dataset.ttLfpFlagged = "1";
        } else if (lastForeignPort.dataset.ttLfpFlagged) {
            lastForeignPort.style.outline = "";
            lastForeignPort.style.backgroundColor = "";
            delete lastForeignPort.dataset.ttLfpFlagged;
        }

        setWarning("last-foreign-port", violated ? (
            qualifies
                ? { title: "🚩 Last Foreign Port Missing", message: "AWR = Yes and First USA Port are both set — Last Foreign Port is required" }
                : { title: "🚩 Last Foreign Port Not Expected", message: "AWR isn't Yes or First USA Port is blank — Last Foreign Port should be empty" }
        ) : null);
    },

    init() {
        this.check();
    },

    handle(event) {
        const { name } = event.target || {};
        if (!name) return;

        // Only one "change" event fires per click — on whichever radio
        // was actually clicked (Yes OR No) — so both need to trigger a
        // re-check; clicking No is exactly the case that can newly
        // violate "doesn't qualify but Last Foreign Port has text".
        if (name === "allWater" || name === "first_us_port" || name === "last_foreign_port") {
            this.check();
        }
    }
};
