const WORK_DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function populateWorkDaySelects() {
    const opts = WORK_DAY_NAMES.map((name, i) => `<option value="${i}">${name}</option>`).join('');
    document.getElementById('workDayStart').innerHTML = opts;
    document.getElementById('workDayEnd').innerHTML = opts;
}

async function loadSettings() {
    try {
        populateWorkDaySelects();
        const res = await fetch('/settings');
        const settings = await res.json();
        document.getElementById('assignedToName').value = settings.assignedToName || '';
        document.getElementById('watchFolder').value = settings.watchFolder || '';
        document.getElementById('dataFolder').value = settings.dataFolder || '';

        // Server stores a plain array of weekday indices (not necessarily
        // contiguous — this page's "from/to" pair can only express a
        // contiguous range, but the first/last day of whatever's saved
        // is a reasonable range to show back, and re-saving always
        // produces one).
        const workDays = Array.isArray(settings.workDays) && settings.workDays.length ? settings.workDays : [0, 1, 2, 3, 4];
        document.getElementById('workDayStart').value = Math.min(...workDays);
        document.getElementById('workDayEnd').value = Math.max(...workDays);
    } catch (e) {
        showMessage('Could not load current settings.', false);
    }
}

async function saveSettings() {
    const start = parseInt(document.getElementById('workDayStart').value, 10);
    const end   = parseInt(document.getElementById('workDayEnd').value, 10);
    if (end < start) {
        showMessage('❌ Work week "to" day can\'t be before the "from" day.', false);
        return;
    }
    const workDays = [];
    for (let i = start; i <= end; i++) workDays.push(i);

    const payload = {
        assignedToName: document.getElementById('assignedToName').value.trim(),
        watchFolder:    document.getElementById('watchFolder').value.trim(),
        dataFolder:     document.getElementById('dataFolder').value.trim(),
        workDays,
    };

    try {
        const res = await fetch('/settings', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.success) {
            showMessage('✅ Saved. ' + (data.note || ''), true);
        } else {
            showMessage('❌ ' + (data.error || 'Save failed'), false);
        }
    } catch (e) {
        showMessage('❌ Could not reach the relay server.', false);
    }
}

function showMessage(text, ok) {
    const el = document.getElementById('saveMsg');
    el.textContent = text;
    el.className = ok ? 'ok' : 'err';
}

loadSettings();