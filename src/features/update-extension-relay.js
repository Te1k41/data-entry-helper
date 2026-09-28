// ─────────────────────────────────────────────────────
//  FEATURE: Update Extension
//  A toolbar button that pulls the latest code from git (via the
//  relay server, which has shell access this content script doesn't)
//  and reloads the extension so the new code is live immediately —
//  no manual chrome://extensions click needed.
//
//  Always registered, no Custom Rule toggle — this is a maintenance
//  action, not an opt-in data-entry feature, same reasoning
//  live-check-relay.js's button uses. Not in main.js's FEATURES list
//  for the same reason: nothing else needs to call into it.
// ─────────────────────────────────────────────────────
Toolbar.register({
    id:        "tt-update-extension-btn",
    label:     "🔄 Update Extension",
    title:     "Pull the latest code from git and reload the extension",
    group:     "misc",
    requiresRelay: true,
    onClick: () => {
        console.log("🖱 Update Extension clicked");
        chrome.runtime.sendMessage({ type: "CHECK_FOR_UPDATE" }, (response) => {
            // On a real update the background script reloads the tab (and
            // itself) before ever replying, so a response here means
            // either nothing changed or the pull failed — either way,
            // there's no reload in flight and a banner is the right call.
            if (!response) {
                showTemporaryBanner({ title: "🔄 Update Extension", message: "No response from the background script — try again" });
            } else if (!response.ok) {
                showTemporaryBanner({ title: "🔄 Update Extension", message: response.reason || "Update failed — check the background service worker console" });
            } else if (!response.updated) {
                showTemporaryBanner({ title: "🔄 Update Extension", message: `Already up to date (${response.commit})` });
            }
        });
    }
});
