# Star Slingers — History & Playtests

> Status: **4-wave run + difficulty solver (B3/B17/B18) + PWA (B12) + homing toggle (B14) + final boss (B5, 2026-06-09); next: scoring (B6), sound/juice (B7), or boss tuning playtest**
> Doc roles since the 2026-06-06 re-sync: [`spec.md`](spec.md) = current reviewed truth · [`backlog.md`](backlog.md) = work queue · **this file = history** (playtests, explorations, how we got here).

## Prototype (2026-06-05)

First playable slice lives in [`/star-slingers`](../../star-slingers/) — Phaser 3 + TS + Vite
per `../tech-stack.md`, **sling-feel sandbox scope**: nail the touch input before any game
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

## Open questions
All moved to [`backlog.md`](backlog.md) (2026-06-06): **lanes** → resolved by the v5 funnel
(shared field); **shield rendering** (chunky segments vs smooth arc) → folded into B1 and
resolved there (concentric rings); **working title** → B11.

## Style exploration (2026-06-05)
Five style variants were generated under the mock conventions (see `../tech-stack.md`).
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
