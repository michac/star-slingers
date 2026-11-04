# Star Slingers — History & Playtests

> Status: **4-wave run + difficulty solver (B3/B17/B18) + PWA (B12) + homing toggle (B14) + final boss (B5, 2026-06-09); next: scoring (B6), sound/juice (B7), or boss tuning playtest**
> Doc roles: [`design.md`](design.md) = the game as built · [GitHub Issues](https://github.com/michac/star-slingers/issues) = work not built yet · **this file = history** (playtests, explorations, how we got here). The old backlog's resolved items are archived at the end.

## Prototype (2026-06-05)

First playable slice lives in [`/star-slingers`](../../star-slingers/) — Phaser 3 + TS + Vite
per `tech-stack.md`, **sling-feel sandbox scope**: nail the touch input before any game
loop. In: both sling controls simultaneously (multitouch), rockets, 3–4 dummy asteroids with
hit-count numbers (pop + respawn), per-player ammo with regen (P1's readout rotated 180°),
stars backdrop. Out: station, shield, waves, enemy ships, score, boss, sound.
Renders the **wireframe skin** — layout/palette ported 1:1 from the v3 mock; restyling later
= swapping values in `src/tokens.ts` once the style winner is picked.

## Playtest 1 (2026-06-05, sandbox build)

- Players: the 9-year-old (!) and the 5-year-old. **Both liked it** — the core sling
  interaction lands.
- **5yo had trouble hitting things** — confirms the "leading the target is the core
  skill" watch-item below. Michael has ideas for this; capture + pick an approach
  next session. → tracked as **backlog B8**.
- New data point: a 9yo player exists and enjoys it — worth keeping difficulty
  interesting for him too (the per-player fairness levers cut both ways).

## Re-sync (2026-06-06)

Project docs were drifting (spec described v2/v3, decisions living in chat). Restructured:
- `spec.md` rewritten against **layout v5**, slimmed to **reviewed decisions only** — the
  auto-generated system drafts (waves, ships, boss, scoring, juice, fairness levers) moved
  to `backlog.md` as `[draft]` items rather than masquerading as decided design.
- `backlog.md` created as the work queue; the standing flow is: record wants there first,
  work items one at a time (or batch into a workflow), and syncing `spec.md` is part of
  finishing any item.
- Superseded mocks (`ui-mock-v1/v2`, the rejected v4 central-core layout) moved to
  `mockups/shelved/`. Root `CLAUDE.md` added so future sessions start oriented.

## B1+B2 built (2026-06-06, batched)

Station + shield + funnel landed in the sandbox in one pass (B2 was a prerequisite for
B1's hits to read right). Decisions with reasons:
- **Shield = 3 concentric rings (all visible), not 3 arc segments** — Michael's call on
  review: the player can't control where enemies hit, so a hole-in-the-arc reads as a
  positional weak-spot mechanic that would be pure luck; shrinking rings are the clearest
  non-positional read ("shield getting smaller, danger closer"). v5 mock re-cut to match.
- **Contact radius shrinks with the outermost remaining ring** — honest visuals; enemies
  visibly penetrate deeper as the shield weakens.
- **Funnel = one-time velocity redirect at `APPROACH_X`** — knowingly a straight kink, not
  a curve; per-frame steering (`Angle.RotateTo`) queued as tuning if it reads badly. The
  y=300 lane barely turns (nearly level with the station).
- **Fail/retry via `scene.restart()`** — researched against Phaser 3.9x: scene-owned
  tweens/timers/input listeners + the Arcade world's listeners all clean up; verified by a
  headless double fail→restart cycle, zero console errors/warnings. Texture generation now
  guarded with `textures.exists()` (regen after restart used to warn).
- **Tap-anywhere restart** — full-field invisible Zone, friendlier at 5 than hitting the
  icon; circular-arrow icon reads either way up so one icon serves both seats.

## Playtest 2 (2026-06-06, Pages deploy of the B1+B2 build)

- **Too hard as-is** (fast + many + tough). Diagnosed with throughput math: the build
  demanded ≈ **0.92 accurate team hits/s sustained** vs a 1.33 shots/s two-player ammo
  ceiling — ~69% combined accuracy just to break even; a solo player mathematically
  couldn't defend at all.
- **Try-again UI muddled** when frozen field objects sat behind the 0.7-alpha dim.
- Michael's calls, built same day as **B15+B16**:
  - **Difficulty budget model** — tune against one scalar (`required hits/s = threat −
    regen leak`) instead of five raw knobs; precedent researched (MMO DPS checks/enrage
    timers, TD throughput balancing, Schreiber & Romero *Game Balance*). Knobs moved to a
    `DIFFICULTY` block in `src/layout.ts`; dev boot log prints the scalar.
  - **Shield regen** (Michael's idea): a ring regrows after ~10s unhit — doubles as the
    budget's quantified leak allowance.
  - **Easy target chosen: ≈0.3 team hits/s** (clarified from the 0.2-vs-0.4 ambiguity in
    "both players hit one shot every 5s": 0.2 = team total, 0.4 = each at beginner rate;
    Michael picked the 0.3 midpoint). Shipped tune computes **0.28**: 3 lanes,
    speeds ×0.55, spawn gap 320, ammo regen 1s, shield regen 10s.
  - **Opaque modal card** for the fail UI — verified headlessly that an asteroid parked
    dead-center is fully hidden behind it.

## B3 built (2026-06-07; decisions 2026-06-06)

The 4-wave run landed. Decisions with reasons:
- **Finite quota over survival timer** — "we beat them all!" is visible cause-and-effect for
  a 5yo; a hidden timer isn't (and a countdown display fights the no-reading rule).
- **Asteroid wrappers are mutated in place between waves, never recreated** — the
  rocket↔asteroid overlap collider is built once over their sprites; recreating wrappers
  would leave it pointing at dead sprites and hits would silently stop. WHY-comments on
  both sides of that trap.
- **Wave 1 starts live with no banner** — a banner before the first wave adds nothing, and
  smoke.mjs needs asteroids on-field right after boot.
- **`DIFFICULTY` became `WAVES: WaveConfig[]`** (ammo regen stays global); budget functions
  take a wave; dev boot log prints all four rows. Gentle curve per Michael:
  0.28 / 0.37 / 0.46 / 0.55 required team hits/s (lanes 3/4/4/4, quotas 8/10/12/14).
- **Breather = shield full-restore (ring-by-ring regrow cue) + mirrored numeral banner.**
  Victory after wave 4 = "You did it!" star-burst card (Overlay generalized from
  FailOverlay, config-driven) — the seam B5's boss will replace.
- **Verified headlessly** via a DEV-only `__debug` scene hook (forced clears 1→4, breather
  restore, victory, restart, plus one real rocket-driven wave clear). Also fixed a latent
  smoke.mjs flake: since B15 widened the spawn stagger, its head-on test could fire at a
  target still beyond the right edge — it now waits for the target to enter the field.

## Playtest 3 (2026-06-07, remote-control on the Pages build)

Two findings, both built same day (B17 + B18):
- **Wave banner unreadable** — the two mirrored copies sat ±28px from center, stacked on
  top of each other. Fix: ±94 (B18), each in its own half.
- **Low waves should bias to "more, weaker" asteroids — and *algorithmically*.** Michael's
  framing: don't scale all knobs uniformly to a target; establish a **minimum asteroid rate
  first**, then scale other factors. Built as a **target-first solver** (B17):
  - The B15 budget scalar (required hits/s) flips from a readout to the **input**. Same
    formula; `solveWave(required, leak)` inverts it — picks knobs so threat hits the target.
  - **Priority order: count → speed → toughness** (Michael's call). Floor = 3 of 4 lanes.
    Among the many knob combos that hit a given number, the order is the kid-friendly
    tiebreaker — low waves = many weak slow rocks; 3-hit rocks emerge only at high targets.
  - "How does the shots/s target fit?" (Michael's question): it *is* the target now, per
    wave; the solver realizes it, the priority order picks the nicest realization. Recorded
    in spec §7.
  - Verified headlessly: per-wave composition climbs 3→4 lanes, toughness only rises late
    (W3 first 2-hit, W4 several), banner readable, victory + restart. **Note:** restart taps
    must be *touch* — Playwright `mouse.click`'s stale-pointer quirk fails the first click;
    `touchscreen.tap` (and the real phone) work. smoke.mjs moved off its `hits===3` finder
    to a toughness-agnostic `__debug.hits()` counter.

## Bug report (2026-06-07, chat) — B19 + B20

Michael, after playing the B17 build, raised three things:
- **"Had to do wave 2 twice."** Traced the counter (`WaveDirector.onWaveCleared`): it's
  arithmetically correct — banner number and HUD always agree, no off-by-one, no double-fire
  (clear-check sets `state='breather'` before re-entry). The real cause: the 0.05/0.14 targets
  solved to **near-identical fields** for W1 and W2 (both 3-4 lanes, *all 1-hit*, slow), so the
  second wave read as a repeat. A feel bug, not a logic bug — fixed by re-tuning so each wave is
  visibly distinct.
- **"Print the wave inputs / maybe a separate params file."** → **B20**: pulled `WAVES`,
  `DIFFICULTY_MODEL`, `LANE_SLOTS`, `RADIUS_BY_HITS`, `AsteroidSpec`, `WaveConfig`, `BREATHER`,
  and the whole budget/solver block out of `layout.ts` into a dedicated **`src/waves.ts`** —
  the one file to tune the run. `layout.ts` keeps geometry/paint + `AMMO_REGEN_MS` (an
  ammo/HUD constant, which waves.ts imports for break-even). Pure move; typecheck + build green.
- **"Too easy — one player can keep it clear."** Confirmed from the solver math: W4 only
  demanded 0.57 net hits/s (~57% solo accuracy), and shield-regen *leak* was so generous on W1
  (0.10) it exceeded the entire required (0.05) — the shield self-healed faster than the damage.
  → **B19**, re-tune (Michael's pick: *"noticeably harder, still soloable"*): targets
  **0.05 / 0.20 / 0.45 / 0.75**. Solver now yields **W1** 3×0.50 all-1-hit · **W2** 4×0.66
  all-1-hit (clearly ≠ W1) · **W3** 4×0.85 two 2-hit · **W4** 4×0.85 one 3-hit + three 2-hit
  (first 3-hit rock in the run). Solo break-even climbs 5→20→46→76%; two players ~38% each at
  W4. Quotas and shield-regen unchanged. Verified the curve with a throwaway solver replay.

## B12 built — PWA: installable + offline + icons (2026-06-09)

Shipped B12 as a **Progressive Web App** rather than the original Fullscreen-API sketch.
Reframe: Michael wanted the chrome-free "real app" feel on the Pixel *and* the iPhone, and
the install path is the one mechanism that delivers that on both — Android Chrome and iOS
Safari — plus offline, which is literally a service worker (the "lightweight app that caches
the site and runs offline" idea, no native app needed).

- **Hand-rolled, not `vite-plugin-pwa`.** The plugin nudges toward an absolute base
  (`/star-slingers/`) for SW scope / `start_url` on a project subpath, which would break
  the deliberate relative `base: './'` ("works from any static folder"); and its
  precache-manifest machinery solves a multi-chunk problem we don't have (one content-hashed
  bundle, all art code-drawn). A ~45-line dependency-free `public/sw.js` covers the whole
  offline surface and stays subpath-/base-agnostic. **No `vite.config.ts` change** — `public/`
  auto-copies to `dist/` and relative paths resolve under the subpath.
- **Shipped:** `public/manifest.webmanifest` (`display:fullscreen`, portrait, neon theme),
  self-hosted **Audiowide** woff2 (removed the last Google-Fonts cross-origin dep — the
  `@font-face` lives in `index.html`, the `main.ts` font-await is unchanged), neon app icons
  (192 / 512 / maskable-512 with art in the 80% safe zone / opaque apple-touch-180) generated
  by a manual `make-icons.mjs` Playwright rasterizer (reuses `smoke.mjs`'s chromium discovery;
  build-time only, PNGs committed), iOS/install `<meta>`+`<link>` head tags, and a PROD-only
  SW registration (dev + `smoke.mjs` never get one). SW strategy: install-precache stable
  assets · network-first navigations (fresh online, cached offline) · cache-first hashed
  assets (self-bust on rebuild) · versioned cache + activate-time cleanup + skipWaiting/claim.
- **Deliberately dropped:** auto-`requestFullscreen()`-on-first-touch — Android-only (iPhone
  Safari has no Fullscreen API), jarring on desktop, and installing already gives chrome-free.
- **Platform ceiling (expected):** Android installed = true edge-to-edge fullscreen; iOS
  installed = standalone (no Safari chrome) but iOS ignores `display:fullscreen`, so the thin
  status bar stays — blended into the dark bg (`black-translucent` + `viewport-fit=cover`).
- **Verified:** typecheck + build green; `smoke.mjs` still green (no SW in dev, fewer requests);
  headless preview-build check confirmed SW activates and an **offline reload boots the game with
  Audiowide from cache, zero console errors**. (Local SW scope is `/`, not the subpath — expected
  on `localhost`.) spec §8 "Install & offline (PWA)" added + backlog B12 → Resolved.

## B14 built — homing toggle, the 5yo fairness lever (2026-06-09)

Built B14, the primary lever for B8 (the 5yo can't lead targets; playtest 1). Michael's
model, confirmed in plan: at fire, lock the asteroid **closest to the launch ray** within a
forward cone, then **curve the shot toward it in flight**. Decisions made this session (via
the plan's clarifying questions):
- **Gentle assist, not a magnet.** Steering is a **capped turn-rate** (`HOMING.turnRateDeg`),
  so a fast or sloppily-aimed shot can still miss. Michael picked this over a guaranteed lock —
  keeps it from feeling like magic, and the dial is one number to re-tune on the phone.
  *(Tuning, same day, from phone feedback: first ship at 200°/s was WAY too strong — "you can't
  miss" — dropped to 70, then **50**. Two more feel changes added in the same pass: (a) the curve
  is now **delayed + eased** — the shot flies straight for `armDistancePx` (80) then ramps the
  turn-rate 0→full over the next `rampDistancePx` (120), distance-based so it looks the same at
  any pull strength, which makes homing read as a deliberate "smart rocket" instead of a magnet;
  and (b) **target selection tightened** — added an absolute `maxPerp` (50px, the ray must pass
  this close to the rock's center) on top of a narrower cone (35°→25°) and shorter `maxRange`
  (520→440), so you must aim closer to lock/highlight a rock. Then dialed toward a more dramatic
  reveal: longer straight run `armDistancePx` 80→**140** paired with a **stronger** `turnRateDeg`
  50→**90** (a bold straight line then a decisive curve onto the rock), and pickup `maxRange`
  440→**520**.)*
- **Design pivot (same day): "if you get a lock it should hit."** On reflection Michael moved the
  difficulty entirely into *earning the lock*: a shot now homes **only if it locked a target at
  fire** (no lock → ordinary straight shot, no auto-aim), and a lock is meant to **connect** — so
  `turnRateDeg` was cranked 90→**600**. Two supporting changes: (a) **no in-flight re-acquire** —
  if the locked rock dies mid-flight the shot just flies straight, it never grabs a different one;
  (b) **`armFraction` 0.4** caps each shot's straight arming run at 40% of its distance-to-target,
  so a closer lock still leaves runway to curve in (a long straight run can't sail past a near
  rock). The lock ring was also made bolder (glow fill + thicker stroke) to read better. The tight
  cone/`maxPerp` from the prior pass stay — they're now *the* challenge. Still un-playtested with
  the kids.
- **Asked: does the lock fail to update while holding a pull?** No — traced the code: `SlingControl.update()`
  runs `drawDynamic()` **every frame** while a finger is down (not just on finger-move), and that
  re-queries `pickHomingTarget` fresh, so the ring tracks drifting rocks live. The likely "feels
  stale" cause is the deliberately **tight lock band** (`maxPerp` 50px + 25° cone): a rock has to
  pass close to your exact aim line to light up, so rocks on-screen but off the line never do.
  Left the band as-is (it's the intended skill) but made the ring bolder; revisit `maxPerp`/cone if
  acquisition still feels too fiddly on the phone.
- **Visible per-player switch**, in the player's color, beside each sling — not a hidden
  parent control. No text (kid no-reading rule): reads by color + knob position + brightness.
  **Off by default, opt-in, independent per seat**, so the 9yo's lead-the-target challenge is
  untouched. *(Repositioned same day to sit centered in the gap between the pull arc and the
  screen edge — `HOMING.toggle.offsetX` 96→125 — so it's clearly off to the side of the sling.)*
- **Aim preview rings the locked target** during the drag — the kid sees what he'll hit
  before releasing.
- **Persisted in the scene registry** (`homingP1`/`homingP2`), so a "Try again" restart
  doesn't silently turn it back off (`scene.restart()` otherwise rebuilds from constants).

Shape: new `HomingToggle.ts` (mirrored + rotated 180° for the top seat); target pick +
steering split between `SandboxScene.pickHomingTarget` (smallest perpendicular distance to
the ray, cone+range gated) and `RocketPool.steer` (per-frame `Angle.RotateTo` at the capped
rate, re-acquire if the locked rock dies, fly straight if none); `SlingControl` draws the aim
ring. Tuning + toggle geometry in a new `HOMING` block in `src/layout.ts`, beside `SLING`
(control feel already lives there). Verified: typecheck + build + smoke green — added an
**off-axis homing assertion** to `smoke.mjs` (fire a shot whose straight path clears the rock
by ~45px; the hit still lands → the curve works). Also fixed two unrelated smoke-harness rots
en route: Playwright renamed its Win folder `chrome-win`→`chrome-win64`, and added a
`SMOKE_URL` env override (local ports 5173–5175 were occupied). **Not yet playtested with the
kids** — the open question is whether 200°/s feels right for the 5yo (tracked on B8). spec
§5/§6 + backlog (B14 → Resolved, B8 → partly done, B13 note) synced.

## B5 built — final boss (2026-06-09)

Built B5, replacing the wave-4 placeholder victory card with the real finale. Michael's
sketch (boss at range, slowly damages the shield, guarded by 4 escorts, ~10 hits once the
escorts are down) plus decisions made this session via the plan's clarifying questions:
- **Placement:** boss **slides in from the side, parks at center, stationary while battling**,
  fully on screen; **4 escorts slowly orbit** it (Michael's refinements — he rejected the
  initial "boss on the right" sketch). A centered boss doesn't re-open the v4 mistake (that
  was a central *objective* blocking cover fire; this is a temporary target, no asteroids in
  play).
- **Invulnerability gate (Michael's pick over physical blockers):** boss wears its own cyan
  shield ring and ignores all hits until **all 4 escorts die**, then turns vulnerable (ring
  drops, full color, big **mirrored HP number** like the wave banner so both seats read it).
- **Charge/interrupt attack — the key idea.** Michael was unsure between "charged shot" and
  "ticking beam", and floated *"destroying an escort should interrupt damage."* Unified all
  three into **one charge cycle**: the boss charges, a completed charge shatters a shield ring
  (reusing `Station.onEnemyReached` + regen), and **each escort kill resets the charge** (the
  interrupt). The `chargeMs` dial alone slides the feel from a dramatic blast (long) to a
  ticking beam (short) — no rebuild to try either. Result is a two-phase fight: Phase 1 race to
  pop escorts (each pop buys shield time), Phase 2 uninterrupted combined-fire race vs ~10 HP.
- **Escorts are pure gating targets**, **no asteroids** during the boss (clean finale), win/loss
  reuse the existing end-cards.

Shape: new `Boss.ts` (slide-in, charge meter + telegraph glow, fire-beam, mirrored HP text,
`setVulnerable`/`interrupt`), `Escort.ts` (orbiting kinematic target, instant `onDestroyed` on
lethal hit), `BossEncounter.ts` (phase machine `idle→escorts→vulnerable→won|lost`, owns the
shared orbit angle, shield damage, homing-target list). Boss + escort sprites are **created once
(parked)** so the **second rocket-overlap collider** is built once over them — same
never-recreate discipline as the asteroid wrappers. `WaveDirector` hands off via an injected
`onRunCleared` callback (its `victory` state became `done`; it no longer touches the victory
overlay). Homing (B14) was generalized through a shared **`HomingTarget`** interface so it keeps
working in the finale (locks escorts in P1, the boss in P2). Balance dials live in `BOSS`
(`src/waves.ts`), geometry in `BOSS_LAYOUT` (`src/layout.ts`). Verified: typecheck + build +
smoke green — added a boss assertion (a hit in Phase 1 leaves HP at 10 = invulnerable; after
killing 4 escorts a hit drops it = vulnerable) plus escort/vulnerable screenshots. **Starting
tune (un-playtested):** hp 10, escortHits 2, chargeMs 6000, shieldRegenMs 14000 — the open
question is the `chargeMs` feel and whether Phase 2 truly needs two players. **Testing aid:**
visiting the game URL with **`?boss`** boots straight into the boss, skipping the 4 waves (it
survives the tap-to-restart, so you can re-run it); normal URL plays the full run. Smoke covers it.

## B5 boss reworked — urgent cycling fight (2026-06-09, post-playtest)

First phone test of the boss surfaced three problems, fixed same day:
1. **Entered too fast** → `BOSS_LAYOUT.enterMs` 1100→1900 (slower, more menacing slide-in).
2. **No "escorts take two hits" read** → escorts are now **shield-then-core**: a magenta
   core inside a **cyan shield ring**; the first hit shatters the ring (same cue as the
   station shield), the second pops the core. Two same-size textures (`escort` / `escort-core`)
   so the swap never shifts the body; the cyan deliberately reuses the boss's own shield color.
3. **Not urgent enough.** Michael proposed the better loop, which replaced the flat two-phase
   fight: a **repeating cycle** with a **charge bar** racing you. Decisions (clarifying Qs):
   **gated window** (you only get to hit the boss if you clear all 4 escorts before the charge
   fills — more urgent + co-op, over the more-forgiving "window every cycle"), and the
   shield-then-core escort read above.

The loop: **charging** (escorts orbit, boss shielded/invulnerable, charge arc filling; **each
escort kill resets the charge**) → clear all 4 in time → **exposed** (boss drops shield, HP ticks
for `exposedMs`) → escorts respawn + re-shield → charging; or charge fills first → boss **fires**
(−1 shield ring, reuses `Station.onEnemyReached`), the **surviving escorts stay** (no respawn) and
it keeps charging on the same set. Win = chip ~10 HP across windows; lose = a fire with the shield
gone. *(Second-pass fix, same day, from Michael's test: the charge originally only reset between
cycles — too hard to prevent firing — and a fired shot wrongly respawned the escorts; now each
kill resets the charge and **only a full clear + window respawns the escorts**.)*

Shape of the change: charge **timing moved out of `Boss` into `BossEncounter`** (now a
`idle→charging→exposed→won|lost` machine owning the timer + the escort-respawn each cycle);
`Boss` lost its one-shot `setVulnerable` for per-window **`expose()`/`shield()`** toggles, gained
**`setChargeFraction`** driving a filling **charge arc** telegraph, and keeps its big mirrored HP
number visible the whole fight. `Escort` got the 2-hit shield/core. Dials: new **`exposedMs`**
(3000), retuned **`chargeMs`** (5000 = the race time) in `BOSS`. Verified: typecheck + build +
smoke green — the boss assertion now covers the gate (invulnerable while charging, damageable
when exposed) **and the cycle closing** (after the window, 4/4 escorts respawn and it re-charges);
charging/exposed screenshots confirm the read. **Still un-kid-tested at these values** — the open
knobs are `chargeMs` (urgency), `exposedMs` (window generosity), and `hp`.

## B5 boss UI — two off-boss gauges (2026-06-10, post-playtest)
The two big mirrored HP numbers overlapped the boss and read as clutter, and the on-boss charge
arc was hard to pick out in that busy center. Replaced both with **two vertical gauges in the empty
band to the boss's right** (evenly spaced between the boss and the screen edge): a green **health**
bar and a magenta **charge** bar, each filling **bottom-up** and capped at **top and bottom** with
its icon (a **heart** / a **bolt**, top copy rotated 180° for the top seat — icon recognition, no
reading; Michael's picks: icons, bottom-up, health-green, telegraph off the boss entirely). New
`objects/BossBars.ts` (a Graphics + 4 icon Images) owned by `BossEncounter`, fed `{hp, maxHp,
chargeFrac, visible}` each frame; the charge fraction is derived from the live `timer`, so escort
kills / clears reset the bar for free. `Boss` shed its `hpTexts`, `chargeFrac`/`setChargeFraction`,
and the on-boss charge **glow + arc** — only the plain shield ring remains while shielded. New
`COLORS.health` (neon green), `BOSS_LAYOUT.bars` geometry (replaces the now-gone `hpOffsetY`), and
`TEX.heart`/`TEX.bolt` procedural icons. Verified: typecheck + smoke green (boss gate + cycle still
pass); charging/exposed screenshots confirm the bars read cleanly off the boss. **Still un-phone-tested.**

## Prototype shelf — `/prototype/` endpoint for remote review (2026-06-12, remote-control)
Michael's ask while running remote: a place I can push experiments in an automated way so he can
review from his phone even when not local. Built a **prototype shelf** that ships to
`…/star-slingers/prototype/` as a subpath of the same Pages artifact (GitHub Pages serves one
site per repo, so a subpath — not a second site — is the model). The game at `/` is untouched.
- **Structure:** new `star-slingers/prototype/` — a styled `index.html` gallery + experiment pages
  (one dir deeper, so assets are `../fonts`). The B22 glow spike moved in: `glow-lab.html` +
  `glow-lab.ts` (relocated from root / `src/`; imports the real game modules via `../src/…`).
- **Build:** `vite.config.ts` went multi-page (`rollupOptions.input` = game + every `prototype/*.html`)
  and grew a small `prototype-gallery` plugin that **auto-lists** experiments into the shelf (reads each
  page's `<title>`) and stamps a build time — drop a `prototype/foo.html` and it appears, no wiring.
  `prototype/**` added to `tsconfig` `include` (typechecked) and to the typecheck; `@types/node` added
  for the config's Node imports.
- **Automated push:** new `deploy-prototype.mjs` / `npm run deploy:prototype` — stages + commits just
  `prototype/**`, **tolerates other in-progress edits** (unlike the strict `deploy.mjs`), builds, pushes,
  watches `deploy-pages.yml`, prints the `/prototype/` URL. The automated path the ask wanted.
- Verified end-to-end against the built `dist/` via `vite preview` + headless screenshots: shelf renders
  (Audiowide loads, glow-lab auto-listed) and the lab itself renders through the prototype path (WebGL
  glow on all three panels). typecheck + build green. `glow-lab.png` gitignored; `prototype/README.md`
  documents the drop-and-ship convention.

## Polish pass — ported the 3 locked prototypes into the game (2026-06-15)
- The single focused porting pass `plans/polish-pass.md` was holding open: the three shelf-locked
  effects (shields B22+B23, explosion B29, shot trail) all moved from `prototype/reference/` into the
  live game in one pass. The reference files *were* the spec — each target ported its reference's
  behaviour and numbers; the only translation was the prototypes' review-zoom (`SCALE` 2.2–2.5×) down
  to real game coordinates.
- **Shields** (`Station.ts`): rings split out of the static hull into a per-frame layer; **color**
  brightness pulses on a sine (trough 0.6→crest 1.0, ~3.2s) and flows outer→inner; an ambient
  `postFX.addGlow` disc hugs + recolors to the outermost ring and breathes; the shatter cue became a
  glow-flare-then-fade. Kept the two locked constraints (pulse color not alpha; no DPI, glow quality
  0.3). postFX guarded with `?.` for headless. New `SHIELD_FX` block in `layout.ts`.
- **Explosion** (`Asteroid.pop()` + new `Explosions.ts`): flash + shockwave + debris + sparks off
  **one shared pair of particle emitters** (`emitParticleAt`, never per-pop emitters) + one transient
  glow; baked `TEX.spark`/`TEX.shard`. `boom(x,y,r)` threaded `SandboxScene → WaveDirector → Asteroid`.
  New `EXPLOSION` block (particle speed/scale/gravity ÷2.5 from the 2.5× reference; flash/shockwave
  size off the real radius). Asteroids only; boss/escort pops unchanged.
- **Shot trail** (`RocketPool`): per-rocket history via `setData` (~75 pts), one shared additive
  Graphics redrawn by a new `RocketPool.update(delta)` beside `steer()` — a faint afterimage under a
  tapered glow/body/core exhaust with a scrolling brightness flux; head player-colored, exhaust violet.
  `WRAP_SKIP` guard ported. New `TRAIL` block.
- Verify: typecheck + build + smoke all green. Headless screenshots eyeballed the fielded shield glow,
  the violet trail behind a fired rocket, and a mid-burst explosion (spark + debris). `smoke.mjs` got a
  small cross-platform browser-path fallback (Linux `~/.cache/ms-playwright`) so the documented check
  runs off-Windows too; Windows path behaviour unchanged. Final tuning of the 2.5×→1× scale still wants
  a Pixel 6 pass (`npm run deploy`), since the references were locked on-device.

## B6 scoring + B7 wave-clear shower (2026-06-15)
- Landed together as one "the run feels rewarding" beat. **Scoring (B6):** a shared, live-only score
  on both HUDs' (already-reserved) SCORE row, **toughness-weighted** — `spec.hits × 10`, only the final
  pop scores, station-reached rocks score nothing. Driven purely from the rocket-hit path:
  `Asteroid.takeHit()` now **returns** the points (0 on a chip, `hits × perHit` on the pop); `consume()`
  (station contact) still calls `pop()` directly and never scores. New `ScoreKeeper` (`objects/Score.ts`)
  holds the total, mirrors both HUDs, and throws an accent **`+N`** popup that **grows-and-fades in place**
  — orientation-neutral on purpose (a rising number reads upside-down for the top seat). No persistence;
  `scene.restart()` resets to 0. Boss left unscored (its gauges carry the climax). New `SCORE` block in
  `layout.ts`; `__debug.score()` added.
- **Wave-clear shower (B7 visual):** confetti in the two player colors + accent rains across the field on
  **every** wave clear (top of `WaveDirector.onWaveCleared`, so the wave-4→boss hand-off celebrates too).
  One persistent shared ADD emitter in `Explosions.ts` (`starShower()`), fired via a `celebrate()` callback
  threaded exactly like the existing `boom` callback. New `STAR_SHOWER` block; tints from `tokens.ts`.
  Emission biased **downward** (angle fan 55–125°) after a first headless pass showed a full-360° spread
  shot half the confetti up off the top edge — the downward fan reads as rain over the playfield.
- Verify: typecheck + build + smoke green. `smoke.mjs` gained a scoring assertion (score **0 at boot**,
  **>0 after a pop** — fires `spec.hits` rockets to guarantee a pop, since one hit on a multi-hit rock
  scores 0). Headless screenshots confirmed the SCORE row on both HUDs and the falling confetti. Final
  shower tuning wants a Pixel 6 pass; audio + haptics stay queued in B7.

## B13 — charged shot reworked as a piercing railgun (2026-06-15)
- Michael changed the payoff: instead of the original "full charge = **2 hits**," a charged shot is now a
  **railgun** — *not stopped by anything*, it rails through **every** asteroid in its path until it leaves
  the screen. Same trigger (hold the pull), new reward (pierce, not double-damage). Locked calls: pierce
  depth **unlimited**; tough rocks **chipped once per rock** (one normal `takeHit()` each — reuses the exact
  hit path, no instakill); **homing & charge mutually exclusive** (a homing seat can't charge); **boss/escorts
  unaffected** (charged = ordinary single hit there — pierce is asteroid-only, so the finale balance is
  untouched); still **1 ammo**.
- **Charge** accrues from pointer-down in `SlingControl.update(deltaMs)` (the scene now passes `delta`),
  capped at 1 over `CHARGE.fullMs` (~600ms — the only flick-vs-charged dial); never builds while homing.
  **Cue:** the nocked rocket draws a player-colored glow disc that grows+brightens with charge and scales up,
  settling into a steady brightness/scale **pulse** at full (code-drawn Graphics, no postFX). `onFire` gained
  a trailing `charged` arg. **Pierce:** `SandboxScene.fireRocket` tags `rocket.setData('charged')`; `handleHit`
  branches — charged shots `takeHit()` + score + **don't recycle**, guarded by a per-rocket `hitSet` so the
  multi-frame overlap can't double-chip a *surviving* tough rock (a popped rock disables its body and stops
  overlapping; world-bounds still recycles). `RocketPool` resets `charged`/`hitSet` on fire+recycle.
- **Tiered trail:** the locked bright shot-trail is now the **charged** look; normal shots get a **subdued**
  tier (`TRAIL.normalMul` — ~0.45 alpha, 0.65 len), threaded as per-rocket multipliers through `strip()`/
  `afterimage()`. So the in-flight trail doubles as the railgun read.
- Verify: typecheck + build + smoke green. `smoke.mjs` gained a charged-pierce assertion modeled on the homing
  test — fires a charged rocket head-on and asserts the **same sprite is still `active` at the frame it chips
  a rock** (sampled off the rocket's own `hitSet` in one evaluation, dodging a world-bounds round-trip race),
  proving it railed through rather than recycled. Glow + charge feel want a Pixel 6 pass.

## B30 — asteroid split (2026-06-15)
Built B30, Classic-Asteroids juice for the kids: a tough rock (2- or 3-hit) **killed by a rocket**,
on its **final pop only**, scatters **2 small 1-hit fragments**. Rewards the 9yo's hunt for big
toughness-weighted rocks with more action + more points, while each fragment stays trivial for the
5yo. Decisions locked with Michael (in the plan): fragments **threaten the station** (funnel in,
can cost a ring — a self-balancing "winning tax"); fragments **score** their own 1-hit pop (10 pts
each, via the existing path); **only rocket-kills split** (a station-reached rock — a loss — never
does); 1-hit rocks never split; chipping a multi-hit rock doesn't split (final pop only).
- **The crux was the fixed pool.** The rocket→asteroid overlap collider is built **once** over
  `this.asteroids.map(a => a.sprite)` and the wrappers are never recreated, so new shootable
  fragments can't be made mid-scene. Solution: **pre-allocate fragment wrappers and append them to
  the same `this.asteroids` array** (one array, one collider) before the collider line runs. They
  inherit the collider, the `update()` loop, `checkStationContacts()`, `pickHomingTarget`, and the
  wave-clear field-empty check for free. A separate array + second collider was rejected (would
  duplicate all four). Fragments differ from lane rocks in exactly two ways: `onWantRespawn` returns
  **false** (one-shot — pop/exit/expire parks them, never respawns off the right edge) and they're
  fielded **in-field with a scatter velocity** (`spawnFragment(x,y,vx,vy)`) instead of off the edge.
  Scatter is **leftward-biased** (cone centered at 180°) so fragments head into the field and the
  existing funnel + station-contact + left-exit logic all engage with no new bounds.
- **Two load-bearing guards.** A **spawn grace** (body off ~100ms, also `takeHit()` returns 0 during
  it) stops an in-flight railgun — whose per-rocket `hitSet` predates the fragment — from chipping a
  fragment the instant it spawns. A hard **lifetime cap** (~6s) guarantees the wave can always clear:
  fragments correctly count toward field-empty, so without the cap a fragment that never reached an
  edge/station could hold a wave open forever. `update()` now takes `delta` to drive both clocks.
- **No scoring/solver/difficulty change.** A fragment *is* a 1-hit rock, so `takeHit()` already
  returns `1 × SCORE.perHit` = 10 on its pop. Split is wired in `handleHit` (both the charged-railgun
  and normal branches) keyed on `pts > 0` — a rocket-kill — so `consume()` (station-reached) never
  splits. `threatOf` (waves.ts) deliberately doesn't model fragment threat (documented inline + spec
  §7): they only appear when winning, are trivial, and the regen leak absorbs strays; the cheap tuning
  knobs if it's too much are `SPLIT.fragmentSpeed`/`lifetimeMs`, not the calibrated wave targets.
- New `SPLIT` block in `src/layout.ts`; `makeAsteroid(scene, SPLIT.fragmentRadius)` baked in
  `textures.ts` (NOT added to `RADIUS_BY_HITS` — that map is the solver's hits→radius contract);
  `fragment`/`aliveMs`/`graceUntilMs` + `isFragment` + `spawnFragment` in `Asteroid.ts`; `fragmentPool`
  + `splitCount` + `spawnFragments(origin)` in `WaveDirector.ts`; `__debug.fragmentsAlive`/`splitCount`
  in the scene. Verify: typecheck + build + smoke green. **smoke caveat:** headless software-WebGL
  runs game-time ~10× slower than wall-clock (ReadPixels GPU stalls clamp Phaser's per-frame delta,
  so a 2.2s breather `delayedCall` takes ~17s wall to fire) — confirmed via a Sonnet review + probing,
  it's a headless artifact, not a game bug. So the split assertion can't cheaply advance to a wave
  with 2-hit rocks; it instead fields a 2-hit rock directly via the public `reconfigure()`/`spawn()`
  path (what `startWave` does), kills it, asserts `splitCount` rises + ≥2 fragments + score +≥20 once
  popped. Existing selectors hardened with `!isFragment`. **Un-phone-tested** — wants a Pixel 6 pass
  (kill a 2-hit + a 3-hit, confirm scatter/funnel/score/ring-cost, that a station-reached rock doesn't
  split, that the wave still clears with fragments in flight, and that a charged railgun's fragments
  survive the same pass via spawn grace).

## B31 · Smoke → `@playwright/test` (2026-06-15)
Promoted the 250-line hand-rolled `smoke.mjs` (run manually via `node smoke.mjs`, needing a dev
server already up) into a real `@playwright/test` suite — the same move `../reflex-game` made.
**Why:** the old script only *partially* failed — timeout `waitForFunction`s threw (non-zero exit),
but every *semantic* check folded into a boolean (`bossOk`, `splitScored`, `pierceActive`,
`escortsBack===4`) just `console.log("…FAIL")` and **exited 0**; a real regression could print FAIL
and still pass the process. **Scope locked with Michael: runner only** — no `toHaveScreenshot`
visual baselines (OS-AA-sensitive, flaky across Windows/Linux/CI, and the game has few static
frames); we keep emitting the `smoke-*.png` screenshots purely as eyeball aids. New
`playwright.config.ts` (webServer auto-start on a dedicated **:5181**, distinct from reflex's 5180;
Pixel-6 360×740 touch viewport; swiftshader GL flags; `workers:1`; a 90s per-test `timeout` because
headless game-time runs ~10× slow) + `e2e/sandbox.spec.ts` (1:1 port split into 8 named `test()`
cases — boot-clean, hit, score, homing, pierce, split, boss-cycle, `?boss` — each old `…OK/FAIL`
now an `expect()`, every case gating on zero console errors via `beforeEach`/`afterEach`). Dropped
the custom cross-platform chromium resolver — **standard** Playwright resolution + `npx playwright
install chromium` (a no-op here; `chromium-1228` was already cached and is the build `@playwright/
test@^1.60` pins). The split case keeps its `reconfigure()`/`spawn()` direct-field trick and the
headless-slow-gametime caveat comments. Deleted `smoke.mjs`; swapped `playwright-core`→
`@playwright/test`, added `"test": "playwright test"`; `e2e/` left out of `tsconfig.json` `include`
(Playwright transpiles the spec, so `typecheck`/`build` don't need the types); `.gitignore` gained
Playwright's `test-results`/`playwright-report`/`blob-report`/`.last-run.json`. Verified: all 8
cases green via the auto-started server; **proved it now fails loudly** — temporarily emitting 1
fragment instead of 2 turned the split case **red on a value assertion with a non-zero exit** (the
exact gap the old script left open); typecheck + build still green (e2e excluded from tsc). CLAUDE.md
/ README / spec §8 references synced.

## B32 · difficulty floor → 0.30 + B35 · railgun charge cue → pull-back arc (2026-07-10)
Two independent `decided` items worked together (different files, no overlap).

**B32 — raise the difficulty floor.** The opening was a crawl: W1 targeted `required` 0.05, but its
shield-regen leak (0.10) already exceeded that, so the solver pinned W1 to the literal floor (3 lanes
@ `minSpeedScale` 0.5 — ~20–28 px/s, ~3% break-even). **Pure target retune, no model change** (Michael
picked the even ramp, Option A): `WAVES.required` 0.05/0.20/0.45/0.75 → **0.30/0.45/0.60/0.75**. At
this floor the solver math shows every wave blows past the count + speed levers into the toughness
tier, so all four run **4 lanes @ ×0.85** and toughness is the whole ramp — dev boot log confirmed
**W1** one 2-hit (be 17%) · **W2** three 2-hit (27%) · **W3** four 2-hit (34%) · **W4** 3-hit + three
2-hit (38%, unchanged). `minSpeedScale` is now moot (no wave stops in the speed tier); `DIFFICULTY_MODEL`,
lanes, regen, quotas all left untouched. **The slow-lane gentle lever is gone from W1** — the 5yo's
cushion is homing (B8/B14); if W1 plays too steep for him next playtest, soften its target toward ~0.25,
don't reintroduce slow lanes. **Un-phone-tested.**

**B35 — railgun charge cue → the pull arc as a progress bar.** Retired B13's glow-disc-behind-the-rocket
cue (`drawChargeCue` + the `CHARGE.glow*`/`rocketScale`/pulse-disc dials) and re-cued charge onto the
half-circle pull arc. Two locked decisions (Michael, AskUserQuestion): charge fill color = **violet
accent** (alias onto the existing shield-mid / trail violet, `COLORS.charge` — no new hue), and ease-off
behavior = **reset charge to 0** (a continuous full pull is required). Charge now accrues only while the
dot is held past **`CHARGE.pullThresholdFrac` 0.88** of the pull radius and resets the instant it eases
below — turning the railgun into a held-full-pull skill with a progress-bar read (`fullMs` 600 kept; may
want lowering on the phone since pull-back time no longer counts). Arc states: below threshold = the
resting **dashed** player-color arc shows through (`staticGfx` untouched); at/above threshold, charge<1 =
a **solid** player-color arc (new `drawSolidArc` helper — `drawDashedArc`'s arc-length walk with no gaps,
covering both the base and the partial fill) with a **violet** fill sweeping `start → start+charge·span`;
charge==1 = full violet arc with an "armed" brightness breath (reused the existing `elapsed` sine).
Homing seats stay dashed and never charge (unchanged). New `tokens.ts` `COLORS.charge` + `STROKES.chargeArc`.
**Verified:** typecheck + build clean; drove the gating in-app (Playwright) — partial pull → charge 0,
full pull → 0.5 @300ms → 1.0 @700ms, ease-off → resets to 0, homing seat → stays 0; screenshot confirmed
the solid violet fill (P1 half-charged = half violet/half cyan, P2 full = all violet). The charged-pierce
Playwright case stays green (it drives `rockets.fire(...)` + `setData('charged')` directly, bypassing the
pull path, so the new full-pull gate doesn't touch it). **Un-phone-tested.** *(Note: the `off-axis homing`
and `boss gate + cycle` Playwright cases are pre-existing flakes — both fail ~2/3 on `--repeat-each=3`
on the untouched baseline too, independent of this work.)*

## B36 · Fix the flaky Playwright tests — fixed-timestep harness (2026-07-10)
Test-infra only, **no game-behavior change**. The suite wasn't trustworthy: `off-axis homing` and
`boss gate + cycle` failed ~2/3 on `--repeat-each=3`, and under `--repeat-each=5` the drift-window
cases (`head-on`, `full-pop`, `charged`) flaked hard too (`charged` failed 5/5).

**Root cause (spike-confirmed, refined the plan's hypothesis).** Every failing case waited on a
*game-time* event behind a *wall-clock* `waitForFunction`/`waitForTimeout` while headless software-WebGL
runs game-time ~10× slow. Two flavors: (a) the "wait for a wave rock to drift into a narrow x-window"
scan (30s budget, blown under load), and (b) game-time timers (homing `dist`, boss `chargeMs`/`exposedMs`)
outrunning short wall-clock waits. **The fix is to stop using the wall clock as the test clock.**

**Harness (chosen with Michael — option: drive a fixed timestep).** `stepGame(page, dt=16, n)` parks
the RAF loop (`game.loop.sleep()` → `raf.stop()`, fully deterministic across CDP round-trips) and
advances frames manually via **`game.scene.update(t, dt)`** — SceneManager → each scene's `Systems.step`
→ physics `world.update` + overlaps + `scene.update`, all in lockstep, **no render**. Two spike findings
corrected the plan: (1) `game.step()` *renders* each frame (the slow ReadPixels path — 330 steps blew the
90s timeout), so use `scene.update` instead → the whole 30s boss window becomes ~20ms of stepping;
(2) **Phaser 3.90's `TweenManager.getDelta` is wall-clock (`Date.now()`)**, so tweens do *not* advance
under stepping. Only the boss slide-in is a tween, so it needed the plan's fallback: a minimal DEV hook
**`Boss.snapEntered()` → `BossEncounter.snapBossIn()` → `__debug.snapBossIn()`** (kills the entrance
tween, snaps to the parked/entered state its `onComplete` would reach). Homing steering and boss timers
are all `deltaMs`-driven, so they step perfectly.

**Rewrites.** All 5 interaction cases now **field a stationary rock directly** (shared `fieldRock()` over
the `reconfigure()`/`spawn()` path the split case already used) and step to a bounded frame budget with
`stepUntil()` — no drift-window scan, no moving-target race, no wall-clock timeout. `head-on`/`full-pop`/
`charged`/`homing` migrated; `boss` uses `snapBossIn()` + stepping. `full-pop` got *stronger*: it fields a
2-hit rock and asserts the chip scores **0** before the pop scores **>0** (the old version just fired
`spec.hits` shots at whatever drifted by). The invuln check also got stronger — the shot now actually
**crosses** the boss (~40 frames) instead of barely moving in ~40ms of headless game-time.

**Verified.** typecheck + build clean; **`--repeat-each=5` → 40/40 green** (8.9 min, was 16.5 with 11
timeouts); the two former-flaky cases spot-checked **`--repeat-each=10` → 20/20**; no `.only`/`.skip`;
`smoke-*.png` frames still emit; every case still gates on zero console errors. Game code touched only by
the DEV-only `snapBossIn` hook (`Boss`/`BossEncounter`/`SandboxScene.__debug`); `playwright.config.ts`
unchanged (its 90s per-test budget is now vast headroom — stepped cases are 3–18s). The 6 "leave them
green" cases from the plan turned out to flake at `--repeat-each=5`, so — **decided with Michael** — the
scope extended to migrate all 5 interaction cases (not just the 2 named), finally making a green
`npm test` trustworthy.

**Speed pass (same day, Michael asked "8 min is a long time").** Profiled where the wall-clock actually
went — *not* the stepping (300 in-browser steps = 11ms; a 188-frame boss recharge = 8ms). Two real
costs: (1) **`page.screenshot()` = ~7s each** in headless swiftshader (the ReadPixels path), ×7 frames
×5 repeats ≈ 4.4 min — and since we now step *without* rendering, the frame is stale anyway. Made the
`smoke-*.png` frames **opt-in** (`SMOKE_SHOTS=1`); default `npm test` skips them. (2) **CDP round-trip
latency under machine load** — rewrote `stepUntil()` to run the entire step loop **inside one
`page.evaluate`** (via `new Function` on a condition string), so a long window is one round-trip, not
one per batch; folded `charged`'s fire+step+read into a single evaluate; replaced `gotoGame`'s fixed
`waitForTimeout(1000)` with a `waitForFunction` on the scene's `__debug` (returns as soon as `create()`
ran). Default 8-case run dropped ~2min → ~50s.

*Two more culprits, found by profiling on a cleaned machine (Michael killed a runaway Playwright-**MCP**
Chrome — a stuck swiftshader GPU process from a prior session pinned at ~987% CPU / ≈10 cores for 3+ hrs
— which had been inflating and jittering every run; note it was the **MCP** browser, not the test
suite's ephemeral one):* (3) **the live RAF render loop**. Any `page.evaluate` that touches the scene
while Phaser is still rendering **stalls ~0.8s** waiting for the in-flight software frame — `rockets.fire`
timed at ~800ms wall but **0.5ms** in-browser. So `gotoGame()` now **parks the loop** (`loop.sleep()`)
right after boot; every interaction is then instant (**boss 8s → 1.7s**, `full-pop` 9.4s → 1.6s, homing
3.2s → 0.28s). That forced migrating the **split** case too (the last one still on `waitForTimeout`,
which needs a live loop) onto `stepGame` — its fragment-chase is now one in-browser loop. (4) **context
reuse and parallel workers don't help** — measured: a warm-context reload saves only ~150ms over a fresh
context (context boot isn't the cost), and `fullyParallel`+4 workers *worsened* per-test times because
the single software-GL context + single Vite server serialize the parallel contexts anyway. Config stays
`workers: 1`. **Net: `npm test` ~8 min → ~15s (8 cases); `--repeat-each=5` 8.9 min → ~1.1 min, still
40/40 green.** The game-driving was never the cost — it's headless swiftshader's slow rendering, dodged
by never rendering (park the loop, step logic only, screenshots opt-in).

## Open questions
All moved to `backlog.md` (2026-06-06; now archived below): **lanes** → resolved by the v5 funnel
(shared field); **shield rendering** (chunky segments vs smooth arc) → folded into B1 and
resolved there (concentric rings); **working title** → B11.

## Style exploration (2026-06-05)
Five style variants were generated under the mock conventions (see `tech-stack.md`).
After review, the field narrowed to two contenders: **neon arcade** and **Asteroids
vector** (plus the wireframe as the neutral reference). Chunky cartoon, retro pixel,
and hand-drawn storybook were eliminated and moved to `mockups/shelved/`.
Open `mockups/index.html` to compare. Picking the winner (ideally on the phone) is
**backlog B9**; note the contenders are still cut against v3 geometry (**B10**).

**Decided 2026-06-07 (chat): Neon Arcade wins (B9).** Synthwave palette — deep
purple-black space, hot-cyan P1 / amber-orange P2 / magenta enemies, fat glow,
Audiowide. Same turn, **B10** done for the winner: `mockups/style-neon.html` re-cut
onto v5 geometry (tiny off-screen edge hull, 3 concentric shield rings, funneling
rotated ships, v5 annotations + neon defs/paint). The losing skins (vector, wireframe)
were left on v3 — no re-cut needed. Porting the palette into the code-drawn game
is **backlog B21** (the actual "add color to the game" work; mock signed off first).

**Done 2026-06-07 (chat): neon palette ported into the game (B21).** Palette-first port:
`src/tokens.ts` rewritten to the `tokens-neon.css` values, plus the fills the wireframe
never had (rock interior, hull fill, and the 3 shield rings each taking one stop of the
cyan→purple→magenta `#neon-shield` gradient). Audiowide loads before Phaser boots
(`index.html` link + `main.ts` `document.fonts` await) so no fallback flash. **Glow/bloom,
shield brightness pulse, and gradient fills deferred** — none exist in code (all flat fills)
— split into **B22 / B23 / B24**. *(The skin item was briefly mislabeled B20, colliding with
the resolved difficulty-dials B20; renumbered to B21.)* Same turn, **"prototype" → "the game"**
across the docs (Michael's call — it's promoted): active labels in CLAUDE.md / spec / backlog
/ notes + the hub framing in `plans/README.md` and `tech-stack.md`; dated history (this
section's "## Prototype" markers) and the two still-concept specs keep the word.

## Mockups
- `mockups/layout-edge-wireframe.html` — **canonical layout (v5)**: compact station mostly off-screen left, funnel approach.
- `mockups/style-wireframe.html` — canonical **v3** geometry that the neon/vector style skins are cut against (layout superseded by v5; kept until the B9/B10 re-cut).
- `mockups/shelved/` — eliminated style skins (cartoon, pixel, hand-drawn), the rejected v4 central-core layout, and the superseded `ui-mock-v1/v2`.
  - `ui-mock-v1.html` — portrait, both slingshots in the bottom corners, station dome on the bottom edge, enemies descend from the top. Superseded.
  - `ui-mock-v2.html` — the v2 layout (players facing each other, station down the left wall). Superseded by v3+.

## Layout history
- **v0 (spec draft 1):** landscape, players at the long edges, symmetric defend-the-middle. Rejected — slingshot pull feels better in portrait.
- **v1:** portrait, players side-by-side at the bottom. Rejected — not the picture; players should face each other.
- **v2:** portrait, players at top/bottom edges, station on the left wall, horizontal battle. ✅ Core arrangement agreed; original spec.md written against this.
- **v3 (2026-06-05):** refinements from wireframe review:
  - **Station is a half-disc** concentric with the shield arc (tiny Death Star / ring-station read), not a hull strip.
  - **Per-player HUDs** — wave · score (shared value) · ammo at each player's end; **P1's HUD is rotated 180°** so it reads right-side-up from the top edge. Shield strength omitted (the arc itself shows it); revisit if cramped.
  - **Abstract sling controls** — not literal slingshots: an **anchor dot** where the finger starts plus a **pull-range arc** showing draw distance/angles. Matches how the touch input will actually work.
  - The "spec.md §5 still describes v2" drift flagged here was resolved by the 2026-06-06 re-sync.
- **v4 (explored & rejected, 2026-06-06):** central core — station shrunk to a small rotationally-symmetric core at dead center, shield as a full 3-segment ring, enemies converging from both long sides, plus a dim "final-approach ring" urgency telegraph. Freed the left wall and read right-side-up from both seats, but **rejected: a centered objective sits in the middle of everyone's firing lines, so players can't cover for each other** — and cover fire is the heart of the co-op. Mock: `mockups/shelved/layout-core-wireframe.html`.
- **v5 (current, 2026-06-06):** compact edge station — keeps v4's small station size but slides it mostly off the left edge (hull r=24, shield r=46, centered at −10,370; intrudes ~36px into the field vs v3's 120px). Enemies sweep right→left as in v3 but **funnel toward the station** on final approach (ships' noses/shots aim at it), keeping the whole field shared. The final-approach glow/hum telegraph idea from v4 carries forward. Mock: `mockups/layout-edge-wireframe.html`; spec.md rewritten against this in the same re-sync.

## Design watch-items from the chat
- Shots cross the enemies' path, so **leading the target is the core skill** — satisfying for an adult, possibly tricky at 5. Confirmed by playtest 1; fairness levers tracked as backlog B8 (aim-assist, slower lane, telegraphed shots); playtest these early.

## Build history

- **#21 · In-game lefty swap per seat (PR #37, 2026-11-03):** a ⇄ above FIRE, held 800ms (letting go or sliding off cancels), mirrors that seat only (buttons, aim pad, aim zone, HUD) and is remembered on the phone (`starSlingers.lefty`, same key and values as before). It replaces the `?lefty` URL switch. Placed in game, not on the join screen, because kids find out they're on the wrong side mid-fight; hold-to-switch plus a spot away from the aim thumb keeps a mashing 5yo from flipping by accident. A swap mid-charge drops FIRE without firing. Playtest: the ⇄ sits under the aim line at ~150–163°, and there's no buzz on swap.
- **#20 · Join screen (PR #35, 2026-11-03):** every boot opens on a join screen. Each seat joins in its own half, picks Easy (∞, unlimited FIRE + SPECIAL ammo) or Normal, and a 3-2-1 countdown starts the run with only the joined seats. A lone seat plays solo at its own edge, top or bottom. Tapping your ring again leaves, with a 500ms grace so a double-tap stays joined. A join or a leave restarts the countdown. Try again keeps the lineup, and a win returns to the join screen. `?players` was removed (the lineup travels as Sandbox scene data and isn't remembered across reloads). Decisions D1–D7 are on #20. To check in playtest: the HUD's ∞ uses the Courier New fallback, because Audiowide has no U+221E. Both #22's and #20's owner sessions had `gh pr edit`/`gh pr ready` refused by the auto-mode check, which had allowed it for #17/#23/#24 earlier the same day; Michael took the PRs out of draft and merged them himself.
- **#22 · Weapons: railgun FIRE + SPECIAL homing missile (PR #36, 2026-11-03):** FIRE is the railgun. A plain round does 1 damage and stops; a charged round does 2 and carries on only past a kill, including past an escort it downs, into the boss through the new gap. HOME → SPECIAL: a homing missile, hard to miss (45° cone, re-acquires if its target dies, 3s lifetime, never locks a rock still off-screen), with its own 2-shot pool (1 per 3s) on a 4th HUD row with the special's icon. Boss: charged rounds only, 1 HP per hit. Per-seat `setUnlimitedAmmo` for #20. Both pools' regen clocks now restart when a pool drops from full, so a full pool can't fire and instantly refill. Owner decisions D1–D7 are on #22, revisable in playtest; the missile ranks targets by distance from the aim line, the first dial to try if the 5yo's missiles go long. The first owner session lost its shell to the auto-mode check mid-build and was relaunched from its notes.
- **Main is hosted on GitHub Pages only (2026-11-03):** two production hosts meant two phone installs to keep in sync, and a PR merged on GitHub updated Pages (via `deploy-pages.yml`) but never the Worker. `deploy.mjs` no longer runs `wrangler deploy`; Cloudflare stays for branch previews (`npm run deploy:preview`), which Pages can't do. The Worker's own workers.dev URL is left frozen at `main@c4af1c5` and isn't maintained.
- **#24 · Run structure: 10 waves in 4 acts (PR #34, 2026-11-03):** the run is one `RUN` table in `src/waves.ts`: act 1 asteroids ending in a giant-asteroid boss, act 2 ships ending in the command-ship boss at wave 6, act 3 monsters ending in a monster boss, act 4 the finale. Unbuilt kinds play as placeholder asteroid waves until #25/#27/#28. The command-ship win now continues the run; victory comes after wave 10. Between waves come the boss-drop (#26) and act-transition (#29) hooks, with no behaviour yet. `?wave=N` jumps to any wave (`?boss` = 6). Try again restarts at the lost act's first wave (Michael's call), and with a shortcut it never goes back before wave N. Phaser 3.90 keeps the previous `settings.data` on `restart(undefined)`, so the win card passes `{}`. Placeholder dials: W1 0.30·8·10s … W10 finale 0.90·24·8s.
- **#23 · Enemy health bars (PR #33, 2026-11-03):** a damaged enemy (hp left < max) shows a short vertical green pill off its right side (left side at the field's right edge), filled from the centre so both seats read it the same. It replaces the crack marks on multi-hp rocks; the white hit flash stays. One shared Graphics drawn on POST_UPDATE (`src/objects/HealthBars.ts`, dials in `HEALTH_BAR`). Decided: the boss keeps its own HEALTH gauge; shields, the shield web and escort lock fins get no bar. Only asteroids can have hp > 1 today, and none do in the run yet, so players won't see a bar until tougher enemies arrive.
- **#17 · e2e shared helpers (PR #31, 2026-11-03):** `mirrored()`, `enterBoss()` and `shieldLinks()` live in `e2e/helpers.ts`. The boss entry and link-count reads are no longer copied per spec, and `e2e/` has no literal game size left. Same 23 cases, same assertions. AC3 was reworded: the repeated read was `__debug.shieldLinks()`, not `webLinks()`.
- **#18 · Keep Node types out of game code (PR #32, 2026-11-03):** the root `tsconfig.json` included `vite.config.ts`, and vite's types open with `/// <reference types="node" />`, so `process`/`Buffer` type-checked in `src/` (found in #15). `tsconfig.e2e.json` became `tsconfig.node.json` and now checks `e2e/`, `playwright.config.ts` and `vite.config.ts`; the root config is browser-only (`src/`, `prototype/`). A never-imported `src/no-node-globals.ts` holds `@ts-expect-error` on `typeof process`, so a future leak fails `typecheck` with TS2578. Proved with a temporary `process.env` probe (passed before, TS2591 after). Known gap: editors don't discover `tsconfig.node.json`, so VS Code checks `vite.config.ts` and `e2e/` as loose files; `npm run typecheck`/CI check them strictly.
- **#5 · Docs moved to `docs/`, backlog retired (2026-11-03):** `plans/spec.md` became `docs/design.md`, and its role changed from "reviewed design" to **the game as built**. Work not built yet lives in GitHub Issues (the colony-ship campaign vision is #30). `plans/notes.md` and `plans/tech-stack.md` moved to `docs/`. `plans/backlog.md` was retired: its resolved B1–B40 write-ups are archived verbatim at the end of this file. `plans/` keeps work in progress: `polish-pass.md` and `mockups/`. The Pages deploy and `deploy.mjs` treat `docs/**` as docs-only. `CLAUDE.md`'s doc table and change flow now run on issues (status labels, `draft` label), and new work is named by issue number. The design doc's calibration TODO moved to #6.
- **`npm run deploy` also publishes the Worker (2026-11-03):** after the Pages deploy verifies, `deploy.mjs` runs `wrangler deploy` (tag `main@<sha>`) so https://star-slingers.green-smoke-1027.workers.dev serves `main` too. Michael chose to keep Pages as well; the two hosts are separate phone installs. Branch previews are unaffected.
- **controls-v2 merged into `main` (2026-11-03):** `main` fast-forwarded to `controls-v2` (17 commits: health/damage, the two-thumb + drag-aim controls, solo `?players`, haptics, the shield-web fix, the e2e split) and deployed to Pages. The pre-merge `main`, the sling-controls game, is tagged **`v1`**. `controls-v2` stays on GitHub with its Cloudflare preview alias.
- **#15 · Split e2e suite + type-check e2e/ (PR #16, 2026-11-02):** `e2e/sandbox.spec.ts` (22 cases) split into one spec per area: `combat` 7, `waves` 2, `boss` 3, `solo` 2, `controls-v2` 5, `haptics` 3, sharing `e2e/helpers.ts`. Its exported `test` carries the zero-console-error gate as an auto fixture (replacing the beforeEach/afterEach pair); a new `harness.spec.ts` guard fails if a spec imports `test` from `@playwright/test` and so skips the gate. Case bodies moved verbatim, proven by a TS-AST body diff with 4 expected hunks: 2 unused `hitsBefore` removed, 2 comments the move made false. `tsconfig.e2e.json` (root + `types: ["node"]`, since TS 6 loads no `@types` by default) brings `e2e/` + `playwright.config.ts` under `npm run typecheck`, and `build` now runs `typecheck`, so CI and the deploy pre-flights catch e2e type errors. Found on the way: the root tsconfig is not browser-only, because vite's types pull Node globals in through `vite.config.ts`. Suite time unchanged (`--repeat-each=3` 1.3m before, 1.4m after with the guard; 23 cases in ~27s).
- **#7 controls decided: two-thumb + drag aim (2026-11-02, `controls-v2`):** Michael's solo
  playtest on the Pixel picked the **two-thumb controls** over the old sling, and **drag aim** over
  arc aim; lefty mirroring stays as an option. Removed the losing variants: `SlingControl`,
  `HomingToggle`, the `SeatControl` interface, arc aim, and the `?controls`/`?aim` switches
  (`?lefty` and `?players` remain). spec §1/§2/§5/§6 rewritten for the two-thumb controls. Design
  change worth remembering: homing was an opt-in per-seat toggle (on for the 5yo, off for the
  9yo); now HOME is a button both players always have. Haptics accepted at 20/25/40/20 ms. They
  first seemed dead on the Pixel because Android's **Touch feedback** setting was off, and Chrome's
  `navigator.vibrate` is silently ignored while it is. Four thumbs at once (co-op) is still
  unplaytested.
- **cv2-batch-1 (2026-11-01/02):** four issues run in parallel against `controls-v2`, one owner
  session each, landed as squash-merged PRs. #10 (a WebKit + offline service-worker check) was
  built (PR #13) and then **dropped**. The game has no iPhone or offline requirement, and the WebKit
  failure it guarded can only happen offline in this service worker. #10 was closed as not planned.
- **#6 single-player prototype slice (PR #14):** `?players=1|2` solo switch (remembered like
  `?lefty`). Solo plays the bottom seat only: P1's controls, HUD, banner and end-card copies are not
  built. Temporary escort rule until #7's shot-type locks: two hits, both may be the one player's.
  `SOLO.requiredScale` dial in `src/waves.ts` ships at 1.0 for the playtest to tune. Known oddity:
  the half-hit escort shows the cyan half to the amber solo player. Boss timing is unscaled in solo.
  Still open in #6: the scaling model, and choosing solo with an on-screen join button for the top
  seat instead of the URL switch.
- **#3 haptics half (PR #12):** `navigator.vibrate` per shot fired (one call in
  `SandboxScene.fireRocket`; railgun > homing > plain), plus one armed tick per FIRE hold when fully
  charged with ammo. `src/haptics.ts` feature-detects (iPhone no-op) and skips until the first tap,
  because Chrome logs a console *error* for a vibrate before any user activation, and the armed tick
  runs from `update()`, outside a touch handler. Dials are `HAPTICS` in `src/layout.ts`. Audio is
  still open in #3.
- **#8 shield-web collision (PR #11):** `ShieldWeb.blocks()` now stops a rocket exactly when the
  drawn rocket touches the drawn link, along this frame's real path. It had four faults:
  - it added `webWidth/2` twice;
  - it swept from `body.prev`, the body's *top-left*, which gave every rocket a phantom ~8-unit tail;
  - it ended the sweep at `rocket.x/y`, which is still the frame-start position during
    `scene.update` because Arcade syncs the sprite in postUpdate, so fast shots could tunnel;
  - its reach was a fixed `max(w,h)/2 = 7`, so side-on shots were stopped ~3 units early.

  It now sweeps `body.prevFrame` centre → `body.center`, with reach = the rocket's rotated
  half-extent along each link's normal (7 nose-on, 4 side-on) + `webWidth/2`. Covered by the e2e case
  'boss shield web blocks rockets at the drawn edge'. No retune; the net boss difficulty change is
  small and runs both ways.
- **#7 controls v2 prototype + asteroid health (2026-11-01, `controls-v2` branch only):** two
  parallel builds, merged with history kept. **Health/damage:** `takeHit(damage)`, an `hp` per
  `ASTEROID_KIND` (1 for both kinds), a `DAMAGE` table (normal/homing/railgun all 1), and the
  solver now counts *clear damage* (a splitter = 1 + 2 children = 3). Every wave's solver output
  was byte-identical before and after. Rocks with max hp > 1 show code-drawn cracks plus a white
  hit flash, which nothing in the run uses yet. spec §5/§7 synced. **Controls v2:** one thumb aims
  on a pad (`arc`: thumb direction is the aim; `?aim=drag`: sideways motion turns it), and the
  other holds FIRE (release fires at `SLING.maxSpeed`; held ≥ `CHARGE.fullMs` it fires the
  railgun) or HOME (shows the lock ring while held; release fires homing, never charged).
  Launchers stay at the old anchors, HUDs move to the centre column, the homing toggles are
  hidden, `activePointers` goes 3 → 6, and the geometry lives in `CONTROLS_V2` (`layout.ts`).
  `?controls=sling` keeps today's game; `?controls`/`?aim`/`?lefty` are remembered in
  localStorage for the installed PWA. The shelf page `prototype/controls-v2.html` links every
  variant. `playwright.config.ts` takes `PW_PORT` so parallel worktrees don't share a dev
  server. The e2e cases drive real multi-touch through CDP `Input.dispatchTouchEvent`, which
  Phaser 3.90 processes synchronously even with the RAF loop parked. A `touchMove` that omits a
  finger does *not* lift it; it needs a `touchEnd` carrying only that finger. typecheck, build,
  and all 16 tests are green, 48/48 at `--repeat-each=3`. Deployed to the Workers preview only;
  `main`/Pages untouched. The controls design stays out of spec.md until the Pixel 6 playtest
  accepts it: arc vs drag, thumb clearance vs HUD/launcher, can the 5yo hold to charge, is HOME
  a good assist.

- **Whole-repo simplify pass (2026-11-01):** a background `/simplify` session ran over all the
  code in an orphan worktree, and its changes were reviewed hunk by hunk before being applied.
  Behaviour is unchanged. Removed the dead code B34 left behind: `BOSS.exposedMs` and
  `escortHits`, the always-false `canChargeWhileHoming`, the boss's unused `popping`/`dead`
  state, and the B37-blank asteroid label. Shared helpers now replace duplicated code
  (`splitPair`, `startBossNow`, `popField`, `RocketPool.recycleWhere`, a single `window.__step`
  test stepper). The rocket trails and the charge arc lost their per-frame allocations, and
  side-by-side screenshots of the old and new versions came out identical. Added
  `COLORS.white` and `BOSS_LAYOUT.escort.webWidth`. Rejected two changes that saved almost
  nothing and made the code harder to read: `ShieldWeb` link-slot reuse and a hand-rolled
  `aliveEscorts` loop. spec §5/§9 synced (the stale B33 homing-charge exception is gone).
  Its "left alone" list is a future to-do: the shield web pads its width twice, and the
  deploy scripts share ~60 duplicated lines.

- **B34 — Boss command ship + shield web (2026-08-05):** replaced the remaining
  circle-heavy boss presentation and the clear-all-escorts/exposed-window gate. The command
  ship now shares the escorts' directional hull language and has no shield decoration. Four
  station-facing escorts rotate as a rigid diamond at fixed radius; each live adjacent pair
  creates a neon shield-web blocker. A two-player escort kill removes its two links for 6s,
  resets and pauses the charge, then regenerates the node with fresh locks. A charged railgun
  can damage the always-vulnerable boss only by physically travelling through a gap; web lines
  consume ordinary and charged rockets. Homing remains escort-only and charge-exclusive.
  Added `ShieldWeb` swept-line collision, deterministic debug reads, and replaced the boss
  Playwright scenario with locks/gap/pause/regeneration/beam coverage. `typecheck`, build, and
  all 9 tests green. The tap-through `prototype/boss-command-lab.html` is ready for phone review;
  the live port remains un-phone-tested.

- **B40 — Longer boss exposure (2026-08-04):** phone feedback found the original 3s
  shields-down window too brief for a 10-HP boss that only takes charged railguns, risking a
  dragged-out fight. Doubled `BOSS.exposedMs` from **3000ms to 6000ms**. Kept the 5s escort
  charge, 10 HP, and all railgun timing/visuals intact. Updated the deterministic cycle budget.

- **B39 — Shareable boss link (2026-08-04):** documented the existing GitHub Pages boss shortcut:
  `https://michac.github.io/star-slingers/?boss`. It preserves the normal full-run URL and lets phone
  playtests jump straight to the finale.

- **B33 — Co-op escort boss redesign (2026-08-03):** locked the visual in
  `prototype/reference/escort-coop-lock.html`, then ported its station-facing directional
  ships and cyan/amber lock fins into procedural escort textures. Rockets now carry `p1` /
  `p2` identity through the pool and boss overlap. Every escort requires one unique hit from
  each player in either order; the first breaks its own color fin, pulses the remaining one,
  and duplicate-color shots make only a muted reject spark. Partial progress persists through
  boss beams; exposure-window respawns restore both locks. The exposed boss now takes damage
  only from charged railguns (one HP each); normal homing is still harmless, while homing is
  allowed to charge only in that boss-only window and shows lock + charge cues together.
  Constants originally stayed at 5s charge / 3s exposure / 10 HP; B40 subsequently doubled
  exposure to 6s. Deterministic Playwright now asserts
  duplicate rejection, either-order clears, beam persistence, fresh respawns, normal/homing
  immunity, and charged homing damage. typecheck + build + 9-test suite green. **Still needs
  Pixel 6 acceptance:** both kids should identify the needed color without explanation.

- **B37 — One-hit large splitters (2026-08-03):** replaced the grindy 2/3-hit
  rock representation with explicit **standard** (r=13, 10 points) and
  **splitter** (r=17, 20 points) kinds. Both pop in one rocket hit and never
  show a number. A splitter immediately scatters two standard-size children,
  giving a complete 40-point clear; children retain B30's preallocated-pool
  collider/update integration, leftward station-threatening scatter, brief
  railgun-safe spawn grace, and hard lifetime cap. The solver now charges a
  splitter as 3 required hits (initial split + two child pops), has only the
  standard→splitter final tier, and keeps the 0.30/0.45/0.60/0.75 targets
  unchanged for the first phone playtest (boot-log composition: 1/2/2/3
  splitters, all at ×0.85). Removed the 3-hit texture/radius and
  renamed fragment terminology to children. typecheck + build + all 9
  Playwright cases green; still needs Pixel 6 tuning feedback.

## Backlog archive (B1–B40)

`plans/backlog.md` was the work queue from 2026-06-06 until GitHub Issues replaced it, and it was
retired on 2026-11-03 (#5). Its four open items moved to issues: **B34 → #1**, **B38 → #2**,
**B7 → #3**, **B8 → #4**. The resolved write-ups below are kept verbatim as history. B-numbers
elsewhere in the docs and code refer to these entries.

- **B40 · Longer boss exposure — `done`** *(2026-08-04)*. Doubled the shields-down damage window
  from **3s to 6s** after phone playtesting indicated the original window would make the 10-HP,
  charged-railgun boss fight drag. The 5s escort charge race, 10 HP, and railgun timing are unchanged.
- **B39 · Shareable boss link — `done`** *(2026-08-04)*. The live boss shortcut is
  [https://michac.github.io/star-slingers/?boss](https://michac.github.io/star-slingers/?boss).
  It uses the existing `?boss` boot shortcut, so the normal game URL is unchanged; the link is now
  documented in the README for phone playtesting and review.
- **B33 · Co-op escort boss redesign — `done`** *(2026-08-03)*. Each of the four escorts now
  requires one cyan P1 rocket and one amber P2 rocket, in either order; duplicate-color rockets are
  spent but rejected. Directional ships face the station and carry matching color lock fins; breaking
  one leaves the other pulsing, so no reading is needed to tell whose shot is next. Partial locks
  survive a boss beam, and a full exposure-cycle respawn restores both locks. The exposed 10-HP boss
  takes **charged railguns only**; ordinary and ordinary-homing rockets do no damage. Homing remains
  charge-exclusive except during the exposed phase, when its lock preview and railgun arc both show so
  an assisted player can fire a charged homing boss shot. The locked visual reference is
  `prototype/reference/escort-coop-lock.html`. Playwright covers masks, duplicates, either order,
  beam persistence, respawn, and charged/homing boss damage; typecheck, build, and all 9 tests green.
- **B37 · One-hit large splitters — `done`** *(2026-08-03)*. Retired multi-hit rocks and the tiny
  fragment tier. There are now only explicit **standard** (r=13, one hit, 10 points) and **splitter**
  (r=17, one hit, 20 points) kinds; neither shows a number. A rocket hit on a splitter immediately
  creates two preallocated, standard-size children, so clearing it scores **40** total (20 + 10 + 10).
  Children retain the leftward scatter, station threat, railgun-safe spawn grace, and hard lifetime cap.
  The solver now prices a splitter at **3 required hits** and can generate only standards and splitters;
  the targets remain 0.30/0.45/0.60/0.75 for the first phone playtest. Removed the 3-hit radius/texture
  tier and renamed fragment terminology throughout the integration. Playwright covers immediate split,
  child size/count, full score, and solver kinds/cost. typecheck + build + 9-test suite green.
- **B36 · Fix the flaky Playwright tests — fixed-timestep harness — `done`** *(2026-07-10)*. The suite
  wasn't trustworthy: `off-axis homing` + `boss gate + cycle` failed ~2/3 on `--repeat-each=3`, and at
  `--repeat-each=5` the drift-window cases (`head-on`/`full-pop`/`charged`) flaked too (`charged` 5/5).
  **Root cause (spike-confirmed):** every case waited on a *game-time* event behind a *wall-clock*
  timeout while headless software-WebGL runs game-time ~10× slow — the "wait for a rock to drift into an
  x-window" scans and the `deltaMs` timers (homing `dist`, boss `chargeMs`/`exposedMs`) both outran their
  waits. **Fix (chosen with Michael): stop using the wall clock as the test clock.** New `stepGame()`
  parks the RAF loop (`loop.sleep()`) and advances a **fixed 16ms timestep** via `game.scene.update(t,dt)`
  — physics/overlaps/timers in lockstep, no render, no racing (the 30s boss window → ~20ms of stepping).
  Two spike corrections to the plan: `game.step()` *renders* (slow ReadPixels — use `scene.update`), and
  Phaser 3.90's TweenManager is **wall-clock** so the boss slide-in tween won't step → added a minimal
  DEV hook `Boss.snapEntered()`/`BossEncounter.snapBossIn()`/`__debug.snapBossIn()`. All 5 interaction
  cases now **field a stationary rock directly** (shared `fieldRock()`) + step to a bounded budget
  (`stepUntil()`); scope extended past the plan's 2 named cases to all 5 once the "leave them green" cases
  proved flaky at `--repeat-each=5` (**decided with Michael**). `full-pop` strengthened (asserts chip
  scores 0, pop scores >0); invuln check strengthened (shot actually crosses the boss). **Verified:**
  typecheck + build clean; `--repeat-each=5` **40/40 green** (8.9 min, was 16.5 with 11 timeouts);
  formerly-flaky pair `--repeat-each=10` **20/20**; no `.only`/`.skip`; `smoke-*.png` still emit; zero
  console errors gated. Game code touched only by the DEV `snapBossIn` hook; `playwright.config.ts`
  unchanged. `e2e/sandbox.spec.ts` + `Boss`/`BossEncounter`/`SandboxScene` (DEV hook) + CLAUDE.md test
  blurb + notes synced. (No `spec.md §` covers the test harness.) **Speed pass (Michael flagged 8 min):**
  profiling (not the stepping — 300 steps = 11ms) pinned four headless-swiftshader costs: (1)
  `page.screenshot()` ~7s each → made `smoke-*.png` **opt-in** (`SMOKE_SHOTS=1`); (2) CDP round-trips →
  `stepUntil()` loop moved **in-browser** (one round-trip/window), `charged` folded to one evaluate,
  `gotoGame` fixed-sleep → scene-ready `waitForFunction`; (3) **the live RAF loop** — a `page.evaluate`
  touching the scene mid-render stalls ~0.8s on the software frame (`rockets.fire` = 800ms wall / 0.5ms
  in-browser), so `gotoGame` now **parks the loop** right after boot (**boss 8s→1.7s**), which forced
  migrating **split** onto `stepGame` too; (4) context reuse (~150ms) and parallel workers (worse — one
  software-GL context serializes them) don't help, so config stays `workers: 1`. A runaway MCP Chrome
  (~987% CPU, prior session) had been inflating everything — Michael killed it. **`npm test` ~8min →
  ~15s (8 cases); `--repeat-each=5` 8.9min → ~1.1min, 40/40 green.**
- **B32 · Raise the difficulty floor to 0.30 — `done`** *(2026-07-10)*. The opening was a crawl: W1
  targeted `required` 0.05, but its shield-regen leak (0.10) exceeded that, so the solver pinned W1 to
  the literal floor (3 lanes @ `minSpeedScale` 0.5, ~20–28 px/s, ~3% break-even). **Pure target retune,
  no model change** (Michael's locked Option A, even ramp): `WAVES.required` 0.05/0.20/0.45/0.75 →
  **0.30/0.45/0.60/0.75**. At this floor the solver blows past the count + speed levers into toughness
  for every wave, so all four run **4 lanes @ ×0.85** and the ramp is pure toughness — dev boot log
  confirmed **W1** one 2-hit (be 17%) · **W2** three 2-hit (27%) · **W3** four 2-hit (34%) · **W4** 3-hit
  + three 2-hit (38%, unchanged). `minSpeedScale` now moot; `DIFFICULTY_MODEL`/lanes/regen/quotas
  untouched. Only `WAVES` in `src/waves.ts` changed (+ nearby comments). typecheck + build clean; verified
  against the boot log. The slow-lane gentle lever is gone from W1 (5yo cushion is homing now — soften
  toward ~0.25 if too steep next playtest, don't re-add slow lanes). spec §7 + notes synced. **Un-phone-tested.**
- **B35 · Railgun charge cue → the pull-back arc as a progress bar — `done`** *(2026-07-10)*. Retired
  B13's glow-disc-behind-the-rocket cue (`drawChargeCue` + the `CHARGE.glow*`/`rocketScale`/pulse-disc
  dials) and re-cued charge onto the half-circle **pull arc**. Two locked decisions (Michael): fill color
  = **violet accent** (`COLORS.charge` aliased onto the existing shield-mid / trail violet — no new hue),
  ease-off = **reset charge to 0** (a continuous full pull required). Charge now accrues only while the dot
  is held past **`CHARGE.pullThresholdFrac` 0.88** of the pull radius and resets the instant it eases below
  — a held-full-pull skill with a progress-bar read (`fullMs` 600 kept; may want lowering on the phone
  since pull-back time no longer counts). Arc: below threshold = the resting **dashed** player-color arc
  shows through; at/above, charge<1 = a **solid** player-color arc (new `drawSolidArc` helper — `drawDashedArc`'s
  arc-length walk with no gaps, covering base + partial fill) with a **violet** fill sweeping `start →
  start+charge·span`; charge==1 = full violet arc + an "armed" brightness breath (reused the `elapsed` sine).
  Homing seats stay dashed & never charge. New `tokens.ts` `COLORS.charge` + `STROKES.chargeArc`. typecheck +
  build clean; drove the gating in-app (partial→0, full→0.5@300ms→1.0@700ms, ease-off→0, homing→0) and
  screenshotted the violet fill. Charged-pierce Playwright case stays green (drives `rockets.fire` directly,
  bypassing the pull path). spec §5 + notes synced. **Un-phone-tested.**
- **B31 · Smoke → `@playwright/test` (runner only) — `done`** *(2026-06-15)*. Promoted the 250-line
  hand-rolled `smoke.mjs` into a real `@playwright/test` suite — the same move `../reflex-game` made.
  **Scope locked with Michael: runner only**, no `toHaveScreenshot` visual baselines (OS-AA-sensitive,
  flaky across Windows/Linux/CI; the game has few static frames); the `smoke-*.png` screenshots stay
  as eyeball aids. New `playwright.config.ts` (webServer auto-start on a dedicated **:5181**, Pixel-6
  touch viewport, swiftshader GL flags, `workers:1`, 90s per-test `timeout` for the ~10× slow headless
  game-time) + `e2e/sandbox.spec.ts` (1:1 port split into 8 named `test()` cases —
  boot-clean / hit / score / homing / pierce / split / boss-cycle / `?boss` — each old `…OK/FAIL` now
  an `expect()`, every case gating on zero console errors). Dropped the custom chromium resolver for
  **standard** resolution + `npx playwright install chromium` (no-op here; `chromium-1228` already
  cached, the exact build `^1.60` pins). Kept the split case's `reconfigure()`/`spawn()` direct-field
  trick + the headless-slow-gametime caveats. Deleted `smoke.mjs`; swapped `playwright-core`→
  `@playwright/test`, added `"test": "playwright test"`; `e2e/` excluded from `tsconfig` `include`;
  `.gitignore` gained Playwright's report/result dirs. **Proved it fails loudly** — temporarily
  emitting 1 fragment instead of 2 turned the split case red on a *value* assertion with a non-zero
  exit (the gap the old script left: semantic FAILs that still exited 0). typecheck + build + all 8
  cases green. CLAUDE.md / README / spec + this notes entry synced.
- **B30 · Asteroid split — `done`** *(2026-06-15)*. Classic-Asteroids juice: a **tough rock (2- or 3-hit) killed by a rocket**, on its **final pop only**, scatters **2 small 1-hit fragments** that funnel toward the station. Decisions locked with Michael: chipping a multi-hit rock doesn't split, 1-hit rocks never split, **only rocket-kills split** (a station-reached rock — a loss — never does); fragments **threaten the station** (can cost a shield ring — a self-balancing "winning tax" on the 9yo's tough-rock hunt) and **score** their own 1-hit pop (10 pts each, via the existing scoring path — no scoring code change). **Architecture (the crux):** the rocket→asteroid collider is built once over the fixed asteroid pool (wrappers never recreated), so fragments are **pre-allocated wrappers appended to that same `this.asteroids` array** before the collider line — inheriting the collider, update loop, station-contact, homing, and the wave-clear field-empty check for free. They differ from lane rocks in exactly two ways: `onWantRespawn` returns **false** (one-shot — park, never respawn off the right edge) and they're fielded **in-field with a leftward scatter velocity** (`spawnFragment`) rather than off the edge (so the existing funnel/contact/left-exit logic all engage). Two load-bearing guards: a **spawn grace** (body off ~100ms; `takeHit()` returns 0 then) stops an in-flight railgun's stale `hitSet` from chipping a just-spawned fragment, and a hard **lifetime cap** (~6s) guarantees the wave always clears (fragments count toward field-empty). No solver/difficulty change — `threatOf` deliberately doesn't model fragment threat (winning-only, trivial, regen-absorbed; cheap knobs are `SPLIT.fragmentSpeed`/`lifetimeMs`, not the wave targets). New `SPLIT` block + baked fragment texture (not in `RADIUS_BY_HITS`); `fragment`/`aliveMs`/`isFragment`/`spawnFragment` in `Asteroid` (`update()` now takes `delta`); `fragmentPool`/`splitCount`/`spawnFragments` in `WaveDirector`; split wired into both `handleHit` branches keyed on `pts > 0`. typecheck + build + smoke green (new split assertion: a directly-fielded 2-hit rock killed by rockets raises `splitCount`, ≥2 fragments go live, and popping them scores +≥20; the assertion fields the rock via the public `reconfigure()`/`spawn()` path because headless game-time runs ~10× slow — a Sonnet review confirmed that's a software-WebGL ReadPixels artifact, not a game bug). spec §4 + §7 + notes synced. **Un-phone-tested** — wants a Pixel 6 pass.
- **B13 · Charged shot → piercing railgun — `done`** *(2026-06-15)*. Reworked from the original "fully charged shot **counts as 2 hits**" to a **railgun**: hold the pull to power up, and a full charge fires a rocket that is **not stopped by anything** — it rails straight through every asteroid in its path until it leaves the screen. Decisions locked with Michael: **pierce depth unlimited**; tough rocks are **chipped once per rock** (one normal `takeHit()` each — 1-hit rocks pop, 2/3-hit rocks chip down; no instakill); **homing & charge mutually exclusive** (a homing seat can't charge); **charge cue = the nocked rocket glows/pulses** at the anchor as it fills, settling to a steady ready-pulse (local, orientation-neutral, no text); **boss/escorts unaffected** (charged shots are ordinary single hits there — pierce is asteroid-only, finale balance untouched); still **costs 1 ammo**. Shipped alongside a **tiered shot trail** — the locked bright trail becomes the **charged** look, normal shots get a **subdued** version (less alpha, shorter ribbon), so the in-flight trail doubles as the railgun read. New `CHARGE` block + `TRAIL.chargedMul`/`normalMul` in `src/layout.ts`; `SlingControl` accrues charge from pointer-down (`CHARGE.fullMs` the only flick-vs-charged dial) + draws the glow/scale cue; `SandboxScene.fireRocket` tags `charged` and `handleHit` pierces (per-rocket `hitSet` guards the multi-frame pass against double-chipping a survivor); `RocketPool` resets the flag/hitSet on fire+recycle and picks the trail tier per rocket. No postFX anywhere (charge glow + trail are filled Graphics). typecheck + build + smoke green (added a charged-pierce assertion: the charged rocket is still `active` when it chips a rock — proof it railed through rather than recycled); spec §4/§5 + notes synced.
- **B6 · Scoring & numbers — `done`** *(2026-06-15, batched with the B7 wave-clear visual)*. The shared, live-only **score** — climbs on both HUDs as the team pops rocks. Points **toughness-weighted**: `spec.hits × 10` (1-hit=10/2-hit=20/3-hit=30), **only the final pop scores** (chipping earns nothing), and a station-reached rock scores nothing (loss, not kill) — scoring is driven purely from the rocket-hit path (`Asteroid.takeHit()` now **returns** the points; `consume()` untouched). A small accent **`+N`** pops at each kill site and **grows-and-fades in place** (orientation-neutral — a directional rise would read upside-down for the top seat; the HUD number is the canonical read). No persistence — `scene.restart()` rebuilds from constants → score resets to 0. **Boss stays unscored** (its gauges carry the climax). New `objects/Score.ts` (`ScoreKeeper`, holds the total + mirrors both HUDs + spawns the popup); `PlayerHud` gained the reserved **SCORE row** (`row('SCORE', HUD_ROWS.score, CSS.accent)` + `setScore`); new `SCORE` block in `src/layout.ts`. `__debug.score()` added; smoke asserts score is **0 at boot** and **>0 after a pop**. typecheck + build + smoke green; spec §3/§5 + notes synced.
- **B7 (visual half) · Wave-clear star-shower — `done`** *(2026-06-15)*. Beating a wave throws a celebratory **confetti shower** — sparkles in the two player colors + accent seeded across the field's top, fanning **downward** and raining over the whole playfield. Fires on **every** wave clear (top of `WaveDirector.onWaveCleared`, after `restoreShield()` — so the wave-4→boss hand-off celebrates too). Built on **one persistent shared ADD-blend emitter** (created once in `Explosions.ts`, never per-event — same discipline as the asteroid burst), `starShower()` emits a batch at a spread of X positions; fired via a `celebrate()` callback threaded `SandboxScene → WaveDirector` (exact template of the existing `boom` callback). New `STAR_SHOWER` block in `src/layout.ts`; tints from `tokens.ts`. typecheck + build + smoke green (screenshots confirm the shower); spec §4 + notes synced. **Audio + haptics remain in B7.**
- **B22 + B23 · Shield glow + brightness pulse — `done`** *(2026-06-15, polish pass)*. Shipped together as the shield half of the visual cleanup pass — prototyped + locked on the shelf first (`prototype/reference/shield-pulse.ts`), then ported in one pass per `plans/polish-pass.md`. Rings moved into a dedicated **per-frame layer** that **breathes** (each ring's **color brightness** pulses on a slow sine, trough 0.6→crest 1.0, ~3.2s/breath) and **flows** outer→inner (a per-ring phase offset), under an ambient **glow** (`postFX.addGlow`) that hugs + recolors to the outermost remaining ring and breathes with it; a destroyed ring **flares its glow then expands + fades** (replaces the old scale-up shatter). Two locked constraints honored: **pulse color brightness, never alpha** (a thick semi-transparent ring shows radial "grid" spokes at its tessellation joins) and **perf first** (no DPI render; glow `quality` 0.3 — sharper lagged the Pixel 6). `Station.ts` split into `glowDisc → hull → rings` graphics; new `SHIELD_FX` tuning block in `src/layout.ts`; postFX guarded with `?.` so headless software-WebGL can't crash. typecheck + build + smoke green; spec §4 + notes synced. (B24 gradient fills stay deferred.)
- **B29 · Better explosion / break effect — `done`** *(2026-06-15, polish pass)*. Locked prototype `prototype/reference/explosion-lab.ts` ported into `Asteroid.pop()`, replacing the flat 160ms scale-up+fade with a composed **flash** (white core under a transient magenta glow) + **shockwave** ring + **debris** (rock shards, gravity, spin) + additive **sparks**, while the rock snaps bigger and vanishes (110ms). Built on **one shared pair of particle emitters** (never new emitters per pop) + one transient glow, glow `quality` 0.3 — new `Explosions.ts` owns it, fired via a `boom(x,y,r)` callback threaded `SandboxScene → WaveDirector → Asteroid` (new ctor params). Baked `TEX.spark` + `TEX.shard` in `textures.ts`; new `EXPLOSION` block in `src/layout.ts` (reference authored at 2.5× review-zoom → particle speed/scale/gravity ÷2.5, flash/shockwave size off the real radius). Asteroids only — boss/escort pops keep their current effect (possible follow-up). `pop()` flow preserved (`popping`/`active`/`respawnOrPark`, so smoke stays green). typecheck + build + smoke green; spec §4 + notes synced.
- **Shot trail — `done`** *(2026-06-15, polish pass)*. New polish item (rel. B7 juice). Locked prototype `prototype/reference/shot-trail.ts` ported into `RocketPool`: per-rocket flight **history** (~75 pts, seeded in `fire()`, cleared in `recycle()`, stored via `setData`), drawn each frame into **one shared additive Graphics** by a new `RocketPool.update(delta)` (called beside `steer()` in `SandboxScene.update`) — a long faint **afterimage** light-streak under a short tapered **exhaust** ribbon (glow halo → violet body → white-hot core) with a brightness **flux** scrolling down it. Head stays player-colored; exhaust is violet (`COLORS.shieldMid`). All filled additive quads — no postFX, no particles. `WRAP_SKIP` guard ported so a homing re-aim / recycle teleport never streaks. New `TRAIL` block in `src/layout.ts`. typecheck + build + smoke green (screenshots confirm the trail); spec §4 + notes synced.
- **B5 · Final boss — `done`** *(2026-06-09)*. The run's finale, replacing the wave-4 placeholder victory card. A boss **slides in from the side and parks at center** (fully on screen, stationary while battling), guarded by **4 escorts that slowly orbit it**. **Two-phase fight** (Michael's design + this session's calls): **Phase 1** — boss **invulnerable** (wears its own cyan shield ring) and runs a **charge cycle**; a completed charge shatters a shield ring (reuses `Station` + regen); **destroying an escort interrupts/resets the charge** (the defensive payoff) and chips the 4-gate. **Phase 2** (all escorts dead) — boss turns **vulnerable** (shield ring drops, full color, a **big mirrored HP number** appears, ~10 HP), charge runs uninterrupted → combined-fire race vs the draining shield. Escorts are **pure gating targets**; **no asteroids** during the boss; win → "You did it!", loss → "Try again?" (reused `Overlay`s). **One charge mechanism** whose `chargeMs` dial slides the feel from a dramatic charged blast to a ticking beam — the unification of Michael's "charged shot vs beam" uncertainty. New `Boss.ts` / `Escort.ts` / `BossEncounter.ts` (boss+escort sprites created once, parked — second rocket-overlap collider built once over them, same discipline as the asteroid wrappers); `WaveDirector` hands off via an injected `onRunCleared` callback (its old `victory` state → `done`); homing (B14) extended via a shared `HomingTarget` interface so it locks escorts (P1) then the boss (P2). Balance dials in `BOSS` (`src/waves.ts`: hp 10 / escortHits 2 / chargeMs 6000 / shieldRegenMs 14000), geometry in `BOSS_LAYOUT` (`src/layout.ts`). typecheck + build + smoke green (added a boss assertion: invulnerable HP holds in Phase 1, drops in Phase 2). spec §3 + §9 + this entry + notes synced.
  - **Reworked to a cycling fight (2026-06-09, post-playtest)**: the flat "clear escorts once → vulnerable forever" became a repeating loop — **charging** (escorts up, boss shielded, a **charge bar** racing you) → clear all 4 in time → **exposed window** to shoot the boss → escorts respawn, re-shield, repeat; if the charge fills first the boss **fires** (−1 ring) with **no** window that round. Also: **slower entrance** (`enterMs` 1100→1900), **escorts now read as shield-then-core** (cyan ring → bare core; first hit shatters the ring) so the 2-hit is obvious, and a visible filling **charge arc** for urgency. New dial `exposedMs` (3000) + retuned `chargeMs` (5000) in `BOSS`. `Boss` vulnerability is per-window (`expose()`/`shield()`); `BossEncounter` is a `charging↔exposed` machine. Smoke extended (gate + the respawn cycle: 4/4 escorts come back). Still tuning on the phone (`chargeMs`/`exposedMs`/`hp`).
  - **UI: two off-boss gauges (2026-06-10, post-playtest)**: the two big mirrored HP numbers overlapped the boss and the on-boss charge arc was lost in that clutter. Replaced both with **two vertical bars in the band to the boss's right** — a green **health** bar + a magenta **charge** bar, filling **bottom-up**, each capped **top and bottom** with its icon (heart / bolt, top copy rotated for the seat — no reading). New `objects/BossBars.ts` (Graphics + 4 icon Images) owned by `BossEncounter`, fed `{hp, maxHp, chargeFrac, visible}` per frame (charge derived from the live `timer`). `Boss` shed `hpTexts`, `chargeFrac`/`setChargeFraction`, and the on-boss charge **glow + arc** (only the plain shield ring stays). New `COLORS.health`, `BOSS_LAYOUT.bars` (replaced `hpOffsetY`), `TEX.heart`/`TEX.bolt`. typecheck + smoke green; screenshots confirm the read. Still un-phone-tested.
- **B14 · Homing mode toggle — `done`** *(2026-06-09)*. The 5yo fairness lever (B8's primary). A per-player **visible switch** beside each sling (`HomingToggle.ts`, mirrored + rotated 180° for the top seat; no text — color/knob/brightness only), **off by default, opt-in, independent per seat**, persisted in the scene **registry** so a "Try again" never silently disables it. With homing on, `SandboxScene.pickHomingTarget` locks the asteroid with the **smallest perpendicular distance to the launch ray** within a forward cone+range; `RocketPool.steer` then rotates the shot's velocity toward that locked target each frame at a **capped turn-rate** (`HOMING.turnRateDeg`) — a *gentle assist* (Michael's pick: fast/badly-aimed targets can still escape, not a magnet), re-acquiring if the target dies and flying straight if none. During the aim drag `SlingControl` **rings the locked target** so the kid sees what he'll hit. Tuning + toggle geometry in a new `HOMING` block in `src/layout.ts` (beside `SLING`); `turnRateDeg` is the strength dial. typecheck + build + smoke green (added an **off-axis homing assertion** to `smoke.mjs` proving the curve connects; also fixed two pre-existing smoke-harness rots: Playwright's `chrome-win`→`chrome-win64` path and a `SMOKE_URL` override). B13 (charged shot, unbuilt) stays mutually exclusive by design. spec §5/§6 + this entry + notes synced.
- **B12 · Full screen on the phone (shipped as PWA) — `done`** *(2026-06-09)*. Reframed from "fullscreen" to **installable PWA** — the install path is the chrome-free path on *both* Android Chrome and iOS Safari (one mechanism, since it-being-a-webpage is the point). Shipped: hand-rolled `public/sw.js` (~45 lines, no `vite-plugin-pwa` — keeps the deliberate relative `base: './'` and single-bundle property), `public/manifest.webmanifest` (`display:fullscreen`, portrait), self-hosted Audiowide woff2 (removed the last Google-Fonts cross-origin dep), neon app icons (192/512/maskable-512/apple-touch-180) generated by a manual `make-icons.mjs` Playwright rasterizer, and iOS/install `<meta>` + `<link>` head tags. SW: install-precache stable assets, network-first navigations, cache-first hashed assets, versioned cache cleanup. **The auto-`requestFullscreen()`-on-first-touch sketch was deliberately dropped** — Android-only (iPhone has no Fullscreen API), jarring on desktop, and installing already gives chrome-free. **Platform ceiling (expected):** Android installed = true fullscreen; iOS installed = standalone with a dark status bar blended into the bg. typecheck + build + smoke green; offline boot + SW activation verified headlessly against the preview build. spec "Install & offline" subsection + notes synced.
- **B21 · Neon palette ported into the game — `done`** *(2026-06-07, chat)*. Palette-first port of the B9/B10 neon skin from the mock into the live game: rewrote `src/tokens.ts` to the `tokens-neon.css` values (deep-purple bg, cyan P1 / amber P2 / magenta enemies, Audiowide) plus the fills the wireframe lacked — rock interior, hull fill, and **per-ring shield colors mapped to the cyan→purple→magenta gradient stops** (`Station.ts`). Repainted `textures.ts`, `Station.ts`, the scene's stars, and the `Overlay` card border; Audiowide is loaded before Phaser boots (`index.html` + `main.ts`) so text never flashes the fallback. Glow/bloom, shield pulse, and gradient fills deliberately deferred → **B22/B23/B24**. typecheck + build + smoke green. spec §4 + notes synced. *(Numbering note: the skin item was briefly mislabeled B20, which collided with the resolved difficulty-dials B20 — renumbered to B21.)*
- **B9 · Pick the style winner — `done`** *(2026-06-07, chat)*. **Neon Arcade wins** over Asteroids vector (synthwave palette: deep purple-black space, hot-cyan P1 / amber-orange P2 / magenta enemies, fat glow, Audiowide). Its `tokens-neon.css` becomes the game palette. Vector/wireframe skins retired as losers (left on v3 geometry; not re-cut). Code port tracked as B21.
- **B10 · Re-cut style mocks against v5 — `done`** *(2026-06-07, chat)*. Re-cut the winning **neon** skin onto v5 geometry: `mockups/style-neon.html` now uses the canonical v5 slots (tiny off-screen edge hull r=24, 3 concentric shield rings, funneling rotated ships, v5 annotations) with the neon defs/paint grafted on. Losers (vector/wireframe) intentionally left on v3 — no re-cut needed. `index.html` hint updated.
- **B19 · Difficulty re-tune (too easy + "wave 2 twice") — `done`** *(2026-06-07, chat bug report)*. The 0.05/0.14/0.30/0.50 targets were solo-clearable throughout (W4 only ~57% solo accuracy; W1's regen leak 0.10 exceeded its required 0.05 — shield self-healed faster than damage), and W1≈W2 (both all-1-hit) read as a repeated wave. Wave-counter code verified correct — no off-by-one, the "twice" was the near-identical fields. Re-tuned to Michael's "noticeably harder, still soloable": targets **0.05 / 0.20 / 0.45 / 0.75** → **W1** 3×0.50 all-1-hit · **W2** 4×0.66 all-1-hit (now clearly ≠ W1) · **W3** 4×0.85 two 2-hit · **W4** 4×0.85 one 3-hit + three 2-hit. Solo break-even 5/20/46/76%. Quotas + shield-regen unchanged. spec §7 + notes synced.
- **B20 · Difficulty dials → `src/waves.ts` — `done`** *(2026-06-07, chat)*. Michael's "separate level parameters file" instinct. Moved `WAVES`/`WaveConfig`/`DIFFICULTY_MODEL`/`LANE_SLOTS`/`RADIUS_BY_HITS`/`AsteroidSpec`/`BREATHER` + the budget/solver math out of `layout.ts` into a dedicated `src/waves.ts` (the one file to tune the run); `layout.ts` keeps geometry/paint + `AMMO_REGEN_MS`. Imports updated across 5 files; typecheck + build green. Pure move, no behavior change.
- **B17 · Algorithmic difficulty solver — `done`** *(2026-06-07, Playtest 3)*. The budget scalar is now the INPUT: a wave is a target `required` hits/s, and `solveWave` (`src/layout.ts`) realizes it by moving knobs in priority order — **count** (from a floor of 3 lanes) → **speed** → **toughness** (2- then 3-hit; size follows toughness) — until threat hits the target. The priority order is the kid-friendly tiebreaker among the combos that hit the same number, so low waves are *many weak slow* rocks; 3-hit rocks emerge only at high targets, not hand-placed. `DIFFICULTY`/`LANES`/per-wave knob rows replaced by `LANE_SLOTS` + `RADIUS_BY_HITS` + `DIFFICULTY_MODEL` + `WAVES:{required,quota,shieldRegenMs}`. Dev log prints target-vs-achieved + tier. Current targets 0.05/0.14/0.30/0.50 → W1 3 weak slow, W2 +lane, W3 fast +a 2-hit, W4 several 2-hit. smoke.mjs rewritten to a toughness-agnostic hit-counter assertion (the old `hits===3` finder is gone).
- **B18 · Wave banner overlap fix — `done`** *(2026-06-07, Playtest 3)*. `BANNER.numeralOffsetY` 28→94: the two mirrored copies now land in each player's half (no center overlap), verified by screenshot.
- **B3 · Waves — `done`** *(2026-06-07; decisions reviewed 2026-06-06)*. A run = 4 escalating waves via a `WAVES: WaveConfig[]` table in `src/layout.ts` (replaces the single `DIFFICULTY`; ammo regen stays global). **Finite quota per wave** — respawns stop when spent, wave clears when the field empties; station-consumed asteroids count as spent. **Breather**: shield restores ring-by-ring (regrow cue) + mirrored next-wave numeral banner (~2.2s). **WAVE row on both HUDs** (AmmoHud → PlayerHud at the mock group origins; SCORE row reserved for B6). **Victory card after wave 4** ("You did it!" star burst, tap-anywhere play-again; FailOverlay generalized into config-driven `Overlay`) — the seam B5's boss replaces. Tuned to the gentle curve: required hits/s **0.28 / 0.37 / 0.46 / 0.55** (lanes 3/4/4/4, speed ×0.55/×0.55/×0.62/×0.68, quotas 8/10/12/14). Asteroid wrappers are **mutated in place between waves, never recreated** — the rocket↔asteroid collider is built once over their sprites and would silently die otherwise. Wave 1 starts live with no banner (smoke timing). DEV-only `__debug` hook for headless wave tests; smoke.mjs gained an on-screen wait (its head-on shot was latently flaky since B15's wider spawn stagger).
- **B15 · Difficulty budget model + knobs + easier tune + shield regen — `done`** *(2026-06-06, from Playtest 2)*. One `DIFFICULTY` block in `src/layout.ts` (count / speedScale / hitsScale / spawnGapMax / ammoRegenMs / shieldRegenMs) tuned against the **budget scalar**: `required team hits/s = Σ lane hits·speed/travel − regen leak` (precedent: MMO DPS checks, TD throughput balancing, Schreiber & Romero). Shield regen: outermost missing ring regrows after 10s unhit (reverse-shatter cue) = the leak allowance. Shipped tune: 3 lanes, ×0.55 speed, gap 320, ammo 1s → **0.28 required hits/s** (Michael's wave-1-easy target ≈0.3; was 0.92). Dev boot log prints the scalar; budget functions live beside DIFFICULTY. B3 waves = per-wave tables escalating this number.
- **B16 · Modal Try-again card — `done`** *(2026-06-06, from Playtest 2)*. Opaque rounded-rect card behind the replay icon/text; field clutter can't show through (verified headlessly with an asteroid parked dead-center). Field keeps the soft dim around the card; tap-anywhere restart unchanged.
- **B1 · Station + shield — `done`** *(2026-06-06, batched with B2)*. Built into the sandbox: hull sliver at (−10,370) + windows, **shield = 3 concentric rings (r=46/39/32), all visible = 3 HP**, outermost shatters first (+ worried local shake; not camera shake). Rings-not-segments decided by Michael: segments imply a positional weak spot the player can't control (luck); shrinking layers are the clearest non-positional read. Contact radius shrinks with the outermost remaining ring (honest visuals). Fail = calm dim + central circular-arrow replay icon (reads either way up, text decorative only), **tap anywhere** → `scene.restart()`. Spec §4 + v5 mock re-cut to rings.
- **B2 · Funnel approach movement — `done`** *(2026-06-06, batched with B1)*. Two-phase: lane drift until x≤150 (`APPROACH_X` in `src/layout.ts`), then a one-time velocity redirect at the station. Knowingly a straight-line kink, not a curve — per-frame `Angle.RotateTo` steering is the queued tuning upgrade if it reads badly on the phone. Enemies reaching the station are consumed by the hit.
- **Lanes question** (each player guards a half vs. shared wall) — superseded by the v5 funnel decision: the whole field is shared and the funnel concentrates final defense where both players can reach. *(2026-06-06)*
- **Central-core layout (v4)** — explored and rejected: a centered objective sits in everyone's firing lines and blocks cover fire. Mock kept in `mockups/shelved/`. *(2026-06-06)*
