// ─────────────────────────────────────────────────────
//  FEATURE: Schedule Preview Tools
//  Tradetech's own "Preview" page (schedule_preview.pl?record=NNNNN)
//  shows a read-only preview of a service's schedule. This adds:
//    🖼 Open Proof File — a Toolbar entry that asks the relay to open
//       the newest downloaded proof (PNG or Excel) for this service
//       directly in its OS-associated app (no browser tab, no
//       download prompt — see /open-file in routes/files.js).
//    ✅ Mark Done — its own standalone floating notification-style
//       button (NOT tucked inside the collapsible Toolbar panel,
//       since it's the main action on this page) that marks the due
//       service done (same as the relay dashboard's Mark Done)
//       and best-effort closes the opened proof file's process
//       (see /kill-process — not guaranteed, since some apps hand
//       the file off to an already-running instance).
//  Both require the page's record id to resolve to a service code via
//  the relay's /due-services list (the same "record" scraped by
//  due-service-scanner-relay.js from the due-services search results page).
// ─────────────────────────────────────────────────────

// Styled to match the fixed-position notification banners in
// src/utils/banner.js (monospace, bold border, offset box-shadow) so
// it reads as part of the same "notification" family rather than a
// generic page button — but its own element/position since it's an
// action, not a passive banner.
const MARK_DONE_BUTTON_STYLE = `
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 999999;
    background: #d6f5d6;
    color: #0a3d0a;
    border: 2px solid #1e7d1e;
    border-radius: 0px;
    padding: 10px 16px;
    font-family: monospace;
    font-size: 12px;
    font-weight: bold;
    letter-spacing: 0.5px;
    box-shadow: 3px 3px 0px #1e7d1e;
    cursor: pointer;
`;

// `openedFileRef` is a { current } holder (not a plain variable) so the
// "Open Proof File" button — registered separately, possibly before this
// button even exists — can keep updating the SAME reference that Mark
// Done reads from, without the two needing to share module state.
function createMarkDoneButton(record, openedFileRef) {
    const btn = document.createElement("button");
    btn.id          = "tt-preview-mark-done";
    btn.type        = "button";
    btn.textContent = "✅ Mark Done";
    btn.style.cssText = MARK_DONE_BUTTON_STYLE;

    btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
            await fetch("http://localhost:3737/due-services/mark-done", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ record })
            });
            btn.textContent = "✅ Marked Done!";

            // Best-effort close of the proof file opened via "Open Proof
            // File" — see /kill-process in routes/files.js for why this
            // isn't guaranteed to work for every app.
            if (openedFileRef.current) {
                fetch("http://localhost:3737/kill-process", {
                    method:  "POST",
                    headers: { "Content-Type": "application/json" },
                    body:    JSON.stringify({ name: openedFileRef.current })
                }).catch(err => console.warn("⚠ Schedule Preview Tools: could not close proof file:", err.message));
                openedFileRef.current = null;
            }

            // Close this tab too — via the background script's
            // chrome.tabs.remove(), NOT window.close(). window.close()
            // only works when the tab has a live window.opener reference,
            // which Tradetech's own Preview link doesn't reliably leave
            // in place (confirmed: it silently did nothing). chrome.tabs
            // is a privileged extension API and isn't subject to that
            // restriction at all.
            chrome.runtime.sendMessage({ type: "CLOSE_TAB" });
        } catch (err) {
            console.error("❌ Schedule Preview Tools: mark-done failed:", err.message);
            btn.textContent = "❌ Mark Done failed — retry";
            btn.disabled = false;
        }
    });

    document.body.appendChild(btn);
}

const SchedulePreviewTools = {
    _loaded: false,

    async init() {
        if (!location.href.includes("schedule_preview.pl")) return;

        const record = new URLSearchParams(location.search).get("record");
        if (!record) return;

        onRelayConnectionStatusChange((state) => {
            if (state === "connected" && !this._loaded) this.load(record);
        });
    },

    async load(record) {
        this._loaded = true;

        let service;
        try {
            const res  = await fetch("http://localhost:3737/due-services");
            const data = await res.json();
            const entry = (data.services || []).find(s => s.record === record);
            if (!entry) {
                console.warn(`⚠ Schedule Preview Tools: no due-service found for record ${record}`);
                return;
            }
            service = entry.service;
        } catch (err) {
            this._loaded = false; // allow the next reconnect transition to retry
            return;
        }

        const openedFileRef = { current: null };

        try {
            const res  = await fetch(`http://localhost:3737/find-file?service=${encodeURIComponent(service)}&anyDate=1`);
            const data = await res.json();
            const file = (data.files || [])[0];

            if (file) {
                Toolbar.register({
                    id:      "tt-preview-open-proof",
                    label:   "🖼 Open Proof File",
                    title:   "Open the proof file matched to this service in its default app",
                    group:   "proof",
                    requiresRelay: true,
                    onClick: async () => {
                        try {
                            await fetch(`http://localhost:3737/open-file?name=${encodeURIComponent(file)}`);
                            openedFileRef.current = file;
                        } catch (err) {
                            console.error("❌ Schedule Preview Tools: could not open proof file:", err.message);
                        }
                    }
                });
            } else {
                console.warn(`⚠ Schedule Preview Tools: no proof file found for service ${service}`);
            }
        } catch (err) {
            this._loaded = false;
            return;
        }

        createMarkDoneButton(record, openedFileRef);
    },

    handle(_event) {}
};
