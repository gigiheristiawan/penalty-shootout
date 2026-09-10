import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { createPhysicsWorld, FIXED_TIMESTEP } from '../src/physics/physics';
import { createBall, kickBall, applyCurve, resetBall } from '../src/scene/ball';
import { createGoalColliders } from '../src/scene/world';
import { Keeper } from '../src/scene/keeper';
import { ShotJudge, type Outcome } from '../src/game/scoring';
import { GOAL_WIDTH, GOAL_HEIGHT } from '../src/constants';

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

interface Trace {
  outcome: Outcome;
  crossX: number; crossY: number;      // where the ball crossed the goal plane
  keeperXAtCross: number;              // where the keeper was at that moment
  keeperXFinal: number;
  dived: boolean;
  onTarget: boolean;
  minBallGap: number;
}

function run(target: THREE.Vector3, power: number, curve = 0): Trace {
  const g = makeGame();
  resetBall(g.ball.body);
  g.judge.start();
  g.keeper.returnHome();
  const startX = g.keeper.link.body.position.x;
  kickBall(g.ball.body, target, power);
  g.keeper.reactToKick(target, g.ball.body);

  let crossX = NaN, crossY = NaN, keeperXAtCross = NaN;
  let minBallGap = Infinity;
  let prev = g.ball.body.position.clone();
  let outcome: Outcome | null = null;

  for (let i = 0; i < MAX_STEPS && outcome === null; i++) {
    applyCurve(g.ball.body, curve);
    g.keeper.update(FIXED_TIMESTEP, g.ball.body);
    g.world.step(FIXED_TIMESTEP);
    const p = g.ball.body.position;
    if (Number.isNaN(crossX) && prev.z > 0 && p.z <= 0) {
      const a = prev.z / (prev.z - p.z);
      crossX = prev.x + (p.x - prev.x) * a;
      crossY = prev.y + (p.y - prev.y) * a;
      keeperXAtCross = g.keeper.link.body.position.x;
    }
    const k = g.keeper.link.body.position;
    if (p.z < 6) minBallGap = Math.min(minBallGap, Math.hypot(p.x - k.x, p.y - k.y, p.z - k.z));
    prev = p.clone();
    outcome = g.judge.evaluate(g.ball.body, FIXED_TIMESTEP);
  }

  const keeperXFinal = g.keeper.link.body.position.x;
  return {
    outcome: outcome ?? 'MISS',
    crossX, crossY, keeperXAtCross, keeperXFinal,
    dived: Math.abs(keeperXFinal - startX) > 0.4,
    minBallGap,
    onTarget: Math.abs(crossX) < GOAL_WIDTH / 2 && crossY < GOAL_HEIGHT && crossY > 0,
  };
}

const V = (x: number, y: number) => new THREE.Vector3(x, y, 0);

console.log('=== 1. Does the keeper dive at shots that are obviously missing? ===');
for (const [name, t, p] of [
  ['2 m wide of the post', V(5.6, 1.2), 0.8],
  ['1.5 m over the bar', V(0, 3.9), 0.85],
  ['high AND wide', V(5.2, 3.6), 0.85],
] as [string, THREE.Vector3, number][]) {
  let dives = 0; const n = 100;
  for (let i = 0; i < n; i++) if (run(t, p).dived) dives++;
  console.log(`  ${name.padEnd(22)} dives anyway: ${dives}% of the time`);
}

console.log('\n=== 2. Does it adjust once the ball is on its way? ===');
{
  // Compare where the keeper ENDS UP against the zone centre it committed to.
  // Zero drift would mean it runs a fixed tween and never looks at the ball.
  const zoneCentres = [-2.44, 0, 2.44];
  for (const curve of [0, 1, -1]) {
    let drift = 0, minGap = 0; const n = 120;
    for (let i = 0; i < n; i++) {
      const t = run(V(-2.0, 1.2), 0.55, curve);
      const nearest = zoneCentres.reduce((a, b) =>
        Math.abs(b - t.keeperXFinal) < Math.abs(a - t.keeperXFinal) ? b : a);
      drift += Math.abs(t.keeperXFinal - nearest);
      minGap += t.minBallGap;
    }
    console.log(`  curve ${String(curve).padStart(2)}: mean drift from zone centre = ${(drift / n).toFixed(2)} m, mean closest approach to ball = ${(minGap / n).toFixed(2)} m`);
  }
}

console.log('\n=== 3. Weak roller straight at the keeper ===');
{
  const tally: Record<string, number> = {};
  for (let i = 0; i < 100; i++) {
    const o = run(V(0, 0.3), 0.0).outcome;
    tally[o] = (tally[o] ?? 0) + 1;
  }
  console.log(' ', Object.entries(tally).map(([k, v]) => `${k} ${v}%`).join('  '));
}

console.log('\n=== 4. How often does it dive the WRONG WAY on an on-target shot? ===');
{
  let wrongWay = 0, total = 0;
  for (let i = 0; i < 300; i++) {
    const x = (Math.random() - 0.5) * 6.4;
    const y = 0.3 + Math.random() * 1.9;
    const t = run(V(x, y), 0.4 + Math.random() * 0.5);
    if (!t.onTarget) continue;
    total++;
    // Ball one side of centre, keeper committed to the other side.
    if (Math.sign(t.crossX) !== 0 && Math.sign(t.keeperXFinal) === -Math.sign(t.crossX)
        && Math.abs(t.crossX) > 0.8 && Math.abs(t.keeperXFinal) > 0.8) wrongWay++;
  }
  console.log(`  dived to the opposite side on ${((wrongWay / total) * 100).toFixed(0)}% of on-target shots`);
}
