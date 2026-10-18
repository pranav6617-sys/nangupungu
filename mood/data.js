/* The data contract is independent of the UI so storage and sync can be checked without Google. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoodData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const KEY = 'mood.v1', LINK = 'tracking-log.link.v1', ACK = KEY + '.receipt';
  const SOURCE = 'mood_app', ZONE = 'Pacific/Auckland';
  const RATINGS = [
    { id: 'mood', title: 'Mood', labels: ['Very unpleasant', 'Unpleasant', 'Neutral', 'Pleasant', 'Very pleasant'], color: '#ff8b7c' },
    { id: 'energy', title: 'Energy', labels: ['Depleted', 'Low', 'Moderate', 'Energised', 'Highly energised'], color: '#f3c85b' },
    { id: 'tension', title: 'Tension', labels: ['Relaxed', 'A little tense', 'Tense', 'Very tense', 'Wound up'], color: '#65d2ba' },
    { id: 'irritability', title: 'Irritability', labels: ['Unbothered', 'A little touchy', 'Touchy', 'Very touchy', 'Extremely touchy'], color: '#b59aff' },
    { id: 'thought_speed', title: 'Thought speed', labels: ['Slowed', 'A little slow', 'Usual', 'Fast', 'Racing'], color: '#73b8ff' }
  ];
  const QUADRANTS = [
    { id: 'high-unpleasant', label: 'Higher energy · unpleasant', className: 'q-coral', x: 196, y: 196, words: ['Overwhelmed', 'Anxious', 'Frustrated', 'Angry', 'Tense', 'Restless', 'Irritated', 'Panicky'] },
    { id: 'high-pleasant', label: 'Higher energy · pleasant', className: 'q-peach', x: 588, y: 196, words: ['Excited', 'Energised', 'Joyful', 'Enthusiastic', 'Inspired', 'Playful', 'Curious', 'Hopeful'] },
    { id: 'low-unpleasant', label: 'Lower energy · unpleasant', className: 'q-lilac', x: 196, y: 588, words: ['Sad', 'Lonely', 'Disappointed', 'Discouraged', 'Bored', 'Drained', 'Numb', 'Flat'] },
    { id: 'low-pleasant', label: 'Lower energy · pleasant', className: 'q-mint', x: 588, y: 588, words: ['Calm', 'Content', 'Relaxed', 'Peaceful', 'Comfortable', 'Grateful', 'Connected', 'At ease'] }
  ];
  const WORDS = QUADRANTS.flatMap(q => q.words);
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
  const complete = r => r && RATINGS.every(({ id }) => Number.isInteger(r[id]) && r[id] >= 1 && r[id] <= 5);
  function validEntry(e) {
    return !!e && typeof e.id === 'string' && /^mood_[\w-]+$/.test(e.id) && e.schema_version === 1 &&
      validStamp(e.at) && validStamp(e.started_at) && Date.parse(e.at) >= Date.parse(e.started_at) &&
      complete(e.ratings) && Array.isArray(e.feelings) && e.feelings.every(w => WORDS.includes(w)) &&
      new Set(e.feelings).size === e.feelings.length && typeof e.doing === 'string' &&
      e.doing.length <= 2000 && typeof e.company === 'string' && e.company.length <= 2000;
  }
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
    if (raw === null) return { version: 1, revision: 'empty', entries: [] };
    const log = JSON.parse(raw);
    if (!log || log.version !== 1 || typeof log.revision !== 'string' || !log.revision ||
      !Array.isArray(log.entries) || !log.entries.every(validEntry) ||
      new Set(log.entries.map(e => e.id)).size !== log.entries.length) throw new Error('Your saved check-ins could not be read. Saving and sync are paused to protect them.');
    return log;
  }
  function sheetRows(entries) {
    return entries.map(e => ({ id: e.id, time: e.at, what: 'mood',
      value: JSON.stringify({ schema_version: 1, scale: '1–5', ...e.ratings, feelings: e.feelings }),
      note: JSON.stringify({ doing: e.doing, company: e.company, started_at: e.started_at })
    }));
  }
  function mapPoint(ratings) {
    // The first two answers only suggest a place to start; nothing is selected or excluded.
    return { x: 105 + ((ratings.mood - 1) / 4) * 574, y: 105 + ((5 - ratings.energy) / 4) * 574 };
  }
  function startingQuadrant(ratings) {
    // Midpoints lean toward pleasant/high only to break the tie; every area stays one tap away.
    return `${ratings.energy >= 3 ? 'high' : 'low'}-${ratings.mood >= 3 ? 'pleasant' : 'unpleasant'}`;
  }
  function createStore({ storage, fetcher, uuid, locks, onStatus = () => {}, schedule = setTimeout, cancel = clearTimeout }) {
    let timer, sending = false, busySave = false, lastState = 'local', blocked = false, retries = 0;
    function status(state, detail = '') { lastState = state; onStatus(state, detail); }
    function read() {
      try { const log = readLog(storage); blocked = false; return log; }
      catch (_) { blocked = true; status('paused', 'Your saved check-ins could not be read. Saving and sync are paused to protect them.'); throw new Error('Unreadable check-ins'); }
    }
    function receipt() { try { return JSON.parse(storage.getItem(ACK) || 'null'); } catch (_) { return null; } }
    function queue(ms = 900) { cancel(timer); timer = schedule(() => { sync(); }, ms); }
    async function append(input, now = new Date()) {
      if (busySave) return null;
      busySave = true;
      try {
        const entry = { schema_version: 1, id: 'mood_' + uuid(), at: stamp(now),
          started_at: input.started_at || stamp(now), ratings: Object.fromEntries(RATINGS.map(r => [r.id, input.ratings[r.id]])),
          feelings: [...input.feelings], doing: input.doing, company: input.company };
        if (!validEntry(entry)) throw new Error('Please check all five ratings and keep each context field under 2,000 characters.');
        const write = () => {
          const log = read();
          storage.setItem(KEY, JSON.stringify({ version: 1, revision: uuid(), entries: log.entries.concat(entry) }));
        };
        if (locks) await locks.request(KEY + '.append', write); else write();
        retries = 0;
        if (readLink(storage)) { status('waiting'); queue(); } else status('local');
        return entry;
      } finally { busySave = false; }
    }
    async function post(cfg, body) {
      const controller = new AbortController();
      const timeout = schedule(() => controller.abort(), 20000);
      try {
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
        // Never send a new browser's empty snapshot to an existing source.
        if (!snapshot.entries.length) { status('ready'); return; }
        const previous = receipt();
        if (!force && previous && previous.revision === snapshot.revision && previous.url === cfg.url) { status('sent'); return; }
        status('sending');
        let result;
        try { result = await post(cfg, { source: SOURCE, rows: sheetRows(snapshot.entries) }); }
        catch (_) { status('waiting', 'Saved on this device. The sheet will be tried again.'); if (++retries <= 3) queue(30000 * retries); return; }
        if (JSON.stringify(readLink(storage)) !== JSON.stringify(cfg)) { status('waiting'); queue(0); return; }
        if (result && result.ok === true) {
          try { storage.setItem(ACK, JSON.stringify({ revision: snapshot.revision, url: cfg.url })); } catch (_) { status('waiting'); return; }
          retries = 0;
          let latest;
          try { latest = read(); } catch (_) { return; }
          if (latest.revision !== snapshot.revision) { status('waiting'); queue(300); }
          else status('sent');
        } else if (result && result.code === 'shrink') status('paused', result.error || 'The sheet paused this sync to protect existing check-ins.');
        else status('error', result && result.error || 'The sheet did not accept the check-in. Your copy is saved here.');
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
    return { read, append, sync, setup, start, externalChange, queue,
      get linked() { return !!readLink(storage); }, get blocked() { return blocked; },
      get state() { return lastState; }, destroy() { cancel(timer); } };
  }
  return { KEY, LINK, ACK, SOURCE, ZONE, RATINGS, QUADRANTS, WORDS, stamp, complete,
    validEntry, readLog, readLink, sheetRows, mapPoint, startingQuadrant, createStore };
});
