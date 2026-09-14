// ─────────────────────────────────────────────────────
//  FEATURE: AWR Audit
//  Button-only trigger. The actual work — opening every
//  relay-tracked record in a background tab, letting
//  awr-flag.js's own AwrFlag.run() self-correct it, and
//  saving only the records that needed correcting — runs
//  in background-relay.js (needs chrome.tabs/chrome.scripting,
//  which content scripts don't have). This file just asks it
//  to start and lets the user know it's running.
// ─────────────────────────────────────────────────────
const AwrAudit = {
    init() {
        Toolbar.register({
            id:        "tt-awr-audit-btn",
            label:     "🔍 Audit AWR",
            title:     "Re-check AWR on every relay-tracked record; fixes and saves only the ones that are wrong",
            group:     "proof",
            draggable: false,
            requiresRelay: true,
            onClick: () => {
                console.log("🖱 Audit AWR clicked");
                chrome.runtime.sendMessage({ type: "RUN_AWR_AUDIT" });
                showTemporaryBanner({
                    title:   "🔍 AWR audit started",
                    message: "Running one record at a time in background tabs — watch the background service worker console for progress"
                });
            }
        });
    },

    handle(_event)    {},
    handleBlur(_event) {}
};
