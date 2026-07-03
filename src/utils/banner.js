// ============================================================
//  src/utils/banner.js
//  Lesson: Building reusable UI components
//
//  showBanner({ title, message }) — shows a styled banner
//  removeBanner()                 — removes it
//
//  Usage:
//    showBanner({ title: "🚢 Mismatch", message: "No match for 07/04/26" })
// ============================================================

function showBanner(options) {
    removeBanner();

    const div = document.createElement("div");
    div.id = "tt-banner";

    div.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 4px;">${options.title}</div>
        <div style="opacity: 0.85;">${options.message}</div>
    `;

    div.style.cssText = `
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
        opacity: 0.9;
    `;

    document.body.appendChild(div);
}

function removeBanner() {
    document.getElementById("tt-banner")?.remove();
}