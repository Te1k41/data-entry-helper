// ============================================================
//  src/utils/banner.js
//  Lesson: Building reusable UI components
//
//  showBanner({ title, message }) — shows a single styled banner
//  removeBanner()                 — removes it
//
//  Usage:
//    showBanner({ title: "🚢 Mismatch", message: "No match for 07/04/26" })
//
//  ── Warning registry (for features that run independently) ──
//  Multiple features (SP001 validation, missing vessel dates, etc.)
//  can each have their own warning active at the same time. If they
//  called showBanner()/removeBanner() directly, whichever one ran
//  last would silently overwrite the other — you'd only ever see
//  ONE warning even when TWO things are wrong.
//
//  setWarning(key, warning) fixes that. Each feature owns one key:
//    setWarning("sp001-mismatch", { title, message })   // problem found
//    setWarning("sp001-mismatch", null)                 // problem cleared
//
//  The banner automatically shows:
//    - nothing,             if no warnings are active
//    - the single warning,  if exactly one is active
//    - a combined list,     if two or more are active
// ============================================================

const activeWarnings = {};

function showBanner(options) {
    removeBanner();

    const div = document.createElement("div");
    div.id = "tt-banner";

    div.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 4px;">${options.title}</div>
        <div style="opacity: 0.85;">${options.message}</div>
    `;

    div.style.cssText = BANNER_STYLE;

    document.body.appendChild(div);
}

function removeBanner() {
    document.getElementById("tt-banner")?.remove();
}

// ── Success/confirmation banner ──────────────────────────────
// Uses its OWN element (#tt-success-banner), styled green, stacked
// directly below the warning banner (#tt-banner) if one is showing —
// so a real warning stays fully visible and the confirmation just
// sits underneath it instead of overlapping or replacing it.

const SUCCESS_GAP = 10; // px gap between the warning banner and this one

function getSuccessBannerTop() {
    const warningBanner = document.getElementById("tt-banner");
    if (!warningBanner) return "16px";

    const rect = warningBanner.getBoundingClientRect();
    return `${rect.bottom + SUCCESS_GAP}px`;
}

function buildSuccessStyle() {
    return `
        position: fixed;
        top: ${getSuccessBannerTop()};
        right: 16px;
        z-index: 999999;
        background: #d6f5d6;
        color: #0a3d0a;
        border: 2px solid #1e7d1e;
        border-radius: 0px;
        padding: 10px 16px;
        font-family: monospace;
        font-size: 11px;
        letter-spacing: 0.5px;
        line-height: 1.6;
        box-shadow: 3px 3px 0px #1e7d1e;
        min-width: 260px;
        max-width: 340px;
        opacity: 0.95;
    `;
}

let successBannerTimer = null;

function removeSuccessBanner() {
    document.getElementById("tt-success-banner")?.remove();
}

// Shows a one-off green confirmation banner (e.g. "Snapshot saved",
// "Cascade complete") that clears itself after `durationMs` (default
// 3000ms). Positioned below the warning banner each time it's shown,
// so it tracks correctly even if the warning banner's height changes
// (e.g. going from 1 issue to a combined multi-issue list).
function showTemporaryBanner(options, durationMs = 3000) {
    if (successBannerTimer) {
        clearTimeout(successBannerTimer);
        successBannerTimer = null;
    }

    removeSuccessBanner();

    const div = document.createElement("div");
    div.id = "tt-success-banner";

    div.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 4px;">${options.title}</div>
        <div style="opacity: 0.85;">${options.message}</div>
    `;

    div.style.cssText = buildSuccessStyle();

    document.body.appendChild(div);

    successBannerTimer = setTimeout(() => {
        successBannerTimer = null;
        removeSuccessBanner();
    }, durationMs);
}

// Shared cssText so the single-warning and multi-warning banners
// look identical apart from their inner content.
const BANNER_STYLE = `
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 999999;
    background: #fcff9e;
    color: #000000;
    border: 2px solid #000000;
    border-radius: 0px;
    padding: 10px 16px;
    font-family: monospace;
    font-size: 11px;
    letter-spacing: 0.5px;
    line-height: 1.6;
    box-shadow: 3px 3px 0px #000000;
    min-width: 260px;
    max-width: 340px;
    opacity: 0.9;
`;

// Registers (or clears, if warning is null) one feature's warning,
// then re-renders the banner from whatever's currently active.
//
// key      — unique string per feature, e.g. "sp001-mismatch"
// warning  — { title, message } to show, or null/undefined to clear
function setWarning(key, warning) {
    if (warning) {
        activeWarnings[key] = warning;
    } else {
        delete activeWarnings[key];
    }
    renderWarnings();
}

function renderWarnings() {
    const warnings = Object.values(activeWarnings);

    if (warnings.length === 0) {
        removeBanner();
        return;
    }

    if (warnings.length === 1) {
        showBanner(warnings[0]);
        return;
    }

    showCombinedBanner(warnings);
}

// Multiple active warnings — one banner, each issue as its own
// short block so it's still easy to scan at a glance rather than
// reading a run-on paragraph.
function showCombinedBanner(warnings) {
    removeBanner();

    const div = document.createElement("div");
    div.id = "tt-banner";

    const items = warnings.map((w, i) => `
        <div style="${i > 0 ? "margin-top: 6px; padding-top: 6px; border-top: 1px dashed #000000;" : ""}">
            <div style="font-weight: bold;">${w.title}</div>
            <div style="opacity: 0.85;">${w.message}</div>
        </div>
    `).join("");

    div.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 6px;">🚢 ${warnings.length} issues found</div>
        ${items}
    `;

    div.style.cssText = BANNER_STYLE;

    document.body.appendChild(div);
}