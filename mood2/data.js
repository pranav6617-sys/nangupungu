/* Mood data contract. Kept apart from the screens so storage, sync and export can be checked without a browser or Google. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoodData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const KEY = 'mood.v2', LINK = 'tracking-log.link.v1', ACK = KEY + '.receipt';
  // A source name of its own: the sheet replaces a source's rows on every send, so reusing mood_app would try to
  // delete the v1 check-ins.
  const SOURCE = 'mood_app_v2', ZONE = 'Pacific/Auckland';
  // The sheet's script keeps the first 500 characters of a note. The note column holds JSON ({doing, started_at}),
  // so the whole JSON must fit in 500 or it arrives broken. The note box stops at MAX_NOTE; fitDoing then trims
  // the rare note whose quotes and line breaks make the JSON longer than that.
  const MAX_NOTE = 400, SHEET_NOTE = 500;

  const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

  // x is pleasantness (1 left to 10 right), y is energy (1 bottom to 10 top): the cell tapped on the first screen.
  const quadrantOf = (x, y) => `${y >= 6 ? 'high' : 'low'}_${x >= 6 ? 'pleasant' : 'unpleasant'}`;
  // The 1–10 cell folded onto the 1–5 scale v1 used, so v1 and v2 share one mood and one energy series.
  const scaleOf = n => Math.ceil(n / 2);

  // ---------- time: always NZ wall-clock time with its offset, as the other trackers send ----------
  const nzClock = new Intl.DateTimeFormat('en-NZ', { timeZone: ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  function stamp(date) {
    const p = Object.fromEntries(nzClock.formatToParts(date).map(p => [p.type, p.value]));
    const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    const offset = Math.round((wall - Math.floor(date.getTime() / 1000) * 1000) / 60000);
    const pad = n => String(n).padStart(2, '0');
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  }
  const validStamp = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+1[23]:00$/.test(v) && Number.isFinite(Date.parse(v));

  // ---------- check-ins ----------
  // A check-in as kept on the phone: the tap on screen one (x, y), the three blobs on screen two (1 to 5, 3 is normal)
  // and the note. There is no word, no tag and no backdating: the time is the moment it was saved.
  function noteJson(e) { return JSON.stringify({ doing: e.doing, started_at: e.started_at }); }
  function validEntry(e) {
    return !!e && e.schema_version === 2 && typeof e.id === 'string' && /^mood_[\w-]+$/.test(e.id) &&
      validStamp(e.at) && validStamp(e.started_at) &&
      isInt(e.x, 1, 10) && isInt(e.y, 1, 10) && isInt(e.tension, 1, 5) && isInt(e.focus, 1, 5) && isInt(e.speed, 1, 5) &&
      typeof e.doing === 'string' && noteJson(e).length <= SHEET_NOTE;
  }
  // The note as it will be stored: line endings made plain, ends trimmed, at most MAX_NOTE characters, and short
  // enough that its JSON fits the sheet's 500. `trimmed` says whether anything was cut.
  function fitDoing(text, startedAt) {
    const whole = Array.from(String(text == null ? '' : text).replace(/\r\n?/g, '\n').trim());
    const chars = whole.slice(0, MAX_NOTE);
    while (chars.length && JSON.stringify({ doing: chars.join(''), started_at: startedAt }).length > SHEET_NOTE) chars.pop();
    const doing = chars.join('').trimEnd();
    return { doing, trimmed: Array.from(doing).length < whole.length };
  }
  function makeEntry(input, now, uuid) {
    const startedAt = validStamp(input.started_at) ? input.started_at : stamp(now);
    const fit = fitDoing(input.doing, startedAt);
    return { trimmed: fit.trimmed, entry: { schema_version: 2, id: 'mood_' + uuid(), at: stamp(now), started_at: startedAt,
      x: input.x, y: input.y, tension: input.tension, focus: input.focus, speed: input.speed, doing: fit.doing } };
  }
  function sheetRows(entries) {
    return entries.map(e => ({ id: e.id, time: e.at, what: 'mood',
      value: JSON.stringify({ schema_version: 2, quadrant: quadrantOf(e.x, e.y), x: e.x, y: e.y,
        mood: scaleOf(e.x), energy: scaleOf(e.y), tension: e.tension, focus: e.focus, speed: e.speed }),
      note: noteJson(e)
    }));
  }

  // ---------- export ----------
  const CSV_COLUMNS = ['id', 'time', 'started_at', 'quadrant', 'x', 'y', 'mood', 'energy', 'tension', 'focus', 'speed', 'note'];
  const csvCell = v => { const s = String(v == null ? '' : v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function toCsv(entries) {
    const rows = entries.map(e => [e.id, e.at, e.started_at, quadrantOf(e.x, e.y), e.x, e.y, scaleOf(e.x), scaleOf(e.y), e.tension, e.focus, e.speed, e.doing]);
    return [CSV_COLUMNS, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
  function toJson(entries, now = new Date()) {
    return JSON.stringify({ app: 'mood', schema_version: 2, exported_at: stamp(now), count: entries.length, entries }, null, 2) + '\n';
  }
  const exportName = (ext, now = new Date()) => `mood-${stamp(now).slice(0, 10)}.${ext}`;

  // ---------- the setup link and the log ----------
  const okUrl = u => /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(u) ||
    /^http:\/\/(localhost|127\.0\.0\.1):\d+\/[\w/-]*$/.test(u);
  function readLink(storage) {
    try {
      const cfg = JSON.parse(storage.getItem(LINK) || 'null');
      return cfg && typeof cfg.url === 'string' && okUrl(cfg.url) && typeof cfg.key === 'string' && cfg.key ? cfg : null;
    } catch (_) { return null; }
  }
  function readLog(storage) {
    const raw = storage.getItem(KEY);
    if (raw === null) return { version: 2, revision: 'empty', entries: [] };
    const log = JSON.parse(raw);
    if (!log || log.version !== 2 || typeof log.revision !== 'string' || !log.revision ||
      !Array.isArray(log.entries) || !log.entries.every(validEntry) ||
      new Set(log.entries.map(e => e.id)).size !== log.entries.length) throw new Error('Your saved check-ins could not be read. Saving and sync are paused to protect them.');
    return log;
  }

  // ---------- the log and its copy in the sheet ----------
  // Same contract as the other trackers: every change sends the whole log as {key, source, rows}, and the
  // sheet mirrors it. The script refuses a send that would remove more than 5 rows (code "shrink").
  function createStore({ storage, fetcher, uuid, locks, onStatus = () => {}, schedule = setTimeout, cancel = clearTimeout }) {
    let timer, sending = false, busy = false, lastState = 'local', blocked = false, retries = 0;
    function status(state, detail = '') { lastState = state; onStatus(state, detail); }
    function read() {
      try { const log = readLog(storage); blocked = false; return log; }
      catch (_) { blocked = true; status('paused', 'Your saved check-ins could not be read. Saving and sync are paused to protect them.'); throw new Error('Unreadable check-ins'); }
    }
    function receipt() { try { return JSON.parse(storage.getItem(ACK) || 'null'); } catch (_) { return null; } }
    function queue(ms = 900) { cancel(timer); timer = schedule(() => { sync(); }, ms); }
    function count() { try { return read().entries.length; } catch (_) { return null; } }
    function entries() { try { return read().entries; } catch (_) { return []; } }

    // One change at a time, across tabs too. `change` gets the current entries and returns the new list.
    async function write(change) {
      if (busy) return null;
      busy = true;
      try {
        let result;
        const run = () => {
          const next = change(read().entries);
          storage.setItem(KEY, JSON.stringify({ version: 2, revision: uuid(), entries: next.entries }));
          result = next.result;
        };
        if (locks) await locks.request(KEY + '.write', run); else run();
        retries = 0;
        if (readLink(storage)) { status('waiting'); queue(); } else status('local');
        return result;
      } finally { busy = false; }
    }
    const unfit = 'That check-in can’t be saved: its answers are out of range.';

    // input: { x, y, tension, focus, speed, doing, started_at }. Resolves to { entry, trimmed }, or rejects with a sentence fit to show.
    function append(input, now = new Date()) {
      const made = makeEntry(input, now, uuid);
      if (!validEntry(made.entry)) return Promise.reject(new Error(unfit));
      return write(list => ({ entries: list.concat(made.entry), result: made }))
        .then(result => { if (!result) throw new Error('Still saving the last check-in. Try again in a moment.'); return result; });
    }

    async function post(cfg, body) {
      const controller = new AbortController();
      const timeout = schedule(() => controller.abort(), 20000);
      try {
        // A plain-text body keeps this a simple request, which Google's web apps accept from another site.
        const response = await fetcher(cfg.url, { method: 'POST', signal: controller.signal,
          body: JSON.stringify({ key: cfg.key, ...body }) });
        if (response.ok === false) throw new Error('Sheet request failed');
        return await response.json();
      } finally { cancel(timeout); }
    }
    async function sync(force = false) {
      if (sending) { queue(1200); return; }
      sending = true;
      cancel(timer);
      const run = async () => {
        const cfg = readLink(storage);
        if (!cfg) { status('local'); return; }
        let snapshot;
        try { snapshot = read(); } catch (_) { return; }
        const previous = receipt();
        // An empty log is never sent: the script refuses it, and a new or cleared browser must not empty the sheet.
        if (!snapshot.entries.length) { status('ready'); return; }
        if (!force && previous && previous.revision === snapshot.revision && previous.url === cfg.url) { status('sent'); return; }
        status('sending');
        let result;
        try { result = await post(cfg, { source: SOURCE, rows: sheetRows(snapshot.entries) }); }
        catch (_) { status('waiting', 'Saved on this phone. The sheet will be tried again.'); if (++retries <= 3) queue(30000 * retries); return; }
        if (JSON.stringify(readLink(storage)) !== JSON.stringify(cfg)) { status('waiting'); queue(0); return; }
        if (result && result.ok === true) {
          try { storage.setItem(ACK, JSON.stringify({ revision: snapshot.revision, url: cfg.url, rows: snapshot.entries.length })); } catch (_) { status('waiting'); return; }
          retries = 0;
          let latest;
          try { latest = read(); } catch (_) { return; }
          if (latest.revision !== snapshot.revision) { status('waiting'); queue(300); }
          else status('sent');
        } else if (result && result.code === 'shrink') status('paused', result.error || 'The sheet paused this sync to protect existing check-ins.');
        else status('error', result && result.error || 'The sheet did not accept the check-ins. Your copy is saved here.');
      };
      try { if (locks) await locks.request(KEY + '.sync', run); else await run(); }
      finally { sending = false; }
    }
    async function setup(url, key) {
      if (!okUrl(url) || typeof key !== 'string' || !key) throw new Error('That setup link does not look right.');
      read();
      storage.setItem(LINK, JSON.stringify({ url, key }));
      storage.removeItem(ACK);
      status('sending');
      try {
        const res = await post({ url, key }, { ping: true });
        if (!res || res.ok !== true) { status('error', res && res.error || 'The sheet did not answer.'); return false; }
      } catch (_) { status('waiting', 'Connection saved. The sheet will be tried again when you are online.'); return false; }
      queue(0); return true;
    }
    function start() {
      try {
        read(); storage.setItem(KEY + '.probe', '1'); storage.removeItem(KEY + '.probe');
        if (readLink(storage)) queue(0); else status('local');
        return true;
      } catch (_) { blocked = true; status('paused', 'This browser cannot read or save check-ins. Keep this page open and try again when storage is available.'); return false; }
    }
    function externalChange(key) {
      if (key === LINK || key === null) { try { storage.removeItem(ACK); } catch (_) {} }
      if (key === KEY || key === LINK || key === null) { try { read(); queue(0); } catch (_) {} }
    }
    return { read, count, entries, append, sync, setup, start, externalChange, queue,
      get linked() { return !!readLink(storage); }, get blocked() { return blocked; },
      get state() { return lastState; }, destroy() { cancel(timer); } };
  }

  return { KEY, LINK, ACK, SOURCE, ZONE, MAX_NOTE, SHEET_NOTE, CSV_COLUMNS, quadrantOf, scaleOf, stamp, validStamp,
    validEntry, fitDoing, makeEntry, sheetRows, toCsv, toJson, exportName, readLog, readLink, createStore };
});
