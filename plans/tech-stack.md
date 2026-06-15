# Tech Stack & Mock Conventions

> Decisions made 2026-06-05. Revisit if a game outgrows them.

## Game runtime: Phaser 3 + TypeScript + Vite

**Decision:** all three build as web games (PWA) on Phaser 3, TypeScript, Vite.

**Why:**
- Runs install-free in Chrome on the Pixel 6 — open a LAN URL or add-to-homescreen. Fastest possible iteration loop with a 5-year-old playtester.
- Multitouch, sprites, particles, tweens, sound, and scenes built in.
- Arcade physics covers slingshot arcs and collisions (Star Slingers); the Matter.js physics option covers bounce-off-a-drawn-line (Draw-a-Line Hockey).
- Same browser + CSS-pixel coordinate space as the HTML mocks (Pixel 6 ≈ **412 × 915** CSS px portrait), so layout and color tokens port directly.

**Rejected:** Godot 4 (better editor/APK export, but heavier build-sideload loop — overkill at this scale); vanilla canvas + matter.js (reinvents particles/scenes/input/audio).

## Wireframe / UI-mock framework: structured HTML + SVG

Mocks stay HTML/SVG — but under a convention. **Hard rules:**

1. **No inline styles.** All styling lives in CSS files.
2. **No per-mock JavaScript.** The single shared `mock.js` (label toggle) is the only script.
3. **Semantic markup + SVG for game art.** Each mock is a thin HTML file: layout skeleton + SVG elements, target ~150 lines.
4. **Colors and effects come only from tokens.** Each style variant defines a `tokens-<style>.css` (CSS custom properties: palette, fonts, glow/stroke/shadow recipes). The winning variant's token file becomes the game's design constants.
5. **One layout, many skins.** Style-exploration mocks must all use the same layout skeleton (`_layout-skeleton.html`) so variants differ *only* in style. Layout changes are a separate kind of mock, versioned (v1, v2, …) like the originals.

### File layout (per game)

```
plans/<game>/mockups/
├── shared/
│   ├── mock.css              ← phone frame, annotation labels, shared motion
│   └── mock.js               ← label toggle only
├── style-wireframe.html      ← canonical layout skeleton (neutral gray skin);
│                               every style variant is a copy of this file
├── tokens-wireframe.css      ← the theming API: variables + paint rules
├── tokens-<style>.css        ← one per style variant (same rules, new values)
├── style-<style>.html        ← one per style variant
└── ui-mock-v1.html, ...      ← frozen pre-convention mocks, kept as reference
```

Variant rules: copy `style-wireframe.html`, swap the tokens `<link>`, re-skin freely
*inside* the `slot-*` groups (adding `<defs>` is fine) — but keep slot transforms,
class hooks, and the annotation block untouched so layout parity holds.

### Viewing

Open any mock in a desktop browser (it renders inside a Pixel-6-proportioned frame), or serve the folder (`python -m http.server` / `npx serve`) and open on the phone itself for the real-feel check.

## Mock → game pipeline

1. Style mocks (one per candidate direction) → pick a winner on the actual phone.
2. Winner's `tokens-<style>.css` is promoted to the game's palette/constants.
3. Layout questions get their own versioned mocks before touching game code.
