import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { createPhysicsWorld, FIXED_TIMESTEP } from '../src/physics/physics';
import { createBall, kickBall, resetBall } from '../src/scene/ball';
import { createGoalColliders } from '../src/scene/world';
import { ShotJudge } from '../src/game/scoring';

/**
 * Simulate a generous 8 seconds per kick, expressed in seconds rather than a
 * step count: the physics rate is a tuning knob, and a hard-coded step count
 * silently becomes too short the moment it changes.
 */
const MAX_STEPS = Math.ceil(8 / FIXED_TIMESTEP);


function kick(target: THREE.Vector3, power: number) {
  const world = createPhysicsWorld();
  const ball = createBall();
  world.addBody(ball.body);
  const goal = createGoalColliders();
  for (const b of goal.frame) world.addBody(b);
  world.addBody(goal.sensor);
  const judge = new ShotJudge();
  let hit = false;
  ball.body.addEventListener('collide', (e: { body: CANNON.Body }) => {
    if (e.body === goal.sensor) judge.noteSensorCrossed();
    else if (goal.frame.includes(e.body)) { judge.noteWoodwork(); hit = true; }
  });
  resetBall(ball.body); judge.start();
  kickBall(ball.body, target, power);
  let o = null;
  for (let i = 0; i < MAX_STEPS && o === null; i++) { world.step(FIXED_TIMESTEP); o = judge.evaluate(ball.body, FIXED_TIMESTEP); }
  return { hit, outcome: o ?? 'MISS' };
}
const V = (x: number, y: number) => new THREE.Vector3(x, y, 0);
console.log('woodwork detection at max power (post radius 0.06 m, ball radius 0.11 m):');
for (const [name, x, y] of [
  ['dead on the left post', -3.66, 1.2],
  ['dead on the right post', 3.66, 1.2],
  ['dead on the crossbar', 0, 2.44],
  ['inside edge of post', -3.58, 1.2],
  ['outside edge of post', -3.74, 1.2],
] as [string, number, number][]) {
  let hits = 0; const n = 40;
  const outcomes: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const r = kick(V(x, y), 1.0);
    if (r.hit) hits++;
    outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
  }
  console.log(`  ${name.padEnd(24)} struck woodwork ${((hits / n) * 100).toFixed(0)}%  → ${Object.entries(outcomes).map(([k, v]) => `${k}×${v}`).join(' ')}`);
}
