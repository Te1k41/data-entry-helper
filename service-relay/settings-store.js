// ============================================================
//  settings-store.js
//  User-editable settings, separate from config.js's fixed
//  constants. Defaults are auto-detected via os.homedir() so
//  this works correctly for ANY Windows user account out of
//  the box — the old hardcoded "C:\Users\DELL\Downloads" only
//  ever worked on one specific machine/account.
//
//  Stored as settings.json, co-located with server.js (NOT
//  inside DATA_FOLDER — that would be a chicken-and-egg
//  problem, since dataFolder itself is one of the settings).
// ============================================================

const fs   = require("fs");
const os   = require("os");
const path = require("path");

const SETTINGS_FILE = path.join(__dirname, "settings.json");

function defaultSettings() {
    const home = os.homedir();
    return {
        watchFolder:    path.join(home, "Downloads"),
        dataFolder:     path.join(home, "Documents", "Tradetech Services"),
        assignedToName: "",
    };
}

// Merges saved settings over the defaults, so any NEW setting added
// later automatically has a sensible value even for someone who
// saved their settings.json before that field existed.
function load() {
    const defaults = defaultSettings();

    if (!fs.existsSync(SETTINGS_FILE)) {
        save(defaults); // create it immediately so it's inspectable/editable by hand too
        return defaults;
    }

    try {
        const raw    = fs.readFileSync(SETTINGS_FILE, "utf8");
        const parsed = JSON.parse(raw);
        return { ...defaults, ...parsed };
    } catch (err) {
        console.error("❌ Could not read settings.json — using defaults:", err.message);
        return defaults;
    }
}

function save(partialSettings) {
    const current = fs.existsSync(SETTINGS_FILE)
        ? { ...defaultSettings(), ...JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) }
        : defaultSettings();

    const merged = { ...current, ...partialSettings };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2));
    console.log("⚙️ Settings saved:", merged);
    return merged;
}

module.exports = { load, save, defaultSettings };