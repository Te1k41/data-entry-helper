// ============================================================
//  background.js
//  Connects to relay via WebSocket for real-time state sync.
// ============================================================

let lastServiceCode  = "";
let renamingEnabled  = true;
let ws               = null;

// Set whenever a toggle click can't reach the server immediately (WS
// not open — mid-reconnect after a service-worker suspend, a network
// blip, a server restart). Without this, that click silently updates
// the local tabs/storage only, the server never learns about it, and
// the NEXT reconnect's "init" then pushes the server's still-OLD
// value back out — clobbering the click with no indication it never
// actually took effect. Flushed the moment the socket reopens.
let pendingRenamingSend  = null;

// True from the moment a pending send is flushed until its echo comes
// back (or a safety timeout fires). The server's "init" on reconnect
// is sent the instant it accepts the connection — using its OLD
// value, before it's seen our flushed message — and is guaranteed to
// arrive before that message's own "renaming" echo does. Without this
// guard, applying init's stale value would flash the button to the
// wrong label for one round trip before self-correcting.
let awaitingRenamingEcho = false;

console.log("🛰 Background script loaded");

// ── WebSocket Connection ─────────────────────────────────────
function connectWebSocket() {
    ws = new WebSocket("ws://localhost:3737");

    ws.addEventListener("open", () => {
        console.log("🔌 Background connected to relay");

        // Deliver whatever click(s) couldn't reach the server while we
        // were disconnected, before the server's own "init" (which
        // arrives right after this on the same connection) has a
        // chance to overwrite it with a stale value.
        if (pendingRenamingSend !== null) {
            ws.send(JSON.stringify({ type: "renaming", enabled: pendingRenamingSend }));
            console.log("📤 Flushed pending renaming state after reconnect:", pendingRenamingSend);
            pendingRenamingSend  = null;
            awaitingRenamingEcho = true;
            // Safety net: if the echo never comes back (e.g. disconnects
            // again right away), don't get stuck ignoring every future
            // "init" forever — give up waiting after 5s and go back to
            // trusting the server normally.
            setTimeout(() => { awaitingRenamingEcho = false; }, 5000);
        }
    });

    ws.addEventListener("message", (event) => {
        try {
            const data = JSON.parse(event.data);

            if (data.type === "init") {
                lastServiceCode  = data.serviceCode   || "";
                console.log("📥 Init state received:", lastServiceCode, data.renamingEnabled);

                // Skip applying init's renamingEnabled if we just flushed
                // a pending click and are waiting for ITS echo instead —
                // init's value is guaranteed to be stale in that case
                // (see awaitingRenamingEcho above).
                if (!awaitingRenamingEcho) {
                    renamingEnabled = data.renamingEnabled !== false;
                    chrome.storage.local.set({ renamingEnabled });

                    // This fires on every (re)connect — server restart, the
                    // service worker waking from suspend, a network blip —
                    // not just the very first connect. Any tab whose button
                    // was already open before that reconnect has a LOCAL
                    // `enabled` that can now be stale against the server's
                    // authoritative value (e.g. relay-state.js resets to its
                    // hardcoded default on every server restart). Without
                    // this broadcast, that tab's button silently drifts out
                    // of sync with what the server will actually enforce.
                    broadcastRenameState();
                }
            }

            if (data.type === "service") {
                lastServiceCode = data.code || "";
                console.log("📥 Service code updated:", lastServiceCode);
            }

            if (data.type === "renaming") {
                renamingEnabled = data.enabled;
                chrome.storage.local.set({ renamingEnabled });
                awaitingRenamingEcho = false;
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
        // Read from storage (survives service-worker restarts) instead
        // of trusting renamingEnabled, which resets to its hardcoded
        // default every time the worker wakes back up from being
        // suspended, before the WebSocket reconnects and corrects it.
        chrome.storage.local.get("renamingEnabled", (data) => {
            sendResponse({ enabled: data.renamingEnabled ?? renamingEnabled });
        });
        return true; // async sendResponse — keep the channel open
    }

    if (message?.type === "SET_RENAME_STATE") {
        renamingEnabled = message.enabled;
        chrome.storage.local.set({ renamingEnabled });
        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "renaming", enabled: renamingEnabled }));
        } else {
            // Socket isn't open right now (reconnecting) — remember this
            // so connectWebSocket()'s "open" handler sends it the moment
            // the connection comes back, instead of the click just
            // vanishing with the server never finding out.
            pendingRenamingSend = renamingEnabled;
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