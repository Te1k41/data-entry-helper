// ─────────────────────────────────────────────────────
//  FEATURE: Merge Download Signal
//  When a file is downloaded from mergeimagesonline,
//  signals the relay server to run cleanup.
// ─────────────────────────────────────────────────────
const MergeDownloadSignal = {

    ws: null,

    init() {
        this.connect();
    },

    connect() {
        this.ws = new WebSocket("ws://localhost:3737");

        this.ws.addEventListener("open", () => {
            console.log("🔌 MergeDownloadSignal connected");
        });

        this.ws.addEventListener("close", () => {
            setTimeout(() => this.connect(), 3000);
        });
    },

    // called when user clicks download on mergeimagesonline
    signal() {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: "merge-download" }));
            console.log("📤 Merge download signal sent");
        }
    },

    init() {
        this.connect();

        // watch for download button clicks on mergeimagesonline
        document.addEventListener("click", (event) => {
    const target = event.target;

    if (
        target.tagName === "BUTTON" &&
        target.textContent.trim() === "Download Merged Image"
    ) {
        console.log("🖼 Merge download detected");
        // small delay to let the file land in Downloads first
        setTimeout(() => this.signal(), 2000);
    }
    });
    },

    handle(_event) {}
};