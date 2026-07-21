// ============================================================
//  main.js
//  Bootstrap file. Registers every feature and wires up the
//  two global event listeners that drive the whole extension.
//  This file must always load LAST (see manifest.json) since
//  it references every feature object by name.
// ============================================================

// Global re-entrancy guard. When a feature writes a value into
// a field using setFieldValue(), that fires a synthetic "change"
// event, which would normally trigger this same listener again
// and could cause an infinite loop of fields updating each other.
// Any feature that writes to a field sets syncing = true before
// the write and syncing = false after. Other features check
// `if (syncing) return;` at the top of handle() to bail out
// while a write is already in progress.
let syncing = false;

console.log("🚀 ETA-to-ETD Extension Loaded");

// The feature registry. Every feature object must be listed here
// or it will never run, even if its file is loaded in manifest.json.
// Order in this array does NOT matter (unlike manifest.json's load
// order) — these are just object references, not files.
const FEATURES = [
    NotesDateReplacement,
    SP001DateValidation,
    DateSyncing,
    PortHighlighting,
    VesselVoyageCorrection,
    DetectVesselNoDate,
    DetectPortNoDate,
    VesselTBA,
    VDirection,
    ResizeToggleOff,
    ServiceRelaySend,
    ScheduleCascade,
    VesselRecommendation,
    RearrangeVessels,
    MergeDownloadSignal,
    UploadProof,
    KeyboardFieldNav,
    AutoNavSchedules,
    DueServiceScanner,
    DateStepButtons,
    VoyageStepButtons,

    // Add new features here ↓
    // MyNewFeature,
];

// Run every feature's one-time setup once, when the content
// script first loads (creates buttons, does an initial scan, etc.)
FEATURES.forEach(feature => feature.init());

// Single delegated listener on the whole document, using the
// capture phase (the `true` third argument) so it fires before
// the event reaches its target and can't be blocked by
// stopPropagation() on the field itself. Every time ANY field
// on the page fires "change", every feature gets a chance to react
// — each feature decides for itself (usually via event.target.name)
// whether it actually cares about this particular field.
document.addEventListener("change", (event) => {
    FEATURES.forEach(feature => feature.handle(event));
}, true);

// Same delegation pattern, but for "blur" (focus leaving a field).
// Only calls handleBlur on features that define it — this is an
// optional part of the feature interface, most features don't need it.
document.addEventListener("blur", (event) => {
    FEATURES.forEach(feature => {
        if (feature.handleBlur) feature.handleBlur(event);
    });
}, true);