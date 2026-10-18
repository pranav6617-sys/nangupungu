(() => {
  'use strict';

  const D = window.MoodData;
  const $ = selector => document.querySelector(selector);
  const pages = [$('#page-1'), $('#page-2'), $('#page-3')];
  const next = $('#next-1');
  const submit = $('#submit');
  const ratingEls = new Map();
  const wordEls = new Map();
  const panelEls = new Map();
  const tabEls = new Map();
  let ratings = {};
  let feelings = new Set();
  let startedAt = null;
  let page = 1;
  let saving = false;
  let quadrantVisited = false;
  let activeQuadrant = null;
  let toastTimer;
  let lastStatus = '';
  let storage;

  try { storage = window.localStorage; }
  catch (_) {
    storage = {
      getItem() { throw new Error('Storage unavailable'); },
      setItem() { throw new Error('Storage unavailable'); },
      removeItem() {}
    };
  }

  const store = D.createStore({
    storage,
    fetcher: (...args) => fetch(...args),
    uuid: () => crypto.randomUUID(),
    locks: navigator.locks,
    onStatus: showStatus
  });

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function toast(message, duration = 3200) {
    clearTimeout(toastTimer);
    $('#toast').textContent = message;
    $('#toast').hidden = false;
    toastTimer = setTimeout(() => { $('#toast').hidden = true; }, duration);
  }

  function notice(message) {
    $('#notice').textContent = message;
    $('#notice').hidden = !message;
  }

  function showStatus(state, detail) {
    const labels = {
      local: 'On device',
      ready: 'Sheet ready',
      sent: 'Synced',
      sending: 'Syncing…',
      waiting: 'Saved · pending',
      paused: 'Sync paused',
      error: 'Sync issue'
    };
    $('#sheet-sync').dataset.state = state;
    $('#sync-label').textContent = labels[state] || labels.local;
    $('#sheet-sync').title = detail || labels[state] || labels.local;
    if ((state === 'error' || state === 'paused') && detail && lastStatus !== state) toast(detail, 6500);
    lastStatus = state;
  }

  function buildRatings() {
    D.RATINGS.forEach(def => {
      const field = el('fieldset', 'rating');
      field.style.setProperty('--rating-color', def.color);
      const legend = el('legend', 'sr-only', def.title);
      const top = el('div', 'rating-top');
      const title = el('span', 'rating-title', def.title);
      const value = el('span', 'rating-value', 'Choose');
      value.id = def.id + '-value';
      value.setAttribute('aria-live', 'polite');
      top.append(title, value);

      const scale = el('div', 'rating-scale');
      const inputs = [];
      def.labels.forEach((label, index) => {
        const option = el('label', 'rating-option');
        const input = el('input');
        input.type = 'radio';
        input.name = def.id;
        input.value = String(index + 1);
        input.setAttribute('aria-label', `${def.title}: ${label}`);
        input.addEventListener('change', () => setRating(def, index + 1));
        const cell = el('span', 'rating-cell');
        cell.setAttribute('aria-hidden', 'true');
        option.append(input, cell);
        scale.append(option);
        inputs.push(input);
      });

      const ends = el('div', 'rating-ends');
      ends.setAttribute('aria-hidden', 'true');
      ends.append(el('span', '', def.labels[0]), el('span', '', def.labels[4]));
      field.append(legend, top, scale, ends);
      $('#ratings').append(field);
      ratingEls.set(def.id, { field, value, inputs });
    });
  }

  function setRating(def, value) {
    if (saving) return;
    if (!startedAt) startedAt = D.stamp(new Date());
    ratings[def.id] = value;
    const ui = ratingEls.get(def.id);
    ui.field.classList.add('is-set');
    ui.value.textContent = def.labels[value - 1];
    ui.inputs.forEach((input, index) => { input.checked = index === value - 1; });
    const count = Object.keys(ratings).length;
    next.disabled = !D.complete(ratings) || store.blocked;
    $('#rating-count').textContent = `${count} of 5`;
    if (def.id === 'mood' || def.id === 'energy') quadrantVisited = false;
  }

  function buildFeelings() {
    document.querySelectorAll('[data-quadrant]').forEach(button => {
      tabEls.set(button.dataset.quadrant, button);
      button.addEventListener('click', () => activateQuadrant(button.dataset.quadrant, true));
    });

    D.QUADRANTS.forEach(quadrant => {
      const panel = el('section', 'quadrant-panel');
      panel.dataset.quadrant = quadrant.id;
      panel.setAttribute('aria-label', quadrant.label);
      panel.hidden = true;
      const grid = el('div', 'word-grid');
      quadrant.words.forEach(word => {
        const button = el('button', 'word-button', word);
        button.type = 'button';
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => toggleWord(word));
        grid.append(button);
        wordEls.set(word, button);
      });
      panel.append(grid);
      $('#feeling-panels').append(panel);
      panelEls.set(quadrant.id, panel);
    });
  }

  function activateQuadrant(id, focus = false) {
    const quadrant = D.QUADRANTS.find(item => item.id === id) || D.QUADRANTS[0];
    activeQuadrant = quadrant.id;
    tabEls.forEach((tab, tabId) => tab.setAttribute('aria-pressed', String(tabId === quadrant.id)));
    panelEls.forEach((panel, panelId) => { panel.hidden = panelId !== quadrant.id; });
    $('#word-panel').className = `word-panel ${quadrant.className}`;
    $('#quadrant-title').textContent = quadrant.label;
    if (focus) {
      const firstWord = quadrant.words[0];
      if (wordEls.get(firstWord)) wordEls.get(firstWord).focus({ preventScroll: true });
    }
  }

  function toggleWord(word) {
    if (feelings.has(word)) feelings.delete(word);
    else feelings.add(word);
    wordEls.get(word).setAttribute('aria-pressed', String(feelings.has(word)));
    renderSelection();
  }

  function renderSelection() {
    const count = feelings.size;
    $('#selection-count').textContent = count ? `${count} selected` : 'None selected';
  }

  function goTo(number, focus = true) {
    if (saving || (number > 1 && !D.complete(ratings))) return;
    page = number;
    pages.forEach((section, index) => { section.hidden = index !== number - 1; });
    document.querySelectorAll('.progress li').forEach((step, index) => {
      if (index === number - 1) step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
      step.classList.toggle('complete', index < number - 1);
    });
    $('#step-label').textContent = `${number} of 3`;
    if (number === 2 && !quadrantVisited) {
      activateQuadrant(D.startingQuadrant(ratings));
      quadrantVisited = true;
    }
    if (focus) $('#heading-' + number).focus({ preventScroll: true });
  }

  function reset() {
    ratings = {};
    feelings = new Set();
    startedAt = null;
    quadrantVisited = false;
    activeQuadrant = null;
    ratingEls.forEach(ui => {
      ui.field.classList.remove('is-set');
      ui.value.textContent = 'Choose';
      ui.inputs.forEach(input => { input.checked = false; });
    });
    wordEls.forEach(button => button.setAttribute('aria-pressed', 'false'));
    $('#context').value = '';
    next.disabled = true;
    $('#rating-count').textContent = '0 of 5';
    renderSelection();
    goTo(1, false);
  }

  async function save(event) {
    event.preventDefault();
    if (saving || !D.complete(ratings) || page !== 3) return;
    saving = true;
    submit.disabled = true;
    let entry;
    try {
      entry = await store.append({
        started_at: startedAt,
        ratings,
        feelings: [...feelings],
        doing: $('#context').value.trim(),
        company: ''
      });
    } catch (_) {
      notice('This check-in was not saved. Your answers are still here; try again when storage is available.');
    }
    saving = false;
    submit.disabled = false;
    if (!entry) return;
    notice('');
    reset();
    $('#live').textContent = 'Check-in saved on this device at ' + entry.at.slice(11, 16) + '.';
    toast('Check-in saved.');
  }

  async function setupFromHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    if (!params.has('log') && !params.has('key')) return;
    const url = params.get('log');
    const key = params.get('key');
    history.replaceState(null, '', location.pathname + location.search);
    try {
      if (await store.setup(url, key)) toast('Sheet connected.');
    } catch (error) { toast(error.message); }
  }

  function boot() {
    buildRatings();
    buildFeelings();
    next.addEventListener('click', () => goTo(2));
    $('#next-2').addEventListener('click', () => goTo(3));
    document.querySelectorAll('[data-back]').forEach(button => {
      button.addEventListener('click', () => goTo(Number(button.dataset.back)));
    });
    $('#context-form').addEventListener('submit', save);
    $('#sheet-sync').addEventListener('click', () => {
      if (!store.linked) toast('Check-ins stay on this device until this browser is connected to your Sheet.', 5200);
      else if (store.blocked) toast('Sync is paused to protect your saved check-ins.');
      else store.sync(true);
    });
    if (!store.start()) notice('This browser cannot read or save check-ins. Saving is paused to protect your entries.');
    setupFromHash();
    window.addEventListener('hashchange', setupFromHash);
    window.addEventListener('online', () => store.queue(0));
    window.addEventListener('storage', event => {
      store.externalChange(event.key);
      next.disabled = !D.complete(ratings) || store.blocked;
    });
    window.addEventListener('pageshow', event => { if (event.persisted) goTo(1, false); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) store.queue(0); });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
  }

  boot();
})();
