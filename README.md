# Star Slingers — Sling-Feel Sandbox

First playable slice: two abstract sling controls (anchor dot + pull-range
arc), pooled rockets, drifting dummy asteroids with hit counts, and per-player
ammo. No station/shield/waves/score yet — this build exists to nail the touch
feel. Wireframe skin; all colors/fonts live in `src/tokens.ts` and get swapped
for the winning style variant later.

Layout and palette are ported 1:1 from
`plans/mockups/style-wireframe.html` (canonical v3) +
`tokens-wireframe.css`.

## Run

```sh
npm install
npm run dev        # serves on http://localhost:5173 (and your LAN IP)
```

Desktop check: drag from either anchor dot (mouse = one sling at a time),
release to fire. Asteroid numbers count down per hit; rocks pop and respawn
off the right edge. Ammo regens ~1 per 1.5 s up to 5.

## Phone testing (Pixel 6)

1. `npm run dev` — Vite prints a `Network:` URL like `http://192.168.x.x:5173`.
2. Open that URL in Chrome on the phone (same Wi-Fi).
3. First run: Windows may prompt to allow Node through the firewall — allow it
   on **Private** networks. If the phone still can't connect, add an inbound
   allow rule for TCP 5173.
4. Lay the phone flat: P1 plays from the top edge (their ammo readout is
   upside-down on purpose), P2 from the bottom. Both slings must work with
   two fingers at once, with no page scroll, zoom, or stuck slings.

## Scripts

- `npm run dev` — dev server (LAN-exposed)
- `npm run build` — typecheck + production bundle
- `npm run typecheck` — `tsc --noEmit` only
- `npm test` — `@playwright/test` suite (auto-starts the dev server headless on :5181 and asserts
  hits / score / homing / pierce / split / boss-cycle + zero console errors). First run on a new
  machine: `npx playwright install chromium`.
