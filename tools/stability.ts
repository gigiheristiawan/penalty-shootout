import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { createPhysicsWorld, FIXED_TIMESTEP } from '../src/physics/physics';
import { createBall, kickBall, applyCurve, resetBall } from '../src/scene/ball';
import { createGoalColliders } from '../src/scene/world';
import { Keeper } from '../src/scene/keeper';
import { ShotJudge, Scoreboard, type Outcome } from '../src/game/scoring';
import { GameStateMachine } from '../src/game/state';

/**
 * Simulate a generous 8 seconds per kick, expressed in seconds rather than a
 * step count: the physics rate is a tuning knob, and a hard-coded step count
 * silently becomes too short the moment it changes.
 */
const MAX_STEPS = Math.ceil(8 / FIXED_TIMESTEP);


const world = createPhysicsWorld();
const ball = createBall();
world.addBody(ball.body);
const goal = createGoalColliders();
for (const b of goal.frame) world.addBody(b);
world.addBody(goal.sensor);
const keeper = new Keeper();
world.addBody(keeper.link.body);
const judge = new ShotJudge();
const state = new GameStateMachine();
const scoreboard = new Scoreboard();

ball.body.addEventListener('collide', (e: { body: CANNON.Body }) => {
  if (e.body === goal.sensor) judge.noteSensorCrossed();
  else if (goal.frame.includes(e.body)) judge.noteWoodwork();
  else if (e.body === keeper.link.body) judge.noteSave();
});

const finite = (v: { x: number; y: number; z: number }) =>
  Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

let rounds = 0;
let kicks = 0;
let worstSpeed = 0;
let worstBallY = 0;
const tally: Record<string, number> = { GOAL: 0, SAVE: 0, MISS: 0, POST: 0 };

for (let round = 0; round < 40; round++) {
  scoreboard.reset();
  state.reset();

  while (!scoreboard.isRoundOver) {
    // AIMING -> CHARGING -> BALL_IN_FLIGHT
    state.transitionTo('CHARGING');
    resetBall(ball.body);
    keeper.returnHome();

    const target = new THREE.Vector3(
      (Math.random() - 0.5) * 9,
      Math.random() * 3.4 + 0.15,
      0,
    );
    const power = Math.random();
    const curve = Math.round(Math.random() * 2 - 1);

    judge.start();
    kickBall(ball.body, target, power);
    keeper.reactToKick(target, ball.body);
    state.transitionTo('BALL_IN_FLIGHT');
    kicks++;

    let outcome: Outcome | null = null;
    for (let i = 0; i < MAX_STEPS && outcome === null; i++) {
      applyCurve(ball.body, curve);
      keeper.update(FIXED_TIMESTEP, ball.body);
      world.step(FIXED_TIMESTEP);

      if (!finite(ball.body.position) || !finite(ball.body.velocity)) {
        throw new Error(`NaN in ball state at round ${round}, kick ${kicks}`);
      }
      if (!finite(keeper.link.body.position)) {
        throw new Error(`NaN in keeper state at round ${round}, kick ${kicks}`);
      }

      worstSpeed = Math.max(worstSpeed, ball.body.velocity.length());
      worstBallY = Math.max(worstBallY, ball.body.position.y);
      outcome = judge.evaluate(ball.body, FIXED_TIMESTEP);
    }

    state.transitionTo('RESOLVED');
    scoreboard.record(outcome ?? 'MISS');
    tally[outcome ?? 'MISS'] = (tally[outcome ?? 'MISS'] ?? 0) + 1;

    if (scoreboard.isRoundOver) state.transitionTo('ROUND_OVER');
    else state.transitionTo('AIMING');
  }
  rounds++;
}

console.log(`${rounds} rounds, ${kicks} kicks, no NaN, no illegal transitions.`);
console.log('outcome mix:', Object.entries(tally).map(([k, v]) => `${k} ${((v / kicks) * 100).toFixed(0)}%`).join('  '));
console.log(`peak ball speed ${worstSpeed.toFixed(1)} m/s (kick range caps at 34), peak height ${worstBallY.toFixed(2)} m`);

// Illegal transitions must actually throw.
try {
  state.reset();
  state.transitionTo('RESOLVED');
  console.log('FAIL: illegal transition AIMING -> RESOLVED was allowed');
} catch {
  console.log('illegal transition correctly rejected (AIMING -> RESOLVED)');
}
