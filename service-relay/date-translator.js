// Shared, dependency-free date translation for relay data. All successful
// parses return a Date at UTC midnight; unknown or invalid values return null.

const MONTHS = {
    JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
    JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

function utcDate(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day ? date : null;
}

function fourDigitYear(value) {
    return Number(value) + (String(value).length === 2 ? 2000 : 0);
}

const DATE_FORMATS = [
    {
        name: "MM/DD/YY",
        regex: /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/,
        toDate: match => utcDate(fourDigitYear(match[3]), Number(match[1]), Number(match[2])),
    },
    {
        name: "MM/DD/YYYY",
        regex: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
        toDate: match => utcDate(Number(match[3]), Number(match[1]), Number(match[2])),
    },
    {
        name: "DD-MON-YYYY",
        regex: /^(\d{1,2})-([A-Z]{3})-(\d{4})$/i,
        toDate: match => utcDate(Number(match[3]), MONTHS[match[2].toUpperCase()], Number(match[1])),
    },
    {
        name: "DD-MON-YY",
        regex: /^(\d{1,2})-([A-Z]{3})-(\d{2})$/i,
        toDate: match => utcDate(fourDigitYear(match[3]), MONTHS[match[2].toUpperCase()], Number(match[1])),
    },
    {
        name: "YYYY-MM-DD",
        regex: /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
        toDate: match => utcDate(Number(match[1]), Number(match[2]), Number(match[3])),
    },
];

// Values are DATE_FORMATS names. Intentionally empty until an operator has a
// demonstrated preferred format; an invalid/missing hint simply falls through.
const OPERATOR_FORMAT_HINTS = {};

function parseWithFormat(rawValue, format) {
    const match = String(rawValue).trim().match(format.regex);
    if (!match) return null;
    try {
        return format.toDate(match) || null;
    } catch (_) {
        return null;
    }
}

function parseDate(rawValue, options = {}) {
    if (rawValue === null || rawValue === undefined) return null;
    let value, operator;
    try {
        value = String(rawValue).trim();
        operator = options && typeof options === "object"
            ? String(options.operator || "").trim().toUpperCase()
            : "";
    } catch (_) {
        return null;
    }
    if (!value) return null;
    const hintedName = OPERATOR_FORMAT_HINTS[operator];
    const hintedFormat = DATE_FORMATS.find(format => format.name === hintedName);
    const formats = hintedFormat
        ? [hintedFormat, ...DATE_FORMATS.filter(format => format !== hintedFormat)]
        : DATE_FORMATS;

    for (const format of formats) {
        const parsed = parseWithFormat(value, format);
        if (parsed) return parsed;
    }
    return null;
}

module.exports = { parseDate, DATE_FORMATS, OPERATOR_FORMAT_HINTS };
