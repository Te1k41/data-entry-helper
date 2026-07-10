// ============================================================
//  routes/files.js — GET /find-file, GET /file
//  Used by upload-proof.js to find and fetch today's proof
//  file for a given service code before staging it into
//  Tradetech's Support Document upload input.
// ============================================================

const fs   = require("fs");
const path = require("path");
const { WATCH_FOLDER, PORT } = require("../config");

// Find a downloaded proof file matching this service code + today's date.
function handleFindFile(req, res) {
    const urlObj  = new URL(req.url, `http://localhost:${PORT}`);
    const service = urlObj.searchParams.get("service");

    if (!service) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing service" }));
        return;
    }

    const today   = new Date();
    const mm      = String(today.getMonth() + 1).padStart(2, "0");
    const dd      = String(today.getDate()).padStart(2, "0");
    const yy      = String(today.getFullYear()).slice(-2);
    const dateStr = `${mm}${dd}${yy}`;

    const escaped = service.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^${escaped}-${dateStr}(-\\d+)?\\.[a-z0-9]+$`, "i");

    const files = fs.readdirSync(WATCH_FOLDER).filter(f => pattern.test(f));

    console.log(`🔍 find-file: service=${service} date=${dateStr} → ${files.length} match(es)`);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ files }));
}

// Stream a specific file's raw bytes back to the extension so it can be
// wrapped in a File object and injected into Tradetech's file input.
function handleFile(req, res) {
    const urlObj   = new URL(req.url, `http://localhost:${PORT}`);
    const name     = urlObj.searchParams.get("name");
    const safeName = name ? path.basename(name) : ""; // prevent path traversal
    const filePath = path.join(WATCH_FOLDER, safeName);

    if (!safeName || !fs.existsSync(filePath)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "File not found" }));
        return;
    }

    console.log(`📤 Serving file: ${safeName}`);
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
}

module.exports = { handleFindFile, handleFile };
