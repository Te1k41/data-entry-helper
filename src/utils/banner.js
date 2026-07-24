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
        <div style="opacity: 1;">${options.message}</div>
    `;

    div.style.cssText = BANNER_STYLE;

    document.body.appendChild(div);
    applyNotificationVisibility();
}

function removeBanner() {
    document.getElementById("tt-banner")?.remove();
}

// ── Success/confirmation banner ──────────────────────────────
// Uses its OWN element (#tt-success-banner), styled green, stacked
// directly below the warning banner (#tt-banner) if one is showing —
// so a real warning stays fully visible and the confirmation just
// sits underneath it instead of overlapping or replacing it.

const SUCCESS_GAP = 10; // px gap between stacked right-side banners

// Right-side banners (warning, success, suggestion) all stack in that
// same order rather than each independently computing "below the
// warning banner" — two of them independently computing the same
// position used to mean a success confirmation and a suggestion
// banner could land in the exact same spot and overlap. Pass the IDs
// of whichever banners sit ABOVE this one in the stack.
function getStackedBannerTop(idsAbove) {
    let top = 52; // base position, under the notification toggle button
    for (const id of idsAbove) {
        const el = document.getElementById(id);
        if (!el || el.style.display === "none") continue;
        const rect = el.getBoundingClientRect();
        top = Math.max(top, rect.bottom + SUCCESS_GAP);
    }
    return `${top}px`;
}

function getSuccessBannerTop() {
    return getStackedBannerTop(["tt-banner"]);
}

// The three right-side banners can each be created/changed/removed
// independently and asynchronously (e.g. the upload-proof warning
// resolves from a chrome.storage read, so it can easily show up
// AFTER a suggestion banner already rendered assuming no warning
// existed yet). getSuccessBannerTop()/getSuggestionBannerTop() only
// compute the right position at the MOMENT a banner is built — this
// re-applies that position to whichever of the two already exist,
// any time something in the stack might have changed, so they stay
// correctly stacked instead of freezing at whatever was true when
// each one first appeared. Called from applyNotificationVisibility()
// so every existing call site (show/hide/clear, for any banner type)
// gets this for free.
function repositionStackedBanners() {
    const success = document.getElementById("tt-success-banner");
    if (success) success.style.top = getSuccessBannerTop();

    const suggestion = document.getElementById("tt-suggestion-banner");
    if (suggestion) suggestion.style.top = getSuggestionBannerTop();
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
        opacity: 1;
    `;
}

let successBannerTimer = null;

function removeSuccessBanner() {
    document.getElementById("tt-success-banner")?.remove();
}

// ── Persistent info banner ───────────────────────────────────
// Uses its OWN element (#tt-info-banner), styled blue/neutral —
// distinct from the yellow warning and green success colors, since
// this isn't reporting a problem or a one-off confirmation. It's a
// standing status indicator (e.g. "Basing on: MSC OSCAR") that stays
// up as long as it's true, cleared only when it's no longer
// applicable. Sits centered near the top of the page. Deliberately
// low z-index + pointer-events:none so if it ever visually overlaps
// a real form field, the field always wins — both visually (page
// content renders on top) and functionally (clicks/typing pass
// straight through the banner to whatever's underneath it).

function buildInfoStyle() {
    return `
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 1;
        pointer-events: none;
        background: rgba(220, 238, 255, 0.55);
        color: #0a3d6e;
        border: 2px solid rgba(30, 95, 158, 0.6);
        border-radius: 0px;
        padding: 10px 16px;
        font-family: monospace;
        font-size: 11px;
        letter-spacing: 0.5px;
        line-height: 1.6;
        min-width: 260px;
        max-width: 340px;
        text-align: center;
    `;
}

const INFO_BANNER_TEXT_SHADOW = "0 0 4px #dceeff, 0 0 4px #dceeff, 0 0 6px #dceeff";

function removeInfoBanner() {
    document.getElementById("tt-info-banner")?.remove();
}

// Shows (or updates) the persistent info banner. Pass null to clear
// it — e.g. when there's no longer a vessel match to report.
function setInfoBanner(info) {
    removeInfoBanner();
    if (!info) return;

    const div = document.createElement("div");
    div.id = "tt-info-banner";

    div.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 4px; text-shadow: ${INFO_BANNER_TEXT_SHADOW};">${info.title}</div>
        <div style="font-weight: bold; font-size: 13px; text-shadow: ${INFO_BANNER_TEXT_SHADOW};">${info.message}</div>
    `;

    div.style.cssText = buildInfoStyle();

    document.body.appendChild(div);
    applyNotificationVisibility();
}

// ── Suggestion banner (right side) ───────────────────────────
// Uses its OWN element (#tt-suggestion-banner), styled purple —
// distinct from the centered blue "info" banner (used for the
// persistent "Basing on: X" status) and from the warning/success
// banners. Stacks below BOTH the warning and the success banner (if
// either is currently showing) — a fresh success confirmation firing
// while a suggestion is up pushes the suggestion down instead of the
// two overlapping, and repositionStackedBanners() (called from
// applyNotificationVisibility(), plus explicitly wherever a banner
// disappears outside that path) keeps it correct live as banners
// above it appear, resize, or clear — not just a snapshot taken once
// when this banner was first built.

function getSuggestionBannerTop() {
    return getStackedBannerTop(["tt-banner", "tt-success-banner"]);
}

function buildSuggestionStyle() {
    return `
        position: fixed;
        top: ${getSuggestionBannerTop()};
        right: 16px;
        z-index: 999997;
        background: #f0e6ff;
        color: #3d0a6e;
        border: 2px solid #6e1e9e;
        border-radius: 0px;
        padding: 10px 16px;
        font-family: monospace;
        font-size: 11px;
        letter-spacing: 0.5px;
        line-height: 1.6;
        box-shadow: 3px 3px 0px #6e1e9e;
        min-width: 260px;
        max-width: 340px;
        opacity: 1;
    `;
}

function removeSuggestionBanner() {
    document.getElementById("tt-suggestion-banner")?.remove();
}

// Shows (or updates) the vessel-suggestion banner. Pass null to clear
// it — e.g. when there are no candidates in range right now.
function setSuggestionBanner(info) {
    removeSuggestionBanner();
    if (!info) return;

    const div = document.createElement("div");
    div.id = "tt-suggestion-banner";

    div.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 4px;">${info.title}</div>
        <div>${info.message}</div>
    `;

    div.style.cssText = buildSuggestionStyle();

    document.body.appendChild(div);
    applyNotificationVisibility();
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
        <div style="opacity: 1;">${options.message}</div>
    `;

    div.style.cssText = buildSuccessStyle();

    document.body.appendChild(div);
    applyNotificationVisibility();

    successBannerTimer = setTimeout(() => {
        successBannerTimer = null;
        removeSuccessBanner();
        repositionStackedBanners(); // success banner just disappeared — suggestion below it (if any) can move back up
    }, durationMs);
}

// Shared cssText so the single-warning and multi-warning banners
// look identical apart from their inner content.
const BANNER_STYLE = `
    position: fixed;
    top: 52px;
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
    opacity: 1;
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
        repositionStackedBanners(); // warning banner just disappeared — success/suggestion below it need to move up
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
            <div style="opacity: 1;">${w.message}</div>
        </div>
    `).join("");

    div.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 6px;">🚢 ${warnings.length} issues found</div>
        ${items}
    `;

    div.style.cssText = BANNER_STYLE;

    document.body.appendChild(div);
    applyNotificationVisibility();
}

// ── Hide/Show all notifications toggle ───────────────────────
// A single small always-present button, top-right, ABOVE the whole
// banner stack (which starts at top: 52px to leave room for it).
// Hides/shows every banner type at once — the banners themselves
// keep updating normally underneath, so un-hiding always shows
// current, up-to-date content rather than something stale.

const ALL_BANNER_IDS = ["tt-banner", "tt-success-banner", "tt-info-banner", "tt-suggestion-banner", "tt-notes-sidebar"];

let notificationsHidden = localStorage.getItem("tt-notifications-hidden") === "1";

function applyNotificationVisibility() {
    ALL_BANNER_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = notificationsHidden ? "none" : "";
    });
    repositionStackedBanners();
}

function toggleNotificationVisibility() {
    notificationsHidden = !notificationsHidden;
    localStorage.setItem("tt-notifications-hidden", notificationsHidden ? "1" : "0");
    applyNotificationVisibility();
    Toolbar.updateLabel("tt-notif-toggle", notificationsHidden ? "🔔 Show notifications" : "🔕 Hide notifications");
}

// Was its own fixed top-right button — moved into the shared Tools panel:
// Toolbar already runs once per Tradetech frame same as this file does, so a
// second independent floating button on top of it just doubled the same
// per-frame duplication (visible as two stacked "Show" buttons).
function createNotificationToggle() {
    Toolbar.register({
        id: "tt-notif-toggle",
        label: notificationsHidden ? "🔔 Show notifications" : "🔕 Hide notifications",
        onClick: toggleNotificationVisibility
    });
}

createNotificationToggle();