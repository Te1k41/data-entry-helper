// ─────────────────────────────────────────────────────
//  FEATURE: AWR Audit
//  Button-only trigger. The actual work — opening every
//  relay-tracked record in a background tab, reading awr-flag.js's
//  suggestion for it, clicking the correct radio itself (awr-flag.js
//  only suggests during normal interactive editing, it never
//  auto-applies — there's no human here to click Apply), and saving
//  only the records that needed correcting — runs in
//  background-relay.js (needs chrome.tabs/chrome.scripting, which
//  content scripts don't have). This file just asks it to start and
//  lets the user know it's running.
//
//  Unlike every other Toolbar-registering feature, this one doesn't
//  act on the CURRENT page's fields at all — it drives its own
//  background-tab batch job over every relay-tracked record, so it
//  belongs wherever you happen to be on tradetech.net, not just the
//  schedule form. Guarding it with isOnScheduleForm() (like the
//  page-content-dependent features) would be wrong here.
//
//  Registers unconditionally, in every injected frame — tried gating
//  this on window.top === window.self to register exactly once per
//  tab, but Tradetech's actual frame structure doesn't satisfy that
//  check even in what DevTools reports as the tab's own top frame
//  (confirmed live), so nothing ever registered. Worst case now is a
//  second small Tools panel (just this one button) on a genuine
//  frameset page, and a double-click reruns the whole audit twice —
//  wasteful, not broken (RUN_AWR_AUDIT is idempotent-ish). Reliably
//  showing up beats a "clever" guard that silently hides it everywhere.
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
