import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { createPhysicsWorld, FIXED_TIMESTEP } from '../src/physics/physics';
import { createBall, kickBall, applyCurve, resetBall } from '../src/scene/ball';
import { createGoalColliders } from '../src/scene/world';
import { Keeper } from '../src/scene/keeper';
import { ShotJudge, type Outcome } from '../src/game/scoring';

/**
 * Simulate a generous 8 seconds per kick, expressed in seconds rather than a
 * step count: the physics rate is a tuning knob, and a hard-coded step count
 * silently becomes too short the moment it changes.
 */
const MAX_STEPS = Math.ceil(8 / FIXED_TIMESTEP);


function makeGame() {
  const world = createPhysicsWorld();
  const ball = createBall();
  world.addBody(ball.body);
  const goal = createGoalColliders();
  for (const b of goal.frame) world.addBody(b);
  world.addBody(goal.sensor);
  const keeper = new Keeper();
  world.addBody(keeper.link.body);
  const judge = new ShotJudge();
  ball.body.addEventListener('collide', (e: { body: CANNON.Body }) => {
    if (e.body === goal.sensor) judge.noteSensorCrossed();
    else if (goal.frame.includes(e.body)) judge.noteWoodwork();
    else if (e.body === keeper.link.body) judge.noteSave();
  });
  return { world, ball, keeper, judge };
}

function kick(target: THREE.Vector3, power: number, curve = 0, keeperOn = true): Outcome {
  const g = makeGame();
  resetBall(g.ball.body);
  g.judge.start();
  if (keeperOn) g.keeper.returnHome();
  else g.world.removeBody(g.keeper.link.body);
  kickBall(g.ball.body, target, power);
  if (keeperOn) g.keeper.reactToKick(target, g.ball.body);
  for (let i = 0; i < MAX_STEPS; i++) {
    applyCurve(g.ball.body, curve);
    if (keeperOn) g.keeper.update(FIXED_TIMESTEP, g.ball.body);
    g.world.step(FIXED_TIMESTEP);
    const o = g.judge.evaluate(g.ball.body, FIXED_TIMESTEP);
    if (o !== null) return o;
  }
  return 'MISS';
}
const V = (x: number, y: number) => new THREE.Vector3(x, y, 0);
const rate = (target: THREE.Vector3, power: number, n = 240) => {
  let goals = 0;
  for (let i = 0; i < n; i++) if (kick(target, power) === 'GOAL') goals++;
  return goals / n;
};

console.log('=== how tight is the max-power corner window? ===');
for (const [label, target] of [['top corner', V(-3.2, 2.15)], ['low corner', V(3.2, 0.35)]] as [string, THREE.Vector3][]) {
  const row = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
    .map((p) => `${p.toFixed(1)}:${(rate(target, p) * 100).toFixed(0)}%`)
    .join('  ');
  console.log(`  ${label.padEnd(11)} ${row}`);
}

console.log('\n=== woodwork: post-and-out reachable? (keeper removed) ===');
for (const [name, target, power] of [
  ['just outside left post', V(-3.74, 1.2), 0.8],
  ['grazing left post', V(-3.70, 1.2), 0.8],
  ['just over the bar', V(0, 2.52), 0.8],
  ['under the bar', V(0, 2.46), 0.8],
] as [string, THREE.Vector3, number][]) {
  const tally: Record<string, number> = {};
  for (let i = 0; i < 12; i++) {
    const o = kick(target, power, 0, false);
    tally[o] = (tally[o] ?? 0) + 1;
  }
  console.log(`  ${name.padEnd(24)} ${Object.entries(tally).map(([k, v]) => `${k}×${v}`).join(' ')}`);
}

console.log('\n=== curve as a tactic: bend around a keeper who read you ===');
{
  // Aim at the middle, curve hard right — does it end up wide of centre?
  for (const c of [0, 1]) {
    let goals = 0;
    for (let i = 0; i < 240; i++) if (kick(V(1.6, 1.1), 0.75, c) === 'GOAL') goals++;
    console.log(`  aim (1.6, 1.1) curve ${c} → goal ${((goals / 240) * 100).toFixed(0)}%`);
  }
}
