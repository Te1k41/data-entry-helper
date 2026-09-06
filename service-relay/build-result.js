// ============================================================
//  build-result.js
//  Writes result.xlsx from a proof extraction: every raw port
//  label seen (with its current dictionary code, if mapped) and
//  every distinct vessel/voyage seen — plain listings for the
//  dashboard's port/vessel-code learning workflow. No rotation/
//  anchor-vessel picking, no per-port Fill comparison — that
//  calculation was unreliable in practice and got scrapped.
// ============================================================

const fs   = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const { DATA_FOLDER } = require("./config");
const scheduleGuidelineStore = require("./schedule-guideline-store");
const portDictionary = require("./port-dictionary");

const RESULT_FILE = path.join(DATA_FOLDER, "result.xlsx");

// "SOL FORTUNE 2611S" → "SOL FORTUNE" — the ship name without its
// trailing voyage+direction suffix, so different voyages of the same
// physical vessel can be recognized as the same ship.
function baseVesselName(raw) {
    const m = String(raw || "").trim().match(/^(.*?)\s+\d+[A-Z]?$/i);
    return m ? m[1].trim() : String(raw || "").trim();
}

// Every distinct raw port label this operator's proof used, with
// whatever code is currently mapped (blank if none) — not just the
// unmapped ones. An already-mapped label can still be WRONG (a bad
// guess, a since-corrected code), so it needs to stay editable here
// too, not disappear once it has any code at all.
function portsSheet(guideline, proofRows) {
    const allLabels = [...new Set(proofRows.map(r => r.port).filter(Boolean))];
    const unmappedCount = portDictionary.findUnmapped(guideline.operator, allLabels).length;

    const aoa = [["operator", "raw_port_label", "port_code"]];
    for (const label of allLabels) {
        aoa.push([guideline.operator, label, portDictionary.lookup(guideline.operator, label) || ""]);
    }
    if (allLabels.length === 0) aoa.push(["(no port labels found in this proof)"]);
    return { sheet: XLSX.utils.aoa_to_sheet(aoa), count: unmappedCount };
}

// Every distinct vessel/voyage pair seen anywhere in the proof, one row
// per ship (its own earliest known departure). Plain listing — no
// anchor picking, no chronology check.
function vesselsSheet(proofRows) {
    const aoa = [["vessel", "voyage", "departure_date"]];

    const byShip = new Map(); // baseName -> Map(voyage -> {vessel, voyage, dep})
    for (const r of proofRows) {
        const base = baseVesselName(r.vessel);
        if (!byShip.has(base)) byShip.set(base, new Map());
        const voyages = byShip.get(base);
        if (!voyages.has(r.voyage)) voyages.set(r.voyage, { vessel: r.vessel, voyage: r.voyage, dep: r.etd || r.eta || "" });
    }

    for (const voyages of byShip.values()) {
        for (const v of voyages.values()) aoa.push([baseVesselName(v.vessel), v.voyage, v.dep]);
    }
    if (aoa.length === 1) aoa.push(["(no vessels found in this proof)"]);
    return XLSX.utils.aoa_to_sheet(aoa);
}

// Builds and writes result.xlsx. Best-effort on the write (locked
// file in Excel logs a warning, doesn't throw) — same pattern as
// the guideline and extracted-proofs writers.
function buildResult(proofRows) {
    const guideline = scheduleGuidelineStore.getCurrent();
    if (!guideline) {
        throw new Error("No active guideline — open the service's schedule page in Tradetech first.");
    }

    const ports = portsSheet(guideline, proofRows);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ports.sheet, "Ports");
    XLSX.utils.book_append_sheet(wb, vesselsSheet(proofRows), "Vessels");

    fs.mkdirSync(path.dirname(RESULT_FILE), { recursive: true });
    try {
        XLSX.writeFile(wb, RESULT_FILE);
    } catch (err) {
        console.warn(`⚠ Could not write ${RESULT_FILE} (likely open in Excel):`, err.message);
        return null;
    }

    return { unmappedCount: ports.count };
}

// Reads the "Ports" sheet back out of result.xlsx — any row with a
// port code (whether newly filled in or an edited correction to an
// already-mapped one) gets (re-)learned.
function importUnmappedFromResult() {
    if (!fs.existsSync(RESULT_FILE)) return 0;

    const wb = XLSX.readFile(RESULT_FILE);
    const sheet = wb.Sheets["Ports"];
    if (!sheet) return 0;

    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
    let learned = 0;
    for (const row of rows.slice(1)) {
        const [operator, rawLabel, portCode] = row;
        if (!operator || !rawLabel || !portCode) continue;
        portDictionary.learn(operator, rawLabel, portCode);
        learned++;
    }
    return learned;
}

// Reads the Vessels + Ports sheets back out of result.xlsx as plain
// JSON, for the dashboard's ports.html page to consume.
function readResultForFill() {
    if (!fs.existsSync(RESULT_FILE)) return null;

    const wb = XLSX.readFile(RESULT_FILE);
    const vesselsSheetData = wb.Sheets["Vessels"];
    const portsSheetData   = wb.Sheets["Ports"];

    const vessels = vesselsSheetData
        ? XLSX.utils.sheet_to_json(vesselsSheetData, { raw: false, defval: "" })
        : [];
    // Placeholder rows ("(no port labels found...)") have no raw_port_label —
    // filter those out.
    const ports = portsSheetData
        ? XLSX.utils.sheet_to_json(portsSheetData, { raw: false, defval: "" }).filter(r => r.raw_port_label)
        : [];
    const unmapped = ports.filter(r => !r.port_code);

    return { vessels, ports, unmapped };
}

module.exports = { buildResult, importUnmappedFromResult, readResultForFill, RESULT_FILE, baseVesselName };
