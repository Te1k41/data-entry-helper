// ============================================================
//  relay-socket.js
//  WebSocket layer: broadcasts service-code and renaming-toggle
//  state to every connected tab/browser, and handles the
//  merge-download signal that triggers cleanup.
// ============================================================

const WebSocket = require("ws");
const relayState = require("./relay-state");
const { runMergeCleanup } = require("./merge-cleanup");
const scheduleGuidelineStore = require("./schedule-guideline-store");
const scheduleDomScrapeStore = require("./schedule-dom-scrape-store");
const { PORT } = require("./config");

let wss = null;

// Every legitimate caller: the extension's own content scripts (running on
// these pages, per manifest.json's content_scripts matches), the
// dashboard's own pages (served by this same server), and the extension's
// background service worker (chrome-extension://<id> -- the id varies per
// install/reload, so that's matched by scheme rather than pinned exactly).
// Anything else trying to open a WS to this port is refused before it can
// read/send relay state.
const ALLOWED_WS_ORIGINS = new Set([
    "https://www.tradetech.net",
    "https://mergeimagesonline.com",
    `http://localhost:${PORT}`,
]);

function isAllowedOrigin(origin) {
    if (!origin) return false;
    if (ALLOWED_WS_ORIGINS.has(origin)) return true;
    return origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://");
}

function broadcast(data) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Attaches a WebSocket server to the given HTTP server instance.
function init(httpServer) {
    wss = new WebSocket.Server({
        server: httpServer,
        verifyClient: (info) => isAllowedOrigin(info.origin),
    });

    wss.on("connection", (ws) => {
        console.log("🔌 Client connected");

        ws.send(JSON.stringify({
            type:             "init",
            serviceCode:      relayState.currentServiceCode,
            renamingEnabled:  relayState.renamingEnabled,
            toolbarCollapsed: relayState.toolbarCollapsed
        }));

        ws.on("message", (raw) => {
            try {
                const data = JSON.parse(raw);
                if (!data || typeof data !== "object" || typeof data.type !== "string") return;

                if (data.type === "service" && typeof data.code === "string") {
                    relayState.currentServiceCode = data.code;
                    console.log("📥 Service code:", relayState.currentServiceCode);
                    broadcast({ type: "service", code: relayState.currentServiceCode });
                }

                if (data.type === "renaming" && typeof data.enabled === "boolean") {
                    relayState.renamingEnabled = data.enabled;
                    relayState.save();
                    console.log("🔄 Renaming enabled:", relayState.renamingEnabled);
                    broadcast({ type: "renaming", enabled: relayState.renamingEnabled });
                }

                if (data.type === "toolbar-collapsed" && typeof data.collapsed === "boolean") {
                    relayState.toolbarCollapsed = data.collapsed;
                    relayState.save();
                    console.log("🧰 Toolbar collapsed:", relayState.toolbarCollapsed);
                    broadcast({ type: "toolbar-collapsed", collapsed: relayState.toolbarCollapsed });
                }

                if (data.type === "merge-download") {
                    console.log("🖼 Merge download signal — cleanup in 3s");
                    setTimeout(runMergeCleanup, 3000);
                }

                if (data.type === "schedule-snapshot") {
                    scheduleGuidelineStore.recordSnapshot(ws, data);
                }

                if (data.type === "dom-scrape") {
                    scheduleDomScrapeStore.recordScrape(data);
                }

            } catch (err) {
                console.error("❌ Bad message:", err);
            }
        });

        ws.on("close", () => {
            console.log("🔌 Client disconnected");
            try {
                scheduleGuidelineStore.releaseIfOwner(ws);
            } catch (err) {
                console.error("❌ releaseIfOwner failed:", err);
            }
        });
    });

    return wss;
}

module.exports = { init, broadcast };