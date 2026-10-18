# Mood

A three-screen, mobile-first check-in at `/nangupungu/mood/`.

1. Five required ratings: mood, energy, tension, irritability and thought speed. Each has five labelled positions and starts unselected. Tap, drag or use the radio group's arrow keys.
2. An optional map of 32 everyday feeling words, eight in each pleasantness/energy quadrant. Mood and energy suggest the initial scroll position. All quadrants remain available; choose any number of words, including none. Native touch scrolling has momentum; mouse dragging and four area buttons are also supported.
3. Two optional plain-text fields: “What am I doing?” and “Who am I with?” Submit saves the complete check-in and resets to an empty screen one. Back preserves the current answers. Fresh page loads always start at screen one; unfinished check-ins are not persisted.

Motion uses CSS spring easing, a gently floating flower, selection bounces and a short saved bloom. Feeling targets do not drift. The motion button and system reduced-motion preference stop animation.

## Storage and Google Sheet

Local records are stored in `mood.v1`. They are append-only, with a UUID, NZ submission time (including the correct daylight-saving offset), the time the first rating was chosen, all five ratings, the chosen words and both context fields. Context fields allow 2,000 characters each. No default rating, composite score, diagnosis or inferred emotion is saved.

The app reuses the existing `tracking-log.link.v1` configuration. Open it in the same browser/profile as a configured tracker; otherwise use the existing setup link with `#log=<encoded URL>&key=<key>`. Real endpoint URLs and keys must never be added to source, screenshots or pull requests. The header distinguishes local-only, pending, syncing, synced and paused states; tap it to retry or see setup guidance.

The request is the existing `{key, source: "mood_app", rows}` snapshot contract. Each check-in is one row:

| Column | Content |
| --- | --- |
| `id` | Stable `mood_<uuid>` |
| `time` | Submission time as NZ ISO8601 |
| `what` | `mood` |
| `value` | JSON object: `schema_version`, `scale: "1–5"`, `mood`, `energy`, `tension`, `irritability`, `thought_speed`, `feelings` |
| `note` | JSON object: `doing`, `company`, `started_at` |
| `source`, `logged` | Supplied by the existing Apps Script |

The rating arrays and 32-word vocabulary are defined in `data.js`. The JSON is intentional: it preserves the individual dimensions and empty optional fields within the existing seven-column sheet. Claude or a separate analysis tab can parse it without a new Apps Script deployment. The five-item check-in is a custom research-informed design, not a validated clinical instrument; the word positions are approximate guides.

The app never sends an empty log, never requests `allowShrink`, pauses on the server's shrink response, and preserves a local copy on every network failure. A receipt records the exact local revision successfully sent, so an entry saved during an in-flight request stays pending. Chrome Web Locks serialize concurrent appends and sends across tabs. No device-to-device restore or sheet download is implemented, matching the existing trackers; use one browser/profile for recording.

No changes to existing trackers, the Apps Script or its deployment are required by this client implementation. Acceptance by the actual deployed server still needs verification using the user's configured browser; automated checks use a fake endpoint only.

## Installation and offline use

The manifest's ID, launch URL and scope are explicitly `/nangupungu/mood/`, distinct from the other apps. It includes PNG icons at 192 and 512 pixels. After the first online visit, the service worker caches this app's shell only. New versions wait until the previous app closes; there is no forced reload over an unfinished check-in. Bump `CACHE` in `sw.js` when any shell asset changes.

## Checks

Run `node --test mood/tests/*.test.cjs` from the repository root. These cover the real UI event handlers in an isolated DOM harness, the optional-page flow, reset/back navigation, multi-selection, persistence, JSON row mapping, NZ timestamps/DST, storage failure, corrupt logs, retries and in-flight/concurrent saves. They do not render a browser and never contact the real Sheet.

Before calling a release visually verified, check in Chrome at phone width: slider taps/drags, vertical page scrolling, all map areas, touch momentum, keyboard navigation, context input with the on-screen keyboard, reduced motion, install identity and offline reload. Use real intended check-ins for live sync, or deliberately labelled disposable data; the UI has no delete action.
