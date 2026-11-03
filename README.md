# Star Slingers

A two-player co-op space defense for one phone laid flat between the players.
Each seat has two-thumb controls: drag on the right to aim, hold FIRE (charge
for a railgun) or HOME (a homing shot) on the left. The design lives in
`docs/design.md`; all colors/fonts live in `src/tokens.ts`.

Layout and palette are ported 1:1 from
`plans/mockups/style-wireframe.html` (canonical v3) +
`tokens-wireframe.css`.

## Run

```sh
npm install
npm run dev        # serves on http://localhost:5173 (and your LAN IP)
```

Desktop check (mouse = one pointer, so no aiming while a button is held):
drag sideways on a seat's right side to aim, then click FIRE or HOME to shoot.
Ammo regens 1 per second up to 5.

## Phone testing (Pixel 6)

1. `npm run dev` — Vite prints a `Network:` URL like `http://192.168.x.x:5173`.
2. Open that URL in Chrome on the phone (same Wi-Fi).
3. First run: Windows may prompt to allow Node through the firewall — allow it
   on **Private** networks. If the phone still can't connect, add an inbound
   allow rule for TCP 5173.
4. Lay the phone flat: P1 plays from the top edge (their controls and HUD
   are upside-down on purpose), P2 from the bottom. Both seats must work with
   all four thumbs at once, with no page scroll, zoom, or stuck buttons.

## Live links

- [Play Star Slingers](https://michac.github.io/star-slingers/)
- [Jump straight to the boss](https://michac.github.io/star-slingers/?boss): the command ship, wave 6. Useful for phone testing the fight; the normal link still starts a full run. `?wave=N` jumps to any wave (1–10).

## Scripts

- `npm run dev` — dev server (LAN-exposed)
- `npm run build` — `npm run typecheck` (game + `e2e/`) + production bundle
- `npm run typecheck` — `tsc --noEmit` only, over the game and (via `tsconfig.e2e.json`) `e2e/` +
  `playwright.config.ts`
- `npm test` — `@playwright/test` suite, one spec per area in `e2e/` with a shared `e2e/helpers.ts`
  (auto-starts the dev server headless on :5181 and asserts combat / waves / boss / solo / controls /
  haptics + zero console errors). First run on a new machine: `npx playwright install chromium`.
