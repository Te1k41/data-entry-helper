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
            id:          "blockSaveOnSp001Mismatch",
            label:       "Block Save on SP001 mismatch",
            description: "Won't let a record save when SP001's departure date doesn't match any vessel's departure date. Turning this off still shows the mismatch warning banner and red highlight — it only stops blocking the Save button itself.",
            default:     true
        },
        {
            id:          "enableFixVesselDates",
            label:       "Enable Fix Vessel Dates",
            description: "Adds a \"🛠 Fix Vessel Dates\" Tools-panel button that pushes any vessel dated earlier than SP001 forward in weekly steps from the latest vessel date, and bumps its voyage code to match. Off by default — an older feature brought back opt-in rather than always-on.",
            default:     false
        },
        {
            id:          "tabStartVoyageToDepart",
            label:       "Tab: Voyage → Depart",
            description: "ON: Tab on a vessel's Start Voyage jumps straight to that same row's Depart Date (and back with Shift+Tab), same forced cycle SP rows already do for arrival/depart. OFF (the original behavior): Tab on either field just moves to the next/previous row in the same column instead.",
            default:     true
        },
        {
            id:          "skipDuplicateCheckOnNegativeIncrement",
            label:       "Allow same-voyage duplicates",
            description: "When the page's \"voyage_increment_by\" is negative, Duplicate Vessel intentionally reuses the same voyage number on purpose — don't flag those rows as a duplicate/one-off problem.",
            default:     true
        },
        {
            id:          "alwaysShowWarnings",
            label:       "Always show Warnings",
            description: "Keep yellow validation-warning banners (Live Check, AWR, missing dates, mismatches, etc.) visible even while \"Hide updates\" is on. Doesn't cover \"Proof not uploaded\" — that one has its own rule below.",
            default:     false
        },
        {
            id:          "alwaysShowUploadProof",
            label:       "Always show Upload Proof",
            description: "Keep the \"Proof not uploaded yet\" reminder visible even while \"Hide updates\" is on — independent of the general Warnings rule above, since this is a reminder to do something, not a data-validation problem.",
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
        },
        {
            id:          "enableCtrlDHighlight",
            label:       "Enable Ctrl+D Highlight",
            description: "Ctrl+D on a text selection wraps it in a yellow highlight (click it again to remove). This runs on every site, not just Tradetech — this toggle only controls it here, since that's where the settings panel lives. Default ON.",
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
