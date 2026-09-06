// ─────────────────────────────────────────────────────
//  FEATURE: Service Relay Send
//  Sends service code to relay via WebSocket in
//  real-time whenever the service field changes.
// ─────────────────────────────────────────────────────
const ServiceRelaySend = {

    ws: null,
    _socketClient: null,

    init() {
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
        if (event.target.name !== "service") return;
        this.sendServiceCode();
    }
};
