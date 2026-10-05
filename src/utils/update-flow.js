// ============================================================
//  src/utils/update-flow.js
//  Shared click flow for both Update Extension buttons — relay
//  (update-extension-relay.js, private) and native
//  (update-extension-native.js, community) — so people can SEE it's
//  working instead of clicking into silence:
//   - the button turns "⏳ Updating…" (extra clicks ignored)
//   - a banner says what's happening, with a live seconds counter
//   - on a real update: "Updated to abc1234 — reloading…" + what's new,
//     shown ~2s before background.js reloads the tab and the extension
//   - after that reload: a "✅ Extension updated" banner, once, listing
//     what changed (handed over via chrome.storage.local "ttJustUpdated",
//     written by background.js right before it reloads)
// ============================================================

const UpdateFlow = {
    _running: false,

    // buttonId/label: the Toolbar button to flip while running.
    // messageType: what background.js should do (CHECK_FOR_UPDATE /
    // CHECK_FOR_UPDATE_NATIVE). waitingText: what's happening meanwhile.
    run({ buttonId, label, messageType, waitingText, failHint }) {
        if (this._running) return;
        this._running = true;

        const started = Date.now();
        const status = (message, ms = 120000) => showTemporaryBanner({ title: "🔄 Update Extension", message }, ms);
        const tick = () => status(`${waitingText} (${Math.round((Date.now() - started) / 1000)}s)`);
        Toolbar.updateLabel(buttonId, "⏳ Updating…", "Update in progress");
        tick();
        const timer = setInterval(tick, 1000);
        const finish = (message, ms) => {
            clearInterval(timer);
            this._running = false;
            Toolbar.updateLabel(buttonId, label);
            status(message, ms);
        };

        chrome.runtime.sendMessage({ type: messageType }, (response) => {
            if (chrome.runtime.lastError || !response) {
                finish("❌ No response from the background script — try again", 8000);
            } else if (!response.ok) {
                finish(`❌ ${escapeUpdateText(response.reason || failHint)}`, 12000);
            } else if (!response.updated) {
                finish(`✅ Already up to date${response.commit ? ` (${escapeUpdateText(response.commit)})` : ""}`, 5000);
            } else {
                // background.js reloads in ~2s — leave the button busy, nothing more to click
                clearInterval(timer);
                status(`⬇️ Updated to ${escapeUpdateText(response.commit || "latest")} — reloading…${formatUpdateCommits(response.commits)}`);
            }
        });
    },
};

function escapeUpdateText(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatUpdateCommits(commits) {
    if (!commits?.length) return "";
    return "<br><br>What's new:<br>" + commits.map(c => `• ${escapeUpdateText(c)}`).join("<br>");
}

// After the reload: say it worked, once. Only in the frame that actually
// shows the Toolbar's page — not a <frameset> shell (no real <body> to
// draw on) and not Tradetech's other, form-less child frames, or the same
// banner would pop up once per frame.
chrome.storage.local.get("ttJustUpdated", ({ ttJustUpdated: info }) => {
    if (!info || Date.now() - info.at > 2 * 60 * 1000) return;
    if (document.body?.tagName !== "BODY") return;
    if (window !== window.top && !isOnScheduleForm()) return;
    chrome.storage.local.remove("ttJustUpdated");
    showTemporaryBanner({
        title:   "✅ Extension updated",
        message: `Now on ${escapeUpdateText(info.commit || "the latest version")}${formatUpdateCommits(info.commits)}`,
    }, 10000);
});
