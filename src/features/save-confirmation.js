// ─────────────────────────────────────────────────────
//  FEATURE: Save Confirmation
//  Intercepts the Save button and shows a full-screen overlay
//  listing the entire port rotation before actually saving —
//  a last look at the whole route so a mistake isn't committed
//  by reflex. "Back" cancels (Save never runs); "Confirm & Save"
//  fires a real button.click() back at the Save button (marked
//  with a one-shot bypass flag so it isn't re-intercepted) — not
//  a direct button.onclick() call, so every listener Tradetech
//  has wired to it fires exactly as a genuine click would, not
//  just the inline onclick="..." attribute alone. Togglable via
//  the "Confirm rotation before Save" Custom Rule.
//
//  The Save BUTTON can live in a different frame than the port
//  rows (same page/quirk validation.js already documents). This
//  runs in every frame; whichever one actually has the click reads
//  the port rotation cross-frame (same-origin) from whichever
//  sibling frame has the SP*_port_name fields. The listener is
//  registered on `document` with capture:true, matched by SELECTOR
//  rather than bound to one found-in-advance element — see init()'s
//  own comment for why. capture:true on `document` (an ANCESTOR,
//  not the button itself) is what wins the race against the inline
//  onclick="..." attribute: a capture-phase listener on the target
//  element itself would run in plain REGISTRATION ORDER same as any
//  other target-phase listener, and the onclick attribute was
//  already attached during page parse, long before this content
//  script runs — only a listener on an ancestor fires first.
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
                const diffMismatch = this.checkDiffMismatch(formDoc, row, arrival, depart);

                return { row, name, arrival, depart, diffMismatch };
            })
            .filter(Boolean);
    },

    // SP*_arrival_date_diff / SP*_depart_date_diff are Tradetech's OWN
    // fields tracking each date as a day-offset from SP001's arrival
    // date (confirmed via schedule-cascade.js's applyCascade(), which
    // reconstructs SP{row}_arrival_date as SP001_arrival_date + the
    // stored diff). This is exactly the kind of "visual only, not
    // confirmed" gap reported: the +/- step buttons write the date
    // field directly (setFieldValue fires input/change), but if
    // Tradetech's own diff recalculation for that field is driven by
    // something else (e.g. a real blur, which clicking an adjacent
    // button never causes since the date field itself never gets
    // focus), the diff field can go stale — schedule-cascade.js's own
    // storeDiffs() already had to guard against exactly this ("that's
    // the sign Tradetech hasn't recalculated it yet"). If the diff
    // field's value doesn't match what the visible date actually
    // implies, Tradetech's save may end up using the stale diff
    // instead of the date on screen — reported as saved dates slipping
    // 1-2 days off from what was shown before Save.
    checkDiffMismatch(formDoc, row, arrivalStr, departStr) {
        const sp001Field = formDoc.querySelector('input[name="SP001_arrival_date"]');
        const sp001Date  = sp001Field ? DateUtils.parse(sp001Field.value) : null;
        if (!sp001Date) return false;

        const DAY_MS = 86400000;

        const arrivalDiffField = formDoc.querySelector(`input[name="SP${row}_arrival_date_diff"]`);
        if (arrivalDiffField?.value.trim() && arrivalStr) {
            const actualDate = DateUtils.parse(arrivalStr);
            const storedDiff = parseInt(arrivalDiffField.value.trim(), 10);
            if (actualDate && !isNaN(storedDiff)) {
                const expectedDiff = Math.round((actualDate - sp001Date) / DAY_MS);
                if (storedDiff !== expectedDiff) return true;
            }
        }

        const departDiffField = formDoc.querySelector(`input[name="SP${row}_depart_date_diff"]`);
        if (departDiffField?.value.trim() && departStr) {
            const actualDate = DateUtils.parse(departStr);
            const storedDiff = parseInt(departDiffField.value.trim(), 10);
            if (actualDate && !isNaN(storedDiff)) {
                const expectedDiff = Math.round((actualDate - sp001Date) / DAY_MS);
                if (storedDiff !== expectedDiff) return true;
            }
        }

        return false;
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
            width: 520px !important;
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

        const mismatchCount = rows.filter(r => r.diffMismatch).length;
        let warning = null;
        if (mismatchCount > 0) {
            warning = topDoc.createElement("div");
            warning.textContent = `⚠ ${mismatchCount} port(s) below (highlighted) don't match Tradetech's own saved date offset — the date shown may not be what actually gets saved. Double-check before confirming.`;
            warning.style.cssText = `
                padding: 8px 14px !important;
                background: #ffe9d6 !important;
                color: #7a3b00 !important;
                font-size: 10px !important;
                font-weight: bold !important;
                border-bottom: 1px solid #cc7a00 !important;
            `;
        }

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
            const table = topDoc.createElement("table");
            table.style.cssText = `
                width: 100% !important;
                border-collapse: collapse !important;
                font-family: monospace !important;
                font-size: 11px !important;
            `;

            const thead = topDoc.createElement("thead");
            const headRow = topDoc.createElement("tr");
            ["Port", "Arrival", "Depart"].forEach(label => {
                const th = topDoc.createElement("th");
                th.textContent = label;
                th.style.cssText = `
                    text-align: left !important;
                    padding: 4px 6px !important;
                    border-bottom: 2px solid #000000 !important;
                `;
                headRow.appendChild(th);
            });
            thead.appendChild(headRow);
            table.appendChild(thead);

            const tbody = topDoc.createElement("tbody");
            rows.forEach(r => {
                const tr = topDoc.createElement("tr");
                if (r.diffMismatch) tr.style.cssText = "background: #ffe9d6 !important;";

                const portCell = topDoc.createElement("td");
                portCell.textContent = `${r.diffMismatch ? "⚠ " : ""}SP${r.row}  ${r.name}`;
                portCell.style.cssText = "padding: 4px 6px !important; border-bottom: 1px dashed #cccccc !important;";

                const arrivalCell = topDoc.createElement("td");
                arrivalCell.textContent = r.arrival || "—";
                arrivalCell.style.cssText = "padding: 4px 6px !important; border-bottom: 1px dashed #cccccc !important;";

                const departCell = topDoc.createElement("td");
                departCell.textContent = r.depart || "—";
                departCell.style.cssText = "padding: 4px 6px !important; border-bottom: 1px dashed #cccccc !important;";

                tr.appendChild(portCell);
                tr.appendChild(arrivalCell);
                tr.appendChild(departCell);
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);

            list.appendChild(table);
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
        if (warning) box.appendChild(warning);
        box.appendChild(list);
        box.appendChild(footer);
        overlay.appendChild(box);

        // topDoc.body is NOT necessarily a real <body> — per the HTML
        // spec, "the body element" of a frameset document IS the
        // <frameset> element itself (this page has no <body> at all).
        // A <frameset> only lays out <frame> children per its own
        // cols/rows grid; any other appended child (our overlay) gets
        // no layout slot and silently never paints, even though the
        // DOM insertion itself succeeds with no error — confirmed live
        // (all the way through "showing overlay" logged, nothing ever
        // appeared). <html> has no such restriction, so that's the
        // real fix, not .body.
        const container = topDoc.body?.tagName === "BODY" ? topDoc.body : topDoc.documentElement;
        container.appendChild(overlay);
    },

    // Delegated on `document` by SELECTOR MATCH, not bound to one
    // polled-for element reference. This page's frameset is known to
    // duplicate/recreate elements (see project_tradetech_frameset_
    // duplication) — a listener attached to one specific button node
    // found early can end up watching a stale, already-replaced
    // element while the real, currently-rendered Save button goes
    // unmonitored. Matching on every click by selector instead means
    // it doesn't matter which node is live at click time.
    // A field the user is still typing in hasn't fired its "change" yet
    // — blurring it BEFORE Save forces any pending onchange handler
    // (date reformatting, insert-port.js's async port-name autofill
    // trigger, Tradetech's own diff recalculation) to actually commit.
    // Also covers every OTHER date field, not just whichever one
    // happens to be focused — the +/- step buttons never focus the
    // field they write to at all (setFieldValue only fires input/
    // change), so ANY date touched that way can be sitting on a stale
    // diff (see checkDiffMismatch()). This is a correctness fix, not a
    // confirmation-UI nicety — it must run every time Save is clicked,
    // whether or not the confirmation overlay itself is turned on.
    commitAllFields(formDoc) {
        const active = formDoc.activeElement;
        if (active && typeof active.blur === "function" && active !== formDoc.body) {
            active.blur();
        }

        commitAllDateFields(formDoc);
    },

    init() {
        document.addEventListener("click", (event) => {
            const button = event.target.closest?.(this.SAVE_BUTTON_SELECTOR);
            if (!button) return;

            // One-shot bypass for the click WE fire back at this exact
            // button (see the "Confirm & Save" callback below) — without
            // this, that programmatic click would loop straight back
            // into this same listener and re-show the overlay forever.
            if (button.dataset.ttSaveConfirmBypass) {
                delete button.dataset.ttSaveConfirmBypass;
                return;
            }

            const formDoc = this.findFormDocument();

            // Runs regardless of the Custom Rule below — committing
            // pending field state isn't part of the "show a review
            // screen" preference, it's a correctness fix that must
            // always apply.
            if (formDoc) this.commitAllFields(formDoc);

            if (!CustomRules.isEnabled("confirmRotationBeforeSave")) return; // let Save proceed — fields already committed above
            if (!formDoc) return; // no rotation data found anywhere — never block Save on a page we can't read

            // Capture phase on an ANCESTOR (document, not the button
            // itself) — this is what actually wins the race against
            // the inline onclick attribute (see file header comment).
            event.preventDefault();
            event.stopImmediatePropagation();

            // Once prevented, the real click is gone for good — if
            // anything below throws (e.g. window.top access denied),
            // the click must not be silently swallowed with no overlay
            // AND no save. Falls back to calling the original handler
            // directly so Save still happens even if the confirmation
            // UI itself couldn't be shown.
            try {
                const rows = this.buildRotationRows(formDoc);
                console.log(`💾 Built ${rows.length} rotation row(s) — showing overlay`);
                this.showOverlay(rows, () => {
                    console.log("💾 Confirmed — re-clicking Save for real");
                    // A real button.click() — NOT calling button.onclick()
                    // directly — so every listener Tradetech has wired to
                    // this button fires exactly as it would for a genuine
                    // user click, not just the inline onclick="..." one.
                    button.dataset.ttSaveConfirmBypass = "1";
                    button.click();
                });
            } catch (err) {
                console.error("❌ Save Confirmation failed — saving without it:", err);
                button.dataset.ttSaveConfirmBypass = "1";
                button.click();
            }
        }, true);
    },

    handle(_event) {}
};
