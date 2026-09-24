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
                const key     = formDoc.querySelector(`input[name="SP${row}_port_key"]`)?.value.trim()     || "";
                const diffMismatch = this.checkDiffMismatch(formDoc, row, arrival, depart);

                return { row, name, arrival, depart, key, diffMismatch };
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

    // Sanitized `service` field value, e.g. "MEDEX-E" — falls back to
    // "service" if the field is missing/blank so the filename is
    // never left with an empty segment.
    getServiceCode(formDoc) {
        const field = formDoc.querySelector('input[type="text"][name="service"]');
        const value = field ? field.value.trim() : "";
        return value ? value.replace(/[^A-Za-z0-9-]/g, "_") : "service";
    },

    // Page-level fields (not per-SP-row) plus the currently-highlighted
    // port, rendered as extra lines on the batch-captured receipt (see
    // captureForBatchAudit()/rotation-receipt-capture-relay.js). Read
    // once, not per row — these describe the whole record, not one port.
    // Always returns exactly 4 lines, one per field, even when blank
    // ("—") — confirmed real confusion otherwise: a blank field used to
    // just omit its line entirely, indistinguishable from the capture
    // never having run at all.
    getExtraCaptureFields(formDoc) {
        const read = name => formDoc.querySelector(`input[name="${name}"]`)?.value.trim() || "";

        // Each of these 3 is a CODE field (e.g. "last_foreign_port" =
        // "SIN") paired with its own separate _desc field (the city
        // name Tradetech's own validport_v2/validcity_v2 fills in) —
        // both captured together on one line, code first.
        const portField = (codeName, descName, label) => {
            const combined = [read(codeName), read(descName)].filter(Boolean).join(" — ");
            return `${label}: ${combined || "—"}`;
        };

        return [
            portField("last_foreign_port", "last_foreign_port_desc", "Last Foreign Port"),
            portField("first_us_port",     "first_us_port_desc",     "First US Port"),
            portField("first_eu_port",     "first_eu_port_desc",     "First EU Port"),
        ];
    },

    // SP row number PortHighlighting currently has flagged (e.g. "003"),
    // or null. Shown as a full yellow row in the table itself (see
    // renderRotationCanvas()) rather than as a separate text line — bare
    // `PortHighlighting` reference, so this only reflects THIS frame's
    // own scan; harmless no-op (returns null) on a frame that isn't the
    // one with the port rows.
    getHighlightedRow() {
        const field = typeof PortHighlighting !== "undefined" ? PortHighlighting.currentHighlightField : null;
        return field?.name.match(/^SP(\d+)_port_name$/)?.[1] || null;
    },

    // Filename matches the {service}-{MMDDYY} convention Tradetech's own
    // downloads already use (e.g. "MEDEX-E-091826.png"), with a
    // "-receipt" suffix, inside a rotation-receipts/ subfolder (Chrome
    // creates it under the default Downloads dir) — keeps it out of the
    // relay server's download-watcher.js, which watches Downloads
    // directly and auto-renames whatever PNGs land there for the
    // rename-toggle feature; that was clobbering receipt filenames too.
    receiptFilename(serviceCode) {
        const dateStamp = DateUtils.todayMMDDYY().replace(/\//g, "");
        return `rotation-receipts/${serviceCode || "service"}-${dateStamp}-receipt.png`;
    },

    // Renders the rotation table onto a canvas — shared by
    // downloadRotationPng() (a real click-triggered download, for
    // interactive use) and captureForBatchAudit() (returns a data URL
    // instead, see that method's own comment for why a click-triggered
    // download isn't used there).
    //
    // `extraLines` (optional) are plain text lines rendered below the
    // title, above the table — used by the batch Rotation Receipt
    // Capture feature to stamp on last foreign port / first US-EU port.
    // `highlightedRow` (optional) is an SP row number string (e.g.
    // "003") — that row gets a full-width yellow background in the
    // table, mirroring the live page's own orange region-change
    // highlight. Both default to [] / null so the 2 existing interactive
    // callers keep working unchanged if they don't pass them.
    renderRotationCanvas(rows, extraLines = [], highlightedRow = null) {
        const ROW_HEIGHT      = 26;
        const PADDING         = 14;
        const COL_GAP         = 24; // breathing room after the longest port name
        const DATE_COL_WIDTH  = 100;
        const KEY_COL_WIDTH   = 70; // port_key is at most 4 chars (e.g. "EEWS")
        const PORT_FONT       = "13px monospace";
        const TITLE_FONT      = "bold 16px monospace";
        const EXTRA_FONT      = "13px monospace";
        const HEADER_FONT     = "bold 13px monospace";
        const TITLE_AREA_HEIGHT = 30;
        const TEXT_BASELINE_OFFSET = Math.round(ROW_HEIGHT * 0.68);
        const ZEBRA_COLOR     = "#f2f2f2";
        const HEADER_BG       = "#e4e4e4";
        const HIGHLIGHT_COLOR = "#fff176"; // clear yellow, dark text stays legible on it
        const BORDER_COLOR    = "#999999";
        const titleText       = `Port Rotation Receipt — ${DateUtils.todayMMDDYY()}`;

        // Measure first — a canvas with no width/height set yet still
        // measures text correctly (measureText only needs the font),
        // so the Port column can be sized to whatever's actually in
        // it instead of a fixed guess that clips a long port name into
        // the date columns (confirmed live: "JAWAHARLAL NEHRU (NHAVA
        // SHEVA), IN..." overlapping Arrival).
        const measureCanvas = document.createElement("canvas");
        const measureCtx    = measureCanvas.getContext("2d");

        measureCtx.font = PORT_FONT;
        const portTexts = rows.map(r => `SP${r.row} ${r.name}`);
        const portColWidth = Math.max(
            measureCtx.measureText("Port").width,
            ...portTexts.map(t => measureCtx.measureText(t).width),
            150
        ) + COL_GAP;

        measureCtx.font = TITLE_FONT;
        const titleWidth = measureCtx.measureText(titleText).width;

        measureCtx.font = EXTRA_FONT;
        const extraLinesWidth = Math.max(0, ...extraLines.map(t => measureCtx.measureText(t).width));

        const colWidths   = [portColWidth, DATE_COL_WIDTH, DATE_COL_WIDTH, KEY_COL_WIDTH];
        const tableWidth  = colWidths.reduce((a, b) => a + b, 0);
        const width       = Math.max(tableWidth, titleWidth, extraLinesWidth) + PADDING * 2;
        const tableLeft   = PADDING;
        const tableRight  = tableLeft + tableWidth;

        const headerTop  = PADDING + TITLE_AREA_HEIGHT + extraLines.length * ROW_HEIGHT;
        const rowsTop    = headerTop + ROW_HEIGHT;
        const rowCount   = Math.max(rows.length, 1);
        const tableBottom = rowsTop + rowCount * ROW_HEIGHT;
        const height = tableBottom + PADDING;

        const canvas = document.createElement("canvas");
        canvas.width  = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = "#000000";
        ctx.font = TITLE_FONT;
        ctx.fillText(titleText, PADDING, PADDING + 18);

        ctx.font = EXTRA_FONT;
        extraLines.forEach((text, i) => {
            ctx.fillText(text, PADDING, PADDING + TITLE_AREA_HEIGHT + ROW_HEIGHT * i + TEXT_BASELINE_OFFSET);
        });

        // Header band — a filled bar instead of a plain baseline label,
        // clearer separation between "what this is" and the data.
        ctx.fillStyle = HEADER_BG;
        ctx.fillRect(tableLeft, headerTop, tableWidth, ROW_HEIGHT);
        ctx.fillStyle = "#000000";
        ctx.font = HEADER_FONT;
        let hx = tableLeft;
        ["Port", "Arrival", "Depart", "Key"].forEach((label, i) => {
            ctx.fillText(label, hx + 6, headerTop + TEXT_BASELINE_OFFSET);
            hx += colWidths[i];
        });

        ctx.font = PORT_FONT;
        if (rows.length === 0) {
            ctx.fillStyle = "#666666";
            ctx.fillText("(no ports entered yet)", tableLeft + 6, rowsTop + TEXT_BASELINE_OFFSET);
        } else {
            rows.forEach((r, i) => {
                const rowTop = rowsTop + ROW_HEIGHT * i;

                if (r.row === highlightedRow) {
                    ctx.fillStyle = HIGHLIGHT_COLOR;
                    ctx.fillRect(tableLeft, rowTop, tableWidth, ROW_HEIGHT);
                } else if (i % 2 === 1) {
                    ctx.fillStyle = ZEBRA_COLOR;
                    ctx.fillRect(tableLeft, rowTop, tableWidth, ROW_HEIGHT);
                }

                ctx.fillStyle = "#000000";
                let cx = tableLeft;
                // Key is blank on most rows — left empty rather than "—" so the
                // few rows that DO carry a direction marker stand out.
                [`SP${r.row} ${r.name}`, r.arrival || "—", r.depart || "—", r.key || ""].forEach((text, ci) => {
                    ctx.fillText(text, cx + 6, rowTop + TEXT_BASELINE_OFFSET);
                    cx += colWidths[ci];
                });
            });
        }

        // One clean border around the whole table (header band + rows)
        // instead of a single hairline under the header — clearer edge,
        // less "text floating on a blank page."
        ctx.strokeStyle = BORDER_COLOR;
        ctx.lineWidth = 1;
        ctx.strokeRect(tableLeft + 0.5, headerTop + 0.5, tableWidth - 1, tableBottom - headerTop - 1);
        ctx.beginPath();
        ctx.moveTo(tableLeft, headerTop + ROW_HEIGHT + 0.5);
        ctx.lineTo(tableRight, headerTop + ROW_HEIGHT + 0.5);
        ctx.stroke();

        return canvas;
    },

    // Real click-triggered download — for interactive use only (the
    // Custom Rule auto-download on Save, the Confirm-overlay's Download
    // button, the batch capture's own fallback if it can't reach
    // chrome.downloads). A detached <a>, never inserted into any
    // document, so this works regardless of which frame it runs in and
    // sidesteps the same frameset-body quirk showOverlay() has to work
    // around.
    downloadRotationPng(rows, serviceCode, extraLines = [], highlightedRow = null) {
        const canvas = this.renderRotationCanvas(rows, extraLines, highlightedRow);
        canvas.toBlob(blob => {
            const url  = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = this.receiptFilename(serviceCode);
            link.click();
            URL.revokeObjectURL(url);
        }, "image/png");
    },

    // Independent of the confirmation overlay entirely — the
    // "Download Rotation Receipt" Custom Rule downloads a receipt
    // every time Save actually goes through, whether or not "Confirm
    // rotation before Save" is even on. When it IS on, the caller only
    // invokes this from the "Confirm & Save" callback (not on Back),
    // so a cancelled save never produces a receipt for something that
    // didn't happen.
    maybeDownloadReceipt(formDoc) {
        if (!CustomRules.isEnabled("downloadRotationReceipt")) return;
        try {
            this.downloadRotationPng(this.buildRotationRows(formDoc), this.getServiceCode(formDoc), [], this.getHighlightedRow());
        } catch (err) {
            console.error("❌ Rotation receipt download failed:", err);
        }
    },

    // Entry point for the batch Rotation Receipt Capture feature
    // (background-relay.js injects a call to this via
    // chrome.scripting.executeScript({allFrames:true}), same pattern
    // AWR Audit already uses to reach whichever frame actually has the
    // page's content). Deliberately checks `document` directly rather
    // than findFormDocument()'s cross-frame fallback — with allFrames
    // true, exactly one frame has the port rows directly; skipping the
    // sibling-frame search here means only that one frame proceeds,
    // so this never fires twice (once per frame) for the same record.
    // Purely reads the DOM — never writes a field, never clicks
    // anything, never saves.
    //
    // Skips (no capture at all) unless PortHighlighting found a genuine
    // special port — routes that fell all the way through to the hard
    // SP001 default have nothing worth a receipt for. Confirmed request:
    // a 300+-record run over EVERY due-service record is mostly noise;
    // this cuts it down to only the ones with something to actually flag.
    //
    // Returns a data URL instead of doing its own click-triggered
    // download (unlike downloadRotationPng): confirmed real bug —
    // Chrome's automatic-download-blocking guard targets exactly this
    // shape of traffic (many `<a>`.click() downloads fired back-to-back
    // from background tabs with no accompanying real user gesture per
    // tab), silently dropping downloads past some point in a run
    // without ever surfacing an error. background-relay.js hands the
    // returned data URL to chrome.downloads.download() instead — a
    // privileged extension API call, not a page-triggered click, so
    // that guard doesn't apply to it.
    captureForBatchAudit() {
        // null, not {ok:false,...} — this must stay indistinguishable
        // from "SaveConfirmation undefined in this frame" (see the
        // func passed to executeScript in background-relay.js), so the
        // frame that actually has the ports is always the only one
        // that returns a real object. Returning an object here too
        // was a real bug: every OTHER frame (the frameset shell
        // included) would "win" the dedup with this exact reason
        // before ever reaching the real frame's actual result —
        // confirmed live, a record that WAS being correctly filtered
        // out by hasSpecialPort below reported this misleading reason
        // instead of "no special port found".
        if (!document.querySelector('input[name^="SP"][name$="_port_name"]')) {
            return null;
        }
        if (typeof PortHighlighting === "undefined" || !PortHighlighting.hasSpecialPort) {
            return { ok: false, reason: "no special port found — skipped" };
        }
        try {
            const rows = this.buildRotationRows(document);
            const extraLines = this.getExtraCaptureFields(document);
            const highlightedRow = this.getHighlightedRow();
            const canvas = this.renderRotationCanvas(rows, extraLines, highlightedRow);
            return {
                ok: true,
                dataUrl: canvas.toDataURL("image/png"),
                filename: this.receiptFilename(this.getServiceCode(document))
            };
        } catch (err) {
            console.error("❌ Batch receipt capture failed:", err);
            return { ok: false, reason: err.message };
        }
    },

    // Injected into window.top so the overlay covers the whole page
    // regardless of which small frame the Save button itself sits in.
    showOverlay(rows, serviceCode, highlightedRow, onConfirm) {
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
            justify-content: space-between !important;
            border-top: 2px solid #000000 !important;
        `;

        const downloadBtn = topDoc.createElement("button");
        downloadBtn.type = "button";
        downloadBtn.textContent = "⬇ Download";
        downloadBtn.title = "Save this rotation table as a PNG image";
        downloadBtn.style.cssText = `
            padding: 6px 12px !important;
            font-family: monospace !important;
            font-weight: bold !important;
            font-size: 11px !important;
            background: #f0f0f0 !important;
            border: 1px solid #000000 !important;
            cursor: pointer !important;
        `;
        downloadBtn.addEventListener("click", () => this.downloadRotationPng(rows, serviceCode, [], highlightedRow));

        const actionGroup = topDoc.createElement("div");
        actionGroup.style.cssText = "display: flex !important; gap: 8px !important;";

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

        actionGroup.appendChild(backBtn);
        actionGroup.appendChild(confirmBtn);
        footer.appendChild(downloadBtn);
        footer.appendChild(actionGroup);

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

            if (!CustomRules.isEnabled("confirmRotationBeforeSave")) {
                // Overlay is off — but the receipt download is its own
                // independent toggle and still fires here, right as
                // Save proceeds uninterrupted.
                if (formDoc) this.maybeDownloadReceipt(formDoc);
                return;
            }
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
                const serviceCode = this.getServiceCode(formDoc);
                const highlightedRow = this.getHighlightedRow();
                console.log(`💾 Built ${rows.length} rotation row(s) — showing overlay`);
                this.showOverlay(rows, serviceCode, highlightedRow, () => {
                    console.log("💾 Confirmed — re-clicking Save for real");
                    this.maybeDownloadReceipt(formDoc); // only on an actual confirm, not Back
                    // A real button.click() — NOT calling button.onclick()
                    // directly — so every listener Tradetech has wired to
                    // this button fires exactly as it would for a genuine
                    // user click, not just the inline onclick="..." one.
                    button.dataset.ttSaveConfirmBypass = "1";
                    button.click();
                });
            } catch (err) {
                console.error("❌ Save Confirmation failed — saving without it:", err);
                this.maybeDownloadReceipt(formDoc); // save is proceeding here too
                button.dataset.ttSaveConfirmBypass = "1";
                button.click();
            }
        }, true);
    },

    handle(_event) {}
};
