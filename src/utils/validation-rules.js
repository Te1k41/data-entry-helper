// ============================================================
//  src/utils/validation-rules.js
//  A small registry of togglable validation-rule exceptions —
//  named business rules that features can check before flagging
//  something, so a real exception doesn't require editing code
//  every time. Persisted per-rule in localStorage. Pure data/
//  logic here; the settings panel (Toolbar button + toggle UI)
//  is features/validation-rules-settings.js.
//
//  Add a new rule by adding one entry to RULES below — nothing
//  else needs to change for it to show up in the settings panel.
// ============================================================
const ValidationRules = {
    RULES: [
        {
            id:          "skipDuplicateCheckOnNegativeIncrement",
            label:       "Skip duplicate-vessel warnings when Voyage Increment < 0",
            description: "When the page's \"voyage_increment_by\" is negative, Duplicate Vessel intentionally reuses the same voyage number on purpose — don't flag those rows as a duplicate/one-off problem.",
            default:     true
        }
    ],

    STORAGE_PREFIX: "tt-rule-",

    isEnabled(id) {
        const stored = localStorage.getItem(this.STORAGE_PREFIX + id);
        if (stored !== null) return stored === "1";

        const rule = this.RULES.find(r => r.id === id);
        return rule ? rule.default : false;
    },

    setEnabled(id, enabled) {
        localStorage.setItem(this.STORAGE_PREFIX + id, enabled ? "1" : "0");
    }
};
