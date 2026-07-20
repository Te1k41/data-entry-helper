let allServices = [];
let sortKey      = 'nextUpdateDate';
let sortAsc      = true;
let showOnlyBatch = true; // default view: just today's batch, not the full list
const filters    = { service: '', carrier: '', nextUpdateDate: '' };

const COLUMNS = [
    { key: 'service',        label: 'Service' },
    { key: 'carrier',        label: 'Carrier' },
    { key: 'schedule',       label: 'Schedule',   sortable: false },
    { key: 'routeMap',       label: 'Route Map',  sortable: false },
    { key: 'nextUpdateDate', label: 'Next Update' },
    { key: 'actions',        label: '',           sortable: false }
];

function daysUntil(dateStr) {
    // expects "DD-MON-YYYY" e.g. "11-JUL-2026"
    const months = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };
    const m = (dateStr || '').match(/^(\d{2})-([A-Z]{3})-(\d{4})$/);
    if (!m) return null;
    const target = new Date(parseInt(m[3], 10), months[m[2]], parseInt(m[1], 10));
    const today  = new Date();
    today.setHours(0,0,0,0);
    return Math.round((target - today) / 86400000);
}

function linksHtml(urls, label) {
    if (!urls || urls.length === 0) return '<span class="noLink">--</span>';
    return urls.map((u, i) => `<a class="linkBtn" href="${u}" target="_blank">${label}${urls.length > 1 ? ' ' + (i+1) : ''}</a>`).join('');
}

function clearFilters() {
    filters.service = '';
    filters.carrier = '';
    filters.nextUpdateDate = '';
    render();
}

function toggleShowAll() {
    showOnlyBatch = !showOnlyBatch;
    render();
}

async function nextBatch() {
    if (!confirm('Move to the next day now? Anything not done today carries forward automatically.')) return;
    await fetch('/due-services/next-batch', { method: 'POST' });
    load();
}

async function previousBatch() {
    await fetch('/due-services/previous-batch', { method: 'POST' });
    load();
}

async function goToDay(dayIndex) {
    await fetch('/due-services/go-to-day', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ dayIndex })
    });
    load();
}

async function recalculateWeek() {
    if (!confirm('Recalculate this whole week from scratch? Any manual progress tracking (which day you were on) resets to Monday.')) return;
    await fetch('/due-services/recalculate-week', { method: 'POST' });
    load();
}

function setSort(key) {
    const col = COLUMNS.find(c => c.key === key);
    if (!col || col.sortable === false) return;

    if (sortKey === key) {
        sortAsc = !sortAsc;
    } else {
        sortKey = key;
        sortAsc = true;
    }
    render();
}

async function markDone(record) {
    await fetch('/due-services/mark-done', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ record })
    });
    load();
}

async function undoDone(record) {
    const res = await fetch('/due-services/undo-done', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ record })
    });
    if (!res.ok) {
        console.warn('Nothing to undo for', record);
        return;
    }
    load();
}

function copyService(serviceName, event) {
    navigator.clipboard.writeText(serviceName).then(() => {
        const el = event.target;
        const original = el.textContent;
        el.textContent = 'Copied!';
        setTimeout(() => { el.textContent = original; }, 800);
    }).catch(err => console.error('Clipboard copy failed:', err));
}

let historyPoints   = [];
let activityPoints  = [];
let activityStreak  = 0;
let currentBatch    = [];
let batchInfo       = null; // { dayIndex, dayName, weekStart, weekComplete }
let weeklyPlan      = null;
let weeklyPlanOffset = 0; // 0 = real current week; Next/Previous Week buttons shift this

async function load() {
    const res  = await fetch('/due-services');
    const data = await res.json();

    document.getElementById('asOf').textContent = data.asOf
        ? '# last scanned ' + new Date(data.asOf).toLocaleString()
        : '# no scan received yet -- run the scanner on the Tradetech list page first';

    allServices = data.services || [];

    try {
        const histRes = await fetch('/due-services/history');
        const histData = await histRes.json();
        historyPoints = histData.points || [];
    } catch (e) {
        historyPoints = [];
    }

    try {
        const actRes = await fetch('/due-services/activity');
        const actData = await actRes.json();
        activityPoints = actData.points || [];
        activityStreak = actData.streak || 0;
    } catch (e) {
        activityPoints = [];
        activityStreak = 0;
    }

    try {
        const batchRes = await fetch('/due-services/current-batch');
        const batchData = await batchRes.json();
        currentBatch = batchData.services || [];
        batchInfo = {
            dayIndex: batchData.dayIndex,
            dayName: batchData.dayName,
            weekStart: batchData.weekStart,
            weekComplete: batchData.weekComplete,
            leftoverCount: batchData.leftoverCount || 0
        };
    } catch (e) {
        currentBatch = [];
        batchInfo = null;
    }

    await loadWeeklyPlan();

    render();
}

// Fetches just the weekly-plan preview at the current weeklyPlanOffset
// and re-renders — used both by the initial load() and by the Next
// Week / Previous Week buttons, so switching weeks doesn't need to
// re-fetch everything else (services, history, batch, etc.).
async function loadWeeklyPlan() {
    try {
        const planRes = await fetch(`/due-services/weekly-plan?offset=${weeklyPlanOffset}`);
        weeklyPlan = await planRes.json();
    } catch (e) {
        weeklyPlan = null;
    }
}

async function nextWeekPlan() {
    weeklyPlanOffset++;
    await loadWeeklyPlan();
    render();
}

async function previousWeekPlan() {
    weeklyPlanOffset--;
    await loadWeeklyPlan();
    render();
}

function statusOf(s, days) {
    if (s.done) return 'done';
    if (days !== null && days < 0) return 'overdue';
    if (days !== null && days <= 3) return 'due-soon';
    return 'ok';
}

function renderStats() {
    const counts = { overdue: 0, 'due-soon': 0, done: 0, ok: 0 };
    for (const s of allServices) {
        const days = daysUntil(s.nextUpdateDate);
        counts[statusOf(s, days)]++;
    }
    document.getElementById('stats').innerHTML = `
        <div class="stat"><b>${allServices.length}</b> total</div>
        <div class="stat overdue"><b>${counts.overdue}</b> overdue</div>
        <div class="stat due-soon"><b>${counts['due-soon']}</b> due soon</div>
        <div class="stat"><b>${counts.ok}</b> ok</div>
        <div class="stat done"><b>${counts.done}</b> done</div>
    `;
    return counts;
}

function renderCarrierChart() {
    const byCarrier = {};
    for (const s of allServices) {
        const c = s.carrier || '?';
        byCarrier[c] = (byCarrier[c] || 0) + 1;
    }
    const entries = Object.entries(byCarrier).sort((a, b) => b[1] - a[1]);
    const max = entries.length ? entries[0][1] : 1;
    const BAR_WIDTH = 30; // characters

    const rows = entries.map(([carrier, count]) => {
        const filled = Math.max(1, Math.round((count / max) * BAR_WIDTH));
        const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
        return `<div class="barRow">
            <div class="barLabel">${carrier}</div>
            <div class="barTrack"><span class="fill">${bar}</span></div>
            <div class="barCount">${count}</div>
        </div>`;
    }).join('');

    return `<div class="chartPanel">
        <h2>by carrier</h2>
        ${rows || '<div id="noHistory">-- no data --</div>'}
    </div>`;
}

function renderStatusChart(counts) {
    const total = allServices.length || 1;
    const BAR_WIDTH = 30;
    const rows = [
        ['overdue', 'overdue', counts.overdue],
        ['due-soon', 'due soon', counts['due-soon']],
        ['ok', 'ok', counts.ok],
        ['done', 'done', counts.done]
    ].map(([cls, label, count]) => {
        const filled = Math.max(count > 0 ? 1 : 0, Math.round((count / total) * BAR_WIDTH));
        const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
        return `<div class="barRow">
            <div class="barLabel">${label}</div>
            <div class="barTrack"><span class="fill ${cls}">${bar}</span></div>
            <div class="barCount">${count}</div>
        </div>`;
    }).join('');

    return `<div class="chartPanel">
        <h2>by status</h2>
        ${rows}
    </div>`;
}

function renderHistogram() {
    const DAYS = 14;
    const buckets = Array.from({ length: DAYS }, () => 0);
    const overdueFlag = Array.from({ length: DAYS }, () => false);
    const labels = [];

    const today = new Date();
    today.setHours(0,0,0,0);

    for (let i = 0; i < DAYS; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        labels.push(`${d.getDate()}`);
    }

    for (const s of allServices) {
        const days = daysUntil(s.nextUpdateDate);
        if (days === null) continue;
        if (days < 0) { buckets[0]++; overdueFlag[0] = true; continue; }
        if (days < DAYS) buckets[days]++;
    }

    const max = Math.max(1, ...buckets);
    const bars = buckets.map((count, i) =>
        `<div class="histBar ${overdueFlag[i] ? 'hasOverdue' : ''}" style="height:${Math.round((count / max) * 100)}%" title="${count} due"></div>`
    ).join('');
    const labelsHtml = labels.map(l => `<span>${l}</span>`).join('');

    return `<div class="chartPanel wide">
        <h2>next 14 days (day of month, day 0 = overdue)</h2>
        <div class="histogram">${bars}</div>
        <div class="histLabels">${labelsHtml}</div>
    </div>`;
}

function renderTrendChart() {
    const scannedPoints = historyPoints.filter(p => !p.noScan);

    if (scannedPoints.length < 2) {
        return `<div class="chartPanel wide">
            <h2>trend, last 30 days</h2>
            <div id="noHistory">-- need at least 2 days of scans to show a trend --</div>
        </div>`;
    }

    const max = Math.max(1, ...scannedPoints.map(p => p.total));

    const bars = historyPoints.map(p => {
        if (p.noScan) {
            return `<div class="trendBar noScan" style="height:2%" title="${p.date}: no scan"></div>`;
        }
        return `<div class="trendBar ${p.overdue > 0 ? 'hasOverdue' : ''}" style="height:${Math.round((p.total / max) * 100)}%" title="${p.date}: ${p.total} total, ${p.overdue} overdue"></div>`;
    }).join('');

    const labels = historyPoints.map((p, i) => {
        // label every ~5th day to avoid crowding 30 labels together
        const show = i % 5 === 0 || i === historyPoints.length - 1;
        const d = p.date.slice(5); // "MM-DD"
        return `<span>${show ? d : ''}</span>`;
    }).join('');

    return `<div class="chartPanel wide">
        <h2>total queue size, last 30 days</h2>
        <div class="trendLine">${bars}</div>
        <div class="histLabels">${labels}</div>
    </div>`;
}

function renderActivityChart() {
    const totalDone = activityPoints.reduce((sum, p) => sum + p.count, 0);

    if (totalDone === 0) {
        return `<div class="chartPanel wide">
            <h2>daily throughput -- last 30 days</h2>
            <div id="noHistory">-- no "Mark Done" activity logged yet --</div>
        </div>`;
    }

    const max = Math.max(1, ...activityPoints.map(p => p.count));
    const bars = activityPoints.map(p =>
        `<div class="histBar activityBar ${p.isWeekend ? 'weekend' : ''}" style="height:${Math.round((p.count / max) * 100) || 2}%" title="${p.date}${p.isWeekend ? ' (weekend)' : ''}: ${p.count} done"></div>`
    ).join('');

    const labels = activityPoints.map((p, i) => {
        const show = i % 5 === 0 || i === activityPoints.length - 1;
        return `<span>${show ? p.date.slice(5) : ''}</span>`;
    }).join('');

    const streakLabel = activityStreak > 0
        ? `<span class="streak">🔥 ${activityStreak} day streak</span>`
        : '';

    return `<div class="chartPanel wide">
        <h2>daily throughput -- last 30 days ${streakLabel}</h2>
        <div class="histogram">${bars}</div>
        <div class="histLabels">${labels}</div>
    </div>`;
}

function weekPlanTitle() {
    if (weeklyPlanOffset === 0) return "this week's workload (mon-fri)";
    if (weeklyPlanOffset === 1) return "next week's workload (preview)";
    if (weeklyPlanOffset === -1) return "last week's workload (preview)";
    return weeklyPlanOffset > 0
        ? `${weeklyPlanOffset} weeks ahead (preview)`
        : `${Math.abs(weeklyPlanOffset)} weeks back (preview)`;
}

function renderWeeklyPlanChart() {
    const nav = `<div class="weekNav">
        <button onclick="previousWeekPlan()">← Previous Week</button>
        <span class="weekNavLabel">${weeklyPlan && weeklyPlan.weekStart ? 'week of ' + weeklyPlan.weekStart : ''}</span>
        <button onclick="nextWeekPlan()">Next Week →</button>
    </div>`;

    if (!weeklyPlan || !weeklyPlan.breakdown || weeklyPlan.breakdown.length === 0) {
        return `<div class="chartPanel wide">
            <h2>${weekPlanTitle()}</h2>
            ${nav}
            <div id="noHistory">-- no data --</div>
        </div>`;
    }

    const max = Math.max(1, ...weeklyPlan.breakdown.map(b => b.count));
    const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

    const bars = weeklyPlan.breakdown.map((b, i) =>
        `<div class="histBar ${b.mandatory ? 'hasOverdue' : 'activityBar'}" style="height:${Math.round((b.count / max) * 100) || 2}%" title="${DAY_NAMES[i]} (${b.date}): ${b.count}${b.mandatory ? ' -- mandatory' : ' -- balanced'}"></div>`
    ).join('');

    const labels = weeklyPlan.breakdown.map((b, i) =>
        `<span>${DAY_NAMES[i]}<br>${b.count}</span>`
    ).join('');

    const backlogNote = weeklyPlan.backlogCount > 0
        ? `<span class="streak">⚠ includes ${weeklyPlan.backlogCount} from before this week</span>`
        : '';

    return `<div class="chartPanel wide">
        <h2>${weekPlanTitle()} -- ${weeklyPlan.total} total ${backlogNote}</h2>
        ${nav}
        <div class="histogram">${bars}</div>
        <div class="histLabels">${labels}</div>
    </div>`;
}

function render() {
    const counts = renderStats();

    const splitBtn = document.getElementById('splitToggleBtn');
    if (splitBtn) splitBtn.textContent = showOnlyBatch ? 'Show All' : 'Show Batch Only';

    const dayIndicator = document.getElementById('batchDayIndicator');
    if (dayIndicator && batchInfo) {
        if (batchInfo.weekComplete) {
            dayIndicator.textContent = `# ✅ every day this week (starting ${batchInfo.weekStart}) is done!`;
        } else if (batchInfo.dayName) {
            const leftoverNote = batchInfo.leftoverCount > 0
                ? ` (+ ${batchInfo.leftoverCount} carried forward, not yet done)`
                : '';
            dayIndicator.textContent = `# working on: ${batchInfo.dayName}'s batch (week of ${batchInfo.weekStart})${leftoverNote}`;
        } else {
            dayIndicator.textContent = '';
        }
    }

    const dayTabsEl = document.getElementById('dayTabs');
    if (dayTabsEl && batchInfo) {
        const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
        dayTabsEl.innerHTML = DAY_NAMES.map((name, i) => {
            const active = !batchInfo.weekComplete && batchInfo.dayIndex === i;
            return `<button class="dayTab ${active ? 'activeDayTab' : ''}" onclick="goToDay(${i})">${name}</button>`;
        }).join('');
    }

    // Floating "N left today" badge — stays visible on the right edge
    // of the screen regardless of scroll position, counting undone
    // items in TODAY's actual batch (not the full service list).
    const remainingBadge = document.getElementById('remainingTodayBadge');
    if (remainingBadge) {
        if (!batchInfo || batchInfo.weekComplete) {
            remainingBadge.style.display = 'none';
        } else {
            const remaining = currentBatch.filter(s => !s.done).length;
            remainingBadge.style.display = 'block';
            remainingBadge.className = remaining === 0 ? 'doneToday' : '';
            remainingBadge.innerHTML = remaining === 0
                ? `✅<br>all done`
                : `<b>${remaining}</b><br>left today`;
        }
    }

    document.getElementById('charts').innerHTML =
        renderStatusChart(counts) +
        renderCarrierChart() +
        renderHistogram() +
        renderWeeklyPlanChart() +
        renderActivityChart() +
        renderTrendChart();

    const content = document.getElementById('content');

    if (allServices.length === 0) {
        content.innerHTML = '<div id="empty">-- no due-service data yet --</div>';
        document.getElementById('count').textContent = '';
        return;
    }

    // Default view shows only the CURRENT BATCH — a persisted snapshot
    // computed once server-side, not live-recomputed here. "Show All"
    // toggles to the full stored list instead.
    const batchRecordIds = new Set(currentBatch.map(s => s.record));
    const pool = showOnlyBatch
        ? allServices.filter(s => batchRecordIds.has(s.record))
        : allServices;

    // Filter (case-insensitive "contains", Excel-style quick filter)
    let filtered = pool.filter(s => {
        if (filters.service && !(s.service || '').toLowerCase().includes(filters.service.toLowerCase())) return false;
        if (filters.carrier && !(s.carrier || '').toLowerCase().includes(filters.carrier.toLowerCase())) return false;
        if (filters.nextUpdateDate && !(s.nextUpdateDate || '').toLowerCase().includes(filters.nextUpdateDate.toLowerCase())) return false;
        return true;
    });

    // Sort — "done" items always sink to the bottom no matter which
    // column/direction is active; the chosen sort only decides ordering
    // WITHIN the not-done group and WITHIN the done group separately.
    filtered.sort((a, b) => {
        if (!!a.done !== !!b.done) return a.done ? 1 : -1;

        let va, vb;
        if (sortKey === 'nextUpdateDate') {
            va = daysUntil(a.nextUpdateDate) ?? 9999;
            vb = daysUntil(b.nextUpdateDate) ?? 9999;
        } else {
            va = (a[sortKey] || '').toLowerCase();
            vb = (b[sortKey] || '').toLowerCase();
        }
        if (va < vb) return sortAsc ? -1 : 1;
        if (va > vb) return sortAsc ? 1 : -1;
        return 0;
    });

    document.getElementById('count').textContent =
        `showing ${filtered.length} / ${allServices.length}`;

    const STATUS_LABEL = { overdue: '!', 'due-soon': '~', done: 'OK', ok: '.' };

    let html = '<table><thead><tr>';
    for (const col of COLUMNS) {
        const arrow = (sortKey === col.key && col.sortable !== false)
            ? (sortAsc ? '^' : 'v') : '';
        html += `<th onclick="setSort('${col.key}')">${col.label}${arrow ? '<span class="arrow">'+arrow+'</span>' : ''}</th>`;
    }
    html += '</tr><tr class="filterRow">';
    html += `<th><input value="${filters.service}" onkeydown="if(event.key==='Enter'){filters.service=this.value; render();}" placeholder="filter... (enter)"></th>`;
    html += `<th><input value="${filters.carrier}" onkeydown="if(event.key==='Enter'){filters.carrier=this.value; render();}" placeholder="filter... (enter)"></th>`;
    html += '<th></th><th></th>';
    html += `<th><input value="${filters.nextUpdateDate}" onkeydown="if(event.key==='Enter'){filters.nextUpdateDate=this.value; render();}" placeholder="filter... (enter)"></th>`;
    html += '<th></th></tr></thead><tbody>';

    for (const s of filtered) {
        const days   = daysUntil(s.nextUpdateDate);
        const status = statusOf(s, days);
        const dayNote = days !== null
            ? (days < 0 ? `overdue ${Math.abs(days)}d` : (days === 0 ? 'today' : `${days}d`))
            : '';

        const actionBtn = status === 'done'
            ? `<button class="markDoneBtn undoBtn" onclick="undoDone('${s.record}')">Undo</button>`
            : `<button class="markDoneBtn" onclick="markDone('${s.record}')">Mark Done</button>`;

        html += `<tr class="${status}">
            <td><span class="tag ${status}">${STATUS_LABEL[status]}</span><span class="copyable" title="Click to copy" onclick="copyService('${s.service}', event)">${s.service}</span></td>
            <td>${s.carrier}</td>
            <td>${linksHtml(s.links.schedule, 'sched')}</td>
            <td>${linksHtml(s.links.routeMap, 'map')}</td>
            <td class="dateCell">${s.nextUpdateDate}${dayNote ? '<span class="dayNote">('+dayNote+')</span>' : ''}</td>
            <td>${actionBtn}</td>
        </tr>`;
    }

    html += '</tbody></table>';
    content.innerHTML = html;
}

// ============================================================
//  Wellness reminders
//  Interval is based on real research, not a guess: Diaz et al.,
//  "Breaking Up Prolonged Sitting to Improve Cardiometabolic Risk"
//  (Columbia University, Medicine & Science in Sports & Exercise) —
//  a 5-minute walk every 30 minutes was the only pattern tested that
//  meaningfully helped blood sugar (-58% post-meal spikes) AND blood
//  pressure (-4 to -5 mmHg, comparable to 6 months of regular
//  exercise). So: every 30 minutes, one gentle nudge.
//
//  Deliberately calm on purpose: no sound, ever (Notification is
//  always created with silent: true). Both a real desktop
//  notification AND an in-page banner fire together, since either
//  one alone might be missed — but neither is urgent, neither
//  demands a response, and both are trivially dismissible. Off by
//  default; only starts if explicitly turned on.
// ============================================================

const WELLNESS_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const WELLNESS_SNOOZE_MS   = 10 * 60 * 1000; // 10 minutes

const WELLNESS_MESSAGES = [
    { emoji: '🚶', text: "No rush at all -- whenever you're ready, maybe a short 5-minute walk? Your body would probably really appreciate it." },
    { emoji: '💧', text: "Just a gentle thought: a sip of water might be nice right now, if you feel like it." },
    { emoji: '🌿', text: "However you're doing right now is okay. If you want, a little stretch could feel good." },
    { emoji: '🧘', text: "No pressure whatsoever -- just checking in. Maybe stand up and roll your shoulders for a moment?" },
    { emoji: '💛', text: "Small reminder, take it or leave it: your body might enjoy a quick walk and some water about now." },
];

// Fixed daily check-ins, separate from the 30-minute rotation above --
// these fire once at that clock time each day, not on a repeating
// interval.
const WELLNESS_DAILY_REMINDERS = [
    { hour: 12, minute: 0, emoji: '🍽️', text: "It's around lunchtime -- no pressure, but if you haven't eaten yet, now could be a nice time to." },
    { hour: 17, minute: 0, emoji: '🌇', text: "It's 5pm. If today's a wrap for you, that's more than okay -- take care of yourself out there." },
];

let wellnessEnabled  = false;
let wellnessTimerId  = null;
let wellnessMsgIndex = 0;
let wellnessNextTick = null; // timestamp (ms) of the next 30-min reminder, for the countdown display
let wellnessCountdownTimerId = null;
let wellnessDailyTimeoutIds  = [];

function loadWellnessPreference() {
    try {
        wellnessEnabled = localStorage.getItem('wellnessRemindersEnabled') === 'true';
    } catch (e) {
        wellnessEnabled = false;
    }
    if (wellnessEnabled) {
        startWellnessTimer();
        scheduleDailyReminders();
    }
    updateWellnessToggleLabel();
}

function saveWellnessPreference() {
    try {
        localStorage.setItem('wellnessRemindersEnabled', wellnessEnabled ? 'true' : 'false');
    } catch (e) { /* fine if unavailable -- just won't persist across reloads */ }
}

function updateWellnessToggleLabel() {
    const btn = document.getElementById('wellnessToggle');
    if (!btn) return;

    const supported = 'Notification' in window;
    const denied = supported && Notification.permission === 'denied';

    if (!wellnessEnabled) {
        btn.textContent = '💛 Wellness reminders: off';
    } else if (denied) {
        // Desktop notifications are blocked at the browser level --
        // JS can't re-prompt once denied, so say so plainly instead
        // of silently only-sometimes working.
        btn.textContent = '💛 On (banner only -- notifications blocked, see below)';
    } else if (!supported) {
        btn.textContent = '💛 On (banner only -- notifications unsupported)';
    } else {
        btn.textContent = '💛 Wellness reminders: on';
    }
    btn.classList.toggle('wellnessOn', wellnessEnabled);

    const help = document.getElementById('wellnessHelp');
    if (help) {
        help.innerHTML = (wellnessEnabled && denied)
            ? `Desktop notifications are blocked for this page, so only the in-page banner will show (only while this tab is open and visible).
               To fix: click the icon just left of the address bar (padlock or "i") → Site settings / Permissions → set Notifications to Allow, then reload.
               Also double check Windows itself isn't muting your browser: Settings → System → Notifications → make sure your browser is allowed.`
            : '';
    }
}

async function toggleWellnessReminders() {
    if (!wellnessEnabled) {
        // Only ask for notification permission on a deliberate click,
        // never automatically on page load -- and it's fine if this
        // is denied or unsupported, the in-page banner still works.
        if ('Notification' in window && Notification.permission === 'default') {
            try { await Notification.requestPermission(); } catch (e) { /* ignore */ }
        }
        wellnessEnabled = true;
        startWellnessTimer();
        scheduleDailyReminders();
    } else {
        wellnessEnabled = false;
        stopWellnessTimer();
        clearDailyReminders();
    }
    saveWellnessPreference();
    updateWellnessToggleLabel();
}

// Fires a reminder immediately (bypassing the 30-minute wait) so you
// can check right now whether the desktop notification actually shows
// up, instead of finding out half an hour later.
function testWellnessNotification() {
    showWellnessReminder();
}

function startWellnessTimer() {
    stopWellnessTimer();
    // First nudge is a full interval away -- no reminder the instant
    // you turn this on, that would feel like a jump-scare, not calm.
    wellnessNextTick = Date.now() + WELLNESS_INTERVAL_MS;
    wellnessTimerId = setInterval(() => {
        showWellnessReminder();
        wellnessNextTick = Date.now() + WELLNESS_INTERVAL_MS;
    }, WELLNESS_INTERVAL_MS);
    startWellnessCountdownDisplay();
}

function stopWellnessTimer() {
    if (wellnessTimerId) clearInterval(wellnessTimerId);
    wellnessTimerId = null;
    wellnessNextTick = null;
    stopWellnessCountdownDisplay();
}

// --- Live countdown display (updates once a second) ---

function startWellnessCountdownDisplay() {
    stopWellnessCountdownDisplay();
    updateWellnessCountdownDisplay();
    wellnessCountdownTimerId = setInterval(updateWellnessCountdownDisplay, 1000);
}

function stopWellnessCountdownDisplay() {
    if (wellnessCountdownTimerId) clearInterval(wellnessCountdownTimerId);
    wellnessCountdownTimerId = null;
    const el = document.getElementById('wellnessCountdown');
    if (el) el.textContent = '';
}

function formatCountdownClock(ms) {
    if (ms == null || ms < 0) return '--:--';
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function formatCountdownRough(ms) {
    const totalMinutes = Math.max(0, Math.floor(ms / 60000));
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return h === 0 ? `${m}m` : `${h}h ${m}m`;
}

// Milliseconds until the next time it's exactly `hour:minute` --
// today if that hasn't happened yet, otherwise tomorrow.
function msUntilClockTime(hour, minute) {
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target - now;
}

function updateWellnessCountdownDisplay() {
    const el = document.getElementById('wellnessCountdown');
    if (!el) return;

    if (!wellnessEnabled || wellnessNextTick == null) {
        el.textContent = '';
        return;
    }

    const remaining = wellnessNextTick - Date.now();
    const [lunch, endOfDay] = WELLNESS_DAILY_REMINDERS;
    const lunchMs = msUntilClockTime(lunch.hour, lunch.minute);
    const eodMs   = msUntilClockTime(endOfDay.hour, endOfDay.minute);

    el.textContent =
        `next check-in in ${formatCountdownClock(remaining)}` +
        ` · ${lunch.emoji} lunch in ${formatCountdownRough(lunchMs)}` +
        ` · ${endOfDay.emoji} end of day in ${formatCountdownRough(eodMs)}`;
}

// --- Fixed daily reminders (12:00 lunch, 17:00 end of day) ---

function scheduleDailyReminders() {
    clearDailyReminders();
    WELLNESS_DAILY_REMINDERS.forEach((reminder, i) => {
        const fire = () => {
            if (wellnessEnabled) showWellnessReminder(reminder);
            // Reschedule for the same time tomorrow regardless, so
            // this keeps working across midnight without a reload.
            wellnessDailyTimeoutIds[i] = setTimeout(fire, msUntilClockTime(reminder.hour, reminder.minute));
        };
        wellnessDailyTimeoutIds[i] = setTimeout(fire, msUntilClockTime(reminder.hour, reminder.minute));
    });
}

function clearDailyReminders() {
    wellnessDailyTimeoutIds.forEach(id => { if (id) clearTimeout(id); });
    wellnessDailyTimeoutIds = [];
}

// explicitMsg lets the fixed daily reminders (lunch/end-of-day) reuse
// this same notification+banner machinery instead of duplicating it.
function showWellnessReminder(explicitMsg) {
    const msg = explicitMsg || WELLNESS_MESSAGES[wellnessMsgIndex % WELLNESS_MESSAGES.length];
    if (!explicitMsg) wellnessMsgIndex++;

    // Desktop notification -- silent: true means no sound under any
    // circumstance, regardless of OS/browser settings.
    if ('Notification' in window && Notification.permission === 'granted') {
        try {
            const n = new Notification('Tradetech Dashboard', {
                body: msg.text,
                silent: true,
                tag: 'wellness-reminder', // replaces any previous one instead of stacking up
            });
            setTimeout(() => n.close(), 15000);
        } catch (e) { /* ignore -- banner still shows below */ }
    }

    // In-page banner, shown alongside the notification.
    const banner = document.getElementById('wellnessBanner');
    if (banner) {
        banner.querySelector('.wellnessEmoji').textContent = msg.emoji;
        banner.querySelector('.wellnessText').textContent = msg.text;
        banner.classList.add('show');
    }
}

function dismissWellnessBanner() {
    const banner = document.getElementById('wellnessBanner');
    if (banner) banner.classList.remove('show');
}

function snoozeWellnessBanner() {
    dismissWellnessBanner();
    if (!wellnessEnabled) return;
    stopWellnessTimer(); // clears the normal 30-min countdown display
    wellnessNextTick = Date.now() + WELLNESS_SNOOZE_MS;
    startWellnessCountdownDisplay(); // resume the countdown, now counting down to the snooze
    setTimeout(() => {
        showWellnessReminder();
        if (wellnessEnabled) startWellnessTimer(); // back to the normal 30-min cadence after this
    }, WELLNESS_SNOOZE_MS);
}

loadWellnessPreference();
load();