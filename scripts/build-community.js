#!/usr/bin/env node
// ============================================================
//  scripts/build-community.js
//  Builds the "community version" distribution: the Chrome
//  extension alone (manifest.json + src/), with no service-relay/
//  server and none of this repo's internal dev docs/reports.
//
//  Replaces the manual copy-and-verify process a prior session
//  did by hand (see the historical codex-community-build.txt /
//  codex-community-features-doc.txt reports, if still present) —
//  run this instead whenever mainline changes and the community
//  edition needs to catch up.
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

let failures = 0;

function fail(message) {
    console.error(`✗ ${message}`);
    failures++;
}

function ok(message) {
    console.log(`✓ ${message}`);
}

// ── 1. Clean output dir ──────────────────────────────────────
function cleanOutput() {
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
    fs.mkdirSync(OUT_DIR, { recursive: true });
    ok(`Cleaned ${path.relative(REPO_ROOT, OUT_DIR)}/`);
}

// ── 2. Copy manifest.json, src/, and the two doc templates ──
// Deliberately allowlisted (copy only these), not the whole repo
// with exclusions — service-relay/, CODE_NOTES.md, SESSION_HANDOFF.md,
// Readme.txt, .gitignore, .claude/, codex-*.txt, .git/, graphify-out/
// are never even considered, not filtered out after the fact.
function copyDistribution() {
    fs.cpSync(SRC_DIR, path.join(OUT_DIR, "src"), { recursive: true });
    fs.copyFileSync(MANIFEST_SRC, path.join(OUT_DIR, "manifest.json"));
    fs.copyFileSync(README_TEMPLATE, path.join(OUT_DIR, "README.md"));
    fs.copyFileSync(FEATURES_TEMPLATE, path.join(OUT_DIR, "FEATURES.md"));
    ok("Copied manifest.json, src/, README.md, FEATURES.md");
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

// ── 3. node --check every copied .js file ────────────────────
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

// ── 4. Manifest parses, and every referenced path resolves ──
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

// ── 5. Byte-for-byte parity with the real src/ tree ──────────
function checkParity() {
    const sourceFiles = walkFiles(SRC_DIR);
    let mismatches = 0;
    for (const sourceFile of sourceFiles) {
        const rel = path.relative(SRC_DIR, sourceFile);
        const copiedFile = path.join(OUT_DIR, "src", rel);
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
    if (mismatches === 0) ok(`${sourceFiles.length} file(s) match source src/ byte-for-byte`);
}

// ── 6. No leftover "service-relay/" filesystem dependency ────
// The string is fine inside comments (documenting the optional
// server) — the check is that it never appears as a real
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
            // A block-comment continuation line, or the reference sits
            // after a `//` earlier on the same line (covers both a
            // whole-line comment and a trailing inline one).
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
checkSyntax();
checkManifest();
checkParity();
checkNoServerRelayDependency();

console.log("");
if (failures > 0) {
    console.error(`BUILD FAILED — ${failures} check(s) failed.`);
    process.exit(1);
} else {
    console.log(`BUILD PASSED — community edition ready at ${path.relative(REPO_ROOT, OUT_DIR)}/`);
    console.log("Remember: this is still worth one real 'Load unpacked' smoke test in Chrome before sharing.");
}
