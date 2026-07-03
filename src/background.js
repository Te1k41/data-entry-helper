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

// ── Download Rename ──────────────────────────────────────────
chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
    // server-side watcher handles renaming now
    suggest({ filename: downloadItem.filename });
    return true;
});