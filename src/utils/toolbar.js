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
    _ws:            null,

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

    // Connects to the relay's WebSocket so the collapsed/expanded state
    // stays in sync LIVE across every open tab — same self-reconnecting
    // pattern used by service-relay-send.js / rename-toggle.js. Local
    // clicks broadcast their new state out; messages from OTHER tabs
    // update this tab's panel without re-broadcasting (no feedback loop).
    _connectWebSocket() {
        if (this._ws) return; // already connecting/connected

        this._ws = new WebSocket("ws://localhost:3737");

        this._ws.addEventListener("open", () => {
            console.log("🔌 Toolbar connected to relay");
        });

        this._ws.addEventListener("message", (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data.type === "init" && typeof data.toolbarCollapsed === "boolean") {
                    this._applyCollapsedState(data.toolbarCollapsed, false);
                }

                if (data.type === "toolbar-collapsed") {
                    this._applyCollapsedState(data.collapsed, false);
                }
            } catch (err) {
                console.error("❌ Toolbar bad WebSocket message:", err);
            }
        });

        this._ws.addEventListener("close", () => {
            console.log("🔌 Toolbar disconnected from relay — reconnecting in 3s");
            this._ws = null;
            setTimeout(() => this._connectWebSocket(), 3000);
        });

        this._ws.addEventListener("error", () => {
            console.error("❌ Toolbar WebSocket error — will retry on close");
        });
    },

    // Updates the collapsed state and re-renders the panel to match.
    // `broadcast` controls whether this change should be sent OUT to
    // other tabs (true for a local click) or not (false when this
    // update IS the incoming broadcast from another tab).
    _applyCollapsedState(collapsed, broadcast) {
        this._collapsed = collapsed;
        localStorage.setItem("tt-toolbar-collapsed", collapsed ? "1" : "0");

        if (this._panel) {
            const list = document.getElementById("tt-toolbar-list");
            const arrow = document.getElementById("tt-toolbar-arrow");
            if (list)  list.style.display = collapsed ? "none" : "flex";
            if (arrow) arrow.textContent  = collapsed ? "▸" : "▾";
        }

        if (broadcast && this._ws?.readyState === WebSocket.OPEN) {
            this._ws.send(JSON.stringify({ type: "toolbar-collapsed", collapsed }));
        }
    },

    _ensurePanel() {
        if (this._panel) return;

        this._connectWebSocket();
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
                this._applyCollapsedState(!this._collapsed, true); // true = broadcast this to other tabs
            } else {
                localStorage.setItem(
                    "tt-toolbar-pos",
                    JSON.stringify({ top: panel.style.top, left: panel.style.left })
                );
            }
            didDrag = false;
        });
    },

    // User-arranged order persists across reloads. Unknown ids (never
    // seen before, e.g. a freshly-added feature) fall in at the end in
    // whatever order they registered — the saved order only ever needs
    // to name ids it actually knows about.
    _loadOrder() {
        try {
            return JSON.parse(localStorage.getItem("tt-toolbar-order")) || [];
        } catch {
            return [];
        }
    },

    _saveOrder(order) {
        localStorage.setItem("tt-toolbar-order", JSON.stringify(order));
    },

    _orderedActions() {
        const order = this._loadOrder();
        const ordered = order
            .map(id => this._actions.find(a => a.id === id))
            .filter(Boolean);
        const rest = this._actions.filter(a => !order.includes(a.id));
        return [...ordered, ...rest];
    },

    // Moves draggedId to sit just before targetId in the persisted order,
    // then re-renders.
    _reorder(draggedId, targetId) {
        const current = this._orderedActions().map(a => a.id);
        const from = current.indexOf(draggedId);
        if (from === -1 || draggedId === targetId) return;
        current.splice(from, 1);
        current.splice(current.indexOf(targetId), 0, draggedId);
        this._saveOrder(current);
        this._render();
    },

    _render() {
        this._ensurePanel();
        this._listContainer.innerHTML = "";

        this._orderedActions().forEach(action => {
            const btn = document.createElement("button");
            btn.type        = "button";
            btn.textContent = action.label;
            btn.draggable   = true;
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
                cursor: grab !important;
            `;
            btn.addEventListener("mouseenter", () => { btn.style.background = "#e8f2fa"; });
            btn.addEventListener("mouseleave", () => { btn.style.background = "#ffffff"; });
            btn.addEventListener("click", action.onClick);

            // Drag-to-reorder — native HTML5 drag/drop, no library needed.
            // Drop position is "insert before whatever you dropped it on."
            btn.addEventListener("dragstart", (e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", action.id);
                btn.style.opacity = "0.4";
            });
            btn.addEventListener("dragend", () => { btn.style.opacity = "1"; });
            btn.addEventListener("dragover", (e) => {
                e.preventDefault();
                btn.style.borderTop = "2px solid #1e5f9e";
            });
            btn.addEventListener("dragleave", () => {
                btn.style.borderTop = "1px solid #dddddd";
            });
            btn.addEventListener("drop", (e) => {
                e.preventDefault();
                const draggedId = e.dataTransfer.getData("text/plain");
                this._reorder(draggedId, action.id);
            });

            this._listContainer.appendChild(btn);
        });
    }
};