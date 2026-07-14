// ============================================================
//  current-batch-store.js
//  Owns the "current batch" — a SNAPSHOT of services computed
//  once by due-services-trim.js's computeBatch(), saved to disk,
//  and shown as-is on the dashboard until every service in it
//  is marked done. Only then (or via the manual "Next Batch"
//  button) does a fresh batch get computed and saved over it.
//
//  This is deliberately NOT a live filter recomputed on every
//  page load — that was the earlier, confusing version where
//  the visible set could shift mid-session. Now: compute once,
//  work through it, done.
// ============================================================

const fs = require("fs");
const { CURRENT_BATCH_FILE, DATA_FOLDER } = require("./config");
const { computeBatch } = require("./due-services-trim");

function ensureDataFolder() {
    if (!fs.existsSync(DATA_FOLDER)) fs.mkdirSync(DATA_FOLDER, { recursive: true });
}

function loadBatch() {
    ensureDataFolder();
    if (!fs.existsSync(CURRENT_BATCH_FILE)) return null;

    try {
        const raw = fs.readFileSync(CURRENT_BATCH_FILE, "utf8");
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed.records) ? parsed : null;
    } catch (err) {
        console.error("❌ Could not read current-batch.json:", err.message);
        return null;
    }
}

function saveBatch(records) {
    ensureDataFolder();
    const payload = { createdAt: new Date().toISOString(), records };
    fs.writeFileSync(CURRENT_BATCH_FILE, JSON.stringify(payload, null, 2));
    console.log(`📦 Saved current-batch.json — ${records.length} record(s)`);
}

// Given the FULL, current due-services list (source of truth for
// done/nextUpdateDate), returns the batch that should be shown right
// now — either the existing stored batch (refreshed with live
// done-status from allServices), or a freshly computed one if the
// stored batch doesn't exist yet or is now fully done.
function getCurrentBatch(allServices) {
    const byRecord = new Map(allServices.map(s => [s.record, s]));
    const stored = loadBatch();

    if (stored && stored.records.length > 0) {
        // Refresh each stored record's live done-status/date from the
        // real due-services data (in case something changed), dropping
        // any record that no longer exists at all.
        const refreshed = stored.records
            .map(r => byRecord.get(r))
            .filter(Boolean);

        const allDone = refreshed.length > 0 && refreshed.every(s => s.done);

        if (!allDone && refreshed.length > 0) {
            return refreshed; // keep showing the same batch, just with live done-status
        }
        console.log("✅ Current batch is fully done — computing the next one");
    } else {
        console.log("📦 No current batch yet — computing the first one");
    }

    return advanceToNextBatch(allServices);
}

// Forces a fresh batch regardless of whether the current one is done
// — used by the manual "Next Batch" button, and internally once the
// current batch is confirmed fully done.
function advanceToNextBatch(allServices) {
    // Exclude anything already done from the pool — completed work
    // shouldn't be re-selected into a new batch.
    const pool = allServices.filter(s => !s.done);
    const batch = computeBatch(pool);
    saveBatch(batch.map(s => s.record));
    return batch;
}

module.exports = { getCurrentBatch, advanceToNextBatch };