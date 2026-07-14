// ============================================================
//  routes/due-services.js
//  POST /due-services              — extension posts a fresh scan
//  GET  /due-services               — dashboard reads FULL state + carrier links
//  GET  /due-services/current-batch — dashboard's default view: the stored batch
//  POST /due-services/next-batch    — manual "get me the next batch" button
//  POST /due-services/mark-done     — dashboard's "Mark Done" button
//  GET  /due-services/history       — trend data for the dashboard's history chart
// ============================================================

const fs   = require("fs");
const path = require("path");
const { HISTORY_FOLDER } = require("../config");
const { parseTTDate, formatTTDate } = require("../due-date-utils");
const CARRIER_LINKS = require("../carrier-links");
const store = require("../due-services-store");
const activityLog = require("../activity-log-store");
const currentBatchStore = require("../current-batch-store");

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
        const parsed  = await readBody(req);
        const incoming = Array.isArray(parsed.services) ? parsed.services : [];
        console.log(`📋 Due-services scan received: ${incoming.length} total service(s) from extension — storing ALL of them`);

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

// Dashboard's default view — the STORED batch, not a live recompute.
// Enriched with carrier links, and each record's done-status/date is
// refreshed from the real due-services data before being returned
// (so marking done elsewhere is reflected immediately without
// needing a whole new batch to be computed).
function handleGetCurrentBatch(req, res) {
    const all = store.getAll();
    const batch = currentBatchStore.getCurrentBatch(all);
    const enriched = batch.map(s => ({
        ...s,
        links: CARRIER_LINKS[s.carrier] || { schedule: [], routeMap: [] }
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ services: enriched }));
}

// Manual escape hatch — forces a fresh batch right now, regardless of
// whether the current one is fully done yet.
function handleNextBatch(req, res) {
    const all = store.getAll();
    const batch = currentBatchStore.advanceToNextBatch(all);
    const enriched = batch.map(s => ({
        ...s,
        links: CARRIER_LINKS[s.carrier] || { schedule: [], routeMap: [] }
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ services: enriched }));
}

// Dashboard's "Mark Done" button — sets a LOCAL override so the
// dashboard shows this service as handled with a fresh 15-day-out
// target date, without touching the real record on Tradetech itself.
// Saves a snapshot of the PRE-done state on the entry itself so a
// later "Undo" click can restore it exactly, including if you'd
// re-scanned in between (the merge logic in handlePostDueServices
// already knows how to preserve a `done` override — this snapshot
// rides along with it the same way).
async function handleMarkDone(req, res) {
    try {
        const { record } = await readBody(req);
        const entry = store.findByRecord(record);

        if (!entry) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Record not found" }));
            return;
        }

        if (!entry.done) {
            // Only snapshot on the FIRST mark-done — clicking it again
            // on an already-done item (shouldn't normally happen from
            // the UI, but just in case) won't overwrite a real undo
            // point with an already-modified state.
            entry._preDoneSnapshot = {
                nextUpdateDate: entry.nextUpdateDate,
                done:           entry.done || false
            };
        }

        const target = new Date();
        target.setDate(target.getDate() + 15);
        entry.nextUpdateDate = formatTTDate(target);
        entry.done = true;

        store.save();
        activityLog.logDone(record, entry.service);
        console.log(`✅ Marked done: record ${record} → next update ${entry.nextUpdateDate}`);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, nextUpdateDate: entry.nextUpdateDate }));
    } catch (err) {
        console.error("❌ Bad /due-services/mark-done body:", err);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
    }
}

// Dashboard's "Undo" button — restores whatever the entry looked like
// right before the most recent Mark Done click, using the snapshot
// saved above. Only works once per mark-done (the snapshot is deleted
// after a successful undo), and only if nothing's overwritten it
// since (e.g. a fresh Tradetech scan that genuinely updated the date).
async function handleUndoDone(req, res) {
    try {
        const { record } = await readBody(req);
        const entry = store.findByRecord(record);

        if (!entry) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Record not found" }));
            return;
        }

        if (!entry._preDoneSnapshot) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Nothing to undo for this record" }));
            return;
        }

        entry.nextUpdateDate = entry._preDoneSnapshot.nextUpdateDate;
        entry.done           = entry._preDoneSnapshot.done;
        delete entry._preDoneSnapshot;

        store.save();
        console.log(`↩️ Undid mark-done: record ${record} → restored ${entry.nextUpdateDate}`);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, nextUpdateDate: entry.nextUpdateDate, done: entry.done }));
    } catch (err) {
        console.error("❌ Bad /due-services/undo-done body:", err);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
    }
}

// Trend data for the dashboard's history chart — reads history/
// (now one file per calendar day, e.g. due-services-2026-07-10.json —
// same-day rescans overwrite that day's file rather than piling up)
// and reduces each day to simple counts for the chart.
function handleGetHistory(req, res) {
    store.ensureDataFolders();

    try {
        const DAYS = 30;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const points = [];
        for (let i = DAYS - 1; i >= 0; i--) {
            const day = new Date(today);
            day.setDate(day.getDate() - i);
            const dayKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;

            const filePath = path.join(HISTORY_FOLDER, `due-services-${dayKey}.json`);

            if (!fs.existsSync(filePath)) {
                // no scan that day — still emit a point so the chart has a
                // real gap instead of silently compressing the timeline
                points.push({ date: dayKey, asOf: null, total: null, overdue: 0, dueSoon: 0, done: 0, noScan: true });
                continue;
            }

            const raw    = fs.readFileSync(filePath, "utf8");
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

            points.push({
                date: dayKey,
                asOf: parsed.asOf || dayKey,
                total: services.length,
                overdue, dueSoon, done,
                noScan: false
            });
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ points }));
    } catch (err) {
        console.error("❌ Could not read history folder:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Could not read history", points: [] }));
    }
}

// Daily "how many did I actually mark done" chart data — built from
// the real activity log (timestamped Mark Done clicks), not inferred
// from due-services snapshots, since a service can stay flagged
// "done" across many days and would otherwise get counted every day
// it appears rather than just the day it was actually cleared.
function handleGetActivity(req, res) {
    try {
        const log = activityLog.loadLog();

        const countsByDay = new Map(); // "YYYY-MM-DD" → count
        for (const entry of log) {
            const day = (entry.at || "").slice(0, 10); // ISO date prefix
            if (!day) continue;
            countsByDay.set(day, (countsByDay.get(day) || 0) + 1);
        }

        const DAYS = 30;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const points = [];
        for (let i = DAYS - 1; i >= 0; i--) {
            const day = new Date(today);
            day.setDate(day.getDate() - i);
            const dayKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
            const dow = day.getDay(); // 0 = Sunday, 6 = Saturday
            points.push({ date: dayKey, count: countsByDay.get(dayKey) || 0, isWeekend: dow === 0 || dow === 6 });
        }

        // Current streak: consecutive WEEKDAYS with at least 1 done,
        // counting backwards from today. Weekends are skipped entirely —
        // they neither extend nor break the streak, so a Friday → Monday
        // stretch of activity still counts as unbroken. If today is a
        // weekday with 0 done so far, start counting from the prior day
        // instead — a streak isn't "broken" just because you haven't
        // gotten to today's work yet.
        let streak = 0;
        let startIdx = points.length - 1;
        if (!points[startIdx].isWeekend && points[startIdx].count === 0) startIdx--;

        for (let i = startIdx; i >= 0; i--) {
            if (points[i].isWeekend) continue; // doesn't count for or against
            if (points[i].count > 0) streak++;
            else break;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ points, streak }));
    } catch (err) {
        console.error("❌ Could not read activity log:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Could not read activity log", points: [], streak: 0 }));
    }
}

module.exports = {
    handlePostDueServices,
    handleGetDueServices,
    handleGetCurrentBatch,
    handleNextBatch,
    handleMarkDone,
    handleUndoDone,
    handleGetHistory,
    handleGetActivity,
};