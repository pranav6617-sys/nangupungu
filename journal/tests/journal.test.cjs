const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

const source = readFileSync(resolve(__dirname, '../app.js'), 'utf8');
const KEY = 'journal.v1';
const LINK = 'tracking-log.link.v1';
const config = { url: 'http://localhost:8765/sheet', key: 'test-only' };

// Run the real app code with an in-memory device, controlled clock and mock sheet.
// Hooks exist only in this VM: the shipped app exposes no entry-editing API.
function device({ store = new Map(), now = '2026-10-17T09:30:00Z', fetch } = {}) {
  const nodes = new Map(), timers = new Map(), windowEvents = {};
  let clock = new Date(now).getTime(), nextTimer = 0, refuseWrites = false;
  function node() {
    return {
      value: '', textContent: '', hidden: false, disabled: false, scrollHeight: 160,
      style: {}, children: [], attrs: {}, listeners: {},
      classList: { toggle() {} },
      addEventListener(name, callback) { this.listeners[name] = callback; },
      setAttribute(name, value) { this.attrs[name] = value; },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      focus() {}, close() { this.open = false; }, showModal() { this.open = true; }
    };
  }
  const document = {
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); },
    createElement: node, addEventListener() {}, hidden: false
  };
  const storage = {
    getItem(key) { return store.get(key) ?? null; },
    setItem(key, value) { if (refuseWrites && key === KEY) throw new Error('quota'); store.set(key, String(value)); },
    removeItem(key) { store.delete(key); }
  };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const context = vm.createContext({
    document, Date: Clock, Intl, URLSearchParams, crypto: { randomUUID },
    navigator: {}, localStorage: storage,
    window: { addEventListener(name, callback) { windowEvents[name] = callback; } },
    location: { hash: '', pathname: '/journal/', search: '', reload() {} },
    history: { replaceState() {} },
    fetch: fetch || (async () => ({ json: async () => ({ ok: true }) })),
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); }, setInterval() {}, console
  });
  const hook = `globalThis.testApp = {
    boot, stamp, dayOf, rollDay, sheetRows, sendLog, readLocal, changed, setupFromLink,
    get state() { return { entries, today, selectedDay, canSave, sheetState, sending, sendAgain }; },
    view(day) { selectedDay = day; render(); }
  };`;
  assert.ok(source.includes('  boot();'));
  vm.runInContext(source.replace('  boot();', hook), context);
  const api = context.testApp;
  api.boot();
  return {
    api, store, context, nodes, timers, windowEvents,
    el: (selector) => document.querySelector(selector),
    clock(value) { clock = new Date(value).getTime(); },
    refuseWrites() { refuseWrites = true; },
    async submit(text) {
      const note = document.querySelector('#note');
      note.value = text;
      note.listeners.input();
      await document.querySelector('#composer').listeners.submit({ preventDefault() {} });
    }
  };
}

test('NZ 4 am boundary and summer/winter offsets are independent of device timezone', () => {
  const { api } = device();
  assert.equal(api.dayOf(new Date('2026-10-18T03:59:59+13:00')), '2026-10-17');
  assert.equal(api.dayOf(new Date('2026-10-18T04:00:00+13:00')), '2026-10-18');
  assert.equal(api.stamp(new Date('2026-10-17T09:30:00Z')), '2026-10-17T22:30:00+13:00');
  assert.equal(api.stamp(new Date('2026-07-17T09:30:00Z')), '2026-07-17T21:30:00+12:00');
  assert.equal(api.dayOf(new Date('2026-09-27T03:59:59+13:00')), '2026-09-26');
  assert.equal(api.dayOf(new Date('2026-09-27T04:00:00+13:00')), '2026-09-27');
  assert.equal(api.dayOf(new Date('2026-04-05T03:59:59+12:00')), '2026-04-04');
  assert.equal(api.dayOf(new Date('2026-04-05T04:00:00+12:00')), '2026-04-05');
});

test('submissions preserve plain text and stable IDs through reload; no edits or deletes', async () => {
  const d = device();
  const text = '<img src=x onerror=alert(1)>\n  second line';
  await d.submit(text);
  const first = JSON.stringify(d.api.state.entries[0]);
  await d.submit('Another entry');
  assert.equal(d.api.state.entries.length, 2);
  assert.equal(JSON.stringify(d.api.state.entries[0]), first);
  assert.notEqual(d.api.state.entries[0].id, d.api.state.entries[1].id);
  assert.equal(d.el('#entries').children[0].children[1].textContent, text);
  const reloaded = device({ store: d.store });
  assert.equal(JSON.stringify(reloaded.api.state.entries[0]), first);
  assert.equal(reloaded.el('#note').value, '');
  assert.equal(/innerHTML|contenteditable|allowShrink/.test(source), false);
});

test('50,000 characters survive local storage and row mapping; longer input is rejected', async () => {
  const d = device();
  await d.submit('a'.repeat(50000));
  assert.equal(d.api.state.entries[0].note.length, 50000);
  assert.equal(d.api.sheetRows()[0].note.length, 50000);
  await d.submit('b'.repeat(50001));
  assert.equal(d.api.state.entries.length, 1);
  assert.equal(d.el('#note').value.length, 50001);
});

test('rollover opens a blank page, preserves prior entries and keeps unfinished draft read-only', async () => {
  const d = device({ now: '2026-10-18T03:59:58+13:00' });
  await d.submit('Before sleep');
  d.el('#note').value = 'Not sent'; d.el('#note').listeners.input();
  d.clock('2026-10-18T04:00:00+13:00');
  assert.equal(d.api.rollDay(), true);
  assert.equal(d.api.state.today, '2026-10-18');
  assert.equal(d.el('#entries').children.length, 0);
  assert.equal(d.el('#note').value, '');
  d.api.view('2026-10-17');
  assert.equal(d.el('#composer').hidden, true);
  assert.equal(d.el('#entries').children.length, 1);
  assert.equal(d.el('#old-draft-text').textContent, 'Not sent');
  await d.submit('Cannot write into yesterday');
  assert.equal(d.api.state.entries.length, 1);
});

test('draft survives reload; quota errors keep unsent words and existing entries', async () => {
  const d = device();
  d.el('#note').value = 'Draft'; d.el('#note').listeners.input();
  assert.equal(device({ store: d.store }).el('#note').value, 'Draft');
  d.refuseWrites();
  await d.submit('Keep these words');
  assert.equal(d.api.state.entries.length, 0);
  assert.equal(d.el('#note').value, 'Keep these words');
  assert.match(d.el('#notice').textContent, /not saved/);
});

test('unreadable saved log is not overwritten or synced as an empty snapshot', async () => {
  let requests = 0;
  const store = new Map([[KEY, '{broken'], [LINK, JSON.stringify(config)]]);
  const d = device({ store, fetch: async () => { requests++; throw new Error('should not send'); } });
  assert.equal(d.api.state.canSave, false);
  await d.submit('Cannot overwrite');
  d.api.changed(); await d.api.sendLog();
  assert.equal(requests, 0);
  assert.equal(store.get(KEY), '{broken');
  assert.equal(d.api.state.sheetState, 'paused');
});

test('shared setup sends this source only, preserving row IDs, full text and ISO offset', async () => {
  const requests = [];
  const d = device({ store: new Map([[LINK, JSON.stringify(config)]]), fetch: async (url, request) => {
    requests.push({ url, ...JSON.parse(request.body) });
    return { json: async () => ({ ok: true }) };
  } });
  await d.submit('Today\nwith lines'); await d.api.sendLog();
  assert.equal(requests.length, 1);
  const req = requests[0];
  assert.equal(req.url, config.url); assert.equal(req.key, config.key);
  assert.equal(req.source, 'journal_app'); assert.equal(req.rows.length, 1);
  assert.equal(req.rows[0].what, 'journal'); assert.equal(req.rows[0].value, '');
  assert.equal(req.rows[0].note, 'Today\nwith lines');
  assert.equal(req.rows[0].id, d.api.state.entries[0].id);
  assert.match(req.rows[0].time, /\+13:00$/);
  assert.equal('allowShrink' in req, false);
  assert.equal(d.api.state.sheetState, 'sent');
  assert.equal(d.store.has(KEY + '.unsent'), false);
});

test('shrink response pauses sync without dropping unsent marker; failures remain retryable', async () => {
  let response = { ok: false, code: 'shrink', error: 'Snapshot is smaller' };
  const d = device({ store: new Map([[LINK, JSON.stringify(config)]]), fetch: async () => ({ json: async () => response }) });
  await d.submit('Saved'); await d.api.sendLog();
  assert.equal(d.api.state.sheetState, 'paused');
  assert.equal(d.el('#sheet-sync').textContent, 'sync paused');
  assert.equal(d.store.get(KEY + '.unsent'), '1');
  response = { ok: false, error: 'Bad key' }; await d.api.sendLog();
  assert.equal(d.el('#sheet-sync').textContent, 'sync error');
  response = { ok: true }; await d.api.sendLog();
  assert.equal(d.el('#sheet-sync').textContent, 'synced');
});

test('network failure keeps pending entries for online/reopen retry', async () => {
  const d = device({ store: new Map([[LINK, JSON.stringify(config)]]), fetch: async () => { throw new Error('offline'); } });
  await d.submit('Offline entry'); await d.api.sendLog();
  assert.equal(d.store.get(KEY + '.unsent'), '1');
  assert.equal(d.el('#sheet-sync').textContent, 'not synced yet');
  assert.equal(d.api.state.entries.length, 1);
});

test('a submission made during an older request stays queued and is sent in the next snapshot', async () => {
  const snapshots = [];
  let finish;
  const d = device({ store: new Map([[LINK, JSON.stringify(config)]]), fetch: async (url, request) => {
    snapshots.push(JSON.parse(request.body));
    if (snapshots.length === 1) return new Promise((resolve) => { finish = () => resolve({ json: async () => ({ ok: true }) }); });
    return { json: async () => ({ ok: true }) };
  } });
  await d.submit('First');
  const inFlight = d.api.sendLog();
  await d.submit('Second');
  finish(); await inFlight;
  assert.equal(d.store.get(KEY + '.unsent'), '1');
  await d.api.sendLog();
  assert.equal(snapshots[0].rows.length, 1);
  assert.equal(snapshots[1].rows.length, 2);
  assert.equal(d.store.has(KEY + '.unsent'), false);
});
