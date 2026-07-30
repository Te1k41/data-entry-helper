// ============================================================
//  routes/result.js
//  POST /result/rebuild           → regenerate result.xlsx from
//                                    the last extraction (after
//                                    you've learned new port
//                                    mappings, without re-parsing
//                                    the proof file)
//  POST /port-dictionary/import   → read result.xlsx's "Ports"
//                                    sheet, learn any rows you've
//                                    filled in a port code for,
//                                    then rebuild
//  GET  /result                   → Vessels + Ports sheets as
//                                    JSON, for the dashboard's
//                                    ports.html
//  POST /port-dictionary/learn-batch → learn mappings submitted
//                                    directly from ports.html
//                                    (bypasses result.xlsx entirely
//                                    — no risk of a rebuild wiping
//                                    an unsaved manual edit there)
// ============================================================

const portDictionary = require("../port-dictionary");
const { buildResult, importUnmappedFromResult, readResultForFill } = require("../build-result");
const { getLastRows, recalcFromWatchFolder } = require("../proof-extract");

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

// Scans the watch folder itself for the active guideline's proof file and
// reruns the whole pipeline against it — no prior /proof/extract call
// needed, so a guideline change, a newly learned port mapping, or a
// parser fix all get picked up fresh.
async function handleRebuild(req, res) {
    try {
        await readBody(req);
    } catch (err) {
        // no body / not JSON — fine, nothing read from it anyway
    }

    console.log("🔄 /result/rebuild called");

    try {
        const { result } = await recalcFromWatchFolder();
        console.log(`✅ /result/rebuild done — unmappedCount=${result?.unmappedCount ?? "?"}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, result }));
    } catch (err) {
        console.error("❌ /result/rebuild failed:", err);
        const status = /No active guideline|No proof file found/.test(err.message) ? 409 : 400;
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
    }
}

function handleImportMappings(req, res) {
    try {
        const learned = importUnmappedFromResult();
        console.log(`🧠 Imported ${learned} port mapping(s) from result.xlsx`);

        const rows = getLastRows();
        const result = rows ? buildResult(rows) : null;

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, learned, result }));
    } catch (err) {
        console.error("❌ /port-dictionary/import failed:", err);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
    }
}

function handleGetResult(req, res) {
    const data = readResultForFill();
    if (!data) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No result.xlsx built yet — run /proof/extract then /result/rebuild first." }));
        return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
}

async function handleLearnBatch(req, res) {
    try {
        const { mappings } = await readBody(req);
        if (!Array.isArray(mappings)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing mappings array" }));
            return;
        }

        let learned = 0;
        for (const m of mappings) {
            if (!m.operator || !m.rawLabel || !m.portCode) continue;
            portDictionary.learn(m.operator, m.rawLabel, m.portCode);
            learned++;
        }

        const rows = getLastRows();
        const result = rows ? buildResult(rows) : null;

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, learned, result }));
    } catch (err) {
        console.error("❌ /port-dictionary/learn-batch failed:", err);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
    }
}

module.exports = { handleRebuild, handleImportMappings, handleGetResult, handleLearnBatch };
