// ============================================================
//  vessel-dictionary.js
//  Vessel name → Lloyds Code. Flat and global, NOT per-operator —
//  a vessel is the same physical ship regardless of which carrier's
//  service it's currently running, unlike port-dictionary.js's raw
//  labels (which genuinely vary per carrier).
// ============================================================

const fs   = require("fs");
const path = require("path");
const { DATA_FOLDER } = require("./config");

const STORE_FILE = path.join(DATA_FOLDER, "vessel-dictionary.json");

let dictionary = {}; // { [normalizedVesselName]: lloydsCode }

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
        console.log("📂 No saved vessel-dictionary.json yet — starting empty");
        return;
    }
    try {
        dictionary = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
        console.log(`📂 Loaded vessel dictionary — ${Object.keys(dictionary).length} vessel(s)`);
    } catch (err) {
        console.error("❌ Could not load vessel-dictionary.json — starting empty:", err.message);
        dictionary = {};
    }
}

// "Sol Fortune " -> "SOL FORTUNE" — same physical ship regardless of a
// proof's own capitalization/whitespace quirks. Keeps a single space
// between words so the dictionary/dashboard stay readable.
function normalize(vesselName) {
    return String(vesselName || "").replace(/\s+/g, " ").trim().toUpperCase();
}

// Space count/placement shouldn't make two entries for the same ship —
// a proof's own quirks (a wrapped PDF cell, an extra space) shouldn't
// cause a miss. Used only for COMPARING, never as the stored key, so the
// dashboard still shows a readable name.
function matchKey(vesselName) {
    return normalize(vesselName).replace(/\s+/g, "");
}

function findKey(vesselName) {
    const target = matchKey(vesselName);
    return Object.keys(dictionary).find(key => matchKey(key) === target) || null;
}

function lookup(vesselName) {
    const key = findKey(vesselName);
    return key ? dictionary[key] : null;
}

function learn(vesselName, lloydsCode) {
    if (!vesselName || !lloydsCode) return;
    // Reuse an existing (possibly differently-spaced) entry for the same
    // ship instead of creating a near-duplicate key.
    const key = findKey(vesselName) || normalize(vesselName);
    dictionary[key] = String(lloydsCode).trim();
    persist();
    console.log(`🧠 Learned vessel: "${key}" → ${lloydsCode}`);
}

function remove(vesselName) {
    const key = findKey(vesselName);
    if (key) delete dictionary[key];
    persist();
}

function getAll() {
    return { ...dictionary };
}

module.exports = { lookup, learn, remove, getAll, loadFromDisk };
