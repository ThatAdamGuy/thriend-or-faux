# Thriend Or Faux (ToF)

Chrome MV3 extension for **threads.com** by Adam (@thatadamguy on Threads). Hovering a username on Threads shows a stats card under the native hover card; clicking "Analyze posts →" opens a side panel with Claude-generated assessment of whether that person is worth engaging with (verdict, trait chips, reply conduct, flags/positives).

## Project goals

- **A. Engage wisely**: help Threads users quickly assess fellow community members — yes to interesting/kind people, no to trolls.
- **B. Self-insight**: let users privately run a card on themselves to understand/improve their own behavior (future "Analyze me" feature).
- **C. Positive norms**: shareable cards celebrating good actors. *Deliberate decision: positive-only sharing.* Negative verdicts stay private decision-support — public shaming cards were considered and rejected (dogpiling/defamation/ToS risk).

## Architecture (no build step, vanilla JS)

- `manifest.json` — MV3; permissions: storage, tabs, scripting; hosts: threads.com + api.anthropic.com.
- `content.js` — hover-card detection (MutationObserver on `hidden` attr; Threads portals the visible card into a different subtree, so panel show/hide uses **pixel-geometry safe zones, not DOM containment**). Renders hover panel + side panel. Debounces (800ms) before requesting posts.
- `background.js` — service worker. Three messages: `FETCH_PROFILE` (raw HTML fetch + internal `api/v1/users/{id}/info` with `X-IG-App-ID: 238260118697367`), `FETCH_POSTS` (opens **two invisible background tabs** — profile + /replies — and scrapes `thread_items` JSON from the rendered DOM; raw HTML never contains posts, they're injected client-side via GraphQL/Relay, so tabs are unavoidable), `ANALYZE_PROFILE` (Claude `claude-haiku-4-5-20251001`, tool-forced JSON via `report_verdict` tool, user's own API key from `chrome.storage.local`, header `anthropic-dangerous-direct-browser-access: true`).
- Persistent cache: `chrome.storage.local`, keys `tof_c_*`, 12h TTL, 150-entry cap. ↻ refresh link on the panel force-refetches.
- **Remote status / kill switch** (v0.2.2+): background.js fetches `docs/status.json` from the GitHub Pages site (no extra permission — GH Pages sends open CORS) on SW wake, throttled 6h, cached under `tof_status`, **fail-open**. `killSwitch:true` → background refuses the three data messages, content.js shows a notice panel. `minVersion` → hard block + "Update now" button; `latestVersion` → soft nudge (hover panel + side-panel version line). Update button → `REQUEST_UPDATE` message → `chrome.runtime.requestUpdateCheck()`; `onUpdateAvailable` → `reload()`. Actuate by editing status.json and pushing.
- `panel.css`, `settings.html/js` (API-key popup), `about.html` (panel footer text; version line auto-appended from manifest).
- **Trait vocabulary lives in two places that must stay in sync**: enum in `background.js` (`TRAIT_VOCAB`), color sets in `content.js` (`TRAITS_POSITIVE`/`TRAITS_NEGATIVE`).

## Gotchas

- `content.js` `openSidePanel` has a locale time string with an invisible narrow no-break space — exact-match edits on that line fail; edit around it.
- Threads appends "See the latest conversations with @user." boilerplate to og:description; stripped via `indexOf`, not regex.
- Atlas browser support was dropped deliberately (its `tabs.create` callback is broken; Atlas is deprecated).
- Reload extension via chrome://extensions ↻ after edits; check `[ToF] loaded` in the page console.

## Status & plans (as of July 1 2026, v0.2.2)

- Site LIVE at https://thatadamguy.github.io/thriend-or-faux/ (GitHub Pages from /docs of public repo ThatAdamGuy/thriend-or-faux). Compass logo (v0.2.1) replaced the placeholder blue square.
- **v0.2.1 submitted to Chrome Web Store** (Private visibility, tester group tof-testers@googlegroups.com, non-trader) — awaiting review.
- v0.2.2 (remote status/kill switch) built locally; **do not upload while 0.2.1 review is pending** — zip is `tof-0.2.2.zip`.
- Domain thriendorfaux.com purchased, not yet wired to Pages.
- Deferred ideas: "Analyze me" self-card, positive-only shareable card images, multi-LLM support (rejected for now — Claude only).
