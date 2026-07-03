const DateUtils = {
    // Strips non-digits so "06/25/26" and "062526" both become "062526"
    // if dateStr is empty or invalid, return nothing
    // otherwise strip everything that isn't a digit
    // "06/25/26" to "062526"
    normalize(dateStr) {
        if (!dateStr) return "";
        return dateStr.replace(/\D/g, "");
        // finds every non-digit (the slashes)
        // replaces them with "" (nothing)
        // result: "062526"

        /// "/\D/g" this is a regular expression (regex). It's a pattern for describing text. The slashes / / are like quote marks for regex. Inside:

        ///  "\D" means "any character that is NOT a digit"
        /// "g" means "find ALL of them, not just the first one"
        
    },

    // Returns today as "MM/DD/YY"
    todayMMDDYY() {
        const now = new Date();
        const mm  = String(now.getMonth() + 1).padStart(2, "0");
        const dd  = String(now.getDate()).padStart(2, "0");
        const yy  = String(now.getFullYear()).slice(-2);
        return `${mm}/${dd}/${yy}`;
    },

    // Parses "MM/DD/YY" or "MMDDYY" → JS Date (UTC midnight), or null
    parse(str) {
        if (!str) return null;
        const clean = str.trim();

        const slashMatch = clean.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
        if (slashMatch) {
            const [, mm, dd, yy] = slashMatch;
            return new Date(`20${yy}-${mm}-${dd}T00:00:00Z`);
        }

        const bareMatch = clean.match(/^(\d{2})(\d{2})(\d{2})$/);
        if (bareMatch) {
            const [, mm, dd, yy] = bareMatch;
            return new Date(`20${yy}-${mm}-${dd}T00:00:00Z`);
        }

        return null;
    },

    // Formats a JS Date → "MM/DD/YY"
    format(date) {
        const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(date.getUTCDate()).padStart(2, "0");
        const yy = String(date.getUTCFullYear()).slice(-2);
        return `${mm}/${dd}/${yy}`;
    },

    // Returns a new Date offset by n days
    addDays(date, n) {
        const result = new Date(date);
        result.setUTCDate(result.getUTCDate() + n);
        return result;
    }
};