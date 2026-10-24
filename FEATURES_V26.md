## OpenReplay v26 — Performance-only optimization (October 2026)

This is **v25 with an optimization-only implementation pass**. No visual redesign, gameplay interpretation change, new toggle, altered timeline semantics, or feature removal. All displayed scores, markers, kills, grenade effects, bomb timers, player selection behavior, map coordinates, control positions, and styling are retained. The only user-facing difference should be lower overhead and faster repeat startup.

### Changes made

- **Replay event indexes (frontend):** build per-round kill and utility indexes once, preserving original event ID and order. Stop copying/scanning every match event each time the radar or event dock renders.
- **Scoreboard counter indexes:** precompute cumulative kills, deaths, assists, utility damage and enemy flash counts by player/tick. Binary-search them on seeks, including backward seeks, instead of rescanning events for every stat cell on every update.
- **Dead-player lookup:** precompute per-round per-player death ticks instead of scanning all kills every redraw. Preserve dead-player layer and HP behavior.
- **Snapshot and bomb memoization:** cache interpolated motion frames, roster snapshots, C4 ownership, and C4/defuse state for the exact current tick. Cache is discarded when a new demo is loaded, and a different seek tick gets fresh values.
- **Flash queries:** index already-decoded flash intervals by player and traverse a player's samples once, avoiding full-match per-player searches. Blind countdown and teammate flash attribution are unchanged.
- **Equipment:** cache classified loadouts while the inventory snapshot and bomb carrier have not changed; avoid rebuilding identical chips and rewriting unchanged scoreboard text. Reuse placeholder rows rather than creating/removing them each scoreboard refresh.
- **Round score preprocessing:** use a forward pass through sorted demo position frames when associating frames with rounds, rather than searching from the start for every round.
- **Canvas:** reuse the static background gradient until the canvas size changes. During paused/static viewing, draw up to 30 FPS instead of continuously repainting at 60 FPS; dragging or running playback remains unrestricted by this idle cap. Seeking, player selection, and zooming invalidate the idle render deadline immediately.
- **Backend parsing:** reuse an already-built frame-tick lookup for grenade throw origins and bomb pickup/drop position interpolation. Skip re-sorting tick DataFrames when they are already chronological. The output schema and numeric interpolation are unmodified.
- **Windows startup:** reuse the existing Python virtual environment, and skip redundant `pip install` on subsequent launches unless `requirements.txt` changes. The normal dependency installation is retained for first launch or changed dependencies.
- **Release identification:** frontend references use `v=26` to prevent earlier JS/CSS being cached, and the terminal identifies v26 while keeping all UI labels unchanged.

### Verification and limitations

- All **64 historical Python tests** pass, plus new frontend optimization regression checks.
- All bundled frontend JavaScript regression checks pass, including v25 killfeed modifier ordering.
- Chromium sample replay at **1600, 1366 and 1024 pixels**: original v25 and optimized v26 produced exactly matching scoreboard, timeline, killfeed, player filtering, scores, and utility counts at the same sample tick. The 1366px screenshots were pixel-for-pixel identical.
- In a deterministic headless Chromium sample of **800 mixed-tick replay lookups** (roster + all player counters + equipment + utility + kills + C4 + interpolated position + flash), the original v25 median was **98.2 ms** and the optimized build median was **38.4 ms** over five repetitions; result checksums were exactly equal (**425331**). These are local synthetic workload measurements, not guaranteed frame-rate or real-demo parsing results.
- **No real `.dem` file was provided** for end-to-end validation; this audit cannot guarantee every unusual recording, device or library version is fault-free. A locally available Chromium browser and Python were used for these tests.

### Audit coverage

Inspected `parser.py` (events, rounds, stats, trajectories, inventory, defuses), `server.py` (upload streaming, asynchronous parsing jobs, JSON delivery, radar metadata/image caching, local ports), `static/app.js` (replay clock, seeks, frame interpolation, HUD, canvas map, C4, flashes, trails, drawing, selection, killfeed, leaderboard, timeline, utility and filters), `static/styles.css`/`static/index.html` (layout and controls), `start_windows.bat` (startup), assets, requirements and historical tests. Unchanged code paths were intentionally left untouched rather than rewriting working features.

---

## OpenReplay v25 — Correct CS2 kill modifiers

- **Blind kills** and **airborne kills** show orange `BLIND` and `AIR` badges **before the killer's name**, in that order, only when the recorded `player_death` event flags are set. Both may appear on the same kill.
- **No-scope kills** show the orange `NS` badge by the weapon and before the victim, alongside headshot/wallbang/through-smoke flags when recorded.
- The parser recognizes `attackerblind`, `attackerinair`, `noscope` and their supported aliases. It does not infer undocumented modifier flags from simulated player motion.
- **Flash assists** keep their orange `FLASH` badge before the assisting player's name, and modifier badges are not duplicated. All prior playback, filtering and interface features are preserved.
- Frontend assets are versioned `v=25`, and the launcher identifies itself as OpenReplay v25 to help avoid loading an old server.

## OpenReplay v24 — Team heading fallback and flash-assist placement

- **Team headings:** When the demo includes legitimate custom team names, display those; otherwise show **COUNTER-TERRORISTS** and **TERRORISTS** (instead of **CT SIDE / T SIDE**). Existing halftime side-following behavior remains unchanged.
- **Killfeed:** For a CS2-awarded flash assist, show **FLASH** directly before the assister’s name (`attacker + [FLASH] assister [weapon] victim`). The badge is not beside the weapon and does not create an independent event. Other assist and kill modifiers remain unchanged.
- Frontend assets are cache-busted to `v=24`, and the launcher identifies itself as OpenReplay v24.

## OpenReplay v23 — Scoreboard and radar legibility corrections

- **Team names:** the CT/T leaderboard headings use the real round-specific `team_names` recorded by the demo when available. If no genuine clan/team names are present, the labels read **CT SIDE** / **T SIDE** instead of the full `COUNTER-TERRORISTS` / `TERRORISTS` strings. In the fictional sample only, these read **SAMPLE TEAM ALPHA** and **SAMPLE TEAM BRAVO**, exchanging sides at halftime. OpenReplay does not invent team names for real demos.
- **Quarter speed:** the **0.25×** button sits immediately before **0.5×**, is clickable and keeps the selected highlight. It advances replay at exactly 25% of normal speed.
- **HE damage radius:** only the visual radius ring is rendered; the `≈350` radius text is not drawn.
- **Uniform utility labels:** live flash countdowns (`BLIND X.Xs`), flash explosions, smoke, fire, decoy and trajectory labels are **11px**, with a narrow outline. Player names retain their original font size.
- **Caching fix:** local HTML, CSS, JS are sent with `no-store`, and JS/CSS assets carry `v=23` so an old page cannot silently disguise the new changes. The launcher now detects an older OpenReplay server and opens v23 on the next available local port, avoiding the stale page.

## OpenReplay v21 — Logo update

- Replaces the old top-left icon, text logo, and subtitle with the supplied wide OpenReplay logo.
- Uses the supplied square artwork for `.ico`, PNG favicons and Apple touch icon.
- The original supplied logos are preserved in `static/openreplay-wide.png` (transparent edges trimmed) and `static/openreplay-square.png`.
- No replay logic, layout panels, events or parsing behavior changed.

## OpenReplay v20 adjustments

- Killfeed weapon labels now use the canonical CS2 weapon-name table (e.g. `elite` → **Dual Berettas**, `m4a1_silencer` → **M4A1-S**), including silencer variants and knife names. Unknown items use readable text rather than invented icons.
- Match-round list shows **Round 01**, **Round 02**, etc. without the repeated left-side ordinal.
- Leaderboard team-color dots use a true 9×9-pixel circle and fixed flex basis.

# OpenReplay — CS2 2D Demo Reviewer

## OpenReplay v18 — Remove LOS and fix loadout categories (October 2026)

- **LOS temporarily removed:** The LOS button, sight cones, optional collision-mesh API, Awpy setup script, and geometry import files have been removed. Radar direction indicators and the existing drawing/selection controls are unchanged.
- **Inventory corrections:** All recorded C4 aliases collapse to **one C4 chip in the Bomb category**, never in Other. High Explosive Grenade (HE) and Incendiary Grenade are recognized in the Utility category even when the parser provides full in-game display names instead of internal identifiers. The loadout order remains **Primary → Pistol → Knife → Utility → Equipment → Bomb → Other**.
- **Scope:** The UI layout, utility events, player filtering, timeline, radar floor views, and replay parsing remain unchanged. The sample replay and automated tests cover the new normalization logic; no real `.dem` recording was provided for an end-to-end test.

## OpenReplay v17 — Independent utility players and layered floor focus (October 2026)

- **Utility Players multi-select:** In the **Utility** event tab, select any number of players in **Players**; matching grenade cards include utility thrown by those players or utility with recorded damage/blind effects on them. Selecting no players shows all. This does not change the main radar player selection or the timeline filter; the existing radar selection still limits visible utility owners in the event dock. Clicking outside dismisses the menu.
- **Layered Upper/Lower switch:** On a two-level map choose **Layered**, then **Upper** or **Lower** in the top bar. The chosen floor's radar texture, players and map effects are shown. **Stacked** remains the default with both levels vertically arranged. Camera zoom/pan work in either mode.
- **Scoreboard full inventory:** Gear chips appear in this exact order: **Primary → Pistol → Knife → Utility → Equipment → C4**, using the official weapon-name aliases described in the user's list (including rifles, SMGs, machine guns, shotguns, pistols and all knife variants). Kevlar, Kevlar + Helmet, and Defuse Kit appear in Equipment; C4 is always last when carried. Missing inventory stays marked as partial rather than being invented.

**Checks:** 52 Python tests and bundled JS checks, plus browser interaction tests at 1600, 1366 and 1024px with fictional sample data. A real demo was not available for end-to-end confirmation.

---

## OpenReplay v16 — Dual-floor radar and utility types (October 2026)

- **Two-floor maps:** When the map provides a lower radar and vertical cutoff (e.g. Nuke, Vertigo and certain Train map versions), the map defaults to a **Stacked** view with Upper above Lower. Both floors show their players, utility and match events together in separate calibrated radar regions. Zooming/panning and Shift-drag selection work across both floors. The toolbar's **Stacked / Layered** toggle switches to the overlaid radar view, with the lower overview semi-transparent. A single-floor map remains unchanged. When the lower radar cannot be fetched, the single floor still works.
- **Utility event filter:** Open the **Utility** tab, then the **Types** menu. All five types begin enabled: smoke, flash, HE, molotov/incendiary and decoy. Checkboxes filter the utility event cards, timeline utility pins, map effects, grenade trajectories, and flash indicators; they don't hide kills or change the selected players. Click **Select all** to restore all utility.

**Verification:** 48 Python tests and all bundled frontend JS checks passed. Chromium UI checks passed at 1600, 1366, and 820 pixels using the simulated match and synthetic upper/lower map textures (not actual in-game radar assets). Real `.dem` and map geometry have not been supplied for end-to-end verification.

---

## OpenReplay v15 — Swapped radar shortcuts and chronological killfeed (October 2026)

- **Shift + left-click drag** now draws a rectangular selection around players on the radar, replacing the former Ctrl-drag shortcut. Works during playback and when zoomed or panned.
- **Ctrl + left-click drag** (either Control key) now draws persistent white radar annotations. **Backspace** erases drawings; ordinary drag pans the map.
- The bottom-left radar shortcut guide and in-app help now describe the new shortcuts.
- **Exact tick order in the live killfeed:** Recent kill events are sorted by their recorded tick (ascending, oldest at top), independent of parser arrival order or position-frame sampling. Ties on the same tick retain the original event order. Only the latest six nonexpired events appear, and rewinding recalculates the feed.

## OpenReplay v14 — Radar selection and annotations (October 2026)

- **Round-only kill badges:** Each `☠ ×N` in the scoreboard's equipment row counts that player's confirmed kills **in the round currently being replayed, up to the current tick**. It resets on the next round and updates correctly on rewinding. The main **K** column retains cumulative match kills.
- **Round time at the top:** The freeze/round/bomb countdown is grouped with the current and final CT/T score in the always-visible viewer toolbar, not in the match timeline strip.
- **Single round-win symbol:** Removed the separate CT/T winner dot from the sidebar. A skull marks an elimination, a defuse-kit case marks a defuse, and a burst marks an explosion. Only the icon's **blue CT** or **orange T** color indicates the winner. Unknown endings have no speculative icon. Where the round-end reason is generic, the parser can recover an elimination icon *only when all observed opponents have exact recorded death events*; bomb outcomes take priority.
- **Ctrl + left-click drag (now Shift in v15):** Select a rectangular region on the radar to focus the main map and event panel on players inside. Left or right Control works. This works during active playback and with map zoom and pan; click **Show everyone** to clear the filter. The separately filtered match timeline is unchanged.
- **Shift + left-click drag (now Ctrl in v15):** Draw a solid white line that stays attached to the same map locations when seeking, moving, zooming, or panning the camera. It remains until **Backspace** erases all annotations (except while typing in an input field). Opening a new replay also clears drawings. Normal click-drag continues to pan.
- The keyboard instructions are shown at the radar's bottom left, immediately above world coordinates. The surrounding UI dimensions and controls are retained.

**Tests:** 46 Python tests, all bundled JavaScript regression tests plus new v14 logic checks, and Chromium sample-replay interaction checks at 1600, 1366, 1024 and 820px widths. A real CS2 `.dem` file has still not been supplied for end-to-end validation.

---


## OpenReplay v13 — Bomb-state accuracy and round status (October 2026)

- **Bomb pickup/drop accuracy:** Recorded `bomb_pickup`, `player_given_c4`, and `bomb_dropped` events are preserved. The parser now requests event actor positions when available, interpolates the dropping player at the exact event tick, and reconciles missing ownership changes using the player's observed C4 inventory. Simultaneous handoffs are resolved together rather than incorrectly ending as a drop; recorded plants/clears take priority over lagged inventory samples.
- **Defuse interruption:** `bomb_abortdefuse`, `bomb_defused`, and `bomb_exploded` still end attempts. Additionally, the viewer cancels a defuse as soon as the defuser dies (using exact kill ticks, with sampled health as a fallback). A new real `bomb_begindefuse` event starts a new timer; defuse counts use 5s with a kit and 10s without a kit. No timer persists past its deadline.
- **Current and final score:** Compact CT/T score and final score appear in the always-visible viewer toolbar. The score follows stable player identities through side switches rather than simply counting historical CT wins as one team. When player identity is ambiguous, a best-effort per-side mapping is used.
- **Current round time (moved in v14):** The viewer toolbar beside the score now displays freeze-time, round-time, or planted-bomb countdowns.
- **Win reasons (v14 improves icons):** The left round selector uses one CT-blue or T-orange glyph for elimination (skull), defuse (kit), or explosion (burst), without separate colored winner dots. Unknown outcomes are neutral. Recorded bomb-defuse/explosion events override generic end-reason codes.
- **Player kill counts (superseded by v14):** Each player has a small `☠ ×N` badge on the loadout row. Since v14, this is a **current-round** kill count, not a lifetime or total-match count.

**Data-quality limitation:** Exact dropped-bomb physics cannot be guaranteed if the demo parser supplies only a drop event and the dropping player's coordinates instead of the bomb entity's resting position. OpenReplay does not fabricate an authoritative bomb location. These features have been tested against simulated replay data and event fixtures; real `.dem` recordings are still needed for end-to-end validation.

**v13 tests:** 43 Python parser/backend tests plus frontend regression tests. Current v14 testing is described above.

---

OpenReplay is a local, MIT-licensed browser UI for reviewing CS2 Source 2 `.dem` recordings. It parses demo data on your own computer and plays the match on an overhead radar with a scoreboard, full timeline, and tactical events.

> **Status: v18 prototype.** Browser interface and parser unit tests are passing, but no actual `.dem` recording was supplied for compatibility testing. Use the included **Try sample playback** button to explore a clearly labeled simulated match.


## New in v10 — reliable flash impacts, clean grenade flights, CS2-style killfeed

- **Accurate flash durations for every affected player, including teammates:** `player_blind.blind_duration` now takes precedence over a potentially stale/zero player property at the flash tick. When event timing is missing, utility details reconcile with the same sampled blind intervals used by the radar countdown. The utility card and expandable detail display per-player duration rather than thrower-only or enemy-only totals. For near-simultaneous flashes without reliable thrower/entity IDs, attribution is best-effort.
- **No inferred endpoint effects:** unmatched projectile tracks no longer manufacture extra smoke/flash/HE/decoy activations. No "endpoint inferred" text or fake duplicate throw is drawn. Missing a real activation event means no speculative active-effect marker is created.
- **Smoke and other flight paths stop when the projectile stops:** long stationary `parse_grenades()` tails are removed; the flight is clipped at linked activation/detonation tick. Only recorded sampled flight is drawn; full synthetic straight-line throw-to-endpoint paths have been removed. Smoke/fire/decoy areas still persist after activation for their recorded/estimated lifetimes.
- **Live killfeed:** CS2-inspired compact dark rows appear at the map's upper right, opposite active utility. Kills roll in at their real ticks, disappear after roughly seven seconds, and rewind correctly when seeking. Attacker/victim colors follow their recorded side. Weapon silhouettes distinguish several firearms and weapon families, with hover labels identifying the exact weapon. Headshot, penetration/wallbang, through-smoke, no-scope, blinded-attacker and airborne markers appear only if supported by the demo's kill event.
- **Verification:** 33 Python tests plus earlier JavaScript regression tests passed. Sample replay checked in headless Chromium at 1600px, 1366px, 900px and 420px, including killfeed expiry, seeking, all scoreboard rows and teammate flash impact details. A real CS2 `.dem` is still needed to validate source recording compatibility and ambiguous flash attribution.

**v10 behavior supersedes earlier v8/v9 documentation about inferred projectile endpoint effects and estimated straight-line paths below.**

## New in v9 — ADR, sortable scoreboard, round timeline, cleaner utility

- **ADR (Average Damage per Round):** displays actual recorded enemy **health** damage from `player_hurt` across all weapons (including grenades), divided by rounds the player has participated in up to the current tick. Self and same-team damage are excluded. Missing `player_hurt` data displays `—` rather than an invented value. It updates while playback runs and when scrubbing or switching rounds.
- **Scoreboard sorting:** click **K, A, D, UD, EF, ADR or $** at the top of the scoreboard. First click sorts **descending**, second **ascending**, third restores original roster order. Choosing a different stat immediately sorts it descending. The two teams remain in their respective panels, and clicking players to filter the map still works during playback.
- **Timeline scope:** use the new **Full match / Current round** segmented control beside the existing timeline zoom buttons. Current round includes only the viewed round's ticks, kill/death markers and utility events and follows round navigation automatically. Full match restores the complete match timeline. Zoom, horizontal pan and timeline-player filtering work in either mode. The mini overview bar remains the entire match.
- **Quiet utility summaries:** smokes, flashes, and decoys with no recorded damage do not announce "no damage recorded". HE and molotov/incendiary without recorded damage show **0 damage**. Actual per-player impacts and flash durations are unchanged.
- **Grenade paths:** draw only while in the air, up until their recorded end tick or linked detonation/start-of-effect tick. Once they land/pop, the paths and throw-origin indicators vanish; **smoke, fire, and decoy effects remain visible for their active durations**. As of v10, missing full trajectory samples do not create a synthetic endpoint flight.
- **Testing:** 28 backend tests, direct JavaScript regression tests, and Chromium UI interaction checks at 1600, 1366, 1100, 820 and 390px viewports. Real `.dem` files have not yet been provided for end-to-end validation.

## New in v8 — Health, grenade flights and utility impact reports

- **Map health bars:** A slim vertical bar immediately to the right of each displayed player name represents that player's current health (green fill from bottom, red remaining segment). Health comes from the sampled `health` player field; dead players are zero.
- **Scoreboard health:** The HP number beside each player's name has a proportional green/red background: 100 is fully green, 50 is 50/50 and 0 is fully red. Stats and loadouts stay in their existing columns.
- **Recorded grenade paths:** The parser reads all projectile samples from `parse_grenades()`, associates individual throws by type, entity, thrower and tick, then animates the path from takeoff through landing/detonation. When present, `grenade_thrown` events supply the origin. Missing early-flight points are explicitly labeled as an *estimated* connection to measured samples.
- **Fallback paths (v8 only):** v10 removes synthetic straight-line trajectories. If flight samples are unavailable, the real activation event and effect can still be shown.
- **Complete utility impacts:** `player_hurt` damage is associated with a specific grenade using weapon, thrower, event time and available entity data. This includes HE damage, repeated molotov/incendiary damage during the burn, and recorded damage from direct grenade contact (including a flashbang that physically hits a player). Armor damage is shown separately when available. Regular gunfire is never counted as utility.
- **Flash victims:** Recorded `player_blind` results are attributed to the flash when possible. Cards show victims and durations. Click any utility card for the full named-player damage and blindness breakdown in an overlay above the unchanged-height event dock. Cards show shortened summaries to stay readable.
- **Player tracking:** Timeline tracking also includes players impacted by recorded utility damage and flashes, even if they did not throw the grenade.

**Real recording limitation:** These additions were validated with mocked parser events and sample replay data, not an attached actual `.dem`. Where demo metadata is missing or ambiguous, individual associations may be absent rather than fabricated.

## Start on Windows

1. Download/extract `OpenReplay.zip`.
2. Install [Python 3.11+](https://www.python.org/downloads/) if not installed. During setup, enable **Add Python to PATH**.
3. Double-click `start_windows.bat`. On the first launch, the script installs dependencies into a local `.venv` (internet required for this initial installation).
4. The launcher opens OpenReplay automatically. It normally uses **http://127.0.0.1:8765**, but will choose another local port when an earlier version is still running.
5. Press **Open .dem file** or drag a CS2 demo into the page. Large demos may take some time to parse.

Terminal equivalent:

```powershell
py -3 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python server.py
```

## Navigation and controls (v8)

- **Expanded by default:** the prior expanded/focus view is now the standard interface. There is no fullscreen button; all three columns, rounds, timeline, and 10-player roster remain available on desktop. On small screens, the scoreboard follows the main viewer.
- **Map camera:** mouse wheel zooms toward the pointer (25–3200%); drag anywhere on the rectangular viewer to pan without artificial boundaries. The **+**, **−**, and **↺ Reset** buttons are at the bottom right of the map. The map-image itself maintains its original square aspect ratio while the full rectangular viewer is usable for pan and zoom. Reset restores centered 100% zoom. This affects only the map, not the panels.
- **Round navigation:** left round list, the round menu, skip-round arrows, and full-match timeline.
- **Kills as they occur:** elimination cards and kill/death map markers appear only once playback passes that tick. They disappear again when seeking backward. The full-match timeline still displays *faint upcoming kill tick shortcuts* so reviewers can jump to an exact moment.
- **Scoreboard map filter:** click a player in the CT/T scoreboards to show only that player on the radar, including utility they threw. Click more names to compare multiple players; click one again to deselect. **Show everyone** restores everyone. The event dropdown remains available for extra event-list filtering.
- **Utility flight:** when `parse_grenades()` exposes sampled projectile positions, OpenReplay plots a progressively growing traveled path from the first recorded projectile position, shows the thrower's name at the origin, animates the projectile, then removes the path at detonation or landing (v9). Both thrown and active utility honor the player selection. As of v10, absent grenade flight samples do not produce guessed flight paths.
- **Blinds:** a blinded player's overlay shows remaining blind time, calculated against recorded flash activation ticks and durations where available, or estimated from sampled flash data when events are absent. Flash countdowns run as the replay progresses and rewind with seeks.
- **Effects:** utility detonation locations and effect times are event-based when present. Smoke/fire patches and HE radii remain *illustrative*, not exact game-engine geometry.

### New in v5

- **Smaller, single-color players:** blue circles represent CTs, orange circles represent Ts. Previous individual player color fills and team rings are removed.
- **Aim facing direction:** a tiny triangle at the front of each player reads the recorded `yaw` angle. If the recording/installed parser cannot supply yaw, the pointer is omitted rather than guessed.
- **Weapon firing:** `weapon_fire` events animate a short, narrow muzzle flash in the recorded direction for roughly 0.115s; shots are shown only for selected players when filtering. Grenade throws do not masquerade as gunshots. Shot flashes are event-based, but world positions/angles may use the nearest sampled tick.
- **Gear in v6:** each scoreboard row shows individual inventory items as readable chips: primary, pistol, grenade(s), knife, armor, helmet, defuse kit and C4 when recorded. The old active-weapon-only text has been removed. Unavailable inventories are labeled **partial** instead of being fabricated.
- **Stable player selection:** scoreboard row DOM nodes are preserved during playback so holding down the mouse and selecting a player works at 1×–4× speeds.
- **Role-labeled timeline (reworked in v6):** each kill/death event now has only one **K/D** marker, plus separate **U** utility markers. The timeline tracks its own chosen players independently of the map; upcoming K/D events remain faint but seekable.
- **Full map canvas:** the tactical background fills the entire rectangular map pane; the calibrated radar artwork is never distorted, and panning no longer stops at the original square edges.

### New in v6 — zoomed, independent event timeline

- **One K/D per kill:** one marker for the entire attacker/victim interaction, even when both players are tracked. Utility uses a separate `U` marker.
- **Timeline-only player tracking:** open **Timeline players ▾** above the timeline, check one or more players, and follow only their relevant K/D interactions and utility events. Utility includes their throws and recorded effects on them. This does **not** change the live map or scoreboard selection. Clear the filter to restore the whole match.
- **Zoom and pan the timeline:** use **+ / −** to change the timeline magnification, **◀ / ▶** to move the window, and **Reset** to return to the whole match. Scrolling over the timeline zooms toward the pointer; **Shift + scroll** pans. The smaller overview bar beneath it lets you drag the currently visible time window around the entire match. Full-match playback continues if the playhead moves outside the current zoom window.
- **Complete item chips:** the scoreboard now separates each recorded primary, secondary, grenade, knife and armor/equipment item. Up to two flashbangs are shown separately when an inventory snapshot contains two. Gear updates with demo time.
- **C4 holder:** the name row shows a visible `C4` marker when the player currently holds the bomb. Uses actual bomb pickup/drop/plant events when provided; otherwise falls back to timestamped inventory containing C4. When ownership is unrecorded, no carrier is asserted.

### Right-side scoreboard

The right sidebar retains the full match roster if an individual tick is missing entities (five per side for standard competitive matches), including **Kills, Assists, Deaths, Utility Damage, Enemies Flashed, ADR, and Money**, with three-state column sorting. K/A/D and event-derived utility stats advance with the replay when the relevant events are present; official aggregate snapshot fields are used otherwise. Some data can be unavailable for POV/incomplete/custom demos and will display `—`.

### Utility visibility and accuracy

| Element | What is actually used |
|---|---|
| Flash | `flashbang_detonate`, `player_blind` and `flash_duration` sampled from the demo. Flash-duration values are omitted when not recorded. |
| Smoke | `smokegrenade_detonate` / `smokegrenade_expired` actual ticks when available; **approximate circular spread** shown. |
| Incendiary / molotov | `inferno_startburn` and expiration events when available; **illustrative circular fire area**, not precise individual fire patches. |
| HE grenade | `hegrenade_detonate`, `player_hurt` damage and position if available. **Indicative ≈350-unit circle** does not account for geometry, walls, verticality or the game engine's damage calculation. |
| Decoy | `decoy_started` / `decoy_stopped` and elapsed lifetime; approximate pulse shown. |
| Thrown grenades | `parse_grenades` entity track samples when supported by the recording. |

When an expiration event is missing, fallback duration (smoke 20s, fire 7s, decoy 15s) is labeled **estimated**. These default lifetimes are for visualization and not proof of exact demo conditions. Entity event coordinates, exact kill ticks and listed damage values come from events when provided.

## v3 fixes (retained)

- Replaced the conflicting, width-dependent CSS rules with one responsive layout. The full scoreboard stays on the right at desktop widths, with complete rows for both teams, and remains available below the radar on narrow mobile screens.
- Fixed a bug where interpolation dropped all scoreboard statistic columns. Stats now persist through intermediate ticks. Full roster snapshots are carried forward if individual player rows are absent.
- Fullscreen now targets the **entire app** instead of only the middle workspace; the fallback focus view works when native fullscreen is denied.
- Added colored kill/utility markers to the full-match slider and clear active-utility status labels. Extended grenade fallback to use the complete projectile track data rather than only the first 10,000 rows.

## v4 changes

- Gradual kill/death reveal on replay and event feed, even after rewinding.
- Remaining flash-duration countdown instead of treating a duration snapshot as permanently current.
- Full sampled grenade flight from origin to detonation/termination while the projectile is in flight, and clears the trail as soon as the effect activates (v9).
- Multi-player selection from the scoreboard that filters map circles, kill indicators, grenade flight paths, and active utility.
- The expanded desktop viewer is now the default and the fullscreen button has been removed.
- Zoom toward cursor, drag-to-pan map, and one-click reset.

## Data extraction notes (v5–v6)

The parser attempts to collect `yaw`, `active_weapon_name`, `inventory`, `armor`, `has_helmet`, and `has_defuser` from sampled ticks. Unsupported fields are omitted gracefully. To minimize replay size, inventory/gear snapshots are stored only when a value changes instead of repeated on every movement frame. V6 also reads optional `bomb_pickup`, `bomb_dropped`, and `bomb_planted` events. Some parsers may not expose all inventory data or bomb events, so **complete item lists and C4 ownership cannot be guaranteed for every real demo**.

Firing events use `weapon_fire` plus the nearest sampled position/yaw. They cannot reconstruct each bullet's precise subtick bullet trace or actual projectile impact from a muzzle-flash event. Some POV or older recordings might omit optional fields or events. The simulated example includes scripted bomb hand-offs for testing; it is not real competitive match evidence.

## Caveats

- Positions are sampled every **8 demo ticks** and interpolated, not reconstructed at full subtick precision. Kill events seek to their exact game tick, while the marker's location uses event actor coordinates when present and otherwise the nearest sampled position.
- Projectile-only inferred utility events are **not confirmed detonations**; exact effect spread/volumes are **not** reproduced. If neither events nor trajectories are present, no utility can be reconstructed.
- Match rate defaults to **64 ticks/s**. Custom demos with different playback rates can have incorrect time labels.
- Map images and transforms are fetched from the community [cs2-map-icons](https://github.com/MurkyYT/cs2-map-icons) radar service, not bundled. If internet is unavailable or a map is unrecognized, the viewer shows a coordinate grid. Radar assets remain their respective owners' property.
- All `.dem` decoding happens in a FastAPI service listening on **127.0.0.1**, not a hosted website. The only external downloads during playback are optional radar-map assets. Parse results are cached in a temporary directory; OS temp cleanup removes them eventually.
- Experimental parser properties and events depend on the demo and installed `demoparser2` version. The parser tolerates missing optional fields but can't invent absent match data.
- The sample replay has fabricated player names, locations, kills and utility: **do not treat it as an analysis of a real match**.

## Architecture

- `parser.py`: `demoparser2` event and tick extraction, utility lifecycle matching, optional projectile samples.
- `server.py`: local upload, parse jobs, replay JSON API and optional map-radar asset proxy.
- `static/`: vanilla HTML/CSS/JavaScript canvas UI. No frontend build step, account or cloud upload required.
- `tests/`: parser event tests, upload validation and endpoint smoke tests. Run via `python -m pytest -q` (requires optional pytest), and `node tests/frontend_logic.cjs`, `node tests/frontend_v6.cjs`, `node tests/frontend_v7.cjs` for standalone JavaScript logic checks. No Node dependencies are needed.

Not affiliated with Valve, Counter-Strike or its tournament operators.


## Version 7: event navigation readability and player tracking

- **Click-away Timeline Players:** Use the dropdown to select multiple players. Click anywhere outside to dismiss it; the Escape key also closes the menu. Selections are preserved.
- **K/D color meaning:** When a player is tracked in the **Timeline Players** selector, green **K** means they got the kill, red **D** means they died, and amber **A** means they assisted. A split green/red **K/D** means both the killer and victim are tracked (or no individual player is selected). Each elimination is still one timeline event, not two. The independently filtered round event cards use matching subtle colors.
- **Legible event cards, unchanged dock dimensions:** Event cards keep their timestamp, event title, and one-line detail fully inside the existing 113px dock; utility types are abbreviated where necessary. Hover or focus an item for complete event information through its accessible tooltip. Horizontal event-strip scrolling remains available by mouse wheel, touchpad, or touch gesture without a space-consuming scrollbar. (At narrow browser widths the rightmost event is naturally partially visible until scrolled.)
- All map, scoreboard, match timeline, round selection and playback features from v6 remain unchanged.

## OpenReplay v11 — killfeed, bomb position and upload progress

- Awarded flash assists appear in the existing killfeed row, never as separate timeline events.
- Killfeed uses accurate weapon **names** and short **text** labels for game-recorded modifiers. No Valve icon assets or icon installer are included in v12.
- Demo upload shows actual transferred bytes and percent; parsing shows a separate indeterminate progress bar (an exact parser percentage is unavailable).

## OpenReplay v12 — bomb/defuse and display refinements

- Removed the v11 icon-importer and artwork lookup; killfeed gun names remain visible and every modifier is an amber/orange badge, including flash assists.
- While a living player carries C4, **their normal circle is replaced by a small `C4` marker**, painted at their normal **interpolated position** with their direction and player label retained. No second C4 is drawn beside them. On drop, the player returns to a normal circle; the C4 is drawn at the drop location when known.
- When planted, the C4 marker has a **red ring** and the remaining bomb time in seconds. Default `mp_c4timer` is **40s** unless a supported header field supplies a different value. The running timer depends on the recording's tick rate.
- `bomb_begindefuse` starts a second countdown beneath the bomb. **Yellow = no kit (10s)**; **dark green = kit (5s)**. `bomb_abortdefuse` immediately stops the countdown, and a second attempt restarts it. The parser uses the event's actual `haskit` value when supplied; otherwise it falls back to recorded player equipment. If both are unavailable, it assumes no kit (an estimate).
- Dead players draw **first**, as small, faint ghost crosses without health bars or names. Living player markers, names and health bars render on top, so dead markers cannot obstruct the live players.

### Accuracy limits

Defuse time and bomb expiry use event ticks, the standard 40/10/5-second rules and any known `haskit` information. Exceptional server-configured C4 timers may be unavailable in the demo header. Dropped C4 positions may use the nearest recorded dropper position, which is not an exact physics reconstruction. A countdown will only start after an explicit bomb-defuse-start event; it will not be fabricated solely because a CT stands near the bomb.

**Validation:** automated tests and sample replay only; no real CS2 demo recording was supplied.


### v19 — Smaller radar utility text

Deployed grenade labels (SMOKE/FIRE remaining time, FLASH, HE, damage) and in-flight grenade labels use compact 11px text and a lighter outline. Player names, bomb indicators, scoreboard, event cards, controls, and gameplay parsing remain unchanged.


## v22 changes

- **Team names:** Team headers display the demo's recorded `team_clan_name`, when available, sampled per round so side changes at halftime work. If the parser or recording lacks clan names, the existing CT/T side headings remain.
- **Playback:** Added 0.25× speed to the match timeline.
- **HE grenade:** Removed the approximate `≈350u` text above the blast area; the visible approximate radius remains unchanged.
