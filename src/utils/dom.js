// ============================================================
//  src/utils/dom.js
//  setFieldValue(input, value) — the ONLY approved way any
//  feature should write into a form field.
//
//  Why this exists: setting `input.value = x` directly does NOT
//  fire any events, so Tradetech's own JS (validation, diff
//  calculations, etc.) and this extension's own listeners in
//  main.js would never find out the field changed. This function
//  sets the value AND manually dispatches "input" and "change"
//  events so everything downstream reacts normally.
// ============================================================

function setFieldValue(input, value) {
    input.value = value;

    // bubbles: true so the event travels up to <document>, where
    // both Tradetech's listeners and main.js's delegated listener
    // are attached and will pick it up.
    input.dispatchEvent(new Event("input",  { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
}

// Selects a field's value the "smart" way — the whole thing normally,
// but for a port-name field (SP###_port_name, e.g. "SYDNEY, AUSTRALIA
// (SYD)") only the portion before the first "," or "(" (whichever
// comes first). Shared by select-field-on-focus.js (plain mouse click)
// AND keyboard-navigation.js's focusField() (arrow/Tab jump) so a port
// name selects the same way regardless of how you got there — these
// used to each do their own thing, and since focusField() re-selects
// AFTER the click-driven selection already ran, it always won and
// silently widened a port-name field's selection back to everything.
//
// The actual selection is deferred one tick (setTimeout 0) rather than
// applied synchronously in the focus handler — confirmed real bug:
// the SAME port name field would sometimes narrow correctly and
// sometimes select everything, on identical clicks. Our capture-phase
// document focus listener (main.js) fires BEFORE the event reaches the
// field itself, so if Tradetech's own field has a native focus handler
// (a plain `this.select()`-style onfocus, common on older form UIs
// like this one) it runs AFTER ours and silently overwrites the narrow
// selection with a full one — a genuine race, not a formatting edge
// case. Deferring our own call to the next tick guarantees it runs
// after any such native handler has already finished, so ours always
// wins instead of winning or losing depending on browser-internal
// timing. Imperceptible to the user at 0ms.
const PORT_NAME_FIELD_PATTERN = /^SP\d+_port_name$/;

function selectFieldSmart(field) {
    if (!PORT_NAME_FIELD_PATTERN.test(field.name)) {
        field.select();
        return;
    }
    // Only port-name fields race against a native onfocus handler (see
    // comment above) — deferring every other field's select() too was
    // what caused a visible one-frame flicker on every field click.
    setTimeout(() => {
        const value = field.value;
        const commaIdx = value.indexOf(",");
        const parenIdx = value.indexOf("(");
        const cutCandidates = [commaIdx, parenIdx].filter(i => i !== -1);
        const cut = cutCandidates.length ? Math.min(...cutCandidates) : value.length;
        field.setSelectionRange(0, cut);
    }, 0);
}

// Tradetech keeps a hidden "PV_" duplicate of many fields (its own
// previous-value tracking) with no listeners of its own — a plain
// value assignment is all it ever needs, no event dispatch. Repeated
// this same two-line shape (find it, set it if it exists) across
// port-row.js, vessel-row.js, duplicate-vessel.js, and
// voyage-step-buttons.js often enough that it belongs here once.
function mirrorPvShadow(field, value) {
    const pv = document.querySelector(`input[name="PV_${field.name}"]`);
    if (pv) pv.value = value;
}

// Polls a field for a non-blank value before calling `callback`, since
// Tradetech fills some fields asynchronously (e.g. vessel_name after a
// Lloyds code lookup) by setting .value directly with no "change" event
// — a feature acting immediately on such a field can catch it still
// blank. Same 100ms/50-attempt (5s ceiling) shape as awr-flag.js's and
// port-highlighting.js's own waitForNameThenRescan() — if field is
// already non-blank, calls back immediately with no delay. Gives up
// silently (still calls back) after the ceiling, same as those two, so
// a genuinely-blank field (not just slow to fill) doesn't hang forever.
function waitForFieldValue(field, callback) {
    if (!field || field.value.trim()) {
        callback();
        return;
    }
    let attempts = 0;
    const maxAttempts = 50;
    const timer = setInterval(() => {
        attempts++;
        if (field.value.trim() || attempts >= maxAttempts) {
            clearInterval(timer);
            callback();
        }
    }, 100);
}

// Inserts `btn` after any inline action buttons already sitting right
// after `field` (rather than always right after `field` itself), so a
// row's button group ends up in a stable, predictable order (e.g.
// [name][⧉][🗑][➕]...) no matter which feature's init() happens to
// run first. Shared by every feature that adds its own inline button
// next to a field — duplicate-vessel.js (⧉/🗑) and insert-port.js (➕).
function insertActionButtonAfter(field, btn) {
    btn.tabIndex = -1; // click-only — keyboard Tab should skip straight to the next real field

    let anchor = field;
    while (anchor.nextElementSibling && anchor.nextElementSibling.tagName === "BUTTON") {
        anchor = anchor.nextElementSibling;
    }
    anchor.insertAdjacentElement("afterend", btn);
}
