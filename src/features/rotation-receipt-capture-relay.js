// ─────────────────────────────────────────────────────
//  FEATURE: Rotation Receipt Capture
//  Button-only trigger, same shape as awr-audit-relay.js. The
//  actual work — visiting a chosen set of records in hidden
//  background tabs and downloading each one's Rotation Receipt
//  PNG (via save-confirmation.js's SaveConfirmation.
//  captureForBatchAudit()) — runs in background-relay.js (needs
//  chrome.tabs/chrome.scripting/chrome.windows, which content
//  scripts don't have). This file just lets the user choose the
//  scope (every due-service record, or a specific list read from
//  an uploaded CSV export), asks the background to start, and
//  shows a banner.
//
//  Purely read + download — never touches/saves anything on any
//  page it visits. See save-confirmation.js's captureForBatchAudit()
//  and background-relay.js's runRotationReceiptCapture().
//
//  Registers unconditionally, in every injected frame — same
//  reasoning awr-audit-relay.js documents for its own button (a
//  window.top === window.self guard doesn't reliably fire exactly
//  once on this page's real frame structure).
//
//  Only registers its Toolbar button when the "Enable Rotation
//  Receipt Capture" Custom Rule is ON (default OFF) — same opt-in
//  pattern fix-vessel-dates.js/awr-audit-relay.js use.
//  applyVisibility() is re-run whenever any Custom Rule is toggled
//  (see custom-rules-settings.js).
// ─────────────────────────────────────────────────────
const RotationReceiptCapture = {
    BUTTON_ID: "tt-receipt-capture-btn",

    init() {
        this.applyVisibility();
    },

    applyVisibility() {
        if (CustomRules.isEnabled("enableRotationReceiptCapture")) {
            this.registerButton();
        } else {
            Toolbar.unregister(this.BUTTON_ID);
        }
    },

    registerButton() {
        Toolbar.register({
            id:        this.BUTTON_ID,
            label:     "🧾 Capture Receipts",
            title:     "Download a Rotation Receipt PNG for a chosen set of records, one background tab at a time",
            group:     "proof",
            draggable: false,
            requiresRelay: true,
            onClick: () => {
                console.log("🖱 Capture Receipts clicked");
                this.showScopePrompt();
            }
        });
    },

    // Small fixed-position prompt — 2 buttons, no page-covering overlay
    // needed for a choice this short. Appended to window.top the same
    // way save-confirmation.js's overlay is, so it isn't clipped by
    // whichever small frame the Toolbar itself lives in.
    showScopePrompt() {
        let topDoc;
        try { topDoc = window.top.document; } catch { topDoc = document; }

        if (topDoc.getElementById("tt-receipt-scope-prompt")) return; // already showing

        const box = topDoc.createElement("div");
        box.id = "tt-receipt-scope-prompt";
        box.style.cssText = `
            position: fixed !important;
            top: 50% !important;
            left: 50% !important;
            transform: translate(-50%, -50%) !important;
            z-index: 2147483647 !important;
            background: #ffffff !important;
            border: 2px solid #000000 !important;
            box-shadow: 4px 4px 0px #000000 !important;
            font-family: monospace !important;
            padding: 14px !important;
            width: 280px !important;
        `;

        box.innerHTML = `
            <div style="font-weight:bold; margin-bottom:10px;">🧾 Capture Receipts — run over:</div>
        `;

        const makeBtn = (label, cssBg) => {
            const btn = topDoc.createElement("button");
            btn.type = "button";
            btn.textContent = label;
            btn.style.cssText = `
                display: block !important;
                width: 100% !important;
                margin-bottom: 8px !important;
                padding: 8px !important;
                font-family: monospace !important;
                font-weight: bold !important;
                font-size: 11px !important;
                background: ${cssBg} !important;
                border: 1px solid #000000 !important;
                cursor: pointer !important;
            `;
            return btn;
        };

        const allBtn = makeBtn("All due-service records", "#d6f5d6");
        allBtn.addEventListener("click", () => {
            box.remove();
            this.start(null);
        });

        const csvBtn = makeBtn("Choose CSV file…", "#f0f0f0");
        csvBtn.addEventListener("click", () => {
            box.remove();
            this.pickCsvFile();
        });

        const cancelBtn = makeBtn("Cancel", "#f0f0f0");
        cancelBtn.style.marginBottom = "0";
        cancelBtn.addEventListener("click", () => box.remove());

        box.appendChild(allBtn);
        box.appendChild(csvBtn);
        box.appendChild(cancelBtn);

        const container = topDoc.body?.tagName === "BODY" ? topDoc.body : topDoc.documentElement;
        container.appendChild(box);
    },

    pickCsvFile() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".csv";
        input.style.display = "none";

        input.addEventListener("change", () => {
            const file = input.files?.[0];
            input.remove();
            if (!file) return;

            const reader = new FileReader();
            reader.onload = () => {
                const records = this.extractRecordsFromCsv(String(reader.result || ""));
                if (records.length === 0) {
                    showTemporaryBanner({ title: "🧾 Capture Receipts", message: `No "Record" column found (or no rows) in ${file.name}` });
                    return;
                }
                this.start(records);
            };
            reader.readAsText(file);
        });

        document.body.appendChild(input);
        input.click();
    },

    // Minimal quoted-CSV line parser — a plain .split(",") breaks on
    // real Tradetech exports, which have quoted fields containing their
    // own commas (e.g. "On: 13-AUG-2026, By: emlTTI"). Handles "" as an
    // escaped quote inside a quoted field, same as every standard CSV
    // export (Excel included) produces.
    parseCsv(text) {
        const rows = [];
        let row = [], field = "", inQuotes = false;

        for (let i = 0; i < text.length; i++) {
            const c = text[i];

            if (inQuotes) {
                if (c === '"') {
                    if (text[i + 1] === '"') { field += '"'; i++; }
                    else inQuotes = false;
                } else {
                    field += c;
                }
                continue;
            }

            if (c === '"') { inQuotes = true; continue; }
            if (c === ",") { row.push(field); field = ""; continue; }
            if (c === "\r") continue; // swallow, \n (below) ends the row either way
            if (c === "\n") {
                row.push(field);
                if (row.length > 1 || row[0] !== "") rows.push(row);
                row = [];
                field = "";
                continue;
            }
            field += c;
        }

        if (field !== "" || row.length) { row.push(field); rows.push(row); }
        return rows;
    },

    // Finds the "Record" column by header name (case-insensitive, exact
    // match — confirmed against a real Tradetech "Sail Schedules" CSV
    // export, header includes "#,Record,Service,...") and returns every
    // row's value in it, numeric-looking ones only.
    extractRecordsFromCsv(text) {
        const rows = this.parseCsv(text);
        if (rows.length === 0) return [];

        const header = rows[0];
        const recordIdx = header.findIndex(h => h.trim().toLowerCase() === "record");
        if (recordIdx === -1) return [];

        return rows.slice(1)
            .map(r => (r[recordIdx] || "").trim())
            .filter(v => /^\d+$/.test(v));
    },

    // `records`: null/omitted runs over every due-service record
    // (background-relay.js's existing fetch), otherwise an explicit
    // list of record IDs to visit instead.
    start(records) {
        chrome.runtime.sendMessage(
            { type: "RUN_ROTATION_RECEIPT_CAPTURE", records },
            (response) => {
                if (response?.started) {
                    showTemporaryBanner({
                        title:   "🧾 Receipt capture started",
                        message: records
                            ? `Running over ${records.length} record(s) from the CSV — watch the background service worker console for progress`
                            : "Running over every due-service record — watch the background service worker console for progress"
                    });
                } else if (response?.reason === "busy") {
                    showTemporaryBanner({
                        title:   "🧾 Capture Receipts",
                        message: `Another batch job (${response.runningJob}) is already running — try again once it finishes`
                    });
                } else {
                    showTemporaryBanner({ title: "🧾 Capture Receipts", message: "Failed to start — check the background service worker console" });
                }
            }
        );
    },

    handle(_event)    {},
    handleBlur(_event) {}
};
