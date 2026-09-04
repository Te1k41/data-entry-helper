// ============================================================
//  schedule-dom-scrape-store.js
//  Latest DOM-scraped schedule table per service — a far more
//  reliable alternative to OCR proof extraction, built by
//  reading the operator's own real HTML table directly (see
//  src/features/schedule-table-scrape.js) instead of recognizing
//  pixels in a screenshot.
//
//  Unlike schedule-guideline-store.js (ONE active guideline, tied
//  to whichever Tradetech tab currently owns it), DOM scrapes are
//  keyed by SERVICE and coexist — a user can scrape several
//  services across a session, each capture simply replacing that
//  service's previous one (latest-wins, same replace semantics
//  as the guideline store, just multi-keyed instead of single).
// ============================================================

const fs   = require("fs");
const path = require("path");
const { DATA_FOLDER } = require("./config");
const { writeFileAtomicSync } = require("./atomic-write");

const STORE_FILE = path.join(DATA_FOLDER, "schedule-dom-scrapes.json");

let scrapes = {}; // { [service]: { service, operator, rows, incomplete, missingDirection, capturedAt, directions? } }

function ensureDataFolder() {
    if (!fs.existsSync(DATA_FOLDER)) fs.mkdirSync(DATA_FOLDER, { recursive: true });
}

function persist() {
    ensureDataFolder();
    try {
        writeFileAtomicSync(STORE_FILE, JSON.stringify(scrapes, null, 2));
    } catch (err) {
        console.warn(`⚠ Could not write ${STORE_FILE}:`, err.message);
    }
}

function loadFromDisk() {
    ensureDataFolder();
    if (!fs.existsSync(STORE_FILE)) {
        console.log("📂 No saved schedule-dom-scrapes.json yet — starting empty");
        return;
    }
    try {
        scrapes = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
        console.log(`📂 Loaded DOM-scraped schedules — ${Object.keys(scrapes).length} service(s)`);
    } catch (err) {
        console.error("❌ Could not load schedule-dom-scrapes.json — starting empty:", err.message);
        scrapes = {};
    }
}

// data: { service, operator, rows: [{vessel, voyage, imo, port, eta, etd, source, ocrConfidence}, ...],
//         incomplete?: boolean, missingDirection?: string }
function recordScrape(data) {
    const service = String(data && data.service || "").trim();
    if (!service) return;
    if (!Array.isArray(data.rows) || data.rows.length === 0) return;

    scrapes[service] = {
        service,
        operator: data.operator || "",
        rows: data.rows,
        incomplete: Boolean(data.incomplete),
        missingDirection: data.missingDirection || null,
        capturedAt: new Date().toISOString(),
    };
    persist();
    console.log(`📥 DOM-scraped schedule stored: ${service} (${data.rows.length} row(s)${data.incomplete ? ", incomplete: missing " + data.missingDirection : ""})`);
}

// Fallback path for when the live browser-extension route (content script
// -> background worker -> WebSocket) can't be used: a real saved HTML file
// per direction, dropped in the watch folder (see download-watcher.js +
// proof-parsers/yangming-html.js), submitted ONE direction at a time rather
// than pre-combined. Stores each direction's rows separately, keyed by
// direction, and republishes a combined `rows`/`incomplete` view built from
// whichever directions are currently known -- a fresh save of the SAME
// direction replaces just that slot, it never duplicates.
function recordDirectionScrape(service, operator, direction, rows) {
    const key = String(service || "").trim();
    if (!key || !Array.isArray(rows) || !rows.length) return;

    const existing = scrapes[key];
    const directions = (existing && existing.directions) ? { ...existing.directions } : {};
    if (direction) directions[direction] = rows;
    else directions._ = rows; // non-directional service, single slot

    // S<->N confirmed real (IE8), E<->W confirmed real (MD3, a genuine
    // real "W-Bound" counterpart page) -- all four compass directions pair
    // up the same way.
    const OPPOSITE_DIRECTION = { S: "N", N: "S", E: "W", W: "E" };
    const combinedRows = Object.values(directions).flat();
    const knownDirections = Object.keys(directions).filter(d => d !== "_");
    const incomplete = knownDirections.length > 0 && knownDirections.length < 2;
    const missingDirection = incomplete ? (OPPOSITE_DIRECTION[knownDirections[0]] || null) : null;

    scrapes[key] = {
        service: key,
        operator: operator || (existing ? existing.operator : "") || "",
        rows: combinedRows,
        incomplete,
        missingDirection,
        directions,
        capturedAt: new Date().toISOString(),
    };
    persist();
    console.log(`📥 DOM-scraped schedule stored (file save, direction ${direction || "(none)"}): ${key} (${combinedRows.length} row(s) total${incomplete ? ", still missing " + missingDirection : ", complete"})`);
}

function getScrape(service) {
    return scrapes[String(service || "").trim()] || null;
}

function getAllScrapes() {
    return scrapes;
}

module.exports = { recordScrape, recordDirectionScrape, getScrape, getAllScrapes, loadFromDisk };
