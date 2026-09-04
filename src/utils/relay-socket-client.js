// ============================================================
//  Shared relay WebSocket connection
//  Keeps the localhost URL and reconnect-on-close lifecycle in
//  one place while leaving every caller's message semantics in
//  that caller. `onSocket` runs for every replacement socket so
//  existing features can keep their familiar `this.ws` handle.
// ============================================================

const RelayConnectionStatus = {
    state: "connecting",
    openSockets: new Set(),
    listeners: new Set(),

    setSocketOpen(socket, isOpen) {
        if (isOpen) this.openSockets.add(socket);
        else this.openSockets.delete(socket);
        this.setState(this.openSockets.size ? "connected" : "unavailable");
    },

    setState(state) {
        if (this.state === state) return;
        this.state = state;
        this.listeners.forEach(listener => listener(state));
    },

    subscribe(listener) {
        this.listeners.add(listener);
        listener(this.state);
        return () => this.listeners.delete(listener);
    }
};

function onRelayConnectionStatusChange(listener) {
    return RelayConnectionStatus.subscribe(listener);
}

function isRelayConnected() {
    return RelayConnectionStatus.state === "connected";
}

function connectRelaySocket(options = {}) {
    const reconnectMs = options.reconnectMs ?? 3000;
    let socket = null;
    let reconnectTimer = null;
    let stopped = false;
    let nextReconnectMs = reconnectMs;

    function connect() {
        if (stopped) return;

        const currentSocket = new WebSocket("ws://localhost:3737");
        socket = currentSocket;
        options.onSocket?.(currentSocket);

        currentSocket.addEventListener("open", (event) => {
            nextReconnectMs = reconnectMs;
            RelayConnectionStatus.setSocketOpen(currentSocket, true);
            options.onOpen?.(event, currentSocket);
        });
        currentSocket.addEventListener("message", (event) => options.onMessage?.(event, currentSocket));
        currentSocket.addEventListener("error", (event) => options.onError?.(event, currentSocket));
        currentSocket.addEventListener("close", (event) => {
            RelayConnectionStatus.setSocketOpen(currentSocket, false);
            options.onClose?.(event, currentSocket);
            if (stopped) return;
            reconnectTimer = setTimeout(connect, nextReconnectMs);
            // A normal server restart reconnects after the original 3s.
            // A machine with no relay installed gradually settles at one
            // quiet probe per minute instead of failing noisily forever.
            nextReconnectMs = Math.min(nextReconnectMs * 2, 60000);
        });
    }

    connect();

    return {
        get socket() {
            return socket;
        },
        stop() {
            stopped = true;
            clearTimeout(reconnectTimer);
            RelayConnectionStatus.setSocketOpen(socket, false);
            socket?.close();
        }
    };
}
