# OpenReplay v26 — Performance audit and change record

**Baseline:** OpenReplay v25.  **Scope:** performance-only; no intentional changes to interface appearance, feature set, event semantics, saved replay schema, or controls.

## What was inspected

| Area | Reviewed | Changes / conclusions |
|---|---|---|
| CS2 parser | tick/frame parsing, sampled stats, kill/death/utility events, bomb events, grenade trajectories, inventory, position interpolation and flash timing | Reused precomputed sampled frame ticks for grenade and bomb-position lookups, and skipped sorting a tick DataFrame already in order. Kept the same parser event extraction and replay schema. |
| Round calculation | halftime score association, round clock, round markers | Changed an O(rounds × frames) lookup into a forward frame pass. Same round ownership and score output tested. |
| Replay lookups | frame interpolation, roster continuity, seeks/rewinds and dead-player states | Added exact-tick position and roster memoization. Added round-indexed kills/death ticks so frame paint doesn't rescan the entire kill history. Seek to a new or earlier tick recalculates. |
| Scoreboard | kills/assists/deaths/utility damage/enemy flashes, ADR, money, sorting, team names and equipment | Precomputed cumulative event totals per player and tick; kept ADR's existing prefix-sum logic. Cached equipment classification until inventory and C4 carrier change. Avoided rewriting identical text and rebuilding empty placeholders. |
| C4 / defuses | bomb pickup, carrying, drops, planting, countdown, cancellation and player deaths | Cached bomb-state/ownership queries at the exact current tick; existing events, state transitions and timers unchanged. |
| Flash | recorded and sampled blindness intervals, teammate attribution and remaining blind time | Queried per-player intervals rather than all players on each frame; reused per-player sample histories when preparing blind intervals. No change to durations or priority of recorded events. |
| Utility / killfeed | marker filters, trails, effects, impact breakdowns, badge flags, chronological killfeed, and active utility list | Used per-round event indexes. Avoided regenerating the active utility DOM when its displayed content is unchanged. Killfeed display and event ordering unchanged. |
| Canvas & camera | radar images, grid, drag/pan, zoom, drawing, player selection, C4, death layering and text | Reused the static background gradient until resize. Reduced identical redraws while **paused and idle** (30 FPS cap); full playback and map dragging remain uncapped by this pause-only limit. Marked seek, zoom, reset and player/utility changes for immediate redraw. |
| Timeline | both scopes, zoom, pan, player filtering, pin positions, seeking, elapsed/round clock | Controls and DOM geometry left unchanged. Examined regeneration frequency; no broad rewrite to risk event navigation regressions. |
| Local HTTP server | upload streaming, file-size checks, job processing, JSON file response, map fetch/caching, favicon/static assets, port selection | Already streams demo uploads to disk in bounded chunks and serves JSON files without reading all bytes into memory. No changes to HTTP routes or server functionality. |
| Startup | virtualenv creation, dependency installation and launch | Reuses existing `.venv` and checks the last successfully installed requirements before running pip; installs as before on first run or when requirements change. |
| CSS/HTML/branding | page layout, panels, styles and logos | CSS and image assets kept byte-for-byte unchanged. HTML change is only `?v=26` cache-busting on JS/CSS references. |
| Packaging/tests | source, runtime prerequisites, test coverage, startup | Retained original Python/JS dependencies, regression suites and logo assets. Added a frontend optimization regression test and this audit. |

## Measurements and validation

- **Python regression suite:** 64/64 passed.
- **Frontend JavaScript regression suites:** all passed, including an added index/cache test covering forward/backward seeks, stats, death timing, round scores, utility filtering and roster continuity.
- **Chromium visual comparison:** loaded the original v25 and optimized v26 sample replays at 1600, 1366, and 1024px. At the same replay tick, scoreboard content, match scores, round selection, killfeed, timeline markers, utility totals and player filters agreed. Captured 1366×850 screenshots were **pixel-identical** (zero changed pixels).
- **Interaction checks:** playback at 0.25×, selecting a player during playback, pausing, zooming and resetting passed at the three viewport widths with no browser JavaScript errors.
- **Synthetic sample benchmark:** 800 deterministic forward/backward-tick workload steps of roster, counters, equipment, round events, bomb, interpolation and flash queries, run five times in headless Chromium. The first measured medians were **98.2 ms** for v25 versus **38.4 ms** for v26; both produced the same checksum (**425331**). Another run measured **112.7 ms** versus **37.8 ms**, same checksum. This shows substantially less CPU work in the tested hot paths; it is **not** a promise of a particular FPS increase on real demos or other machines.

## Untouched behavior

Player colors, circle sizes, aiming/shooting indicators, C4 marker and bomb/defuse countdown, kills and modifiers, timeline controls/zoom, flash and utility visualizations, scoreboard ordering/stat sorting, player filtering, keyboard selection/drawing, two-floor radar display, official logos and the full page layout remain as in v25.

## What cannot be guaranteed without more data

A real CS2 `.dem` recording was not provided for end-to-end decoding and profiling. This audit therefore cannot establish peak memory use, load times, or exact FPS with a particular long recording, and it cannot rule out every codec/parser, Windows machine, or driver-specific issue. The existing optional radar download service also depends on external availability. Performance improvements are measured with the bundled sample data; real-world results will vary.

## Reproducibility

Within the project root:

```shell
python -m pytest -q
node tests/frontend_optimization.cjs
```

Other frontend suites may be run with `node tests/frontend_*.cjs` individually. Windows users need not install Node to **run** OpenReplay—these are developer regression tests only.
