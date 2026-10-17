(() => {
  'use strict';

  const KEY = 'journal.v1';
  const DRAFT_KEY = 'journal.drafts.v1';
  const ZONE = 'Pacific/Auckland';
  const $ = (s) => document.querySelector(s);
  const noteEl = $('#note'), form = $('#composer'), sendEl = $('#send'),
    syncEl = $('#sheet-sync'), historyEl = $('#history');
  let entries = [], drafts = {}, canSave = true, saving = false;

  const nzClock = new Intl.DateTimeFormat('en-NZ', {
    timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });

  let today = dayOf(new Date()), selectedDay = today;

  // Use NZ wall time even when the phone is overseas. Build the offset at the event's
  // own instant, so summer and winter timestamps survive later daylight-saving changes.
  function nzParts(date) {
    return Object.fromEntries(nzClock.formatToParts(date).map((p) => [p.type, p.value]));
  }
  function addDays(key, amount) {
    const d = new Date(key + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + amount);
    return d.toISOString().slice(0, 10);
  }
  function dayOf(date) {
    const p = nzParts(date);
    const key = p.year + '-' + p.month + '-' + p.day;
    return Number(p.hour) < 4 ? addDays(key, -1) : key;
  }
  function stamp(date) {
    const p = nzParts(date);
    const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    const offset = Math.round((wall - Math.floor(date.getTime() / 1000) * 1000) / 60000);
    const pad = (n) => String(n).padStart(2, '0');
    return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute + ':' + p.second +
      (offset < 0 ? '-' : '+') + pad(Math.floor(Math.abs(offset) / 60)) + ':' + pad(Math.abs(offset) % 60);
  }
  function dateLabel(key, short = false) {
    return new Intl.DateTimeFormat('en-NZ', { timeZone: 'UTC',
      weekday: short ? 'short' : 'long', day: 'numeric', month: short ? 'short' : 'long',
      ...(short ? {} : { year: 'numeric' }) }).format(new Date(key + 'T12:00:00Z'));
  }

  function notice(text) { $('#notice').textContent = text; $('#notice').hidden = !text; }
  let toastTimer;
  function toast(text, unused, ms) {
    $('#toast').textContent = text;
    $('#toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('#toast').hidden = true; }, ms || 4000);
  }

  function validEntry(e) {
    return e && typeof e.id === 'string' && e.id.length > 0 &&
      typeof e.at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+1[23]:00$/.test(e.at) &&
      Number.isFinite(Date.parse(e.at)) && typeof e.note === 'string' && e.note.length <= 50000;
  }
  function readLocal() {
    try {
      const raw = localStorage.getItem(KEY);
      const list = raw === null ? [] : JSON.parse(raw);
      if (!Array.isArray(list) || !list.every(validEntry) || new Set(list.map((e) => e.id)).size !== list.length) throw new Error('Unreadable log');
      return { ok: true, list: list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)) };
    } catch (_) {
      // Never turn an unreadable log into an empty snapshot or overwrite the original.
      return { ok: false, list: [] };
    }
  }
  function syncLocal() {
    const result = readLocal();
    canSave = result.ok;
    if (result.ok) entries = result.list;
    else notice('Your saved journal could not be read. Saving and sync are paused to protect it.');
    return result.ok;
  }
  function loadDrafts() {
    try {
      const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
        !Object.entries(raw).every(([day, note]) => /^\d{4}-\d{2}-\d{2}$/.test(day) && typeof note === 'string' && note.length <= 50000)) throw new Error('Unreadable drafts');
      drafts = raw;
      return true;
    } catch (_) { notice('Your draft could not be read. Saving is paused to protect it.'); return false; }
  }
  function saveDraft() {
    try {
      if (!loadDrafts()) return false;
      if (noteEl.value) drafts[today] = noteEl.value; else delete drafts[today];
      localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
      return true;
    } catch (_) { notice('This device could not save your draft. Keep this page open to keep your words.'); return false; }
  }
  function sizeNote() {
    noteEl.style.height = 'auto';
    noteEl.style.height = Math.max(160, noteEl.scrollHeight) + 'px';
    sendEl.disabled = saving || !canSave || selectedDay !== today || !noteEl.value.trim();
  }
  function renderDays() {
    const days = [...new Set([today, ...entries.map((e) => dayOf(new Date(e.at))), ...Object.keys(drafts)])].sort().reverse();
    $('#days').replaceChildren(...days.map((day) => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'day-button';
      button.textContent = day === today ? 'Today' : dateLabel(day, true);
      if (day === selectedDay) button.setAttribute('aria-current', 'date');
      if (day === today) {
        const small = document.createElement('small'); small.textContent = dateLabel(day, true); button.append(small);
      }
      button.addEventListener('click', () => {
        selectedDay = day; render(); closeHistory();
        $('#date-title').focus({ preventScroll: true });
      });
      return button;
    }));
  }
  function render() {
    const isToday = selectedDay === today;
    $('#date-title').textContent = dateLabel(selectedDay);
    $('#date-title').tabIndex = -1;
    $('#day-label').textContent = isToday ? 'Today' : 'Previous day';
    document.title = (isToday ? 'Today' : dateLabel(selectedDay, true)) + ' · Journal';
    $('#entries').replaceChildren(...entries.filter((e) => dayOf(new Date(e.at)) === selectedDay).map((e) => {
      const item = document.createElement('li'); item.className = 'entry';
      const time = document.createElement('time'); time.dateTime = e.at;
      time.textContent = e.at.slice(11, 16);
      const text = document.createElement('p'); text.className = 'entry-note'; text.textContent = e.note;
      item.append(time, text); return item;
    }));
    form.hidden = !isToday;
    noteEl.disabled = !isToday || !canSave || saving;
    $('#past-note').hidden = isToday;
    $('#old-draft').hidden = isToday || !drafts[selectedDay];
    $('#old-draft-text').textContent = !isToday ? drafts[selectedDay] || '' : '';
    renderDays(); sizeNote();
  }
  function closeHistory() { historyEl.close(); $('#open-history').setAttribute('aria-expanded', 'false'); }
  $('#open-history').addEventListener('click', () => {
    renderDays(); historyEl.showModal(); $('#open-history').setAttribute('aria-expanded', 'true');
  });
  $('#close-history').addEventListener('click', closeHistory);
  historyEl.addEventListener('close', () => $('#open-history').setAttribute('aria-expanded', 'false'));
  historyEl.addEventListener('click', (event) => {
    if (event.target === historyEl && event.clientX > historyEl.getBoundingClientRect().right) closeHistory();
  });

  // Keep a draft under the day it was written, but never submit it automatically.
  // After 4 am the new page is blank; an old unfinished draft is visible read-only in history.
  function rollDay() {
    const nextDay = dayOf(new Date());
    if (nextDay === today) return false;
    if (!saveDraft()) return false;
    const wasToday = selectedDay === today;
    today = nextDay;
    if (wasToday) selectedDay = today;
    noteEl.value = drafts[today] || '';
    render(); return true;
  }
  noteEl.addEventListener('input', () => { saveDraft(); sizeNote(); });
  noteEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving || !canSave || selectedDay !== today || !noteEl.value.trim()) return;
    if (dayOf(new Date()) !== today) {
      if (rollDay()) toast('A new day has started. Your unfinished draft is saved under the previous day.');
      return;
    }
    if (!loadDrafts()) return;
    const text = noteEl.value;
    if (text.length > 50000) { toast('Keep each entry to 50,000 characters.'); return; }
    const now = new Date();
    const entry = { id: 'journal_' + crypto.randomUUID(), at: stamp(now), note: text };
    saving = true; sizeNote(); noteEl.disabled = true;
    const append = () => {
      if (!syncLocal()) throw new Error('Unreadable log');
      localStorage.setItem(KEY, JSON.stringify(entries.concat(entry)));
      entries.push(entry);
      // The copied sync block must not clear a newer change when an older request finishes.
      if (sending) sendAgain = true;
      changed();
    };
    try {
      // Serialize read/append/write across tabs in Chrome to avoid losing simultaneous entries.
      if (navigator.locks) await navigator.locks.request(KEY + '.append', append); else append();
      noteEl.value = '';
      if (saveDraft()) notice('');
      $('#live').textContent = 'Entry saved at ' + entry.at.slice(11, 16) + '.';
    } catch (_) { notice('Your entry was not saved. Your words are still here; try again when storage is available.'); }
    saving = false; render();
  });

  // ---------- sending the log to the Tracking log sheet ----------
  // Off until the setup link (…/#log=<web app address>&key=<key>) has been opened in any tracker on this site.
  // Every change sends the whole log, so edits and deletes reach the sheet too. A send that
  // fails (no signal) is repeated when the app is next opened or comes back online.
  const LINK = 'tracking-log.link.v1';   // one setting for every tracker on this site
  const UNSENT = KEY + '.unsent';
  const SENT_ONCE = KEY + '.sent-once';  // until the first send, the whole existing log still needs to go
  const SOURCE = 'journal_app';
  const okUrl = (u) => /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(u) ||
    /^http:\/\/(localhost|127\.0\.0\.1):\d+\/[\w/-]*$/.test(u);

  function link() {
    try {
      const v = JSON.parse(localStorage.getItem(LINK) || 'null');
      if (v && typeof v.url === 'string' && okUrl(v.url) && typeof v.key === 'string' && v.key) return v;
    } catch (_) {}
    return null;
  }
  const unsent = () => { try { return localStorage.getItem(UNSENT) === '1'; } catch (_) { return false; } };
  const setUnsent = (on) => { try { if (on) localStorage.setItem(UNSENT, '1'); else localStorage.removeItem(UNSENT); } catch (_) {} };

  const SHEET_LABELS = { sent: 'synced', sending: 'syncing…', waiting: 'not synced yet', paused: 'sync paused', error: 'sync error' };
  let sheetState = '';
  function setSheet(state, note) {
    const was = sheetState;
    sheetState = state;
    const on = !!link() && !!SHEET_LABELS[state];
    syncEl.hidden = false;
    syncEl.textContent = on ? SHEET_LABELS[state] : SHEET_LABELS.waiting;
    syncEl.title = note || '';
    syncEl.classList.toggle('warn', state === 'paused' || state === 'error');
    if ((state === 'paused' || state === 'error') && state !== was) toast('Sheet: ' + (note || SHEET_LABELS[state]), null, 6000);
  }

  function callSheet(cfg, body) {
    // A plain-text body keeps this a simple request, which Google's web apps accept from another site.
    return fetch(cfg.url, { method: 'POST', body: JSON.stringify(Object.assign({ key: cfg.key }, body)) })
      .then((res) => res.json());
  }

  let sending = false, sendAgain = false, sendTimer = 0;
  function queueSend(ms) { clearTimeout(sendTimer); sendTimer = setTimeout(sendLog, ms); }

  function changed() {
    setUnsent(true);
    if (link()) { setSheet('waiting'); queueSend(1200); }
  }

  // One row per submitted journal entry. No numeric value or subtype is needed.
  function sheetRows() {
    return entries.map((e) => ({
      id: e.id, time: e.at, what: 'journal', value: '', note: e.note
    }));
  }

  async function sendLog() {
    const cfg = link();
    if (!cfg) { setSheet(''); return; }
    if (sending) { sendAgain = true; return; }
    if (!unsent()) { setSheet('sent'); return; }
    sending = true;
    sendAgain = false;
    setSheet('sending');
    if (!syncLocal()) {
      sending = false;
      setSheet('paused', 'Your saved journal could not be read.');
      return;
    }
    let res = null;
    try { res = await callSheet(cfg, { source: SOURCE, rows: sheetRows() }); } catch (_) {}
    sending = false;
    if (res && res.ok) {
      if (!sendAgain) setUnsent(false);
      try { localStorage.setItem(SENT_ONCE, '1'); } catch (_) {}
      setSheet('sent');
    } else if (res && res.code === 'shrink') {
      setSheet('paused', res.error);
    } else if (res) {
      setSheet('error', res.error || 'it said no');
    } else {
      setSheet('waiting');
    }
    if (sendAgain) queueSend(300);
  }
  const sendIfNeeded = () => { if (link() && unsent()) queueSend(0); };

  // The setup link: saves where to send, checks the sheet answers, then sends what's already here.
  function setupFromLink() {
    const hp = new URLSearchParams(location.hash.slice(1));
    const url = hp.get('log'), key = hp.get('key');
    if (!url && !key) return false;
    history.replaceState(null, '', location.pathname + location.search);
    if (!url || !key || !okUrl(url)) { toast('That setup link doesn’t look right', null, 5000); return true; }
    try { localStorage.setItem(LINK, JSON.stringify({ url, key })); }
    catch (_) { toast('Couldn’t save the sync setting in this browser', null, 5000); return true; }
    setUnsent(true);
    setSheet('sending');
    callSheet({ url, key }, { ping: true }).then((res) => {
      if (res && res.ok) {
        toast('Sync is on: entries now go to the sheet', null, 4000);
        sendIfNeeded();
      } else {
        setSheet('error', (res && res.error) || 'no answer');
      }
    }).catch(() => {
      // Online but no readable answer usually means the web app isn't shared with Anyone.
      if (navigator.onLine) setSheet('error', 'couldn’t reach the sheet: check the web app’s access is set to Anyone');
      else setSheet('waiting');
    });
    return true;
  }
  function startSheet() {
    if (setupFromLink() || !link()) return;
    try { if (localStorage.getItem(SENT_ONCE) !== '1') setUnsent(true); } catch (_) {}
    if (unsent()) queueSend(0); else setSheet('sent');
  }

  function registerWorker() {
    if (!('serviceWorker' in navigator)) return;
    let reloading = false;
    const hadWorker = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadWorker || reloading || saving || !saveDraft()) return;
      reloading = true; location.reload();
    });
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  function boot() {
    const draftsOK = loadDrafts();
    syncLocal();
    if (!draftsOK) canSave = false;
    try { localStorage.setItem(KEY + '.probe', '1'); localStorage.removeItem(KEY + '.probe'); }
    catch (_) { canSave = false; notice('This browser cannot save entries. Your journal needs local storage.'); }
    noteEl.value = drafts[today] || '';
    render(); registerWorker();
    if (canSave) startSheet();
    $('#sheet-sync').addEventListener('click', () => {
      if (!link()) toast('Open the same setup link used by your other trackers in this browser.');
      else if (!canSave) toast('Sync is paused until your saved journal can be read.');
      else { setUnsent(true); queueSend(0); }
    });
    window.addEventListener('hashchange', () => { if (canSave) setupFromLink(); });
    window.addEventListener('online', () => { if (canSave) sendIfNeeded(); });
    window.addEventListener('storage', (event) => {
      if (event.key === KEY || event.key === null) {
        if (syncLocal()) {
          if (sending) sendAgain = true;
          changed(); render();
        } else { setSheet('paused', 'Your saved journal could not be read.'); render(); }
      }
      if (event.key === LINK && canSave) startSheet();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (syncLocal()) { rollDay(); render(); sendIfNeeded(); }
    });
    setInterval(() => { if (!saving) rollDay(); }, 1000);
  }
  boot();
})();
