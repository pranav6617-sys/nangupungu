# Journal

Open `journal/` on the same GitHub Pages site as the other trackers. Each submission is a permanent, timestamped plain-text entry. A page runs from 04:00 to 03:59 in `Pacific/Auckland`, including daylight-saving changes. Previous days are read-only. Drafts stay on this device; an unfinished draft at rollover appears read-only under its original day and is never sent automatically.

The app reuses the sync block from `daylog/index.html` and the shared `tracking-log.link.v1` setting. If a tracker is already configured in this Chrome profile, no new setup is needed. Otherwise open the existing setup link with `#log=<encoded URL>&key=<key>` on the journal. Never put that real URL/key in source, an issue, or a PR.

Each submitted entry becomes `{id, time, what: 'journal', value: '', note}` within the usual `{key, source: 'journal_app', rows}` snapshot. The deployed Apps Script supplies `source` and `logged`, preserves first-seen `logged` values, and enforces its existing shrink guard. A shrink response shows **sync paused**. The journal has no delete action and never sends `allowShrink`.

As with the existing trackers, local storage holds the working log and the sheet receives snapshots; this does not download or merge sheet rows from another device. Use the same browser/profile for recording. Notes support 50,000 characters, retain line breaks, and render as text. No external fonts, libraries, or analytics are loaded.

## Checks

Run `node --test journal/tests/journal.test.cjs` from the repository root. The checks exercise day boundaries, NZ daylight saving, immutable entries, reload/drafts, sync payloads, shrink/error responses, storage failure, and adding an entry during an in-flight sync. Google calls are mocked; the tests never contact the real sheet.

For Chrome: check phone-width layout, submit two entries, reload, open history, and check the sync status using the existing setup. Use disposable test text only if deliberately checking the live sheet, since submitted entries cannot be deleted in the UI. A newly opened browser or another origin does not share your saved setup.

`sw.js` caches only this app's shell and clears only older `journal-` caches. Bump `CACHE` on each subsequent change. Existing trackers and the Apps Script are unchanged.
