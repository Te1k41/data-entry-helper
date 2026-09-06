// ============================================================
//  routes/schedule-guideline.js — GET /schedule-guideline
//  Read-only lookup of the one currently active guideline, for
//  anything that just needs a quick HTTP check instead of
//  listening on the WebSocket.
// ============================================================

const scheduleGuidelineStore = require("../schedule-guideline-store");

function handleGetGuideline(req, res) {
    const guideline = scheduleGuidelineStore.getCurrent();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ guideline }));
}

module.exports = { handleGetGuideline };
