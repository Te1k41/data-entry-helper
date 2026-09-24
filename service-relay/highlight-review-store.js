// ============================================================
//  highlight-review-store.js
//  Ground-truth labels for the port-highlight logic
//  (src/features/port-highlighting.js). The extension's batch Rotation
//  Receipt Capture submits each record's port rotation + what the
//  highlight logic picked; the dashboard's Highlight Review page lets a
//  human mark each pick right/wrong and click the correct port row.
//
//  Verdicts (`truth`) are stored independently of the auto pick, and
//  survive re-captures: after the highlight logic is fixed, re-running
//  the capture refreshes `autoRow`/`autoSpecial` but keeps every
//  human-labeled truth, so the export's `agree` flag always reflects the
//  CURRENT logic against the same ground truth.
// ============================================================

const fs   = require("fs");
const { DATA_FOLDER, HIGHLIGHT_REVIEW_FILE, HIGHLIGHT_REVIEW_EXPORT_FILE } = require("./config");
const { writeFileAtomicSync } = require("./atomic-write");

const STR_MAX   = 200;
const MAX_PORTS = 200;

let items = {}; // { [record]: item } — see submitCapture() for the shape

const str = v => String(v == null ? "" : v).slice(0, STR_MAX);

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
        console.log(`📂 Loaded highlight review — ${Object.keys(items).length} record(s)`);
    } catch (err) {
        console.error("❌ Could not load highlight-review.json — starting empty:", err.message);
        items = {};
    }
}

const portRef = o => ({ code: str(o && o.code), desc: str(o && o.desc) });

// The answer the highlight logic effectively gave: its pick if it was a
// genuine find, null ("no special port") if it just defaulted to SP001.
function effectiveAuto(item) {
    return item.autoSpecial ? item.autoRow : null;
}

function submitCapture(data) {
    const record = str(data && data.record).trim();
    if (!/^\d+$/.test(record)) return { error: "record must be numeric" };
    if (!Array.isArray(data.ports) || data.ports.length === 0) return { error: "ports must be a non-empty array" };

    const existing = items[record];
    items[record] = {
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
    };
    persist();
    return { ok: true };
}

// row: an SP row number string ("005"), or null meaning "no special port".
function setTruth(record, row) {
    const item = items[str(record)];
    if (!item) return { error: "unknown record" };
    if (row !== null && !item.ports.some(p => p.row === row)) return { error: "row is not one of this record's ports" };
    item.truth = { row, reviewedAt: new Date().toISOString() };
    persist();
    return { ok: true };
}

function clearTruth(record) {
    const item = items[str(record)];
    if (!item) return { error: "unknown record" };
    delete item.truth;
    persist();
    return { ok: true };
}

function getAll() {
    return Object.values(items).sort((a, b) =>
        a.service.localeCompare(b.service) || a.record.localeCompare(b.record, undefined, { numeric: true })
    );
}

// Written to disk on every export too (HIGHLIGHT_REVIEW_EXPORT_FILE) so
// the latest labeled set is always readable at a fixed path without
// needing the browser download.
function buildExport({ all = false } = {}) {
    const list     = getAll();
    const reviewed = list.filter(i => i.truth);
    const rows = (all ? list : reviewed).map(i => {
        const autoAnswer = effectiveAuto(i);
        return {
            record: i.record,
            service: i.service,
            reviewed: Boolean(i.truth),
            truthRow: i.truth ? i.truth.row : null,
            autoAnswer,
            agree: i.truth ? i.truth.row === autoAnswer : null,
            autoRow: i.autoRow,
            autoSpecial: i.autoSpecial,
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
            truthRow: "SP row number (string, e.g. \"005\") of the port a human says SHOULD be highlighted; null with reviewed:true means 'no special port' (highlight logic defaulting to SP001 is correct).",
            autoAnswer: "What the highlight logic effectively answered: autoRow when autoSpecial is true, else null (it only fell back to SP001).",
            agree: "truthRow === autoAnswer. false = the logic is wrong for this record. null = not reviewed.",
            ports: "Every non-blank port row in order: row, name, code (SP*_port_code), key (SP*_port_key — drives full-bound pivot detection), arrival/depart, category (coarse: USA/JAPAN/EU_UK/OTHER), fine (UK/CANADA/EU/USA or null).",
            firstUsPort_firstEuPort: "Tradetech's own first_us_port / first_eu_port fields — the priority pass matches these codes against ports[].code.",
            service: "Raw service field. A trailing -<letter> (e.g. AE1-E) means a directional (one-bound) service, otherwise 2 bounds.",
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

module.exports = { loadFromDisk, submitCapture, setTruth, clearTruth, getAll, buildExport, effectiveAuto };
