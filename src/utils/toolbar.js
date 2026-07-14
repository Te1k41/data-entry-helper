// ============================================================
//  src/utils/toolbar.js
//  A single collapsible, draggable panel that all Tradetech-
//  page features register their actions into, instead of each
//  one creating its own independent floating button via
//  createButton(). Cuts down page clutter from ~7 separate
//  buttons scattered around the screen to one panel.
//
//  Usage (in a feature's init()):
//    Toolbar.register({
//        id:      "tt-my-action",
//        label:   "🔧 Do The Thing",
//        onClick: () => this.doTheThing()
//    });
//
//  For toggle-style buttons whose label needs to change after
//  a click (e.g. "Direction: ON" -> "Direction: OFF"):
//    Toolbar.updateLabel("tt-my-action", "🔧 Now OFF");
//
//  NOTE: rename-toggle.js does NOT use this — it belongs to a
//  separate content script bundle (all sites except Tradetech)
//  and keeps its own independent button.
// ============================================================

const Toolbar = {
    _actions: [],
    _panel:         null,
    _listContainer: null,
    _collapsed:     false,

    register(action) {
        if (this._actions.find(a => a.id === action.id)) return; // avoid dupes if init() ever runs twice
        this._actions.push(action);
        this._render();
    },

    updateLabel(id, newLabel) {
        const action = this._actions.find(a => a.id === id);
        if (!action) return;
        action.label = newLabel;
        this._render();
    },

    _ensurePanel() {
        if (this._panel) return;

        this._collapsed = localStorage.getItem("tt-toolbar-collapsed") === "1";

        const panel = document.createElement("div");
        panel.id = "tt-toolbar";
        panel.style.cssText = `
            position: fixed !important;
            z-index: 2147483647 !important;
            background: #ffffff !important;
            border: 2px solid #000000 !important;
            box-shadow: 3px 3px 0px #000000 !important;
            font-family: monospace !important;
            font-size: 11px !important;
            min-width: 170px !important;
        `;

        const savedPos = localStorage.getItem("tt-toolbar-pos");
        if (savedPos) {
            const { top, left } = JSON.parse(savedPos);
            panel.style.top  = top;
            panel.style.left = left;
        } else {
            panel.style.top  = "20px";
            panel.style.left = "20px";
        }

        const header = document.createElement("div");
        header.id = "tt-toolbar-header";
        header.style.cssText = `
            padding: 6px 10px !important;
            background: #000000 !important;
            color: #ffffff !important;
            cursor: grab !important;
            user-select: none !important;
            display: flex !important;
            justify-content: space-between !important;
            align-items: center !important;
            letter-spacing: 0.5px !important;
        `;
        header.innerHTML = `<span>🧰 Tools</span><span id="tt-toolbar-arrow">${this._collapsed ? "▸" : "▾"}</span>`;

        const list = document.createElement("div");
        list.id = "tt-toolbar-list";
        list.style.cssText = `
            display: ${this._collapsed ? "none" : "flex"} !important;
            flex-direction: column !important;
        `;

        panel.appendChild(header);
        panel.appendChild(list);
        document.body.appendChild(panel);

        this._panel         = panel;
        this._listContainer = list;

        this._wireDragAndCollapse(panel, header, list);
    },

    _wireDragAndCollapse(panel, header, list) {
        let isDragging = false, didDrag = false, startX, startY, startLeft, startTop;

        header.addEventListener("mousedown", (e) => {
            isDragging = true;
            didDrag    = false;
            startX     = e.clientX;
            startY     = e.clientY;
            startLeft  = parseInt(panel.style.left, 10);
            startTop   = parseInt(panel.style.top, 10);
            header.style.cursor = "grabbing";
            e.preventDefault();
        });

        document.addEventListener("mousemove", (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (Math.abs(dx) > 4 || Math.abs(dy) > 4) didDrag = true;
            panel.style.left = `${startLeft + dx}px`;
            panel.style.top  = `${startTop  + dy}px`;
        });

        document.addEventListener("mouseup", () => {
            if (!isDragging) return;
            isDragging = false;
            header.style.cursor = "grab";

            if (!didDrag) {
                this._collapsed = !this._collapsed;
                list.style.display = this._collapsed ? "none" : "flex";
                document.getElementById("tt-toolbar-arrow").textContent = this._collapsed ? "▸" : "▾";
                localStorage.setItem("tt-toolbar-collapsed", this._collapsed ? "1" : "0");
            } else {
                localStorage.setItem(
                    "tt-toolbar-pos",
                    JSON.stringify({ top: panel.style.top, left: panel.style.left })
                );
            }
            didDrag = false;
        });
    },

    _render() {
        this._ensurePanel();
        this._listContainer.innerHTML = "";

        this._actions.forEach(action => {
            const btn = document.createElement("button");
            btn.type        = "button";
            btn.textContent = action.label;
            btn.style.cssText = `
                display: block !important;
                width: 100% !important;
                text-align: left !important;
                background: #ffffff !important;
                color: #000000 !important;
                border: none !important;
                border-top: 1px solid #dddddd !important;
                padding: 7px 10px !important;
                font-family: monospace !important;
                font-size: 11px !important;
                letter-spacing: 0.5px !important;
                cursor: pointer !important;
            `;
            btn.addEventListener("mouseenter", () => { btn.style.background = "#f0f0f0"; });
            btn.addEventListener("mouseleave", () => { btn.style.background = "#ffffff"; });
            btn.addEventListener("click", action.onClick);
            this._listContainer.appendChild(btn);
        });
    }
};