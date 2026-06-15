# Visual / UI Polish Pass — decisions from prototyping

> **What this is.** A holding pen for UI/visual decisions reached while prototyping
> on the shelf (`star-slingers/prototype/`), so we can apply them to the game in
> **one focused pass** instead of churning `Station.ts` et al. piecemeal.
>
> **The approach (in flight).** We're building each effect as a prototype on the
> shelf, iterating on the phone, then **locking** the agreed one into
> `prototype/reference/` as its spec. When the list is done, we make a single pass
> through the game to port them all. **Ported into the game (2026-06-15, one pass):**
> shields, explosion, shot trail (all `done` below). **Up next:** nothing queued —
> pick the next effect when ready.
>
> **Status key:** `queued` (next to prototype) · `prototyped` (on the shelf, in
> review) · `locked` (agreed, archived to `reference/` as the spec) · `building` ·
> `done` (in the game + spec/notes synced).
>
> Nothing here is in the live game until it says `done`. When an item ships, fold
> it into `spec.md`, append to `notes.md`, and resolve its `backlog.md` item.

---

## Shields — glow + pulse (B22 + B23) — `done` (2026-06-15) ✅

**The reference IS the prototype — match it exactly, numbers and all:**
> 📌 `star-slingers/prototype/reference/shield-pulse.ts`
> (live: [`/prototype/reference/shield-pulse.html`](https://michac.github.io/star-slingers/prototype/reference/shield-pulse.html) — tap to take a hit)

The goal Michael set: rings must read as **energy shields, not a solid object**.
The prototype is the spec; the build pass just ports it. In one breath: rings
**breathe** (color brightness 0.6→1.0, **full opacity**), **flow** outer→inner
(phase offset per ring), under an outer **glow** that hugs + recolors to the
outermost remaining ring; a destroyed ring **flares then fades**.

**Two hard-won constraints baked into that file — don't regress them:**
- **Pulse COLOR brightness, never alpha.** A thick semi-transparent stroked circle
  overlaps itself at its tessellation joins; the doubled alpha shows as faint radial
  "grid" spokes. Opaque strokes are clean (and cheaper).
- **Perf first.** No DPI rendering, glow `quality` stays **0.3**. We tried sharper
  (DPR render + quality 0.6) — it lagged the Pixel 6. Smoothness yields to framerate.

**Build target — `src/objects/Station.ts`:** split the rings out of the hull
`Graphics` into their own per-frame layer; drive color brightness from the sine
(flow offset by ring index); add the ambient `postFX.addGlow` recolored/resized to
the outer ring; replace `shatterRing` with the flare-then-fade. Ties off backlog
**B22** (glow) + **B23** (pulse); the destroy-flare is the shield cousin of **B29**.

---

## Rendering — high-DPI: tried, reverted (too costly) — `rejected for now` (2026-06-12)

The game renders at the **logical** size (≈360×720) and lets `Scale.FIT` CSS-stretch
it up — on a Pixel 6 (DPR ≈ 2.6, ~1080px wide) that's a ~3× upscale, so edges soften
on-device even when crisp in a desktop capture. We tried rendering at the device
pixel ratio to sharpen it. The recipe **works** (keeps logical coords):

```
const DPR = Math.min(window.devicePixelRatio || 1, 3);
// config: scale.width = W * DPR, scale.height = H * DPR  (bigger draw buffer)
// in create(): camera.setZoom(DPR); camera.centerOn(W / 2, H / 2);
//   ^ centerOn is required — zoom pivots on the canvas center, not the world
//     origin, so without it everything flies off-screen (learned the hard way).
```

…but at ~7× the pixels it **lagged the Pixel 6**, especially with the glow on every
frame. **Reverted** — smooth framerate beats crisp edges. The softness is the price
of `Scale.FIT`. Revisit only if we find spare GPU budget (e.g. a partial DPR like
1.5, or DPI rendering with the glow disabled). Recipe kept here for if we retry.

---

## Explosion (B29) — `done` (2026-06-15) ✅

**The reference IS the prototype — match it exactly:**
> 📌 `star-slingers/prototype/reference/explosion-lab.ts`
> (live: [`/prototype/reference/explosion-lab.html`](https://michac.github.io/star-slingers/prototype/reference/explosion-lab.html) — tap the rock to detonate)

Replaces the flat 160 ms scale-up + fade (`Asteroid.pop()`) with a composed burst —
**flash** (white core + magenta glow, ~170 ms), **shockwave** (thin magenta ring,
~360 ms), **debris** (~12 rock shards flung out, spinning, falling, ~450–760 ms),
**sparks** (~28 white-hot **additive** dots, ~300–560 ms). Liked as-is on first pass.

Built on **particle emitters** (GPU-batched). Perf lessons honored: no DPI, glow
`quality` 0.3, one transient glow.

**Build target — `src/objects/Asteroid.ts` `pop()`:** bake the shard/spark textures
in `textures.ts`; fire **one pooled/shared** particle manager at the pop position
(don't create emitters per-pop in the hot path). Backlog **B29**; overlaps **B7**.

---

## Shot trail — `done` (2026-06-15) ✅

**The reference IS the prototype — match it exactly:**
> 📌 `star-slingers/prototype/reference/shot-trail.ts`
> (live: [`/prototype/reference/shot-trail.html`](https://michac.github.io/star-slingers/prototype/reference/shot-trail.html) — cyan + amber loop, tap to fire)

A trail behind the players' shots — six takes to get there (lessons worth keeping):
- **1 particle emitter:** beaded/"waggled" (gappy trail; tadpole). ✗
- **2 clean ribbon:** smooth but too **static** (a shape glued to the shot). ✗
- **3 jittered ribbon:** lively, but the wiggle = tadpole *again*. ✗
- **4 straight exhaust ribbon:** no jitter; an **exhaust color** (violet `#9d6bff`
  body + white-hot core, contrasting the cyan(P1)/amber(P2) head — distinct from both
  shots and enemy-magenta) + a **brightness flux** (a sine scrolling down the trail
  so bright bands pulse — life without moving geometry) + a faint **glow halo**. ✓
- **5 + afterimage:** a long, thin, near-constant-width violet line over a **~1.2s
  history** that fades to nothing along its length — a lingering light-streak. ✓
- **6 drop the embers:** the sparks off the head read too firecracker-ish; the flux
  + afterimage carry the life on their own. ✓ **locked.**

All additive-blended, all cheap (filled quads, **no postFX glow, no particles**).
The shot **head** stays player-colored; the exhaust + afterimage are violet.

**Build target — `src/objects/Rocket.ts`:** per-rocket straight position history
(~75 pts); each frame into one shared additive `Graphics` draw — the afterimage line
over the full history, then glow/body/core exhaust strips over the first ~18 with the
scrolling flux. Skip any segment longer than ~60px (handles recycle/teleport); clear
a rocket's history on `recycle()`. New polish item; rel. **B7** (juice).

---

## Queue — to prototype next

_(nothing queued — add the next effect here when we pick it)_
