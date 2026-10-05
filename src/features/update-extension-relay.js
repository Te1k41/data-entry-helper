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
    // Progress/result banners live in UpdateFlow (utils/update-flow.js),
    // shared with the community edition's native updater button.
    onClick: () => UpdateFlow.run({
        buttonId:    "tt-update-extension-btn",
        label:       "🔄 Update Extension",
        messageType: "CHECK_FOR_UPDATE",
        waitingText: "Pulling the latest code from git…",
        failHint:    "Update failed — check the background service worker console",
    }),
});
