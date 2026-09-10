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

function takeKick(g: ReturnType<typeof makeGame>, target: THREE.Vector3, power: number, curve = 0, withKeeper = true): Outcome {
  resetBall(g.ball.body);
  g.judge.start();
  if (withKeeper) {
    g.keeper.returnHome();
  } else {
    // Actually remove the keeper, rather than parking it and letting
    // returnHome put it straight back on the line.
    g.world.removeBody(g.keeper.link.body);
  }
  kickBall(g.ball.body, target, power);
  if (withKeeper) g.keeper.reactToKick(target, g.ball.body);

  for (let i = 0; i < MAX_STEPS; i++) {
    applyCurve(g.ball.body, curve);
    if (withKeeper) g.keeper.update(FIXED_TIMESTEP, g.ball.body);
    g.world.step(FIXED_TIMESTEP);
    g.ball.mesh.position.set(g.ball.body.position.x, g.ball.body.position.y, g.ball.body.position.z);
    g.keeper.link.mesh.position.set(g.keeper.link.body.position.x, g.keeper.link.body.position.y, g.keeper.link.body.position.z);
    const o = g.judge.evaluate(g.ball.body, FIXED_TIMESTEP);
    if (o !== null) return o;
  }
  return 'MISS';
}

const V = (x: number, y: number) => new THREE.Vector3(x, y, 0);

console.log('=== outcome reachability (keeper removed) ===');
{
  const cases: [string, THREE.Vector3, number][] = [
    ['top-left corner',   V(-3.3, 2.2),  1.0],
    ['bottom-right',      V(3.3, 0.3),   0.8],
    ['dead centre',       V(0, 1.0),     0.5],
    ['wide right',        V(5.0, 1.0),   0.8],
    ['over the bar',      V(0, 3.4),     0.9],
    ['left post',         V(-3.66, 1.2), 0.85],
    ['crossbar',          V(0, 2.44),    0.85],
  ];
  for (const [name, target, power] of cases) {
    const results: Record<string, number> = {};
    for (let i = 0; i < 5; i++) {
      const g2 = makeGame();
      const o = takeKick(g2, target, power, 0, false);
      results[o] = (results[o] ?? 0) + 1;
    }
    console.log(`  ${name.padEnd(16)} → ${Object.entries(results).map(([k, v]) => `${k}×${v}`).join(' ')}`);
  }
}

console.log('\n=== keeper: beatable? exploitable? (300 kicks per strategy) ===');
{
  const strategies: [string, THREE.Vector3, number][] = [
    ['top corner, max power', V(-3.2, 2.15), 1.0],
    ['top corner, 60% power', V(-3.2, 2.15), 0.6],
    ['low corner, max power', V(3.2, 0.35), 1.0],
    ['down the middle, weak', V(0, 1.0), 0.35],
    ['down the middle, max', V(0, 1.1), 1.0],
    ['half-height side', V(2.4, 1.2), 0.8],
    ['mid-height, x=1.3', V(1.3, 1.2), 0.8],
    ['mid-height, x=3.0', V(3.0, 1.25), 0.8],
    ['low, x=1.3', V(1.3, 0.4), 0.8],
    ['high middle', V(0, 2.1), 0.8],
  ];

  for (const [name, target, power] of strategies) {
    const tally: Record<string, number> = { GOAL: 0, SAVE: 0, MISS: 0, POST: 0 };
    const runs = 300;
    for (let i = 0; i < runs; i++) {
      const g = makeGame();
      const outcome = takeKick(g, target, power);
      tally[outcome] = (tally[outcome] ?? 0) + 1;
    }
    const pct = (n: number) => `${((n / runs) * 100).toFixed(0)}%`;
    console.log(
      `  ${name.padEnd(24)} goal ${pct(tally.GOAL!).padStart(4)}  save ${pct(tally.SAVE!).padStart(4)}  miss ${pct(tally.MISS!).padStart(4)}  post ${pct(tally.POST!).padStart(4)}`,
    );
  }
}

console.log('\n=== curve ===');
{
  for (const curve of [-1, 0, 1]) {
    const g = makeGame();
    g.world.removeBody(g.keeper.link.body);
    resetBall(g.ball.body);
    g.judge.start();
    kickBall(g.ball.body, V(0, 1.2), 0.7);
    let prev = g.ball.body.position.clone();
    for (let i = 0; i < 300; i++) {
      applyCurve(g.ball.body, curve);
      g.world.step(FIXED_TIMESTEP);
      if (prev.z > 0 && g.ball.body.position.z <= 0) {
        const a = prev.z / (prev.z - g.ball.body.position.z);
        const x = prev.x + (g.ball.body.position.x - prev.x) * a;
        console.log(`  curve ${curve.toString().padStart(2)} → lateral deviation at the line: ${x.toFixed(2)} m`);
        break;
      }
      prev = g.ball.body.position.clone();
    }
  }
}
