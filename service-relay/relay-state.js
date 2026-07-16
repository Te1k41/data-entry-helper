// ============================================================
//  relay-state.js
//  Shared in-memory state for the service-code / renaming-toggle
//  relay. Exported as a plain mutable object (not getters/setters)
//  so every module that needs it (`relay-socket.js`, `routes/relay.js`,
//  `download-watcher.js`, `merge-cleanup.js`) sees the same live
//  values just by requiring this file — no wiring needed.
// ============================================================

module.exports = {
    currentServiceCode: "",
    renamingEnabled: true,
    toolbarCollapsed: false,
};