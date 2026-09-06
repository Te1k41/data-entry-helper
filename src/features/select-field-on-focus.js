// ─────────────────────────────────────────────────────
//  FEATURE: Select Field On Focus
//  Clicking into ANY text input auto-selects its current value —
//  like landing on a cell in a spreadsheet — so typing immediately
//  overwrites it instead of needing to select-all or clear it first.
//  Port Name fields get a narrower selection instead (see
//  selectFieldSmart() in src/utils/dom.js for the exact rule and why
//  it's shared with keyboard-navigation.js).
// ─────────────────────────────────────────────────────
const SelectFieldOnFocus = {
    init() {},

    handleFocus(event) {
        const field = event.target;
        if (field.tagName !== "INPUT") return;
        if (!field.name || field.name.startsWith("PV_")) return; // hidden Tradetech duplicates

        selectFieldSmart(field);
    },

    handle(_event) {}
};
