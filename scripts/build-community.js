#!/usr/bin/env node
// Build from current source, without duplicate overrides.
// Usage: node scripts/build-community.js [outDir]
// outDir defaults to community-version/ and is resolved relative to this repo.

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const runFile = promisify(execFile);

const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.resolve(REPO_ROOT, process.argv[2] || "community-version");
const SRC_DIR = path.join(REPO_ROOT, "src");
const OUTPUT_SRC = path.join(OUT_DIR, "src");
const MANIFEST_SRC = path.join(REPO_ROOT, "manifest.json");
const README_TEMPLATE = path.join(REPO_ROOT, "docs", "community-readme-template.md");
const FEATURES_TEMPLATE = path.join(REPO_ROOT, "docs", "community-features-template.md");

const RELAY_FILE_PATTERN = /-relay\.js$/;
const LEGACY_RELAY_FILES = new Set([
    "utils/relay-socket-client.js", // Shared relay transport; keep its established name.
    "utils/button.js", // Generic legacy helper, but its only real caller is the relay rename toggle.
]);
const PERSONAL_EXCLUSIONS = new Set([
    "features/tradetech-stars.js", // No relay ties: excluded only for a personal/cosmetic reason.
]);

function srcPath(relativePath) {
    return relativePath.split(path.sep).join("/");
}

function isExcludedSrcPath(relativePath) {
    const rel = srcPath(relativePath);
    return RELAY_FILE_PATTERN.test(rel) || LEGACY_RELAY_FILES.has(rel) || PERSONAL_EXCLUSIONS.has(rel);
}

let failures = 0;
function fail(message) { console.error(`✗ ${message}`); failures++; }
function ok(message) { console.log(`✓ ${message}`); }

function walkFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
        .flatMap(entry => {
            const full = path.join(dir, entry.name);
            if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in build tree: ${full}`);
            return entry.isDirectory() ? walkFiles(full) : [full];
        });
}

function cleanOutput() {
    // outDir is recursively replaced. Reject paths that would erase this
    // checkout or its source inputs, including symlink aliases.
    let existing = OUT_DIR;
    while (!fs.existsSync(existing)) existing = path.dirname(existing);
    const resolved = path.resolve(fs.realpathSync(existing), path.relative(existing, OUT_DIR));
    const contains = (parent, child) => {
        const rel = path.relative(parent, child);
        return rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel));
    };
    const protectedDirs = ["src", "scripts", "docs", ".git", "service-relay"].map(p => path.join(REPO_ROOT, p));
    if (contains(resolved, REPO_ROOT) || protectedDirs.some(p => contains(p, resolved) || contains(resolved, p))) {
        throw new Error(`Unsafe output directory overlaps the repo or build inputs: ${OUT_DIR}`);
    }
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
    fs.mkdirSync(OUT_DIR, { recursive: true });
    ok(`Cleaned ${path.relative(REPO_ROOT, OUT_DIR)}/`);
}

function copyDistribution() {
    fs.cpSync(SRC_DIR, OUTPUT_SRC, { recursive: true });
    fs.copyFileSync(MANIFEST_SRC, path.join(OUT_DIR, "manifest.json"));
    fs.copyFileSync(README_TEMPLATE, path.join(OUT_DIR, "README.md"));
    fs.copyFileSync(FEATURES_TEMPLATE, path.join(OUT_DIR, "FEATURES.md"));
    ok("Copied manifest.json, src/, README.md, FEATURES.md");
}

function removeExcludedFiles() {
    let removed = 0;
    for (const file of walkFiles(OUTPUT_SRC)) {
        if (!isExcludedSrcPath(path.relative(OUTPUT_SRC, file))) continue;
        fs.rmSync(file);
        removed++;
    }
    ok(`Removed ${removed} excluded source file(s) (relay convention, legacy helpers, personal exclusions)`);
}

function derivedManifest(source) {
    const manifest = JSON.parse(source);
    manifest.content_scripts = (manifest.content_scripts || []).map(block => ({
        ...block,
        js: (block.js || []).filter(p => !isExcludedSrcPath(p.replace(/^src\//, ""))),
    })).filter(block => block.js.length > 0);
    manifest.name = "TTHelper-SC — Community Edition";
    return manifest;
}

function stripBackgroundRelayImport(source) {
    const pattern = /^importScripts\("background-relay\.js"\);(?:\r?\n|$)/gm;
    if ([...source.matchAll(pattern)].length !== 1) {
        throw new Error('src/background.js must contain exactly one standalone importScripts("background-relay.js"); line');
    }
    return source.replace(pattern, "");
}

function parseFeatures(source) {
    const matches = [...source.matchAll(/\bconst\s+FEATURES\s*=\s*\[([\s\S]*?)\]\s*;/g)];
    if (matches.length !== 1) throw new Error("Expected exactly one const FEATURES = [...] array in src/main.js");
    const match = matches[0];
    const start = match.index + match[0].indexOf("[") + 1;
    const body = match[1];
    // Bare identifiers and comments only. Mask comments without moving offsets.
    const masked = body.replace(/\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g, s => s.replace(/[^\r\n]/g, " "));
    if (!/^\s*(?:[A-Za-z_$][\w$]*\s*(?:,\s*[A-Za-z_$][\w$]*\s*)*,?\s*)?$/.test(masked)) {
        throw new Error("FEATURES must contain only bare identifiers; expressions/spreads require an explicit build update");
    }
    const tokens = [...masked.matchAll(/[A-Za-z_$][\w$]*/g)];
    const ids = tokens.map(t => t[0]);
    if (new Set(ids).size !== ids.length) throw new Error("Duplicate FEATURES identifiers are ambiguous");
    return { start, end: start + body.length, body, masked, ids, tokens };
}

function declaringFiles(root, id) {
    // Flat, top-level declarations: do not mistake nested locals for globals.
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^(?:(?:const|let|var)\\s+${escaped}\\s*=|(?:async\\s+)?function\\s+${escaped}\\s*\\()`, "m");
    return walkFiles(root).filter(p => p.endsWith(".js") && pattern.test(fs.readFileSync(p, "utf8")))
        .map(p => srcPath(path.relative(root, p)));
}

function generatedMain(source) {
    const parsed = parseFeatures(source);
    const dropped = new Set();
    for (const id of parsed.ids) {
        const shipped = declaringFiles(OUTPUT_SRC, id);
        if (shipped.length > 1) throw new Error(`Ambiguous FEATURES declaration for ${id}: ${shipped.join(", ")}`);
        if (shipped.length === 1) continue;
        const original = declaringFiles(SRC_DIR, id);
        if (original.length !== 1 || !isExcludedSrcPath(original[0])) {
            throw new Error(`Cannot safely drop FEATURES identifier ${id}: expected one declaration in an excluded source file, found ${original.join(", ") || "none"}`);
        }
        dropped.add(id);
    }

    // Retain comments and original EOLs. Fail rather than remove other entries
    // if the registry's current one-identifier-per-line layout changes.
    let body = parsed.body;
    for (const token of [...parsed.tokens].reverse()) {
        if (!dropped.has(token[0])) continue;
        const start = parsed.body.lastIndexOf("\n", token.index) + 1;
        const newline = parsed.body.indexOf("\n", token.index);
        const end = newline === -1 ? parsed.body.length : newline + 1;
        const line = parsed.masked.slice(start, end).trim();
        if (line !== token[0] && line !== token[0] + ",") {
            throw new Error(`Cannot safely remove ${token[0]}: place each FEATURES identifier on its own line`);
        }
        body = body.slice(0, start) + body.slice(end);
    }
    return { source: source.slice(0, parsed.start) + body + source.slice(parsed.end), dropped: [...dropped] };
}

function applyTransforms() {
    const manifestPath = path.join(OUT_DIR, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(derivedManifest(fs.readFileSync(manifestPath, "utf8")), null, 2) + "\n");
    const backgroundPath = path.join(OUTPUT_SRC, "background.js");
    fs.writeFileSync(backgroundPath, stripBackgroundRelayImport(fs.readFileSync(backgroundPath, "utf8")));
    const main = generatedMain(fs.readFileSync(path.join(SRC_DIR, "main.js"), "utf8"));
    fs.writeFileSync(path.join(OUTPUT_SRC, "main.js"), main.source);
    ok("Derived manifest.json and removed the background relay import");
    ok(`Generated FEATURES array; dropped ${main.dropped.length} excluded identifier(s): ${main.dropped.join(", ") || "none"}`);
}

async function checkSyntax() {
    const files = walkFiles(OUTPUT_SRC).filter(p => p.endsWith(".js"));
    const before = failures;
    for (const file of files) {
        try {
            await runFile(process.execPath, ["--check", file]);
        } catch (err) {
            fail(`Syntax error: ${path.relative(OUT_DIR, file)}\n${err.stderr || err.message}`);
        }
    }
    if (failures === before) ok(`node --check passed for ${files.length} JS file(s)`);
}

function checkManifest() {
    const manifest = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "manifest.json"), "utf8"));
    ok("manifest.json parses as valid JSON");
    const before = failures;
    const expected = derivedManifest(fs.readFileSync(MANIFEST_SRC, "utf8"));
    if (JSON.stringify(manifest) !== JSON.stringify(expected)) fail("manifest.json differs from the specified source-derived manifest");
    const referenced = [manifest.background?.service_worker, ...manifest.content_scripts.flatMap(b => b.js)].filter(Boolean);
    for (const rel of referenced) {
        if (!fs.existsSync(path.join(OUT_DIR, rel))) fail(`manifest.json references a missing file: ${rel}`);
    }
    if (failures === before) ok(`All ${referenced.length} manifest-referenced script paths resolve`);
}

function checkFeatureReferencesResolve() {
    const manifest = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "manifest.json"), "utf8"));
    const blocks = manifest.content_scripts.filter(b => b.js.includes("src/main.js"));
    if (!blocks.length) throw new Error("No manifest bundle loads the generated src/main.js");
    const parsed = parseFeatures(fs.readFileSync(path.join(OUTPUT_SRC, "main.js"), "utf8"));
    const before = failures;
    for (const id of parsed.ids) {
        const declarations = declaringFiles(OUTPUT_SRC, id);
        for (const block of blocks) {
            const preceding = block.js.slice(0, block.js.indexOf("src/main.js"));
            if (declarations.length !== 1 || !preceding.includes("src/" + declarations[0])) {
                fail(`FEATURES identifier ${id} must be declared by exactly one shipped script loaded before main.js`);
            }
        }
    }
    if (failures === before) ok(`All ${parsed.ids.length} FEATURES identifiers are declared before main.js in the shipped bundle`);
}

function checkParity() {
    const before = failures;
    let passThrough = 0;
    for (const sourceFile of walkFiles(SRC_DIR)) {
        const rel = srcPath(path.relative(SRC_DIR, sourceFile));
        if (isExcludedSrcPath(rel)) continue;
        const outputFile = path.join(OUTPUT_SRC, rel);
        if (!fs.existsSync(outputFile)) { fail(`Missing from output: src/${rel}`); continue; }
        const original = fs.readFileSync(sourceFile);
        let expected = original;
        if (rel === "background.js") expected = Buffer.from(stripBackgroundRelayImport(original.toString("utf8")));
        else if (rel === "main.js") expected = Buffer.from(generatedMain(original.toString("utf8")).source);
        else passThrough++;
        if (!expected.equals(fs.readFileSync(outputFile))) fail(`Unexpected change from source: src/${rel}`);
    }
    for (const outputFile of walkFiles(OUTPUT_SRC)) {
        const rel = path.relative(OUTPUT_SRC, outputFile);
        if (!fs.existsSync(path.join(SRC_DIR, rel))) fail(`Unexpected output file: src/${rel}`);
    }
    if (failures === before) {
        ok(`${passThrough} pass-through file(s) match source src/ byte-for-byte`);
        ok("background.js differs only by its relay import; main.js differs only by excluded FEATURES entries");
    }
}

function checkExclusionsApplied() {
    const excluded = walkFiles(SRC_DIR).filter(p => isExcludedSrcPath(path.relative(SRC_DIR, p)));
    const before = failures;
    for (const file of excluded) {
        const rel = path.relative(SRC_DIR, file);
        if (fs.existsSync(path.join(OUTPUT_SRC, rel))) fail(`Excluded file still present: src/${rel}`);
    }
    for (const file of walkFiles(OUTPUT_SRC)) {
        if (isExcludedSrcPath(path.relative(OUTPUT_SRC, file))) fail(`Excluded file leaked into output: ${file}`);
    }
    if (failures === before) ok(`All ${excluded.length} excluded source file(s) are absent from the output`);
}

function checkNoServerRelayDependency() {
    const before = failures;
    for (const file of walkFiles(OUTPUT_SRC).filter(p => p.endsWith(".js"))) {
        fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
            const refIndex = line.indexOf("service-relay/");
            if (refIndex === -1) return;
            const trimmed = line.trim(), commentIndex = line.indexOf("//");
            const isComment = trimmed.startsWith("*") || trimmed.startsWith("/*")
                || (commentIndex !== -1 && commentIndex < refIndex);
            if (!isComment) fail(`Non-comment "service-relay/" reference: ${path.relative(OUT_DIR, file)}:${i + 1}: ${trimmed}`);
        });
    }
    if (failures === before) ok('No non-comment "service-relay/" references in shipped source');
}

async function build() {
    try {
        cleanOutput();
        copyDistribution();
        removeExcludedFiles();
        applyTransforms();
        await checkSyntax();
        checkManifest();
        checkFeatureReferencesResolve();
        checkParity();
        checkExclusionsApplied();
        checkNoServerRelayDependency();
    } catch (err) {
        fail(err.message);
    }
    console.log("");
    if (failures) {
        console.error(`BUILD FAILED — ${failures} check(s) failed.`);
        process.exitCode = 1;
    } else {
        console.log(`BUILD PASSED — community edition ready at ${path.relative(REPO_ROOT, OUT_DIR)}/`);
        console.log("Remember: this is still worth one real 'Load unpacked' smoke test in Chrome before sharing.");
    }
}

build();
