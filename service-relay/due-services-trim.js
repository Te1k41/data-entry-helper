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

    // Pool every item across all days — since dayGroups is already one
    // entry per date in chronological order, this pool is naturally
    // sorted nearest-due-first. Fill each day's target IN ORDER from
    // the front of that pool, so an earlier day-label always draws the
    // nearest-due items before a later day-label gets a look — a slow
    // day (e.g. nothing due Monday) pulls tomorrow's work forward
    // instead of reaching past it into Thursday/Friday just because
    // those days happen to have more than their own equal share.
    const pooled = dayGroups.flatMap(g => g.items);

    let idx = 0;
    return dayGroups.map((g, i) => {
        const items = pooled.slice(idx, idx + targets[i]);
        idx += items.length;
        return { date: g.date, count: items.length, items };
    });
}

// The full weekly plan: which services are in this week's batch, plus
// a day-by-day breakdown (for the dashboard's workload view).
//
// weekOffset lets the dashboard preview a week other than the current
// one (Next Week / Previous Week buttons) — 0 is the real current
// week (default, unchanged behavior). Any other value is a READ-ONLY
// PREVIEW: there's no "today" inside a week that hasn't happened yet
// (or already passed), so a preview always treats that week's Monday
// as if it were "today" (whole week balanced together, same as the
// real Monday-morning case) and never rolls in old backlog — backlog
// is a "what's overdue right now" concept that only makes sense for
// the actual current day.
function computeWeeklyPlan(services, weekOffset = 0) {
    const realToday = startOfDay(new Date());
    const isPreview  = weekOffset !== 0;
    const monday  = getMonday(isPreview ? addDays(realToday, weekOffset * 7) : realToday);
    const sunday  = addDays(monday, 6);
    const today   = isPreview ? monday : realToday;
    const isMondayToday = isPreview ? true : (today.getDay() === 1);

    const thisWeek = services.filter(s => {
        const d = parseTTDate(s.nextUpdateDate);
        return d && d >= monday && d <= sunday;
    });
    const oldBacklog = isPreview ? [] : services.filter(s => {
        const d = parseTTDate(s.nextUpdateDate);
        return d && d < monday;
    });

    let groups = groupByDay(thisWeek);

    // The breakdown/batch system only has 5 weekday slots (Mon-Fri) —
    // any service due on a Saturday or Sunday of this week has no
    // slot to land in and would otherwise silently never appear in
    // any batch, even though it's correctly counted in "this week"'s
    // totals. Fold weekend-dated items into Friday's group (the last
    // working day of the week) instead of losing them.
    const fridayDateStr = formatTTDate(addDays(monday, 4));
    const weekendGroups = groups.filter(g => {
        const gd = parseTTDate(g.date);
        return gd && (gd.getDay() === 0 || gd.getDay() === 6); // Sun=0, Sat=6
    });

    if (weekendGroups.length > 0) {
        const weekendItems = weekendGroups.flatMap(g => g.items);
        const fridayGroup = groups.find(g => g.date === fridayDateStr);

        if (fridayGroup) {
            fridayGroup.items.push(...weekendItems);
        } else {
            groups.push({ date: fridayDateStr, items: weekendItems });
        }

        groups = groups
            .filter(g => !weekendGroups.includes(g))
            .sort((a, b) => parseTTDate(a.date) - parseTTDate(b.date));

        console.log(`📅 Folded ${weekendItems.length} weekend-dated service(s) into Friday (${fridayDateStr})`);
    }

    // All 5 weekday date strings this week, guaranteed to exist as
    // pool slots even when a day has ZERO services — without this, a
    // day with no data simply never gets a group at all (groupByDay
    // only creates entries for dates that actually appear), silently
    // shrinking the divisor used for balancing. E.g. Mon=0, Tue=20,
    // Wed=30, Thu=10, Fri=40 should divide by 5 (→ target 20), not by
    // 4 real groups (→ target 25) just because Monday had nothing.
    const weekdayDateStrs = [0, 1, 2, 3, 4].map(i => formatTTDate(addDays(monday, i)));
    const groupsByDate = new Map(groups.map(g => [g.date, g]));
    const emptySlot = (dateStr) => ({ date: dateStr, items: [] });

    let mandatoryItems = [];
    let poolGroups;

    if (isMondayToday) {
        // Whole week balanced together, nothing pre-mandatory yet —
        // every weekday gets a guaranteed slot, empty or not.
        poolGroups = weekdayDateStrs.map(dateStr => groupsByDate.get(dateStr) || emptySlot(dateStr));
    } else {
        const todayStr  = formatTTDate(today);
        const todayIdx  = weekdayDateStrs.indexOf(todayStr);
        const priorDateStrs     = weekdayDateStrs.slice(0, todayIdx + 1); // today + everything before it
        const remainingDateStrs = weekdayDateStrs.slice(todayIdx + 1);    // days still ahead

        mandatoryItems = priorDateStrs.flatMap(dateStr => (groupsByDate.get(dateStr)?.items) || []);
        poolGroups = remainingDateStrs.map(dateStr => groupsByDate.get(dateStr) || emptySlot(dateStr));
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

    return {
        allItems,
        breakdown,
        mandatoryCount: mandatoryItems.length,
        backlogCount: oldBacklog.length,
        weekStart: formatTTDate(monday),
        weekOffset,
    };
}

function computeBatch(services) {
    return computeWeeklyPlan(services).allItems;
}

module.exports = { computeBatch, computeWeeklyPlan };