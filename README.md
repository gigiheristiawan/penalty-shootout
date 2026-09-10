# Penalty shootout

A first-person penalty shootout, built to learn 3D on the web: Three.js, physics
and the game loop. See `penalty-shootout-spec.md` for the full plan.

```bash
npm install
npm run dev
```

## Stack

- **Vite + TypeScript** (`strict`), no framework.
- **Three.js**, used directly — not React Three Fiber. The point is to learn what
  R3F abstracts away.
- **cannon-es** for physics (from phase 1). Worth knowing: for a serious project
  [Rapier](https://rapier.rs/) is the more modern choice — a Rust/WASM engine
  that is faster and better maintained. cannon-es is here because its plain JS
  API is easier to read while learning.

## Progress

- [x] **Phase 0 — Hello scene.** Pitch, goal frame, ball, lighting, dev orbit controls.
- [ ] Phase 1 — Physics drop
- [ ] Phase 2 — Kick it
- [ ] Phase 3 — Rules
- [ ] Phase 4 — Keeper
- [ ] Phase 5 — Feel
- [ ] Phase 6 — Ship

## Conventions

Everything is in SI units (metres, kilograms, seconds) so gravity feels right —
see `src/constants.ts`. World axes: +X right, +Y up, +Z from the goal towards
the player. The goal line is at `z = 0`, the penalty spot at `z = 11`.
