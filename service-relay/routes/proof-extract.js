// ============================================================
//  routes/proof-extract.js
//  POST /proof/extract          → parse a proof file, return
//                                  preview rows (nothing written)
//  POST /proof/extract/confirm  → write confirmed rows to
//                                  extracted-proofs.xlsx, scoped
//                                  to the currently active
//                                  guideline's service (overwrites
//                                  each time, same "current state
//                                  only" model as the guideline)
// ============================================================

const fs   = require("fs");
const path = require("path");

const { WATCH_FOLDER } = require("../config");
const { extractProof, saveProofRows, cacheRows } = require("../proof-extract");
const scheduleGuidelineStore = require("../schedule-guideline-store");
const { readJsonBody } = require("../read-json-body");

async function handleExtract(req, res) {
    try {
        const { file } = await readJsonBody(req);
        if (!file) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing file" }));
            return;
        }

        const guideline = scheduleGuidelineStore.getCurrent();
        if (!guideline) {
            res.writeHead(409, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "No active guideline — open the service's schedule page in Tradetech first." }));
            return;
        }

        const safeName = path.basename(file); // prevent path traversal
        const filePath = path.join(WATCH_FOLDER, safeName);
        if (!fs.existsSync(filePath)) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "File not found" }));
            return;
        }

        const rows        = await extractProof(filePath, guideline.operator);
        const checkedRows = scheduleGuidelineStore.matchRows(rows);
        cacheRows(checkedRows);
        console.log(`📄 /proof/extract: service=${guideline.service} operator=${guideline.operator} file=${safeName} → ${rows.length} row(s)`);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ service: guideline.service, operator: guideline.operator, rows: checkedRows }));
    } catch (err) {
        console.error("❌ /proof/extract failed:", err);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
    }
}

// Rows are whatever the operator confirmed after reviewing the
// /proof/extract preview — this never writes anything unseen.
async function handleConfirm(req, res) {
    try {
        const { rows } = await readJsonBody(req);
        if (!Array.isArray(rows)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing rows" }));
            return;
        }

        const guideline = scheduleGuidelineStore.getCurrent();
        if (!guideline) {
            res.writeHead(409, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "No active guideline — open the service's schedule page in Tradetech first." }));
            return;
        }

        const vessels = saveProofRows(guideline.service, rows);
        if (vessels === null) {
            res.writeHead(409, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "extracted-proofs.xlsx is open in Excel — close it and try again." }));
            return;
        }

        console.log(`✅ /proof/extract/confirm: wrote ${vessels} vessel(s) for service=${guideline.service}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, vessels }));
    } catch (err) {
        console.error("❌ /proof/extract/confirm failed:", err);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
    }
}

module.exports = { handleExtract, handleConfirm };
