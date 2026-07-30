// ============================================================
//  schedule-guideline-store.js
//  ONE active guideline at a time — whatever service's
//  schedule_detailsB.pl edit page is currently open. Built the
//  moment schedule-capture.js sends its first snapshot for a
//  tab, deleted the moment that tab's WebSocket closes (tab
//  closed or navigated away).
//
//  If two tabs of that page are open at once, the FIRST tab to
//  send a snapshot "owns" the guideline — a second tab's
//  snapshots are ignored until the first tab's connection
//  closes. Ownership is tracked by WebSocket connection object,
//  not by service code, so this doesn't need any client-sent
//  session id.
// ============================================================

const fs   = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { DATA_FOLDER } = require("./config");

const STORE_FILE = path.join(DATA_FOLDER, "schedule-guideline.json");
const XLSX_FILE  = path.join(DATA_FOLDER, "schedule-guideline.xlsx");

let current  = null; // { service, operator, ports, vessels, capturedAt }
let ownerWs  = null;

function ensureDataFolder() {
    if (!fs.existsSync(DATA_FOLDER)) fs.mkdirSync(DATA_FOLDER, { recursive: true });
}

function blockSheet(service, operator, columns, rows) {
    const aoa = [
        ["service", "operator"],
        [service, operator],
        [],
        columns,
    ];
    for (const r of rows) aoa.push(r);
    return XLSX.utils.aoa_to_sheet(aoa);
}

// One column-group per port leg (leg number / code / name / Arrival+Departure),
// one data row holding the current values — matches extracted-proofs.xlsx's
// shape so the two can be compared leg-for-leg instead of by lookup.
function portsSheetWide(service, operator, ports) {
    const legNumRow = [];
    const codeRow    = [];
    const nameRow    = [];
    const subRow     = [];
    const valueRow   = [];

    ports.forEach((p, i) => {
        legNumRow.push(i + 1, "");
        codeRow.push(p.code, "");
        nameRow.push(p.name, "");
        subRow.push("Arrival", "Departure");
        valueRow.push(p.arrival, p.depart);
    });

    const aoa = [
        ["service", "operator"],
        [service, operator],
        [],
        legNumRow,
        codeRow,
        nameRow,
        subRow,
        valueRow,
    ];
    return XLSX.utils.aoa_to_sheet(aoa);
}

function parseMMDDYY(str) {
    const m = String(str || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
    if (!m) return null;
    const [, mm, dd, yy] = m;
    return new Date(2000 + parseInt(yy, 10), parseInt(mm, 10) - 1, parseInt(dd, 10)).getTime();
}

// Chronological by depart date — unparseable/blank dates sort last
// rather than breaking the sort.
function sortByDepart(vessels) {
    return [...vessels].sort((a, b) => {
        const ta = parseMMDDYY(a.depart);
        const tb = parseMMDDYY(b.depart);
        if (ta === null && tb === null) return 0;
        if (ta === null) return 1;
        if (tb === null) return -1;
        return ta - tb;
    });
}

function exportExcel() {
    ensureDataFolder();

    // The xlsx is meant to be open in Excel while you work — that locks
    // the file on Windows. Every write here is best-effort: skip and
    // warn rather than throw, since a locked file must never break
    // guideline capture or crash the process (see #— this used to take
    // the whole relay down when the file was open during a tab switch).
    if (!current) {
        try {
            fs.rmSync(XLSX_FILE, { force: true });
        } catch (err) {
            console.warn(`⚠ Could not delete ${XLSX_FILE} (likely open in Excel) — leaving stale file on disk:`, err.message);
        }
        return;
    }

    const vesselRows = sortByDepart(current.vessels || []).map(v => [v.row, v.name, v.voyage, v.depart]);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
        wb,
        portsSheetWide(current.service, current.operator, current.ports || []),
        "Ports"
    );
    XLSX.utils.book_append_sheet(
        wb,
        blockSheet(current.service, current.operator, ["row", "vessel_name", "voyage", "depart"], vesselRows),
        "Vessels"
    );

    try {
        XLSX.writeFile(wb, XLSX_FILE);
    } catch (err) {
        console.warn(`⚠ Could not write ${XLSX_FILE} (likely open in Excel) — guideline updated in memory but not on disk:`, err.message);
    }
}

function persist() {
    ensureDataFolder();
    try {
        if (current) {
            fs.writeFileSync(STORE_FILE, JSON.stringify(current, null, 2));
        } else {
            fs.rmSync(STORE_FILE, { force: true });
        }
    } catch (err) {
        console.warn(`⚠ Could not update ${STORE_FILE}:`, err.message);
    }
    exportExcel();
}

// Only used to restore state across a server restart while a tab is
// still open — the tab will re-send a snapshot and reclaim ownership
// on its next debounced send regardless, this just avoids a blank
// window until then.
function loadFromDisk() {
    ensureDataFolder();
    if (!fs.existsSync(STORE_FILE)) {
        console.log("📂 No saved schedule-guideline.json yet — starting empty");
        return;
    }
    try {
        current = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
        console.log(`📂 Loaded schedule guideline for service ${current.service}`);
    } catch (err) {
        console.error("❌ Could not load schedule-guideline.json — starting empty:", err.message);
        current = null;
    }
}

function recordSnapshot(ws, { service, operator, ports, vessels, firstUsPort, firstEuPort, highlightedPort }) {
    if (!service) return;

    // A second tab of the same page while the first is still open —
    // ignore it, the first tab keeps ownership.
    if (ownerWs && ownerWs !== ws && ownerWs.readyState === ownerWs.OPEN) {
        console.log(`⏭ Ignoring schedule snapshot from a second tab (service ${service}) — first tab still owns the guideline`);
        return;
    }

    ownerWs = ws;
    current = {
        service,
        operator:   operator || "",
        ports:      ports   || [],
        vessels:    vessels || [],
        firstUsPort: firstUsPort || "",
        firstEuPort: firstEuPort || "",
        highlightedPort: highlightedPort || null,
        capturedAt: new Date().toISOString(),
    };
    persist();
    console.log(`📥 Schedule guideline built: ${service} (${current.ports.length} port row(s), ${current.vessels.length} vessel row(s))`);
}

// Called on every WebSocket close — harmless no-op for connections
// that were never the guideline owner.
function releaseIfOwner(ws) {
    if (ws !== ownerWs) return;
    console.log(`🗑 Owning tab closed — deleting guideline for ${current?.service}`);
    ownerWs = null;
    current = null;
    persist();
}

function getCurrent() {
    return current;
}

function normalizeVoyage(v) {
    return (v || "").trim().toUpperCase();
}

// Strips a trailing direction letter (N/S/E/W/...) so "2611S" and
// "2611" compare equal when the guideline itself never captured a
// direction suffix.
function coreVoyage(v) {
    return normalizeVoyage(v).replace(/[A-Z]+$/, "");
}

// Flags each extracted proof row against the currently active
// guideline's known vessels — matched by VOYAGE NUMBER ONLY (not
// vessel name, which the guideline captures bare — "SOL FORTUNE" —
// while proofs often embed a trailing direction letter in the name
// itself — "SOL FORTUNE 2611S"). If the guideline's own voyage value
// carries a direction letter, that's honored (exact match); if not,
// direction is ignored on both sides. `matchesGuideline` is null when
// there's no active guideline — distinct from false, a real mismatch.
function matchRows(rows) {
    if (!current) return rows.map(r => ({ ...r, matchesGuideline: null }));

    const known = (current.vessels || []).map(v => normalizeVoyage(v.voyage));

    return rows.map(r => {
        const voyage = normalizeVoyage(r.voyage);
        const matchesGuideline = known.some(k => {
            const guidelineHasDirection = /[A-Z]$/.test(k);
            return guidelineHasDirection ? k === voyage : coreVoyage(k) === coreVoyage(voyage);
        });
        return { ...r, matchesGuideline };
    });
}

module.exports = { recordSnapshot, releaseIfOwner, getCurrent, matchRows, loadFromDisk };
