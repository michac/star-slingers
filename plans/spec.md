# Star Slingers — Design Spec
*(working title — placeholder, swap freely; see backlog B11)*

> Non-technical design spec. Status: **building** (sandbox playable with station, shield, funnel approach, and fail/retry loop; waves next).
> This file holds **current truth only** — decisions that were worked out and reviewed.
> The work queue (including unreviewed draft systems) is [`backlog.md`](backlog.md); history and playtests live in [`notes.md`](notes.md).

## 1. Pitch
Two players sit facing each other across a phone held in portrait, one at the top edge and one at the bottom. Each works a slingshot, firing rockets across the field at asteroids and enemy ships that sweep in from the right and funnel toward the space station — which sits mostly off the left edge of the screen, just a sliver of hull and glowing shield poking into view. You defend it together: win together or lose together.

## 2. Players & setup
- **2 players**, shared-screen co-op (designed for a parent + the 5-year-old; playtest 1 says the 9-year-old enjoys it too).
- **Device:** Pixel 6, held or propped in **portrait**, players **facing each other** — one at the top short edge, one at the bottom. Each player owns their own end.
- Simultaneous multitouch (one finger each) is confirmed fine on the device.
- **No reading required** — everything is shapes, motion, and a few numbers.

## 3. The goal
Keep the station alive. One shared station, one shared score — there's no competing, ever.

**The run (decided 2026-06-06, built):** 4 escalating waves. Each wave fields a **finite quota** of asteroids — respawns stop when it's spent, and the wave clears when the field empties ("we beat them all!"; asteroids that reach the station also count as spent, so a wave always ends). Between waves: a short **breather** — the shield restores to full, ring by ring, a big mirrored numeral announces the next wave, and a celebratory **star-shower** rains across the field (§4). After wave 4: the **final boss** (§9) — the climax the run builds toward (it replaced the earlier placeholder victory card).

**Score (B6, built 2026-06-15):** one shared, live-only number that climbs as the team pops rocks — shown on both HUDs' SCORE row. Points are **toughness-weighted**: a popped rock scores `hits × 10` (1-hit = 10, 2-hit = 20, 3-hit = 30), so the tough rocks the 9-year-old hunts pay out more. **Only the final pop scores** — chipping a multi-hit rock earns nothing, and a rock that **reaches the station scores nothing** (it's a loss, not a kill). A small accent-colored **`+N`** pops at each kill site and grows-and-fades in place (orientation-neutral so it reads the same from both seats; the HUD number is the canonical read). No persistent "best" across restarts — `scene.restart()` resets the score to 0. The **boss fight stays unscored** for now (its health/charge gauges carry the climax; a number on top would clutter it).

## 4. Field & layout — v5 (decided 2026-06-06)
- Logical field **360×740** (≈ Pixel 6 portrait).
- **Station, mostly off-screen left:** core-sized hull (r=24) centered at (−10,370), so only a sliver pokes in, with a concentric shield bulging into the field. Max intrusion ~36px — v3's station+shield reached x=120, so v5 refunds nearly a quarter of the screen width to the playfield.
- **Shield = 3 concentric rings (r=46/39/32), all visible — 3 hits** *(decided 2026-06-06, supersedes the earlier 3-segments-along-the-arc)*. Any enemy that reaches the station shatters the **outermost remaining ring** (+ a worried shake); where it hit never matters. Rings-not-segments because segments imply a positional weak spot the player can't control — pure luck; shrinking rings give the clearest kid-read: "shield getting smaller, danger closer." Honest contact too: enemies penetrate as deep as the outermost remaining ring, so a weakened shield visibly lets them closer.
- **Shield regenerates** *(Playtest 2, 2026-06-06)*: after a quiet stretch with no hits (~10s, a difficulty knob), the outermost missing ring settles back in (reverse-shatter cue). This is the difficulty budget's *leak allowance* — the team may miss one hit per regen interval forever.
- **When the shield is gone and one more enemy reaches the hull:** gentle fail — calm dim plus an **opaque modal card** (field clutter never shows through it; Playtest 2), one big circular-arrow replay icon (reads either way up; "Try again?" text is decoration, never load-bearing), tap **anywhere** to restart.
- **Enemies enter from the right, sweep left, and *funnel* toward the station** on final approach — ships' noses and shots aim at it, lanes turn toward it near the wall (currently a single straight-line redirect at the approach threshold; smooth steering is a tuning upgrade if the kink reads badly). Anything that reaches the station is consumed by the hit.
- **Why the funnel:** it keeps the whole field shared, so either player can cover for the other anywhere — and the kid-legible read is "everything is heading for the glowy thing." (The v4 central-core layout was rejected exactly because a centered objective blocked cover fire; see notes.md layout history.)
- **Canonical layout mock:** [`mockups/layout-edge-wireframe.html`](mockups/layout-edge-wireframe.html) (wireframe reference).
- **Visual style — Neon Arcade** *(decided 2026-06-07, B9)*: synthwave palette — deep purple-black space, hot-cyan P1 / amber-orange P2 / magenta enemies, Audiowide font. Palette lives in [`mockups/tokens-neon.css`](mockups/tokens-neon.css); the canonical neon mock [`mockups/style-neon.html`](mockups/style-neon.html) is cut against v5 geometry (B10). The palette is **live in the game** (B21): `src/tokens.ts` holds the neon values, the 3 shield rings take the cyan→purple→magenta gradient stops, and Audiowide loads before Phaser boots. Only the mock's **gradient fills (B24)** stay deferred (solids read fine); glow/bloom, the shield pulse, and the burst/trail juice all shipped in the polish pass below.
- **Shield look — glow + pulse + flow** *(B22 + B23, polish pass 2026-06-15; prototyped + locked first, see `plans/polish-pass.md`)*: the rings live in their own per-frame layer that **breathes** — each ring's **color brightness** pulses on a slow sine (trough 0.6 → crest 1.0, ~3.2s/breath) and the crest **flows** outer→inner (a per-ring phase offset), reading as energy shields rather than a solid object. An ambient **glow** bloom hugs and recolors to the outermost remaining ring and breathes with it. A shattered ring **flares its glow bright then expands + fades**. Two locked constraints: pulse **color brightness, never alpha** (a thick semi-transparent ring shows radial "grid" spokes at its tessellation joins), and **perf first** (no DPI render; glow `quality` 0.3 — sharper lagged the Pixel 6). Tuning in `SHIELD_FX` (`src/layout.ts`); built in `Station.ts`.
- **Asteroid break — composed burst** *(B29, polish pass 2026-06-15)*: a popped asteroid replaces the old flat scale-up+fade with a **flash** (white core under a transient magenta glow), a **shockwave** ring, **debris** (rock shards flung out, spinning + falling), and additive **sparks**, while the rock itself snaps bigger and vanishes. Built on **one shared pair of particle emitters** (never new emitters per pop) + one transient glow; `Explosions.ts` owns it, fired via a `boom(x,y,r)` callback threaded through the `WaveDirector` into each `Asteroid.pop()`. Tuning in `EXPLOSION` (`src/layout.ts`). *(Asteroids only; boss/escort pops keep their current effect for now.)*
- **Asteroid split** *(B30, built 2026-06-15)*: when a **tough rock (2- or 3-hit) is destroyed by a rocket, on its final pop only**, it scatters **2 small 1-hit fragments** (Classic-Asteroids juice). Chipping a multi-hit rock does **not** split; 1-hit rocks never split; **only rocket-kills split** — a rock that reaches the station (a loss) never does. Fragments **threaten the station**: they funnel in like mini-asteroids and can cost a shield ring (a self-balancing "winning tax" on the 9yo's habit of hunting the big toughness-weighted rocks). Fragments **score their own 1-hit pop** (10 pts each — a fragment *is* a 1-hit rock, so this falls out of the existing scoring path with no new scoring code). Implementation: fragments are **pre-allocated wrapper instances appended to the fixed asteroid pool** (the rocket→asteroid collider is built once over that pool and the wrappers are never recreated), so they get the collider, the per-frame update, station-contact, homing, and the wave-clear field-empty check for free. They differ from lane rocks in exactly two ways — their respawn request returns **false** (one-shot: pop/exit/expire just parks them) and they're fielded **in-field with a scatter velocity** (`spawnFragment`) rather than off the right edge. A brief **spawn grace** (body off ~100ms) stops an in-flight railgun from chipping a just-spawned fragment, and a hard **lifetime cap** (~6s) guarantees the wave can always clear even if a fragment never reaches an edge or the station. Tuning in `SPLIT` (`src/layout.ts`).
- **Wave-clear star-shower** *(B7 visual, built 2026-06-15)*: beating a wave throws a celebratory **confetti shower** — sparkles in the two player colors + accent (`COLORS.p1/p2/accent`) seeded across the field's top and raining down over the whole playfield. Fires on **every** wave clear (including the wave-4→boss hand-off, since both branches flow through the breather). Built on **one persistent shared emitter** (created once in `Explosions.ts`, never per-event — same discipline as the asteroid burst), fired via a `celebrate()` callback threaded `SandboxScene → WaveDirector → starShower()`. Tuning in `STAR_SHOWER` (`src/layout.ts`); tints sourced from `tokens.ts`. *(Audio + haptics for wave clear stay queued in B7 — this repo has no audio-asset pipeline.)*
- **Shot trail — violet exhaust + afterimage, tiered by charge** *(polish pass 2026-06-15; tiered for B13)*: each player's rocket leaves a trail drawn into one shared additive Graphics — a long faint **afterimage** light-streak over the shot's ~75-pt flight history, under a short tapered **exhaust** ribbon (glow halo → violet body → white-hot core) with a brightness **flux** scrolling down it. The head stays the player's color; the exhaust is violet (`COLORS.shieldMid`) for contrast. All filled additive quads — no postFX, no particles. **Two tiers (B13):** the full bright look is the **charged** (railgun) trail; a normal uncharged shot gets a **subdued** version (less alpha, shorter ribbon), so the in-flight trail itself reads as "this was a railgun." Tuning in `TRAIL` (`src/layout.ts`, with `chargedMul`/`normalMul` multiplier sets); built in `Rocket.ts` (`RocketPool.update`).

## 5. Controls (implemented & playtested)
- **Abstract sling per player** — an **anchor dot** where the finger starts plus a **pull-range arc** showing draw distance and angles (not a literal slingshot).
- Press the anchor, **drag back toward your own edge** — stretched band + dotted trajectory preview — **release to fire**. Pull distance sets power; tiny pulls cancel.
- Both players aim and fire **simultaneously**, one finger each; big, forgiving touch zones.
- **Ammo** is a small number beside each sling and regenerates every second. P1's readout is rotated 180° so it reads right-side-up from the top edge.
- **Per-player HUD** shows WAVE, SCORE (the shared score, built in B6 — §3), and AMMO; P1's whole HUD column is rotated 180°.
- **Homing toggle (B14, the 5yo fairness lever — decided/built 2026-06-09):** a small visible on/off switch in the player's color, next to each sling (to that player's right; P1's is mirrored + rotated 180° to read from the top seat). No text — it reads by color, knob position, and brightness. **Off by default, opt-in, independent per seat** (the parent quietly flips it on for the 5yo while the 9yo keeps the honest lead-the-target challenge). **The skill is earning the lock, not the flight:** with homing on, the aim drag **rings the asteroid closest to the launch path** *only if you're aimed fairly precisely at it* (a tight cone + a close pass to the rock's center), so the kid still has to point at a target. **If a shot locks a target it connects** — it flies straight for a beat (an obvious "smart rocket" reveal), then curves hard onto the locked rock and hits. **No lock → ordinary straight shot** (no auto-aim), and if the locked rock is destroyed mid-flight the shot just flies straight (it never re-targets a different rock). The setting **persists across a "Try again" restart** (stored in the game registry) so a loss never silently disables it. *(Mutually exclusive with the charged shot below — a homing seat can't charge.)*
- **Charged shot → piercing railgun (B13, built 2026-06-15):** **hold the pull to power up**, and a full charge fires a **railgun** — a rocket that is *not stopped by anything* and rails straight through **every** asteroid in its path until it flies off-screen. It **chips each rock once** (one normal hit per rock — 1-hit rocks pop, tough rocks chip down; it never instakills), and still **costs only 1 ammo**. **Charge accrues from pointer-down**, so a quick flick never charges (preserving the flick feel) — `CHARGE.fullMs` in `src/layout.ts` is the one dial separating flick from charged. **Charge cue:** the **nocked rocket glows + grows** at the anchor as the charge fills, then settles into a steady brightness/scale **pulse** when ready (local to the sling, orientation-neutral, no text; code-drawn, no postFX). **Mutually exclusive with homing** — a homing seat fires its homing shot and can't charge (homing already owns the aim preview). **Boss/escorts are unaffected** — a charged shot is an ordinary single hit against the boss/escorts, so the finale's balance is untouched; pierce is an **asteroid-only** behavior.

## 6. Co-op dynamic (principles)
- Two slings, **one shared station, one shared score**.
- **The whole field is shared.** Each player naturally tends their near half, but either can fire anywhere — so the parent quietly cleans up what the 5-year-old misses. Layout decisions must protect this (it's what killed v4).
- **Leading a moving target is the core skill** — satisfying for an adult, hard at 5. The **homing toggle (B14, §5)** is the shipped fairness lever for the 5yo: per-player and opt-in, so it eases his aim without touching the 9yo's challenge. Further backups (a slower lane, telegraphed shots) stay queued as backlog B8.

## 7. Difficulty (the budget model — Playtest 2/3, 2026-06-06/07)

Difficulty is tuned against **one scalar**, not five raw variables:

> **required team hits/s = threat − leak**, where
> threat = Σ over live lanes of `hits × speed ÷ travel distance` (accurate hits/s the field demands, sustained), and
> leak = `1 ÷ shield-regen interval` (the miss rate the regenerating shield forgives forever).

Precedent: MMO DPS-checks/enrage timers, tower-defense threat-vs-defense throughput, Schreiber & Romero's *Game Balance*.

**The scalar is the input, not a knob (Playtest 3, 2026-06-07).** A wave is defined by its **target** `required` hits/s; a **solver** (`solveWave` in `src/waves.ts` — the one file that holds all the difficulty dials) realizes it by moving knobs in a fixed **priority order until threat hits the target**:

1. **Count** — fill lanes from a floor of **3** (the always-on "minimum asteroid rate": lots of weak targets) toward 4.
2. **Speed** — raise the speed scale.
3. **Toughness** — introduce 2-hit then 3-hit rocks (size follows toughness; the most frustrating lever for the 5yo, so it's last and only appears at high targets).

Among the many knob combos that hit any given number, the priority order is the **kid-friendly tiebreaker** — the taste the raw scalar can't encode. So low waves are *many weak slow* rocks, not few tough fast ones. Caveat: the count floor has its own minimum threat (~0.05 net), so very low targets can't go lower (the dev boot log prints **target vs achieved + the chosen tier** so any gap is visible). `WAVES` is just a list of `{ required, quota, shieldRegenMs }`, in `src/waves.ts` alongside the model and solver.

- **Current run targets** (Playtest 3 re-tune, 2026-06-07 — "noticeably harder, still soloable"): required **0.05 / 0.20 / 0.45 / 0.75**. The solver realizes them as: **W1** 3 weak slow 1-hit (×0.50) · **W2** +4th lane & faster (×0.66), still all 1-hit · **W3** speed maxed (×0.85), two 2-hit rocks · **W4** a 3-hit rock joins three 2-hit. A skilled solo player can scrape W4 (~76% accuracy); two players comfortable (~38% each). The earlier 0.05/0.14/0.30/0.50 tune was too easy (solo-clearable throughout) and made W1≈W2 (both all-1-hit, near-identical fields — read as "wave 2 twice").
- Ammo regen is global (1 shot/s/player) — it deliberately does not escalate.
- Known limits of the scalar (judgment stays on top): per-hit aim difficulty of small/fast rocks, and burst overlap at the shield.
- **Split fragments (B30) are intentionally un-modeled** by `threatOf`. They appear only when players are *winning* (rocket-killing tough rocks), they're trivial 1-hit pops, and the shield regen leak absorbs the occasional fragment that reaches the station — so the calibrated targets (0.05/0.20/0.45/0.75) stand as-is. If a W3/W4 playtest shows the kids drowning in fragments, the cheap knobs are `SPLIT.fragmentSpeed` ↓ or `SPLIT.lifetimeMs` ↓ (expire before reaching the station) — **not** the wave targets.
- Calibration TODO: time the kids' real shots/s on the phone and refine the target bands.

## 8. Install & offline (PWA) — decided 2026-06-09 (B12)

The game ships as an installable Progressive Web App, so it feels like a real app
on the phone — the same chrome-free benefit on *both* the Pixel 6 (Android Chrome)
and iPhone (iOS Safari), since it being a webpage is the whole point.

- **Installable** on both platforms (web app manifest + app icons): Pixel via
  Chrome's "Install app", iPhone via Share → "Add to Home Screen". Launches from a
  home-screen icon with no browser chrome.
- **Offline after first load** — a dependency-free service worker caches the whole
  surface (one content-hashed bundle, all art code-drawn, self-hosted font, icons),
  so the game boots with no network. Fresh deploys still win online (navigations are
  network-first; hashed assets self-bust on the next build).
- **Self-hosted font** — Audiowide ships as a local `.woff2` (no Google Fonts
  cross-origin dependency), so text renders offline in the neon face, never a fallback.
- **Platform ceiling (expected, not a bug):** Android installed → true edge-to-edge
  fullscreen. iOS installed → standalone (no Safari UI) but iOS ignores
  `display:fullscreen`, so the thin status bar stays; it's blended into the dark
  background (`black-translucent` + `viewport-fit=cover`) so it reads as fullscreen.
- **Out of scope (deliberately dropped):** auto-`requestFullscreen()`-on-first-touch.
  It's Android-only (iPhone Safari has no Fullscreen API), jarring on desktop, and
  installing the PWA already gets you chrome-free — installing *is* the chrome-free path.
- **Implementation note:** hand-rolled (`public/sw.js` + `public/manifest.webmanifest`),
  not `vite-plugin-pwa` — the plugin pushes toward an absolute base that would break
  the deliberate relative `base: './'` ("works from any static folder"), and its
  precache-manifest machinery solves a multi-chunk problem this single bundle doesn't
  have. All PWA URLs are relative so they resolve under the `…/star-slingers/`
  subpath; the SW registers PROD-only (dev + the headless test suite never get one).

## 9. Final boss (B5) — built 2026-06-09 (reworked to a cycling fight same day)

The run's finale, replacing the wave-4 placeholder card. A **boss slides in from
the side** (slowly, menacing) and parks at **center**, fully on screen, **stationary
while battling**, guarded by **4 escort vessels that slowly orbit it**. The fight is a
**repeating, urgent cycle**:

- **Charging:** the escorts orbit, the boss is **shielded and invulnerable** (plain
  shield ring), and the **charge gauge fills** (the urgency telegraph). **Each escort
  you kill resets the charge** — steadily clearing them keeps the boss from ever firing;
  you only get shot if you stall.
- **If you clear all 4 in time → Exposed:** the boss **drops its shield** (full color)
  for a short **window** — shoot it and the **health gauge drains**. The window ends, the
  **escorts respawn**, the boss re-shields, and it charges again. (A full clear is the
  *only* thing that respawns escorts.)
- **Readout = two vertical gauges** in the band to the boss's right, off its body so the
  center stays uncluttered: a green **health** bar (heart-capped) and a magenta **charge**
  bar (bolt-capped). Both fill bottom-up and carry their icon at **top and bottom** so
  either seat reads them at a glance (icon recognition, no reading).
- **If the charge fills first:** the boss **fires** a beam that **shatters a shield
  ring** (reusing the station shield + regen) — no damage window that round. The
  **surviving escorts stay** (your progress on them is kept), the charge resets, and it
  keeps charging — so it can fire again on the same set until you finish clearing them.
- **Win:** chip the boss's ~10 HP to zero across successful windows → **"You did it!"**.
  **Loss:** a charge fires with the shield already gone → **"Try again?"** (both reuse
  the existing end-cards).

- **Escorts take two hits, shown as shield-then-core:** a magenta core inside a **cyan
  shield ring**; the first hit knocks the ring off (it shatters, echoing the boss's own
  shield), the second pops the core. They're **pure gating targets** (no station threat).
- **Urgency = the charge bar racing you; co-op = needing both slings** to clear the 4
  escorts inside the time limit (and to make the most of each short window). **No
  asteroids** during the boss. **Homing (B14) still works** — it locks escorts while
  charging, the boss while exposed.
- **Tuning:** `src/waves.ts` `BOSS` holds the dials — `chargeMs` (time to clear the
  escorts), `exposedMs` (window length), `hp`, `escortHits`, `shieldRegenMs`. Boss/escort
  positions, sizes, orbit, and entrance speed live in `src/layout.ts` `BOSS_LAYOUT`.
  *(The charged shot (B13, §5) is asteroid-only pierce — it's an ordinary single hit on the boss/escorts, so the finale balance is untouched.)*

## Everything else
Enemy ships, sound/juice, fairness-lever backups: the original brainstorm's drafts live as **[draft]-tagged backlog items** (B4/B8, plus the audio+haptics half of B7) — raw material to react to, not decisions. They graduate into this spec when worked out, reviewed, and built. (Waves = §3/§7; scoring = §3; homing = §5; boss = §9; wave-clear shower = §4 — all built.)

## Open questions
Tracked in [`backlog.md`](backlog.md) — nothing floats in chat.
