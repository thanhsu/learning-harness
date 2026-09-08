/* learning-harness dashboard — plain JS, no build step. */

const $ = (id) => document.getElementById(id);
let selectedSession = null;
let selectedNote = null;

/* ── Tabs ───────────────────────────────────────────────── */

for (const btn of document.querySelectorAll('.tab')) {
  btn.onclick = () => {
    for (const b of document.querySelectorAll('.tab')) {
      b.classList.toggle('active', b === btn);
    }
    for (const page of ['live', 'notes', 'settings']) {
      $(`tab-${page}`).hidden = btn.dataset.tab !== page;
    }
    if (btn.dataset.tab === 'settings') loadSettings();
  };
}

function toast(message, ok = false) {
  const el = $('toast');
  el.textContent = message;
  el.className = ok ? 'ok' : '';
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, ok ? 4000 : 8000);
}

async function api(url, options) {
  const res = await fetch(url, options);
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    throw new Error((isJson && body.error) || `Request failed (${res.status})`);
  }
  return body;
}

/* ── Status ─────────────────────────────────────────────── */

async function loadStatus() {
  const s = await api('/api/status');
  const ai = $('pill-ai');
  ai.textContent = s.aiEnabled ? `AI: ${s.model}` : 'AI: off (no key)';
  ai.className = 'pill ' + (s.aiEnabled ? 'ok' : 'warn');

  const q = $('pill-quota');
  q.textContent = `Calls today: ${s.quota.used}/${s.quota.limit}`;
  q.className = 'pill ' + (s.quota.remaining === 0 ? 'warn' : '');

  $('pill-vault').textContent = `Vault: ${s.vaultDir}`;

  // Persistent banner when the last AI call failed (quota, bad key, 429...).
  const banner = $('ai-error');
  if (s.aiLastError) {
    banner.textContent = `⚠ AI error (${new Date(s.aiLastError.at).toLocaleTimeString()}): ${s.aiLastError.message}`;
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }

  renderSettingsStatus(s);
}

function renderSettingsStatus(s) {
  const box = $('settings-status');
  if (!box) return;
  const lines = [
    `AI: ${s.aiEnabled ? 'enabled' : 'DISABLED — no API key'}`,
    `Note model: ${s.model}`,
    `Summary model: ${s.summaryModel}`,
    `Calls today: ${s.quota.used}/${s.quota.limit} (${s.quota.remaining} left)`,
    `Free-tier guard: ${s.paidAiDisabled ? 'on (paid models blocked)' : 'OFF'}`,
    s.aiLastError
      ? `Last AI error: ${s.aiLastError.message}`
      : 'Last AI call: OK',
  ];
  box.textContent = lines.join('\n');
}

/* ── Settings ───────────────────────────────────────────── */

async function loadSettings() {
  try {
    const s = await api('/api/settings');
    $('set-key-hint').textContent = s.keySet
      ? `Current key: ${s.keyHint} (leave blank to keep it)`
      : 'No key configured — AI features are off.';
    for (const [selId, current, allowEmpty] of [
      ['set-model', s.model, false],
      ['set-summary-model', s.summaryModel, true],
    ]) {
      const sel = $(selId);
      sel.innerHTML = '';
      if (allowEmpty) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '(same as note model)';
        sel.appendChild(opt);
      }
      for (const m of s.freeTierModels) {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        sel.appendChild(opt);
      }
      sel.value = current ?? '';
    }
    $('set-max').value = s.maxDailyCalls;
    $('set-lang').value = s.outputLanguage || '';
  } catch (err) {
    toast(err.message);
  }
}

$('settings-form').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        apiKey: $('set-key').value.trim() || undefined,
        model: $('set-model').value,
        summaryModel: $('set-summary-model').value,
        maxDailyCalls: Number($('set-max').value),
        outputLanguage: $('set-lang').value.trim(),
      }),
    });
    $('set-key').value = '';
    toast('Settings saved.', true);
    await Promise.all([loadStatus(), loadSettings()]);
  } catch (err) {
    toast(err.message);
  }
};

/* ── Live sessions ──────────────────────────────────────── */

function renderList(el, items, empty, render) {
  el.innerHTML = '';
  if (items.length === 0) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = empty;
    el.appendChild(li);
    return;
  }
  for (const item of items) el.appendChild(render(item));
}

async function loadSessions() {
  const { sessions } = await api('/api/live/sessions');
  renderList($('session-list'), sessions, 'No active sessions.', (s) => {
    const li = document.createElement('li');
    if (s.id === selectedSession) li.classList.add('selected');
    const name = document.createElement('span');
    name.textContent = (s.endedAt ? '⏹ ' : '🔴 ') + s.id;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${s.chunkCount} chunks`;
    li.append(name, meta);
    li.onclick = () => { selectedSession = s.id; loadSessionDetail(); loadSessions(); };
    return li;
  });
}

async function loadSessionDetail() {
  if (!selectedSession) return;
  try {
    const { session, transcript } = await api(
      `/api/live/sessions/${encodeURIComponent(selectedSession)}`
    );
    $('session-detail').hidden = false;
    $('session-placeholder').hidden = true;
    $('session-title').textContent =
      session.id + (session.endedAt ? ' (ended)' : ' (live)');
    $('session-summary').textContent =
      session.rollingSummary ||
      (session.summaryError
        ? `Summary unavailable: ${session.summaryError}`
        : 'No rolling summary yet.');
    if (session.endedAt) {
      const bar = $('caption-bar');
      bar.classList.add('idle');
      bar.textContent = 'Session ended.';
    }
    const pre = $('session-transcript');
    const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 20;
    pre.textContent = transcript || '(empty)';
    if (atBottom) pre.scrollTop = pre.scrollHeight;
  } catch (err) {
    toast(err.message);
  }
}

$('btn-end').onclick = async () => {
  if (!selectedSession) return;
  try {
    const r = await api(
      `/api/live/sessions/${encodeURIComponent(selectedSession)}/end`,
      { method: 'POST' }
    );
    toast(`Note generated: ${r.notePath}`, true);
    await Promise.all([loadSessions(), loadNotes(), loadStatus()]);
  } catch (err) {
    toast(err.message);
  }
};

$('btn-reset').onclick = async () => {
  if (!selectedSession) return;
  if (!confirm(`Reset session "${selectedSession}"? Its transcript will be deleted (generated notes are kept).`)) {
    return;
  }
  try {
    await api(
      `/api/live/sessions/${encodeURIComponent(selectedSession)}/reset`,
      { method: 'POST' }
    );
    toast(`Session "${selectedSession}" reset.`, true);
    selectedSession = null;
    $('session-detail').hidden = true;
    $('session-placeholder').hidden = false;
    await loadSessions();
  } catch (err) {
    toast(err.message);
  }
};

/* ── Notes ──────────────────────────────────────────────── */

async function loadNotes() {
  const { notes } = await api('/api/notes');
  renderList($('note-list'), notes, 'No notes yet.', (n) => {
    const li = document.createElement('li');
    if (n.name === selectedNote) li.classList.add('selected');
    const name = document.createElement('span');
    name.textContent = '📄 ' + n.name;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = new Date(n.mtime).toLocaleString();
    li.append(name, meta);
    li.onclick = () => openNote(n.name);
    return li;
  });
}

async function openNote(name) {
  selectedNote = name;
  try {
    const text = await api(`/api/notes/${encodeURIComponent(name)}`);
    const view = $('note-view');
    view.hidden = false;
    view.textContent = text;
    $('note-placeholder').hidden = true;
    $('note-actions').hidden = false;
    loadNotes();
  } catch (err) {
    toast(err.message);
  }
}

$('btn-translate').onclick = async () => {
  if (!selectedNote) return;
  const btn = $('btn-translate');
  btn.disabled = true;
  btn.textContent = 'Đang dịch…';
  try {
    const r = await api(
      `/api/notes/${encodeURIComponent(selectedNote)}/translate`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ language: 'vi' }),
      }
    );
    toast(`Đã dịch: ${r.noteName}`, true);
    await openNote(r.noteName);
    await loadStatus();
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Dịch sang tiếng Việt 🇻🇳';
  }
};

/* ── Manual ingest ──────────────────────────────────────── */

$('ingest-form').onsubmit = async (e) => {
  e.preventDefault();
  const text = $('ingest-text').value;
  const filename = $('ingest-name').value.trim() || undefined;
  try {
    const r = await api('/api/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename, text }),
    });
    toast(
      `Note generated${r.usedAi ? '' : ' (offline fallback)'}: ${r.notePath}` +
        (r.aiError ? `\nAI: ${r.aiError}` : ''),
      true
    );
    $('ingest-text').value = '';
    await Promise.all([loadNotes(), loadStatus()]);
  } catch (err) {
    toast(err.message);
  }
};

/* ── Realtime stream (SSE): captions + transcript push ──── */

function setCaption(line) {
  const bar = $('caption-bar');
  // line format: "[timestamp] Speaker: text" or "[timestamp] text"
  const m = line.match(/^\[[^\]]*\]\s*(?:([^:]{1,60}):\s+)?(.*)$/);
  const speaker = m && m[1] ? m[1] : '';
  const text = m ? m[2] : line;
  bar.classList.remove('idle');
  bar.innerHTML = '';
  if (speaker) {
    const s = document.createElement('span');
    s.className = 'speaker';
    s.textContent = speaker + ':';
    bar.appendChild(s);
  }
  bar.appendChild(document.createTextNode(text));
}

function connectStream() {
  const es = new EventSource('/api/live/stream');

  es.addEventListener('chunk', (e) => {
    const { session, line } = JSON.parse(e.data);
    // Auto-focus the session receiving audio when nothing is selected.
    if (!selectedSession) {
      selectedSession = session.id;
      loadSessionDetail();
    }
    if (session.id !== selectedSession) return;
    setCaption(line);
    const pre = $('session-transcript');
    if (!$('session-detail').hidden) {
      const atBottom =
        pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 30;
      pre.textContent =
        (pre.textContent === '(empty)' ? '' : pre.textContent) +
        (pre.textContent && pre.textContent !== '(empty)' ? '\n' : '') +
        line;
      if (atBottom) pre.scrollTop = pre.scrollHeight;
      $('session-title').textContent = `${session.id} (live)`;
    } else {
      loadSessionDetail();
    }
    loadSessions();
  });

  es.addEventListener('summary', (e) => {
    const { session } = JSON.parse(e.data);
    if (session.id === selectedSession) {
      $('session-summary').textContent =
        session.rollingSummary || 'No rolling summary yet.';
    }
  });

  es.addEventListener('ended', () => loadSessions());
  es.addEventListener('reset', (e) => {
    const { session } = JSON.parse(e.data);
    if (session.id === selectedSession) {
      selectedSession = null;
      $('session-detail').hidden = true;
      $('session-placeholder').hidden = false;
    }
    loadSessions();
  });

  es.onerror = () => {
    // Browser auto-reconnects; nothing to do.
  };
}

/* ── Live capture (Zoom audio bridge) ───────────────────── */

let devicesLoaded = false;

function renderCaptureStatus(s) {
  const line = $('capture-status-line');
  const installRow = $('capture-install-row');
  const controls = $('capture-controls');
  const startBtn = $('btn-capture-start');
  const stopBtn = $('btn-capture-stop');

  if (!s.pythonFound) {
    line.textContent =
      '⚠ Python 3 not found. Install it first (Windows: python.org or "winget install Python.Python.3.12"; macOS: "brew install python") then reload.';
    installRow.hidden = true;
    controls.hidden = true;
    return;
  }

  if (s.installing) {
    line.textContent = '⏳ Installing Python dependencies (numpy, soundcard, faster-whisper)…';
    installRow.hidden = false;
    $('btn-capture-install').disabled = true;
    $('capture-install-log').textContent = (s.installLogTail || []).join('\n');
    controls.hidden = true;
    return;
  }

  if (s.depsReady === false || s.depsReady === null) {
    line.textContent =
      s.depsReady === null
        ? 'Checking Python dependencies…'
        : 'Capture bridge needs Python packages (one-time, ~200 MB incl. Whisper runtime).';
    installRow.hidden = s.depsReady === null;
    $('btn-capture-install').disabled = false;
    if (s.installExitCode !== null && s.installExitCode !== 0) {
      $('capture-install-log').textContent =
        'Install failed:\n' + (s.installLogTail || []).join('\n');
    }
    controls.hidden = true;
    return;
  }

  // deps ready
  installRow.hidden = true;
  controls.hidden = false;
  startBtn.hidden = s.running;
  stopBtn.hidden = !s.running;
  line.textContent = s.running
    ? `🔴 Capturing → session "${s.sessionId}". Join your Zoom meeting; speech becomes live chunks automatically.`
    : '✅ Ready. Pick a device (or leave Auto for system audio) and press Start before/while in your meeting.';

  const last = (s.events || []).slice(-1)[0];
  $('capture-last').textContent = last
    ? `${last.event}: ${last.text || last.message || ''}`
    : '';

  if (!s.running && !devicesLoaded) {
    devicesLoaded = true;
    loadCaptureDevices();
  }
}

async function loadCaptureStatus() {
  try {
    renderCaptureStatus(await api('/api/capture/status'));
  } catch {
    /* server restarting */
  }
}

async function loadCaptureDevices() {
  const sel = $('capture-device');
  try {
    const { devices, error } = await api('/api/capture/devices');
    if (error) {
      toast(error);
      return;
    }
    const current = sel.value;
    sel.innerHTML = '<option value="">Auto device (system audio)</option>';
    for (const d of devices) {
      const opt = document.createElement('option');
      opt.value = String(d.index);
      opt.textContent = (d.loopback ? '🔁 ' : '🎤 ') + d.name;
      sel.appendChild(opt);
    }
    sel.value = current;
  } catch (err) {
    toast(err.message);
  }
}

$('btn-capture-devices').onclick = loadCaptureDevices;

$('btn-capture-install').onclick = async () => {
  try {
    await api('/api/capture/install', { method: 'POST' });
    toast('Installing Python dependencies — this can take a few minutes…', true);
    loadCaptureStatus();
  } catch (err) {
    toast(err.message);
  }
};

$('btn-capture-start').onclick = async () => {
  try {
    await api('/api/capture/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: $('capture-session').value.trim() || 'zoom-live',
        device: $('capture-device').value || undefined,
        model: $('capture-model').value,
        language: $('capture-lang').value.trim() || 'auto',
        speaker: $('capture-speaker').value.trim() || undefined,
        windowSeconds: Number($('capture-window').value) || undefined,
      }),
    });
    toast('Capture started. First start downloads the Whisper model — watch the status line.', true);
    loadCaptureStatus();
  } catch (err) {
    toast(err.message);
  }
};

$('btn-capture-stop').onclick = async () => {
  try {
    await api('/api/capture/stop', { method: 'POST' });
    toast('Capture stopped.', true);
    loadCaptureStatus();
  } catch (err) {
    toast(err.message);
  }
};

/* ── Polling ────────────────────────────────────────────── */

async function refresh() {
  try {
    await Promise.all([loadStatus(), loadSessions(), loadNotes(), loadCaptureStatus()]);
    if (selectedSession) await loadSessionDetail();
  } catch {
    /* server briefly unavailable; retry on next tick */
  }
}

refresh();
setInterval(refresh, 4000);
connectStream();
