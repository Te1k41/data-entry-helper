// ─────────────────────────────────────────────────────
//  FEATURE: Service Relay Send
//  Sends service code to relay via WebSocket in
//  real-time whenever the service field changes.
// ─────────────────────────────────────────────────────
const ServiceRelaySend = {

    ws: null,
    _socketClient: null,

    // Batch jobs (Audit AWR, Rotation Receipt Capture — background-relay.js)
    // open real Tradetech pages in hidden tabs to read/act on ONE OTHER
    // record while the user is actively working on a completely different
    // one. Without this, each of those tabs would report ITS record's
    // service code here ~1s after load, silently overwriting the relay
    // server's "current service" with whatever the batch happens to be
    // visiting at that moment — confirmed real bug, not hypothetical.
    // Both batch jobs mark their tab URLs with `ttBatchJob=1` specifically
    // so this (and anything else that shouldn't run on them) can bail out.
    isBatchTab() {
        return new URLSearchParams(location.search).has("ttBatchJob");
    },

    init() {
        if (this.isBatchTab()) return;

        this.connect();

        // send current service code on load
        setTimeout(() => this.sendServiceCode(), 1000);
    },

    connect() {
        this._socketClient = connectRelaySocket({
            onSocket: (socket) => { this.ws = socket; },
            onOpen: () => {
            this.sendServiceCode();
            }
        });
    },

    sendServiceCode() {
        const serviceField = document.querySelector('input[name="service"]');
        if (!serviceField) return;

        const value = serviceField.value.trim();
        if (!value) return;

        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: "service", code: value }));
            console.log("📤 Service code sent:", value);
        }
    },

    handle(event) {
        if (this.isBatchTab()) return;
        if (event.target.name !== "service") return;
        this.sendServiceCode();
    }
};
