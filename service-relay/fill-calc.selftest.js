#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { computeFill } = require("./fill-calc");

const OUTPUT_FILE = path.join(__dirname, "fill-test-output.json");

function parseArgs(argv) {
    const options = {};
    for (let index = 0; index < argv.length; index++) {
        const argument = argv[index];
        if (!["--guideline", "--proofs"].includes(argument)) throw new Error(`unknown argument: ${argument}`);
        if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) throw new Error(`${argument} requires a value`);
        options[argument.slice(2)] = argv[++index];
    }
    return options;
}

function readJson(file, label) {
    try {
        return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
    } catch (error) {
        throw new Error(`could not read ${label} ${file}: ${error.message}`);
    }
}

function writeAtomically(file, value) {
    const temporary = `${file}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
        try {
            fs.renameSync(temporary, file);
        } catch (renameError) {
            if (!fs.existsSync(file)) throw renameError;
            fs.rmSync(file, { force: true });
            fs.renameSync(temporary, file);
        }
    } catch (error) {
        try { fs.rmSync(temporary, { force: true }); } catch (_) { /* best effort */ }
        throw error;
    }
}

function printNotices(notices) {
    console.log(`\nIdentity notices (${notices.length})`);
    if (!notices.length) {
        console.log("  None — every proof vessel/voyage agrees with the guideline checklist.");
        return;
    }
    for (const notice of notices) console.log(`  [${notice.type}] ${notice.message}`);
}

function printVessels(vessels) {
    console.log(`\nProof vessels (${vessels.length})`);
    if (!vessels.length) {
        console.log("  No proof vessel rows are available.");
        return;
    }
    for (const vessel of vessels) {
        const dated = vessel.ports.filter(port => port.hasData).length;
        const match = vessel.guidelineMatch
            ? `${vessel.guidelineMatch.name} / ${vessel.guidelineMatch.voyage}`
            : vessel.identityStatus;
        console.log(`  ${vessel.vessel || "(blank)"} / ${vessel.voyage || "(blank)"}: ${dated}/${vessel.ports.length} rotation ports dated; checklist ${match}`);
        for (const port of vessel.ports.filter(item => item.hasData)) {
            const provenance = port.source === "ocr" ? " [OCR, unverified]" : "";
            console.log(`    ${port.port || port.portCode || "(unknown port)"}: ETA ${port.eta || "—"}, ETD ${port.etd || "—"}${provenance}`);
        }
    }
}

function printSuggestion(suggestion) {
    console.log("\nSuggested cleanest vessel");
    if (!suggestion) {
        console.log("  None — no vessel with usable identity is available.");
        return;
    }
    const basis = suggestion.scoringBasis || {};
    const port = suggestion.suggestedPort;
    const proximity = suggestion.dateProximity === null
        ? `unavailable (${suggestion.dateProximityUnavailable || "unknown reason"})`
        : `${suggestion.dateProximity}% (${suggestion.dateDifferenceDays} day(s) from base)`;
    console.log(`  ${suggestion.vessel || "(blank)"} / ${suggestion.voyage || "(blank)"}; combined ${suggestion.combinedScore}% (cleanliness ${suggestion.cleanlinessScore}%, date proximity ${proximity})`);
    console.log(`  Date case ${basis.case || "—"}; reference rotation index ${basis.referenceRotationIndex ?? "—"}; base ${basis.baseDate || "unavailable"}; window ${basis.windowStart || "—"} to ${basis.windowEnd || "—"}${basis.futureOnly ? " (future only)" : ""}.`);
    console.log(`  ${basis.observedPortCount}/${basis.expectedPortCount} trustworthy rotation calls observed; ${basis.missingPortCount} missing; transition edit distance ${basis.transitionEditDistance}.`);
    console.log(`  Suggested port: ${port ? `${port.port || port.portCode || "(unknown)"} (${port.category}) — ${port.reason}` : "none"}`);
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    let guideline;
    if (args.guideline) guideline = readJson(args.guideline, "guideline file");
    else {
        const store = require("./schedule-guideline-store");
        store.loadFromDisk();
        guideline = store.getCurrent();
        if (!guideline) throw new Error("no guideline available -- pass --guideline <file.json>");
    }

    let proofRows = [];
    if (args.proofs) {
        proofRows = readJson(args.proofs, "proofs file");
        if (!Array.isArray(proofRows)) throw new Error("proofs JSON must contain an array");
    } else {
        try {
            const { getLastRows } = require("./proof-extract");
            const cached = getLastRows();
            if (Array.isArray(cached)) proofRows = cached;
            else console.warn("Warning: no --proofs file supplied and no last extraction is available");
        } catch (error) {
            console.warn(`Warning: cached proof extraction is unavailable (${error.message}); continuing with no proofs`);
        }
    }

    require("./port-dictionary").loadFromDisk();
    require("./vessel-dictionary").loadFromDisk();
    const result = computeFill(guideline, proofRows);
    console.log(`Fill result format ${result.formatVersion}: ${result.service || "(no service)"} / ${result.operator || "(no operator)"}`);
    console.log(`Rotation: ${result.rotation.length} port rows; proofs: ${result.proofSummary.received} (${result.proofSummary.ocrProofCount} OCR, ${result.proofSummary.structuredProofCount} structured)`);
    printSuggestion(result.suggestedVessel);
    printNotices(result.notices);
    printVessels(result.vessels);
    if (result.unresolvedPortLabels.length) console.warn(`\nUnresolved port labels: ${result.unresolvedPortLabels.length}`);
    if (result.warnings.length) console.warn(`Warnings: ${result.warnings.join("; ")}`);
    writeAtomically(OUTPUT_FILE, result);
    console.log(`\nFull result written to ${OUTPUT_FILE}`);
}

try {
    main();
} catch (error) {
    console.error(`Error: ${error && error.message ? error.message : String(error)}`);
    process.exitCode = 1;
}
