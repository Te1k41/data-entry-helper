// ============================================================
//  port-dictionary.js
//  Per-operator dictionary mapping a carrier's own port label
//  text (e.g. ONE's "(N) KOBE, HYOGO") to tradetech's canonical
//  port code (e.g. "UKB"). Starts empty, grows permanently as
//  real proofs get processed — lookup() returns null for an
//  unmapped label (surfaced for a human to resolve once via
//  learn()), never guesses.
// ============================================================

const fs   = require("fs");
const path = require("path");
const { DATA_FOLDER } = require("./config");

const STORE_FILE = path.join(DATA_FOLDER, "port-dictionary.json");

let dictionary = {}; // { [operator]: { [rawLabel]: portCode } }

function ensureDataFolder() {
    if (!fs.existsSync(DATA_FOLDER)) fs.mkdirSync(DATA_FOLDER, { recursive: true });
}

function persist() {
    ensureDataFolder();
    try {
        fs.writeFileSync(STORE_FILE, JSON.stringify(dictionary, null, 2));
    } catch (err) {
        console.warn(`⚠ Could not write ${STORE_FILE}:`, err.message);
    }
}

function loadFromDisk() {
    ensureDataFolder();
    if (!fs.existsSync(STORE_FILE)) {
        console.log("📂 No saved port-dictionary.json yet — starting empty");
        return;
    }
    try {
        dictionary = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
        const total = Object.values(dictionary).reduce((sum, ops) => sum + Object.keys(ops).length, 0);
        console.log(`📂 Loaded port dictionary — ${total} learned label(s) across ${Object.keys(dictionary).length} operator(s)`);
    } catch (err) {
        console.error("❌ Could not load port-dictionary.json — starting empty:", err.message);
        dictionary = {};
    }
}

// "(W) JEBEL ALI" / "(E) JEBEL ALI" → "JEBEL ALI" — same physical
// port, different leg direction. Stripping this lets one direction's
// learned mapping auto-resolve every other direction of the same
// port, with no separate manual entry needed per direction.
function stripDirection(label) {
    return String(label || "").replace(/^\(\s*[NSEW]\s*\)\s*/i, "").trim().toUpperCase();
}

// Space/punctuation shouldn't make the same physical port count as two
// different unmapped labels across carriers — "(W) JEBEL ALI" and
// "Jebel Ali, UAE" should read as the same port even though one carries
// a country suffix the other doesn't. Compare as WORD SETS: one side
// matches if every word it has appears in the other (a plain "NANSHA"
// is a match for "NANSHA, CHINA", country suffix and all).
function wordSet(label) {
    return new Set(
        stripDirection(label)
            .split(/[^A-Z0-9]+/i)
            .map(w => w.toUpperCase())
            .filter(Boolean)
    );
}

function isSubset(small, large) {
    for (const w of small) if (!large.has(w)) return false;
    return true;
}

function wordsMatch(a, b) {
    const wa = wordSet(a), wb = wordSet(b);
    if (wa.size === 0 || wb.size === 0) return false;
    return isSubset(wa, wb) || isSubset(wb, wa);
}

// A port is the same physical place no matter which carrier's schedule
// you're reading — if operator X has never had this label learned but
// operator Y already mapped the same port (just spelled/formatted
// differently), reuse Y's code instead of asking you to re-enter it.
function lookupAnyOperator(rawLabel) {
    if (!String(rawLabel || "").trim()) return null;
    for (const known of Object.values(dictionary)) {
        for (const [label, code] of Object.entries(known)) {
            if (wordsMatch(rawLabel, label)) return code;
        }
    }
    return null;
}

// Returns the tradetech port code for this operator's raw label, or
// null if never learned anywhere. Checks the exact label first, then
// any other direction-variant of the same port name THIS operator has
// already learned, then falls back to any OTHER operator's mapping of
// the same physical port (global reference, see lookupAnyOperator).
function lookup(operator, rawLabel) {
    const known = dictionary[operator] || {};
    if (rawLabel in known) return known[rawLabel];

    const target = stripDirection(rawLabel);
    if (target) {
        for (const [label, code] of Object.entries(known)) {
            if (stripDirection(label) === target) return code;
        }
    }

    return lookupAnyOperator(rawLabel);
}

// Permanently remembers rawLabel → portCode for this operator.
function learn(operator, rawLabel, portCode) {
    if (!operator || !rawLabel || !portCode) return;
    if (!dictionary[operator]) dictionary[operator] = {};
    dictionary[operator][rawLabel] = portCode;
    persist();
    console.log(`🧠 Learned port mapping: ${operator} "${rawLabel}" → ${portCode}`);
}

// Every raw label seen in `proofPortLabels` that this operator has no
// mapping for yet (including via the direction-variant fallback) —
// what a result file should surface for a human to resolve once via
// learn().
function findUnmapped(operator, proofPortLabels) {
    return [...new Set(proofPortLabels)].filter(label => lookup(operator, label) === null);
}

module.exports = { lookup, learn, findUnmapped, loadFromDisk };
