// ============================================================
//  due-services-trim.js
//  Computes a NEW batch when called — this is not a live filter,
//  it's invoked once by current-batch-store.js whenever the
//  previous batch is fully cleared (or on manual "Next Batch").
//  Also exposes computeWeeklyPlan() for the dashboard's
//  workload-per-day breakdown view.
//
//  Rule ("1 week only, Mon-Fri"):
//  - Only services due within the CURRENT calendar week
//    (Monday → Sunday) are considered for the weekly plan.
//  - If today is MONDAY (nothing overdue yet this week): the
//    WHOLE week (Mon-Fri) is balanced evenly from scratch —
//    every day, including today, gets an equal target share
//    (as evenly as real availability allows — see
//    balanceEqually below for exactly what "balanced" means).
//  - Any OTHER day: today's bucket = its own natural count +
//    every earlier day THIS WEEK (overdue, fully absorbed, no
//    cap) — days still ahead just get balanced among
//    THEMSELVES (today is not part of that pool once the week
//    is already underway).
//  - Backlog from BEFORE this week (older than Monday) always
//    gets added on top of today's bucket, regardless of which
//    day today is — including the Monday case.
//
//  IMPORTANT: balancing NEVER changes the total SET of services
//  included — every service due this week always ends up in
//  the batch one way or another (nothing fabricated, nothing
//  silently dropped). What it changes is which day-LABEL each
//  service is grouped under for the workload breakdown display
//  — e.g. a Friday-due item might get counted toward Thursday's
//  displayed workload if Thursday's real count fell short of
//  its share and Friday had extra to spare. The item's actual
//  nextUpdateDate is never touched.
// ============================================================

const { parseTTDate, formatTTDate } = require("./due-date-utils");

function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
}

// Monday of the week containing `date` (getDay(): 0=Sun...6=Sat).
function getMonday(date) {
    const day = date.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    return addDays(date, diff);
}

function groupByDay(services) {
    const sorted = [...services].sort((a, b) => {
        const da = parseTTDate(a.nextUpdateDate);
        const db = parseTTDate(b.nextUpdateDate);
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return da - db;
    });

    const groups = [];
    for (const s of sorted) {
        const last = groups[groups.length - 1];
        if (last && last.date === s.nextUpdateDate) {
            last.items.push(s);
        } else {
            groups.push({ date: s.nextUpdateDate, items: [s] });
        }
    }
    return groups;
}

// Balances a set of day-groups toward an equal per-day LABEL count.
// Returns [{ date, count, items }] — `items` are real services (each
// keeps its own real nextUpdateDate always), `count` is how many are
// grouped under this day's label for display purposes. The union of
// all `items` across the result always equals the full input set —
// nothing is ever excluded or fabricated, only re-labeled.
function balanceEqually(dayGroups) {
    const n = dayGroups.length;
    if (n === 0) return [];

    const total = dayGroups.reduce((sum, g) => sum + g.items.length, 0);
    const base = Math.floor(total / n);
    const remainder = total - base * n; // earliest day(s) get +1

    const targets = dayGroups.map((g, i) => base + (i < remainder ? 1 : 0));

    // Each day first keeps up to its own target from its OWN real items.
    const kept = dayGroups.map((g, i) => g.items.slice(0, Math.min(g.items.length, targets[i])));

    // Anything left over beyond what a day kept goes into a shared pool.
    const surplusPool = dayGroups.flatMap((g, i) => g.items.slice(kept[i].length));

    // Days that fell short of target get topped up from that pool, in
    // order (earliest short day first) — since sum(targets) === total,
    // the pool always has exactly enough to cover every shortfall.
    let poolIndex = 0;
    return dayGroups.map((g, i) => {
        const need = targets[i] - kept[i].length;
        const borrowed = need > 0 ? surplusPool.slice(poolIndex, poolIndex + need) : [];
        poolIndex += borrowed.length;
        return { date: g.date, count: kept[i].length + borrowed.length, items: [...kept[i], ...borrowed] };
    });
}

// The full weekly plan: which services are in this week's batch, plus
// a day-by-day breakdown (for the dashboard's workload view).
function computeWeeklyPlan(services) {
    const today  = startOfDay(new Date());
    const monday = getMonday(today);
    const sunday = addDays(monday, 6);
    const isMondayToday = today.getDay() === 1;

    const thisWeek = services.filter(s => {
        const d = parseTTDate(s.nextUpdateDate);
        return d && d >= monday && d <= sunday;
    });
    const oldBacklog = services.filter(s => {
        const d = parseTTDate(s.nextUpdateDate);
        return d && d < monday;
    });

    const groups = groupByDay(thisWeek);

    let mandatoryItems = [];
    let poolGroups;

    if (isMondayToday) {
        poolGroups = groups; // whole week balanced together, nothing pre-mandatory yet
    } else {
        const mandatoryGroups = groups.filter(g => parseTTDate(g.date) <= today);
        poolGroups            = groups.filter(g => parseTTDate(g.date) >  today);
        mandatoryItems = mandatoryGroups.flatMap(g => g.items);
    }

    // Backlog from before this week always lands on today, on top of
    // whatever else today already has — regardless of which day it is.
    mandatoryItems = [...mandatoryItems, ...oldBacklog];

    const balanced = balanceEqually(poolGroups);

    // Day-by-day breakdown, Mon..Fri, for the dashboard's workload chart
    // AND for the sequential day-batch system (current-batch-store.js) —
    // each entry now carries the actual ITEMS assigned to that day-slot,
    // not just a count.
    const weekdayDates = [0, 1, 2, 3, 4].map(i => addDays(monday, i));
    const breakdown = weekdayDates.map(d => {
        const dateStr  = formatTTDate(d);
        const isToday  = d.getTime() === today.getTime();

        if (isMondayToday) {
            const match = balanced.find(b => b.date === dateStr);
            let items = match ? match.items : [];
            if (isToday) items = [...items, ...oldBacklog];
            return { date: dateStr, count: items.length, items, mandatory: isToday };
        }

        if (isToday) {
            // Today's slot carries the FULL rolled-up mandatory set
            // (its own + every earlier day this week + backlog) — not
            // just its own day's items.
            return { date: dateStr, count: mandatoryItems.length, items: mandatoryItems, mandatory: true };
        }

        if (d < today) {
            // Already rolled into today's slot above — empty here so
            // nothing is double-counted or double-batched, even though
            // these services are still genuinely included in allItems.
            return { date: dateStr, count: 0, items: [], mandatory: true, rolledIntoToday: true };
        }

        const match = balanced.find(b => b.date === dateStr);
        return { date: dateStr, count: match ? match.count : 0, items: match ? match.items : [], mandatory: false };
    });

    const allItems = [...mandatoryItems, ...balanced.flatMap(b => b.items)];

    console.log(
        `📦 Weekly plan: ${mandatoryItems.length} mandatory (today+overdue+backlog) + ` +
        `${balanced.reduce((s, b) => s + b.count, 0)} balanced across ${poolGroups.length} day(s) ` +
        `= ${allItems.length} total this week`
    );

    return { allItems, breakdown, mandatoryCount: mandatoryItems.length, backlogCount: oldBacklog.length };
}

function computeBatch(services) {
    return computeWeeklyPlan(services).allItems;
}

module.exports = { computeBatch, computeWeeklyPlan };