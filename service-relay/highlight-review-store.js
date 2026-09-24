// ============================================================
//  highlight-review-store.js
//  Ground-truth labels for the port-highlight logic
//  (src/features/port-highlighting.js). Two sources feed it:
//   1. The extension's batch Rotation Receipt Capture submits each
//      record's structured rotation + what the logic picked
//      (submitCapture) — reviewed by clicking the correct port row.
//   2. Receipt PNGs already sitting in RECEIPTS_FOLDER
//      (importReceipts) — reviewed by looking at the image (yellow row =
//      what the logic picked) and typing the right port if it's wrong.
//
//  Items are keyed by SANITIZED SERVICE CODE (the same string the PNG
//  filenames use), so a PNG-only item and a later structured capture of
//  the same service are the same item, and verdicts carry over.
//  Verdicts (`truth`) are independent of the auto pick and survive
//  re-captures, so after the logic is fixed the export's `agree` flags
//  always reflect the CURRENT logic against the same human labels.
// ============================================================

const fs   = require("fs");
const path = require("path");
const { DATA_FOLDER, RECEIPTS_FOLDER, HIGHLIGHT_REVIEW_FILE, HIGHLIGHT_REVIEW_EXPORT_FILE } = require("./config");
const { writeFileAtomicSync } = require("./atomic-write");

const STR_MAX   = 200;
const MAX_PORTS = 200;
const RECEIPT_NAME = /^(.+)-(\d{6})-receipt\.png$/;

let items = {}; // { [key]: item } — key = sanitized service code

const str = v => String(v == null ? "" : v).slice(0, STR_MAX);

// Same sanitization save-confirmation.js's getServiceCode() applies for
// the PNG filename — must stay identical or PNG and structured items
// for one service stop being the same item.
const sanitizeService = s => String(s == null ? "" : s).trim().replace(/[^A-Za-z0-9-]/g, "_");

function ensureDataFolder() {
    if (!fs.existsSync(DATA_FOLDER)) fs.mkdirSync(DATA_FOLDER, { recursive: true });
}

function persist() {
    ensureDataFolder();
    try {
        writeFileAtomicSync(HIGHLIGHT_REVIEW_FILE, JSON.stringify(items, null, 2));
    } catch (err) {
        console.warn(`⚠ Could not write ${HIGHLIGHT_REVIEW_FILE}:`, err.message);
    }
}

function loadFromDisk() {
    ensureDataFolder();
    if (!fs.existsSync(HIGHLIGHT_REVIEW_FILE)) {
        console.log("📂 No saved highlight-review.json yet — starting empty");
        return;
    }
    try {
        items = JSON.parse(fs.readFileSync(HIGHLIGHT_REVIEW_FILE, "utf8"));
        console.log(`📂 Loaded highlight review — ${Object.keys(items).length} item(s)`);
    } catch (err) {
        console.error("❌ Could not load highlight-review.json — starting empty:", err.message);
        items = {};
    }
}

const portRef = o => ({ code: str(o && o.code), desc: str(o && o.desc) });
const hasData = item => item.ports.length > 0;

// The answer the logic effectively gave for a structured item: its pick
// if it was a genuine find, null ("no special port") if it just defaulted
// to SP001. Unknown for a PNG-only item (the pick is only in the image).
function effectiveAuto(item) {
    return item.autoSpecial ? item.autoRow : null;
}

// A receipt PNG's height is fully determined by its port-row count (see
// save-confirmation.js renderRotationCanvas()): PADDING 14 top + bottom,
// 30 title area, then 26px per line for the 3 extra lines (last foreign /
// first US / first EU), 1 header band, and one line per port row:
// H = (14 + 30 + 14) + 26 * (3 + 1 + rows) = 162 + 26 * rows. Lets the
// review page offer exactly the SP buttons that exist in an image it
// can't otherwise read. null if the height doesn't fit the layout (e.g.
// the layout changed) — the page then falls back to a generic button
// range. (An earlier version of this used 84 instead of 58 for the fixed
// part — off by exactly one row, which an "is it a whole number of
// lines" check can't detect — so every image was offered one SP button
// too few. Verified against a real receipt: 344px tall, 7 port rows.)
function rowsFromPngHeight(h) {
    const rows = (h - 162) / 26;
    return Number.isInteger(rows) && rows >= 1 && rows <= 100 ? rows : null;
}

function readPngHeight(filePath) {
    try {
        const fd = fs.openSync(filePath, "r");
        const head = Buffer.alloc(24);
        fs.readSync(fd, head, 0, 24, 0);
        fs.closeSync(fd);
        return head.toString("ascii", 1, 4) === "PNG" ? head.readUInt32BE(20) : null;
    } catch {
        return null;
    }
}

// Lists RECEIPTS_FOLDER's `<service>-<MMDDYY>-receipt.png` files, newest
// per service.
function scanReceiptFolder() {
    let names;
    try {
        names = fs.readdirSync(RECEIPTS_FOLDER);
    } catch {
        return []; // folder doesn't exist yet — nothing captured
    }
    const newest = new Map();
    for (const file of names) {
        const m = file.match(RECEIPT_NAME);
        if (!m) continue;
        let mtimeMs;
        try { mtimeMs = fs.statSync(path.join(RECEIPTS_FOLDER, file)).mtimeMs; } catch { continue; }
        const prev = newest.get(m[1]);
        if (!prev || mtimeMs > prev.mtimeMs) newest.set(m[1], { service: m[1], file, mtimeMs, rows: rowsFromPngHeight(readPngHeight(path.join(RECEIPTS_FOLDER, file))) });
    }
    return [...newest.values()];
}

// The sanitized service code — what receipt PNG filenames carry, so the
// join key between an item and its PNG. Older on-disk items predate the
// serviceKey field; for them the item key IS the service code.
const serviceKeyOf = item => item.serviceKey || item.key;

// An item's identity is the SERVICE + VESSEL OPERATOR pair: the same
// service code under two different operators is two different services,
// while the same pair seen twice (a duplicate record, or the same record
// captured on two days) is ONE item — newest wins. With no operator known
// the identity is just the service code, which is also what a PNG-only
// (imported) item is keyed by, since a PNG's filename carries no operator.
// "~" can't appear in a sanitized code, so the pair can't collide with a
// plain service code.
const identityKey = (service, operator) => {
    const s = sanitizeService(service);
    const o = sanitizeService(operator);
    return s && o ? `${s}~${o}` : s;
};

// Syncs items with what's in the folder: attaches each PNG to every item
// with that service code (a PNG doesn't say which operator's record it came
// from — the image title does, but the server can't read images), creates
// a PNG-only item where NO item has that service code yet, and drops a
// PNG-only item whose file disappeared (unless it already has a verdict).
function importReceipts() {
    const files = new Map(scanReceiptFolder().map(f => [f.service, f]));
    let changed = false;

    for (const item of Object.values(items)) {
        const f = files.get(serviceKeyOf(item));
        if (f) {
            if (item.receiptFile !== f.file) { item.receiptFile = f.file; changed = true; }
            if (item.receiptRows !== f.rows) { item.receiptRows = f.rows; changed = true; }
        } else if (item.receiptFile) {
            if (item.imported && !item.truth) delete items[item.key];
            else delete item.receiptFile;
            changed = true;
        }
    }

    const knownServices = new Set(Object.values(items).map(serviceKeyOf));
    for (const f of files.values()) {
        if (knownServices.has(f.service)) continue;
        items[f.service] = {
            key: f.service, serviceKey: f.service, record: null, service: f.service, imported: true,
            capturedAt: new Date(f.mtimeMs).toISOString(),
            ports: [], receiptFile: f.file, receiptRows: f.rows,
            firstUsPort: portRef(), firstEuPort: portRef(), lastForeignPort: portRef(),
            autoRow: null, autoSpecial: true, // unknown for a PNG-only item — the pick is only visible in the image (which may show the SP001 fallback)
        };
        changed = true;
    }

    if (changed) persist();
}

function submitCapture(data) {
    const record = str(data && data.record).trim();
    if (!/^\d+$/.test(record)) return { error: "record must be numeric" };
    if (!Array.isArray(data.ports) || data.ports.length === 0) return { error: "ports must be a non-empty array" };

    const serviceKey = sanitizeService(data.service);
    const key = identityKey(data.service, data.vesselOperator) || `rec_${record}`;
    const existing = items[key];

    // A PNG-only item for this service (keyed by the bare service code) is
    // folded into the first structured item that arrives for it, so its
    // verdict and image carry over instead of being orphaned. Once it's
    // been folded in, a later record of the same service under ANOTHER
    // operator starts fresh.
    let carriedTruth = existing && existing.truth;
    let carriedReceipt = existing && existing.receiptFile;
    if (serviceKey && key !== serviceKey && items[serviceKey] && items[serviceKey].imported) {
        carriedTruth = carriedTruth || items[serviceKey].truth;
        carriedReceipt = carriedReceipt || items[serviceKey].receiptFile;
        delete items[serviceKey];
    }

    // Same service + operator, different record = a duplicate: this newest
    // capture replaces the older one (only one is ever shown for review),
    // and the ones it displaced are remembered so it's visible they exist.
    const duplicateRecords = new Set((existing && existing.duplicateRecords) || []);
    if (existing && existing.record && existing.record !== record) duplicateRecords.add(existing.record);

    items[key] = {
        key,
        serviceKey: serviceKey || key,
        record,
        duplicateRecords: [...duplicateRecords].slice(-20),
        service: str(data.service),
        vesselOperator: str(data.vesselOperator),
        capturedAt: new Date().toISOString(),
        ports: data.ports.slice(0, MAX_PORTS).map(p => ({
            row:      str(p.row),
            name:     str(p.name),
            code:     str(p.code),
            key:      str(p.key),
            arrival:  str(p.arrival),
            depart:   str(p.depart),
            category: str(p.category),
            fine:     p.fine ? str(p.fine) : null,
        })),
        firstUsPort:     portRef(data.firstUsPort),
        firstEuPort:     portRef(data.firstEuPort),
        lastForeignPort: portRef(data.lastForeignPort),
        autoRow:     data.autoRow ? str(data.autoRow) : null,
        autoSpecial: Boolean(data.autoSpecial),
        ...(carriedTruth ? { truth: carriedTruth } : {}),
        ...(carriedReceipt ? { receiptFile: carriedReceipt } : {}),
    };
    persist();
    return { ok: true };
}

// Structured item: row = an SP row number string ("005"), or null meaning
// "no special port".
function setTruth(key, row) {
    const item = items[str(key)];
    if (!item) return { error: "unknown item" };
    if (!hasData(item)) return { error: "no rotation data for this item — review it by image (verdict), not by row" };
    if (row !== null && !item.ports.some(p => p.row === row)) return { error: "row is not one of this item's ports" };
    item.truth = { row, reviewedAt: new Date().toISOString() };
    persist();
    return { ok: true };
}

// PNG-only item: verdict is about the yellow row in the image. "right" =
// it's correct; "wrong" = it isn't, `correct` = free text naming the right
// port (e.g. "SP005" or a port name); "none" = there should be no special
// port at all.
function setImageVerdict(key, verdict, correct) {
    const item = items[str(key)];
    if (!item) return { error: "unknown item" };
    if (hasData(item)) return { error: "this item has rotation data — review it by row, not by image verdict" };
    if (!["right", "wrong", "none"].includes(verdict)) return { error: "verdict must be right, wrong or none" };
    if (verdict === "wrong" && !str(correct).trim()) return { error: "say which port is right" };
    const text = verdict === "wrong" ? str(correct).trim() : "";
    const rowMatch = text.match(/^SP([0-9]{3})$/i);
    item.truth = { verdict, correct: text, ...(rowMatch ? { correctRow: rowMatch[1] } : {}), reviewedAt: new Date().toISOString() };
    persist();
    return { ok: true };
}

function clearTruth(key) {
    const item = items[str(key)];
    if (!item) return { error: "unknown item" };
    delete item.truth;
    persist();
    return { ok: true };
}

// Re-runs the CURRENT extension highlight logic over every structured item
// (see highlight-replay.js) and stores the result as the item's auto pick, so
// the review page and export judge the latest logic on the routes already
// captured. The browser's own original answer is kept once as
// capturedAutoRow/capturedAutoSpecial. Verdicts are untouched — a structured
// verdict is the human's right row, independent of any auto pick. The next
// real capture of an item overwrites it with a fresh browser-made pick.
function replayAuto() {
    const replay = require("./highlight-replay").createReplayer();
    const changes = [];
    let total = 0;

    for (const item of Object.values(items)) {
        if (!hasData(item)) continue;
        total++;

        const before = effectiveAuto(item);
        if (item.capturedAutoRow === undefined) {
            item.capturedAutoRow = item.autoRow;
            item.capturedAutoSpecial = item.autoSpecial;
        }

        const { row, special, directional } = replay(item);
        item.autoRow = row;
        item.autoSpecial = special;
        item.directional = directional;
        item.replayedAt = new Date().toISOString();

        const after = effectiveAuto(item);
        if (before !== after) changes.push({ service: item.service, vesselOperator: item.vesselOperator, before, after });
    }

    persist();
    return { total, changed: changes.length, changes };
}

function getAll() {
    return Object.values(items).sort((a, b) => a.service.localeCompare(b.service));
}

// Written to disk on every export too (HIGHLIGHT_REVIEW_EXPORT_FILE) so
// the latest labeled set is always readable at a fixed path without
// needing the browser download.
function buildExport({ all = false } = {}) {
    const list     = getAll();
    const reviewed = list.filter(i => i.truth);

    const rows = (all ? list : reviewed).map(i => {
        let truthRow = null, verdict = null, correctText = null, correctRow = null, agree = null;
        if (i.truth) {
            if ("row" in i.truth) {
                truthRow = i.truth.row;
                agree = truthRow === effectiveAuto(i);
            } else {
                verdict = i.truth.verdict;
                correctText = i.truth.correct || null;
                correctRow = i.truth.correctRow || null;
                agree = verdict === "right";
            }
        }
        return {
            service: i.service,
            vesselOperator: i.vesselOperator || null,
            ignoredDuplicateRecords: i.duplicateRecords && i.duplicateRecords.length ? i.duplicateRecords : null,
            record: i.record,
            reviewed: Boolean(i.truth),
            agree,
            truthRow,
            verdict,
            correctText,
            correctRow,
            autoAnswer: hasData(i) ? effectiveAuto(i) : null,
            autoRow: i.autoRow,
            autoSpecial: i.autoSpecial,
            capturedAuto: i.capturedAutoRow === undefined ? null : (i.capturedAutoSpecial ? i.capturedAutoRow : null),
            directional: i.directional === undefined ? null : i.directional,
            hasRotationData: hasData(i),
            receiptFile: i.receiptFile ? path.join(RECEIPTS_FOLDER, i.receiptFile) : null,
            ports: i.ports,
            firstUsPort: i.firstUsPort,
            firstEuPort: i.firstEuPort,
            lastForeignPort: i.lastForeignPort,
            reviewedAt: i.truth ? i.truth.reviewedAt : null,
            capturedAt: i.capturedAt,
        };
    }).sort((a, b) => (a.agree === false ? 0 : 1) - (b.agree === false ? 0 : 1) || a.service.localeCompare(b.service));

    const agree    = rows.filter(r => r.agree === true).length;
    const disagree = rows.filter(r => r.agree === false).length;

    const out = {
        exportedAt: new Date().toISOString(),
        legend: {
            agree: "true = the highlight logic's pick was judged right; false = wrong; null = not reviewed.",
            truthRow: "Structured items (hasRotationData:true): SP row number (string, e.g. \"005\") of the port a human says SHOULD be highlighted; null with reviewed:true means 'no special port' (the logic defaulting to SP001 is correct).",
            autoAnswer: "Structured items: what the logic effectively answered — autoRow when autoSpecial is true, else null (only fell back to SP001). null for PNG-only items (the pick is only visible in receiptFile).",
            verdict_correctText: "PNG-only items (hasRotationData:false), or an item reviewed by image before its rotation data arrived: verdict is right | wrong | none about the YELLOW ROW in receiptFile at review time; correctText = the right port when wrong (picked from SP buttons, e.g. \"SP005\"); correctRow = its 3-digit row (\"005\") when it was picked that way. Open receiptFile (a PNG) to see the rotation and which row was yellow.",
            ports: "Every non-blank port row in order: row, name, code (SP*_port_code), key (SP*_port_key — drives full-bound pivot detection), arrival/depart, category (coarse: USA/JAPAN/EU_UK/OTHER), fine (UK/CANADA/EU/USA or null).",
            firstUsPort_firstEuPort: "Tradetech's own first_us_port / first_eu_port fields — the priority pass matches these codes against ports[].code.",
            service: "Service code. Directional (one-bound) = trailing -<letter> (e.g. AE1-E) OR SP001 key blank/non-letter; any port_key with a real bound marker (ES, EEWS, WE…) makes it full-bound (2 bounds) regardless. See the per-item `directional` flag.",
            autoAnswer_replay: "autoRow/autoAnswer come from re-running the CURRENT extension logic over the stored ports (replayAuto). capturedAuto = what the browser answered at capture time (null when unknown or 'nothing special'); differs from autoAnswer where the logic changed since.",
        },
        summary: { total: list.length, reviewed: reviewed.length, agree, disagree, unreviewed: list.length - reviewed.length },
        items: rows,
    };

    ensureDataFolder();
    try {
        writeFileAtomicSync(HIGHLIGHT_REVIEW_EXPORT_FILE, JSON.stringify(out, null, 2));
    } catch (err) {
        console.warn(`⚠ Could not write ${HIGHLIGHT_REVIEW_EXPORT_FILE}:`, err.message);
    }
    return out;
}

module.exports = {
    loadFromDisk, importReceipts, submitCapture, setTruth, setImageVerdict, clearTruth,
    getAll, buildExport, effectiveAuto, replayAuto, RECEIPT_NAME, rowsFromPngHeight,
};
