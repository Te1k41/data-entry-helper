// ============================================================
//  routes/due-services.js
//  POST /due-services            — extension posts a fresh scan
//  GET  /due-services            — dashboard reads current state + carrier links
//  POST /due-services/mark-done  — dashboard's "Mark Done" button
//  GET  /due-services/history    — trend data for the dashboard's history chart
// ============================================================

const fs   = require("fs");
const path = require("path");
const { HISTORY_FOLDER } = require("../config");
const { parseTTDate, formatTTDate } = require("../due-date-utils");
const CARRIER_LINKS = require("../carrier-links");
const store = require("../due-services-store");

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

// Extension posts its latest scan of Tradetech's due-soon services here.
//
// IMPORTANT: a fresh scan is merged with what we already have, not a
// blind replace. Without this, marking a service "Done" (which sets a
// LOCAL nextUpdateDate override, not a change on Tradetech itself)
// would get silently wiped out the next time you scan, since Tradetech
// would still report its old, unchanged date. The merge keeps a
// service's "done" override in place until Tradetech's own real date
// catches up to (or passes) it — at which point the real update
// actually happened, so we drop the override and trust Tradetech again.
async function handlePostDueServices(req, res) {
    try {
        const parsed   = await readBody(req);
        const incoming = Array.isArray(parsed.services) ? parsed.services : [];

        const previousByRecord = new Map(store.getAll().map(s => [s.record, s]));

        const merged = incoming.map(fresh => {
            const prev = previousByRecord.get(fresh.record);

            if (prev?.done) {
                const prevDate  = parseTTDate(prev.nextUpdateDate);
                const freshDate = parseTTDate(fresh.nextUpdateDate);

                // Real Tradetech date hasn't caught up to our local
                // "done" target yet — keep showing our override.
                if (prevDate && freshDate && freshDate < prevDate) {
                    return { ...fresh, nextUpdateDate: prev.nextUpdateDate, done: true };
                }
                // Otherwise Tradetech's real date now matches/exceeds
                // it — the update genuinely happened, trust it.
            }

            return fresh;
        });

        store.setAll(merged, new Date().toISOString());
        console.log(`📋 Due-services scan received: ${merged.length} service(s)`);
        store.save();

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, count: merged.length }));
    } catch (err) {
        console.error("❌ Bad /due-services body:", err);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
    }
}

// Dashboard's own fetch — services + their carrier links merged in.
function handleGetDueServices(req, res) {
    const enriched = store.getAll().map(s => ({
        ...s,
        links: CARRIER_LINKS[s.carrier] || { schedule: [], routeMap: [] }
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ asOf: store.getAsOf(), services: enriched }));
}

// Dashboard's "Mark Done" button — sets a LOCAL override so the
// dashboard shows this service as handled with a fresh 15-day-out
// target date, without touching the real record on Tradetech itself.
async function handleMarkDone(req, res) {
    try {
        const { record } = await readBody(req);
        const entry = store.findByRecord(record);

        if (!entry) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Record not found" }));
            return;
        }

        const target = new Date();
        target.setDate(target.getDate() + 15);
        entry.nextUpdateDate = formatTTDate(target);
        entry.done = true;

        store.save();
        console.log(`✅ Marked done: record ${record} → next update ${entry.nextUpdateDate}`);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, nextUpdateDate: entry.nextUpdateDate }));
    } catch (err) {
        console.error("❌ Bad /due-services/mark-done body:", err);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
    }
}

// Trend data for the dashboard's history chart — reads every
// snapshot in history/ and reduces each one to simple counts, so
// the dashboard can plot how the queue has changed scan-over-scan
// without needing the full service list for every past snapshot.
function handleGetHistory(req, res) {
    store.ensureDataFolders();

    try {
        const files = fs.readdirSync(HISTORY_FOLDER)
            .filter(f => f.startsWith("due-services-") && f.endsWith(".json"))
            .sort(); // filenames are timestamp-ordered, so this sorts chronologically

        const MAX_POINTS = 30; // don't make the dashboard parse hundreds of old files
        const recent = files.slice(-MAX_POINTS);

        const points = recent.map(filename => {
            const raw    = fs.readFileSync(path.join(HISTORY_FOLDER, filename), "utf8");
            const parsed = JSON.parse(raw);
            const services = Array.isArray(parsed.services) ? parsed.services : [];

            let overdue = 0, dueSoon = 0, done = 0;
            for (const s of services) {
                const d = parseTTDate(s.nextUpdateDate);
                const days = d ? Math.round((d - new Date().setHours(0,0,0,0)) / 86400000) : null;
                if (s.done) done++;
                else if (days !== null && days < 0) overdue++;
                else if (days !== null && days <= 3) dueSoon++;
            }

            return {
                asOf: parsed.asOf || filename,
                total: services.length,
                overdue, dueSoon, done
            };
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ points }));
    } catch (err) {
        console.error("❌ Could not read history folder:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Could not read history", points: [] }));
    }
}

module.exports = {
    handlePostDueServices,
    handleGetDueServices,
    handleMarkDone,
    handleGetHistory,
};
