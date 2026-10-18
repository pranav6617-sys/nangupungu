(() => {
  'use strict';
  const D = window.MoodData, $ = selector => document.querySelector(selector);
  const pages = [$('#page-1'), $('#page-2'), $('#page-3')];
  const next = $('#next-1'), submit = $('#submit'), viewport = $('#map-viewport');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const ratingEls = new Map(), wordEls = new Map();
  let ratings = {}, feelings = new Set(), startedAt = null, page = 1, saving = false;
  let mapVisited = false, toastTimer, savedTimer, motion = !reduced.matches, lastStatus = '';
  let storage;
  try { storage = window.localStorage; }
  catch (_) { storage = { getItem() { throw new Error('Storage unavailable'); }, setItem() { throw new Error('Storage unavailable'); }, removeItem() {} }; }
  const store = D.createStore({ storage, fetcher: (...args) => fetch(...args),
    uuid: () => crypto.randomUUID(), locks: navigator.locks, onStatus: showStatus });
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function flower() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#flower'); svg.append(use); return svg;
  }
  function toast(message, duration = 4300) {
    clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false;
    toastTimer = setTimeout(() => { $('#toast').hidden = true; }, duration);
  }
  function notice(message) { $('#notice').textContent = message; $('#notice').hidden = !message; }
  function showStatus(state, detail) {
    const labels = { local: 'On this device', ready: 'Sheet ready', sent: 'Synced to sheet',
      sending: 'Syncing…', waiting: 'Saved here · pending', paused: 'Sync paused', error: 'Sync needs a look' };
    $('#sheet-sync').dataset.state = state;
    $('#sync-label').textContent = labels[state] || labels.local;
    $('#sheet-sync').title = detail || labels[state];
    if ((state === 'error' || state === 'paused') && detail && lastStatus !== state) toast(detail, 7000);
    lastStatus = state;
  }
  function buildRatings() {
    D.RATINGS.forEach(def => {
      const field = el('fieldset', 'rating');
      field.style.setProperty('--accent', def.color); field.style.setProperty('--tint', def.tint);
      const legend = el('legend', 'sr-only', def.title);
      const top = el('div', 'rating-top');
      const title = el('span', 'rating-title', def.title), value = el('span', 'rating-value', 'Choose');
      value.id = def.id + '-value'; value.setAttribute('aria-live', 'polite');
      top.append(title, value);
      const track = el('div', 'rating-track'), rail = el('div', 'track-rail'), fill = el('div', 'track-fill');
      rail.setAttribute('aria-hidden', 'true'); rail.append(fill);
      const options = el('div', 'rating-options'), inputs = [];
      def.labels.forEach((label, i) => {
        const wrap = el('label', 'rating-option'), input = el('input');
        input.type = 'radio'; input.name = def.id; input.value = String(i + 1);
        input.setAttribute('aria-label', def.title + ': ' + label);
        input.addEventListener('change', () => setRating(def, i + 1));
        const tick = el('span', 'tick'); tick.setAttribute('aria-hidden', 'true');
        wrap.append(input, tick); options.append(wrap); inputs.push(input);
      });
      const thumb = el('div', 'slider-thumb'); thumb.append(flower());
      track.append(rail, options, thumb);
      const ends = el('div', 'rating-ends'); ends.setAttribute('aria-hidden', 'true');
      ends.append(el('span', '', def.labels[0]), el('span', '', def.labels[4]));
      field.append(legend, top, track, ends); $('#ratings').append(field);
      ratingEls.set(def.id, { field, value, inputs });
      let pointer = null;
      const atPointer = event => {
        const rect = track.getBoundingClientRect();
        const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left - 22) / Math.max(1, rect.width - 44)));
        setRating(def, 1 + Math.round(fraction * 4));
      };
      track.addEventListener('pointerdown', event => {
        if (event.button !== 0 || saving) return;
        pointer = event.pointerId; field.classList.add('dragging');
        track.setPointerCapture(pointer); atPointer(event);
      });
      track.addEventListener('pointermove', event => { if (event.pointerId === pointer) atPointer(event); });
      const release = () => { pointer = null; field.classList.remove('dragging'); };
      track.addEventListener('pointerup', release); track.addEventListener('pointercancel', release);
      track.addEventListener('lostpointercapture', release);
    });
  }
  function setRating(def, value) {
    if (saving) return;
    if (!startedAt) startedAt = D.stamp(new Date());
    ratings[def.id] = value;
    const ui = ratingEls.get(def.id);
    ui.field.classList.add('is-set'); ui.field.style.setProperty('--fraction', (value - 1) / 4);
    ui.field.style.setProperty('--position', ((value - 1) / 4 * 100) + '%');
    ui.value.textContent = def.labels[value - 1]; ui.inputs.forEach((input, i) => { input.checked = i === value - 1; });
    const count = Object.keys(ratings).length;
    next.disabled = !D.complete(ratings) || store.blocked;
    $('#rating-count').textContent = count === 5 ? 'All five. That’s your starting point.' : `${count} of 5 · a little more of the picture`;
    // Revisiting the ratings should reposition the map on the next visit, but retain selected words.
    if (def.id === 'mood' || def.id === 'energy') mapVisited = false;
  }
  function buildMap() {
    D.QUADRANTS.forEach(q => {
      const section = el('section', 'quadrant ' + q.className); section.setAttribute('aria-label', q.label);
      const title = el('h2', '', q.label), grid = el('div', 'bubble-grid');
      q.words.forEach(word => {
        const button = el('button', 'word-bubble', word);
        button.type = 'button'; button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => toggleWord(word));
        wordEls.set(word, button); grid.append(button);
      });
      section.append(title, grid); $('#feeling-map').append(section);
    });
    document.querySelectorAll('[data-quadrant]').forEach(button => {
      button.addEventListener('click', () => {
        const q = D.QUADRANTS.find(q => q.id === button.dataset.quadrant); centerMap(q, true);
      });
    });
    // Touch uses native momentum scrolling. Mouse dragging also works when a drag starts on a word.
    let drag = null, suppressClick = false;
    viewport.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      drag = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop, id: event.pointerId, moved: false };
      suppressClick = false;
    });
    viewport.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) <= 6) return;
      if (!drag.moved) { drag.moved = true; viewport.setPointerCapture(event.pointerId); }
      viewport.classList.add('is-dragging'); viewport.scrollLeft = drag.left - dx; viewport.scrollTop = drag.top - dy;
    });
    const release = () => { if (drag) suppressClick = drag.moved; drag = null; viewport.classList.remove('is-dragging'); };
    viewport.addEventListener('pointerup', release); viewport.addEventListener('pointercancel', release);
    viewport.addEventListener('lostpointercapture', release);
    viewport.addEventListener('click', event => {
      if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false; }
    }, true);
  }
  function centerMap(point, animate = false) {
    viewport.scrollTo({ left: point.x - viewport.clientWidth / 2, top: point.y - viewport.clientHeight / 2,
      behavior: animate && motion && !reduced.matches ? 'smooth' : 'instant' });
  }
  function toggleWord(word) {
    if (feelings.has(word)) feelings.delete(word); else feelings.add(word);
    const button = wordEls.get(word);
    button.setAttribute('aria-pressed', String(feelings.has(word)));
    button.classList.remove('pop'); void button.offsetWidth; button.classList.add('pop');
    renderSelection();
  }
  function renderSelection() {
    $('#selection-count').textContent = feelings.size ? `${feelings.size} ${feelings.size === 1 ? 'word' : 'words'} selected` : 'No words selected';
    $('#selected-words').replaceChildren(...[...feelings].map(word => {
      const chip = el('button', 'selected-chip', word); chip.type = 'button';
      chip.setAttribute('aria-label', 'Remove ' + word); chip.append(el('span', '', '×'));
      chip.addEventListener('click', () => { toggleWord(word); wordEls.get(word).focus({ preventScroll: true }); });
      return chip;
    }));
  }
  function goTo(number, focus = true) {
    if (saving || (number > 1 && !D.complete(ratings))) return;
    const direction = number >= page ? 'enter-forward' : 'enter-back'; page = number;
    pages.forEach((section, i) => { section.hidden = i !== number - 1; section.classList.remove('enter-forward', 'enter-back'); });
    const current = pages[number - 1]; void current.offsetWidth; current.classList.add(direction);
    document.querySelectorAll('.progress li').forEach((step, i) => {
      if (i === number - 1) step.setAttribute('aria-current', 'step'); else step.removeAttribute('aria-current');
      step.classList.toggle('complete', i < number - 1);
    });
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (focus) $('#heading-' + number).focus({ preventScroll: true });
    if (number === 2 && !mapVisited) { centerMap(D.mapPoint(ratings)); mapVisited = true; }
  }
  function countLocal() {
    try {
      const today = D.stamp(new Date()).slice(0, 10);
      const count = store.read().entries.filter(e => e.at.slice(0, 10) === today).length;
      $('#local-count').textContent = `${count} ${count === 1 ? 'check-in' : 'check-ins'} today`;
    } catch (_) { $('#local-count').textContent = 'Saving paused'; }
  }
  function reset() {
    ratings = {}; feelings = new Set(); startedAt = null; mapVisited = false;
    ratingEls.forEach(ui => {
      ui.field.classList.remove('is-set', 'dragging'); ui.field.style.setProperty('--fraction', 0);
      ui.field.style.setProperty('--position', '0%'); ui.value.textContent = 'Choose';
      ui.inputs.forEach(input => { input.checked = false; });
    });
    wordEls.forEach(button => { button.setAttribute('aria-pressed', 'false'); button.classList.remove('pop'); });
    $('#doing').value = ''; $('#company').value = ''; next.disabled = true;
    $('#rating-count').textContent = 'Tap or slide each one to begin.'; renderSelection(); goTo(1); countLocal();
  }
  async function save(event) {
    event.preventDefault();
    if (saving || !D.complete(ratings) || page !== 3) return;
    saving = true; submit.disabled = true;
    let entry;
    try {
      entry = await store.append({ started_at: startedAt, ratings, feelings: [...feelings], doing: $('#doing').value.trim(), company: $('#company').value.trim() });
    } catch (_) {
      notice('Your check-in was not saved. Your answers are still here; try again when storage is available.');
    }
    saving = false; submit.disabled = false;
    if (!entry) return;
    notice(''); reset();
    $('#live').textContent = 'Check-in saved on this device at ' + entry.at.slice(11, 16) + '.';
    $('#saved-overlay').hidden = false;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { $('#saved-overlay').hidden = true; }, motion && !reduced.matches ? 1050 : 500);
  }
  function applyMotion() {
    document.documentElement.classList.toggle('motion-off', !motion || reduced.matches);
    $('#motion-toggle').setAttribute('aria-pressed', String(motion && !reduced.matches));
    const label = motion && !reduced.matches ? 'Turn off gentle motion' : 'Turn on gentle motion';
    $('#motion-toggle').setAttribute('aria-label', label); $('#motion-toggle').title = label;
  }
  async function setupFromHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    if (!params.has('log') && !params.has('key')) return;
    const url = params.get('log'), key = params.get('key');
    history.replaceState(null, '', location.pathname + location.search);
    try { if (await store.setup(url, key)) toast('Sheet connected. Your check-ins will sync here.'); }
    catch (error) { toast(error.message); }
  }
  function boot() {
    buildRatings(); buildMap();
    try { motion = storage.getItem('mood.motion.v1') !== 'off'; } catch (_) {}
    applyMotion();
    $('#motion-toggle').addEventListener('click', () => {
      if (reduced.matches) { toast('Reduced motion is on in your device settings.'); return; }
      motion = !motion; applyMotion();
      try { storage.setItem('mood.motion.v1', motion ? 'on' : 'off'); } catch (_) {}
    });
    reduced.addEventListener('change', applyMotion);
    next.addEventListener('click', () => goTo(2)); $('#next-2').addEventListener('click', () => goTo(3));
    document.querySelectorAll('[data-back]').forEach(button => button.addEventListener('click', () => goTo(Number(button.dataset.back))));
    $('#recenter').addEventListener('click', () => centerMap(D.mapPoint(ratings), true));
    $('#context-form').addEventListener('submit', save);
    $('#sheet-sync').addEventListener('click', () => {
      if (!store.linked) toast('Open the setup link used by your other trackers in this browser. Check-ins stay on this device until then.', 6500);
      else if (store.blocked) toast('Sync is paused to protect your saved check-ins.');
      else store.sync(true);
    });
    if (!store.start()) notice('This browser cannot read or save check-ins. Saving is paused to protect your entries.');
    countLocal(); setupFromHash();
    window.addEventListener('hashchange', setupFromHash);
    window.addEventListener('online', () => store.queue(0));
    window.addEventListener('storage', event => { store.externalChange(event.key); countLocal(); next.disabled = !D.complete(ratings) || store.blocked; });
    window.addEventListener('pageshow', event => { if (event.persisted) goTo(1); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { countLocal(); store.queue(0); } });
    // Cache updates take effect on the next visit; never reload over an unfinished check-in.
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
  }
  boot();
})();
