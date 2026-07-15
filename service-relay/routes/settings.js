// ============================================================
//  routes/settings.js
//  GET  /settings  → current settings as JSON (also used by
//                     the extension itself, to read
//                     assignedToName instead of it being
//                     hardcoded in due-service-scanner.js)
//  POST /settings  → save new settings
// ============================================================

const settingsStore = require("../settings-store");

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", chunk => { body += chunk; });
        req.on("end", () => {
            try {
                resolve(JSON.parse(body));
            } catch (err) {
                reject(err);
            }
        });
    });
}

function handleGetSettings(req, res) {
    const settings = settingsStore.load();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(settings));
}

async function handlePostSettings(req, res) {
    try {
        const body = await readBody(req);

        // Only accept known fields — don't let an unexpected payload
        // write arbitrary keys into settings.json.
        const allowed = {};
        if (typeof body.watchFolder === "string")    allowed.watchFolder    = body.watchFolder.trim();
        if (typeof body.dataFolder === "string")     allowed.dataFolder     = body.dataFolder.trim();
        if (typeof body.assignedToName === "string") allowed.assignedToName = body.assignedToName.trim();

        const saved = settingsStore.save(allowed);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            success: true,
            settings: saved,
            note: "Folder path changes need a server restart to take effect. Your name updates immediately."
        }));
    } catch (err) {
        console.error("❌ Bad /settings body:", err);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
    }
}

module.exports = { handleGetSettings, handlePostSettings };