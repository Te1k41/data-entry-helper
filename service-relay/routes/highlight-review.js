// ============================================================
//  routes/highlight-review.js
//  POST /highlight-review/submit   — extension's batch capture sends a record's rotation + auto pick
//  GET  /highlight-review/data     — re-scans the receipts folder (importing every PNG), then
//                                    returns everything for the Highlight Review page
//  GET  /highlight-review/image    — ?name=<file> streams one receipt PNG from RECEIPTS_FOLDER
//  POST /highlight-review/verdict  — { key, row: "005"|null }          structured item: the right row
//                                    { key, verdict, correct? }        PNG-only item: right|wrong|none
//                                    { key, clear: true }              removes a verdict
//  GET  /highlight-review/export   — labeled set as a JSON download (?all=1 includes unreviewed);
//                                    also written to HIGHLIGHT_REVIEW_EXPORT_FILE
// ============================================================

const fs   = require("fs");
const path = require("path");
const { RECEIPTS_FOLDER, HIGHLIGHT_REVIEW_FILE, HIGHLIGHT_REVIEW_EXPORT_FILE, PORT } = require("../config");
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
    store.importReceipts();
    sendJson(res, 200, {
        items: store.getAll(),
        receiptsFolder: RECEIPTS_FOLDER,
        dataFile: HIGHLIGHT_REVIEW_FILE,
        exportFile: HIGHLIGHT_REVIEW_EXPORT_FILE,
    });
}

function handleImage(req, res) {
    const name = new URL(req.url, `http://localhost:${PORT}`).searchParams.get("name");
    // basename kills path traversal; the pattern check means only receipt
    // PNGs this feature wrote can ever be served, not arbitrary files.
    const safeName = name ? path.basename(name) : "";
    const filePath = path.join(RECEIPTS_FOLDER, safeName);

    if (!store.RECEIPT_NAME.test(safeName) || !fs.existsSync(filePath)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Receipt not found" }));
        return;
    }
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-cache" });
    fs.createReadStream(filePath).pipe(res);
}

async function handleVerdict(req, res) {
    const body = await readBody(req, res);
    if (!body) return;

    let result;
    if (body.clear === true) {
        result = store.clearTruth(body.key);
    } else if (typeof body.verdict === "string") {
        result = store.setImageVerdict(body.key, body.verdict, body.correct);
    } else if (body.row === null || typeof body.row === "string") {
        result = store.setTruth(body.key, body.row);
    } else {
        return sendJson(res, 400, { error: "send { row } (string SP row, or null for 'no special port'), { verdict, correct? }, or { clear: true }" });
    }

    if (result.error) return sendJson(res, 400, { error: result.error });
    sendJson(res, 200, { success: true });
}

function handleExport(req, res) {
    store.importReceipts();
    const all = new URL(req.url, `http://localhost:${PORT}`).searchParams.get("all") === "1";
    const out = store.buildExport({ all });
    console.log(`📤 Highlight review export: ${out.summary.reviewed} reviewed, ${out.summary.disagree} disagree → ${HIGHLIGHT_REVIEW_EXPORT_FILE}`);
    res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="highlight-review-export.json"',
    });
    res.end(JSON.stringify(out, null, 2));
}

module.exports = { handleSubmit, handleGetData, handleImage, handleVerdict, handleExport };
