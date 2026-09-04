// ============================================================
//  src/utils/toolbar.js (community edition)
//  Identical to the full extension's toolbar.js EXCEPT
//  _connectWebSocket() is a no-op here: this build ships no
//  relay-socket-client.js at all, so connectRelaySocket()/
//  onRelayConnectionStatusChange() don't exist to call. Losing
//  the cross-tab collapse-state sync is the only effect — local
//  collapse/position/reorder (localStorage-backed) all still
//  work exactly the same. Keep this file in sync with the real
//  src/utils/toolbar.js for anything else that changes there.
//
//  A single collapsible, draggable panel that all Tradetech-
//  page features register their actions into, instead of each
//  one creating its own independent floating button.
//
//  Usage (in a feature's init()):
//    Toolbar.register({
//        id:      "tt-my-action",
//        label:   "🔧 Do The Thing",
//        title:   "Explain the result of clicking it",
//        group:   "misc",
//        onClick: () => this.doTheThing()
//    });
//
//  For toggle-style buttons whose label needs to change after
//  a click (e.g. "Direction: ON" -> "Direction: OFF"):
//    Toolbar.updateLabel("tt-my-action", "🔧 Now OFF");
// ============================================================

const Toolbar = {
    _actions: [],
    _panel:         null,
    _listContainer: null,
    _collapsed:     false,
    _ws:            null,
    _socketClient:  null,
    _relayStatus:   "unavailable", // community edition: never has a relay to connect to
    _relayUnsubscribe: null,

    _groupOrder: ["vessel", "port", "date", "proof", "misc"],
    _groupLabels: {
        vessel: "VESSEL",
        port:   "PORT",
        date:   "DATE",
        proof:  "PROOF",
        misc:   "OTHER"
    },

    register(action) {
        if (this._actions.find(a => a.id === action.id)) return; // avoid dupes if init() ever runs twice
        this._actions.push(action);
        this._render();
    },

    updateLabel(id, newLabel, newTitle) {
        const action = this._actions.find(a => a.id === id);
        if (!action) return;
        action.label = newLabel;
        if (newTitle !== undefined) action.title = newTitle;
        this._render();
    },

    // No-op in the community edition — no relay-socket-client.js is
    // shipped, so there's nothing to connect to. Local collapse state
    // (localStorage) works fine without this; only cross-tab live sync
    // is lost.
    _connectWebSocket() {},

    // Updates the collapsed state and re-renders the panel to match.
    // `broadcast` is accepted for signature parity with the full
    // extension's version but never sends anything here — this._ws
    // never gets set (see _connectWebSocket above), so the guard below
    // always skips.
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

    // User-arranged order persists across reloads. It is projected into
    // each group rather than flattening the panel: old saved orders keep
    // their relative choices, while newly-added actions land in their
    // intended section instead of an unrelated end-of-list bucket.
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
        const savedIndex = new Map(order.map((id, index) => [id, index]));
        const registrationIndex = new Map(this._actions.map((action, index) => [action.id, index]));
        const groupIndex = group => {
            const index = this._groupOrder.indexOf(group);
            return index === -1 ? this._groupOrder.length : index;
        };

        return [...this._actions].sort((a, b) => {
            const groupDifference = groupIndex(a.group) - groupIndex(b.group);
            if (groupDifference) return groupDifference;

            const aSaved = savedIndex.has(a.id);
            const bSaved = savedIndex.has(b.id);
            if (aSaved && bSaved) return savedIndex.get(a.id) - savedIndex.get(b.id);
            if (aSaved !== bSaved) return aSaved ? -1 : 1;
            return registrationIndex.get(a.id) - registrationIndex.get(b.id);
        });
    },

    // Moves draggedId to sit just before targetId in the persisted order,
    // then re-renders.
    _reorder(draggedId, targetId) {
        const dragged = this._actions.find(action => action.id === draggedId);
        const target = this._actions.find(action => action.id === targetId);
        if (!dragged || !target || dragged.group !== target.group) return;

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

        let renderedGroup = null;
        this._orderedActions().forEach(action => {
            const group = action.group || "misc";
            if (group !== renderedGroup) {
                const heading = document.createElement("div");
                heading.textContent = this._groupLabels[group] || group.toUpperCase();
                heading.style.cssText = `
                    padding: 6px 10px 3px !important;
                    color: #666666 !important;
                    background: #f5f5f5 !important;
                    border-top: 1px solid #dddddd !important;
                    font-family: monospace !important;
                    font-size: 9px !important;
                    font-weight: bold !important;
                    letter-spacing: 1px !important;
                `;
                this._listContainer.appendChild(heading);
                renderedGroup = group;
            }

            const btn = document.createElement("button");
            btn.type        = "button";
            btn.textContent = action.label;
            const relayUnavailable = action.requiresRelay && this._relayStatus !== "connected";
            btn.title       = relayUnavailable
                ? (this._relayStatus === "connecting" ? "Checking for local relay server…" : "Requires the optional local relay server")
                : (action.title || action.label);
            btn.disabled    = relayUnavailable;
            btn.draggable   = action.draggable !== false;
            btn.style.cssText = `
                display: block !important;
                width: 100% !important;
                text-align: left !important;
                background: #ffffff !important;
                color: ${relayUnavailable ? "#777777" : "#000000"} !important;
                border: none !important;
                border-top: 1px solid #dddddd !important;
                padding: 7px 10px !important;
                font-family: monospace !important;
                font-size: 11px !important;
                letter-spacing: 0.5px !important;
                cursor: ${relayUnavailable ? "not-allowed" : (action.draggable !== false ? "grab" : "pointer")} !important;
                opacity: ${relayUnavailable ? "0.65" : "1"} !important;
            `;
            btn.addEventListener("mouseenter", () => { if (!btn.disabled) btn.style.background = "#e8f2fa"; });
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
                btn.style.borderTop = "1px solid #dddddd";
                const draggedId = e.dataTransfer.getData("text/plain");
                this._reorder(draggedId, action.id);
            });

            this._listContainer.appendChild(btn);
        });
    }
};

// One deliberately rare action can afford a reload: inline draggable
// buttons only read their defaults while being created. Reloading after
// clearing every saved position restores those defaults consistently,
// including buttons owned by features that are not currently visible.
Toolbar.register({
    id:      "tt-reset-layout",
    label:   "🧭 Reset Layout",
    title:   "Restore the toolbar and draggable row buttons to their default positions",
    group:   "misc",
    onClick: () => {
        localStorage.removeItem("tt-toolbar-pos");
        Object.keys(localStorage)
            .filter(key => key.startsWith("btn-pos-"))
            .forEach(key => localStorage.removeItem(key));

        Toolbar._panel.style.top = "20px";
        Toolbar._panel.style.left = "20px";
        showTemporaryBanner({
            title: "🧭 Layout reset",
            message: "Refreshing once to restore draggable row buttons."
        }, 1000);
        setTimeout(() => window.location.reload(), 450);
    }
});
