const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const D = require('../data.js');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

// This checks the actual UI event handlers and persistence, not browser rendering.
// The DOM and network are isolated: no test can send a real check-in to Google.
function device(existing) {
  const nodes = new Map(), events = {}, timers = new Map(), store = existing || new Map();
  let timerId = 0, refuseWrites = false;
  function node(tag = 'div') {
    const classes = new Set();
    return { tagName: tag.toUpperCase(), className: '', textContent: '', value: '', children: [], attrs: {}, dataset: {}, listeners: {},
      hidden: false, checked: false, disabled: false, clientWidth: 320, clientHeight: 340, scrollLeft: 0, scrollTop: 0,
      style: { setProperty() {} },
      classList: { add(...v) { v.forEach(c => classes.add(c)); }, remove(...v) { v.forEach(c => classes.delete(c)); },
        toggle(c, on) { if (on ?? !classes.has(c)) classes.add(c); else classes.delete(c); }, contains: c => classes.has(c) },
      setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; },
      append(...v) { this.children.push(...v); }, replaceChildren(...v) { this.children = v; },
      addEventListener(k, fn) { this.listeners[k] = fn; },
      focus() { this.focused = true; }, setPointerCapture() {},
      getBoundingClientRect() { return { left: 0, top: 0, width: 320, height: 44 }; },
      scrollTo(v) { this.scrollLeft = Math.max(0, Math.min(784 - this.clientWidth, v.left || 0)); this.scrollTop = Math.max(0, Math.min(784 - this.clientHeight, v.top || 0)); }
    };
  }
  [...html.matchAll(/id="([^"]+)"/g)].forEach(match => nodes.set('#' + match[1], node()));
  nodes.get('#page-2').hidden = true; nodes.get('#page-3').hidden = true;
  nodes.get('#saved-overlay').hidden = true; nodes.get('#next-1').disabled = true;
  const steps = [node('li'), node('li'), node('li')];
  const backs = [1, 2].map(n => { const b = node('button'); b.dataset.back = String(n); return b; });
  const jumps = D.QUADRANTS.map(q => { const b = node('button'); b.dataset.quadrant = q.id; return b; });
  const document = { hidden: false, documentElement: node('html'),
    querySelector(selector) { assert.ok(nodes.has(selector), 'Missing HTML element: ' + selector); return nodes.get(selector); },
    querySelectorAll(selector) { return ({ '.progress li': steps, '[data-back]': backs, '[data-quadrant]': jumps })[selector] || []; },
    createElement: node, createElementNS: (_, tag) => node(tag), addEventListener(k, fn) { events['document:' + k] = fn; } };
  const storage = { getItem: k => store.get(k) ?? null,
    setItem(k, v) { if (refuseWrites && k === D.KEY) throw new Error('quota'); store.set(k, String(v)); },
    removeItem(k) { store.delete(k); } };
  const context = vm.createContext({ document, URLSearchParams, Date, crypto: { randomUUID }, navigator: {},
    window: { MoodData: D, localStorage: storage, scrollTo() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener(k, fn) { events[k] = fn; } },
    location: { hash: '', pathname: '/nangupungu/mood/', search: '' }, history: { replaceState() {} },
    fetch: async () => { throw new Error('Tests must not contact the network'); },
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); } });
  const hook = 'globalThis.testApp = { get state() { return { ratings, feelings: [...feelings], page, startedAt, saving }; }, ratingEls, wordEls, store };';
  vm.runInContext(source.replace('  boot();', hook + '\n  boot();'), context);
  return { api: context.testApp, nodes, store, events, steps, backs, jumps,
    el: selector => document.querySelector(selector), failWrites() { refuseWrites = true; },
    rate(id, value) { context.testApp.ratingEls.get(id).inputs[value - 1].listeners.change(); },
    async click(selector) { return document.querySelector(selector).listeners.click(); },
    async submit() { return document.querySelector('#context-form').listeners.submit({ preventDefault() {} }); } };
}
function allRatings(d) { D.RATINGS.forEach((r, i) => d.rate(r.id, i + 1)); }
test('opens on page one with no preselected ratings; Next enables only after all five', async () => {
  const d = device();
  assert.equal(d.api.state.page, 1); assert.equal(Object.keys(d.api.state.ratings).length, 0);
  assert.equal(d.el('#next-1').disabled, true);
  assert.equal([...d.api.ratingEls.values()].flatMap(r => r.inputs).some(i => i.checked), false);
  D.RATINGS.slice(0, 4).forEach(r => d.rate(r.id, 3));
  assert.equal(d.el('#next-1').disabled, true);
  d.rate('thought_speed', 3); assert.equal(d.el('#next-1').disabled, false);
  await d.click('#next-1'); assert.equal(d.api.state.page, 2);
  assert.equal(d.el('#page-1').hidden, true); assert.equal(d.el('#page-2').hidden, false);
  assert.equal(d.steps[1].attrs['aria-current'], 'step');
  assert.equal(d.el('#map-viewport').scrollLeft, 232); assert.equal(d.el('#map-viewport').scrollTop, 222);
});
test('Next, Next, Submit saves just the ratings, then resets to a blank first page', async () => {
  const d = device(); allRatings(d);
  await d.click('#next-1'); await d.click('#next-2'); await d.submit();
  const entries = d.api.store.read().entries;
  assert.equal(entries.length, 1); assert.deepEqual(entries[0].feelings, []);
  assert.equal(entries[0].doing, ''); assert.equal(entries[0].company, '');
  assert.deepEqual(entries[0].ratings, { mood: 1, energy: 2, tension: 3, irritability: 4, thought_speed: 5 });
  assert.equal(d.api.state.page, 1); assert.equal(d.el('#next-1').disabled, true);
  assert.equal(d.el('#saved-overlay').hidden, false);
  assert.equal([...d.api.ratingEls.values()].flatMap(r => r.inputs).some(i => i.checked), false);
  const reloaded = device(d.store); assert.equal(reloaded.api.state.page, 1);
  assert.equal(reloaded.api.store.read().entries[0].id, entries[0].id);
});
test('multi-select works across all quadrants, toggles off, and survives back navigation', async () => {
  const d = device(); allRatings(d); await d.click('#next-1');
  for (const word of ['Anxious', 'Hopeful', 'Numb', 'Calm']) d.api.wordEls.get(word).listeners.click();
  d.api.wordEls.get('Numb').listeners.click();
  assert.equal(d.el('#selection-count').textContent, '3 words selected');
  assert.equal(d.api.wordEls.get('Numb').attrs['aria-pressed'], 'false');
  await d.click('#next-2'); d.el('#doing').value = '<img src=x>\nCooking'; d.el('#company').value = 'By myself';
  d.backs[1].listeners.click(); assert.equal(d.api.state.page, 2);
  assert.equal(d.api.state.feelings.length, 3); assert.equal(d.el('#doing').value, '<img src=x>\nCooking');
  await d.click('#next-2'); await d.submit();
  const entry = d.api.store.read().entries[0];
  assert.deepEqual(entry.feelings, ['Anxious', 'Hopeful', 'Calm']);
  assert.equal(entry.doing, '<img src=x>\nCooking'); assert.equal(entry.company, 'By myself');
});
test('failed saving preserves every answer on page three and allows retry', async () => {
  const d = device(); allRatings(d); await d.click('#next-1');
  d.api.wordEls.get('Calm').listeners.click(); await d.click('#next-2');
  d.el('#doing').value = 'Keep me'; d.failWrites(); await d.submit();
  assert.equal(d.api.state.page, 3); assert.equal(d.el('#doing').value, 'Keep me');
  assert.equal(d.api.state.feelings[0], 'Calm'); assert.equal(d.el('#notice').hidden, false);
  assert.equal(d.api.store.read().entries.length, 0); assert.equal(d.el('#submit').disabled, false);
});
test('panning controls reach all quadrants; selecting a word never picks a rating', async () => {
  const d = device(); allRatings(d); await d.click('#next-1');
  const positions = [];
  d.jumps.forEach(button => { button.listeners.click(); positions.push([d.el('#map-viewport').scrollLeft, d.el('#map-viewport').scrollTop]); });
  assert.equal(new Set(positions.map(JSON.stringify)).size, 4);
  const before = JSON.stringify(d.api.state.ratings);
  d.api.wordEls.get('Excited').listeners.click(); assert.equal(JSON.stringify(d.api.state.ratings), before);
});
test('dragging a rating snaps to one of the five positions', () => {
  const d = device(); const ui = d.api.ratingEls.get('mood'), track = ui.field.children[2];
  track.listeners.pointerdown({ button: 0, pointerId: 1, clientX: 28 });
  assert.equal(d.api.state.ratings.mood, 1);
  track.listeners.pointermove({ pointerId: 1, clientX: 310 });
  assert.equal(d.api.state.ratings.mood, 5);
  track.listeners.pointerup(); assert.equal(ui.field.classList.contains('dragging'), false);
});
test('HTML, manifest and service worker keep a distinct installable app and isolated cache', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json')));
  const sw = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
  assert.equal(manifest.id, '/nangupungu/mood/'); assert.equal(manifest.scope, manifest.id); assert.equal(manifest.start_url, manifest.id);
  assert.match(sw, /key.startsWith\('mood-'\)/); assert.match(sw, /url.pathname.startsWith\(scope.pathname\)/);
  assert.match(html, /name="viewport"/); assert.match(html, /id="page-2"[^>]+hidden/); assert.match(html, /id="page-3"[^>]+hidden/);
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]); assert.equal(new Set(ids).size, ids.length);
  assert.doesNotMatch(html + source, /https?:\/\/(?!www\.w3\.org)/); // No third-party UI requests or embedded credentials.
});
