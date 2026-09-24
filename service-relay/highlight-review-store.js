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
        if (!prev || mtimeMs > prev.mtimeMs) newest.set(m[1], { service: m[1], file, mtimeMs });
    }
    return [...newest.values()];
}

// Syncs items with what's in the folder: attaches each PNG to its
// service's item, creates a PNG-only item where none exists, and drops a
// PNG-only item whose file disappeared (unless it already has a verdict).
function importReceipts() {
    const files = new Map(scanReceiptFolder().map(f => [f.service, f]));
    let changed = false;

    for (const item of Object.values(items)) {
        const f = files.get(item.key);
        if (f) {
            if (item.receiptFile !== f.file) { item.receiptFile = f.file; changed = true; }
        } else if (item.receiptFile) {
            if (item.imported && !item.truth) delete items[item.key];
            else delete item.receiptFile;
            changed = true;
        }
    }

    for (const f of files.values()) {
        if (items[f.service]) continue;
        items[f.service] = {
            key: f.service, record: null, service: f.service, imported: true,
            capturedAt: new Date(f.mtimeMs).toISOString(),
            ports: [], receiptFile: f.file,
            firstUsPort: portRef(), firstEuPort: portRef(), lastForeignPort: portRef(),
            autoRow: null, autoSpecial: true, // a PNG only exists when the logic found a special port
        };
        changed = true;
    }

    if (changed) persist();
}

function submitCapture(data) {
    const record = str(data && data.record).trim();
    if (!/^\d+$/.test(record)) return { error: "record must be numeric" };
    if (!Array.isArray(data.ports) || data.ports.length === 0) return { error: "ports must be a non-empty array" };

    const key = sanitizeService(data.service) || `rec_${record}`;
    const existing = items[key];
    items[key] = {
        key,
        record,
        service: str(data.service),
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
        ...(existing && existing.truth ? { truth: existing.truth } : {}),
        ...(existing && existing.receiptFile ? { receiptFile: existing.receiptFile } : {}),
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
    item.truth = { verdict, correct: verdict === "wrong" ? str(correct).trim() : "", reviewedAt: new Date().toISOString() };
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
        let truthRow = null, verdict = null, correctText = null, agree = null;
        if (i.truth) {
            if ("row" in i.truth) {
                truthRow = i.truth.row;
                agree = truthRow === effectiveAuto(i);
            } else {
                verdict = i.truth.verdict;
                correctText = i.truth.correct || null;
                agree = verdict === "right";
            }
        }
        return {
            service: i.service,
            record: i.record,
            reviewed: Boolean(i.truth),
            agree,
            truthRow,
            verdict,
            correctText,
            autoAnswer: hasData(i) ? effectiveAuto(i) : null,
            autoRow: i.autoRow,
            autoSpecial: i.autoSpecial,
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
            verdict_correctText: "PNG-only items (hasRotationData:false), or an item reviewed by image before its rotation data arrived: verdict is right | wrong | none about the YELLOW ROW in receiptFile at review time; correctText = free text naming the right port when wrong. Open receiptFile (a PNG) to see the rotation and which row was yellow.",
            ports: "Every non-blank port row in order: row, name, code (SP*_port_code), key (SP*_port_key — drives full-bound pivot detection), arrival/depart, category (coarse: USA/JAPAN/EU_UK/OTHER), fine (UK/CANADA/EU/USA or null).",
            firstUsPort_firstEuPort: "Tradetech's own first_us_port / first_eu_port fields — the priority pass matches these codes against ports[].code.",
            service: "Service code. A trailing -<letter> (e.g. AE1-E) means a directional (one-bound) service, otherwise 2 bounds.",
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
    getAll, buildExport, effectiveAuto, RECEIPT_NAME,
};
