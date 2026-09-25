// ============================================================
//  highlight-replay.js
//  Re-runs the extension's REAL port-highlighting logic (../src/core/boundary.js +
//  ../src/features/port-highlighting.js) against a stored Highlight Review item, so a
//  logic change can be judged on every captured route without re-capturing them.
//  A stored item holds everything the logic reads: service and each port's name/code/key.
//
//  One jsdom window is built per createReplayer() and its body is swapped per item;
//  jsdom is required lazily (same cold-boot reasoning as the proof parsers).
// ============================================================

const fs   = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "src");
const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function createReplayer() {
    const { JSDOM, VirtualConsole } = require("jsdom");
    const read = f => fs.readFileSync(path.join(SRC, f), "utf8");

    // No sendTo(): the logic's console.log chatter stays out of the server log.
    const dom = new JSDOM("<html><body></body></html>", { runScripts: "outside-only", virtualConsole: new VirtualConsole() });
    const { PortHighlighting, PortSyncBoundary } = dom.window.eval(
        `${read("core/boundary.js")}\n;${read("features/port-highlighting.js")}\n;({ PortHighlighting, PortSyncBoundary });`
    );

    const input = (name, value) => `<input type="text" name="${esc(name)}" value="${esc(value)}">`;

    // -> { row: "005" | null, special: boolean, directional: boolean }
    return function replay(item) {
        dom.window.document.body.innerHTML = [
            input("service", item.service),
            ...item.ports.map(p => [
                input(`SP${p.row}_port_name`, p.name),
                input(`SP${p.row}_port_code`, p.code),
                input(`SP${p.row}_port_key`,  p.key),
            ].join("")),
        ].join("");

        PortHighlighting.run();
        const field = PortHighlighting.currentHighlightField;
        return {
            row:         field ? field.name.match(/^SP(\d+)_/)[1] : null,
            special:     Boolean(PortHighlighting.hasSpecialPort),
            directional: PortSyncBoundary.isDirectionalService(),
        };
    };
}

module.exports = { createReplayer };
