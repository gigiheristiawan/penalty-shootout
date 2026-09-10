# Penalty shootout — 3D web game spec

Separate project from the personal site. Owner: Gigih. Primary goal: **learn 3D on the web** (Three.js, physics, game loop). Shipping a fun toy is the secondary goal. A polished product is not a goal at all.

---

## 1. How to use this spec

This is a learning project. Do not generate the whole game in one pass.

Work one phase at a time. For each phase: explain the concepts involved before writing code, write the minimum code for the phase, and stop so the owner can read, run, and modify it. Prefer clarity over cleverness — a slightly verbose, well-named implementation beats a compact one. When a Three.js or physics concept appears for the first time (raycasting, quaternions, impulses, the render loop), add a short comment explaining what it is, not just what the line does.

The owner is a senior backend developer: skip JS/TS explanations entirely, explain 3D and game concepts from scratch.

## 2. The game

First-person penalty taker. One scene: a goal, a ball on the spot, a goalkeeper.

Loop per kick:

1. Player aims (moves a target marker inside the goal).
2. Player sets power (hold-and-release meter).
3. Optional curve (small left/right bias set before the kick).
4. Ball is kicked with physics; goalkeeper dives toward a zone.
5. Outcome: goal, save, miss (wide/over), or post/bar.
6. Score updates; next kick.

A round is best-of-5, like a real shootout. After 5 kicks: result screen, play again.

## 3. Non-goals

- No multiplayer, no backend, no accounts, no saved state beyond `localStorage` for best score.
- No character models or animations. The goalkeeper is a simple shape (capsule or box). The player is a camera.
- No licensed assets: no club badges, kits, player names, or broadcast-style overlays.
- No mobile touch controls until the desktop version is done (stretch goal, phase 7).
- No asset pipeline (Blender, GLTF) in early phases. Primitives only until phase 6.

## 4. Stack

| Concern | Choice | Notes |
|---|---|---|
| Build | Vite | Vanilla TS template. No framework. |
| Language | TypeScript, `strict: true` | |
| 3D | Three.js, plain — **not** React Three Fiber | The point is to learn what R3F abstracts. |
| Physics | cannon-es | Simple JS API, ideal for learning. Note in README that Rapier is the more modern choice for a serious project. |
| State/UI | Plain DOM + CSS for HUD (score, power meter) | No UI framework. HUD overlays the canvas. |
| Deploy | Cloudflare Pages, on a subdomain of the main site | e.g. `play.` or `lab.` |

## 5. Architecture

Small and explicit. Suggested layout:

```
src/
  main.ts            // bootstrap: renderer, loop, wiring
  core/
    loop.ts          // fixed-timestep update + render, pause on blur
    input.ts         // pointer/keyboard → semantic events (aim, charge, kick)
  scene/
    world.ts         // scene graph: pitch, goal, lighting, sky
    ball.ts          // mesh + physics body pairing
    keeper.ts        // mesh + dive behavior
  physics/
    physics.ts       // cannon-es world setup, materials, contact config
    sync.ts          // copy physics body transforms → meshes each frame
  game/
    state.ts         // finite state machine (see §6)
    scoring.ts       // outcome detection, best-of-5 bookkeeping
  ui/
    hud.ts           // score, power meter, aim marker, result screen
```

Rules:

- Physics owns positions of dynamic objects; meshes are synced from bodies every frame, never the reverse.
- One fixed-timestep physics update (e.g. 60 Hz) decoupled from the render loop. This is the game-dev equivalent of not doing work inside a request handler — explain it properly when it's introduced.
- The state machine is the spine of the game. All input handling checks the current state; no boolean flag soup.

## 6. Game states

```
AIMING → CHARGING → BALL_IN_FLIGHT → RESOLVED → (next kick | ROUND_OVER)
```

- **AIMING** — marker moves inside goal plane via pointer. Click-and-hold begins charging.
- **CHARGING** — power meter fills while held (oscillating bar: up then down, so timing matters). Release kicks.
- **BALL_IN_FLIGHT** — physics runs, keeper dives, input ignored. Timeout of ~3 s resolves as miss if nothing else triggers.
- **RESOLVED** — outcome shown briefly, score updated.
- **ROUND_OVER** — after kick 5 (or when mathematically decided): result screen, restart resets everything including physics bodies.

## 7. Physics specifics

- Ball: sphere body, ~0.43 kg, radius 0.11 m. Real-world-ish scale everywhere (goal 7.32 × 2.44 m, spot 11 m out) so gravity feels right.
- Kick: a single impulse computed from aim point, power, and elevation. Power maps to a capped speed range (roughly 15–34 m/s) so shots stay plausible.
- Curve: implemented as a small constant lateral force applied while the ball is in flight (a fake Magnus effect). Keep it subtle. Explain in comments why real Magnus is spin-dependent and why this shortcut is fine for a game.
- Goal detection: an invisible sensor box just behind the goal line inside the goal frame. Crossing it while below the bar = goal. Post/bar are static cylinder bodies so the ball can rattle in or bounce out — this is free fun from the physics engine, don't skip it.
- Keeper: kinematic body. On kick, it picks a dive zone and tweens there; contact with the ball = save. It must not be beatable by aiming at one magic spot every time (see §8).

## 8. Keeper behavior

Keep it simple but not dumb:

- Goal mouth divided into 6 zones (3 columns × 2 rows).
- On kick, keeper guesses a zone: weighted random, with a moderate probability of reading the actual aim (e.g. 40% reads the true zone, 60% guesses among the others). Tune by play-testing.
- Dive speed limits reach: far corners at high power should be nearly unsaveable when timed well; weak shots down the middle get caught if the keeper stays.
- Difficulty is one constant (the read probability). Expose it in a debug panel.

## 9. Feel and presentation

Feel is the actual product of this project. Budget real time for it.

- Camera: behind the ball at kick height, slight FOV punch on kick, subtle shake on post hits.
- Sound: kick thump, net swish, post ping, crowd murmur that rises on goal. A handful of free CC0 clips; keep total under ~300 KB.
- Visuals: flat-shaded primitives with a deliberately chosen palette beat lazy realism. Low-poly and confident, not "programmer art apologizing for itself." One directional light plus ambient; shadows on if the frame budget allows.
- Net: stretch goal. A static semi-transparent mesh is fine for v1; a cloth-sim net is a phase 7 toy, not a requirement.
- 60 fps on a mid-range laptop is the performance bar. If it drops, cut shadows before cutting gameplay.

## 10. Build order

Each phase ends with something runnable. Do not start the next phase until the current one runs and the owner has touched the code.

**Phase 0 — Hello scene.** Vite + TS + Three.js. Pitch plane, goal frame from cylinders, ball, sky color, lighting, orbit controls (dev only). *Learn: renderer, scene graph, camera, lights, materials.*

**Phase 1 — Physics drop.** cannon-es world, ball body, bounce on the ground. Sync layer. Fixed timestep. *Learn: bodies vs meshes, timestep, restitution/friction.*

**Phase 2 — Kick it.** Aim marker via raycast onto the goal plane, hold-release power meter, impulse kick. Ball flies; nothing judges it. *Learn: raycasting, screen→world mapping, impulses.*

**Phase 3 — Rules.** Sensor-based goal detection, posts/bar as colliders, miss timeout, state machine, score HUD, best-of-5. First moment it's a game. *Learn: collision events, sensors, game state.*

**Phase 4 — Keeper.** Kinematic keeper, zone logic per §8, save detection. *Learn: kinematic vs dynamic bodies, tweening, basic game AI.*

**Phase 5 — Feel.** Camera behavior, sound, curve mechanic, result screen, restart, palette pass. *Learn: why juice matters more than features.*

**Phase 6 — Ship.** Deploy to the subdomain, best-score in `localStorage`, small "how this was built" note linking back to the main site — the game becomes writing material.

**Phase 7 — Stretch (pick at most one at a time).** Touch controls · cloth net · a low-poly GLTF keeper from Blender · keeper difficulty ramp across the round.

## 11. Definition of done (v1)

- Best-of-5 round is playable start to finish with mouse only.
- Goals, saves, misses, and post hits are all reachable and correctly detected.
- Keeper is beatable but not trivially exploitable.
- Steady 60 fps on a mid-range laptop; no physics explosions on restart.
- Deployed and publicly reachable.

## 12. Open questions for the owner

1. Subdomain name.
2. Sound on by default, or off with a toggle? (Autoplay policies favor off.)
3. Keyboard-only fallback for aiming — needed for v1 or later?
