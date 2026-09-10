import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createGoalColliders, createWorld } from './scene/world';
import { applyCurve, createBall, createPenaltySpot, kickBall, resetBall } from './scene/ball';
import { AimController } from './scene/aim';
import { Keeper } from './scene/keeper';
import { createPhysicsWorld } from './physics/physics';
import { syncMeshes, type PhysicsLink } from './physics/sync';
import { startLoop } from './core/loop';
import { createInput } from './core/input';
import { CameraRig } from './core/camera';
import { SoundBoard } from './core/audio';
import { GameStateMachine } from './game/state';
import {
  Scoreboard,
  ShotJudge,
  readBestScore,
  writeBestScore,
  type Outcome,
} from './game/scoring';
import {
  CurveIndicator,
  DebugPanel,
  OutcomeBanner,
  PowerMeter,
  ResultScreen,
  ScoreDisplay,
  createColophon,
  showToast,
} from './ui/hud';
import { GOAL_HEIGHT, RESOLVED_DISPLAY_SECONDS } from './constants';

/**
 * Bootstrap and wiring.
 *
 * This file owns no rules of its own: the state machine decides what is legal,
 * `ShotJudge` decides what happened, `Scoreboard` remembers it, and everything
 * here is the plumbing between them.
 */

// ---------------------------------------------------------------- rendering

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

/**
 * `PerspectiveCamera(fov, aspect, near, far)`:
 *   fov    — vertical field of view in degrees. Bigger = wider, more distortion.
 *            48° is a little tighter than a natural view, which makes the goal
 *            big enough to aim at from 11 m; `CameraRig` punches it on kick.
 *   aspect — width / height. If it doesn't match the canvas, the image stretches.
 *   near/far — the depth range that gets rendered. Depth precision is spent
 *            between them, so keeping `near` well above 0 avoids z-fighting.
 */
const camera = new THREE.PerspectiveCamera(
  48,
  window.innerWidth / window.innerHeight,
  0.1,
  200,
);
const cameraRig = new CameraRig(camera);

// ------------------------------------------------------------------ physics

const physicsWorld = createPhysicsWorld();

const ball = createBall();
scene.add(ball.mesh);
physicsWorld.addBody(ball.body);

const goalColliders = createGoalColliders();
for (const body of goalColliders.frame) physicsWorld.addBody(body);
physicsWorld.addBody(goalColliders.sensor);

const keeper = new Keeper();
scene.add(keeper.link.mesh);
physicsWorld.addBody(keeper.link.body);

/** Everything whose mesh is driven by a body. */
const physicsLinks: PhysicsLink[] = [ball, keeper.link];

// -------------------------------------------------------------- game pieces

const state = new GameStateMachine();
const judge = new ShotJudge();
const scoreboard = new Scoreboard();
const aim = new AimController(camera);
const sound = new SoundBoard();

scene.add(aim.marker);

let bestScore = readBestScore();
/** Left/right bias for the next kick, -1 .. +1 (spec §2). */
let curve = 0;
/** Seconds spent in RESOLVED, so the outcome banner has time to be read. */
let resolvedElapsed = 0;

// ------------------------------------------------------------------ the HUD

const powerMeter = new PowerMeter();
const scoreDisplay = new ScoreDisplay();
const banner = new OutcomeBanner();
const curveIndicator = new CurveIndicator();
const resultScreen = new ResultScreen(() => restartRound());
const debugPanel = new DebugPanel(keeper.readProbability, (value) => {
  keeper.readProbability = value;
});

scoreDisplay.update(scoreboard.summary());
curveIndicator.update(curve);
createColophon();

// --------------------------------------------------------- collision events

/**
 * Collision reporting.
 *
 * These handlers fire from *inside* `world.step()`, midway through solving the
 * contacts for this tick. So they only ever record a flag; the decision about
 * what it means, and any change to the world, happens after the step returns.
 * Resetting a body from in here is a reliable way to produce a physics
 * explosion.
 */
ball.body.addEventListener('collide', (event: { body: CANNON.Body }) => {
  if (!state.is('BALL_IN_FLIGHT')) return;

  if (event.body === goalColliders.sensor) {
    judge.noteSensorCrossed();
    return;
  }

  if (goalColliders.frame.includes(event.body)) {
    judge.noteWoodwork();
    sound.post();
    cameraRig.shake();
    return;
  }

  if (event.body === keeper.link.body) {
    judge.noteSave();
    sound.save();
  }
});

// --------------------------------------------------------------- dev camera

/**
 * OrbitControls is a dev tool, disabled by default: it consumes the same drag
 * gesture the power meter needs. Press O to inspect the scene.
 */
const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.target.set(0, GOAL_HEIGHT / 2, 0);
orbitControls.enableDamping = true;
orbitControls.maxPolarAngle = Math.PI / 2 - 0.02;
orbitControls.enabled = false;
orbitControls.update();

// ------------------------------------------------------------- game actions

function setUpNextKick(): void {
  resetBall(ball.body);
  keeper.returnHome();
  cameraRig.reset();

  curve = 0;
  curveIndicator.update(curve);
  curveIndicator.setVisible(true);

  banner.hide();
  aim.setVisible(true);
  state.transitionTo('AIMING');
}

function takeKick(power: number): void {
  // Order matters: the keeper reads the ball's velocity, so it can only react
  // once the ball has actually been struck.
  kickBall(ball.body, aim.target, power);
  keeper.reactToKick(aim.target, ball.body);

  judge.start();
  sound.kick(power);
  cameraRig.punch(power);

  aim.setVisible(false);
  curveIndicator.setVisible(false);
  state.transitionTo('BALL_IN_FLIGHT');
}

function resolveShot(outcome: Outcome): void {
  scoreboard.record(outcome);
  scoreDisplay.update(scoreboard.summary());
  banner.show(outcome);

  if (outcome === 'GOAL') {
    sound.net();
    sound.crowdCheer();
  }

  resolvedElapsed = 0;
  state.transitionTo('RESOLVED');
}

function endRound(): void {
  bestScore = writeBestScore(scoreboard.score);
  banner.hide();
  aim.setVisible(false);
  curveIndicator.setVisible(false);
  resultScreen.show(scoreboard.summary(), bestScore);
  state.transitionTo('ROUND_OVER');
}

/** Restart resets everything, including physics bodies (spec §6). */
function restartRound(): void {
  scoreboard.reset();
  scoreDisplay.update(scoreboard.summary());
  resultScreen.hide();

  resetBall(ball.body);
  keeper.returnHome();
  cameraRig.reset();

  curve = 0;
  curveIndicator.update(curve);
  curveIndicator.setVisible(true);
  banner.hide();
  aim.setVisible(true);

  state.reset();
}

// ---------------------------------------------------------------- the input

createInput(renderer.domElement, {
  onAim(ndc) {
    if (orbitControls.enabled) return;
    // Aiming stays live during the charge — you can adjust while it sweeps.
    if (!state.is('AIMING', 'CHARGING')) return;
    aim.aimAt(ndc);
  },

  onChargeStart() {
    if (orbitControls.enabled) return;
    if (!state.is('AIMING')) return;

    // The first click is also the user gesture that unlocks the audio context.
    sound.unlock();
    sound.startCrowd();

    state.transitionTo('CHARGING');
    powerMeter.start();
  },

  onChargeRelease() {
    if (!state.is('CHARGING')) return;
    takeKick(powerMeter.release());
  },

  onCurve(delta) {
    if (!state.is('AIMING', 'CHARGING')) return;
    curve = THREE.MathUtils.clamp(curve + delta * 0.25, -1, 1);
    curveIndicator.update(curve);
  },

  onConfirm() {
    if (state.is('ROUND_OVER')) restartRound();
  },

  onReset() {
    if (state.is('ROUND_OVER')) return;
    setUpNextKick();
  },

  onToggleOrbit() {
    orbitControls.enabled = !orbitControls.enabled;
    if (!orbitControls.enabled) cameraRig.reset();
  },

  onToggleMute() {
    showToast(sound.toggleMute() ? 'sound off' : 'sound on');
  },

  onToggleDebug() {
    debugPanel.toggle();
  },
});

// ---------------------------------------------------------------- the loop

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

startLoop({
  update(fixedDeltaSeconds) {
    // The meter is simulation, not presentation: it ticks at the fixed rate so
    // the oscillation is identical on a 60 Hz and a 144 Hz display.
    powerMeter.update(fixedDeltaSeconds);

    if (state.is('BALL_IN_FLIGHT')) {
      applyCurve(ball.body, curve);
      keeper.update(fixedDeltaSeconds, ball.body);
    } else {
      // Keeps the keeper shifting on its line between kicks, and lets it pick
      // itself up after a dive instead of teleporting upright on reset.
      keeper.update(fixedDeltaSeconds);
    }

    /**
     * One physics tick. `world.step(dt)` integrates forces, moves every body,
     * then detects and resolves collisions. Forces are applied *before* the
     * step, because cannon-es clears them at the end of every step.
     */
    physicsWorld.step(fixedDeltaSeconds);

    if (state.is('BALL_IN_FLIGHT')) {
      const outcome = judge.evaluate(ball.body, fixedDeltaSeconds);
      if (outcome !== null) resolveShot(outcome);
    } else if (state.is('RESOLVED')) {
      resolvedElapsed += fixedDeltaSeconds;

      if (resolvedElapsed >= RESOLVED_DISPLAY_SECONDS) {
        if (scoreboard.isRoundOver) endRound();
        else setUpNextKick();
      }
    }

    if (!orbitControls.enabled) cameraRig.update(fixedDeltaSeconds);
  },

  render() {
    // Bodies moved; push their transforms onto the meshes before drawing.
    syncMeshes(physicsLinks);

    if (orbitControls.enabled) orbitControls.update();
    renderer.render(scene, camera);
  },
});
