// ============================================================
//  proof-extract.js — pick the right parser for a proof file
//  and run it. Dispatched by carrier/vessel-operator code (e.g.
//  "MSK"), not service code — the operator is what determines
//  how a proof is laid out. See proof-parsers/ for the actual
//  per-operator parsing logic. Also owns the extracted-proofs.xlsx
//  writer, shared by the manual /proof/extract/confirm route and
//  download-watcher.js's auto-fire-after-rename path.
// ============================================================

const fs      = require("fs");
const path    = require("path");
const XLSX    = require("xlsx");
const parsers = require("./proof-parsers");
const { DATA_FOLDER, WATCH_FOLDER, WATCH_EXTS } = require("./config");
const scheduleGuidelineStore = require("./schedule-guideline-store");
const { buildResult } = require("./build-result");

const MASTER_FILE  = path.join(DATA_FOLDER, "extracted-proofs.xlsx");
const MASTER_SHEET = "Proofs";

// Last extraction's rows, cached so /result/rebuild can regenerate
// result.xlsx after you learn new port mappings without re-parsing
// the proof file from scratch.
let lastRows = null;

async function extractProof(filePath, operator) {
    const ext    = path.extname(filePath).toLowerCase();
    const parser = parsers.getParser(operator);

    if (ext === ".xlsx" || ext === ".xls") return parser.extractExcel(filePath);
    if (ext === ".pdf") return parser.extractPdf(filePath);
    if (ext === ".txt") return parser.extractText(filePath);

    if (ext === ".png" || ext === ".jpg" || ext === ".jpeg") {
        // ponytail: no OCR/vision wired up — image proofs vary per operator
        // just as much as excel/pdf ones do, so this needs a real sample
        // before it's worth automating. Add an extractImage() to that
        // operator's parser module when one shows up.
        if (typeof parser.extractImage === "function") return parser.extractImage(filePath);
        throw new Error(`Image proofs (${ext}) aren't auto-extractable yet for operator "${operator}" — enter this data by hand for now.`);
    }

    throw new Error(`Unsupported proof file type: ${ext}`);
}

// One column-group per port leg (Arrival+Departure), one row per
// (vessel, voyage) — same shape as the guideline's Ports sheet so
// the two can be compared leg-for-leg. Rows with no `port` field
// (the generic default/text parsers, single eta/etd) collapse to
// one unnamed leg.
//
// A route that revisits the same port more than once in one voyage
// (a loop calling Piraeus at the start, middle, and end) needs one
// COLUMN PER VISIT — keying legs by port name alone let a later visit
// silently overwrite an earlier one, so only the last call ever showed.
function buildWideProofSheet(service, rows) {
    const groups = new Map(); // "vessel|||voyage" -> { vessel, voyage, legs: Map(port -> [{eta,etd}, ...]) }
    for (const row of rows) {
        const key = `${row.vessel || ""}|||${row.voyage || ""}`;
        if (!groups.has(key)) groups.set(key, { vessel: row.vessel || "", voyage: row.voyage || "", legs: new Map() });
        const legs = groups.get(key).legs;
        const port = row.port || "";
        if (!legs.has(port)) legs.set(port, []);
        legs.get(port).push({ eta: row.eta || "", etd: row.etd || "" });
    }

    // legOrder = one {port, occurrence} slot per visit, sized to the most
    // visits any single vessel/voyage made to that port — ports in
    // first-seen order.
    const maxOccurrence = new Map();
    const portOrder = [];
    for (const { legs } of groups.values()) {
        for (const [port, visits] of legs) {
            if (!portOrder.includes(port)) portOrder.push(port);
            maxOccurrence.set(port, Math.max(maxOccurrence.get(port) || 0, visits.length));
        }
    }
    const legOrder = [];
    for (const port of portOrder) {
        const count = maxOccurrence.get(port) || 1;
        for (let i = 0; i < count; i++) legOrder.push({ port, occurrence: i });
    }
    if (legOrder.length === 0) legOrder.push({ port: "", occurrence: 0 });

    const headerRow1 = ["Vessel", "Voyage No."];
    const headerRow2 = ["", ""];
    for (const { port } of legOrder) {
        headerRow1.push(port, "");
        headerRow2.push("Arrival", "Departure");
    }
    headerRow1.push("service");
    headerRow2.push(service);

    const dataRows = [...groups.values()].map(g => {
        const row = [g.vessel, g.voyage];
        for (const { port, occurrence } of legOrder) {
            const cell = (g.legs.get(port) || [])[occurrence] || { eta: "", etd: "" };
            row.push(cell.eta, cell.etd);
        }
        row.push("");
        return row;
    });

    return [headerRow1, headerRow2, ...dataRows];
}

// Writes rows to extracted-proofs.xlsx, overwriting whatever was there
// (same "current state only" model as the guideline — see
// schedule-guideline-store.js). Best-effort: a locked file (open in
// Excel) logs a warning instead of throwing/crashing the caller.
function saveProofRows(service, rows) {
    const aoa = buildWideProofSheet(service, rows);
    const wb  = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), MASTER_SHEET);

    fs.mkdirSync(path.dirname(MASTER_FILE), { recursive: true });
    try {
        XLSX.writeFile(wb, MASTER_FILE);
    } catch (err) {
        console.warn(`⚠ Could not write ${MASTER_FILE} (likely open in Excel):`, err.message);
        return null;
    }
    return aoa.length - 2; // vessel count
}

// Full pipeline for one proof file: extract → cross-check against the
// active guideline → write extracted-proofs.xlsx → build result.xlsx.
// Used by download-watcher.js right after a rename, and available for
// anything else that wants the whole pipeline in one call.
async function extractAndSave(filePath) {
    const guideline = scheduleGuidelineStore.getCurrent();
    if (!guideline) {
        throw new Error("No active guideline — open the service's schedule page in Tradetech first.");
    }

    const rows        = await extractProof(filePath, guideline.operator);
    const checkedRows = scheduleGuidelineStore.matchRows(rows);
    const vessels      = saveProofRows(guideline.service, checkedRows);

    lastRows = checkedRows;
    const result = buildResult(checkedRows);

    return { service: guideline.service, operator: guideline.operator, rows: checkedRows, vessels, result };
}

function getLastRows() {
    return lastRows;
}

function cacheRows(rows) {
    lastRows = rows;
}

// Newest watch-folder file matching download-watcher.js's own rename
// convention ("{service}-MMDDYY(-N).ext") for this service — across every
// extension it watches, so a re-download in a different format still wins
// on recency.
function findLatestProofFile(service) {
    const escaped     = service.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const extsPattern = WATCH_EXTS.map(e => e.slice(1)).join("|");
    const pattern      = new RegExp(`^${escaped}-\\d{6}(-\\d+)?\\.(${extsPattern})$`, "i");

    let best = null;
    for (const file of fs.readdirSync(WATCH_FOLDER)) {
        if (!pattern.test(file)) continue;
        const filePath = path.join(WATCH_FOLDER, file);
        const mtime    = fs.statSync(filePath).mtimeMs;
        if (!best || mtime > best.mtime) best = { filePath, mtime };
    }
    return best ? best.filePath : null;
}

// Scans the watch folder for the active guideline's own proof file —
// no prior /proof/extract call needed. Finds the newest file matching
// "{service}-MMDDYY(-N).ext" and runs the full extract → check → save
// pipeline against it. Used by the dashboard's "Recalc" button so it
// re-detects and re-checks the real file instead of trusting stale state.
async function recalcFromWatchFolder() {
    const guideline = scheduleGuidelineStore.getCurrent();
    if (!guideline) {
        throw new Error("No active guideline — open the service's schedule page in Tradetech first.");
    }

    const filePath = findLatestProofFile(guideline.service);
    if (!filePath) {
        throw new Error(`No proof file found for service ${guideline.service} in ${WATCH_FOLDER}.`);
    }

    return extractAndSave(filePath);
}

module.exports = { extractProof, buildWideProofSheet, saveProofRows, extractAndSave, getLastRows, cacheRows, recalcFromWatchFolder };
