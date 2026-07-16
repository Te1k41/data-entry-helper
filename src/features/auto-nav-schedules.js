// ─────────────────────────────────────────────────────
//  FEATURE: Auto-Navigate to Sailing Schedules
//  Right after logging in, automatically clicks
//  "Data Input" → waits for "Sailing Schedules" to
//  appear → clicks that too, landing on the search
//  page. due-service-scanner.js takes over from there
//  (fills your name, runs the search, scans results).
//
//  Gated by the SAME once-per-calendar-day flag as
//  due-service-scanner.js (shared localStorage key,
//  duplicated here rather than referenced cross-file to
//  keep these two features independent) — the WHOLE
//  routine (nav + search + scan + post) only runs once
//  per day, not once per browser tab. sessionStorage flags
//  are still used WITHIN that one daily run, so a page/
//  frame reload mid-flow doesn't re-click links it already
//  clicked a moment ago.
// ─────────────────────────────────────────────────────

const AutoNavSchedules = {

    FLAG_CLICKED_DATA_INPUT:        "tt_clickedDataInput",
    FLAG_CLICKED_SAILING_SCHEDULES: "tt_clickedSailingSchedules",
    FLAG_LAST_AUTO_SCAN_DATE:       "tt_dueScan_lastAutoScanDate", // must match due-service-scanner.js exactly

    todayDateString() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    },

    hasAutoScannedToday() {
        return localStorage.getItem(this.FLAG_LAST_AUTO_SCAN_DATE) === this.todayDateString();
    },

    init() {
        // Already completed the full daily routine (today's scan
        // already posted) — don't even start clicking anything.
        if (this.hasAutoScannedToday()) return;

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