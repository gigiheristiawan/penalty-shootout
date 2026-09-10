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

  const touched = { keeper: false, sensor: false, woodwork: false };
  ball.body.addEventListener('collide', (e: { body: CANNON.Body }) => {
    if (e.body === goal.sensor) { judge.noteSensorCrossed(); touched.sensor = true; }
    else if (goal.frame.includes(e.body)) { judge.noteWoodwork(); touched.woodwork = true; }
    else if (e.body === keeper.link.body) { judge.noteSave(); touched.keeper = true; }
  });
  return { world, ball, keeper, judge, touched };
}

function kick(target: THREE.Vector3, power: number, curve = 0) {
  const g = makeGame();
  resetBall(g.ball.body);
  g.judge.start();
  g.keeper.returnHome();
  kickBall(g.ball.body, target, power);
  g.keeper.reactToKick(target, g.ball.body);

  let outcome: Outcome | null = null;
  for (let i = 0; i < MAX_STEPS && outcome === null; i++) {
    applyCurve(g.ball.body, curve);
    g.keeper.update(FIXED_TIMESTEP, g.ball.body);
    g.world.step(FIXED_TIMESTEP);
    outcome = g.judge.evaluate(g.ball.body, FIXED_TIMESTEP);
  }
  return { outcome: outcome ?? 'MISS', ...g.touched };
}

const V = (x: number, y: number) => new THREE.Vector3(x, y, 0);

// Sweep a wide spread of shots looking for keeper contacts, and check how each
// one was judged.
let keeperTouches = 0;
let touchedAndCrossed = 0;
let touchedAndCrossedCalledGoal = 0;
let touchedStayedOut = 0;
let touchedStayedOutCalledSave = 0;
const wrong: string[] = [];

for (let i = 0; i < 4000; i++) {
  const x = (Math.random() - 0.5) * 7.2;
  const y = 0.2 + Math.random() * 2.4;
  const power = 0.15 + Math.random() * 0.85;
  const curve = Math.round(Math.random() * 2 - 1);
  const r = kick(V(x, y), power, curve);

  if (!r.keeper) continue;
  keeperTouches++;

  if (r.sensor) {
    touchedAndCrossed++;
    if (r.outcome === 'GOAL') touchedAndCrossedCalledGoal++;
    else wrong.push(`crossed the line after a keeper touch but was called ${r.outcome} (aim ${x.toFixed(2)},${y.toFixed(2)} power ${power.toFixed(2)})`);
  } else {
    touchedStayedOut++;
    if (r.outcome === 'SAVE') touchedStayedOutCalledSave++;
    else wrong.push(`keeper touch, stayed out, called ${r.outcome}`);
  }
}

console.log(`shots the keeper got a touch on: ${keeperTouches} / 4000`);
console.log(`  ...and the ball still crossed the line: ${touchedAndCrossed}`);
console.log(`     judged GOAL: ${touchedAndCrossedCalledGoal} / ${touchedAndCrossed}`);
console.log(`  ...and it stayed out: ${touchedStayedOut}`);
console.log(`     judged SAVE: ${touchedStayedOutCalledSave} / ${touchedStayedOut}`);

const misjudged = wrong.filter((w) => w.includes('crossed the line'));
console.log(`\ndeflections-into-the-goal misjudged: ${misjudged.length}`);
for (const w of misjudged.slice(0, 5)) console.log('  ' + w);
const otherWrong = wrong.filter((w) => !w.includes('crossed the line'));
if (otherWrong.length) {
  const counts = otherWrong.reduce<Record<string, number>>((a, w) => { a[w] = (a[w] ?? 0) + 1; return a; }, {});
  console.log('\nkeeper touch, stayed out, judged as something other than SAVE:');
  for (const [k, v] of Object.entries(counts)) console.log(`  ${v}× ${k}`);
}
