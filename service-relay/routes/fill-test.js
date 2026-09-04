// ============================================================
//  routes/fill-test.js
//  POST /fill-test/run → run the standalone Fill calculation
//                        against the currently saved guideline.
// ============================================================

const scheduleGuidelineStore = require("../schedule-guideline-store");
const scheduleDomScrapeStore = require("../schedule-dom-scrape-store");
const portDictionary = require("../port-dictionary");
const vesselDictionary = require("../vessel-dictionary");
const { computeFill } = require("../fill-calc");
const { readJsonBody, requestError } = require("../read-json-body");

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

function validateBody(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw requestError("request body must be a JSON object", 400);
    }
    if (hasOwn(body, "proofs") && !Array.isArray(body.proofs)) {
        throw requestError("proofs must be an array", 400);
    }
    if (Array.isArray(body.proofs)) {
        const invalidIndex = body.proofs.findIndex(proof => !proof || typeof proof !== "object" || Array.isArray(proof));
        if (invalidIndex !== -1) {
            throw requestError(`proofs[${invalidIndex}] must be an object`, 400);
        }
    }
}

async function handleFillTestRun(req, res) {
    try {
        const body = await readJsonBody(req);
        validateBody(body);
        scheduleGuidelineStore.loadFromDisk();
        const guideline = scheduleGuidelineStore.getCurrent();
        if (!guideline) {
            res.writeHead(409, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "no guideline currently captured" }));
            return;
        }

        if (!Array.isArray(guideline.ports) || guideline.ports.length === 0) {
            res.writeHead(422, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "guideline is incomplete -- missing ports" }));
            return;
        }

        const proofsProvided = hasOwn(body, "proofs");
        let proofs = body.proofs || [];
        let proofSource = proofsProvided ? "request-body" : "none";
        let proofFile = null;
        let proofLoadWarning = null;
        if (!proofsProvided) {
            // DOM-scrape only -- reads the operator's own real HTML table
            // directly, no pixel-recognition risk at all. The on-demand
            // OCR/file-search fallback that used to sit here was removed
            // now that schedule data comes fully from DOM scrapes.
            scheduleDomScrapeStore.loadFromDisk();
            const domScrape = scheduleDomScrapeStore.getScrape(guideline.service);
            if (domScrape) {
                proofs = domScrape.rows;
                proofSource = "dom-scrape";
                proofFile = null;
                if (domScrape.incomplete) {
                    proofLoadWarning = `DOM scrape for ${guideline.service} is incomplete (missing ${domScrape.missingDirection || "a direction"}) -- results may be partial`;
                }
            } else {
                proofLoadWarning = `no DOM scrape found for service ${guideline.service || "(blank)"}`;
            }
        }

        portDictionary.loadFromDisk();
        vesselDictionary.loadFromDisk();
        const result = computeFill(guideline, proofs || []);
        if (proofLoadWarning) result.warnings.push(proofLoadWarning);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ...result, proofSource, proofCount: proofs.length, proofFile }));
    } catch (err) {
        const status = err.statusCode || 500;
        if (status >= 500) console.error("❌ /fill-test/run failed:", err);
        else console.warn(`⚠ /fill-test/run rejected (${status}): ${err.message}`);
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err && err.message ? err.message : String(err) }));
    }
}

module.exports = { handleFillTestRun };
