// ============================================================
//  src/utils/button.js
//  Lesson: Building reusable UI from JavaScript
//
//  What this file teaches:
//  - How to create a reusable function that returns an element
//  - How to apply consistent styles from one place
//  - absolute vs fixed positioning
//  - Why we return the element instead of appending it directly
// ============================================================

// Creates a styled button that matches Tradetech's look.
// Returns the button element — the caller decides where to put it.
//
// options = {
//   id:      unique id so we never create it twice
//   label:   the text on the button
//   top:     distance from top of page
//   left:    distance from left of page
//   onClick: function to call when clicked
// }
function createButton(options) {
    if (document.getElementById(options.id)) return;

    const btn = document.createElement("button");
    btn.id          = options.id;
    btn.textContent = options.label;
    const position = options.position || "absolute";
    btn.type        = "button";

    btn.style.cssText = `
        position: ${position} !important;
        top: ${options.top} !important;
        left: ${options.left} !important;
        z-index: 2147483647 !important;
        background: #ffffff !important;
        color: #000000 !important;
        border: 2px solid #000000 !important;
        border-radius: 0px !important;
        padding: 6px 14px !important;
        font-family: monospace !important;
        font-size: 11px !important;
        letter-spacing: 0.5px !important;
        box-shadow: 3px 3px 0px #000000 !important;
        cursor: pointer !important;
        line-height: normal !important;
        min-width: unset !important;
        max-width: unset !important;
        width: auto !important;
        height: auto !important;
`;

    btn.addEventListener("mouseenter", () => {
        btn.style.boxShadow  = "1px 1px 0px #000000";
        btn.style.transform  = "translate(2px, 2px)";  // button "presses in"
    });

    btn.addEventListener("mouseleave", () => {
        btn.style.boxShadow  = "3px 3px 0px #000000";
        btn.style.transform  = "translate(0px, 0px)";
    });

    document.body.appendChild(btn);

    const savedPos = localStorage.getItem(`btn-pos-${options.id}`);
    if (savedPos) {
        const { top, left } = JSON.parse(savedPos);
        btn.style.top  = top;
        btn.style.left = left;
    }

// ── Drag to reposition ──────────────────────────────
let isDragging  = false;
let didDrag     = false;
let startX, startY, startLeft, startTop;

btn.addEventListener("mousedown", (e) => {
    isDragging  = true;
    didDrag     = false;
    startX      = e.clientX;
    startY      = e.clientY;
    startLeft   = parseInt(btn.style.left, 10);
    startTop    = parseInt(btn.style.top,  10);
    btn.style.cursor = "grabbing";
    e.preventDefault();
});

document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) didDrag = true;
    btn.style.left = `${startLeft + dx}px`;
    btn.style.top  = `${startTop  + dy}px`;
});

document.addEventListener("mouseup", () => {
    if (!isDragging) return;
    isDragging = false;
    btn.style.cursor = "pointer";

    if (!didDrag) {
        options.onClick();
    } else {
        // save position after drag
        localStorage.setItem(
            `btn-pos-${options.id}`,
            JSON.stringify({ top: btn.style.top, left: btn.style.left })
        );
    }

    didDrag = false;
});

}