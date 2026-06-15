# Prototype shelf → `/prototype/`

A place to push **review artifacts** — glow spikes, layout sketches, FX tests —
that aren't the game. Lands at `…/star-slingers/prototype/` on GitHub Pages
so Michael can review from his phone even when he's not local.

## Drop a new experiment

1. Add `prototype/<name>.html` (one dir deeper than the game, so assets are
   `../fonts/…`, `../icons/…`). Its `<title>` becomes the shelf label.
2. Put any TS beside it (`prototype/<name>.ts`) and load it with a relative
   `<script type="module" src="./<name>.ts">`. Import real game modules from
   `../src/…` to test against live values (see `glow-lab.ts`).
3. That's it — `vite.config.ts`'s `prototype-gallery` plugin auto-adds it to the
   shelf index and the multi-page build, no wiring needed.

## See it / ship it

- **Local:** `npm run dev` → `/prototype/` (LAN-exposed for the Pixel 6).
- **Build check:** `npm run build` (typechecks + bundles every shelf page).
- **Ship for remote review:** `npm run deploy:prototype` — commits just
  `prototype/**`, pushes, watches the Pages deploy, prints the `/prototype/` URL.
  Tolerates other in-progress (non-prototype) edits; they stay local.

## Notes

- `prototype/**` is typechecked by `tsc` (in `tsconfig.json` `include`) — keep
  experiments compiling or they block the build.
- Screenshots (`glow-lab.png`) are gitignored. `glow-shot.mjs` grabs one headless.
- Prototypes ride the same single Pages artifact as the game; pushing the shelf
  redeploys the whole site.

## Locking a design → `reference/`

When a prototype's design is agreed, move it into `prototype/reference/` (one dir
deeper, so assets become `../../fonts` and imports `../../src/…`). It then lists
under **Locked references** on the shelf instead of the open experiments, signalling
"this is the spec to match when we build it into the game," not an open question.
The build picks `reference/*.html` up automatically. Point `polish-pass.md` at it.
