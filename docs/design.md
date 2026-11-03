# Star Slingers — Design

> **The game as it is built now**, with the reasons behind it. Non-technical.
> Work that isn't built yet lives in [GitHub Issues](https://github.com/michac/star-slingers/issues); the current vision is the colony-ship campaign, #30.
> Finishing an issue rewrites the sections it changes, in place. History and playtests live in [`notes.md`](notes.md).

## 1. Pitch
Two players sit facing each other across a phone held in portrait, one at the top edge and one at the bottom. Each mans a rocket launcher with two thumbs (one aims, one fires), slinging rockets across the field at asteroids and enemy ships that sweep in from the right and funnel toward the space station — which sits mostly off the left edge of the screen, just a sliver of hull and glowing shield poking into view. You defend it together: win together or lose together.

## 2. Players & setup
- **2 players**, shared-screen co-op (designed for a parent + the 5-year-old; playtest 1 says the 9-year-old enjoys it too).
- **Device:** Pixel 6, held or propped in **portrait**, players **facing each other** — one at the top short edge, one at the bottom. Each player owns their own end.
- Multitouch: one player's two thumbs at once is confirmed on the device (solo controls playtest, 2026-11-02). Four thumbs at once (both players, two each) isn't playtested yet; the game accepts up to 6 touches (`activePointers` in `src/main.ts`).
- **No reading required** — everything is shapes, motion, and a few numbers.

## 3. The goal
Keep the station alive. One shared station, one shared score — there's no competing, ever.

**The run (#24, built 2026-11-03): 10 waves in 4 acts**, played in order from one table (`RUN` in `src/waves.ts`, §7):

| Act | Waves |
|---|---|
| 1 · Asteroids | 1 asteroids · 2 asteroids · 3 **giant-asteroid boss** |
| 2 · Ships | 4 ships · 5 shielded ships · 6 **command-ship boss** (§9) |
| 3 · Space monsters | 7 monsters · 8 monsters · 9 **monster boss** |
| 4 · Finale | 10 · a long, dense, forgiving wave to blast with everything |

Each act's real content is its own issue (#25 asteroids, #27 ships, #28 monsters). **Until each is built, its waves are placeholders that play as asteroid waves**: the ship and monster waves and the giant-asteroid and monster bosses field solver asteroid fields at their own targets. The command-ship boss (wave 6) is the real encounter. The finale is built as an asteroid wave: every lane a splitter, a big quota, a quick shield regen.

A field wave fields a **finite quota** of asteroids. Respawns stop when the quota is spent, and the wave clears when the field empties ("we beat them all!"). Asteroids that reach the station also count as spent, so a wave always ends. The command-ship wave ends when the boss is down.

**Between waves** comes a short **breather**: the shield restores to full ring by ring, and a celebratory **star-shower** rains across the field (§4). Then two seams run in order: after a boss wave, its **upgrade drop** (#26), and when the act changes, the **act transition** (#29). Neither has behaviour yet; both pass straight through. Last, a big mirrored numeral (2 to 10) announces the next wave. The starting wave has no banner, so play begins within seconds. **After wave 10 the run is won** ("You did it!"). A tap there starts a fresh run.

**Try again restarts at the first wave of the act you lost in** (wave 1, 4, 7 or 10; decided by Michael). It doesn't go back to wave 1, so the 5yo never replays the whole run after one bad wave. Score starts again from 0.

**Test shortcuts:** `?wave=N` boots straight into wave N (1–10), and `?boss` is the same as `?wave=6`. With either in the URL, Try again retries wave N itself, not its act's first wave, so a tester can re-run one wave.

**Score (B37, built 2026-08-03):** one shared, live-only number that climbs as the team pops rocks — shown on both HUDs' SCORE row. A **standard** scores 10; a **splitter** scores 20 immediately, and its two standard children score 10 each, for **40** on a complete splitter clear. A rock that **reaches the station scores nothing** (it's a loss, not a kill). A small accent-colored **`+N`** pops at each kill site and grows-and-fades in place (orientation-neutral so it reads the same from both seats; the HUD number is the canonical read). No persistent "best" across restarts — `scene.restart()` resets the score to 0. The **boss fight stays unscored** for now (its health/charge gauges carry the climax; a number on top would clutter it).

## 4. Field & layout — v5 (decided 2026-06-06)
- Logical field **360×740** (≈ Pixel 6 portrait).
- **Station, mostly off-screen left:** core-sized hull (r=24) centered at (−10,370), so only a sliver pokes in, with a concentric shield bulging into the field. Max intrusion ~36px — v3's station+shield reached x=120, so v5 refunds nearly a quarter of the screen width to the playfield.
- **Shield = 3 concentric rings (r=46/39/32), all visible — 3 hits** *(decided 2026-06-06, supersedes the earlier 3-segments-along-the-arc)*. Any enemy that reaches the station shatters the **outermost remaining ring** (+ a worried shake); where it hit never matters. Rings-not-segments because segments imply a positional weak spot the player can't control — pure luck; shrinking rings give the clearest kid-read: "shield getting smaller, danger closer." Honest contact too: enemies penetrate as deep as the outermost remaining ring, so a weakened shield visibly lets them closer.
- **Shield regenerates** *(Playtest 2, 2026-06-06)*: after a quiet stretch with no hits (~10s, a difficulty knob), the outermost missing ring settles back in (reverse-shatter cue). This is the difficulty budget's *leak allowance* — the team may miss one hit per regen interval forever.
- **When the shield is gone and one more enemy reaches the hull:** gentle fail — calm dim plus an **opaque modal card** (field clutter never shows through it; Playtest 2), one big circular-arrow replay icon (reads either way up; "Try again?" text is decoration, never load-bearing), tap **anywhere** to restart.
- **Enemies enter from the right, sweep left, and *funnel* toward the station** on final approach — ships' noses and shots aim at it, lanes turn toward it near the wall (currently a single straight-line redirect at the approach threshold; smooth steering is a tuning upgrade if the kink reads badly). Anything that reaches the station is consumed by the hit.
- **Why the funnel:** it keeps the whole field shared, so either player can cover for the other anywhere — and the kid-legible read is "everything is heading for the glowy thing." (The v4 central-core layout was rejected exactly because a centered objective blocked cover fire; see notes.md layout history.)
- **Canonical layout mock:** [`mockups/layout-edge-wireframe.html`](../plans/mockups/layout-edge-wireframe.html) (wireframe reference).
- **Visual style — Neon Arcade** *(decided 2026-06-07, B9)*: synthwave palette — deep purple-black space, hot-cyan P1 / amber-orange P2 / magenta enemies, Audiowide font. Palette lives in [`mockups/tokens-neon.css`](../plans/mockups/tokens-neon.css); the canonical neon mock [`mockups/style-neon.html`](../plans/mockups/style-neon.html) is cut against v5 geometry (B10). The palette is **live in the game** (B21): `src/tokens.ts` holds the neon values, the 3 shield rings take the cyan→purple→magenta gradient stops, and Audiowide loads before Phaser boots. Only the mock's **gradient fills (B24)** stay deferred (solids read fine); glow/bloom, the shield pulse, and the burst/trail juice all shipped in the polish pass below.
- **Shield look — glow + pulse + flow** *(B22 + B23, polish pass 2026-06-15; prototyped + locked first, see `plans/polish-pass.md`)*: the rings live in their own per-frame layer that **breathes** — each ring's **color brightness** pulses on a slow sine (trough 0.6 → crest 1.0, ~3.2s/breath) and the crest **flows** outer→inner (a per-ring phase offset), reading as energy shields rather than a solid object. An ambient **glow** bloom hugs and recolors to the outermost remaining ring and breathes with it. A shattered ring **flares its glow bright then expands + fades**. Two locked constraints: pulse **color brightness, never alpha** (a thick semi-transparent ring shows radial "grid" spokes at its tessellation joins), and **perf first** (no DPI render; glow `quality` 0.3 — sharper lagged the Pixel 6). Tuning in `SHIELD_FX` (`src/layout.ts`); built in `Station.ts`.
- **Asteroid break — composed burst** *(B29, polish pass 2026-06-15)*: a popped asteroid replaces the old flat scale-up+fade with a **flash** (white core under a transient magenta glow), a **shockwave** ring, **debris** (rock shards flung out, spinning + falling), and additive **sparks**, while the rock itself snaps bigger and vanishes. Built on **one shared pair of particle emitters** (never new emitters per pop) + one transient glow; `Explosions.ts` owns it, fired via a `boom(x,y,r)` callback threaded through the `WaveDirector` into each `Asteroid.pop()`. Tuning in `EXPLOSION` (`src/layout.ts`). *(Asteroids only; boss/escort pops keep their current effect for now.)*
- **One-hit large splitters** *(B37, built 2026-08-03)*: lane rocks are either **standard** (r=13, one rocket hit, no label, 10 points) or **splitter** (r=17, one rocket hit, no label, 20 points). A rocket immediately breaks a splitter into **two standard-size, one-hit children**; the full clear is 40 points (20 + 10 + 10). Only rocket-kills split — station contact is a loss and never creates children. Children retain the self-balancing station threat: they scatter leftward, funnel toward the station, can cost a shield ring, get a brief railgun-safe spawn grace, and expire at a hard lifetime cap. They are preallocated wrappers appended to the fixed asteroid pool, retaining collision, update, homing, station-contact, and wave-clear integration; they are one-shot (no respawn) and fielded in-place via `spawnChild`. Tuning is `SPLITTER_CHILDREN` (`src/layout.ts`).
- **Wave-clear star-shower** *(B7 visual, built 2026-06-15)*: beating a wave throws a celebratory **confetti shower** — sparkles in the two player colors + accent (`COLORS.p1/p2/accent`) seeded across the field's top and raining down over the whole playfield. Fires on **every** wave clear (including the wave-4→boss hand-off, since both branches flow through the breather). Built on **one persistent shared emitter** (created once in `Explosions.ts`, never per-event — same discipline as the asteroid burst), fired via a `celebrate()` callback threaded `SandboxScene → WaveDirector → starShower()`. Tuning in `STAR_SHOWER` (`src/layout.ts`); tints sourced from `tokens.ts`. *(Audio + haptics for wave clear stay queued in B7 — this repo has no audio-asset pipeline.)*
- **Shot trail — violet exhaust + afterimage, tiered by charge** *(polish pass 2026-06-15; tiered for B13)*: each player's rocket leaves a trail drawn into one shared additive Graphics — a long faint **afterimage** light-streak over the shot's ~75-pt flight history, under a short tapered **exhaust** ribbon (glow halo → violet body → white-hot core) with a brightness **flux** scrolling down it. The head stays the player's color; the exhaust is violet (`COLORS.shieldMid`) for contrast. All filled additive quads — no postFX, no particles. **Two tiers (B13):** the full bright look is the **charged** (railgun) trail; a normal uncharged shot gets a **subdued** version (less alpha, shorter ribbon), so the in-flight trail itself reads as "this was a railgun." Tuning in `TRAIL` (`src/layout.ts`, with `chargedMul`/`normalMul` multiplier sets); built in `Rocket.ts` (`RocketPool.update`).
- **Boss command-ship presentation + shield web** *(B34, 2026-08-05)*: the finale removes the last stack of concentric boss/shield/orbit circles. The boss and escorts are station-facing angular ships; four escorts rotate as one fixed-radius diamond. Their active adjacency links render as a violet/cyan neon **shield web** and physically consume rockets, while a downed escort leaves its two sides open as a visible shoot-through gap. See §9 for the encounter rules.

## 5. Controls (implemented; playtested solo 2026-11-02)
**Two-thumb controls (#7, chosen in the controls playtest):** each seat has a FIRE button, a HOME button and an aim zone. Built in `TwoThumbControl.ts`; all geometry in `CONTROLS_V2` (`src/layout.ts`).
- **Per-seat layout:** **FIRE** (big, round) and **HOME** (smaller, beside it, a little higher and inward) sit on the **player's left**; the **aim zone** covers the **player's right** side of their band, marked by an **aim pad** (a dim disc with a ◀ ▶ hint, the aimable range as a dashed arc, and a knob pointing along the current aim). The **launcher** sits between them, where the shot leaves from, with the rocket nocked on it. **Lefty** is a per-seat option that mirrors the layout: aim zone on the player's left, buttons on their right; aim directions don't change. It's picked by URL (`?lefty=p1|p2|both|none`, linked from the prototype shelf) and remembered on the phone.
- **P1 sits at the top edge:** their whole layout is P2's rotated 180° about the field centre, so it reads right-side-up from that seat.
- **Drag aim:** put a thumb down anywhere in the aim zone (it doesn't jump the aim) and slide **sideways** to turn the aim, 0.8° per unit (~4cm sweeps the whole range). Aim is clamped to **15°–165°** from the player's right (90° = straight across at the other player) and **persists** between shots and when the thumb lifts; each run starts aimed straight across. A **dotted trajectory** of fixed length shows the aim line at all times: dim at rest, bright while the seat aims or holds a button. It's an honest preview, because there's no gravity.
- **FIRE:** press and the nocked rocket draws back; **release fires a plain shot** along the aim at a fixed speed (`SLING.maxSpeed`). **Hold `CHARGE.fullMs` (600ms) for a railgun:** a **violet charge ring** (the shield-mid / trail violet, which rhymes with the railgun trail and stays distinct from the cyan/amber player colors) sweeps clockwise round FIRE from the top as the charge climbs, and once full it **breathes** to show it's armed. Releasing early fires a plain shot. All code-drawn, orientation-neutral, no text.
- **HOME:** while held, it **rings the rock the shot would lock** along the current aim; **release fires a homing shot**. HOME **never charges**, however long it's held.
- **One button at a time:** while either button is held, a press on the other is ignored. The aim thumb works independently, so a player can hold a button and steer with the other thumb.
- **Homing lock rules (B14):** **the skill is earning the lock, not the flight.** A shot only locks the asteroid closest to its launch path, and *only if it's aimed fairly precisely at it* (a tight cone + a close pass to the rock's center), so the kid still has to point at a target. **If a homing shot locks a target it connects**: it flies straight for a beat (an obvious "smart rocket" reveal), then curves hard onto the locked rock and hits. **No lock → ordinary straight shot** (no auto-aim), and if the locked rock is destroyed mid-flight the shot just flies straight (it never re-targets a different rock).
- **Railgun rules (B13):** a full-charge shot is *not stopped by anything*: it rails straight through **every** asteroid in its path until it flies off-screen. It **chips each rock once** (one hit of `DAMAGE.railgun` per rock, 1 today like a normal shot, so 1-hp rocks pop and tough rocks chip down; it never instakills), and still **costs only 1 ammo**. Pierce is an **asteroid-only** behavior: against an escort a railgun is an ordinary single hit. A shot is never both railgun and homing (FIRE charges, HOME doesn't).
- **Boss rule (B33, reworked by B34):** a railgun is the **only** rocket that damages the boss, and only by travelling through a shield-web gap (§9). HOME never charges, so homing helps against escorts only.
- **Ammo:** each shot costs 1; up to 5 per player, regenerating 1 per second. Out of ammo, the nocked rocket dims and a release fires nothing.
- **Per-player HUD** shows WAVE, SCORE (the shared score, built in B6, §3) and AMMO. It sits in the centre column **under each launcher, between HOME and the aim pad** (shifted to clear the mirrored buttons on a lefty seat); P1's is rotated 180°.
- Both players aim and fire **simultaneously**, two thumbs each; every touch belongs to the seat whose control it lands on.
- **Haptics (#3):** every shot fired buzzes by kind: **railgun 40ms > homing 25ms > plain 20ms**. FIRE also gives **one 20ms tick per hold** the moment it's fully charged *with ammo to fire* (no "ready" tick for a release that would fire nothing). It's feature-detected, so it's a silent no-op where `navigator.vibrate` doesn't exist (iPhone), and it's skipped until the page has had a tap. On Android it only works with the phone's **Settings → Sound & vibration → Vibration & haptics → Touch feedback** turned on; otherwise Chrome silently ignores `navigator.vibrate`. Dials are `HAPTICS` in `src/layout.ts`; code in `src/haptics.ts`.

## 6. Co-op dynamic (principles)
- Two launchers, **one shared station, one shared score**.
- **The whole field is shared.** Each player naturally tends their near half, but either can fire anywhere — so the parent quietly cleans up what the 5-year-old misses. Layout decisions must protect this (it's what killed v4).
- **Leading a moving target is the core skill** — satisfying for an adult, hard at 5. **Homing (B14, §5) is the shipped fairness lever for the 5yo:** HOME is a button **both players always have**, so the 5yo can earn a lock instead of leading the target, while plain and railgun shots still ask for the lead. Further backups (a slower lane, telegraphed shots) stay queued as backlog B8.

## 7. Difficulty (the budget model — Playtest 2/3, 2026-06-06/07)

Difficulty is tuned against **one scalar**, not five raw variables:

> **required team damage/s = threat − leak**, where
> threat = Σ over live lanes of `clear damage × speed ÷ travel distance` (accurate damage/s the field demands, sustained), and
> leak = `1 ÷ shield-regen interval` (the miss rate the regenerating shield forgives forever).

**Damage, not hits (asteroid health, 2026-11-01).** Each asteroid kind has an `hp` (`ASTEROID_KIND`, **1 for both standard and splitter**) and pops once a hit takes it to 0; each shot deals damage from the `DAMAGE` table in `src/waves.ts` — **`normal: 1, homing: 1, railgun: 1`**, the dial for future shot types. A rock's *clear damage* is its hp plus, for a splitter, the hp of its two standard children (1 + 2 × 1 = 3). Because every shot is 1 damage today, damage/s equals the old hits/s and **no solver output, target, or calibration below changed**. A rock with max hp > 1 (none in the run today; `AsteroidSpec.hp` overrides it for tests/tuning) shows code-drawn cracks that step up as it loses hp, plus a brief white flash on each non-lethal hit.

Precedent: MMO DPS-checks/enrage timers, tower-defense threat-vs-defense throughput, Schreiber & Romero's *Game Balance*.

**The scalar is the input, not a knob (Playtest 3, 2026-06-07).** A wave is defined by its **target** `required` damage/s; a **solver** (`solveWave` in `src/waves.ts` — the one file that holds all the difficulty dials) realizes it by moving knobs in a fixed **priority order until threat hits the target**:

1. **Count** — fill lanes from a floor of **3** (the always-on "minimum asteroid rate": lots of weak targets) toward 4.
2. **Speed** — raise the speed scale.
3. **Splitters** — replace standards with a one-hit splitter (r=17); its split plus two children cost 3 required damage, so this is the last, most demanding lever.

Among the many knob combos that hit any given number, the priority order is the **kid-friendly tiebreaker** — the taste the raw scalar can't encode. So low waves are *many weak slow* rocks, not few tough fast ones. Caveat: the count floor has its own minimum threat (~0.05 net), so very low targets can't go lower (the dev boot log prints **target vs achieved + the chosen tier** so any gap is visible). The run is one table, `RUN` in `src/waves.ts`, alongside the model and solver. Each row is a wave's act, kind (`asteroid`, `ship`, `monster`, `boss` or `finale`), which boss it is, and, for every wave the solver plays, a `field` of `{ required, quota, shieldRegenMs }`. All the run's dials live there, so each act's issue retunes its waves in one place.

**How the solver applies to each kind:** asteroid waves, the finale, and every placeholder (ship and monster waves, the giant-asteroid and monster bosses) are solver fields: the target is realized as an asteroid field by the waterfall above. When an act's issue builds its real enemies, that kind gets its own way to realize the same target. The command-ship boss isn't solved: it has no field and is tuned by its own `BOSS` dials (§9).

- **Current run targets** (#24, 2026-11-03; required damage/s · quota · shield regen s): W1 0.30·8·10 · W2 0.45·10·11 · W3 0.60·12·13 · W4 0.45·10·11 · W5 0.60·12·13 · W6 boss · W7 0.60·12·13 · W8 0.75·14·15 · W9 0.75·14·15 · W10 0.90·24·8. Each act eases back a step from the last one's peak, then climbs. Act 1 keeps the calibrated B37 values; the rest are placeholders, revisable in playtest. On the B37 calibration W1 solves to 1 splitter and W2/W3 to 2, all four lanes at ×0.85; 0.75 solves to 3 and the finale to all 4. Use that record before any retune. The final solver tier is standard → splitter only: it never generates a 3-hit rock. Two-hit rocks for wave 2 are #25's. **The "slow rocks" gentle lever is gone from W1**: the 5yo's cushion is homing (B8/B14), not speed. If W1 plays too steep for him, soften its target toward ~0.25 rather than reintroducing slow lanes.
- Ammo regen is global (1 shot/s/player) — it deliberately does not escalate.
- Known limits of the scalar (judgment stays on top): per-hit aim difficulty of small/fast rocks, and burst overlap at the shield.
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
  inward or outward, and every ship points at the protected station.
- **Damage + urgency:** the boss itself has **no shield ring or exposed state**. It always
  takes one HP from a **charged railgun** that physically reaches it through a web gap;
  ordinary rockets still do no damage. Each escort kill resets the charge and the charge
  **pauses while any escort is down**, resuming only when all four have returned.
- **Readout = two vertical gauges** in the band to the boss's right, off its body so the
  center stays uncluttered: a green **health** bar (heart-capped) and a magenta **charge**
  bar (bolt-capped). Both fill bottom-up and carry their icon at **top and bottom** so
  either seat reads them at a glance (icon recognition, no reading).
- **If the charge fills first:** the boss **fires** a beam that **shatters a shield
  ring** (reusing the station shield + regen), then resets the charge; live escort lock
  progress remains in place.
- **Win:** chip the boss's 10 HP through successive web gaps. The boss, escorts, web and
  gauges leave the field and the run goes on: breather, then wave 7 (§3).
  **Loss:** a charge fires with the shield already gone → **"Try again?"**, which restarts
  act 2 at wave 4 (§3).

- **Each escort is a directional ship with two player-color lock fins:** one cyan P1 and
  one amber P2. It needs **one rocket from each player**, in either order; a duplicate hit
  is consumed but rejected. The matching fin breaks on a successful hit and the remaining
  fin pulses in its player color, silently showing whose shot is needed next. They're pure
  gating targets; partial locks survive a boss beam and a timed regeneration restores both locks.
  The locked visual source is `prototype/reference/escort-coop-lock.html`.
- **Urgency = the charge bar racing you; co-op = both kids must contribute** to every one
  of the four escorts. **No asteroids** during the boss. Homing locks live escorts; it remains
  charge-exclusive, so it does not damage the railgun-only boss.
- **Tuning:** `src/waves.ts` `BOSS` holds the dials — `chargeMs` (time to open a gap
  before the boss fires), `escortRegenMs` (gap duration), `hp`, `escortCount`,
  `shieldRegenMs`. Boss/escort positions, sizes, orbit, web width (`escort.webWidth`), and
  entrance speed live in `src/layout.ts` `BOSS_LAYOUT`. The one-hit-from-each-player lock
  rule is fixed in `Escort.ts`, not a balance dial. Boss HP remains 10 and railgun timing
  is unchanged; the escort charge race remains 5 seconds.

## Not built yet
Everything planned but not built is a GitHub issue. The colony-ship campaign (#30) is the current vision, with one sub-issue per piece. A section here changes only when the issue that changes it is finished.
