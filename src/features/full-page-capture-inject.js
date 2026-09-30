// ============================================================
//  full-page-capture-inject.js
//  Injected on demand (chrome.scripting.executeScript) into the
//  active tab when the toolbar action fires a capture. Runs in
//  the page's own context — has the canvas/DOM access the
//  background service worker lacks in MV3. One-shot: removes its
//  own listener after FPC_FINISH (or on error) so a second capture
//  click (re-injecting this file) never stacks a second listener.
// ============================================================
(() => {
    let canvas, ctx, badge;

    // A wide+tall page can need a couple dozen tiles, each taking the
    // better part of a second — with literally no on-screen feedback
    // beyond the page silently jumping to a new scroll position
    // repeatedly, that reads as "stuck", not "still working" (live-
    // reported). No timing change at all here, purely making the
    // already-happening work visible.
    function showBadge() {
        badge = document.createElement("div");
        badge.id = "tt-fpc-progress";
        badge.style.cssText = `
            position: fixed !important;
            bottom: 16px !important;
            left: 16px !important;
            z-index: 2147483647 !important;
            background: #000000 !important;
            color: #ffffff !important;
            font-family: monospace !important;
            font-size: 12px !important;
            font-weight: bold !important;
            padding: 8px 14px !important;
            border-radius: 4px !important;
            box-shadow: 2px 2px 0px rgba(0,0,0,0.4) !important;
        `;
        badge.textContent = "📸 Capturing…";
        document.body.appendChild(badge);
    }

    function updateBadge(done, total) {
        if (badge) badge.textContent = `📸 Capturing ${done}/${total}…`;
    }

    function removeBadge() {
        badge?.remove();
        badge = null;
    }

    function listener(message, _sender, sendResponse) {
        try {
            if (message.type === "FPC_START") {
                canvas = document.createElement("canvas");
                canvas.width  = message.canvasWidth;   // device pixels, pre-computed+ceiling-checked by background.js
                canvas.height = message.canvasHeight;
                ctx = canvas.getContext("2d");
                showBadge();
                sendResponse({ ok: true });
                return;
            }

            if (message.type === "FPC_SLICE") {
                const img = new Image();
                img.onload = () => {
                    if (message.cropRect) {
                        // Every regular tile: crop out everything except that
                        // tile's own content box (already scrollbar-excluded
                        // by background.js's use of documentElement.client*
                        // as the step size) and paste at its stitched position.
                        const c = message.cropRect;
                        ctx.drawImage(img, c.x, c.y, c.width, c.height, message.pasteX, message.pasteY, c.width, c.height);
                    } else {
                        // The one-time background pass only (frameset case):
                        // draw the whole raw screenshot as-is, to fill in
                        // whatever's outside the target frame's own footprint
                        // (a header/footer/side frame) before the tiles above
                        // start overpainting that footprint on top of it.
                        ctx.drawImage(img, message.pasteX, message.pasteY);
                    }
                    if (message.totalTiles) updateBadge(message.tileIndex, message.totalTiles);
                    sendResponse({ ok: true });
                };
                img.onerror = () => sendResponse({ ok: false, error: "Could not decode a captured slice" });
                img.src = message.dataUrl;
                return true; // async sendResponse — keep channel open for img.onload
            }

            if (message.type === "FPC_FINISH") {
                const dataUrl = canvas.toDataURL("image/png"); // lossless, no quality arg — same PNG convention as dashboard/merge.js
                removeBadge();
                sendResponse({ ok: true, dataUrl });
                chrome.runtime.onMessage.removeListener(listener);
                canvas = ctx = null;
                return;
            }
        } catch (err) {
            removeBadge();
            sendResponse({ ok: false, error: err.message });
            chrome.runtime.onMessage.removeListener(listener);
        }
    }

    chrome.runtime.onMessage.addListener(listener);
})();
