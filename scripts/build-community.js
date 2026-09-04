#!/usr/bin/env node
// ============================================================
//  scripts/build-community.js
//  Builds the "community version" distribution: the Chrome
//  extension alone, with no service-relay/ server, none of this
//  repo's internal dev docs/reports, AND none of the relay-only
//  feature code either — not just disabled buttons, the code
//  itself is excluded (see EXCLUDED_FILES below). A few files
//  that mix relay logic with genuine local-only value (Live
//  Check's duplicate-IMO check, the shared Toolbar panel's relay
//  socket) are replaced with a trimmed community-overrides/
//  variant instead of a straight copy — see OVERRIDE_FILES.
//
//  Usage:
//    node scripts/build-community.js [outDir]
//  outDir defaults to ./community-version (already gitignored).
// ============================================================

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO_ROOT = path.join(__dirname, "..");
const OUT_DIR = path.resolve(REPO_ROOT, process.argv[2] || "community-version");

const SRC_DIR = path.join(REPO_ROOT, "src");
const MANIFEST_SRC = path.join(REPO_ROOT, "manifest.json");
const README_TEMPLATE = path.join(REPO_ROOT, "docs", "community-readme-template.md");
const FEATURES_TEMPLATE = path.join(REPO_ROOT, "docs", "community-features-template.md");
const OVERRIDES_DIR = path.join(REPO_ROOT, "community-overrides");

// Entirely relay-dependent — no local-only value at all once the relay
// send/fetch is removed, so the whole file is excluded rather than kept
// as permanently-unreachable code. Paths are relative to src/.
const EXCLUDED_SRC_FILES = [
    "features/tradetech-stars.js",
    "features/due-service-scanner.js",
    "features/upload-proof.js",
    "features/schedule-preview-tools.js",
    "features/service-relay-send.js",
    "features/schedule-capture.js",
    "features/merge-download-signal.js",
    "features/schedule-table-scrape.js",
    "features/rename-toggle.js",
    "rename-toggle-init.js",
    "utils/relay-socket-client.js",
    "utils/button.js", // only real caller was rename-toggle.js's createButton()
];

// Files that mix relay logic with genuine local-only value: replaced
// with a trimmed variant from community-overrides/, not simply copied
// or excluded. Paths relative to REPO_ROOT (manifest.json) or src/.
const OVERRIDE_FILES = [
    { from: path.join(OVERRIDES_DIR, "manifest.json"), to: path.join(OUT_DIR, "manifest.json") },
    { from: path.join(OVERRIDES_DIR, "src", "main.js"), to: path.join(OUT_DIR, "src", "main.js") },
    { from: path.join(OVERRIDES_DIR, "src", "background.js"), to: path.join(OUT_DIR, "src", "background.js") },
    { from: path.join(OVERRIDES_DIR, "src", "utils", "toolbar.js"), to: path.join(OUT_DIR, "src", "utils", "toolbar.js") },
    { from: path.join(OVERRIDES_DIR, "src", "features", "live-check.js"), to: path.join(OUT_DIR, "src", "features", "live-check.js") },
];

let failures = 0;

function fail(message) {
    console.error(`✗ ${message}`);
    failures++;
}

function ok(message) {
    console.log(`✓ ${message}`);
}

function cleanOutput() {
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
    fs.mkdirSync(OUT_DIR, { recursive: true });
    ok(`Cleaned ${path.relative(REPO_ROOT, OUT_DIR)}/`);
}

function copyDistribution() {
    fs.cpSync(SRC_DIR, path.join(OUT_DIR, "src"), { recursive: true });
    fs.copyFileSync(MANIFEST_SRC, path.join(OUT_DIR, "manifest.json"));
    fs.copyFileSync(README_TEMPLATE, path.join(OUT_DIR, "README.md"));
    fs.copyFileSync(FEATURES_TEMPLATE, path.join(OUT_DIR, "FEATURES.md"));
    ok("Copied manifest.json, src/, README.md, FEATURES.md");
}

function removeExcludedFiles() {
    for (const rel of EXCLUDED_SRC_FILES) {
        const target = path.join(OUT_DIR, "src", rel);
        if (fs.existsSync(target)) fs.rmSync(target);
    }
    ok(`Removed ${EXCLUDED_SRC_FILES.length} relay-only file(s)`);
}

function applyOverrides() {
    for (const { from, to } of OVERRIDE_FILES) {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
    }
    ok(`Applied ${OVERRIDE_FILES.length} community-override file(s)`);
}

function walkFiles(dir) {
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) results.push(...walkFiles(full));
        else results.push(full);
    }
    return results;
}

function checkSyntax() {
    const jsFiles = walkFiles(path.join(OUT_DIR, "src")).filter(f => f.endsWith(".js"));
    let bad = 0;
    for (const file of jsFiles) {
        try {
            execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
        } catch (err) {
            fail(`Syntax error: ${path.relative(OUT_DIR, file)}\n${err.stderr}`);
            bad++;
        }
    }
    if (bad === 0) ok(`node --check passed for ${jsFiles.length} JS file(s)`);
}

function checkManifest() {
    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "manifest.json"), "utf8"));
    } catch (err) {
        fail(`manifest.json does not parse: ${err.message}`);
        return;
    }
    ok("manifest.json parses as valid JSON");

    const referenced = [];
    if (manifest.background?.service_worker) referenced.push(manifest.background.service_worker);
    for (const block of manifest.content_scripts || []) {
        for (const jsPath of block.js || []) referenced.push(jsPath);
    }

    let missing = 0;
    for (const rel of referenced) {
        if (!fs.existsSync(path.join(OUT_DIR, rel))) {
            fail(`manifest.json references a missing file: ${rel}`);
            missing++;
        }
    }
    if (missing === 0) ok(`All ${referenced.length} manifest-referenced script paths resolve`);
}

// Every FEATURES-array identifier main.js references must actually be
// declared by some script the community manifest loads before main.js —
// otherwise it's a ReferenceError the instant the content script runs,
// silently breaking EVERY feature (one top-level array literal), not
// just the missing one. Checked here with real string source scanning
// (not just node --check, which only validates syntax, not that every
// referenced global actually exists across files).
function checkFeatureReferencesResolve() {
    const manifest = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "manifest.json"), "utf8"));
    const tradetechBlock = (manifest.content_scripts || []).find(
        b => (b.matches || []).some(m => m.includes("tradetech.net"))
    );
    if (!tradetechBlock) {
        fail("Could not find the tradetech.net content_scripts block to check FEATURES references");
        return;
    }

    const combinedSource = tradetechBlock.js
        .map(rel => fs.readFileSync(path.join(OUT_DIR, rel), "utf8"))
        .join("\n");

    const mainJs = fs.readFileSync(path.join(OUT_DIR, "src", "main.js"), "utf8");
    const featuresMatch = mainJs.match(/const FEATURES = \[([\s\S]*?)\];/);
    if (!featuresMatch) {
        fail("Could not find a FEATURES array in src/main.js to check");
        return;
    }
    const identifiers = featuresMatch[1]
        .split(",")
        .map(s => s.replace(/\/\/.*$/gm, "").trim())
        .filter(Boolean);

    let missing = 0;
    for (const id of identifiers) {
        // A declaration anywhere in the bundle: const/let/var Name, or
        // function Name(. Good enough for this codebase's flat top-level
        // object-literal convention (no bundler/module system involved).
        const declared = new RegExp(`\\b(?:const|let|var|function)\\s+${id}\\b`).test(combinedSource);
        if (!declared) {
            fail(`FEATURES references "${id}", which no shipped file declares`);
            missing++;
        }
    }
    if (missing === 0) ok(`All ${identifiers.length} FEATURES identifiers are declared somewhere in the shipped bundle`);
}

// Byte-for-byte parity applies only to files that are neither excluded
// nor overridden — those two are deliberate, verified divergences from
// source src/, not bugs.
function checkParity() {
    const overriddenRelPaths = new Set(
        OVERRIDE_FILES
            .filter(o => o.to.startsWith(path.join(OUT_DIR, "src")))
            .map(o => path.relative(path.join(OUT_DIR, "src"), o.to))
    );
    const sourceFiles = walkFiles(SRC_DIR);
    let mismatches = 0;
    let checked = 0;
    for (const sourceFile of sourceFiles) {
        const rel = path.relative(SRC_DIR, sourceFile);
        if (EXCLUDED_SRC_FILES.includes(rel) || overriddenRelPaths.has(rel)) continue;

        const copiedFile = path.join(OUT_DIR, "src", rel);
        checked++;
        if (!fs.existsSync(copiedFile)) {
            fail(`Missing from output: src/${rel}`);
            mismatches++;
            continue;
        }
        if (!fs.readFileSync(sourceFile).equals(fs.readFileSync(copiedFile))) {
            fail(`Content differs from source: src/${rel}`);
            mismatches++;
        }
    }
    if (mismatches === 0) ok(`${checked} pass-through file(s) match source src/ byte-for-byte`);
}

// Confirms the excluded files are really gone, and the override files
// really match community-overrides/ (not silently left as the source
// src/ copy from copyDistribution()).
function checkExclusionsAndOverridesApplied() {
    let bad = 0;
    for (const rel of EXCLUDED_SRC_FILES) {
        if (fs.existsSync(path.join(OUT_DIR, "src", rel))) {
            fail(`Excluded file still present: src/${rel}`);
            bad++;
        }
    }
    for (const { from, to } of OVERRIDE_FILES) {
        if (!fs.existsSync(to)) {
            fail(`Override file missing: ${path.relative(OUT_DIR, to)}`);
            bad++;
            continue;
        }
        if (!fs.readFileSync(from).equals(fs.readFileSync(to))) {
            fail(`Override file doesn't match community-overrides/: ${path.relative(OUT_DIR, to)}`);
            bad++;
        }
    }
    if (bad === 0) ok(`${EXCLUDED_SRC_FILES.length} exclusion(s) and ${OVERRIDE_FILES.length} override(s) correctly applied`);
}

// The string is fine inside comments (documenting why something was
// excluded) — the check is that it never appears as a real
// require/import/fetch/path reference in the shipped output.
function checkNoServerRelayDependency() {
    const jsFiles = walkFiles(path.join(OUT_DIR, "src")).filter(f => f.endsWith(".js"));
    let realReferences = 0;
    for (const file of jsFiles) {
        const lines = fs.readFileSync(file, "utf8").split("\n");
        lines.forEach((line, i) => {
            const refIndex = line.indexOf("service-relay/");
            if (refIndex === -1) return;
            const trimmed = line.trim();
            const commentIndex = line.indexOf("//");
            const isComment = trimmed.startsWith("*") || trimmed.startsWith("/*")
                || (commentIndex !== -1 && commentIndex < refIndex);
            if (!isComment) {
                fail(`Non-comment "service-relay/" reference: ${path.relative(OUT_DIR, file)}:${i + 1}: ${trimmed}`);
                realReferences++;
            }
        });
    }
    if (realReferences === 0) ok('No non-comment "service-relay/" references in shipped source');
}

// ── Run ───────────────────────────────────────────────────────
cleanOutput();
copyDistribution();
removeExcludedFiles();
applyOverrides();
checkSyntax();
checkManifest();
checkFeatureReferencesResolve();
checkParity();
checkExclusionsAndOverridesApplied();
checkNoServerRelayDependency();

console.log("");
if (failures > 0) {
    console.error(`BUILD FAILED — ${failures} check(s) failed.`);
    process.exit(1);
} else {
    console.log(`BUILD PASSED — community edition ready at ${path.relative(REPO_ROOT, OUT_DIR)}/`);
    console.log("Remember: this is still worth one real 'Load unpacked' smoke test in Chrome before sharing.");
}
