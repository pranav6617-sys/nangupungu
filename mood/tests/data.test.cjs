const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const D = require('../data.js');
const cfg = { url: 'http://localhost:8765/sheet', key: 'test-only' };
const values = { mood: 2, energy: 4, tension: 5, irritability: 1, thought_speed: 3 };
const input = (overrides = {}) => ({ ratings: { ...values }, feelings: [], doing: '', company: '', ...overrides });
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
  return { app, local, requests, states, timers, add: (data = input(), at = '2026-10-18T01:00:00Z') => app.append(data, new Date(at)) };
}
function lockManager() {
  const tails = new Map();
  return { request(name, callback) {
    const next = (tails.get(name) || Promise.resolve()).catch(() => {}).then(callback);
    tails.set(name, next); return next;
  } };
}
test('five independently required ratings; 32 distinct words across four equal quadrants', () => {
  assert.equal(D.RATINGS.length, 5); assert.equal(D.complete({}), false);
  assert.equal(D.complete(values), true);
  for (const def of D.RATINGS) {
    for (const value of [null, undefined, 0, 6, 2.5, '3']) assert.equal(D.complete({ ...values, [def.id]: value }), false);
    assert.equal(def.labels.length, 5);
  }
  assert.equal(new Set(D.WORDS).size, 32);
  assert.ok(D.QUADRANTS.every(q => q.words.length === 8));
  assert.deepEqual(D.mapPoint({ mood: 3, energy: 3 }), { x: 392, y: 392 });
  assert.ok(D.mapPoint({ mood: 1, energy: 5 }).x < 392);
  assert.ok(D.mapPoint({ mood: 1, energy: 5 }).y < 392);
  assert.ok(D.mapPoint({ mood: 5, energy: 1 }).x > 392);
  assert.ok(D.mapPoint({ mood: 5, energy: 1 }).y > 392);
  assert.equal(D.startingQuadrant({ mood: 1, energy: 5 }), 'high-unpleasant');
  assert.equal(D.startingQuadrant({ mood: 5, energy: 5 }), 'high-pleasant');
  assert.equal(D.startingQuadrant({ mood: 1, energy: 1 }), 'low-unpleasant');
  assert.equal(D.startingQuadrant({ mood: 5, energy: 1 }), 'low-pleasant');
});
test('NZ timestamps retain the correct summer, winter and DST-transition offsets', () => {
  assert.equal(D.stamp(new Date('2026-10-18T01:00:00Z')), '2026-10-18T14:00:00+13:00');
  assert.equal(D.stamp(new Date('2026-07-18T01:00:00Z')), '2026-07-18T13:00:00+12:00');
  assert.equal(D.stamp(new Date('2026-09-26T13:59:59Z')), '2026-09-27T01:59:59+12:00');
  assert.equal(D.stamp(new Date('2026-09-26T14:00:00Z')), '2026-09-27T03:00:00+13:00');
  assert.equal(D.stamp(new Date('2026-04-04T13:59:59Z')), '2026-04-05T02:59:59+13:00');
  assert.equal(D.stamp(new Date('2026-04-04T14:00:00Z')), '2026-04-05T02:00:00+12:00');
});
test('optional pages may be empty; required ratings cannot be omitted or silently filled', async () => {
  const d = device();
  await assert.rejects(d.add(input({ ratings: { mood: 3 } })));
  assert.equal(d.app.read().entries.length, 0);
  const entry = await d.add();
  assert.deepEqual(entry.feelings, []); assert.equal(entry.doing, ''); assert.equal(entry.company, '');
  assert.deepEqual(entry.ratings, values);
  assert.equal(d.app.read().entries.length, 1);
});
test('multiple words and literal context survive reload with the same ID and timestamps', async () => {
  const d = device();
  const detail = input({ feelings: ['Anxious', 'Hopeful', 'Calm'], doing: '<script>alert(1)</script>\nMaking lunch', company: '=SUM(1,2)', started_at: '2026-10-18T13:59:30+13:00' });
  const entry = await d.add(detail);
  const reloaded = device({ storage: d.local });
  assert.deepEqual(reloaded.app.read().entries, [entry]);
  const rows = D.sheetRows(reloaded.app.read().entries);
  assert.equal(rows.length, 1); assert.equal(rows[0].id, entry.id); assert.equal(rows[0].time, entry.at);
  assert.equal(rows[0].what, 'mood');
  assert.deepEqual(JSON.parse(rows[0].value), { schema_version: 1, scale: '1–5', ...values, feelings: detail.feelings });
  assert.deepEqual(JSON.parse(rows[0].note), { doing: detail.doing, company: detail.company, started_at: detail.started_at });
  assert.equal(rows[0].note[0], '{'); // Raw context cannot become a Sheets formula.
});
test('invalid words, duplicate selections, overlong contexts and reversed clocks cannot be saved', async () => {
  const d = device();
  for (const change of [{ feelings: ['Unknown'] }, { feelings: ['Calm', 'Calm'] }, { doing: 'a'.repeat(2001) }, { company: 'b'.repeat(2001) }, { started_at: '2027-01-01T12:00:00+13:00' }]) await assert.rejects(d.add(input(change)));
  assert.equal(d.app.read().entries.length, 0);
  await d.add(input({ doing: 'a'.repeat(2000), company: 'b'.repeat(2000), feelings: D.WORDS }));
  assert.equal(d.app.read().entries[0].feelings.length, 32);
});
test('fast duplicate submit is ignored while one append holds the lock', async () => {
  const d = device({ locks: lockManager() });
  const first = d.add(), second = d.add();
  assert.equal(await second, null); assert.ok(await first);
  assert.equal(d.app.read().entries.length, 1);
});
test('local storage failure leaves the previous entries intact and sends no new snapshot', async () => {
  const d = device(); await d.add(); await d.app.sync();
  const original = d.local.getItem(D.KEY), receipt = d.local.getItem(D.ACK);
  d.local.failWrites(); await assert.rejects(d.add(input({ doing: 'Keep this in the form' })));
  assert.equal(d.local.getItem(D.KEY), original); assert.equal(d.local.getItem(D.ACK), receipt);
  assert.equal(d.requests.length, 1);
});
test('corrupt local data is never overwritten or sent as an empty snapshot', async () => {
  for (const raw of ['bad json', '[]', '{"version":1,"revision":"x","entries":[{}]}']) {
    const d = device({ storage: storage({ [D.KEY]: raw }) });
    assert.equal(d.app.start(), false); await d.app.sync(); await assert.rejects(d.add());
    assert.equal(d.local.getItem(D.KEY), raw); assert.equal(d.requests.length, 0); assert.equal(d.app.blocked, true);
  }
});
test('an empty browser never replaces an existing sheet snapshot', async () => {
  const d = device(); await d.app.sync(true);
  assert.equal(d.requests.length, 0); assert.equal(d.app.state, 'ready');
});
test('snapshot uses its own source and standard contract; sync receipts survive reload', async () => {
  const d = device(); await d.add(); await d.app.sync();
  const body = d.requests[0].body;
  assert.deepEqual(Object.keys(body).sort(), ['key', 'rows', 'source']); assert.equal(body.source, 'mood_app');
  assert.deepEqual(Object.keys(body.rows[0]).sort(), ['id', 'note', 'time', 'value', 'what']);
  assert.equal(d.app.state, 'sent');
  const again = device({ storage: d.local }); await again.app.sync(); assert.equal(again.requests.length, 0);
  await again.app.sync(true); assert.equal(again.requests.length, 1);
});
test('an entry added while a send is in flight stays pending and appears in the next snapshot', async () => {
  let finish; const payloads = [];
  const d = device({ fetcher: async (url, request) => {
    payloads.push(JSON.parse(request.body));
    if (payloads.length === 1) await new Promise(resolve => { finish = resolve; });
    return { json: async () => ({ ok: true }) };
  } });
  await d.add(); const send = d.app.sync();
  await d.add(input({ feelings: ['Calm'] })); finish(); await send;
  assert.equal(payloads[0].rows.length, 1); assert.equal(d.app.state, 'waiting');
  assert.notEqual(JSON.parse(d.local.getItem(D.ACK)).revision, d.app.read().revision);
  await d.app.sync(); assert.equal(payloads[1].rows.length, 2); assert.equal(d.app.state, 'sent');
});
test('network failures remain pending across reload; shrink/errors do not erase local check-ins', async () => {
  const fail = device({ fetcher: async () => { throw new Error('offline'); } });
  await fail.add(); await fail.app.sync(); assert.equal(fail.app.state, 'waiting');
  assert.equal(fail.local.getItem(D.ACK), null);
  const resumed = device({ storage: fail.local }); await resumed.app.sync(); assert.equal(resumed.requests[0].body.rows.length, 1);
  for (const response of [{ ok: false, code: 'shrink', error: 'Protecting existing rows' }, { ok: false, error: 'Invalid source' }]) {
    const d = device({ fetcher: async () => ({ json: async () => response }) });
    const entry = await d.add(); await d.app.sync();
    assert.deepEqual(d.app.read().entries, [entry]); assert.equal(d.local.getItem(D.ACK), null);
    assert.equal(d.app.state, response.code === 'shrink' ? 'paused' : 'error');
  }
});
test('two tabs serialize appends and sync snapshots through named locks', async () => {
  const local = storage(), locks = lockManager(); let release; const snapshots = [];
  const fetcher = async (url, request) => {
    snapshots.push(JSON.parse(request.body));
    if (snapshots.length === 1) await new Promise(resolve => { release = resolve; });
    return { json: async () => ({ ok: true }) };
  };
  const a = device({ storage: local, locks, fetcher }), b = device({ storage: local, locks, fetcher });
  await Promise.all([a.add(input({ doing: 'A' })), b.add(input({ doing: 'B' }))]);
  assert.equal(a.app.read().entries.length, 2);
  const first = a.app.sync(); await Promise.resolve(); await Promise.resolve();
  await b.add(input({ doing: 'C' })); const second = b.app.sync();
  release(); await Promise.all([first, second]);
  assert.deepEqual(snapshots.map(s => s.rows.length), [2, 3]);
  assert.equal(JSON.parse(local.getItem(D.ACK)).revision, a.app.read().revision);
});
test('shared setup accepts only supported URLs; source settings and existing tracker data stay intact', async () => {
  const d = device({ link: false }); d.local.setItem('journal.v1', 'keep');
  await assert.rejects(d.app.setup('https://evil.example/data', 'key'));
  assert.equal(d.local.getItem(D.LINK), null);
  assert.equal(await d.app.setup(cfg.url, cfg.key), true);
  assert.deepEqual(d.requests[0].body, { key: cfg.key, ping: true });
  assert.equal(d.local.getItem('journal.v1'), 'keep'); assert.equal(d.app.linked, true);
});
test('a changed destination does not reuse the previous destination’s receipt', async () => {
  const d = device(); await d.add(); await d.app.sync();
  d.local.setItem(D.LINK, JSON.stringify({ ...cfg, url: 'http://localhost:8765/new-sheet' }));
  const reopened = device({ storage: d.local }); await reopened.app.sync();
  assert.equal(reopened.requests.length, 1); assert.equal(reopened.requests[0].url, 'http://localhost:8765/new-sheet');
});
