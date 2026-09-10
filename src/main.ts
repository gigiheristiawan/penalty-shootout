import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createWorld } from './scene/world';
import { createBall, createPenaltySpot, resetBall } from './scene/ball';
import { createPhysicsWorld } from './physics/physics';
import { syncMeshes, type PhysicsLink } from './physics/sync';
import { startLoop } from './core/loop';
import { EYE_HEIGHT, GOAL_HEIGHT, PENALTY_SPOT_DISTANCE } from './constants';

/**
 * Phase 1 — physics drop.
 *
 * Two worlds now run side by side: the Three.js scene graph (what is drawn) and
 * the cannon-es world (what is true). `startLoop` advances the physics at a
 * fixed 60 Hz, the sync layer copies bodies onto meshes, and the renderer draws.
 *
 * Three.js basics, recapped from phase 0:
 *   scene    — what exists (the scene graph)
 *   camera   — where we look from, and with what lens
 *   renderer — turns (scene, camera) into pixels via WebGL
 */

const renderer = new THREE.WebGLRenderer({ antialias: true });
/**
 * A CSS pixel may be several device pixels (retina = 2x). Rendering at the full
 * device ratio on a 3x phone means 9x the fragments, so cap it at 2 — this is
 * the single cheapest performance lever in the whole project.
 */
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
// PCF-soft filters the shadow map when sampling, hiding its pixel edges.
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = createWorld();
scene.add(createPenaltySpot());

const physicsWorld = createPhysicsWorld();

const ball = createBall();
scene.add(ball.mesh);
physicsWorld.addBody(ball.body);

/** Everything whose mesh is driven by a body. The ball is alone here for now. */
const physicsLinks: PhysicsLink[] = [ball];

/**
 * `PerspectiveCamera(fov, aspect, near, far)`:
 *   fov    — vertical field of view in degrees. Bigger = wider, more distortion.
 *            ~55° reads as a natural human view; phase 5 punches this on kick.
 *   aspect — width / height. If it doesn't match the canvas, the image stretches.
 *   near/far — the depth range that gets rendered. Depth precision is spent
 *            between them, so keeping `near` well above 0 avoids z-fighting.
 */
const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  0.1,
  200,
);
// Behind the ball, at the penalty taker's eye height (spec §9).
camera.position.set(0, EYE_HEIGHT, PENALTY_SPOT_DISTANCE + 2.5);
camera.lookAt(0, GOAL_HEIGHT / 2, 0);

/**
 * OrbitControls is a dev convenience only — it will be removed once the camera
 * belongs to the game (phase 5). It works by mutating the camera's position and
 * calling `lookAt` on its `target`, which is why the target must match where we
 * originally aimed, or the first drag would snap the view.
 */
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, GOAL_HEIGHT / 2, 0);
// Damping smooths the motion, but requires controls.update() every frame.
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.02; // don't let the camera go underground
controls.update();

/** Keep the render output and the camera lens matched to the window. */
function handleResize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;

  camera.aspect = width / height;
  // Changing aspect/fov/near/far does nothing until the projection matrix is
  // rebuilt from them.
  camera.updateProjectionMatrix();

  renderer.setSize(width, height);
}
window.addEventListener('resize', handleResize);

/**
 * Temporary phase-1 harness: drop the ball from head height so the bounce is
 * visible. Real input (aim, charge, kick) arrives in phase 2 as `core/input.ts`.
 */
function dropBall(): void {
  resetBall(ball.body, 3);
}
dropBall();

window.addEventListener('keydown', (event) => {
  if (event.code === 'Space' || event.code === 'KeyR') {
    event.preventDefault();
    dropBall();
  }
});

startLoop({
  update(fixedDeltaSeconds) {
    /**
     * One physics tick. `world.step(dt)` integrates forces, moves every body,
     * then detects and resolves collisions.
     *
     * cannon-es can do its own sub-stepping via `step(fixed, elapsed, maxSubs)`,
     * but the accumulator in `core/loop.ts` already guarantees a fixed dt, and
     * doing it by hand is the point of this phase.
     */
    physicsWorld.step(fixedDeltaSeconds);
  },

  render() {
    // Bodies moved; push their transforms onto the meshes before drawing.
    syncMeshes(physicsLinks);

    controls.update();
    renderer.render(scene, camera);
  },
});
