// ============================================================
//  routes/vessel-dictionary.js
//  GET  /vessel-dictionary         → the whole { vesselName: lloydsCode }
//                                     map, for the dashboard's vessels.html
//                                     and the extension's Fill-From-Result
//  POST /vessel-dictionary/learn-batch → save entries submitted from
//                                     vessels.html
//  POST /vessel-dictionary/remove  → delete one entry (typo cleanup)
// ============================================================

const vesselDictionary = require("../vessel-dictionary");
const { readJsonBody } = require("../read-json-body");

function handleGetAll(req, res) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(vesselDictionary.getAll()));
}

async function handleLearnBatch(req, res) {
    try {
        const { entries } = await readJsonBody(req);
        if (!Array.isArray(entries)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing entries array" }));
            return;
        }

        let learned = 0;
        for (const e of entries) {
            if (!e.vessel || !e.lloydsCode) continue;
            vesselDictionary.learn(e.vessel, e.lloydsCode);
            learned++;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, learned }));
    } catch (err) {
        console.error("❌ /vessel-dictionary/learn-batch failed:", err);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
    }
}

async function handleRemove(req, res) {
    try {
        const { vessel } = await readJsonBody(req);
        if (!vessel) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing vessel" }));
            return;
        }
        vesselDictionary.remove(vessel);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
    } catch (err) {
        console.error("❌ /vessel-dictionary/remove failed:", err);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
    }
}

module.exports = { handleGetAll, handleLearnBatch, handleRemove };
