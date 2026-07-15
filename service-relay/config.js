// ============================================================
//  config.js — shared constants
//  User-editable values (folder paths, your Tradetech username)
//  now live in settings-store.js / settings.json — see the
//  settings page at http://localhost:3737/settings. This file
//  reads those in, plus a couple of fixed constants that aren't
//  meant to be user-configurable.
// ============================================================

const path = require("path");
const settingsStore = require("./settings-store");

const settings = settingsStore.load();

const PORT = 3737;

const WATCH_FOLDER = settings.watchFolder;
const WATCH_EXTS   = [".jpg", ".jpeg", ".png", ".xlsx", ".xls", ".pdf"];

// Root folder for anything this server needs to remember across
// restarts. Structured so new features (vessel positions, future
// service planning, etc.) can each get their own file here without
// needing a new folder or a different storage mechanism.
const DATA_FOLDER       = settings.dataFolder;
const HISTORY_FOLDER    = path.join(DATA_FOLDER, "history");
const DUE_SERVICES_FILE = path.join(DATA_FOLDER, "due-services.json");
const ACTIVITY_LOG_FILE = path.join(DATA_FOLDER, "activity-log.json");
const CURRENT_BATCH_FILE = path.join(DATA_FOLDER, "current-batch.json");

module.exports = {
    PORT,
    WATCH_FOLDER,
    WATCH_EXTS,
    DATA_FOLDER,
    HISTORY_FOLDER,
    DUE_SERVICES_FILE,
    ACTIVITY_LOG_FILE,
    CURRENT_BATCH_FILE,
};