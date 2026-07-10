// ─────────────────────────────────────────────────────
//  FEATURE: Auto-Navigate to Sailing Schedules
//  Right after logging in, automatically clicks
//  "Data Input" → waits for "Sailing Schedules" to
//  appear → clicks that too, landing on the search
//  page. due-service-scanner.js takes over from there
//  (fills your name, runs the search, scans results).
//
//  Runs at most once per browser tab session — uses
//  sessionStorage flags so it doesn't re-click these
//  links every time a page/frame reloads while you're
//  working elsewhere in Tradetech.
// ─────────────────────────────────────────────────────

const AutoNavSchedules = {

    FLAG_CLICKED_DATA_INPUT:       "tt_clickedDataInput",
    FLAG_CLICKED_SAILING_SCHEDULES: "tt_clickedSailingSchedules",

    init() {
        // Whole flow already completed this tab session — do nothing,
        // even if both links happen to still be present on this page.
        if (sessionStorage.getItem(this.FLAG_CLICKED_SAILING_SCHEDULES)) return;

        const sailingLink = this.findLinkByText("Sailing Schedules");
        if (sailingLink) {
            this.clickSailingSchedules(sailingLink);
            return;
        }

        if (sessionStorage.getItem(this.FLAG_CLICKED_DATA_INPUT)) {
            // Already clicked Data Input (on an earlier page/frame) but
            // Sailing Schedules isn't in THIS particular document. Poll
            // briefly in case it appears here without a full reload.
            this.waitForSailingSchedulesLink();
            return;
        }

        const dataInputLink = this.findLinkByText("Data Input");
        if (dataInputLink) {
            sessionStorage.setItem(this.FLAG_CLICKED_DATA_INPUT, "1");
            console.log('🧭 Auto-nav: clicking "Data Input"');
            dataInputLink.click();
            // Covers the case where Sailing Schedules appears in this
            // same document right after the click (menu reveal) rather
            // than via a fresh page/frame load.
            this.waitForSailingSchedulesLink();
        }
    },

    findLinkByText(text) {
        return Array.from(document.querySelectorAll("a"))
            .find(a => a.textContent.trim() === text) || null;
    },

    clickSailingSchedules(link) {
        sessionStorage.setItem(this.FLAG_CLICKED_SAILING_SCHEDULES, "1");
        console.log('🧭 Auto-nav: clicking "Sailing Schedules"');
        link.click();
    },

    waitForSailingSchedulesLink() {
        let attempts = 0;
        const maxAttempts = 20; // 20 × 250ms = 5s ceiling

        const timer = setInterval(() => {
            attempts++;
            const link = this.findLinkByText("Sailing Schedules");

            if (link) {
                clearInterval(timer);
                this.clickSailingSchedules(link);
                return;
            }

            if (attempts >= maxAttempts) {
                clearInterval(timer);
                console.warn('⚠ Auto-nav: "Sailing Schedules" link never appeared — giving up');
            }
        }, 250);
    },

    handle(_event)     {},
    handleBlur(_event) {}
};