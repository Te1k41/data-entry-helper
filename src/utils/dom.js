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
