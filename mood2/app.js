/* Mood: how the three screens follow one another, saving, the "?" help and the sheet. The screens are in index.html and data.js
   holds the check-in format and the sync, so this file is the only place that knows about both. */
(() => {
  'use strict';
  const D = window.MoodData;
  const $ = s => document.querySelector(s);
  const RETURN_MS = window.MOOD_RETURN_MS || 4000;        // after saving, the first screen comes back this much later
  const STALE_MS = window.MOOD_STALE_MS || 15 * 60000;    // a half-finished check-in is dropped after this long out of sight

  // ---------- storage and the sheet ----------
  let storage;
  try { storage = window.localStorage; storage.getItem(D.KEY); }
  catch (_) {
    // The preview copy shown inside Claude sets MOOD_PREVIEW: it keeps check-ins in memory for the visit and has no sheet.
    // A real browser that cannot store anything must not pretend to: saving is refused and says so.
    if (window.MOOD_PREVIEW) { const m = new Map(); storage = { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); } }; }
    else storage = { getItem() { throw new Error('Storage unavailable'); }, setItem() { throw new Error('Storage unavailable'); }, removeItem() {} };
  }
  const uuid = () => crypto.randomUUID ? crypto.randomUUID()
    : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
  let sheet = { state: 'local', detail: '' }, notice = '';
  const store = D.createStore({ storage, fetcher: (...args) => fetch(...args), uuid, locks: navigator.locks,
    onStatus: (state, detail) => { sheet = { state, detail }; if (helpOpen) renderData(); } });

  // ---------- the three screens ----------
  const one = $('#heart'), two = $('#pad'), three = $('#note');
  const s1 = window.screenOne, s2 = window.screenTwo, s3 = window.screenThree;
  const root = document.documentElement;
  let at = 'one', depth = 0, sel = null, levels = null, startedAt = null, saving = false, savedTimer = 0, savedAt = 0, hiddenAt = 0, helpOpen = false;
  const setAt = v => { at = v; root.dataset.at = v; };
  setAt('one');
  const inProgress = () => at !== 'one' || !!window.moodSelection;

  // The test pages step the screens with their own clock.
  const f1 = window.__f1, f2 = window.__f2, f3 = window.__noteFrame;
  if (f1 && f2 && f3) window.__heartFrame = () => (at === 'one' ? f1() : at === 'two' ? f2() : f3());

  const toTwo = () => { setAt('two'); s1.pause(); s2.show(sel); };
  const toThree = () => { setAt('three'); s2.hide(); s3.show(sel, levels); };
  const backToTwo = () => { setAt('two'); s3.hide(); s2.show(sel); };
  const backToOne = () => { setAt('one'); s2.hide(); s1.resume(); applyUpdate(); };
  function goTo(target) {
    if (at === 'saved' || at === target) return;
    if (target === 'one') { if (at === 'three') backToTwo(); backToOne(); }
    else if (target === 'two') { if (at === 'three') backToTwo(); else if (sel) toTwo(); }
    else if (target === 'three' && at === 'two' && levels) toThree();
  }

  // The phone's back button walks the same steps as the arrows: every step forward is a history entry.
  function push(mood) { try { history.pushState({ mood, d: depth + 1 }, ''); depth++; } catch (_) {} }
  function goBack() {
    if (depth > 0) { try { history.back(); return; } catch (_) {} }
    goTo(at === 'three' ? 'two' : 'one');
  }
  window.addEventListener('popstate', () => {
    const st = history.state || {};
    depth = st.d || 0;
    if (helpOpen) { if (st.mood !== 'help') closeHelp(true); return; }
    goTo(st.mood || 'one');
  });

  one.addEventListener('pointerdown', () => { if (!startedAt && !saving) startedAt = D.stamp(new Date()); }, true);
  one.addEventListener('mood:continue', e => { sel = e.detail; if (!startedAt) startedAt = D.stamp(new Date()); toTwo(); push('two'); });
  two.addEventListener('pad:continue', e => { levels = e.detail; toThree(); push('three'); });
  two.addEventListener('pad:back', goBack);
  three.addEventListener('note:back', goBack);

  // ---------- saving: the note locks, the dots go, and four seconds later the first screen is back ----------
  const failure = e => /Unreadable|could not be read/.test(e.message) ? 'Not saved. Your saved check-ins could not be read.'
    : /Still saving/.test(e.message) ? 'Still saving the last one. Try again.'
    : /out of range/.test(e.message) ? 'Not saved. An answer was out of range.'
    : 'Not saved. This phone could not store it. Try again.';
  three.addEventListener('note:save', async e => {
    if (saving || at !== 'three' || !sel || !levels) return;
    saving = true;
    try {
      const { trimmed } = await store.append({ x: sel.x, y: sel.y, tension: levels.tension, focus: levels.focus, speed: levels.speed,
        doing: e.detail.text, started_at: startedAt });
      setAt('saved'); savedAt = Date.now();
      s3.saved(trimmed ? 'Saved · note cut to fit' : 'Saved');
      savedTimer = setTimeout(fresh, RETURN_MS);
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch (error) { s3.error(failure(error)); }
    finally { saving = false; }
  });
  // A fresh check-in: every screen back to its start, and the history back to the first screen.
  function fresh() {
    clearTimeout(savedTimer); savedTimer = 0;
    setAt('one'); sel = null; levels = null; startedAt = null;
    s3.hide(); s3.reset(); s2.hide(); s2.reset(); s1.reset(); s1.resume();
    if (depth) { const d = depth; depth = 0; try { history.go(-d); } catch (_) {} }
    applyUpdate();
  }

  // ---------- the "?" help ----------
  const HELP = {
    one: ['How you feel right now', [
      'Touch anywhere. Left is unpleasant and right is pleasant. Up is high energy and down is low energy.',
      'Drag to change your mind. The arrow at the bottom goes on. The arrow at the top clears your touch.']],
    two: ['Tension, focus, thinking', [
      'Three blobs, left to right: how tense you are, how well you can focus, and how fast you are thinking.',
      'Drag each one up or down, or flick it one step. Middle is your normal and up is more.',
      'The sentence at the top builds as you go. The arrow lights once all three are placed.']],
    three: ['Your check-in', [
      'This is how you described yourself, in words. The note is optional and keeps up to ' + D.MAX_NOTE + ' characters.',
      'The arrow saves it. Once saved it is locked, and the app returns to the start.']]
  };
  const SHEET = { local: 'Not connected', ready: 'Connected', waiting: 'Waiting to send', sending: 'Sending', sent: 'Up to date', paused: 'Paused', error: 'Error' };
  const qbtn = $('#qbtn'), help = $('#help'), card = $('#helpcard');
  let dataEl = null;
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
  function renderHelp() {
    const [title, lines] = HELP[at] || HELP.one;
    card.replaceChildren(el('h2', title), ...lines.map(t => el('p', t)));
    dataEl = null;
    if (at === 'one') { dataEl = el('div', null, 'helpdata'); card.append(el('div', null, 'helprule'), dataEl); renderData(); }
  }
  function renderData() {
    if (!dataEl) return;
    const n = store.count(), kids = [];
    if (notice) kids.push(el('p', notice, 'helpnote'));
    const row = (k, v) => { const r = el('div', null, 'helprow'); r.append(el('span', k), el('span', v)); return r; };
    kids.push(row('Check-ins on this phone', n == null ? 'Unreadable' : String(n)), row('Sheet', SHEET[sheet.state] || sheet.state));
    if (sheet.state === 'local') kids.push(el('p', 'Check-ins stay on this phone. Open your setup link on this app to connect the sheet.'));
    else if (sheet.detail && (sheet.state === 'paused' || sheet.state === 'error' || sheet.state === 'waiting')) kids.push(el('p', sheet.detail));
    const btns = el('div', null, 'helpbtns');
    const add = (label, kind) => { const b = el('button', label, 'helpbtn'); b.type = 'button'; b.dataset.kind = kind; if (kind !== 'sync' && !n) b.disabled = true; btns.append(b); };
    add('Export CSV', 'csv'); add('Export JSON', 'json');
    if (store.linked && !store.blocked) add('Send to sheet now', 'sync');
    kids.push(btns);
    dataEl.replaceChildren(...kids);
  }
  function download(name, type, text) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  card.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.helpbtn'); if (!b || b.disabled) return;
    const list = store.entries(), now = new Date(), kind = b.dataset.kind, old = b.textContent;
    if (kind === 'sync') store.sync(true);
    else if (kind === 'csv') download(D.exportName('csv', now), 'text/csv;charset=utf-8', D.toCsv(list));
    else download(D.exportName('json', now), 'application/json', D.toJson(list, now));
    if (kind !== 'sync') { b.textContent = 'Exported'; setTimeout(() => { if (b.isConnected) b.textContent = old; }, 1800); }
  });
  function openHelp() {
    if (helpOpen || at === 'saved') return;
    helpOpen = true; renderHelp();
    help.hidden = false; help.classList.add('open');
    qbtn.setAttribute('aria-expanded', 'true'); qbtn.setAttribute('aria-label', 'Close help');
    document.querySelectorAll('.heart').forEach(h => { h.inert = true; });
    push('help'); card.scrollTop = 0; card.focus({ preventScroll: true });
  }
  function closeHelp(fromPop) {
    if (!helpOpen) return;
    helpOpen = false; notice = '';
    help.classList.remove('open'); help.hidden = true;
    qbtn.setAttribute('aria-expanded', 'false'); qbtn.setAttribute('aria-label', 'Help');
    document.querySelectorAll('.heart').forEach(h => { h.inert = false; });
    if (!fromPop && history.state && history.state.mood === 'help') { try { history.back(); depth = Math.max(0, depth - 1); } catch (_) {} }
    applyUpdate();
  }
  qbtn.addEventListener('click', () => (helpOpen ? closeHelp() : openHelp()));
  help.addEventListener('click', e => { if (e.target === help) closeHelp(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && helpOpen) { e.preventDefault(); closeHelp(); } });

  // ---------- the setup link: …/mood2/#log=<web app address>&key=<key>, the same one the other trackers use ----------
  async function setupFromHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    if (!params.has('log') && !params.has('key')) return;
    const url = params.get('log'), key = params.get('key');
    try { history.replaceState(history.state, '', location.pathname + location.search); } catch (_) {}
    try { notice = (await store.setup(url, key)) ? 'Sheet connected.' : 'The sheet did not answer yet. It will be tried again.'; }
    catch (error) { notice = error.message; }
    if (at === 'one' && !helpOpen) openHelp(); else if (helpOpen) renderData();
  }

  // ---------- updates: a new version waits until the first screen is showing with nothing open ----------
  let registration = null, reloading = false;
  function applyUpdate() {
    if (!registration || !registration.waiting || at !== 'one' || window.moodSelection || saving || helpOpen) return;
    registration.waiting.postMessage('skipWaiting');
  }

  // ---------- start ----------
  function boot() {
    // Reloaded part-way through a check-in: the history still has the steps, the screens do not. Go back to the start.
    if (history.state && history.state.d) { try { history.go(-history.state.d); } catch (_) {} }
    else { try { history.replaceState({ mood: 'one', d: 0 }, ''); } catch (_) {} }
    store.start();
    setupFromHash(); window.addEventListener('hashchange', setupFromHash);
    window.addEventListener('online', () => store.queue(0));
    window.addEventListener('pageshow', e => { if (e.persisted) store.queue(0); });
    window.addEventListener('storage', e => { store.externalChange(e.key); if (helpOpen) renderData(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      store.queue(0);
      if (at === 'saved') { if (Date.now() - savedAt >= RETURN_MS) fresh(); }
      else if (inProgress() && hiddenAt && Date.now() - hiddenAt > STALE_MS) { if (helpOpen) closeHelp(); fresh(); }
      if (registration) registration.update().catch(() => {});
      applyUpdate();
    });
    if ('serviceWorker' in navigator && !window.MOOD_NO_SW) {
      const hadWorker = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register('sw.js', { scope: './' }).then(reg => {
        registration = reg;
        reg.addEventListener('updatefound', () => {
          const next = reg.installing;
          if (next) next.addEventListener('statechange', () => { if (next.state === 'installed') applyUpdate(); });
        });
        applyUpdate();
      }).catch(() => {});
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadWorker && !reloading) { reloading = true; location.reload(); } });
    }
  }
  window.moodFlow = { at: () => at, depth: () => depth, help: () => helpOpen };
  boot();
})();
