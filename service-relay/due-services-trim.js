// ============================================================
//  due-services-trim.js
//  Decides how many services actually get kept, based on due
//  date proximity — NOT the extension's job. The extension
//  just scans and reports everything it sees; this is the
//  single source of truth for "how many, and which ones."
//
//  Rules:
//  - Group services by nextUpdateDate.
//  - If the 2 NEAREST days COMBINED have >= SPLIT_THRESHOLD
//    services, take the AVERAGE of the two days' counts as the
//    total to show, filled by PRIORITY — the nearest day first,
//    then whatever's left comes from the second day. e.g.
//    day1=20, day2=40 → average=30 → day1 gives all 20 (it's
//    smaller than 30), day2 fills the remaining 10.
//  - Otherwise, keep whole days starting from the nearest one,
//    stopping BEFORE any day that would push the total over
//    MAX_SERVICES (a day's services are never split in this
//    branch — the cutoff always lands on a day boundary).
// ============================================================

const { parseTTDate } = require("./due-date-utils");

const MAX_SERVICES    = 40; // cap for the general (3+ spread-out days) case
const SPLIT_THRESHOLD = 50; // if nearest 2 days COMBINED >= this, apply the average/priority-fill split

function groupByDay(services) {
    const sorted = [...services].sort((a, b) => {
        const da = parseTTDate(a.nextUpdateDate);
        const db = parseTTDate(b.nextUpdateDate);
        if (!da && !db) return 0;
        if (!da) return 1;  // undated → end
        if (!db) return -1;
        return da - db;
    });

    const groups = []; // [{ date, items: [...] }] in ascending date order
    for (const s of sorted) {
        const lastGroup = groups[groups.length - 1];
        if (lastGroup && lastGroup.date === s.nextUpdateDate) {
            lastGroup.items.push(s);
        } else {
            groups.push({ date: s.nextUpdateDate, items: [s] });
        }
    }
    return groups;
}

// Fills `total` slots by PRIORITY: the nearest day (itemsA) gets taken
// first, up to its full availability or the total cap, whichever is
// smaller. Whatever's left of `total` is then filled from the second
// day (itemsB). This is NOT an even split — day1 always wins priority.
function splitByPriority(itemsA, itemsB, total) {
    const takeA = Math.min(itemsA.length, total);
    const takeB = Math.min(itemsB.length, total - takeA);
    return [...itemsA.slice(0, takeA), ...itemsB.slice(0, takeB)];
}

function trimToNearestDays(services) {
    const groups = groupByDay(services);

    if (groups.length >= 2 && groups[0].items.length + groups[1].items.length >= SPLIT_THRESHOLD) {
        const combinedTotal = groups[0].items.length + groups[1].items.length;
        const average = Math.round(combinedTotal / 2);
        console.log(
            `⚖️ Nearest 2 days combined (${groups[0].date}: ${groups[0].items.length}, ` +
            `${groups[1].date}: ${groups[1].items.length}) = ${combinedTotal}, meets ${SPLIT_THRESHOLD} threshold — ` +
            `showing the average (${average}), priority-filled from nearest day first`
        );
        return splitByPriority(groups[0].items, groups[1].items, average);
    }

    const result = [];
    for (const group of groups) {
        if (result.length > 0 && result.length + group.items.length > MAX_SERVICES) {
            break; // adding this whole day would overshoot — stop BEFORE it
        }
        result.push(...group.items);
    }

    return result;
}

module.exports = { trimToNearestDays, MAX_SERVICES, SPLIT_THRESHOLD };