// ─────────────────────────────────────────────────────
//  FEATURE: Upload Proof
//  Button on main page opens the Support Document popup.
//  Same script running inside the popup detects the pending
//  job, fills the file input, and submits automatically —
//  a banner just confirms what happened, no click needed.
// ─────────────────────────────────────────────────────
const UploadProof = {

    async init() {
        // Are we in the popup? (FILE1 input exists here, not on main page)
        const fileInput = document.querySelector('input[name="FILE1"]');
        if (fileInput) {
            this.tryAutoFill(fileInput);
            return;
        }

        // Main page: register the trigger in the shared toolbar
        Toolbar.register({
            id:      "tt-upload-proof-btn",
            label:   "📤 Upload Proof",
            onClick: () => this.startUpload()
        });

        this.checkUploadStatus();

        // The popup (a SEPARATE window/content-script instance) is the
        // one that actually completes the upload and marks it done —
        // this listens for that so the main page's banner clears itself
        // live instead of staying stale until the next reload.
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === "local" && changes.uploadedProofLog) this.checkUploadStatus();
        });
    },

    // "{service}|{YYYY-MM-DD}" — proof upload is a once-per-day-per-service
    // thing (same convention download-watcher.js's renamed filenames use).
    uploadLogKey(service) {
        const today = new Date();
        const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        return `${service}|${dateStr}`;
    },

    async markUploaded(service) {
        const { uploadedProofLog } = await chrome.storage.local.get("uploadedProofLog");
        const log = uploadedProofLog || {};
        log[this.uploadLogKey(service)] = true;
        await chrome.storage.local.set({ uploadedProofLog: log });
    },

    // Shows/clears a warning banner (via the shared setWarning registry —
    // same system SP001 mismatch etc. use, so this combines cleanly with
    // any other active warning instead of fighting over the one banner).
    async checkUploadStatus() {
        const serviceField = document.querySelector('input[name="service"]');
        const service = serviceField?.value.trim();
        if (!service) { setWarning("upload-proof-missing", null); return; }

        const { uploadedProofLog } = await chrome.storage.local.get("uploadedProofLog");
        const uploaded = uploadedProofLog?.[this.uploadLogKey(service)];

        setWarning("upload-proof-missing", uploaded ? null : {
            title:   "📤 Proof not uploaded yet",
            message: `${service} — click "Upload Proof" once you have it.`
        });
    },

    // The Support Document button can live in a DIFFERENT frame than
    // the one this content script instance is running in (Tradetech
    // uses a frameset — onclick="parent.fr1.supportDocs()" is the tell).
    // Search this frame first, then walk every sibling frame under
    // window.top until we find it.
    findSupportDocsButton() {
        const selector = 'input[onclick*="supportDocs"]';

        // 1. Current frame
        let btn = document.querySelector(selector);
        if (btn) return btn;

        // 2. Known frame name — Tradetech's Support Document button lives
        // in a dynamically-written frame named "fr2" (src="", written via
        // document.write from the parent, so it never gets its own content
        // script instance — we have to reach into it directly).
        try {
            const fr2 = window.top.frames["fr2"];
            if (fr2 && fr2.document) {
                btn = fr2.document.querySelector(selector);
                if (btn) return btn;
            }
        } catch (err) {
            console.warn("⚠ Cannot access frame 'fr2'", err);
        }

        // 3. Top frame's own document
        try {
            if (window.top !== window) {
                btn = window.top.document.querySelector(selector);
                if (btn) return btn;
            }
        } catch (err) {
            console.warn("⚠ Cannot access top document (cross-origin?)", err);
        }

        // 4. Fallback — every frame under window.top
        try {
            const frames = window.top.frames;
            for (let i = 0; i < frames.length; i++) {
                try {
                    const frameDoc = frames[i].document;
                    btn = frameDoc.querySelector(selector);
                    if (btn) return btn;
                } catch (err) {
                    // cross-origin or not-yet-loaded frame — skip it
                }
            }
        } catch (err) {
            console.warn("⚠ Could not enumerate frames", err);
        }

        return null;
    },

    async startUpload() {
        const serviceField = document.querySelector('input[name="service"]');
        const service = serviceField?.value.trim();
        if (!service) { alert("Service code is not set."); return; }

        let files;
        try {
            const res = await fetch(`http://localhost:3737/find-file?service=${encodeURIComponent(service)}`);
            const data = await res.json();
            files = data.files;
        } catch (err) {
            alert("Could not reach the local relay server.");
            console.error("❌ find-file failed:", err);
            return;
        }

        if (!files || files.length === 0) {
            alert(`No proof file found for ${service} with today's date.`);
            return;
        }

        const chosen = files.sort().pop();
        console.log("📎 Chosen proof file:", chosen);

        await chrome.storage.local.set({ pendingUpload: chosen, pendingUploadService: service });

        const supportBtn = this.findSupportDocsButton();
        if (!supportBtn) {
            alert("Support Document button not found on this page.");
            return;
        }
        supportBtn.click();
    },

    async tryAutoFill(fileInput) {
        const { pendingUpload, pendingUploadService } = await chrome.storage.local.get(["pendingUpload", "pendingUploadService"]);
        if (!pendingUpload) return; // not our job, leave it alone

        console.log(`📤 Auto-filling upload with: ${pendingUpload}`);

        try {
            const res = await fetch(`http://localhost:3737/file?name=${encodeURIComponent(pendingUpload)}`);
            if (!res.ok) throw new Error("File fetch failed");
            const blob = await res.blob();
            const file = new File([blob], pendingUpload, { type: blob.type });

            const dt = new DataTransfer();
            dt.items.add(file);
            fileInput.files = dt.files;
            fileInput.dispatchEvent(new Event("change", { bubbles: true }));

            console.log("✅ File staged in FILE1 input");

            await chrome.storage.local.remove(["pendingUpload", "pendingUploadService"]);

            // Submit immediately — no confirm step.
            const submitBtn = document.querySelector('input[type="submit"][value="Upload"]');
            if (submitBtn) {
                submitBtn.click();
                console.log("🚀 Upload submitted automatically");
                if (pendingUploadService) await this.markUploaded(pendingUploadService);
                showTemporaryBanner({
                    title:   "✅ Upload submitted",
                    message: pendingUpload
                });
            } else {
                console.warn("⚠ Submit button not found");
                showBanner({
                    title:   "⚠ Upload proof staged, not submitted",
                    message: `Submit button not found — staged ${pendingUpload} manually`
                });
            }
        } catch (err) {
            console.error("❌ Auto-fill failed:", err);
            showBanner({
                title:   "❌ Upload proof failed",
                message: "Could not fetch or stage the file — check console"
            });
        }
    },

    // The service field can get filled/changed after init() already ran
    // (due-service-scanner/auto-nav-schedules populate it asynchronously,
    // and it's editable by hand too) — re-check whenever it changes so
    // the banner tracks whichever service is actually on screen.
    handle(event) {
        if (event.target?.name === "service") this.checkUploadStatus();
    },
    handleBlur(_event) {}
};