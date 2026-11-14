const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const D = require('../data.js');

const cfg = { url: 'http://localhost:8765/sheet', key: 'test-only' };
const calm = { x: 8, y: 3, tension: 2, focus: 3, speed: 3, doing: '' };
const input = (overrides = {}) => ({ ...calm, ...overrides });

function storage(seed = {}) {
  const map = new Map(Object.entries(seed)); let fail = false;
  return { map, getItem: k => map.get(k) ?? null,
    setItem(k, v) { if (fail && k === D.KEY) throw new Error('quota'); map.set(k, String(v)); },
    removeItem: k => map.delete(k), failWrites() { fail = true; } };
}
function device(options = {}) {
  const local = options.storage || storage();
  if (options.link !== false && local.getItem(D.LINK) === null) local.setItem(D.LINK, JSON.stringify(cfg));
  const requests = [], states = [], timers = new Map(); let id = 0;
  const app = D.createStore({ storage: local, uuid: randomUUID, locks: options.locks,
    schedule(fn, ms) { timers.set(++id, { fn, ms }); return id; }, cancel(id) { timers.delete(id); },
    onStatus: (state, detail) => states.push({ state, detail }),
    fetcher: options.fetcher || (async (url, init) => { requests.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => ({ ok: true }) }; })
  });
  return { app, local, requests, states, timers, add: (data = input(), at = '2026-11-11T07:14:00Z') => app.append(data, new Date(at)) };
}
function lockManager() {
  const tails = new Map();
  return { request(name, callback) {
    const next = (tails.get(name) || Promise.resolve()).catch(() => {}).then(callback);
    tails.set(name, next); return next;
  } };
}
// Run the next scheduled timer (the 900 ms send, or a retry), as the browser would.
async function fire(d) {
  const [id, t] = [...d.timers.entries()].pop(); d.timers.delete(id); await t.fn(); await new Promise(r => setImmediate(r));
}

test('a check-in is the tap, the three blobs and a note; the time is when it was saved, in NZ time', async () => {
  const d = device({ link: false });
  const { entry, trimmed } = await d.add(input({ x: 9, y: 7, tension: 5, focus: 4, speed: 1, doing: 'Slept badly.' }), '2026-11-11T07:14:05Z');
  assert.equal(trimmed, false);
  assert.match(entry.id, /^mood_[0-9a-f-]{36}$/);
  assert.equal(entry.at, '2026-11-11T20:14:05+13:00');                 // NZ daylight time
  assert.equal(entry.started_at, entry.at);                              // no start given: the moment it was saved
  assert.deepEqual(Object.keys(entry).sort(), ['at', 'doing', 'focus', 'id', 'schema_version', 'speed', 'started_at', 'tension', 'x', 'y'].sort());
  assert.equal(entry.schema_version, 2);
  assert.equal(d.app.count(), 1);
  assert.ok(D.validEntry(entry));
});

test('NZ time follows daylight saving: +13:00 in summer, +12:00 in winter', () => {
  assert.equal(D.stamp(new Date('2026-12-25T00:00:00Z')), '2026-12-25T13:00:00+13:00');
  assert.equal(D.stamp(new Date('2026-06-01T00:00:00Z')), '2026-06-01T12:00:00+12:00');
  // The night clocks go back (5 April 2026, 03:00 NZDT becomes 02:00 NZST): both passes through 02:30 are real moments.
  assert.equal(D.stamp(new Date('2026-04-04T13:30:00Z')), '2026-04-05T02:30:00+13:00');
  assert.equal(D.stamp(new Date('2026-04-04T14:30:00Z')), '2026-04-05T02:30:00+12:00');
});

test('started_at keeps the moment the check-in was opened; a bad one falls back to now', async () => {
  const d = device({ link: false });
  const opened = '2026-11-11T20:12:40+13:00';
  assert.equal((await d.add(input({ started_at: opened }))).entry.started_at, opened);
  assert.equal((await d.add(input({ started_at: 'yesterday' }))).entry.started_at, '2026-11-11T20:14:00+13:00');
  assert.equal((await d.add(input({ started_at: '2026-11-11T07:12:40Z' }))).entry.started_at, '2026-11-11T20:14:00+13:00'); // not an NZ offset
});

test('the sheet row: id, time, what and the two JSON columns, with mood and energy folded onto 1 to 5', async () => {
  const d = device();
  const { entry } = await d.add(input({ x: 9, y: 7, tension: 5, focus: 4, speed: 1, doing: 'Coffee on an empty stomach.', started_at: '2026-11-11T20:12:40+13:00' }));
  const [row] = D.sheetRows([entry]);
  assert.deepEqual(Object.keys(row), ['id', 'time', 'what', 'value', 'note']);
  assert.equal(row.id, entry.id); assert.equal(row.time, entry.at); assert.equal(row.what, 'mood');
  assert.equal(typeof row.value, 'string');
  assert.deepEqual(JSON.parse(row.value), { schema_version: 2, quadrant: 'high_pleasant', x: 9, y: 7, mood: 5, energy: 4, tension: 5, focus: 4, speed: 1 });
  assert.deepEqual(JSON.parse(row.note), { doing: 'Coffee on an empty stomach.', started_at: '2026-11-11T20:12:40+13:00' });
});

test('quadrants and the 1 to 5 scale', () => {
  assert.equal(D.quadrantOf(1, 10), 'high_unpleasant');
  assert.equal(D.quadrantOf(10, 10), 'high_pleasant');
  assert.equal(D.quadrantOf(5, 5), 'low_unpleasant');
  assert.equal(D.quadrantOf(6, 6), 'high_pleasant');
  assert.equal(D.quadrantOf(6, 5), 'low_pleasant');
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(D.scaleOf), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
});

test('answers out of range are refused, and nothing is stored', async () => {
  const d = device({ link: false });
  for (const bad of [{ x: 0 }, { x: 11 }, { y: 5.5 }, { tension: 0 }, { focus: 6 }, { speed: '3' }, { x: undefined }, { tension: null }]) {
    await assert.rejects(() => d.add(input(bad)), /out of range/);
  }
  assert.equal(d.app.count(), 0);
  assert.equal(d.local.getItem(D.KEY), null);
});

test('the note: trimmed, line endings plain, 400 characters at most, and never longer than the sheet keeps', () => {
  const at = '2026-11-11T20:14:00+13:00';
  assert.deepEqual(D.fitDoing('  hello\r\nthere  ', at), { doing: 'hello\nthere', trimmed: false });
  assert.deepEqual(D.fitDoing('', at), { doing: '', trimmed: false });
  assert.deepEqual(D.fitDoing(undefined, at), { doing: '', trimmed: false });
  const plain = D.fitDoing('a'.repeat(450), at);
  assert.equal(plain.doing.length, 400); assert.equal(plain.trimmed, true);
  // Quotes and line breaks are longer in JSON. The whole JSON must still fit in 500.
  const nasty = D.fitDoing('"\n'.repeat(200), at);
  assert.ok(JSON.stringify({ doing: nasty.doing, started_at: at }).length <= 500);
  assert.equal(nasty.trimmed, true);
  assert.ok(nasty.doing.length > 100, 'it keeps as much as fits');
  // Emoji are two UTF-16 units each and are never cut in half.
  const emoji = D.fitDoing('😀'.repeat(300), at);
  assert.ok(JSON.stringify({ doing: emoji.doing, started_at: at }).length <= 500);
  assert.ok(!/[\ud800-\udbff]$/.test(emoji.doing));
  assert.equal(emoji.doing, Array.from(emoji.doing).join(''));
  // Macrons and other letters are kept as typed.
  assert.equal(D.fitDoing('Kia ora, Māori', at).doing, 'Kia ora, Māori');
});

test('a long note is saved cut to fit, and the result says so', async () => {
  const d = device({ link: false });
  const { entry, trimmed } = await d.add(input({ doing: 'word '.repeat(150) }));
  assert.equal(trimmed, true);
  assert.ok(entry.doing.length <= 400);
  assert.ok(D.validEntry(entry));
  assert.ok(JSON.stringify(JSON.parse(D.sheetRows([entry])[0].note)).length <= 500);
});

test('saving keeps every check-in in order and changes the revision each time', async () => {
  const d = device({ link: false });
  await d.add(input({ doing: 'one' })); const rev1 = JSON.parse(d.local.getItem(D.KEY)).revision;
  await d.add(input({ doing: 'two' })); const log = JSON.parse(d.local.getItem(D.KEY));
  assert.notEqual(log.revision, rev1);
  assert.deepEqual(log.entries.map(e => e.doing), ['one', 'two']);
  assert.equal(new Set(log.entries.map(e => e.id)).size, 2);
  assert.deepEqual(d.app.entries().map(e => e.doing), ['one', 'two']);
});

test('with a sheet linked, the whole log is sent as {key, source, rows} after a short wait', async () => {
  const d = device();
  await d.add(input({ doing: 'one' }));
  assert.equal(d.requests.length, 0, 'not sent until the timer fires');
  await fire(d);
  assert.equal(d.requests.length, 1);
  assert.equal(d.requests[0].url, cfg.url);
  assert.equal(d.requests[0].body.key, cfg.key);
  assert.equal(d.requests[0].body.source, 'mood_app_v2');
  assert.equal(d.requests[0].body.rows.length, 1);
  assert.equal(d.states.at(-1).state, 'sent');
  await d.add(input({ doing: 'two' })); await fire(d);
  assert.equal(d.requests[1].body.rows.length, 2, 'the second send carries both');
  assert.deepEqual(d.requests[1].body.rows.map(r => JSON.parse(r.note).doing), ['one', 'two']);
  d.app.queue(0); await fire(d);
  assert.equal(d.requests.length, 2, 'an unchanged log is not sent again');
  await d.app.sync(true);
  assert.equal(d.requests.length, 3, 'unless a send is forced');
});

test('with no sheet linked, check-ins stay on the phone and nothing is sent', async () => {
  const d = device({ link: false });
  await d.add(); assert.equal(d.timers.size, 0);
  await d.app.sync();
  assert.equal(d.requests.length, 0);
  assert.equal(d.app.linked, false);
  assert.equal(d.states.at(-1).state, 'local');
});

test('a sheet that cannot be reached leaves the check-in saved and retries at 30, 60 and 90 seconds', async () => {
  const d = device({ fetcher: async () => { throw new Error('offline'); } });
  await d.add(); await fire(d);
  assert.equal(d.states.at(-1).state, 'waiting'); assert.match(d.states.at(-1).detail, /Saved on this phone/);
  assert.equal([...d.timers.values()].pop().ms, 30000);
  await fire(d); assert.equal([...d.timers.values()].pop().ms, 60000);
  await fire(d); assert.equal([...d.timers.values()].pop().ms, 90000);
  await fire(d); assert.equal(d.timers.size, 0, 'then it stops until something wakes it');
  assert.equal(d.app.count(), 1);
});

test('the shrink guard: a refused send pauses sync and keeps the check-ins', async () => {
  const d = device({ fetcher: async () => ({ ok: true, json: async () => ({ ok: false, code: 'shrink', error: 'refused: this would delete 6 of 9 rows' }) }) });
  await d.add(); await fire(d);
  assert.equal(d.states.at(-1).state, 'paused'); assert.match(d.states.at(-1).detail, /refused/);
  assert.equal(d.app.count(), 1);
});

test('another refusal from the sheet shows its message', async () => {
  const d = device({ fetcher: async () => ({ ok: true, json: async () => ({ ok: false, error: 'Wrong key' }) }) });
  await d.add(); await fire(d);
  assert.deepEqual(d.states.at(-1), { state: 'error', detail: 'Wrong key' });
});

test('an empty log is never sent', async () => {
  const d = device();
  await d.app.sync(true);
  assert.equal(d.requests.length, 0); assert.equal(d.states.at(-1).state, 'ready');
});

test('a log that cannot be read pauses saving and sync, and is left untouched', async () => {
  const bad = '{"version":2,"revision":"r","entries":[{"id":"nope"}]}';
  const d = device({ storage: storage({ [D.KEY]: bad }) });
  assert.equal(d.app.start(), false);
  assert.equal(d.states.at(-1).state, 'paused');
  await assert.rejects(() => d.add(), /Unreadable/);
  assert.equal(d.local.getItem(D.KEY), bad);
  assert.equal(d.requests.length, 0);
  assert.equal(d.app.blocked, true);
});

test('a phone that cannot write leaves nothing half-saved', async () => {
  const d = device({ link: false }); d.local.failWrites();
  await assert.rejects(() => d.add(), /quota/);
  assert.equal(d.app.count(), 0);
});

test('the setup link: only a Google web app address, and the sheet must answer', async () => {
  const d = device({ link: false });
  await assert.rejects(() => d.app.setup('https://example.com/exec', 'k'), /does not look right/);
  await assert.rejects(() => d.app.setup('https://script.google.com/macros/s/AKfy_cd-1/exec', ''), /does not look right/);
  assert.equal(await d.app.setup('https://script.google.com/macros/s/AKfy_cd-1/exec', 'k'), true);
  assert.equal(d.requests[0].body.ping, true);
  assert.deepEqual(D.readLink(d.local), { url: 'https://script.google.com/macros/s/AKfy_cd-1/exec', key: 'k' });
  assert.equal(d.app.linked, true);
  const wrong = device({ link: false, fetcher: async () => ({ ok: true, json: async () => ({ ok: false, error: 'Wrong key' }) }) });
  assert.equal(await wrong.app.setup('http://localhost:8765/sheet', 'nope'), false);
  assert.equal(wrong.states.at(-1).state, 'error');
});

test('a link shared with the other trackers needs no setup', async () => {
  const d = device({ storage: storage({ 'tracking-log.link.v1': JSON.stringify({ url: 'https://script.google.com/macros/s/AKfy_cd-1/exec', key: 'shared' }) }) });
  assert.equal(d.app.linked, true);
  await d.add(); await fire(d);
  assert.equal(d.requests[0].body.key, 'shared');
});

test('two tabs saving at the same moment each keep their check-in', async () => {
  const shared = storage(), locks = lockManager();
  const a = device({ storage: shared, locks, link: false }), b = device({ storage: shared, locks, link: false });
  await Promise.all([a.add(input({ doing: 'tab a' })), b.add(input({ doing: 'tab b' }))]);
  assert.deepEqual(a.app.entries().map(e => e.doing).sort(), ['tab a', 'tab b']);
});

test('saving twice at once is refused rather than doubled', async () => {
  const d = device({ link: false, locks: lockManager() });   // the browser always has locks, so the first save is still in flight
  const results = await Promise.allSettled([d.add(input({ doing: 'first' })), d.add(input({ doing: 'second' }))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(d.app.count(), 1);
});

test('export as CSV: one header, one row each, and commas, quotes and line breaks kept inside the note', async () => {
  const d = device({ link: false });
  await d.add(input({ x: 9, y: 7, tension: 5, focus: 4, speed: 1, doing: 'Tired, "wired", and\nlate', started_at: '2026-11-11T20:12:40+13:00' }), '2026-11-11T07:14:05Z');
  await d.add(input({ x: 2, y: 2, doing: '' }), '2026-11-12T07:14:05Z');
  const csv = D.toCsv(d.app.entries());
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'id,time,started_at,quadrant,x,y,mood,energy,tension,focus,speed,note');
  const first = d.app.entries()[0];
  assert.ok(csv.includes(`${first.id},2026-11-11T20:14:05+13:00,2026-11-11T20:12:40+13:00,high_pleasant,9,7,5,4,5,4,1,"Tired, ""wired"", and\nlate"\r\n`));
  assert.match(lines[2], /,low_unpleasant,2,2,1,1,2,3,3,$/, 'an empty note is an empty cell');
  assert.equal(csv.endsWith('\r\n'), true);
  assert.equal(D.toCsv([]), 'id,time,started_at,quadrant,x,y,mood,energy,tension,focus,speed,note\r\n');
});

test('export as JSON: the check-ins as kept, readable back', async () => {
  const d = device({ link: false });
  await d.add(input({ doing: 'one' })); await d.add(input({ doing: 'two' }));
  const text = D.toJson(d.app.entries(), new Date('2026-11-13T09:00:00Z'));
  const back = JSON.parse(text);
  assert.equal(back.app, 'mood'); assert.equal(back.schema_version, 2); assert.equal(back.count, 2);
  assert.equal(back.exported_at, '2026-11-13T22:00:00+13:00');
  assert.deepEqual(back.entries, d.app.entries());
  assert.ok(back.entries.every(D.validEntry));
});

test('export file names carry the NZ date', () => {
  assert.equal(D.exportName('csv', new Date('2026-11-12T20:30:00Z')), 'mood-2026-11-13.csv');   // already the 13th in NZ
  assert.equal(D.exportName('json', new Date('2026-11-12T10:30:00Z')), 'mood-2026-11-12.json');
});
