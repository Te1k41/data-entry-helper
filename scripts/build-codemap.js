#!/usr/bin/env node
// Regenerates CODEMAP.md: a relation map of the extension (src/) and the relay
// server (service-relay/) so a session opening this repo can find "what talks
// to what" without re-reading every file.
// Usage: node scripts/build-codemap.js
// ponytail: heuristic, not a real static analyzer — src/ files share global
// scope (no ES modules), so cross-file relations are inferred from top-level
// symbol names appearing elsewhere. service-relay/ relations are real
// require() edges. Re-run after adding/removing files or renaming symbols.

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(REPO_ROOT, "src");
const RELAY_DIR = path.join(REPO_ROOT, "service-relay");
const MANIFEST_PATH = path.join(REPO_ROOT, "manifest.json");
const OUT_PATH = path.join(REPO_ROOT, "CODEMAP.md");

function walk(dir, filter) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full, filter));
        else if (filter(full)) out.push(full);
    }
    return out;
}

function rel(p, base) {
    return path.relative(base, p).split(path.sep).join("/");
}

// ---- src/: heuristic global-symbol graph -----------------------------

function topLevelSymbols(text) {
    const names = new Set();
    const patterns = [
        /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/,
        /^class\s+([A-Za-z_$][\w$]*)/,
        /^function\s+([A-Za-z_$][\w$]*)/,
        /window\.([A-Za-z_$][\w$]*)\s*=/,
    ];
    for (const line of text.split("\n")) {
        const trimmed = line.replace(/^\s+/, "");
        if (line[0] !== " " && line[0] !== "\t") {
            for (const p of patterns.slice(0, 3)) {
                const m = trimmed.match(p);
                if (m) names.add(m[1]);
            }
        }
        const winMatch = line.match(patterns[3]);
        if (winMatch) names.add(winMatch[1]);
    }
    // Drop generic/common names too likely to false-positive match unrelated files.
    const STOPWORDS = new Set(["init", "handle", "run", "config", "state", "options", "result", "data", "value"]);
    return [...names].filter((n) => !STOPWORDS.has(n));
}

function buildSrcGraph() {
    const files = walk(SRC_DIR, (f) => f.endsWith(".js")).sort();
    const nodes = files.map((f) => ({
        path: rel(f, SRC_DIR),
        text: fs.readFileSync(f, "utf8"),
    }));
    for (const n of nodes) n.defines = topLevelSymbols(n.text);

    const edges = []; // { from, to, symbol } meaning `to` uses a symbol defined in `from`
    for (const definer of nodes) {
        for (const symbol of definer.defines) {
            const re = new RegExp(`\\b${symbol}\\b`, "g");
            for (const consumer of nodes) {
                if (consumer.path === definer.path) continue;
                if (re.test(consumer.text)) edges.push({ from: definer.path, to: consumer.path, symbol });
            }
        }
    }
    return { nodes, edges };
}

// ---- service-relay/: real require() graph -----------------------------

function buildRelayGraph() {
    const files = walk(RELAY_DIR, (f) => f.endsWith(".js") && !f.includes(`${path.sep}node_modules${path.sep}`)).sort();
    const fileSet = new Set(files.map((f) => rel(f, RELAY_DIR)));
    const edges = []; // { from, to } meaning `from` requires `to`
    for (const f of files) {
        const fromRel = rel(f, RELAY_DIR);
        const text = fs.readFileSync(f, "utf8");
        const re = /require\(\s*["'](\.[^"']+)["']\s*\)/g;
        let m;
        while ((m = re.exec(text))) {
            let target = path.normalize(path.join(path.dirname(fromRel), m[1])).split(path.sep).join("/");
            let resolved = null;
            for (const candidate of [target, `${target}.js`, `${target}/index.js`]) {
                if (fileSet.has(candidate)) { resolved = candidate; break; }
            }
            edges.push({ from: fromRel, to: resolved || `${target} (external/missing)` });
        }
    }
    return { files: files.map((f) => rel(f, RELAY_DIR)), edges };
}

// ---- manifest.json wiring -----------------------------

function buildManifestTable() {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    return (manifest.content_scripts || []).map((block, i) => ({
        index: i,
        matches: block.matches || [],
        excludeMatches: block.exclude_matches || [],
        world: block.world || "ISOLATED",
        run_at: block.run_at || "document_idle",
        js: block.js || [],
    }));
}

// ---- rendering -----------------------------

function mermaidSafe(id) {
    return id.replace(/[^A-Za-z0-9_]/g, "_");
}

function renderManifestSection(blocks) {
    let out = "## manifest.json — content script wiring\n\n";
    out += "| # | matches | exclude | world | run_at | files (load order) |\n";
    out += "|---|---|---|---|---|---|\n";
    for (const b of blocks) {
        out += `| ${b.index} | ${b.matches.join(", ")} | ${b.excludeMatches.join(", ") || "-"} | ${b.world} | ${b.run_at} | ${b.js.join(" → ")} |\n`;
    }
    return out + "\n";
}

function renderSrcSection(graph) {
    let out = "## src/ — global-symbol relations (heuristic)\n\n";
    out += "Content scripts share one global scope (no ES modules). An edge means the target file references a top-level symbol the source file defines.\n\n";

    out += "```mermaid\nflowchart LR\n";
    const seenEdge = new Set();
    for (const e of graph.edges) {
        const key = `${e.from}->${e.to}`;
        if (seenEdge.has(key)) continue; // collapse multi-symbol edges to one line per file pair
        seenEdge.add(key);
        out += `  ${mermaidSafe(e.from)}["${e.from}"] --> ${mermaidSafe(e.to)}["${e.to}"]\n`;
    }
    out += "```\n\n";

    out += "| file | defines | used by |\n|---|---|---|\n";
    for (const n of graph.nodes) {
        const consumers = [...new Set(graph.edges.filter((e) => e.from === n.path).map((e) => e.to))];
        out += `| ${n.path} | ${n.defines.join(", ") || "-"} | ${consumers.join(", ") || "-"} |\n`;
    }
    return out + "\n";
}

function renderRelaySection(graph) {
    let out = "## service-relay/ — require() graph\n\n";
    out += "```mermaid\nflowchart LR\n";
    for (const e of graph.edges) {
        out += `  ${mermaidSafe(e.from)}["${e.from}"] --> ${mermaidSafe(e.to)}["${e.to}"]\n`;
    }
    out += "```\n\n";

    out += "| file | requires | required by |\n|---|---|---|\n";
    for (const f of graph.files) {
        const requires = graph.edges.filter((e) => e.from === f).map((e) => e.to);
        const requiredBy = graph.edges.filter((e) => e.to === f).map((e) => e.from);
        out += `| ${f} | ${requires.join(", ") || "-"} | ${requiredBy.join(", ") || "-"} |\n`;
    }
    return out + "\n";
}

function main() {
    const manifestBlocks = buildManifestTable();
    const srcGraph = buildSrcGraph();
    const relayGraph = buildRelayGraph();

    let out = "# Codemap (auto-generated)\n\n";
    out += "> Generated by `node scripts/build-codemap.js`. Do not hand-edit — edit the script, then regenerate.\n";
    out += "> src/ relations are a heuristic (shared-global-scope symbol usage); service-relay/ relations are real `require()` edges.\n\n";
    out += renderManifestSection(manifestBlocks);
    out += renderSrcSection(srcGraph);
    out += renderRelaySection(relayGraph);

    fs.writeFileSync(OUT_PATH, out);
    console.log(`Wrote ${rel(OUT_PATH, REPO_ROOT)} (${srcGraph.nodes.length} src files, ${relayGraph.files.length} relay files, ${srcGraph.edges.length + relayGraph.edges.length} edges)`);
}

main();
