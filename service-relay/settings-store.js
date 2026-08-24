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
//
//  watchFolder/dataFolder are stored per-platform (keyed by
//  process.platform) because this repo lives on a drive that
//  gets opened from both Windows and Linux — a flat path would
//  get clobbered every time the other OS saved its settings.
// ============================================================

const fs   = require("fs");
const os   = require("os");
const path = require("path");

const SETTINGS_FILE = path.join(__dirname, "settings.json");
const PLATFORM_KEYS = ["watchFolder", "dataFolder"];

function defaultPathsForPlatform() {
    const home = os.homedir();
    return {
        watchFolder: path.join(home, "Downloads"),
        dataFolder:  path.join(home, "Documents", "Tradetech Services"),
    };
}

function defaultSettings() {
    return {
        ...defaultPathsForPlatform(),
        assignedToName: "",
    };
}

// Raw on-disk shape: assignedToName is flat, watchFolder/dataFolder
// are objects keyed by process.platform, e.g. { win32: "...", linux: "..." }.
// A legacy flat-string value (from before per-platform storage) is treated
// as belonging to whichever platform saved it last and migrated on next save.
function readRaw() {
    if (!fs.existsSync(SETTINGS_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    } catch (err) {
        console.error("❌ Could not read settings.json — using defaults:", err.message);
        return {};
    }
}

// Merges saved settings over the defaults, so any NEW setting added
// later automatically has a sensible value even for someone who
// saved their settings.json before that field existed.
function load() {
    const raw = readRaw();
    if (Object.keys(raw).length === 0) {
        const defaults = defaultSettings();
        save(defaults); // create it immediately so it's inspectable/editable by hand too
        return defaults;
    }

    const defaults = defaultSettings();
    const resolved = {
        assignedToName: typeof raw.assignedToName === "string" ? raw.assignedToName : defaults.assignedToName,
    };

    for (const key of PLATFORM_KEYS) {
        const stored = raw[key];
        if (stored && typeof stored === "object") {
            resolved[key] = stored[process.platform] || defaults[key];
        } else if (typeof stored === "string" && stored) {
            resolved[key] = stored; // legacy flat value, migrated on next save
        } else {
            resolved[key] = defaults[key];
        }
    }

    return resolved;
}

function save(partialSettings) {
    const raw = readRaw();
    const merged = { assignedToName: "", ...raw };

    if (typeof partialSettings.assignedToName === "string") {
        merged.assignedToName = partialSettings.assignedToName;
    } else if (typeof raw.assignedToName === "string") {
        merged.assignedToName = raw.assignedToName;
    }

    for (const key of PLATFORM_KEYS) {
        const existing = raw[key];
        const byPlatform = existing && typeof existing === "object" ? { ...existing } : {};
        if (typeof partialSettings[key] === "string") {
            byPlatform[process.platform] = partialSettings[key];
        } else if (typeof existing === "string" && existing && !byPlatform[process.platform]) {
            byPlatform[process.platform] = existing; // migrate legacy flat value
        }
        merged[key] = byPlatform;
    }

    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2));
    console.log("⚙️ Settings saved:", merged);

    return load();
}

module.exports = { load, save, defaultSettings };