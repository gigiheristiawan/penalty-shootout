# Penalty shootout

A first-person penalty shootout, built to learn 3D on the web: Three.js, physics
and the game loop. See `penalty-shootout-spec.md` for the plan it follows.

```bash
npm install
npm run dev
```

## Controls

| | |
|---|---|
| Move mouse | Aim (the marker is raycast onto the goal plane) |
| Hold / release left button | Charge the oscillating power meter, then kick |
| `A` / `D` or `←` / `→` | Curve bias, set before the kick |
| `M` | Sound on/off |
| `` ` `` | Debug panel (keeper difficulty) |
| `R` | Reset the current kick |
| `O` | Dev orbit camera (aiming is disabled while it is on) |

## Stack

- **Vite + TypeScript** (`strict`), no framework.
- **Three.js**, used directly — not React Three Fiber. The point is to learn what
  R3F abstracts away.
- **cannon-es** for physics. Worth knowing: for a serious project
  [Rapier](https://rapier.rs/) is the more modern choice — a Rust/WASM engine
  that is faster and better maintained. cannon-es is here because its plain JS
  API is easier to read while learning.

## Phases

All of phases 0–6 are implemented. Phase 7 (touch controls, cloth net, a GLTF
keeper, difficulty ramp) is untouched by design — one at a time, later.

## Conventions

Everything is in SI units (metres, kilograms, seconds) so gravity feels right —
see `src/constants.ts`. World axes: +X right, +Y up, +Z from the goal towards
the player. The goal line is at `z = 0`, the penalty spot at `z = 11`.

Two rules hold the architecture together:

1. **Physics owns position.** Meshes are copied from bodies every frame, never
   the reverse (`src/physics/sync.ts`).
2. **The state machine is the spine.** Every input handler checks the current
   state before acting (`src/game/state.ts`). Illegal transitions throw.

## Layout

```
src/
  main.ts            bootstrap and wiring — owns no rules of its own
  constants.ts       dimensions, tuning, palette
  core/
    loop.ts          fixed-timestep accumulator + render, pause on blur
    input.ts         pointer/keyboard → semantic events
    camera.ts        FOV punch, shake, framing
    audio.ts         synthesised sound (Web Audio, no asset files)
  scene/
    world.ts         pitch, goal frame, net, lighting, goal colliders + sensor
    ball.ts          mesh/body pair, kick impulse, curve
    keeper.ts        kinematic keeper, zone choice, dive
    aim.ts           raycast onto the goal plane, aim marker
  physics/
    physics.ts       world, materials, contact config
    sync.ts          body → mesh each frame
  game/
    state.ts         finite state machine
    scoring.ts       outcome detection, best-of-5, localStorage best
  ui/
    hud.ts           power meter, score, banner, result screen, debug panel
```

## Verification

The interesting behaviour is emergent, so it is checked by simulation rather
than by eye. These run the *real* game modules headlessly.

```bash
npm run sim             # outcome reachability + keeper goal/save rates per strategy
npm run sim:probe       # power sensitivity, woodwork, curve deviation
npm run sim:stability   # 200 kicks with resets: no NaN, no illegal transitions
npm run sim:keeper      # keeper sanity: does it dive at obvious misses, does it track the ball?
npm run sim:deflection  # 4000 shots: is every keeper touch judged correctly?
npm run sim:woodwork    # do the posts and crossbar actually get hit?
npm run e2e             # Playwright: plays a full round in a real browser
```

`npm run e2e` needs a server running (`npm run dev`, or `npm run build && npm run
preview`) on port 5199.

Current keeper balance, from `npm run sim` (300 kicks per strategy):

| Strategy | Goal | Save |
|---|---|---|
| Top corner, max power | 99% | 1% |
| Top corner, 60% power | 75% | 25% |
| Half-height side | 59% | 41% |
| Down the middle, weak | 55% | 45% |

Beatable with a well-timed corner, not exploitable by repeating one spot. The
difficulty is a single number — `KEEPER_READ_PROBABILITY` — exposed live in the
debug panel.

The keeper does four things beyond guessing a zone, each of which exists because
its absence looked stupid:

- **Watches shots it judges to be missing** instead of diving at a ball flying
  two metres wide (it used to do that 81% of the time).
- **Adjusts mid-flight**, but by at most `KEEPER_CORRECTION_LIMIT` (0.5 m), so a
  dive that was roughly right becomes a fingertip save while one that went the
  wrong way still fails.
- **Shuffles on its line** between kicks, and picks itself up after a dive.
- **Commits to a side more often than the middle** (`KEEPER_COLUMN_WEIGHTS`), and
  hops on a centre dive — a central dive has no rotation, so without that it was
  indistinguishable from standing still.

## Why physics runs at 240 Hz

A discrete simulation only tests for collisions at the positions it samples, so
anything thinner than the gap between two samples can be skipped entirely. At
full power the ball travels **0.563 m per 60 Hz step**, while the keeper's body
is 0.56 m thick and a goalpost is 0.12 m. At 60 Hz a hard shot passed clean
through the keeper, or — worse — was noticed only once it was already deep
inside, at which point the solver shoved it out of the nearest face, sometimes
*into* the goal. Measured: contacts caught at the keeper's front face removed
~60% of the ball's speed; late ones removed ~15% and the ball carried on in.

At 240 Hz the ball moves ~0.14 m per step and both are caught reliably. The
lesson generalises: pick the timestep against the *thinnest* collider and the
*fastest* body in the scene, not by convention.

Related: the crossbar's collider is a `Box`, not a `Cylinder`. cannon-es
implements `Cylinder` as a `ConvexPolyhedron`, and a **rotated** one produces a
collision event the solver never resolves — a ball dropped on it falls straight
through. Upright cylinders (the posts) are fine, so only the bar is affected.

## Deploying (Cloudflare Pages)

Not yet deployed — needs the account and a subdomain choice. Via the dashboard,
connect the repo and set:

- Build command: `npm run build`
- Output directory: `dist`
- Node version: 20 or later

Or from the CLI:

```bash
npm run build
npx wrangler pages deploy dist --project-name penalty-shootout
```

Then point a subdomain (`play.` or `lab.`) at the Pages project, and update the
"More writing →" link in the colophon modal in `index.html`.

## Open questions (spec §12)

1. **Subdomain name** — still undecided; nothing in the code depends on it.
2. **Sound default** — currently **on**, but the `AudioContext` is only created
   on the first click, which *is* a user gesture, so the autoplay policy is
   satisfied without shipping muted. `M` toggles it.
3. **Keyboard-only aiming** — not implemented. `core/input.ts` is the only file
   that would need to change.

## Known deviations from the spec

- **Sound is synthesised, not sampled.** §9 asks for CC0 clips; `core/audio.ts`
  generates everything with Web Audio instead. Zero bytes shipped and no licence
  tracking, at the cost of a crowd that is really just filtered noise.
- **The aim marker lives in `scene/`, not `ui/`.** §5 lists it under `hud.ts`,
  but it is a 3D ring in the goal plane, so it belongs to the scene graph.
- **The keeper's collision box is longer than its capsule.** It stands in for
  outstretched arms; without it three dive positions cannot cover a 7.32 m goal
  and a shot halfway between two zones is unsaveable. See `KEEPER_REACH_HALF_LENGTH`.
