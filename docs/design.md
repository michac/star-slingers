# Star Slingers — Design

> **The game as it is built now**, with the reasons behind it. Non-technical.
> Work that isn't built yet lives in [GitHub Issues](https://github.com/michac/star-slingers/issues); the current vision is the colony-ship campaign, #30.
> Finishing an issue rewrites the sections it changes, in place. History and playtests live in [`notes.md`](notes.md).

## 1. Pitch
Two players sit facing each other across a phone held in portrait, one at the top edge and one at the bottom. Each mans a rocket launcher with two thumbs (one aims, one fires), slinging rockets across the field at asteroids and enemy ships that sweep in from the right along the enemy lane toward a fleet of four colony ships flying along the left edge, each behind its own glowing shield bubble, while the stars stream past. You defend the fleet together: win together or lose together.

## 2. Players & setup
- **1 or 2 players**, shared-screen co-op (designed for a parent + the 5-year-old; playtest 1 says the 9-year-old enjoys it too).
- **Device:** Pixel 6, held or propped in **portrait**, players **facing each other** — one at the top short edge, one at the bottom. Each player owns their own end.
- Multitouch: one player's two thumbs at once is confirmed on the device (solo controls playtest, 2026-11-02). Four thumbs at once (both players, two each) isn't playtested yet; the game accepts up to 6 touches (`activePointers` in `src/main.ts`).
- **No reading required** — everything is shapes, motion, and a few numbers.
- **Join screen (#20):** every boot opens on it. Each seat has a **join panel in its own half** (P1's is P2's rotated 180°): a breathing ring in the seat's colour round a big rocket. A **tap anywhere in your half joins** that seat, and two pick buttons appear either side of your ring: **Easy** (an ∞) on your left and **Normal** (a row of five ammo pips) on your right. Picking one makes the seat **ready**; you can switch picks until the run starts. **Tapping your ring again leaves**, so a stray touch on the empty seat never blocks a solo start (a ring tap within half a second of joining doesn't count, so a double-tap or two fingers landing together stay joined: `JOIN.leaveGraceMs`). Once **every joined seat is ready**, a **3-2-1 numeral countdown** (`JOIN.countdownMs` in `src/layout.ts`) shows to each joined seat, then the run starts with **only the joined seats live**. A seat that joins mid-countdown stops it until that seat picks too; a seat that leaves restarts it from 3, so a change of heart has time to rejoin. Icons and numerals only, no text. Built in `src/scenes/JoinScene.ts`, which starts the game with the lineup (`src/lineup.ts`) as scene data.
- **Easy vs Normal:** Easy is for the 5-year-old. For now its one difference is **unlimited ammo** for that seat (§5); wave difficulty doesn't change. Normal plays the usual ammo rules.
- **Solo (#6):** if one seat joins, it plays alone **at its own edge** (top or bottom): only its controls and HUD are built, the wave banner and end-card copies face only it, and touches in the empty seat's half do nothing. An escort still takes two hits, but both may come from the one player (§9). Wave targets scale by `SOLO.requiredScale` (`src/waves.ts`, 1.0 today: unchanged until playtested); the boss isn't scaled.
- **The lineup lasts the run:** Try again keeps the same seats and picks; a win (or a reload) goes back to the join screen. Nothing is saved on the phone.

## 3. The goal
Keep the colony fleet alive. One shared fleet, one shared score — there's no competing, ever.

**The run (#24, built 2026-11-03): 10 waves in 4 acts**, played in order from one table (`RUN` in `src/waves.ts`, §7):

| Act | Waves |
|---|---|
| 1 · Asteroids | 1 asteroids · 2 asteroids · 3 **giant-asteroid boss** |
| 2 · Ships | 4 ships · 5 shielded ships · 6 **command-ship boss** (§9) |
| 3 · Space monsters | 7 monsters · 8 monsters · 9 **monster boss** |
| 4 · Finale | 10 · a long, dense, forgiving wave to blast with everything |

Each act's real content is its own issue (#25 asteroids, #27 ships, #28 monsters). **Until each is built, its waves are placeholders that play as asteroid waves**: the ship and monster waves and the giant-asteroid and monster bosses field solver asteroid fields at their own targets. The command-ship boss (wave 6) is the real encounter. The finale is built as an asteroid wave: every rock stream a splitter, a big quota, a quick shield regen.

A field wave fields a **finite quota** of asteroids. Respawns stop when the quota is spent, and the wave clears when the field empties ("we beat them all!"). Asteroids that reach the fleet or fly past it also count as spent, so a wave always ends. The command-ship wave ends when the boss is down.

**Between waves** comes a short **breather**: the fleet is restored (every lost ship rebuilt, every shield back, one ship at a time; §4), and a celebratory **star-shower** rains across the field (§4). Then two seams run in order: after a boss wave, its **upgrade drop** (#26), and when the act changes, the **act transition** (#29). Neither has behaviour yet; both pass straight through. Last, a big mirrored numeral (2 to 10) announces the next wave. The starting wave has no banner, so play begins within seconds. **After wave 10 the run is won** ("You did it!"). A tap there goes back to the join screen (§2) for a fresh run.

**Try again restarts at the first wave of the act you lost in** (wave 1, 4, 7 or 10; decided by Michael), with the same seats and Easy/Normal picks (§2). It doesn't go back to wave 1, so the 5yo never replays the whole run after one bad wave. Score starts again from 0.

**Test shortcuts:** `?wave=N` starts the run at wave N (1–10) once the join screen's countdown ends, and `?boss` is the same as `?wave=6`. With either in the URL, Try again never goes back before wave N: losing in wave N retries wave N itself, not its act's first wave, so a tester can re-run one wave. Past wave N, the act-start rule applies again.

**Score (B37, built 2026-08-03):** one shared, live-only number that climbs as the team pops rocks — shown on both HUDs' SCORE row. A **standard** scores 10; a **splitter** scores 20 immediately, and its two standard children score 10 each, for **40** on a complete splitter clear. A rock that **reaches the fleet scores nothing** (it's a loss, not a kill). A small accent-colored **`+N`** pops at each kill site and grows-and-fades in place (orientation-neutral so it reads the same from both seats; the HUD number is the canonical read). No persistent "best" across restarts — `scene.restart()` resets the score to 0. The **boss fight stays unscored** for now (its health/charge gauges carry the climax; a number on top would clutter it).

## 4. Field & layout — v6 colony fleet (#19, 2026-11-03)

- Logical field **360×740** (≈ Pixel 6 portrait).
- **The enemy lane:** the band between the two seats' control areas, y 200–540 (`LANE` in `src/layout.ts`), drawn as a faint violet wash with brighter top and bottom edges. Every enemy lives inside it. It splits into **4 sublanes** of 85px, top to bottom, one per fleet ship. Canonical layout mock: [`mockups/layout-colony-ship.html`](../plans/mockups/layout-colony-ship.html) (v6).
- **The colony fleet:** four code-drawn colony ships (`FLEET`, `TEX.fleetShip`), one at the left edge of each sublane, nose right, about 40px long. Each has **one shield bubble**, an ellipse round its hull reaching x=53, which leaves 307px of the 360px width open. Rockets fly over the fleet; only enemies hit it.
- **One shield per ship, two hits per ship:** an enemy reaching a ship **pops its shield** (flare + a worried shake); a second hit before the shield regrows **loses the ship** (an explosion, then a faint dashed outline where it was). Where on the ship it hit never matters. A ship is threatened only by enemies **in its own sublane**: a rock belongs to the sublane its centre is in (so one skimming a sublane's edge still hits that sublane's ship), and is consumed at that ship's bubble front, or at the hull's nose once the shield is down.
- **Shields regrow per ship:** after a quiet stretch with no hit on that ship (the wave's `shieldRegenMs`, ~10s, a difficulty knob), its bubble settles back in (reverse of the pop). A lost ship stays lost for the rest of the wave. **Between waves** every lost ship is rebuilt and every shield returns, one ship at a time (`BREATHER.shipRestoreStaggerMs`). Rebuilding between waves is Michael's call "for now".
- **A lost ship's sublane stays open:** rocks still spawn there, fly past the empty spot and leave off the left edge harmlessly (no damage, no score).
- **All four ships lost:** gentle fail — calm dim plus an **opaque modal card** (field clutter never shows through it; Playtest 2), one big circular-arrow replay icon (reads either way up; "Try again?" text is decoration, never load-bearing), tap **anywhere** to restart. Losing three ships plays on.
- **Enemies enter from the right and drift straight left** inside the lane; nothing funnels. Every (re)spawn draws its sublane from a **shuffle bag** of the four, at a random height inside it (`WaveDirector.pickY`), so each sublane gets an equal share of a wave's rocks whichever stream fields them, and every ship is threatened. How ships and monsters pick their targets is decided in #27 and #28.
- **Why the lane and the fleet:** the whole field stays shared — any rock can be shot by either player anywhere, so either can cover for the other (the v4 central-core layout was rejected because a centred objective blocked cover fire; see notes.md layout history). Four ships make losing one a visible, partial setback rather than a sudden end.
- **Starfield:** three parallax star layers stream right to left behind everything at one steady speed (8/22/55 px/s, the near layer drawn as short streaks), so the fleet reads as flying. Each layer is one tiling texture (`TEX.starLayer`) scrolled in `Starfield.ts` on the game clock, three quads a frame. `STARFIELD.speedScale` is the speed setting (`Starfield.setSpeedScale`) that #29 changes. The join screen has the same scrolling stars.
- **Visual style — Neon Arcade** *(decided 2026-06-07, B9)*: synthwave palette — deep purple-black space, hot-cyan P1 / amber-orange P2 / magenta enemies, Audiowide font. Palette lives in [`mockups/tokens-neon.css`](../plans/mockups/tokens-neon.css); the canonical neon mock [`mockups/style-neon.html`](../plans/mockups/style-neon.html) is cut against v5 geometry (B10). The palette is **live in the game** (B21): `src/tokens.ts` holds the neon values, the fleet's shield bubbles take the gradient's cyan stop and the enemy lane its violet one, and Audiowide loads before Phaser boots. Only the mock's **gradient fills (B24)** stay deferred (solids read fine); glow/bloom, the shield pulse, and the burst/trail juice all shipped in the polish pass below.
- **Shield look — glow + pulse + flow** *(B22 + B23, polish pass 2026-06-15; prototyped + locked first, see `plans/polish-pass.md`)*: the fleet's shield bubbles live in their own per-frame layer that **breathes** — each bubble's **color brightness** pulses on a slow sine (trough 0.6 → crest 1.0, ~3.2s/breath) and the crest **flows** down the fleet (a per-ship phase offset), reading as energy shields rather than a solid object. One shared ambient **glow** blooms under every live bubble and breathes with them. A popped bubble **flares its glow bright then expands + fades**. Two locked constraints: pulse **color brightness, never alpha** (a thick semi-transparent stroke shows radial "grid" spokes at its tessellation joins), and **perf first** (no DPI render; one glow FX for the whole fleet at `quality` 0.3 — sharper lagged the Pixel 6). The locked reference, `prototype/reference/shield-pulse.html`, shows the look on concentric rings. Tuning in `SHIELD_FX` (`src/layout.ts`); built in `Fleet.ts`.
- **Asteroid break — composed burst** *(B29, polish pass 2026-06-15)*: a popped asteroid replaces the old flat scale-up+fade with a **flash** (white core under a transient magenta glow), a **shockwave** ring, **debris** (rock shards flung out, spinning + falling), and additive **sparks**, while the rock itself snaps bigger and vanishes. Built on **one shared pair of particle emitters** (never new emitters per pop) + one transient glow; `Explosions.ts` owns it, fired via a `boom(x,y,r)` callback threaded through the `WaveDirector` into each `Asteroid.pop()`. Tuning in `EXPLOSION` (`src/layout.ts`). *(Asteroids only; boss/escort pops keep their current effect for now.)*
- **One-hit large splitters** *(B37, built 2026-08-03)*: wave rocks are either **standard** (r=13, one rocket hit, no label, 10 points) or **splitter** (r=17, one rocket hit, no label, 20 points). A rocket immediately breaks a splitter into **two standard-size, one-hit children**; the full clear is 40 points (20 + 10 + 10). Only rocket-kills split — fleet contact is a loss and never creates children. Children keep the self-balancing threat: they scatter leftward for `scatterMs` (0.4s, held inside the enemy lane), then drift straight left at `childSpeed` and can hit their sublane's ship; they get a brief spawn grace (so a charged round carrying on past their parent can't hit them at once), and expire at a hard lifetime cap. They are preallocated wrappers appended to the fixed asteroid pool, retaining collision, update, missile targeting, fleet-contact, and wave-clear integration; they are one-shot (no respawn) and fielded in-place via `spawnChild`. Tuning is `SPLITTER_CHILDREN` (`src/layout.ts`).
- **Enemy health bars** *(#23, built 2026-11-03)*: an enemy at full health shows nothing; after a hit that doesn't kill it, a short **vertical pill** appears just off its **right (trailing) side**, so it never sits between the enemy and either seat (on an enemy hugging the field's right edge, where that side would be off-screen, it flips to the left side). The bar's green fill (`COLORS.health`, the same green as the boss's HEALTH gauge, so green always means health) sits on a dim `COLORS.lineDim` track, and it is **centred**: it shrinks toward the middle as hp drops, so the top and bottom seats see the same picture. It moves with the enemy and vanishes the frame the enemy dies. Code-drawn into **one shared Graphics** redrawn every frame (`HealthBars.ts`, after Arcade syncs sprites to their bodies); the drawer takes any `HomingTarget`-shaped enemy that also has `hp`/`maxHp` (`HealthBarTarget`), and only asteroids feed it today. Dials in `HEALTH_BAR` (`src/layout.ts`). **No bars** on the fleet's shields, the boss's shield web or the escorts' lock fins (not hp), and the **boss keeps its own HEALTH gauge** (§9). A non-lethal hit also flashes the enemy white.
- **Wave-clear star-shower** *(B7 visual, built 2026-06-15)*: beating a wave throws a celebratory **confetti shower** — sparkles in the two player colors + accent (`COLORS.p1/p2/accent`) seeded across the field's top and raining down over the whole playfield. Fires on **every** wave clear (the command-ship win included, since it ends its wave through the same breather). Built on **one persistent shared emitter** (created once in `Explosions.ts`, never per-event — same discipline as the asteroid burst), fired via a `celebrate()` callback threaded `SandboxScene → WaveDirector → starShower()`. Tuning in `STAR_SHOWER` (`src/layout.ts`); tints sourced from `tokens.ts`. *(Audio + haptics for wave clear stay queued in B7 — this repo has no audio-asset pipeline.)*
- **Shot trail — violet exhaust + afterimage, tiered by charge** *(polish pass 2026-06-15; tiered for B13)*: each player's rocket leaves a trail drawn into one shared additive Graphics — a long faint **afterimage** light-streak over the shot's ~75-pt flight history, under a short tapered **exhaust** ribbon (glow halo → violet body → white-hot core) with a brightness **flux** scrolling down it. The head stays the player's color; the exhaust is violet (`COLORS.shieldMid`) for contrast. All filled additive quads — no postFX, no particles. **Two tiers (B13):** the full bright look is the **charged** (railgun) trail; a normal uncharged shot gets a **subdued** version (less alpha, shorter ribbon), so the in-flight trail itself reads as "this was a railgun." Tuning in `TRAIL` (`src/layout.ts`, with `chargedMul`/`normalMul` multiplier sets); built in `Rocket.ts` (`RocketPool.update`).
- **Boss command-ship presentation + shield web** *(B34, 2026-08-05)*: the finale removes the last stack of concentric boss/shield/orbit circles. The boss and escorts are fleet-facing angular ships; four escorts rotate as one fixed-radius diamond. Their active adjacency links render as a violet/cyan neon **shield web** and physically consume rockets, while a downed escort leaves its two sides open as a visible shoot-through gap. See §9 for the encounter rules.

## 5. Controls (implemented; playtested solo 2026-11-02)
**Two-thumb controls (#7, chosen in the controls playtest):** each seat has a FIRE button, a SPECIAL button and an aim zone. Built in `TwoThumbControl.ts`; all geometry in `CONTROLS_V2` (`src/layout.ts`).
- **Per-seat layout:** **FIRE** (big, round) and **SPECIAL** (smaller, beside it, a little higher and inward) sit on the **player's left**; the **aim zone** covers the **player's right** side of their band, marked by an **aim pad** (a dim disc with a ◀ ▶ hint, the aimable range as a dashed arc, and a knob pointing along the current aim). The **launcher** sits between them, where the shot leaves from, with the rocket nocked on it. **Lefty** is a per-seat option that mirrors the layout: aim zone on the player's left, buttons on their right; aim directions don't change. It's picked by URL (`?lefty=p1|p2|both|none`, linked from the prototype shelf) and remembered on the phone.
- **P1 sits at the top edge:** their whole layout is P2's rotated 180° about the field centre, so it reads right-side-up from that seat.
- **Drag aim:** put a thumb down anywhere in the aim zone (it doesn't jump the aim) and slide **sideways** to turn the aim, 0.8° per unit (~4cm sweeps the whole range). Aim is clamped to **15°–165°** from the player's right (90° = straight across at the other player) and **persists** between shots and when the thumb lifts; each run starts aimed straight across. A **dotted trajectory** of fixed length shows the aim line at all times: dim at rest, bright while the seat aims or holds a button. It's an honest preview, because there's no gravity.
- **FIRE is the railgun:** press and the nocked rocket draws back; **release fires a plain round** along the aim at a fixed speed (`SLING.maxSpeed`). **Hold `CHARGE.fullMs` (600ms) for a charged round:** a **violet charge ring** (the shield-mid / trail violet, which rhymes with the charged trail and stays distinct from the cyan/amber player colors) sweeps clockwise round FIRE from the top as the charge climbs, and once full it **breathes** to show it's armed. Releasing early fires a plain round. All code-drawn, orientation-neutral, no text.
- **SPECIAL** *(#22)*: fires the seat's **current special**, which today is always the **homing missile**. While held, it **rings the enemy the missile would take** along the current aim; **release fires it** (at `MISSILE.speed`, a touch slower than a FIRE round so it can turn tight). SPECIAL **never charges**, however long it's held. The button's **icon shows the current special** (a small banking rocket with a curved dotted trail for the missile), drawn from the `SPECIALS` table (`src/objects/specials.ts`) by the seat's `special` field. An upgrade (#26) changes that field, and the button and the HUD's special row change together.
- **One button at a time:** while either button is held, a press on the other is ignored. The aim thumb works independently, so a player can hold a button and steer with the other thumb.
- **FIRE rules (#22):** a **plain round** does **1 damage** (`DAMAGE.fire`) and **stops at the first thing it hits**. A **charged round** does **2 damage** (`DAMAGE.charged`). If that hit **kills** the target, the round **carries on along its line** and can hit the next target. If it doesn't kill, the round stops there. A carrying-on round hits each target at most once. Against an escort it's the same rule: a charged round that completes an escort's second lock (downing it) carries on, and can go straight on **through the gap it just opened into the boss**. A charged round still costs 1 ammo.
- **Missile rules (#22):** built to be **hard to miss from a rough aim**, the 5yo's fairness lever (§6). At launch it takes the **on-screen** enemy **nearest its aim line inside a wide forward cone** (a rock waiting just past the right edge doesn't count) (`MISSILE.coneHalfAngleDeg`, 45°, out to `maxRange`), with no tight close-pass test. It flies straight for a short arming run (`armDistancePx`, capped at half the distance to a close target), eases its turn in over `rampDistancePx`, then **steers hard** (`turnRateDeg`) onto the target. **If it has no live target** (none at launch, or its target dies mid-flight), it picks the enemy nearest its **current heading** inside the same cone and keeps looking until it finds one. A missile still flying after `lifetimeMs` (3s) is spent, so it never orbits forever. It does **1 damage** (`DAMAGE.missile`) and stops on its hit. It takes asteroids during field waves and escorts during the boss. A shot is never both charged and a missile (only FIRE charges). Dials: `MISSILE` in `src/layout.ts`.
- **Boss rule (B33, B34, #22):** only a **charged** FIRE round damages the boss, **1 HP per hit**, and only by travelling through a shield-web gap (§9). Plain rounds and missiles do nothing to it, so the missile helps against escorts only.
- **Ammo: two pools per seat.** FIRE's: each round costs 1, up to 5 (`AMMO.max`), 1 back per second. SPECIAL's: its **own smaller pool**, up to 2 (`SPECIAL.max`), 1 back every 3 seconds (`SPECIAL.regenMs`). Each pool regens on its own clock, and a pool's clock **restarts when it drops from full**: the first shot spent from a full pool always takes a whole interval (1s, or 3s for a missile) to come back, so a full SPECIAL pool can't fire two and get a third back almost at once. Out of FIRE ammo the nocked rocket dims; out of SPECIAL ammo the SPECIAL icon dims. While a button is held, the nocked rocket dims on **that button's** pool, and an empty SPECIAL pool shows no target ring. A release on an empty pool fires nothing. An **Easy** seat (§2) never runs out: both pools stay full however much the seat fires, and both values read **∞** (`PlayerHud.setUnlimitedAmmo`).
- **Per-player HUD** shows WAVE, SCORE (the shared score, built in B6, §3), AMMO, and a fourth **special row**: the SPECIAL pool's count, labelled with the **current special's icon** instead of a word. It sits in the centre column **under each launcher, between SPECIAL and the aim pad** (shifted to clear the mirrored buttons on a lefty seat); P1's is rotated 180°.
- Both players aim and fire **simultaneously**, two thumbs each; every touch belongs to the seat whose control it lands on.
- **Haptics (#3):** every shot fired buzzes by kind: **charged round 40ms > missile 25ms > plain round 20ms**. FIRE also gives **one 20ms tick per hold** the moment it's fully charged *with ammo to fire* (no "ready" tick for a release that would fire nothing). It's feature-detected, so it's a silent no-op where `navigator.vibrate` doesn't exist (iPhone), and it's skipped until the page has had a tap. On Android it only works with the phone's **Settings → Sound & vibration → Vibration & haptics → Touch feedback** turned on; otherwise Chrome silently ignores `navigator.vibrate`. Dials are `HAPTICS` in `src/layout.ts`; code in `src/haptics.ts`.

## 6. Co-op dynamic (principles)
- Two launchers, **one shared fleet, one shared score**.
- **The whole field is shared.** Each player naturally tends their near half, but either can fire anywhere — so the parent quietly cleans up what the 5-year-old misses. Layout decisions must protect this (it's what killed v4).
- **Leading a moving target is the core skill** — satisfying for an adult, hard at 5. **The SPECIAL homing missile (#22, §5) is the shipped fairness lever for the 5yo:** SPECIAL is a button **both players always have**, and a rough aim is enough, so the 5yo can hit without leading the target, while FIRE rounds still ask for the lead. Its small, slow-regenerating pool keeps it a helper rather than the main weapon. **Easy** (§2, unlimited ammo in both pools) is the other lever, picked per seat on the join screen. Further backups (slower rocks, telegraphed shots) stay queued as backlog B8.

## 7. Difficulty (the budget model — Playtest 2/3, 2026-06-06/07)

Difficulty is tuned against **one scalar**, not five raw variables:

> **required team damage/s = threat − leak**, where
> threat = Σ over live rock streams of `clear damage × speed ÷ travel distance` (accurate damage/s the field demands, sustained), and
> leak = `1 ÷ shield-regen interval` (the miss rate a regenerating shield forgives forever).

The travel distance runs from the mean spawn x to a fleet ship's bubble front (x=53). A **rock stream** (`ROCK_STREAMS` in `src/waves.ts`) is one asteroid wrapper fielding rock after rock at its base speed; streams own no position, since every spawn takes its y from the sublane bag (§4).

**The leak term is unchanged by the fleet, and the fleet forgives more than it counts.** Leak is still one forgiven miss per regen interval, as when the station's one shield regrew a ring at a time. The fleet has four shields regrowing independently, plus four hulls before the run is lost, so the same targets probably play easier than on the station they were calibrated on. That's for playtest and act 1's tuning (#25); the model doesn't account for it.

**Damage, not hits (asteroid health, 2026-11-01).** Each asteroid kind has an `hp` (`ASTEROID_KIND`, **1 for both standard and splitter**) and pops once a hit takes it to 0; each shot deals damage from the `DAMAGE` table in `src/waves.ts`: **`fire: 1, charged: 2, missile: 1`** (#22). A rock's *clear damage* is its hp plus, for a splitter, the hp of its two standard children (1 + 2 × 1 = 3). Every rock in the run is 1 hp, so a charged round's second point is overkill on a rock, and damage/s still equals kills/s: **no solver output, target, or calibration below changed** when the charged round went to 2. **Break-even accuracy** (`breakEvenAccuracy`, printed in the dev boot log) is the share of the seats' damage ceiling that must land. A seat's ceiling (`seatDamagePerSec`) counts **both ammo pools** at their regen rates, one hit each: 1/s of FIRE rounds plus 1/3s of missiles. A rock with max hp > 1 (none in the run today; `AsteroidSpec.hp` overrides it for tests/tuning) shows a **health bar** once it's damaged (§4), plus a brief white flash on each non-lethal hit.

Precedent: MMO DPS-checks/enrage timers, tower-defense threat-vs-defense throughput, Schreiber & Romero's *Game Balance*.

**The scalar is the input, not a knob (Playtest 3, 2026-06-07).** A wave is defined by its **target** `required` damage/s; a **solver** (`solveWave` in `src/waves.ts` — the one file that holds all the difficulty dials) realizes it by moving knobs in a fixed **priority order until threat hits the target**:

1. **Count** — fill rock streams from a floor of **3** (the always-on "minimum asteroid rate": lots of weak targets) toward 4.
2. **Speed** — raise the speed scale.
3. **Splitters** — replace standards with a one-hit splitter (r=17); its split plus two children cost 3 required damage, so this is the last, most demanding lever.

Among the many knob combos that hit any given number, the priority order is the **kid-friendly tiebreaker** — the taste the raw scalar can't encode. So low waves are *many weak slow* rocks, not few tough fast ones. Caveat: the count floor has its own minimum threat (~0.05 net), so very low targets can't go lower (the dev boot log prints **target vs achieved + the chosen tier** so any gap is visible). The run is one table, `RUN` in `src/waves.ts`, alongside the model and solver. Each row is a wave's act, kind (`asteroid`, `ship`, `monster`, `boss` or `finale`), which boss it is, and, for every wave the solver plays, a `field` of `{ required, quota, shieldRegenMs }`. All the run's dials live there, so each act's issue retunes its waves in one place.

**How the solver applies to each kind:** asteroid waves, the finale, and every placeholder (ship and monster waves, the giant-asteroid and monster bosses) are solver fields: the target is realized as an asteroid field by the waterfall above. When an act's issue builds its real enemies, that kind gets its own way to realize the same target. The command-ship boss isn't solved: it has no field and is tuned by its own `BOSS` dials (§9).

- **Current run targets** (#24, 2026-11-03; required damage/s · quota · shield regen s): W1 0.30·8·10 · W2 0.45·10·11 · W3 0.60·12·13 · W4 0.45·10·11 · W5 0.60·12·13 · W6 boss · W7 0.60·12·13 · W8 0.75·14·15 · W9 0.75·14·15 · W10 0.90·24·8. Each act eases back a step from the last one's peak, then climbs. Act 1 keeps the calibrated B37 values; the rest are placeholders, revisable in playtest. On the B37 calibration W1 solves to 1 splitter and W2/W3 to 2, all four streams at ×0.85; 0.75 solves to 3 and the finale to all 4. Use that record before any retune. The final solver tier is standard → splitter only: it never generates a 3-hit rock. Two-hit rocks for wave 2 are #25's. **The "slow rocks" gentle lever is gone from W1**: the 5yo's cushion is the SPECIAL missile (#22), not speed. If W1 plays too steep for him, soften its target toward ~0.25 rather than reintroducing slow rocks.
- Ammo regen is global (FIRE 1/s and SPECIAL 1/3s per player): it deliberately does not escalate.
- Known limits of the scalar (judgment stays on top): per-hit aim difficulty of small/fast rocks, and burst overlap at a ship's shield.
- **Splitter children are modeled** by `threatOf`: a splitter costs 3 required damage (one split plus two standard child pops), via `clearDamage`. The targets remain fixed through the first B37 phone playtest; if children feel oppressive, tune `SPLITTER_CHILDREN.childSpeed` or `lifetimeMs` before changing target bands.

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

## 9. Command-ship boss (B5, reworked by B34 2026-08-05)

Wave 6, act 2's boss (§3). A **boss slides in from
the side** (slowly, menacing) and parks at **center**, fully on screen, **stationary
while battling**, guarded by a **fixed-radius rotating diamond** of 4 escort vessels.

- **Shield web:** every live adjacent escort pair is joined by a glowing physical line.
  The links are blockers: they consume any rocket that crosses them. Killing an escort
  removes its two attached links, making a literal shoot-through gap; it returns after
  **6 seconds** with both player locks restored. The formation rotates but never breathes
  inward or outward, and every ship points at the fleet.
- **Damage + urgency:** the boss itself has **no shield ring or exposed state**. It always
  takes one HP from a **charged FIRE round** that physically reaches it through a web gap
  (1 HP per hit, though a charged round is 2 damage elsewhere, so the fight is still 10 hits);
  plain rounds and missiles do no damage (#22). A charged round that downs an escort carries
  on along its line, so one shot can complete the lock and go on through the new gap into the boss. Each escort kill resets the charge and the charge
  **pauses while any escort is down**, resuming only when all four have returned.
- **Readout = two vertical gauges** in the band to the boss's right, off its body so the
  center stays uncluttered: a green **health** bar (heart-capped) and a magenta **charge**
  bar (bolt-capped). Both fill bottom-up and carry their icon at **top and bottom** so
  either seat reads them at a glance (icon recognition, no reading).
- **If the charge fills first:** the boss **fires** a beam at the **top-most live fleet
  ship**: it pops that ship's shield, or loses the ship if its shield is already down
  (the fleet's own shields and regen, at `BOSS.shieldRegenMs` during the fight), then
  resets the charge; live escort lock progress remains in place. The fleet can take up to
  eight beams. The top-most rule is a placeholder: #27 decides the final one.
- **Win:** chip the boss's 10 HP through successive web gaps. The boss, escorts, web and
  gauges leave the field and the run goes on: breather, then wave 7 (§3).
  **Loss:** the beam takes the fleet's last ship → **"Try again?"**, which restarts
  act 2 at wave 4 (§3).

- **Each escort is a directional ship with two player-color lock fins:** one cyan P1 and
  one amber P2. It needs **one rocket from each player**, in either order; a duplicate hit
  is consumed but rejected. The matching fin breaks on a successful hit and the remaining
  fin pulses in its player color, silently showing whose shot is needed next. They're pure
  gating targets; partial locks survive a boss beam and a timed regeneration restores both locks.
  **Solo** (one seat joined, §2): an escort still takes two hits, but a repeat from the one
  player fills the absent player's fin instead of being rejected.
  The locked visual source is `prototype/reference/escort-coop-lock.html`.
- **Urgency = the charge bar racing you; co-op = both kids must contribute** to every one
  of the four escorts. **No asteroids** during the boss. Any FIRE round or missile counts
  as its seat's lock on an escort, and the missile takes live escorts; it never hurts the boss.
- **Tuning:** `src/waves.ts` `BOSS` holds the dials — `chargeMs` (time to open a gap
  before the boss fires), `escortRegenMs` (gap duration), `hp`, `escortCount`,
  `shieldRegenMs`. Boss/escort positions, sizes, orbit, web width (`escort.webWidth`), and
  entrance speed live in `src/layout.ts` `BOSS_LAYOUT`. The one-hit-from-each-player lock
  rule is fixed in `Escort.ts`, not a balance dial. Boss HP remains 10 charged hits; the escort charge race remains 5 seconds.

## Not built yet
Everything planned but not built is a GitHub issue. The colony-ship campaign (#30) is the current vision, with one sub-issue per piece. A section here changes only when the issue that changes it is finished.
