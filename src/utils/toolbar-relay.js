// Relay companion for Toolbar; loaded immediately after toolbar.js.
const ToolbarRelay = {
    _ws: null,
    _socketClient: null,
    _relayUnsubscribe: null,

    // Connects to the relay's WebSocket so the collapsed/expanded state
    // stays in sync LIVE across every open tab — same self-reconnecting
    // pattern used by service-relay-send-relay.js / rename-toggle-relay.js. Local
    // clicks broadcast their new state out; messages from OTHER tabs
    // update this tab's panel without re-broadcasting (no feedback loop).
    connect() {
        if (this._socketClient) return; // helper already owns connecting/reconnecting

        // Subscription synchronously re-renders and re-enters this hook.
        // Reserve the guard before subscribing, then store the actual client.
        this._socketClient = {};
        this._relayUnsubscribe = onRelayConnectionStatusChange((state) => {
            Toolbar._relayStatus = state;
            if (Toolbar._listContainer) Toolbar._render();
        });

        this._socketClient = connectRelaySocket({
            onSocket: (socket) => { this._ws = socket; },

            onMessage: (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data.type === "init" && typeof data.toolbarCollapsed === "boolean") {
                    Toolbar._applyCollapsedState(data.toolbarCollapsed, false);
                }

                if (data.type === "toolbar-collapsed") {
                    Toolbar._applyCollapsedState(data.collapsed, false);
                }
            } catch (err) {
                console.error("❌ Toolbar bad WebSocket message:", err);
            }
            }
        });
    },

    broadcastCollapsed(collapsed) {
        if (this._ws?.readyState === WebSocket.OPEN) {
            this._ws.send(JSON.stringify({ type: "toolbar-collapsed", collapsed }));
        }
    },
};

Toolbar._ensureHooks.push(() => ToolbarRelay.connect());
Toolbar._broadcastHooks.push(collapsed => ToolbarRelay.broadcastCollapsed(collapsed));
