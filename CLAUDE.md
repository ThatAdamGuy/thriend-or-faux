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
- Trait chips arrive from Claude as `{word, valence}` — free-form adjective, valence judged in context (positive/neutral/negative → green/gray/red). `content.js` keeps `LEGACY_TRAITS_*` sets only to color bare-string traits from analyses cached under the old fixed-vocabulary schema.

## Decisions already made — don't relitigate

- **Claude only, no multi-LLM support.** Adding Gemini/OpenAI/etc. was considered and set aside to avoid scope creep; revisit only if Adam raises it again.
- **BYO Anthropic API key, not a shared backend.** Users paste their own key into the settings popup; no server proxy exists today. Key-friction (the $5 minimum funding, the concept itself) is a known adoption filter, tracked for later, not urgent while testers are technical early adopters. Options on file if it becomes a blocker, in priority order: "Sign in with Claude" OAuth (billing to the user's existing subscription — research current availability/eligibility before building, status unverified as of writing), Chrome's on-device Gemini Nano (free, no account, noticeably lower quality), a small proxy behind Adam's own key (works today for invite-only testers, needs per-tester tokens + rate limits before any public exposure). Rejected: free-tier Gemini keys (reopens multi-LLM scope), using claude.ai session cookies (ToS violation, risks the user's account).
- **Positive-only public sharing (Goal C).** Public "callout" cards for negative/suspicious verdicts were explicitly considered and rejected — dogpiling/defamation/ToS risk. Negative verdicts stay private, in-panel decision support only; any future "shareable card image" feature must stay positive-only ("Certified Thriend" style, not the reverse).
- **Chrome Web Store: Private visibility + trusted-tester emails/group, not Unlisted.** Private restricts install to specific Google accounts; Unlisted is installable by anyone who has the link. Invite-only intent means Private is correct.
- **Rejected: replicating "About this profile" (country-of-origin) via Meta's internal Bloks API.** A similar tool (github.com/owjs3901/threads-country-badge) forges Meta's internal, CSRF-protected `BarcelonaProfileAboutThisProfileAsyncActionQuery` endpoint using `fb_dtsg`/`lsd` tokens harvested from the page's own authenticated requests. Rejected for three reasons: (1) uses the user's own authenticated session to hit an internal API not meant for programmatic/bulk use — materially worse ToS/legal footing than ToF's current approach of reading logged-out public pages in a background tab; (2) risks the *user's own Threads account* being flagged for automation, unlike ToF's current anonymous fetches; (3) conflicts with Goal C — ambient, automatic geography-broadcasting on every hover invites profiling in a way a deliberate one-click "About this profile" doesn't. If geography comes up again: bio/external-URL text is already in Claude's analysis prompt and is the only geography signal worth using.
- **Same GitHub repo for extension code + public docs/ site, not split repos.** Code is public (Adam's call — no secrets in the repo; each user's API key lives only in their own chrome.storage.local, never committed). Revisit only if Adam wants the extension source private later.
- **Atlas browser: unsupported, dropped deliberately.** Its `tabs.create` callback is broken for certain sub-paths (e.g. `/replies`); a working sequential-tab fallback was built and then removed once Atlas was judged not worth supporting (deprecated browser).

## Gotchas

- `content.js` `openSidePanel` has a locale time string with an invisible narrow no-break space — exact-match edits on that line fail; edit around it.
- Threads appends "See the latest conversations with @user." boilerplate to og:description; stripped via `indexOf`, not regex.
- Atlas browser support was dropped deliberately (its `tabs.create` callback is broken; Atlas is deprecated).
- Reload extension via chrome://extensions ↻ after edits; check `[ToF] loaded` in the page console.

## Status & plans (as of July 2 2026)

- **Chrome Web Store: v0.2.1 approved, then v0.2.3 submitted and also approved** (Private visibility, tester group, non-trader) — v0.2.3 is the live store version; listing not yet publicized to testers.
- Site LIVE at custom domain **https://thriendorfaux.com** (old https://thatadamguy.github.io/thriend-or-faux/ URL still resolves/redirects — kept as the internal kill-switch fetch target in background.js for durability).
- `docs/status.json` is correctly synced: `latestVersion`/`minVersion` both `"0.2.3"`.
- **Working tree is v0.2.4** — one small change ahead of the approved v0.2.3 store listing: ThriendOrFaux.com branding added to the card footer + settings popup. Not yet uploaded; no rush, can ride along with the next batch of changes.
- Deferred ideas: "Analyze me" self-card, positive-only shareable card images.
