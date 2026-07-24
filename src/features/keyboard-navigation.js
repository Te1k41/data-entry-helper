// ─────────────────────────────────────────────────────
//  FEATURE: Keyboard Field Navigation
//  Lets arrow keys move between SP*/SV* fields like a
//  spreadsheet:
//    ↑ / ↓  → same field, previous/next row  (e.g. SP001_port_name → SP002_port_name)
//    ← / →  → previous/next field in the same row (left→right, by actual on-page position)
//
//  Arrow keys still work normally for moving the text
//  cursor INSIDE a field's value — this feature only takes
//  over once the cursor is already at the start (for ←) or
//  end (for →) of the field, or immediately for ↑/↓ since
//  those don't do anything useful in a single-line input.
//
//  Tab is also restricted, forming a forced cycle between just
//  arrival_date and depart_date — this does NOT rely on the
//  browser's own tab order, since Tradetech's actual tab order
//  doesn't reliably land where you'd expect:
//    Tab        on arrival_date (row N)   → depart_date   (row N)
//    Tab        on depart_date  (row N)   → arrival_date  (row N+1)
//    Shift+Tab  on depart_date  (row N)   → arrival_date  (row N)
//    Shift+Tab  on arrival_date (row N)   → depart_date   (row N-1)
//  Every other field is left completely alone — normal browser tab
//  order applies everywhere except this cycle.
//
//  Every jump also selects the destination field's full text (like
//  landing on a cell in a spreadsheet) — so you can start typing
//  right away to overwrite it, without needing to clear it first.
//
//  Runs off its own keydown listener (registered in init())
//  rather than the shared "change" bus in main.js, since it
//  needs to intercept the key before the browser's default
//  caret movement / tab order happens.
// ─────────────────────────────────────────────────────
const KeyboardFieldNav = {

    init() {
        document.addEventListener("keydown", (event) => this.onKeyDown(event), true);
        console.log("⌨️ Keyboard field navigation enabled (arrow keys)");
    },

    onKeyDown(event) {
        const target = event.target;
        if (!target || !target.name) return;
        if (target.tagName !== "INPUT") return;
        if (target.name.startsWith("PV_")) return; // hidden Tradetech duplicates

        // Only SP### and SV### fields are part of the navigable grid.
        const match = target.name.match(/^(SP|SV)(\d+)_(.+)$/);
        if (!match) return;

        const [, prefix, rowStr, field] = match;
        const row = parseInt(rowStr, 10);
        const width = rowStr.length; // preserves zero-padding, e.g. "001" → width 3

        switch (event.key) {
            case "ArrowUp":
                this.moveVertical(prefix, row, width, field, -1, event);
                break;

            case "ArrowDown":
                this.moveVertical(prefix, row, width, field, 1, event);
                break;

            case "ArrowLeft":
                if (this.caretAtStart(target)) {
                    this.moveHorizontal(prefix, rowStr, field, -1, event);
                }
                break;

            case "ArrowRight":
                if (this.caretAtEnd(target)) {
                    this.moveHorizontal(prefix, rowStr, field, 1, event);
                }
                break;

            case "Tab":
                this.handleTab(prefix, row, width, rowStr, field, event);
                break;
        }
    },

    // Forces the full arrival_date ↔ depart_date cycle explicitly —
    // does NOT rely on the browser's own tab order at any point, since
    // Tradetech's actual tab order doesn't reliably land where you'd
    // expect (hidden/disabled fields can sit in between rows).
    //
    //   Tab        on arrival_date (row N)   → depart_date   (row N)
    //   Tab        on depart_date  (row N)   → arrival_date  (row N+1)
    //   Shift+Tab  on depart_date  (row N)   → arrival_date  (row N)
    //   Shift+Tab  on arrival_date (row N)   → depart_date   (row N-1)
    //
    // SV rows (Vessels tab) get a simpler rule instead: Tab on
    // start_voyage or depart_date just stays in that same column,
    // next/previous row — like ArrowDown/ArrowUp — rather than following
    // Tradetech's native tab order sideways into One-Off/Skipped Ports.
    //
    // Every other field is left alone — normal browser tab order.
    handleTab(prefix, row, width, rowStr, field, event) {
        if (prefix === "SV") {
            if (field === "start_voyage" || field === "depart_date") {
                this.moveVertical(prefix, row, width, field, event.shiftKey ? -1 : 1, event);
            }
            return;
        }

        if (prefix !== "SP") return; // arrival/depart pair only exists on SP rows

        if (event.shiftKey) {
            if (field === "depart_date") {
                this.jumpToField(prefix, rowStr, "arrival_date", event);
            } else if (field === "arrival_date") {
                this.jumpToRowField(prefix, row - 1, width, "depart_date", event);
            }
        } else {
            if (field === "arrival_date") {
                this.jumpToField(prefix, rowStr, "depart_date", event);
            } else if (field === "depart_date") {
                this.jumpToRowField(prefix, row + 1, width, "arrival_date", event);
            }
        }
    },

    // Focuses a field AND selects all its text — like landing on a
    // cell in a spreadsheet, so typing immediately overwrites whatever
    // was there instead of you needing to select/clear it first.
    // Every navigation jump in this feature goes through this one
    // helper so the select-all behavior stays consistent everywhere.
    focusField(field, event) {
        event.preventDefault();
        field.focus();
        field.select();
    },

    // Focuses a specific named field in the same row, if it exists.
    jumpToField(prefix, rowStr, targetField, event) {
        const next = document.querySelector(
            `input[name="${prefix}${rowStr}_${targetField}"]`
        );
        if (!next) return; // field doesn't exist on this row — fall back to normal tab

        this.focusField(next, event);
    },

    // Same as jumpToField, but for crossing into a DIFFERENT row
    // number (used for depart_date → next row's arrival_date, and the
    // Shift+Tab reverse). Preserves zero-padding via `width`.
    jumpToRowField(prefix, row, width, targetField, event) {
        if (row < 1) return; // no such row — leave default tab alone

        const rowStr = String(row).padStart(width, "0");
        this.jumpToField(prefix, rowStr, targetField, event);
    },

    // True if the caret is sitting at the very start of the field with
    // nothing selected — meaning there's nowhere left for ← to move
    // the text cursor, so it's safe to jump fields instead.
    caretAtStart(field) {
        return typeof field.selectionStart === "number" &&
               field.selectionStart === 0 &&
               field.selectionEnd === 0;
    },

    // Same idea as caretAtStart, but for → at the end of the value.
    caretAtEnd(field) {
        return typeof field.selectionStart === "number" &&
               field.selectionStart === field.value.length &&
               field.selectionEnd === field.value.length;
    },

    // ↑ / ↓ — same field name, adjacent row number. Zero-padding
    // (e.g. "001") is preserved using the original field's width.
    moveVertical(prefix, row, width, field, delta, event) {
        const targetRow = row + delta;
        if (targetRow < 1) return;

        const targetRowStr = String(targetRow).padStart(width, "0");
        const next = document.querySelector(
            `input[name="${prefix}${targetRowStr}_${field}"]`
        );
        if (!next) return; // no such row — do nothing, don't jump wild

        this.focusField(next, event);
    },

    // ← / → — same row, previous/next field by actual left-to-right
    // position on the page (not a hardcoded field order), so this
    // keeps working correctly even if Tradetech reorders columns.
    moveHorizontal(prefix, rowStr, field, delta, event) {
        const rowFields = this.getRowFieldsInVisualOrder(prefix, rowStr);
        const idx = rowFields.indexOf(field);
        if (idx === -1) return;

        const targetIdx = idx + delta;
        if (targetIdx < 0 || targetIdx >= rowFields.length) return; // edge of the row

        const next = document.querySelector(
            `input[name="${prefix}${rowStr}_${rowFields[targetIdx]}"]`
        );
        if (!next) return;

        this.focusField(next, event);
    },

    // Finds every field belonging to one row (e.g. all "SP001_*"
    // fields) and sorts them left→right based on where they actually
    // sit on the page right now. Dynamic on purpose — if Tradetech
    // ever reorders the visual layout of a row, this keeps up
    // automatically instead of silently navigating in the wrong order.
    getRowFieldsInVisualOrder(prefix, rowStr) {
        const rowFields = Array.from(document.querySelectorAll(
            `input[name^="${prefix}${rowStr}_"]:not([name^="PV_"])`
        ));

        rowFields.sort((a, b) => {
            const rectA = a.getBoundingClientRect();
            const rectB = b.getBoundingClientRect();
            return rectA.left - rectB.left;
        });

        return rowFields.map(f => f.name.replace(`${prefix}${rowStr}_`, ""));
    },

    // Required by the FEATURES contract in main.js, but this feature
    // does its real work off its own keydown listener above — nothing
    // needed here for the shared "change" bus.
    handle(_event) {}
};