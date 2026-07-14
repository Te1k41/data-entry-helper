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

        await chrome.storage.local.set({ pendingUpload: chosen });

        const supportBtn = this.findSupportDocsButton();
        if (!supportBtn) {
            alert("Support Document button not found on this page.");
            return;
        }
        supportBtn.click();
    },

    async tryAutoFill(fileInput) {
        const { pendingUpload } = await chrome.storage.local.get("pendingUpload");
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

            await chrome.storage.local.remove("pendingUpload");

            // Submit immediately — no confirm step.
            const submitBtn = document.querySelector('input[type="submit"][value="Upload"]');
            if (submitBtn) {
                submitBtn.click();
                console.log("🚀 Upload submitted automatically");
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

    handle(_event) {},
    handleBlur(_event) {}
};