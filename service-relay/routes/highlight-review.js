// ============================================================
//  routes/highlight-review.js
//  POST /highlight-review/submit   — extension's batch capture sends a record's rotation + auto pick
//  GET  /highlight-review/data     — everything, for the Highlight Review page
//  POST /highlight-review/verdict  — { record, row: "005"|null } sets truth; { record, clear: true } removes it
//  GET  /highlight-review/export   — labeled set as a JSON download (?all=1 includes unreviewed);
//                                    also written to HIGHLIGHT_REVIEW_EXPORT_FILE
// ============================================================

const { HIGHLIGHT_REVIEW_FILE, HIGHLIGHT_REVIEW_EXPORT_FILE, PORT } = require("../config");
const { readJsonBody } = require("../read-json-body");
const store = require("../highlight-review-store");

function sendJson(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
}

async function readBody(req, res) {
    try {
        return await readJsonBody(req);
    } catch (err) {
        sendJson(res, err.statusCode || 400, { error: err.message });
        return null;
    }
}

async function handleSubmit(req, res) {
    const body = await readBody(req, res);
    if (!body) return;
    const result = store.submitCapture(body);
    if (result.error) return sendJson(res, 400, { error: result.error });
    sendJson(res, 200, { success: true });
}

function handleGetData(req, res) {
    sendJson(res, 200, {
        items: store.getAll(),
        dataFile: HIGHLIGHT_REVIEW_FILE,
        exportFile: HIGHLIGHT_REVIEW_EXPORT_FILE,
    });
}

async function handleVerdict(req, res) {
    const body = await readBody(req, res);
    if (!body) return;

    let result;
    if (body.clear === true) {
        result = store.clearTruth(body.record);
    } else if (body.row === null || typeof body.row === "string") {
        result = store.setTruth(body.record, body.row);
    } else {
        return sendJson(res, 400, { error: "row must be a string SP row number, or null for 'no special port'" });
    }

    if (result.error) return sendJson(res, 400, { error: result.error });
    sendJson(res, 200, { success: true });
}

function handleExport(req, res) {
    const all = new URL(req.url, `http://localhost:${PORT}`).searchParams.get("all") === "1";
    const out = store.buildExport({ all });
    console.log(`📤 Highlight review export: ${out.summary.reviewed} reviewed, ${out.summary.disagree} disagree → ${HIGHLIGHT_REVIEW_EXPORT_FILE}`);
    res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="highlight-review-export.json"',
    });
    res.end(JSON.stringify(out, null, 2));
}

module.exports = { handleSubmit, handleGetData, handleVerdict, handleExport };
