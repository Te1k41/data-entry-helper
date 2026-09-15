// ============================================================
//  activity-log-store.js
//  Records WHEN each "Mark Done" click happened, so the
//  dashboard can chart real daily throughput — how many
//  services you actually cleared each day — rather than
//  inferring it from due-services snapshots (which would
//  double-count a service on every day it stays flagged done).
// ============================================================

const fs = require("fs");
const { ACTIVITY_LOG_FILE, DATA_FOLDER } = require("./config");
const { writeFileAtomicSync } = require("./atomic-write");

function ensureDataFolder() {
    if (!fs.existsSync(DATA_FOLDER)) fs.mkdirSync(DATA_FOLDER, { recursive: true });
}

function loadLog() {
    ensureDataFolder();
    if (!fs.existsSync(ACTIVITY_LOG_FILE)) return [];

    try {
        const raw = fs.readFileSync(ACTIVITY_LOG_FILE, "utf8");
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.error("❌ Could not read activity-log.json — starting empty:", err.message);
        return [];
    }
}

// Appends one entry: { record, service, at: ISOString }
function logDone(record, service) {
    ensureDataFolder();
    const log = loadLog();
    log.push({ record, service, at: new Date().toISOString() });
    writeFileAtomicSync(ACTIVITY_LOG_FILE, JSON.stringify(log, null, 2));
}

// Removes the most recently logged Mark Done for a record — the
// counterpart to a Mark Done -> Undo click pair, so an undone click
// doesn't still count toward the throughput chart. Only removes ONE
// entry (the latest), not every entry ever logged for this record,
// since the same record can legitimately be marked done again on a
// genuinely later day.
function undoLastDone(record) {
    ensureDataFolder();
    const log = loadLog();

    for (let i = log.length - 1; i >= 0; i--) {
        if (log[i].record === record) {
            log.splice(i, 1);
            writeFileAtomicSync(ACTIVITY_LOG_FILE, JSON.stringify(log, null, 2));
            return true;
        }
    }
    return false; // nothing logged for this record — nothing to undo
}

module.exports = { loadLog, logDone, undoLastDone };
