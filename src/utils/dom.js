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
const PORT_NAME_FIELD_PATTERN = /^SP\d+_port_name$/;

function selectFieldSmart(field) {
    if (PORT_NAME_FIELD_PATTERN.test(field.name)) {
        const value = field.value;
        const commaIdx = value.indexOf(",");
        const parenIdx = value.indexOf("(");
        const cutCandidates = [commaIdx, parenIdx].filter(i => i !== -1);
        const cut = cutCandidates.length ? Math.min(...cutCandidates) : value.length;
        field.setSelectionRange(0, cut);
        return;
    }
    field.select();
}

// Inserts `btn` after any inline action buttons already sitting right
// after `field` (rather than always right after `field` itself), so a
// row's button group ends up in a stable, predictable order (e.g.
// [name][⧉][🗑][➕]...) no matter which feature's init() happens to
// run first. Shared by every feature that adds its own inline button
// next to a field — duplicate-vessel.js (⧉/🗑) and insert-port.js (➕).
function insertActionButtonAfter(field, btn) {
    let anchor = field;
    while (anchor.nextElementSibling && anchor.nextElementSibling.tagName === "BUTTON") {
        anchor = anchor.nextElementSibling;
    }
    anchor.insertAdjacentElement("afterend", btn);
}
