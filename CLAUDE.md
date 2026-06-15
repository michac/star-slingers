# Star Slingers — orientation

A two-player phone game for Michael + his kids (5yo and 9yo), built for a Pixel 6 laid flat
between players, arcade-table style. **Star Slingers** is a co-op slingshot space defense:
both players man a shared station and fling rockets at incoming waves.

This repo is the game and its design record — nothing else.

## Where truth lives (read in this order)

| File | Role |
|---|---|
| `plans/spec.md` | **Current reviewed design** — only worked-out, reviewed decisions |
| `plans/backlog.md` | **Work queue** — record changes here BEFORE working them |
| `plans/notes.md` | History: playtests, layout lineage (v0→v5), decisions-with-reasons |
| `plans/polish-pass.md` | **Visual/UI decisions from prototyping** — staged to apply to the game in one pass |
| `plans/mockups/layout-edge-wireframe.html` | Canonical layout mock (**v5**: compact edge station + funnel) |
| `plans/tech-stack.md` | Tech decisions (Phaser 3 + TS + Vite) and mock conventions |
| `src/` | The game source |

## Code shape (`src/`)

- `tokens.ts` — **every color & font comes from here.** Don't hardcode; restyle = edit this file.
- `layout.ts` — geometry/positions/sizes · `waves.ts` — wave & difficulty tuning (the dials).
- `objects/` — one class per game thing (Station, Asteroid, SlingControl, …) · `scenes/` — the
  orchestrating scene · `main.ts` — Phaser bootstrap.
- Art is **code-drawn** (procedural textures in `objects/textures.ts`), not loaded asset files.

## Working agreement

- **Change flow:** Michael lists wants → recorded in `plans/backlog.md` as numbered items → worked
  one at a time (or batched into a workflow when several are big and independent).
- **Finishing an item includes syncing `plans/spec.md`** and appending a line to `plans/notes.md`.
  The spec must never drift from decisions again; chat-only decisions don't count as recorded.
- Backlog items tagged `[draft]` are unreviewed auto-generated material — raw ideas to react
  to, not decisions. Don't build them as-is without review.
- **Mockups:** geometry lives in the HTML, paint in `tokens-<style>.css`; superseded mocks move
  to `plans/mockups/shelved/` (use `../shared/` asset paths there). **Neon** is the chosen skin —
  its live palette is `src/tokens.ts`.

## Kid-design constraints (apply to everything)

- No reading required; letter/number *recognition* is fine (ammo counts, scores, hit counts).
- Each player owns their own screen region — don't make fingers cross or overlap.
- Lean co-op; gentle fail states ("Try again?", never a scary game-over).

## Game commands (from the repo root)

- `npm run dev` — dev server, LAN-exposed for phone testing (see `README.md` for firewall notes)
- `npm run build` / `npm run typecheck`
- `node smoke.mjs` — headless boot/interaction smoke check (writes ignored `smoke-*.png`)
- `npm run deploy` — **commit first** (it refuses a dirty tree), then it pushes `main`, watches the
  `deploy-pages.yml` Action, and verifies the live URL. Needs `gh` authed and a GitHub remote with
  Pages enabled. Docs-only commits (`plans/**`, `*.md`) don't trigger a deploy.
- `npm run deploy:prototype` — ship the **prototype shelf** (`prototype/` → `…/prototype/`) for
  remote review. Unlike `deploy`, it commits `prototype/**` itself and tolerates other in-progress
  edits — an automated path to push review artifacts (glow spikes, sketches) to Michael's phone.
  Drop a `prototype/<name>.html` (+ `.ts`) and it auto-lists on the shelf (see `prototype/README.md`).

> Note: this repo split off from a multi-game hub; deploy scripts assume a GitHub remote named for
> this repo with Pages turned on. Set the remote up before the first `npm run deploy`.
