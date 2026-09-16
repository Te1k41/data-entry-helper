// ============================================================
//  src/utils/custom-rules.js
//  A small registry of togglable custom-rule exceptions — named
//  business rules that features can check before flagging
//  something, so a real exception doesn't require editing code
//  every time. Persisted per-rule in localStorage. Pure data/
//  logic here; the settings panel (Toolbar button + toggle UI)
//  is features/custom-rules-settings.js.
//
//  Add a new rule by adding one entry to RULES below — nothing
//  else needs to change for it to show up in the settings panel.
// ============================================================
const CustomRules = {
    // Keep `label` short — one glance, no wrapping. Put the actual
    // explanation in `description`, which can be as long as it needs
    // to be; the settings panel keeps it collapsed until asked for.
    RULES: [
        {
            id:          "skipDuplicateCheckOnNegativeIncrement",
            label:       "Allow same-voyage duplicates",
            description: "When the page's \"voyage_increment_by\" is negative, Duplicate Vessel intentionally reuses the same voyage number on purpose — don't flag those rows as a duplicate/one-off problem.",
            default:     true
        },
        {
            id:          "alwaysShowWarnings",
            label:       "Always show Warnings",
            description: "Keep yellow validation-warning banners (Live Check, AWR, missing dates, etc.) visible even while \"Hide updates\" is on.",
            default:     false
        },
        {
            id:          "alwaysShowSuccess",
            label:       "Always show Success",
            description: "Keep the green one-off confirmation banner (e.g. \"Vessel Duplicated\", \"Snapshot Saved\") visible even while \"Hide updates\" is on.",
            default:     false
        },
        {
            id:          "alwaysShowInfo",
            label:       "Always show Info",
            description: "Keep the blue \"Basing on\" status banner visible even while \"Hide updates\" is on.",
            default:     false
        },
        {
            id:          "alwaysShowSuggestions",
            label:       "Always show Suggestions",
            description: "Keep the purple vessel-suggestion banner visible even while \"Hide updates\" is on.",
            default:     false
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
