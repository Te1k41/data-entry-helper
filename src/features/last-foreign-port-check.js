// ─────────────────────────────────────────────────────
//  FEATURE: Last Foreign Port Check
//  Last Foreign Port must be filled IF AND ONLY IF First USA Port of
//  Call (first_us_port) is filled in — AWR's own Yes/No no longer
//  factors in here. If First USA Port is set and Last Foreign Port is
//  blank → error, highlight Last Foreign Port. If First USA Port is
//  blank and Last Foreign Port has text anyway → also an error, same
//  highlight. Only Last Foreign Port itself ever gets flagged — this
//  doesn't touch the AWR radio or First USA Port fields.
// ─────────────────────────────────────────────────────
const LastForeignPortCheck = {
    HIGHLIGHT: {
        outline:         "2px solid #cc0000",
        backgroundColor: "#fff0f0"
    },

    getFields() {
        return {
            firstUsPort:     document.querySelector('input[name="first_us_port"]'),
            lastForeignPort: document.querySelector('input[name="last_foreign_port"]')
        };
    },

    check() {
        const { firstUsPort, lastForeignPort } = this.getFields();
        if (!firstUsPort || !lastForeignPort) return; // not a page with both fields

        const qualifies = !!firstUsPort.value.trim();
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
                ? { title: "🚩 Last Foreign Port Missing", message: "First USA Port is set — Last Foreign Port is required" }
                : { title: "🚩 Last Foreign Port Not Expected", message: "First USA Port is blank — Last Foreign Port should be empty" }
        ) : null);
    },

    init() {
        this.check();
    },

    handle(event) {
        const { name } = event.target || {};
        if (!name) return;

        if (name === "first_us_port" || name === "last_foreign_port") {
            this.check();
        }
    }
};
