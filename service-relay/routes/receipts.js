// ============================================================
//  routes/receipts.js — POST /save-receipt
//  Writes a batch-captured Rotation Receipt PNG straight to disk in
//  RECEIPTS_FOLDER (a dedicated app-data folder, NOT the Downloads
//  folder download-watcher.js watches — see config.js). Used by the
//  extension's Rotation Receipt Capture feature instead of Chrome's
//  downloads API: many chrome.downloads.download() calls fired
//  back-to-back from background tabs during a batch run were still
//  visible in the browser's download shelf/history, which wasn't
//  wanted for records visited automatically rather than by hand. A
//  plain server-side file write has neither of those side effects.
// ============================================================

const fs   = require("fs");
const path = require("path");
const { RECEIPTS_FOLDER } = require("../config");
const { readJsonBody } = require("../read-json-body");

const DATA_URL_PATTERN = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/;

async function handleSaveReceipt(req, res) {
    let body;
    try {
        body = await readJsonBody(req);
    } catch (err) {
        res.writeHead(err.statusCode || 400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
        return;
    }

    const { filename, dataUrl } = body;

    // path.basename strips any directory component the caller sent
    // (e.g. an old "rotation-receipts/xxx.png"-shaped filename) AND
    // prevents path traversal — same defensive pattern routes/files.js
    // already uses for /file and /open-file.
    const safeName = filename ? path.basename(String(filename)) : "";
    const match = typeof dataUrl === "string" ? dataUrl.match(DATA_URL_PATTERN) : null;

    if (!safeName || !match) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing/invalid filename or dataUrl (expected a data:image/png;base64,... URL)" }));
        return;
    }

    try {
        fs.mkdirSync(RECEIPTS_FOLDER, { recursive: true });
        fs.writeFileSync(path.join(RECEIPTS_FOLDER, safeName), Buffer.from(match[1], "base64"));
    } catch (err) {
        console.error("❌ Failed to save receipt:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
        return;
    }

    console.log(`🧾 Saved receipt: ${safeName}`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, folder: RECEIPTS_FOLDER }));
}

module.exports = { handleSaveReceipt };
