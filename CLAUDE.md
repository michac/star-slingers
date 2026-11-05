# Star Slingers — orientation

A two-player phone game for Michael + his kids (5yo and 9yo), built for a Pixel 6 laid flat
between players, arcade-table style. **Star Slingers** is a co-op slingshot space defense:
both players guard a colony fleet and fling rockets at incoming waves.

This repo is the game and its design record — nothing else.

## Where truth lives (read in this order)

| File | Role |
|---|---|
| `docs/design.md` | **The game as built**, with the reasons behind it |
| [GitHub Issues](https://github.com/michac/star-slingers/issues) | **Work not built yet**: the vision (#30, colony-ship campaign) and one issue per piece, with acceptance criteria and open questions |
| `docs/notes.md` | History: playtests, layout lineage (v0→v5), decisions-with-reasons, and the archived B1–B40 backlog |
| `docs/tech-stack.md` | Tech decisions (Phaser 3 + TS + Vite) and mock conventions |
| `plans/polish-pass.md` | **Visual/UI decisions from prototyping** — staged to apply to the game in one pass |
| `plans/mockups/layout-colony-ship.html` | Canonical layout mock (**v6**: colony fleet + enemy lane) |
| `src/` | The game source |

## Code shape (`src/`)

- `tokens.ts` — **every color & font comes from here.** Don't hardcode; restyle = edit this file.
- `layout.ts` — geometry/positions/sizes · `waves.ts` — wave & difficulty tuning (the dials).
- `objects/` — one class per game thing (Fleet, Asteroid, TwoThumbControl, …) · `scenes/` — the
  orchestrating scene · `main.ts` — Phaser bootstrap.
- Art is **code-drawn** (procedural textures in `objects/textures.ts`), not loaded asset files. Sound
  is **code-synthesized** the same way: `sfx.ts` plays the Web Audio recipes in `sfxRecipes.ts`, and
  game code calls `sfx.play('<name>')`, one line per site.

## Dependencies — where to look before deciding how to use an API

**Version-exact local copies in `node_modules/` are the ground truth.** Look there before the web
or memory: these majors may be newer than an agent's training, and the web defaults to other
versions. Exact installed versions are in `package-lock.json` (check with
`node -p "require('phaser/package.json').version"`). A fresh worktree has no `node_modules`, so run
`npm ci` first.

| Package (installed) | Types — grep, don't read whole | Source / extras | Web |
|---|---|---|---|
| **phaser 3.90.0** (runtime) | `node_modules/phaser/types/phaser.d.ts` (~119k lines, full JSDoc) | `node_modules/phaser/src/<area>/` (e.g. `gameobjects/particles/`, `physics/arcade/`, `tweens/`); release notes in `node_modules/phaser/changelog/3.90/` | Source at tag [`v3.90.0`](https://github.com/phaserjs/phaser/tree/v3.90.0); examples at [phaserjs/examples](https://github.com/phaserjs/examples) |
| **typescript 6.0** | `node_modules/typescript/lib/*.d.ts` | — | typescriptlang.org |
| **vite 8.3** (dev server, build, `prototype-gallery` plugin in `vite.config.ts`) | `node_modules/vite/types/`, `node_modules/vite/dist/node/index.d.ts` | — | vite.dev (tracks the latest major) |
| **@playwright/test 1.64** (e2e) | `node_modules/playwright/types/test.d.ts` (runner), `node_modules/playwright-core/types/types.d.ts` (Page/Locator API) | — | playwright.dev |

**⚠ Phaser 4 trap.** This game is on **Phaser 3** (3.90, the final v3 line). `docs.phaser.io`'s
API docs now default to **Phaser 4.x**, and many current tutorials and examples are v4. The v4 API
differs: the renderer, FX/filters and some game-object APIs changed. Treat any web Phaser snippet as
suspect until the symbol is confirmed in the local `phaser.d.ts`. Don't upgrade Phaser as a side
effect of a fix.

**Lookup recipe:** `grep -n "class ParticleEmitter" node_modules/phaser/types/phaser.d.ts` to find
the declaration and its JSDoc, then read the matching file under `node_modules/phaser/src/` for real
behaviour. This repo's own `src/` is the best example of house patterns (pooling, code-drawn
textures, tokens).

**Phaser 3.90 behaviours we've already hit** (details in `docs/notes.md`):
- `TweenManager` runs on **wall-clock time**, so it doesn't advance under the test suite's manual
  `scene.update()` stepping. That's why the boss slide-in needs `__debug.snapBossIn()`.
- `game.step()` **renders** a frame, which is slow under headless swiftshader. Step with
  `scene.update(t, dt)` instead.
- `postFX` can be undefined under headless software WebGL, so guard it with `?.`. Keep glow
  `quality` around 0.3: sharper lagged the Pixel 6.
- An Arcade collider binds to the sprites that exist when it's built. Mutate pooled wrappers in
  place; never recreate them, or the collider silently stops firing.
- Probe collisions through **one real step**, never right after a spawn or fire. `Body.reset()`
  sets `prev`/`prevFrame` from the *rotated* top-left, and Arcade syncs the sprite to its body only
  in `postUpdate`, so during `scene.update` `rocket.x/y` is still the frame-start position. A probe
  taken straight after `fire()` measures that reset state, not real flight (#8).

## Working agreement

- **Change flow:** Michael lists wants → each is recorded as a GitHub issue (assigned to Michael)
  before work starts → worked one at a time, or batched (the `coordinate-github-issues` skill runs
  several in parallel). Decisions made before building go into the issue body (acceptance criteria,
  answered open questions); chat-only decisions don't count as recorded. Issue labels carry status
  (`status: idea`, `status: partly done`, `status: done`). New work is named by issue number; the
  B-numbers in older docs and comments point at the archive in `docs/notes.md`.
- **Finishing an issue includes syncing `docs/design.md`** (rewrite the sections it changes, in
  place) and appending a line to `docs/notes.md`. Then close the issue. `docs/design.md` describes
  only what's built, so it must never drift from the game.
- **Push and deploy to wrap up an item, without asking.** This is a personal project whose only
  user is Michael. Once an item's change is committed and verified, push the branch you're on and
  run its deploy: `npm run deploy:preview` for a working branch such as `controls-v2`, or
  `npm run deploy` on `main`. Still ask first before merging one branch into another (for example
  `controls-v2` into `main`), before any force-push or remote branch deletion, and before running
  `wrangler deploy` / `wrangler versions deploy` by hand.
- **Docs state what's true now; only `docs/notes.md` keeps history.** When a decision changes,
  rewrite the old text in place so it says the new thing. Don't add a correction further down
  ("update: actually…", "superseded by…") and leave the stale sentence standing. A reader who stops
  early would act on it. This applies to `design.md`, issue bodies, `polish-pass.md`, this file
  and code comments. The story of what changed and why belongs in `notes.md`.
- Issues labelled `draft` are unreviewed or largely undecided material — raw ideas to react to,
  not decisions. Don't build them as-is without review.
- **Mockups:** geometry lives in the HTML, paint in `tokens-<style>.css`; superseded mocks move
  to `plans/mockups/shelved/` (use `../shared/` asset paths there). **Neon** is the chosen skin —
  its live palette is `src/tokens.ts`.

## Kid-design constraints (apply to everything)

- No reading required; letter/number *recognition* is fine (ammo counts, scores, hit counts).
- Each player owns their own screen region — don't make fingers cross or overlap.
- Lean co-op; gentle fail states ("Try again?", never a scary game-over).

## Game commands (from the repo root)

- `npm run dev` — dev server, LAN-exposed for phone testing (see `README.md` for firewall notes)
- `npm run build` / `npm run typecheck` — `typecheck` runs `tsconfig.json` (browser code: `src/`,
  `prototype/`, no Node types) and `tsconfig.node.json` (root config + `types: ["node"]`: `e2e/`,
  `playwright.config.ts`, `vite.config.ts`). `src/no-node-globals.ts` is never imported; it is the
  guard that fails `typecheck` if Node types reach the root config. `build` runs `typecheck` first,
  so CI and both deploy pre-flights check all of it.
- `npm test` — `@playwright/test` suite, one spec per area in `e2e/`: `combat.spec.ts` (boot, hits,
  score, FIRE damage + charged pass-through, the SPECIAL missile, splitters, hp), `waves.spec.ts` (the 10-wave `RUN` table and its
  play order and ship-wave dials, the act-transition flyby, `?wave=N`, Try again's act-start retry, the solver, solo target scaling), `boss.spec.ts`
  (co-op escort locks, shield web, the beam's crosshair and drop, `?boss`), `ships.spec.ts` (act 2's enemy
  ships: dispatch, roam bounds + shot warning, bolts vs the fleet, re-targeting, the bubble rule, missiles,
  the quota flow and fail card), `giant.spec.ts` (the wave-3 giant asteroid: charged-only
  and paired-in-co-op damage, no SPECIAL hurts it, the fleet wipe, the burst, its clear and pod drop), `join.spec.ts` (the join screen: join, Easy/Normal,
  countdown, leaving, Easy's unlimited ammo, Try again keeps the lineup, a win returns to it),
  `fleet.spec.ts` (the colony fleet: sublane contact, harmless pass, all-four-lost fail, shield regen + rebuild,
  sublane spawn spread, splitter children in the lane, the starfield), `solo.spec.ts` (one joined seat), `controls-v2.spec.ts` (two-thumb buttons + drag aim, the two ammo pools),
  `upgrades.spec.ts` (boss upgrade pods, the SPECIAL swipe between modes, triple missile, detonator, Try again's kept
  specials), `haptics.spec.ts` and `sfx.spec.ts` (each game event requests its sound, read from `window.__sfx.log`;
  the join screen's speaker toggle; no AudioContext before the first tap). The shared harness is `e2e/helpers.ts`: `gotoGame` (by default it skips the
  join screen with both seats Normal; pass a lineup, or `'join'` to stop on it), `stepGame`/`stepUntil`, `fieldRock`, `enterBoss`,
  `loseRun`/`tryAgain`/`winToFreshRun`, `debug`, `clearGiantField`,
  the `__debug` wrappers (e.g. `shieldLinks`), `mirrored` for the top seat and the CDP `touchscreen`.
  Its exported `test` carries the zero-console-error gate as an auto fixture, so **specs import
  `test`/`expect` from `./helpers`, never from `@playwright/test`**
  (`harness.spec.ts` fails the suite if one does).
  A helper used by more than one spec goes in `helpers.ts`; a new case goes in its area's spec. The
  suite auto-starts the dev server headless on :5181 and drives real touches + direct shots. First
  run on a new machine needs `npx playwright install chromium`.
  **The interaction cases** (hits, score, missile, pass-through, split, boss) don't wait for a wave rock to
  drift on-screen — they **field a rock directly** via `reconfigure()`/`spawn()` (`fieldRock`: stationary by
  default, or drifting left at a given `speed`) and drive
  a **fixed 16ms timestep** through `window.__game` (`stepGame()`: `loop.sleep()` + manual
  `scene.update(t, dt)` — physics/overlaps/timers advance in lockstep, no render, no wall-clock
  racing; `stepUntil()` runs the whole step loop **in one page.evaluate**, so a 200-frame window costs
  one CDP round-trip, not one per frame). This sidesteps the ~10× headless game-time skew that made
  the old wall-clock waits flaky (B36); the suite is green on `--repeat-each=5`. NB Phaser's
  TweenManager is **wall-clock driven** and does *not* advance under stepping, so the boss slide-in is
  skipped with the `__debug.snapBossIn()` hook, which `enterBoss()` wraps. **Speed** (~1.2 min for the
  120 cases): headless swiftshader makes rendering pathologically slow,
  so (a) the `smoke-*.png`
  eyeball frames are **opt-in** (`SMOKE_SHOTS=1 npm test`) — a screenshot is a ~7s ReadPixels render —
  and (b) `gotoGame()` **parks the RAF loop right after boot**, because any `page.evaluate` that runs
  against a live render loop stalls ~0.8s on the in-flight software frame (this alone took the boss case
  8s→1.7s). Parallel workers do *not* help — the one software-GL context is the bottleneck — so the
  config stays `workers: 1`.
- `npm run deploy` — **commit first** (it refuses a dirty tree), then it pushes `main`, watches the
  `deploy-pages.yml` Action, and verifies the live URL. **GitHub Pages is the only host for `main`**
  (https://michac.github.io/star-slingers/); the same Action also deploys a PR merged on GitHub.
  Cloudflare is for branch previews only (below). Needs `gh` authed and a GitHub remote with Pages
  enabled. Docs-only commits (`docs/**`, `plans/**`, `*.md`) don't deploy.
- `npm run deploy:prototype` — ship the **prototype shelf** (`prototype/` → `…/prototype/`) for
  remote review. Unlike `deploy`, it commits `prototype/**` itself and tolerates other in-progress
  edits — an automated path to push review artifacts (glow spikes, sketches) to Michael's phone.
  Drop a `prototype/<name>.html` (+ `.ts`) and it auto-lists on the shelf (see `prototype/README.md`).
- `npm run deploy:preview` — upload the **current branch** as a **Cloudflare Workers preview**
  (`wrangler versions upload --preview-alias <branch>`), so a long-lived branch such as `controls-v2`
  gets its own installable phone URL beside the stable game. It never changes production (Pages). The
  Worker's own workers.dev URL is not maintained: it's frozen at an old `main` and nothing updates
  it, so don't install or test from it. It tolerates a dirty tree and tags the version `branch@sha[-dirty]`. Config is in
  `wrangler.jsonc`. The Worker is named `star-slingers` and **shares a Cloudflare account with the
  card-games Worker, so never reuse that name.** Keep Cloudflare's default HTML handling: `/` and the
  `/prototype/` shelf need it, and it's safe only because `public/sw.js` never precaches HTML or caches
  a redirect (the WebKit/iOS service-worker pitfall is explained in `wrangler.jsonc`). Do the
  first-ever upload by hand with `npx wrangler deploy`, because the Worker has to exist before it can
  take previews.

> Note: this repo split off from a multi-game hub; deploy scripts assume a GitHub remote named for
> this repo with Pages turned on. Set the remote up before the first `npm run deploy`.
