// ============================================================
//  due-services-store.js
//  In-memory store of the last scan reported by the extension's
//  due-service-scanner content script, plus disk persistence so
//  a server restart doesn't lose it. Exposes get/set functions
//  rather than a raw mutable array, since the whole array gets
//  wholesale-replaced (not just mutated) on every new scan.
// ============================================================

const fs   = require("fs");
const path = require("path");
const { DATA_FOLDER, HISTORY_FOLDER, DUE_SERVICES_FILE } = require("./config");
const { writeFileAtomicSync } = require("./atomic-write");

let dueServices     = []; // [{ record, service, carrier, assignedTo, nextUpdateDate, done? }]
let dueServicesAsOf = null; // ISO timestamp of the last scan received

function ensureDataFolders() {
    if (!fs.existsSync(DATA_FOLDER))    fs.mkdirSync(DATA_FOLDER, { recursive: true });
    if (!fs.existsSync(HISTORY_FOLDER)) fs.mkdirSync(HISTORY_FOLDER, { recursive: true });
}

function timestampForFilename() {
    const now  = new Date();
    const yyyy = now.getFullYear();
    const mm   = String(now.getMonth() + 1).padStart(2, "0");
    const dd   = String(now.getDate()).padStart(2, "0");
    const hh   = String(now.getHours()).padStart(2, "0");
    const min  = String(now.getMinutes()).padStart(2, "0");
    const ss   = String(now.getSeconds()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}_${hh}${min}${ss}`;
}

// Writes the latest scan to due-services.json (overwritten each time)
// AND to a uniquely-timestamped file in history/ (never overwritten) —
// so the dashboard always has a fast "current state" file to read, while
// nothing is ever lost for future trend/history features.
function save() {
    ensureDataFolders();

    const payload = JSON.stringify({ asOf: dueServicesAsOf, services: dueServices }, null, 2);

    writeFileAtomicSync(DUE_SERVICES_FILE, payload);

    const historyPath = path.join(HISTORY_FOLDER, `due-services-${timestampForFilename()}.json`);
    writeFileAtomicSync(historyPath, payload);

    console.log(`💾 Saved due-services (${dueServices.length} service(s)) → ${DUE_SERVICES_FILE}`);
    console.log(`💾 History snapshot → ${historyPath}`);
}

// On startup, load whatever was last saved so the dashboard has data
// immediately, even before the extension scans again this session.
function loadFromDisk() {
    ensureDataFolders();

    if (!fs.existsSync(DUE_SERVICES_FILE)) {
        console.log("📂 No saved due-services.json yet — starting empty");
        return;
    }

    try {
        const raw    = fs.readFileSync(DUE_SERVICES_FILE, "utf8");
        const parsed = JSON.parse(raw);
        dueServices     = Array.isArray(parsed.services) ? parsed.services : [];
        dueServicesAsOf = parsed.asOf || null;
        console.log(`📂 Loaded ${dueServices.length} saved service(s) from disk (as of ${dueServicesAsOf})`);
    } catch (err) {
        console.error("❌ Could not load due-services.json — starting empty:", err.message);
    }
}

// Tradetech's scan has no idea a record was marked done locally — it
// just reports whatever's really due. Without carrying the local
// override forward here, every rescan (due-service-scanner-relay.js
// runs one automatically per calendar day, or any manual "Scan & Save")
// would silently erase Mark Done: `done`, the 15-day-out fake
// nextUpdateDate, and the pre-done snapshot Undo depends on. Only
// records still `done` in the OUTGOING state carry anything forward —
// everything else (new records, records that were never marked done,
// records no longer present in the scan) passes through untouched.
function setAll(services, asOf) {
    const previousByRecord = new Map(dueServices.map(s => [s.record, s]));

    dueServices = services.map(incoming => {
        const previous = previousByRecord.get(incoming.record);
        if (!previous || !previous.done) return incoming;

        const merged = { ...incoming, done: previous.done, nextUpdateDate: previous.nextUpdateDate };
        if (previous._preDoneSnapshot) merged._preDoneSnapshot = previous._preDoneSnapshot;
        return merged;
    });

    dueServicesAsOf = asOf;
}

module.exports = {
    getAll:        () => dueServices,
    getAsOf:       () => dueServicesAsOf,
    setAll,
    findByRecord:  (record) => dueServices.find(s => s.record === record),
    ensureDataFolders,
    save,
    loadFromDisk,
};
