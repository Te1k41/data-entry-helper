let allServices = [];
let sortKey      = 'nextUpdateDate';
let sortAsc      = true;
let showOnlyNearestSplit = true; // default view: just the nearest-days split, not the full list
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

function toggleNearestSplit() {
    showOnlyNearestSplit = !showOnlyNearestSplit;
    render();
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

let historyPoints   = [];
let activityPoints  = [];
let activityStreak  = 0;
let nearestSplit    = [];

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
        const nsRes = await fetch('/due-services/nearest-split');
        const nsData = await nsRes.json();
        nearestSplit = nsData.services || [];
    } catch (e) {
        nearestSplit = [];
    }

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

function render() {
    const counts = renderStats();

    const splitBtn = document.getElementById('splitToggleBtn');
    if (splitBtn) splitBtn.textContent = showOnlyNearestSplit ? 'Show All' : 'Show Nearest Split';

    document.getElementById('charts').innerHTML =
        renderStatusChart(counts) +
        renderCarrierChart() +
        renderHistogram() +
        renderActivityChart() +
        renderTrendChart();

    const content = document.getElementById('content');

    if (allServices.length === 0) {
        content.innerHTML = '<div id="empty">-- no due-service data yet --</div>';
        document.getElementById('count').textContent = '';
        return;
    }

    // If the "nearest split" view is on (default), restrict the pool
    // to just the record IDs in nearestSplit BEFORE the usual text
    // filters/sort apply — this is what makes the count read like
    // "60 / 286" by default, instead of always showing everything.
    const nearestRecordIds = new Set(nearestSplit.map(s => s.record));
    const pool = showOnlyNearestSplit
        ? allServices.filter(s => nearestRecordIds.has(s.record))
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
    html += `<th><input value="${filters.service}" oninput="filters.service=this.value; render()" placeholder="filter..."></th>`;
    html += `<th><input value="${filters.carrier}" oninput="filters.carrier=this.value; render()" placeholder="filter..."></th>`;
    html += '<th></th><th></th>';
    html += `<th><input value="${filters.nextUpdateDate}" oninput="filters.nextUpdateDate=this.value; render()" placeholder="filter..."></th>`;
    html += '<th></th></tr></thead><tbody>';

    for (const s of filtered) {
        const days   = daysUntil(s.nextUpdateDate);
        const status = statusOf(s, days);
        const dayNote = days !== null
            ? (days < 0 ? `overdue ${Math.abs(days)}d` : (days === 0 ? 'today' : `${days}d`))
            : '';

        html += `<tr class="${status}">
            <td><span class="tag ${status}">${STATUS_LABEL[status]}</span>${s.service}</td>
            <td>${s.carrier}</td>
            <td>${linksHtml(s.links.schedule, 'sched')}</td>
            <td>${linksHtml(s.links.routeMap, 'map')}</td>
            <td class="dateCell">${s.nextUpdateDate}${dayNote ? '<span class="dayNote">('+dayNote+')</span>' : ''}</td>
            <td><button class="markDoneBtn" onclick="markDone('${s.record}')">Mark Done</button></td>
        </tr>`;
    }

    html += '</tbody></table>';
    content.innerHTML = html;
}

load();