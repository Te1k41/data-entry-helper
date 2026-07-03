// ─────────────────────────────────────────────────────
//  FEATURE: Service Relay Send
//  Sends service code to relay via WebSocket in
//  real-time whenever the service field changes.
// ─────────────────────────────────────────────────────
const ServiceRelaySend = {

    ws: null,

    init() {
        this.connect();

        // send current service code on load
        setTimeout(() => this.sendServiceCode(), 1000);
    },

    connect() {
        this.ws = new WebSocket("ws://localhost:3737");

        this.ws.addEventListener("open", () => {
            console.log("🔌 ServiceRelaySend connected to relay");
            this.sendServiceCode();
        });

        this.ws.addEventListener("close", () => {
            console.log("🔌 ServiceRelaySend disconnected — reconnecting in 3s");
            setTimeout(() => this.connect(), 3000);
        });

        this.ws.addEventListener("error", () => {
            console.error("❌ ServiceRelaySend WebSocket error");
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