const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const D = require('../data.js');

const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../style.css'), 'utf8');

// This runs the real UI event handlers in an isolated DOM. It cannot contact Google.
function device(existing) {
  const nodes = new Map();
  const events = {};
  const timers = new Map();
  const store = existing || new Map();
  let timerId = 0;
  let refuseWrites = false;

  function node(tag = 'div') {
    const classes = new Set();
    return {
      tagName: tag.toUpperCase(), className: '', textContent: '', value: '', children: [], attrs: {}, dataset: {}, listeners: {},
      hidden: false, checked: false, disabled: false,
      style: { setProperty() {} },
      classList: {
        add(...values) { values.forEach(value => classes.add(value)); },
        remove(...values) { values.forEach(value => classes.delete(value)); },
        toggle(value, on) { if (on ?? !classes.has(value)) classes.add(value); else classes.delete(value); },
        contains: value => classes.has(value)
      },
      setAttribute(key, value) { this.attrs[key] = String(value); },
      removeAttribute(key) { delete this.attrs[key]; },
      append(...values) { this.children.push(...values); },
      replaceChildren(...values) { this.children = values; },
      addEventListener(key, fn) { this.listeners[key] = fn; },
      focus() { this.focused = true; }
    };
  }

  [...html.matchAll(/id="([^"]+)"/g)].forEach(match => nodes.set('#' + match[1], node()));
  nodes.get('#page-2').hidden = true;
  nodes.get('#page-3').hidden = true;
  nodes.get('#toast').hidden = true;
  nodes.get('#next-1').disabled = true;

  const steps = [node('li'), node('li'), node('li')];
  steps[0].setAttribute('aria-current', 'step');
  const backs = [1, 2].map(number => {
    const button = node('button');
    button.dataset.back = String(number);
    return button;
  });
  const tabs = D.QUADRANTS.map(quadrant => {
    const button = node('button');
    button.dataset.quadrant = quadrant.id;
    button.setAttribute('aria-pressed', 'false');
    return button;
  });

  const document = {
    hidden: false,
    querySelector(selector) {
      assert.ok(nodes.has(selector), 'Missing HTML element: ' + selector);
      return nodes.get(selector);
    },
    querySelectorAll(selector) {
      return ({ '.progress li': steps, '[data-back]': backs, '[data-quadrant]': tabs })[selector] || [];
    },
    createElement: node,
    addEventListener(key, fn) { events['document:' + key] = fn; }
  };

  const storage = {
    getItem: key => store.get(key) ?? null,
    setItem(key, value) {
      if (refuseWrites && key === D.KEY) throw new Error('quota');
      store.set(key, String(value));
    },
    removeItem(key) { store.delete(key); }
  };

  const context = vm.createContext({
    document,
    URLSearchParams,
    Date,
    crypto: { randomUUID },
    navigator: {},
    window: {
      MoodData: D,
      localStorage: storage,
      addEventListener(key, fn) { events[key] = fn; }
    },
    location: { hash: '', pathname: '/nangupungu/mood/', search: '' },
    history: { replaceState() {} },
    fetch: async () => { throw new Error('Tests must not contact the network'); },
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); }
  });

  const hook = 'globalThis.testApp = { get state() { return { ratings, feelings: [...feelings], page, startedAt, saving, activeQuadrant }; }, ratingEls, wordEls, panelEls, tabEls, store };';
  vm.runInContext(source.replace('  boot();', hook + '\n  boot();'), context);

  return {
    api: context.testApp, nodes, store, events, steps, backs, tabs,
    el: selector => document.querySelector(selector),
    failWrites() { refuseWrites = true; },
    rate(id, value) { context.testApp.ratingEls.get(id).inputs[value - 1].listeners.change(); },
    word(value) { context.testApp.wordEls.get(value).listeners.click(); },
    quadrant(id) { tabs.find(button => button.dataset.quadrant === id).listeners.click(); },
    async click(selector) { return document.querySelector(selector).listeners.click(); },
    async submit() { return document.querySelector('#context-form').listeners.submit({ preventDefault() {} }); }
  };
}

function allRatings(d) { D.RATINGS.forEach((rating, index) => d.rate(rating.id, index + 1)); }

test('opens on page one with nothing preselected; Next needs all five ratings', async () => {
  const d = device();
  assert.equal(d.api.state.page, 1);
  assert.equal(Object.keys(d.api.state.ratings).length, 0);
  assert.equal(d.el('#next-1').disabled, true);
  assert.equal([...d.api.ratingEls.values()].flatMap(item => item.inputs).some(input => input.checked), false);
  D.RATINGS.slice(0, 4).forEach(rating => d.rate(rating.id, 3));
  assert.equal(d.el('#next-1').disabled, true);
  d.rate('thought_speed', 3);
  assert.equal(d.el('#next-1').disabled, false);
  assert.equal(d.el('#rating-count').textContent, '5 of 5');
  await d.click('#next-1');
  assert.equal(d.api.state.page, 2);
  assert.equal(d.el('#page-1').hidden, true);
  assert.equal(d.el('#page-2').hidden, false);
  assert.equal(d.el('#step-label').textContent, '2 of 3');
});

test('Next, Next, Save accepts empty optional screens and resets to a blank first screen', async () => {
  const d = device();
  allRatings(d);
  await d.click('#next-1');
  await d.click('#next-2');
  await d.submit();
  const entries = d.api.store.read().entries;
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].feelings, []);
  assert.equal(entries[0].doing, '');
  assert.equal(entries[0].company, '');
  assert.deepEqual(entries[0].ratings, { mood: 1, energy: 2, tension: 3, irritability: 4, thought_speed: 5 });
  assert.equal(d.api.state.page, 1);
  assert.equal(d.el('#next-1').disabled, true);
  assert.equal(d.el('#toast').textContent, 'Check-in saved.');
  assert.equal(d.el('#toast').hidden, false);
  const reloaded = device(d.store);
  assert.equal(reloaded.api.state.page, 1);
  assert.equal(reloaded.api.store.read().entries[0].id, entries[0].id);
});

test('mood and energy choose a starting area; every quadrant stays one tap away', async () => {
  const d = device();
  d.rate('mood', 5);
  d.rate('energy', 5);
  d.rate('tension', 1);
  d.rate('irritability', 1);
  d.rate('thought_speed', 3);
  await d.click('#next-1');
  assert.equal(d.api.state.activeQuadrant, 'high-pleasant');
  assert.equal(d.api.panelEls.get('high-pleasant').hidden, false);
  assert.equal(d.tabs.find(tab => tab.dataset.quadrant === 'high-pleasant').attrs['aria-pressed'], 'true');
  d.quadrant('low-unpleasant');
  assert.equal(d.api.state.activeQuadrant, 'low-unpleasant');
  assert.equal(d.api.panelEls.get('high-pleasant').hidden, true);
  assert.equal(d.api.panelEls.get('low-unpleasant').hidden, false);
});

test('multiple words can be selected across quadrants and one optional sentence is saved literally', async () => {
  const d = device();
  allRatings(d);
  await d.click('#next-1');
  d.word('Anxious');
  d.quadrant('high-pleasant');
  d.word('Hopeful');
  d.quadrant('low-pleasant');
  d.word('Calm');
  d.word('Calm');
  assert.equal(d.el('#selection-count').textContent, '2 selected');
  assert.equal(d.api.wordEls.get('Calm').attrs['aria-pressed'], 'false');
  await d.click('#next-2');
  d.el('#context').value = '<img src=x> Walking home after a difficult call.';
  d.backs[1].listeners.click();
  assert.equal(d.api.state.feelings.length, 2);
  assert.equal(d.el('#context').value, '<img src=x> Walking home after a difficult call.');
  await d.click('#next-2');
  await d.submit();
  const entry = d.api.store.read().entries[0];
  assert.deepEqual(entry.feelings, ['Anxious', 'Hopeful']);
  assert.equal(entry.doing, '<img src=x> Walking home after a difficult call.');
  assert.equal(entry.company, '');
});

test('failed saving keeps every answer on page three for retry', async () => {
  const d = device();
  allRatings(d);
  await d.click('#next-1');
  d.word('Calm');
  await d.click('#next-2');
  d.el('#context').value = 'Keep me';
  d.failWrites();
  await d.submit();
  assert.equal(d.api.state.page, 3);
  assert.equal(d.el('#context').value, 'Keep me');
  assert.equal(d.api.state.feelings[0], 'Calm');
  assert.equal(d.el('#notice').hidden, false);
  assert.equal(d.api.store.read().entries.length, 0);
  assert.equal(d.el('#submit').disabled, false);
});

test('the interaction is fixed-screen: no drag, pan, or page-scroll handlers remain', () => {
  const d = device();
  const firstRating = d.api.ratingEls.get('mood');
  assert.equal(firstRating.inputs.every(input => !input.listeners.pointerdown && !input.listeners.pointermove), true);
  assert.doesNotMatch(source, /\.scroll(?:To|By)\s*\(/);
  assert.doesNotMatch(source, /pointer(?:down|move|up)/);
  assert.match(css, /html,body\{[^}]*overflow:hidden/);
  assert.match(css, /\.word-grid\{[^}]*grid-template-columns:1fr 1fr/);
});

test('HTML, manifest and service worker keep an isolated installable dark app', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json')));
  const sw = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
  assert.equal(manifest.id, '/nangupungu/mood/');
  assert.equal(manifest.scope, manifest.id);
  assert.equal(manifest.start_url, manifest.id);
  assert.equal(manifest.theme_color, '#0b0d12');
  assert.match(sw, /const CACHE = 'mood-v2'/);
  assert.match(sw, /key.startsWith\('mood-'\)/);
  assert.match(sw, /url.pathname.startsWith\(scope.pathname\)/);
  assert.match(html, /id="page-2"[^>]+hidden/);
  assert.match(html, /id="page-3"[^>]+hidden/);
  assert.match(html, /id="context"[^>]+maxlength="500"/);
  assert.doesNotMatch(html, /id="doing"|id="company"/);
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.doesNotMatch(html + source, /https?:\/\/(?!www\.w3\.org)/);
});
