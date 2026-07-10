// ============================================================
//  config.js — shared constants
//  Machine-specific paths live here in ONE place, so moving
//  this to a different computer only means editing this file.
// ============================================================

const path = require("path");

const PORT = 3737;

const WATCH_FOLDER = "C:\\Users\\DELL\\Downloads";
const WATCH_EXTS   = [".jpg", ".jpeg", ".png", ".xlsx", ".xls", ".pdf"];

// Root folder for anything this server needs to remember across
// restarts. Structured so new features (vessel positions, future
// service planning, etc.) can each get their own file here without
// needing a new folder or a different storage mechanism.
//
//   D:\Tradetech services\
//     due-services.json          ← always the LATEST scan (dashboard reads this)
//     history\
//       due-services-2026-07-10_013800.json   ← one snapshot per scan, never overwritten
const DATA_FOLDER       = "D:\\Tradetech services";
const HISTORY_FOLDER    = path.join(DATA_FOLDER, "history");
const DUE_SERVICES_FILE = path.join(DATA_FOLDER, "due-services.json");

module.exports = {
    PORT,
    WATCH_FOLDER,
    WATCH_EXTS,
    DATA_FOLDER,
    HISTORY_FOLDER,
    DUE_SERVICES_FILE,
};
