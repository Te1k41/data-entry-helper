async function loadSettings() {
    try {
        const res = await fetch('/settings');
        const settings = await res.json();
        document.getElementById('assignedToName').value = settings.assignedToName || '';
        document.getElementById('watchFolder').value = settings.watchFolder || '';
        document.getElementById('dataFolder').value = settings.dataFolder || '';
    } catch (e) {
        showMessage('Could not load current settings.', false);
    }
}

async function saveSettings() {
    const payload = {
        assignedToName: document.getElementById('assignedToName').value.trim(),
        watchFolder:    document.getElementById('watchFolder').value.trim(),
        dataFolder:     document.getElementById('dataFolder').value.trim(),
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