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
    let canvas, ctx;

    function listener(message, _sender, sendResponse) {
        try {
            if (message.type === "FPC_START") {
                canvas = document.createElement("canvas");
                canvas.width  = message.canvasWidth;   // device pixels, pre-computed+ceiling-checked by background.js
                canvas.height = message.canvasHeight;
                ctx = canvas.getContext("2d");
                sendResponse({ ok: true });
                return;
            }

            if (message.type === "FPC_SLICE") {
                const img = new Image();
                img.onload = () => {
                    ctx.drawImage(img, 0, message.y); // slice is already device-pixel-sized 1:1, no scaling needed
                    sendResponse({ ok: true });
                };
                img.onerror = () => sendResponse({ ok: false, error: "Could not decode a captured slice" });
                img.src = message.dataUrl;
                return true; // async sendResponse — keep channel open for img.onload
            }

            if (message.type === "FPC_FINISH") {
                const dataUrl = canvas.toDataURL("image/png"); // lossless, no quality arg — same PNG convention as dashboard/merge.js
                sendResponse({ ok: true, dataUrl });
                chrome.runtime.onMessage.removeListener(listener);
                canvas = ctx = null;
                return;
            }
        } catch (err) {
            sendResponse({ ok: false, error: err.message });
            chrome.runtime.onMessage.removeListener(listener);
        }
    }

    chrome.runtime.onMessage.addListener(listener);
})();
