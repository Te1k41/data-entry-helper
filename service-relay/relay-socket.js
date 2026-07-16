// ============================================================
//  relay-socket.js
//  WebSocket layer: broadcasts service-code and renaming-toggle
//  state to every connected tab/browser, and handles the
//  merge-download signal that triggers cleanup.
// ============================================================

const WebSocket = require("ws");
const relayState = require("./relay-state");
const { runMergeCleanup } = require("./merge-cleanup");

let wss = null;

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
    wss = new WebSocket.Server({ server: httpServer });

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

                if (data.type === "service") {
                    relayState.currentServiceCode = data.code;
                    console.log("📥 Service code:", relayState.currentServiceCode);
                    broadcast({ type: "service", code: relayState.currentServiceCode });
                }

                if (data.type === "renaming") {
                    relayState.renamingEnabled = data.enabled;
                    console.log("🔄 Renaming enabled:", relayState.renamingEnabled);
                    broadcast({ type: "renaming", enabled: relayState.renamingEnabled });
                }

                if (data.type === "toolbar-collapsed") {
                    relayState.toolbarCollapsed = data.collapsed;
                    console.log("🧰 Toolbar collapsed:", relayState.toolbarCollapsed);
                    broadcast({ type: "toolbar-collapsed", collapsed: relayState.toolbarCollapsed });
                }

                if (data.type === "merge-download") {
                    console.log("🖼 Merge download signal — cleanup in 3s");
                    setTimeout(runMergeCleanup, 3000);
                }

            } catch (err) {
                console.error("❌ Bad message:", err);
            }
        });

        ws.on("close", () => {
            console.log("🔌 Client disconnected");
        });
    });

    return wss;
}

module.exports = { init, broadcast };