// ─────────────────────────────────────────────────────
//  FEATURE: Rename Toggle
//  Syncs rename ON/OFF state across all tabs and
//  browsers via WebSocket relay.
// ─────────────────────────────────────────────────────
const RenameToggle = {

    ws:      null,
    enabled: true,

    init() {
    this.connect();
    // wait for init message from server before creating button
    // so label shows correct state from the start
    this.ws.addEventListener("open", () => {
        setTimeout(() => this.createToggleButton(), 200);
    });
},

    connect() {
        this.ws = new WebSocket("ws://localhost:3737");

        this.ws.addEventListener("open", () => {
            console.log("🔌 RenameToggle connected to relay");
        });

        this.ws.addEventListener("message", (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data.type === "init") {
                    this.enabled = data.renamingEnabled !== false;

                    // On mergeimagesonline.com, always force renaming back
                    // ON whenever this page loads/reconnects (e.g. a
                    // reload after a merge session), regardless of
                    // whatever state was left on from before.
                    if (location.hostname === "mergeimagesonline.com" && !this.enabled) {
                        this.enabled = true;
                        this.broadcastEnabled();
                        console.log("📁 mergeimagesonline.com loaded — forcing Rename: ON");
                    }

                    this.updateButton();
                }

                if (data.type === "renaming") {
                    this.enabled = data.enabled;
                    this.updateButton();
                }

            } catch (err) {
                console.error("❌ RenameToggle bad message:", err);
            }
        });

        this.ws.addEventListener("close", () => {
            console.log("🔌 RenameToggle disconnected — reconnecting in 3s");
            setTimeout(() => this.connect(), 3000);
        });
    },

    updateButton() {
        const btn = document.getElementById("tt-rename-toggle");
        if (btn) btn.textContent = `📁 Rename: ${this.enabled ? "ON" : "OFF"}`;
    },

    // Tells the relay server (and every other connected tab/browser)
    // about the current enabled state.
    broadcastEnabled() {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type:    "renaming",
                enabled: this.enabled
            }));
        }
    },

    createToggleButton() {
        createButton({
            id:      "tt-rename-toggle",
            position: "fixed",
            label:   `📁 Rename: ${this.enabled ? "ON" : "OFF"}`,
            top:     "20px",
            left:    "20px",
            onClick: () => {
                this.enabled = !this.enabled;
                this.broadcastEnabled();
                this.updateButton();
            }
        });
    },

    handle(_event)    {},
    handleBlur(_event) {}
};