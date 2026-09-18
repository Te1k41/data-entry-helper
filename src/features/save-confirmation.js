// ─────────────────────────────────────────────────────
//  FEATURE: Save Confirmation
//  Intercepts the Save button and shows a full-screen overlay
//  listing the entire port rotation before actually saving —
//  a last look at the whole route so a mistake isn't committed
//  by reflex. "Back" cancels (Save never runs); "Confirm & Save"
//  re-invokes the button's own original click handler. Togglable
//  via the "Confirm rotation before Save" Custom Rule.
//
//  The Save BUTTON can live in a different frame than the port
//  rows (same page/quirk validation.js already documents). This
//  attaches directly in whichever frame the button itself is
//  found in (via polling, same shape as validation.js's own
//  watchSaveButton()), then reads the port rotation cross-frame
//  (same-origin) from whichever sibling frame actually has the
//  SP*_port_name fields. The listener is registered on `document`
//  with capture:true — NOT on the button itself — because a
//  capture-phase listener on the target element runs in plain
//  REGISTRATION ORDER same as any other target-phase listener
//  (the inline onclick="..." attribute was already attached
//  during page parse, long before this content script runs), so
//  only a listener on an ANCESTOR actually fires first and can
//  stop the event before Tradetech's own onclick ever executes.
// ─────────────────────────────────────────────────────
const SaveConfirmation = {
    SAVE_BUTTON_SELECTOR: 'input[type="button"][value="Save"]',

    // Finds whichever frame (this one, or a same-origin sibling under
    // the same parent frameset) actually holds the port rows. Never
    // hardcodes a frame name — same lesson learned the hard way for
    // AwrAudit and SP001DateValidation on this exact page.
    findFormDocument() {
        if (document.querySelector('input[name^="SP"][name$="_port_name"]')) return document;

        let siblingFrames;
        try {
            siblingFrames = parent?.frames;
        } catch {
            return null;
        }
        if (!siblingFrames) return null;

        for (let i = 0; i < siblingFrames.length; i++) {
            try {
                const doc = siblingFrames[i]?.document;
                if (doc?.querySelector('input[name^="SP"][name$="_port_name"]')) return doc;
            } catch {
                // cross-origin or otherwise inaccessible — skip, keep checking the rest
            }
        }
        return null;
    },

    // Every non-blank port row, in order, with its dates — blank rows
    // (past the end of the actual rotation) are skipped.
    buildRotationRows(formDoc) {
        const nameFields = Array.from(formDoc.querySelectorAll(
            'input[type="text"][name^="SP"][name$="_port_name"]'
        ));

        return nameFields
            .map(field => {
                const match = field.name.match(/^SP(\d+)_port_name$/);
                if (!match) return null;

                const name = field.value.trim();
                if (!name) return null;

                const row     = match[1];
                const arrival = formDoc.querySelector(`input[name="SP${row}_arrival_date"]`)?.value.trim() || "";
                const depart  = formDoc.querySelector(`input[name="SP${row}_depart_date"]`)?.value.trim()  || "";

                return { row, name, arrival, depart };
            })
            .filter(Boolean);
    },

    // Injected into window.top so the overlay covers the whole page
    // regardless of which small frame the Save button itself sits in.
    showOverlay(rows, onConfirm) {
        let topDoc;
        try {
            topDoc = window.top.document;
        } catch {
            topDoc = document;
        }

        if (topDoc.getElementById("tt-save-confirm-overlay")) return; // already showing

        const overlay = topDoc.createElement("div");
        overlay.id = "tt-save-confirm-overlay";
        overlay.style.cssText = `
            position: fixed !important;
            inset: 0 !important;
            z-index: 2147483647 !important;
            background: rgba(0, 0, 0, 0.6) !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            font-family: monospace !important;
        `;

        const box = topDoc.createElement("div");
        box.style.cssText = `
            background: #ffffff !important;
            border: 2px solid #000000 !important;
            box-shadow: 4px 4px 0px #000000 !important;
            width: 420px !important;
            max-width: 90vw !important;
            max-height: 80vh !important;
            display: flex !important;
            flex-direction: column !important;
        `;

        const header = topDoc.createElement("div");
        header.textContent = "🔁 Confirm rotation before saving";
        header.style.cssText = `
            padding: 10px 14px !important;
            background: #000000 !important;
            color: #ffffff !important;
            font-weight: bold !important;
            font-size: 13px !important;
        `;

        const list = topDoc.createElement("div");
        list.style.cssText = `
            padding: 8px 14px !important;
            overflow-y: auto !important;
            font-size: 11px !important;
        `;

        if (rows.length === 0) {
            const empty = topDoc.createElement("div");
            empty.textContent = "(no ports entered yet)";
            empty.style.cssText = "color: #666666 !important; padding: 8px 0 !important;";
            list.appendChild(empty);
        } else {
            rows.forEach(r => {
                const line = topDoc.createElement("div");
                line.style.cssText = "padding: 4px 0 !important; border-bottom: 1px dashed #cccccc !important;";
                line.textContent = `SP${r.row}  ${r.name}  (Arr: ${r.arrival || "—"} / Dep: ${r.depart || "—"})`;
                list.appendChild(line);
            });
        }

        const footer = topDoc.createElement("div");
        footer.style.cssText = `
            padding: 10px 14px !important;
            display: flex !important;
            gap: 8px !important;
            justify-content: flex-end !important;
            border-top: 2px solid #000000 !important;
        `;

        const backBtn = topDoc.createElement("button");
        backBtn.type = "button";
        backBtn.textContent = "⬅ Back";
        backBtn.style.cssText = `
            padding: 6px 12px !important;
            font-family: monospace !important;
            font-weight: bold !important;
            font-size: 11px !important;
            background: #f0f0f0 !important;
            border: 1px solid #000000 !important;
            cursor: pointer !important;
        `;
        backBtn.addEventListener("click", () => overlay.remove());

        const confirmBtn = topDoc.createElement("button");
        confirmBtn.type = "button";
        confirmBtn.textContent = "✅ Confirm & Save";
        confirmBtn.style.cssText = `
            padding: 6px 12px !important;
            font-family: monospace !important;
            font-weight: bold !important;
            font-size: 11px !important;
            background: #d6f5d6 !important;
            border: 1px solid #1e7d1e !important;
            cursor: pointer !important;
        `;
        confirmBtn.addEventListener("click", () => {
            overlay.remove();
            onConfirm();
        });

        footer.appendChild(backBtn);
        footer.appendChild(confirmBtn);

        box.appendChild(header);
        box.appendChild(list);
        box.appendChild(footer);
        overlay.appendChild(box);
        topDoc.body.appendChild(overlay);
    },

    attach(button) {
        document.addEventListener("click", (event) => {
            if (event.target !== button) return;
            if (!CustomRules.isEnabled("confirmRotationBeforeSave")) return;

            const formDoc = this.findFormDocument();
            if (!formDoc) return; // no rotation data found anywhere — never block Save on a page we can't read

            // Capture phase on an ANCESTOR (document, not the button
            // itself) — this is what actually wins the race against
            // the inline onclick attribute (see file header comment).
            event.preventDefault();
            event.stopImmediatePropagation();

            const rows = this.buildRotationRows(formDoc);
            this.showOverlay(rows, () => {
                if (typeof button.onclick === "function") button.onclick();
            });
        }, true);
    },

    // Polls briefly for the Save button — same shape as
    // validation.js's watchSaveButton() — since a one-shot check at
    // document_idle that finds nothing would otherwise never manage
    // Save for the rest of this page load if it rendered a moment late.
    watchSaveButton() {
        const button = document.querySelector(this.SAVE_BUTTON_SELECTOR);
        if (button) {
            this.attach(button);
            return;
        }

        let attempts = 0;
        const maxAttempts = 50; // 5s ceiling
        const timer = setInterval(() => {
            attempts++;
            const found = document.querySelector(this.SAVE_BUTTON_SELECTOR);
            if (found) {
                clearInterval(timer);
                this.attach(found);
                return;
            }
            if (attempts >= maxAttempts) clearInterval(timer); // no Save button in this frame — nothing to manage
        }, 100);
    },

    init() {
        this.watchSaveButton();
    },

    handle(_event) {}
};
