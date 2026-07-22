// ─────────────────────────────────────────────────────
//  FEATURE: Rename Toggle
//  Syncs rename ON/OFF state across all tabs and
//  browsers — routed through the background service
//  worker (see background.js) rather than opening a
//  direct WebSocket from inside the page.
//
//  Why: this runs on <all_urls> (minus Tradetech), and
//  some sites set a Content-Security-Policy connect-src
//  that doesn't allow ws://localhost:3737 — the browser
//  blocks that connection before it leaves the machine,
//  no matter how well the relay server is running,
//  because a page's CSP governs anything opened from
//  INSIDE that page's own context, content scripts
//  included. The background service worker isn't part
//  of any page and isn't bound by any page's CSP, so it
//  keeps the one real WebSocket connection and this file
//  just asks IT for state / tells IT about changes via
//  chrome.runtime.sendMessage.
// ─────────────────────────────────────────────────────
const RenameToggle = {

    enabled: true,

    init() {
        // Ask the background service worker for the current state,
        // then create the button once we know what label to show —
        // no more waiting on our own socket's "open" + a timing
        // guess, since sendMessage's callback IS the up-to-date
        // answer.
        chrome.runtime.sendMessage({ type: "GET_RENAME_STATE" }, (response) => {
            if (chrome.runtime.lastError) {
                // Background worker unreachable (rare) — fall back to
                // the default so the button still appears rather than
                // silently never showing up.
                this.createToggleButton();
                return;
            }

            this.enabled = response?.enabled !== false;

            // On mergeimagesonline.com, always force renaming back ON
            // whenever this page loads/reconnects (e.g. a reload
            // after a merge session), regardless of whatever state
            // was left on from before.
            if (location.hostname === "mergeimagesonline.com" && !this.enabled) {
                this.enabled = true;
                this.broadcastEnabled();
                console.log("📁 mergeimagesonline.com loaded — forcing Rename: ON");
            }

            this.createToggleButton();
        });

        // Live updates whenever ANY tab/browser flips the toggle —
        // the background worker broadcasts this to every open tab.
        chrome.runtime.onMessage.addListener((message) => {
            if (message?.type === "RENAME_STATE_CHANGED") {
                this.enabled = message.enabled;
                this.updateButton();
            }
        });
    },

    updateButton() {
        const btn = document.getElementById("tt-rename-toggle");
        if (btn) btn.textContent = `📁 Rename: ${this.enabled ? "ON" : "OFF"}`;
    },

    // Tells the background service worker about the new state, which
    // relays it to the relay server AND broadcasts it to every other
    // open tab.
    broadcastEnabled() {
        chrome.runtime.sendMessage({ type: "SET_RENAME_STATE", enabled: this.enabled });
    },

    createToggleButton() {
        createButton({
            id:      "tt-rename-toggle",
            position: "fixed",
            label:   `📁 Rename: ${this.enabled ? "ON" : "OFF"}`,
            top:     "20px",
            left:    "20px",
            onClick: () => {
                this.enabled = !this.enabled;
                this.broadcastEnabled();
                this.updateButton();
            }
        });
    },

    handle(_event)    {},
    handleBlur(_event) {}
};
