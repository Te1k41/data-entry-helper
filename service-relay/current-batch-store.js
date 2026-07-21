// ============================================================
//  current-batch-store.js
//  Owns the CURRENT DAY'S batch — one of the 5 weekday slots
//  from due-services-trim.js's computeWeeklyPlan(). Works
//  through the week sequentially: Monday's slot first, and
//  once every item in it is marked done, automatically
//  advances to Tuesday's, then Wednesday's, and so on.
//
//  A fresh weekly plan is computed once per calendar week (the
//  first time it's needed that week) and its per-day record
//  lists are persisted — so the SET of services assigned to
//  each day-slot stays fixed for the week, even as you mark
//  things done, rather than being live-recomputed.
//
//  Whatever day you're VIEWING, any still-undone items from
//  EARLIER days automatically tag along too — force-advancing
//  (or navigating) past an unfinished day never abandons its
//  leftovers; they keep showing up merged into whichever day
//  you're on until they're actually marked done.
//
//  Fully navigable: goToDay() jumps to any day index directly
//  (used by both Previous/Next and day-tab navigation).
// ============================================================

const fs = require("fs");
const { CURRENT_BATCH_FILE, DATA_FOLDER } = require("./config");
const { computeWeeklyPlan } = require("./due-services-trim");
const { parseTTDate, formatTTDate } = require("./due-date-utils");

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

function ensureDataFolder() {
    if (!fs.existsSync(DATA_FOLDER)) fs.mkdirSync(DATA_FOLDER, { recursive: true });
}

function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
}

function getMondayKey(date) {
    const day = date.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(date);
    monday.setDate(monday.getDate() + diff);
    monday.setHours(0, 0, 0, 0);
    return formatTTDate(monday);
}

function loadState() {
    ensureDataFolder();
    if (!fs.existsSync(CURRENT_BATCH_FILE)) return null;

    try {
        return JSON.parse(fs.readFileSync(CURRENT_BATCH_FILE, "utf8"));
    } catch (err) {
        console.error("❌ Could not read current-batch.json — starting fresh:", err.message);
        return null;
    }
}

function saveState(state) {
    ensureDataFolder();
    fs.writeFileSync(CURRENT_BATCH_FILE, JSON.stringify(state, null, 2));
    console.log(
        `📦 Weekly batch state saved — week of ${state.weekStart}, ` +
        `day ${state.dayIndex} (${DAY_NAMES[state.dayIndex] || "week complete"})`
    );
}

// Computes a fresh weekly plan and stores just the RECORD IDs per day
// (not full service objects) — live data (done-status, dates, etc.)
// always comes from the real due-services store when reading the
// batch back out.
//
// asOfDayIndex (0=Monday..4=Friday), when given, tells computeWeeklyPlan
// to use that weekday as the domino-balance anchor instead of the real
// calendar day, AND lands the state's dayIndex on that same day (rather
// than always starting over at Monday) — recalculating "as of Wednesday"
// means you actually want to be looking at Wednesday's batch next.
function startNewWeek(allServices, asOfDayIndex = null) {
    const plan = computeWeeklyPlan(allServices, 0, asOfDayIndex);
    const weekStart = getMondayKey(new Date());
    const dayRecordLists = plan.breakdown.map(day => day.items.map(s => s.record));

    const hasAnchor = Number.isInteger(asOfDayIndex) && asOfDayIndex >= 0 && asOfDayIndex <= 4;

    // backlogCount is saved alongside the record lists (not just used
    // once and discarded) so the dashboard's workload chart can show
    // an accurate "includes N from before this week" note for the
    // rest of the week, without needing to recompute it later from a
    // "today" that may have moved on since this plan was made.
    const state = {
        weekStart,
        dayIndex: hasAnchor ? asOfDayIndex : 0,
        dayRecordLists,
        backlogCount: plan.backlogCount
    };
    saveState(state);
    return state;
}

function ensureCurrentWeekState(allServices) {
    const thisWeekKey = getMondayKey(new Date());
    let state = loadState();
    if (!state || state.weekStart !== thisWeekKey) {
        console.log(state ? "📅 New week — computing a fresh weekly plan" : "📦 No batch state yet — computing the first weekly plan");
        state = startNewWeek(allServices);
    }
    return state;
}

function itemsForDay(state, dayIndex, byRecord) {
    const records = state.dayRecordLists[dayIndex] || [];
    return records.map(r => byRecord.get(r)).filter(Boolean);
}

function isDayFullyDone(state, dayIndex, byRecord) {
    const items = itemsForDay(state, dayIndex, byRecord);
    return items.length === 0 || items.every(s => s.done);
}

// Walks the state forward past any day-slots that are empty or fully
// done, saving as it goes.
function advancePastDone(state, byRecord) {
    while (state.dayIndex < state.dayRecordLists.length && isDayFullyDone(state, state.dayIndex, byRecord)) {
        state.dayIndex++;
    }
    saveState(state);
    return state;
}

// Builds the actual batch shown for a given day index: that day's own
// items (done + undone, so progress stays visible) PLUS any still-
// undone items from every EARLIER day — nothing left behind, whether
// you got here by auto-advancing, force-advancing, or navigating.
function buildBatchForDay(state, dayIndex, byRecord) {
    if (dayIndex >= state.dayRecordLists.length) {
        // Past the last day (Friday) — before declaring the week
        // genuinely complete, check for any still-undone leftovers
        // from every day. Force-advancing past a day that wasn't
        // actually finished should never make its undone items
        // silently disappear from view.
        const leftovers = [];
        for (let i = 0; i < state.dayRecordLists.length; i++) {
            leftovers.push(...itemsForDay(state, i, byRecord).filter(s => !s.done));
        }

        if (leftovers.length > 0) {
            return {
                items: leftovers,
                dayIndex,
                dayName: "Leftover",
                weekStart: state.weekStart,
                weekComplete: false,
                leftoverCount: leftovers.length
            };
        }

        return { items: [], dayIndex, dayName: null, weekStart: state.weekStart, weekComplete: true };
    }

    const ownItems = itemsForDay(state, dayIndex, byRecord);

    const leftovers = [];
    for (let i = 0; i < dayIndex; i++) {
        leftovers.push(...itemsForDay(state, i, byRecord).filter(s => !s.done));
    }

    return {
        items: [...leftovers, ...ownItems],
        dayIndex,
        dayName: DAY_NAMES[dayIndex],
        weekStart: state.weekStart,
        weekComplete: false,
        leftoverCount: leftovers.length
    };
}

// Returns the batch for whichever day the state is currently on,
// auto-advancing past anything already fully done first.
function getCurrentBatch(allServices) {
    const byRecord = new Map(allServices.map(s => [s.record, s]));
    let state = ensureCurrentWeekState(allServices);
    state = advancePastDone(state, byRecord);
    return buildBatchForDay(state, state.dayIndex, byRecord);
}

// Jumps directly to a specific day index (clamped to valid range) —
// the one function behind Previous, Next, and day-tab navigation.
// Does NOT auto-skip done days — navigating is explicit, you land
// exactly where you asked to go.
function goToDay(allServices, dayIndex) {
    const byRecord = new Map(allServices.map(s => [s.record, s]));
    let state = ensureCurrentWeekState(allServices);

    const clamped = Math.max(0, Math.min(dayIndex, state.dayRecordLists.length));
    state.dayIndex = clamped;
    saveState(state);

    return buildBatchForDay(state, state.dayIndex, byRecord);
}

// Manual "Next Batch" — force-advances one day forward.
function advanceToNextBatch(allServices) {
    const state = ensureCurrentWeekState(allServices);
    return goToDay(allServices, state.dayIndex + 1);
}

// Navigate back one day.
function goToPreviousBatch(allServices) {
    const state = ensureCurrentWeekState(allServices);
    return goToDay(allServices, state.dayIndex - 1);
}

// Builds the SAME "this week" workload breakdown the dashboard's
// workload chart displays — but read directly from the PERSISTED
// batch state (dayRecordLists), not from a fresh, independent
// computeWeeklyPlan("today") call.
//
// Why this matters: the chart used to call computeWeeklyPlan(all, 0)
// straight from "today" every time it loaded, completely separately
// from whatever anchor day the actual current batch was really built
// with. Once Recalculate could be told to use a CHOSEN weekday as its
// anchor, that meant the chart and the real batch could show two
// different balances at once — e.g. recalculating "as of Wednesday"
// would correctly re-split the real batch that way, but the chart
// would still show a plain real-today split next to it, so the two
// panels visibly disagreed with each other.
//
// Reading straight from state.dayRecordLists guarantees the chart is
// always describing the exact same plan the batch itself is using,
// whatever anchor (real-today, or a chosen weekday) produced it.
function getStoredWeeklyBreakdown(allServices) {
    const byRecord = new Map(allServices.map(s => [s.record, s]));
    const state = ensureCurrentWeekState(allServices);
    const monday = parseTTDate(state.weekStart);

    const breakdown = state.dayRecordLists.map((records, i) => {
        const dateStr = formatTTDate(addDays(monday, i));
        const items = records.map(r => byRecord.get(r)).filter(Boolean);

        if (i < state.dayIndex) {
            // Whatever's still undone here already tags along into the
            // current day's bar below — same "rolled into today, don't
            // double-count" convention computeWeeklyPlan itself uses.
            return { date: dateStr, count: 0, items: [], mandatory: false, rolledIntoToday: true };
        }

        if (i === state.dayIndex) {
            // The current day's bar = its own items PLUS every earlier
            // day's still-undone leftovers — exactly what the real
            // batch (buildBatchForDay) shows you right now.
            const leftovers = [];
            for (let j = 0; j < i; j++) {
                leftovers.push(...itemsForDay(state, j, byRecord).filter(s => !s.done));
            }
            const combined = [...leftovers, ...items];
            return { date: dateStr, count: combined.length, items: combined, mandatory: true };
        }

        return { date: dateStr, count: items.length, items, mandatory: false };
    });

    const total = breakdown.reduce((sum, b) => sum + b.count, 0);

    return {
        breakdown,
        backlogCount: state.backlogCount || 0,
        total,
        weekStart: state.weekStart,
        weekOffset: 0
    };
}

// Manual "Recalculate Week" — forces a completely fresh weekly plan
// RIGHT NOW, regardless of whether the stored state's weekStart still
// matches the current week. Unlike ensureCurrentWeekState (which only
// recomputes when the week has genuinely changed), this always
// rebuilds from scratch — the same effect as manually deleting
// current-batch.json, without needing to touch the file by hand.
//
// asOfDayIndex (0=Monday..4=Friday) optionally picks which weekday to
// use as the domino-balance anchor instead of the real calendar day —
// the dashboard's day-picker next to the Recalculate button. Omitted/
// null means "today, for real" (unchanged default behavior). Lands on
// that day (or Monday, if no override) and then auto-advances past
// anything already done, same as a normal fresh-week start.
function recalculateWeek(allServices, asOfDayIndex = null) {
    const byRecord = new Map(allServices.map(s => [s.record, s]));
    let state = startNewWeek(allServices, asOfDayIndex);
    state = advancePastDone(state, byRecord);
    return buildBatchForDay(state, state.dayIndex, byRecord);
}

module.exports = {
    getCurrentBatch,
    advanceToNextBatch,
    goToPreviousBatch,
    goToDay,
    recalculateWeek,
    getStoredWeeklyBreakdown,
    DAY_NAMES
};