// ============================================================
//  relay-state.js
//  Shared in-memory state for the service-code / renaming-toggle
//  relay. Exported as a plain mutable object (not getters/setters)
//  so every module that needs it (`relay-socket.js`, `routes/relay.js`,
//  `download-watcher.js`, `merge-cleanup.js`) sees the same live
//  values just by requiring this file — no wiring needed.
//
//  renamingEnabled and toolbarCollapsed are persisted to disk
//  (relay-state.json) — without this, every server restart silently
//  reset them back to their hardcoded defaults while every already-
//  open tab kept showing whatever was last actually set, a real
//  function/UI mismatch users hit. relay-socket.js calls save()
//  right after each mutation. currentServiceCode is deliberately
//  NOT persisted — it's a transient "what am I working on right
//  now" value, and going blank after a restart is an honest reset,
//  not a wrong answer.
// ============================================================

const fs   = require("fs");
const path = require("path");
const { DATA_FOLDER } = require("./config");

const STATE_FILE = path.join(DATA_FOLDER, "relay-state.json");

function loadPersisted() {
    try {
        if (!fs.existsSync(STATE_FILE)) return {};
        return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    } catch (err) {
        console.error("❌ Could not read relay-state.json — using defaults:", err.message);
        return {};
    }
}

const persisted = loadPersisted();

module.exports = {
    currentServiceCode: "",
    renamingEnabled:  persisted.renamingEnabled  !== undefined ? persisted.renamingEnabled  : true,
    toolbarCollapsed: persisted.toolbarCollapsed !== undefined ? persisted.toolbarCollapsed : false,

    save() {
        try {
            if (!fs.existsSync(DATA_FOLDER)) fs.mkdirSync(DATA_FOLDER, { recursive: true });
            fs.writeFileSync(STATE_FILE, JSON.stringify({
                renamingEnabled:  this.renamingEnabled,
                toolbarCollapsed: this.toolbarCollapsed,
            }, null, 2));
        } catch (err) {
            console.error("❌ Could not save relay-state.json:", err.message);
        }
    },
};
