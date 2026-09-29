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
const settingsStore = require("./settings-store");

const SHORT_DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri"];

// Sorted, deduped 0=Monday..4=Friday indices — which weekdays actually
// get assigned work. Read fresh each call (not cached) so a settings
// change takes effect on the very next computation, no restart needed.
function getWorkDays() {
    return settingsStore.load().workDays;
}

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
//
// asOfDayIndex lets Recalculate be told to use a CHOSEN weekday (0 =
// Monday .. 4 = Friday) as the anchor instead of whatever the real
// calendar day happens to be — e.g. recalculating on an actual
// Thursday but wanting the domino balance to run as if today were
// Tuesday. Only meaningful for the real current week (weekOffset ===
// 0); ignored for a preview, which already forces its own Monday-as-
// today anchor for a different reason. Backlog (services overdue from
// BEFORE this week's Monday) still comes from the REAL current date
// either way — that's "what's actually overdue right now", not
// something a hypothetical anchor day should change.
function computeWeeklyPlan(services, weekOffset = 0, asOfDayIndex = null) {
    const workDays = getWorkDays(); // e.g. [0,1,2] for a Mon-Wed work week, rest left free
    const firstWorkDay = workDays[0];

    const realToday = startOfDay(new Date());
    const isPreview  = weekOffset !== 0;
    const monday  = getMonday(isPreview ? addDays(realToday, weekOffset * 7) : realToday);
    const sunday  = addDays(monday, 6);

    const hasAnchorOverride = !isPreview && Number.isInteger(asOfDayIndex) && asOfDayIndex >= 0 && asOfDayIndex <= 4;
    const today = isPreview
        ? monday
        : (hasAnchorOverride ? addDays(monday, asOfDayIndex) : realToday);
    // "Whole week balanced fresh" triggers on the FIRST configured work
    // day, not necessarily calendar-Monday — a Tue-Thu work week starts
    // its fresh balance on Tuesday, same idea as Monday always did before
    // work days were configurable.
    const isMondayToday = isPreview ? true : (hasAnchorOverride ? asOfDayIndex === firstWorkDay : today.getDay() === firstWorkDay + 1);

    // Always capped to this calendar week's Mon-Sun span, real week or
    // preview alike. due-service-scanner.js deliberately leaves
    // Tradetech's own date filter untouched, so a scan can return
    // services due weeks out — those belong in a LATER week's plan,
    // not folded into this one just because they happened to be in the
    // same scan response.
    const thisWeek = services.filter(s => {
        const d = parseTTDate(s.nextUpdateDate);
        if (!d || d < monday) return false;
        return d <= sunday;
    });
    const oldBacklog = isPreview ? [] : services.filter(s => {
        const d = parseTTDate(s.nextUpdateDate);
        return d && d < monday;
    });

    let groups = groupByDay(thisWeek);

    // This week's configured work-day date strings, guaranteed to exist
    // as pool slots even when a day has ZERO services — without this, a
    // day with no data simply never gets a group at all (groupByDay
    // only creates entries for dates that actually appear), silently
    // shrinking the divisor used for balancing. E.g. Mon=0, Tue=20,
    // Wed=30 should divide by 3 (→ target 17), not by 2 real groups
    // (→ target 25) just because Monday had nothing.
    const weekdayDateStrs = workDays.map(i => formatTTDate(addDays(monday, i)));
    const weekdaySet = new Set(weekdayDateStrs);

    // The breakdown/batch system only has slots for the configured work
    // days — a service due on a day with no slot (a weekend, or a Mon-Fri
    // day you've opted out of) would otherwise silently never appear in
    // any batch, even though it's correctly counted in "this week"'s
    // totals. Fold all such items into the LAST configured work day
    // instead of losing them.
    const lastWorkDateStr = weekdayDateStrs[weekdayDateStrs.length - 1];
    const extraGroups = groups.filter(g => !weekdaySet.has(g.date));

    if (extraGroups.length > 0) {
        const extraItems = extraGroups.flatMap(g => g.items);
        const lastWorkGroup = groups.find(g => g.date === lastWorkDateStr);

        if (lastWorkGroup) {
            lastWorkGroup.items.push(...extraItems);
        } else {
            groups.push({ date: lastWorkDateStr, items: extraItems });
        }

        groups = groups
            .filter(g => !extraGroups.includes(g))
            .sort((a, b) => parseTTDate(a.date) - parseTTDate(b.date));

        console.log(`📅 Folded ${extraItems.length} out-of-slot-dated service(s) into the last work day (${lastWorkDateStr})`);
    }

    const groupsByDate = new Map(groups.map(g => [g.date, g]));
    const emptySlot = (dateStr) => ({ date: dateStr, items: [] });

    let mandatoryItems = [];
    let poolGroups;

    if (isMondayToday) {
        // Whole week balanced together, nothing pre-mandatory yet —
        // every weekday gets a guaranteed slot, empty or not.
        poolGroups = weekdayDateStrs.map(dateStr => groupsByDate.get(dateStr) || emptySlot(dateStr));
    } else {
        // Any OTHER day: still balance the WHOLE week's remaining work
        // domino-style, exactly like the first work day does — just
        // scoped to the days that are actually still available (today
        // onward; you can't redistribute onto a day that's already
        // passed). Any earlier-this-week day's real items (e.g.
        // Monday's, if today is Tuesday) are folded into TODAY's pool
        // input rather than force-dumped onto today uncapped — they
        // join the same nearest-first cascade as everything else.
        //
        // todayIdx is found by DATE, not by exact match — today itself
        // might not be a configured work day at all (a free day between
        // or before this week's work days), in which case it correctly
        // rolls into the next real work-day slot instead of vanishing.
        const todayStr = formatTTDate(today);
        const todayIdx = weekdayDateStrs.findIndex(dateStr => parseTTDate(dateStr) >= today);

        if (todayIdx === -1) {
            // Today is past every configured work day this week (e.g. a
            // free day after the week's last one) — everything not yet
            // assigned folds onto the last work day rather than being
            // silently dropped from the plan.
            const allRemainingItems = weekdayDateStrs.flatMap(dateStr => groupsByDate.get(dateStr)?.items || []);
            poolGroups = [{ date: lastWorkDateStr, items: allRemainingItems }];
        } else {
            const priorDateStrs     = weekdayDateStrs.slice(0, todayIdx); // strictly BEFORE today
            const remainingDateStrs = weekdayDateStrs.slice(todayIdx);    // today (or the next work day) onward

            const priorItems    = priorDateStrs.flatMap(dateStr => (groupsByDate.get(dateStr)?.items) || []);
            // Empty when today isn't itself a work-day slot (its real
            // items, if any, get picked up by the weekend/opted-out
            // fold above instead) — nothing double-counted either way.
            const todayOwnItems = groupsByDate.get(todayStr)?.items || [];

            poolGroups = remainingDateStrs.map((dateStr, i) =>
                i === 0
                    ? { date: dateStr, items: [...priorItems, ...todayOwnItems] } // first remaining slot carries prior leftovers too
                    : (groupsByDate.get(dateStr) || emptySlot(dateStr))
            );
        }
    }

    // Backlog from before this week always lands on today, on top of
    // whatever else today already has — regardless of which day it is.
    // (Prior-days-THIS-week items are handled above now, folded into
    // the balance pool instead of living here.)
    mandatoryItems = [...mandatoryItems, ...oldBacklog];

    const balanced = balanceEqually(poolGroups);

    // Day-by-day breakdown, one entry per configured work day, for the
    // dashboard's workload chart AND for the sequential day-batch system
    // (current-batch-store.js) — each entry now carries the actual ITEMS
    // assigned to that day-slot, not just a count. Both the fresh-week
    // case and any other day now share the same shape: `balanced` covers
    // today-through-the-last-work-day (or the whole week on the first
    // work day), and whichever slot backlog belongs on additionally
    // gets it appended on top.
    //
    // "Today's" slot is normally an exact date match — but today might
    // not be a configured work day at all (a free day), so this falls
    // back to the next work day still ahead, or the last one if today is
    // past all of them, so backlog/mandatory always lands SOMEWHERE
    // rather than silently landing on no slot at all.
    const weekdayDates = workDays.map(i => addDays(monday, i));
    const mandatoryDate = weekdayDates.find(d => d.getTime() === today.getTime())
        || weekdayDates.find(d => d >= today)
        || weekdayDates[weekdayDates.length - 1];

    const breakdown = weekdayDates.map((d, idx) => {
        const dateStr  = formatTTDate(d);
        const isToday  = d.getTime() === mandatoryDate.getTime();
        const shortDay = SHORT_DAY_NAMES[workDays[idx]];

        if (d < today && !isToday) {
            // Already folded into today's pool input above — empty
            // here so nothing is double-counted or double-batched,
            // even though these services are still genuinely included
            // in allItems (via today's slot).
            return { date: dateStr, shortDay, count: 0, items: [], mandatory: true, rolledIntoToday: true };
        }

        const match = balanced.find(b => b.date === dateStr);
        let items = match ? match.items : [];
        if (isToday) items = [...items, ...oldBacklog];
        return { date: dateStr, shortDay, count: items.length, items, mandatory: isToday };
    });

    const allItems = [...mandatoryItems, ...balanced.flatMap(b => b.items)];

    console.log(
        `📦 Weekly plan: ${mandatoryItems.length} mandatory (backlog from before this week) + ` +
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
        asOfDayIndex: hasAnchorOverride ? asOfDayIndex : null,
    };
}

function computeBatch(services) {
    return computeWeeklyPlan(services).allItems;
}

module.exports = { computeBatch, computeWeeklyPlan };