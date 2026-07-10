// ============================================================
//  routes/relay.js — GET /service, GET /renaming
//  Read-only snapshots of relay-state, for anything that just
//  needs a quick HTTP check instead of opening a WebSocket.
// ============================================================

const relayState = require("../relay-state");

function handleGetService(req, res) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: relayState.currentServiceCode }));
}

function handleGetRenaming(req, res) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ enabled: relayState.renamingEnabled }));
}

module.exports = { handleGetService, handleGetRenaming };
