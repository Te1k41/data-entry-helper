// ============================================================
//  main.js (community edition)
//  Same bootstrap as the full extension's main.js, except the
//  FEATURES array omits every feature that's entirely relay-
//  dependent (their files aren't shipped in this build at all —
//  see scripts/build-community.js's EXCLUDED_FILES list). Keep
//  this array in sync with the real src/main.js's FEATURES list
//  whenever a new feature is added there: add it here too unless
//  it needs the relay server to do anything.
// ============================================================

let syncingDepth = 0;

function beginSync() {
    syncingDepth++;
}

function endSync() {
    if (syncingDepth === 0) {
        console.error("❌ Sync guard released without a matching acquisition");
        return;
    }
    syncingDepth--;
}

function isSyncing() {
    return syncingDepth > 0;
}

console.log("🚀 ETA-to-ETD Extension Loaded (community edition)");

const FEATURES = [
    NotesDateReplacement,
    NotesSidebar,
    SP001DateValidation,
    DateSyncing,
    ManualEtdHighlight,
    ArrivalDepartOrderCheck,
    PortDateOrderCheck,
    InsertPort,
    DeletePort,
    PortActionHistory,
    PortNameReminder,
    VesselNameReminder,
    PortHighlighting,
    AwrFlag,
    LastForeignPortCheck,
    VesselVoyageCorrection,
    DuplicateVessel,
    DeleteVessel,
    VesselActionHistory,
    DuplicateVesselCheck,
    DetectVesselNoDate,
    DetectPortNoDate,
    VesselTBA,
    VDirection,
    ResizeToggleOff,
    ScheduleCascade,
    VesselRecommendation,
    RearrangeVessels,
    KeyboardFieldNav,
    SelectFieldOnFocus,
    AutoNavSchedules,
    DateStepButtons,
    VoyageStepButtons,
    DateCalculator,
    LiveCheck,

    // Add new features here ↓ (omit anything relay-only)
];

function runFeature(feature, method, event) {
    if (typeof feature[method] !== "function") return;
    try {
        feature[method](event);
    } catch (err) {
        const name = feature && feature.constructor && feature.constructor.name !== "Object"
            ? feature.constructor.name
            : FEATURES.findIndex(candidate => candidate === feature);
        console.error(`❌ Feature ${method} failed (${name}):`, err);
    }
}

FEATURES.forEach(feature => runFeature(feature, "init"));

document.addEventListener("change", (event) => {
    FEATURES.forEach(feature => runFeature(feature, "handle", event));
}, true);

document.addEventListener("blur", (event) => {
    FEATURES.forEach(feature => runFeature(feature, "handleBlur", event));
}, true);

document.addEventListener("focus", (event) => {
    FEATURES.forEach(feature => runFeature(feature, "handleFocus", event));
}, true);
