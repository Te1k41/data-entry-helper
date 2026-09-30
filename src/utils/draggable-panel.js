// ============================================================
//  src/utils/draggable-panel.js
//  Shared drag + close-button behavior for the extension's settings-
//  style panels (Custom Rules, Highlighter, Date Calculator, AWR
//  Services — anything built once via a "buildPanel()" and toggled
//  open/closed, NOT the Toolbar itself, which already has its own
//  older drag/collapse implementation in toolbar.js). One shared
//  helper so drag behavior/position-persistence/close-button styling
//  stays uniform across every panel instead of each file
//  reimplementing its own — same reasoning as toolbar.js's own
//  _clampToViewport/_wireDragAndCollapse, just factored out so
//  panels that aren't the Toolbar can reuse it too.
//
//  Usage: call once, right after building a panel's header (a plain
//  div holding just its title text so far):
//      DraggablePanel.enable(panel, header, "my-panel-id", onClose);
//  `onClose` defaults to hiding the panel (style.display = "none") —
//  pass a custom one only if a panel needs extra cleanup on close.
// ============================================================
const DraggablePanel = {
    // 40px-of-panel-still-reachable clamp, same convention toolbar.js's
    // own _clampToViewport already uses.
    _clampToViewport(left, top) {
        const maxLeft = Math.max(0, window.innerWidth  - 40);
        const maxTop  = Math.max(0, window.innerHeight - 40);
        return {
            left: Math.min(Math.max(left, 0), maxLeft),
            top:  Math.min(Math.max(top,  0), maxTop),
        };
    },

    // Full treatment: drag + a close button this panel doesn't already
    // have. Every caller's header so far is a plain text-only div, so
    // wrapping its text in a flex row is always a safe upgrade, never a
    // fight with existing content.
    enable(panel, header, storageKey, onClose) {
        header.style.display        = "flex";
        header.style.alignItems     = "center";
        header.style.justifyContent = "space-between";

        const label = document.createElement("span");
        label.textContent = header.textContent;
        header.textContent = "";
        header.appendChild(label);

        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.textContent = "✕";
        closeBtn.title = "Close";
        closeBtn.dataset.ttPanelClose = "1";
        closeBtn.style.cssText = `
            background: transparent !important;
            border: none !important;
            color: inherit !important;
            font-family: monospace !important;
            font-weight: bold !important;
            font-size: 13px !important;
            line-height: 1 !important;
            padding: 0 0 0 10px !important;
            cursor: pointer !important;
        `;
        // mousedown must NOT start a drag (it fires before click, and the
        // drag listener below would otherwise treat this as "grabbing the
        // header") — stopping it here, not in the drag handler, keeps
        // that handler oblivious to the close button entirely.
        closeBtn.addEventListener("mousedown", (e) => e.stopPropagation());
        closeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            (onClose || (() => { panel.style.display = "none"; }))();
        });
        header.appendChild(closeBtn);

        this.makeDraggable(panel, header, storageKey);
    },

    // Drag + position-persistence only — for a panel (date-calculator.js)
    // that already has its own close button, so enable()'s auto-injected
    // one would just be a redundant second ✕.
    makeDraggable(panel, header, storageKey) {
        const posKey = `tt-panel-pos:${storageKey}`;

        try {
            const saved = JSON.parse(localStorage.getItem(posKey) || "null");
            if (saved) {
                panel.style.left  = saved.left;
                panel.style.top   = saved.top;
                panel.style.right = "auto";
                panel.style.bottom = "auto"; // some panels anchor via bottom/right by default — drop that once a left/top position exists
            }
        } catch (e) { /* keep whatever position the panel's own CSS set */ }

        header.style.cursor     = "grab";
        header.style.userSelect = "none";

        let dragging = false, startX, startY, startLeft, startTop;
        header.addEventListener("mousedown", (e) => {
            dragging  = true;
            startX    = e.clientX;
            startY    = e.clientY;
            startLeft = parseInt(panel.style.left, 10) || panel.getBoundingClientRect().left;
            startTop  = parseInt(panel.style.top,  10) || panel.getBoundingClientRect().top;
            e.preventDefault();
        });
        document.addEventListener("mousemove", (e) => {
            if (!dragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            const clamped = this._clampToViewport(startLeft + dx, startTop + dy);
            panel.style.left   = `${clamped.left}px`;
            panel.style.top    = `${clamped.top}px`;
            // A panel anchored via bottom/right (date-calculator.js) needs
            // BOTH cleared the moment left/top take over, not just on the
            // restore-from-storage path above — otherwise a stale bottom/
            // right sitting alongside a freshly-set top/left leaves the
            // box's actual on-screen position ambiguous/browser-dependent
            // instead of cleanly moving to where it was just dragged.
            panel.style.right  = "auto";
            panel.style.bottom = "auto";
        });
        document.addEventListener("mouseup", () => {
            if (!dragging) return;
            dragging = false;
            localStorage.setItem(posKey, JSON.stringify({ left: panel.style.left, top: panel.style.top }));
        });
    }
};
