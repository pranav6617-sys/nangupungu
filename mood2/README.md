# Mood (v2)

A mood check-in at `/nangupungu/mood2/`: three screens, about fifteen seconds, one-handed. It is a web app first (add it to the home screen); Android and iOS wrappers come later. No login, no account: check-ins live on the phone and go to your Google Sheet if the phone is connected to it.

## The screens

1. **Mood.** A field of dots. Touch anywhere: left is unpleasant, right is pleasant, up is high energy, down is low energy. The colour and heartbeat follow the touch. The arrow at the bottom goes on; the arrow at the top clears the touch.
2. **Tension, focus, thinking.** Three blobs, left to right. Drag each up or down, or flick it one step. The middle is your normal and up is more. A sentence at the top builds as you go ("On edge but focused, and thinking is sluggish"). The arrow lights once all three are placed.
3. **Your check-in.** Two sentences made from the first two screens, and an optional note of up to 400 characters. The arrow saves.

**After saving.** The note locks (dimmed, read-only, a padlock and "Saved" under the block). The dots brighten, hold for a moment, then drain toward the block, done by about 1.75 seconds. Four seconds after saving the first screen is back, fresh. With reduced motion turned on the dots simply go. If the phone cannot store the check-in, nothing locks: a red line under the block says why, and the note stays for another try.

**The "?" circle** (top right on every screen) opens a short explanation of that screen. On the first screen it also shows how many check-ins are on the phone, the sheet's state, **Export CSV**, **Export JSON** and, when a sheet is connected, **Send to sheet now**. The phone's back button does what the arrows do, and closes the "?" if it is open.

A check-in left half-finished for more than 15 minutes out of sight is dropped, so a mood is never saved hours late. (`STALE_MS` and `RETURN_MS` at the top of `app.js` are the two times; `MAX_NOTE` in `data.js` and `maxlength` in `source/note.template.html` are the note limit.)

## What is stored

Check-ins are kept in `localStorage` under `mood.v2` (the app asks the browser to keep them). One check-in:

| Field | Meaning |
| --- | --- |
| `id` | `mood_` plus a UUID |
| `at` | when it was saved, NZ time with offset |
| `started_at` | when the first touch on screen one happened |
| `x`, `y` | the cell touched on screen one, 1 to 10: pleasantness and energy |
| `tension`, `focus`, `speed` | the three blobs, 1 to 5, 3 is normal (`speed` is how fast you are thinking) |
| `doing` | the note |

There is no word, no tag and no backdating.

## The Google Sheet

Same contract as the other trackers. Every change sends the whole log as `{key, source: "mood_app_v2", rows}` and the sheet mirrors it. The app never touches v1's `mood_app` rows. Each check-in is one row:

| Column | Content |
| --- | --- |
| `id` | the check-in's id |
| `time` | `at` |
| `what` | `mood` |
| `value` | JSON: `schema_version` 2, `quadrant`, `x`, `y`, `mood` and `energy` (1 to 5, `ceil(x/2)` and `ceil(y/2)`, so v1 and v2 share one series), `tension`, `focus`, `speed` |
| `note` | JSON: `doing` and `started_at` |

Example value: `{"schema_version":2,"quadrant":"high_pleasant","x":9,"y":8,"mood":5,"energy":4,"tension":5,"focus":4,"speed":1}`

Example note: `{"doing":"Slept badly, coffee on an empty stomach.","started_at":"2026-11-13T23:16:15+13:00"}`

Limits that come from the sheet's script:

- It keeps the first 500 characters of a note, and the note column is JSON. The note box stops at 400 characters, and a note whose quotes and line breaks make the JSON longer than 500 is cut to fit, with "Saved · note cut to fit" shown.
- It refuses a send that would remove more than 5 of a source's rows, or that has no rows. The app then shows "Paused" and nothing on the phone is lost. An empty log is never sent.

**Connecting.** Open the usual setup link on this app once: `…/mood2/#log=<web app URL>&key=<key>`. The "?" panel opens and shows the result. The link is stored in `tracking-log.link.v1`, shared with the other trackers on the same site, so a phone that is already connected needs nothing. Never commit the real URL or key.

Unsent check-ins wait on the phone and are retried when the connection returns, when the app comes back to the front, and at 30, 60 and 90 seconds after a failure.

## Export

From the first screen's "?": **Export CSV** and **Export JSON** download `mood-YYYY-MM-DD.csv` or `.json` (NZ date). The CSV columns are `id, time, started_at, quadrant, x, y, mood, energy, tension, focus, speed, note`, with notes quoted where needed. The JSON is `{app, schema_version, exported_at, count, entries}` with the check-ins as stored.

## Installing and updating

Open `/nangupungu/mood2/` in Chrome and use Add to Home screen. The service worker caches the app so it opens instantly and offline. A new version waits until the app is on the first screen with nothing in progress, then reloads once. The cache name is a hash of every file the service worker lists, stamped by the build, so a changed file always means a new cache. If you edit a listed file by hand, run the build (or change the name in `sw.js`).

The font is Geist Mono, cut down to the characters the screens use (`geist-mono-LICENSE.txt`), and is served from this folder, so nothing loads from other sites.

## Building

`index.html` is generated. Screen one's source is `prototype/stipple.html`, edited in place. Screens two and three are `source/blobs.template.html` and `source/note.template.html`; `data.js`, `app.js`, `sw.js` and `manifest.json` are edited directly. After any change:

```
python3 mood2/source/build_app.py     # screens, "?" help, index.html, and the service worker's cache name
python3 mood2/source/build_icons.py   # only if the icon changes
```

`prototype/` holds the three screens and the flow as stand-alone pages, plus earlier explorations.

## Checks

`node --test mood2/tests/*.test.cjs` covers the check-in format, NZ time and daylight saving, the note limits, the sheet rows, export, sync failures and recovery, the shrink guard, the setup link, two open tabs and double saves. It never contacts the real sheet.

The app was also run in Chrome emulating a phone with touch, against a mock of the sheet's script: the full flow in real time and with a stepped clock, the saved sequence (dots brighten then drain, locked note, return at four seconds, double taps saving once), the "?" on every screen, the phone's back button at each step (including while saved and while the help is open), CSV and JSON export with commas, quotes, line breaks, macrons and emoji, offline reload and saving offline, a sheet outage and recovery, a failed save, reduced motion, a half-finished check-in going stale, a service worker update, and the saved label at 412×915, 390×844, 360×780 and 360×640.

## Later: Android and iOS

`data.js` knows nothing about the screens or the browser and `app.js` is the only file that joins them, so a native wrapper can keep both and replace storage and the sheet link. Export is already the way to move data between versions.
