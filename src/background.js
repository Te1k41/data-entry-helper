// ============================================================
//  background.js
//  Connects to relay via WebSocket for real-time state sync.
// ============================================================

let lastServiceCode  = "";
let renamingEnabled  = true;
let ws               = null;

console.log("🛰 Background script loaded");

// ── WebSocket Connection ─────────────────────────────────────
function connectWebSocket() {
    ws = new WebSocket("ws://localhost:3737");

    ws.addEventListener("open", () => {
        console.log("🔌 Background connected to relay");
    });

    ws.addEventListener("message", (event) => {
        try {
            const data = JSON.parse(event.data);

            if (data.type === "init") {
                lastServiceCode  = data.serviceCode   || "";
                renamingEnabled  = data.renamingEnabled !== false;
                console.log("📥 Init state received:", lastServiceCode, renamingEnabled);
            }

            if (data.type === "service") {
                lastServiceCode = data.code || "";
                console.log("📥 Service code updated:", lastServiceCode);
            }

            if (data.type === "renaming") {
                renamingEnabled = data.enabled;
                console.log("🔄 Renaming enabled:", renamingEnabled);
                broadcastRenameState();
            }

        } catch (err) {
            console.error("❌ Bad message:", err);
        }
    });

    ws.addEventListener("close", () => {
        console.log("🔌 Background disconnected — reconnecting in 3s");
        setTimeout(connectWebSocket, 3000);
    });

    ws.addEventListener("error", () => {
        console.error("❌ WebSocket error — will retry");
    });
}

connectWebSocket();

// ── Message relay for content scripts that can't open their own
// WebSocket ────────────────────────────────────────────────────
// rename-toggle.js runs on <all_urls> (except Tradetech), and some
// sites (e.g. Maersk) set a Content-Security-Policy connect-src that
// doesn't include ws://localhost:3737 — the browser blocks that
// connection before it even leaves the machine, no matter how well
// the relay server is running, because the connection is being
// opened from INSIDE the page's own context, which the page's own
// CSP governs. This service worker is NOT part of any page and isn't
// bound by any page's CSP, so content scripts ask IT for the current
// state (and tell IT about changes) via chrome.runtime.sendMessage
// instead of opening a direct socket of their own.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "GET_RENAME_STATE") {
        sendResponse({ enabled: renamingEnabled });
        return; // synchronous response, no need to keep the channel open
    }

    if (message?.type === "SET_RENAME_STATE") {
        renamingEnabled = message.enabled;
        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "renaming", enabled: renamingEnabled }));
        }
        broadcastRenameState();
        return;
    }
});

// Pushes the current renaming state out to every open tab's content
// script, so every rename-toggle.js instance (one per open tab) stays
// in sync whether the change came from another tab's button click or
// from the relay server's own "renaming" broadcast (e.g. someone
// toggled it from a different browser entirely).
function broadcastRenameState() {
    chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
            chrome.tabs.sendMessage(
                tab.id,
                { type: "RENAME_STATE_CHANGED", enabled: renamingEnabled },
                () => {
                    // Tabs with no content script (chrome://, other
                    // extensions' pages, etc.) throw "Receiving end
                    // does not exist" — expected and safe to ignore.
                    void chrome.runtime.lastError;
                }
            );
        }
    });
}

// ── Download Rename ──────────────────────────────────────────
chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
    // server-side watcher handles renaming now
    suggest({ filename: downloadItem.filename });
    return true;
});