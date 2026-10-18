# Mood

A fast, fixed-screen mood check-in at `/nangupungu/mood/`. The interface is dark, has no page scrolling and uses deliberate tap targets rather than draggable controls.

1. Five required ratings: mood, energy, tension, irritability and thought speed. Each has five labelled positions and starts unselected.
2. An optional set of 32 everyday feeling words. The words are divided evenly across pleasantness and energy quadrants. Mood and energy open a suggested quadrant; the other three are always one tap away. Choose any number of words, including none.
3. One optional sentence about the moment. Submit saves the complete check-in and returns to a blank first screen. Back preserves the current answers, while a fresh launch always opens on screen one.

The four feeling areas are shown one at a time so the buttons remain large without panning or scrolling. There is no decorative movement or drag interaction. System reduced-motion preferences are respected by the small state transitions supplied by the browser.

## Storage and Google Sheet

Local records remain in `mood.v1`, so existing check-ins continue to work. Each append-only record has a UUID, NZ submission time (including daylight-saving offset), first-answer time, all five ratings, selected words and context. The new single sentence is stored in the existing `doing` field and `company` remains empty; this avoids a data migration or Apps Script change.

The app reuses the existing `tracking-log.link.v1` configuration. Open it in the same browser/profile as a configured tracker; otherwise use the existing setup link with `#log=<encoded URL>&key=<key>`. Endpoint URLs and keys must never be committed. The header distinguishes local-only, pending, syncing, synced and paused states.

The request is the existing `{key, source: "mood_app", rows}` snapshot contract. Each check-in is one row:

| Column | Content |
| --- | --- |
| `id` | Stable `mood_<uuid>` |
| `time` | Submission time as NZ ISO8601 |
| `what` | `mood` |
| `value` | JSON: `schema_version`, `scale`, five ratings and `feelings` |
| `note` | JSON: `doing` (the optional sentence), empty `company`, and `started_at` |
| `source`, `logged` | Supplied by the existing Apps Script |

The app never sends an empty log, never requests `allowShrink`, pauses on the server's shrink response and keeps a local copy on network failure. A receipt tracks the exact revision sent, while Web Locks serialize appends and sends across tabs. There is no device-to-device restore or sheet download.

The five-rating check-in is a custom research-informed design, not a validated clinical instrument. The quadrant is an organising aid, not a diagnosis or inferred emotion.

## Installation and checks

The manifest ID, launch URL and scope are `/nangupungu/mood/`. The service worker caches only this app's shell; bump `CACHE` whenever a shell asset changes.

Run `node --test mood/tests/*.test.cjs` from the repository root. The tests cover the real event handlers in an isolated DOM, optional-page flow, quadrant starting point and switching, multi-selection, persistence, sync safety and timestamps. They do not contact the live Sheet.
