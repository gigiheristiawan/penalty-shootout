import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {
  GOAL_HEIGHT,
  GOAL_LINE_Z,
  GOAL_WIDTH,
  GRAVITY,
  KEEPER_CORRECTION_LIMIT,
  KEEPER_CORRECTION_RATE,
  KEEPER_MAX_DIVE_SPEED,
  KEEPER_IDLE_SPEED,
  KEEPER_IDLE_SWAY,
  KEEPER_IGNORE_MARGIN,
  KEEPER_PREDICTION_ERROR,
  KEEPER_DIVE_SECONDS,
  KEEPER_CENTRE_HOP,
  KEEPER_COLUMN_WEIGHTS,
  KEEPER_HEIGHT,
  KEEPER_HIGH_DIVE_PENALTY,
  KEEPER_RADIUS,
  KEEPER_REACH_HALF_LENGTH,
  KEEPER_READ_PROBABILITY,
  KEEPER_REACTION_SECONDS,
  KEEPER_REACH_JITTER,
  KEEPER_RECOVERY_SPEED,
  KEEPER_TIMING_JITTER,
  KEEPER_ZONE_COLUMNS,
  KEEPER_ZONE_ROWS,
  PALETTE,
} from '../constants';
import { MATERIALS } from '../physics/physics';
import type { PhysicsLink } from '../physics/sync';

/**
 * The goalkeeper (spec §8).
 *
 * It is a **kinematic** body: infinite mass, so forces and collisions never move
 * it, but unlike a static body it *is* integrated by its velocity — so it can be
 * driven along a path and will shove dynamic bodies out of the way. That is
 * exactly what a scripted character wants. Setting `position` directly would
 * teleport it, and a teleporting body generates no contact velocity, so the ball
 * would dribble off it instead of being punched away.
 *
 * The six zones are 3 columns × 2 rows across the goal mouth.
 */

/** The resting orientation, used to straighten up after a dive. */
const UPRIGHT = new CANNON.Quaternion(0, 0, 0, 1);

/** Rotation axis for a dive: the keeper topples sideways, about Z. */
const DIVE_AXIS = new CANNON.Vec3(0, 0, 1);

/** How far a full-stretch dive tips the keeper from upright. */
const MAX_DIVE_ANGLE = (58 * Math.PI) / 180;

/** The furthest zone centre, used to scale the dive angle. */
const MAX_ZONE_OFFSET = Math.max(...KEEPER_ZONE_COLUMNS.map(Math.abs));

export interface KeeperZone {
  column: number;
  row: number;
}

export class Keeper {
  readonly link: PhysicsLink;

  /** Where the keeper is heading this dive, in world space. */
  private readonly diveTarget = new THREE.Vector3();
  private readonly diveOrigin = new THREE.Vector3();
  private readonly homePosition: THREE.Vector3;

  private diveElapsed = 0;
  private diving = false;
  private diveAngle = 0;

  /** Rolled fresh for each dive — see KEEPER_TIMING_JITTER. */
  private reactionTime = KEEPER_REACTION_SECONDS;
  private diveDuration = KEEPER_DIVE_SECONDS;

  /**
   * The zone the keeper committed to, before any late correction. Kept separate
   * from `diveTarget` so the correction can be measured against it and capped.
   */
  private readonly committedTarget = new THREE.Vector3();

  /**
   * The keeper's misjudgement of *this* flight, rolled once per kick.
   *
   * Rolling it per tick instead would be wrong twice over: the dive target would
   * twitch every frame, and the errors would average out over the flight, making
   * a keeper that is on average perfect. A keeper misreads a given ball in one
   * direction and lives with it.
   */
  private predictionBias = { x: 0, y: 0 };

  /** Drives the on-the-line shuffle. Runs whenever the keeper is not diving. */
  private idleElapsed = Math.random() * 10;

  /** Scratch vector, so the per-tick update allocates nothing. */
  private readonly desired = new THREE.Vector3();

  /** Difficulty knob, exposed to the debug panel (spec §8). */
  readProbability = KEEPER_READ_PROBABILITY;

  constructor() {
    const mesh = createKeeperMesh();
    const body = createKeeperBody();

    this.link = { mesh, body };
    this.homePosition = new THREE.Vector3(0, KEEPER_HEIGHT / 2, GOAL_LINE_Z + 0.35);
    this.returnHome();
  }

  /** Which zone a point in the goal mouth falls into. */
  static zoneOf(point: THREE.Vector3): KeeperZone {
    const column = nearestIndex(KEEPER_ZONE_COLUMNS, point.x);
    const row = nearestIndex(KEEPER_ZONE_ROWS, point.y);
    return { column, row };
  }

  /**
   * React to the kick (spec §8).
   *
   * Two separate judgements, and it matters that they are separate:
   *
   * 1. **Is this shot even going in?** Answered by watching the ball — the
   *    keeper estimates where it will cross the goal plane and lets clear misses
   *    go. This uses the ball's real velocity, which sounds like cheating but is
   *    not: judging the flight of a struck ball is exactly what a keeper does
   *    with their eyes, and `KEEPER_PREDICTION_ERROR` keeps the estimate fuzzy.
   *
   * 2. **Where is it going?** Answered by *guessing*, from the aim point, with
   *    probability `readProbability` of reading it correctly. This stays a guess
   *    because it is the difficulty dial: a keeper that computed the answer here
   *    would be unbeatable, and one that never read it would be exploitable by
   *    finding a magic spot and repeating it forever.
   *
   * Returns the chosen zone, or null if the keeper decided to watch it miss.
   */
  reactToKick(aimPoint: THREE.Vector3, ball: CANNON.Body): KeeperZone | null {
    this.predictionBias = {
      x: signedJitter(KEEPER_PREDICTION_ERROR),
      y: signedJitter(KEEPER_PREDICTION_ERROR),
    };

    const predicted = this.readFlight(ball);

    if (predicted !== null && isClearlyMissing(predicted)) {
      // Stand up and watch it go. Diving here is what made it look stupid.
      this.diving = false;
      return null;
    }

    const trueZone = Keeper.zoneOf(aimPoint);
    const readsIt = Math.random() < this.readProbability;

    const zone = readsIt ? trueZone : pickDifferentZone(trueZone);
    this.beginDive(zone);
    return zone;
  }

  private beginDive(zone: KeeperZone): void {
    const x = KEEPER_ZONE_COLUMNS[zone.column] ?? 0;
    const y = KEEPER_ZONE_ROWS[zone.row] ?? KEEPER_ZONE_ROWS[0] ?? 1;

    /**
     * The keeper's *body centre* is what moves, so a low dive puts the centre
     * near the ground and a high one lifts it.
     */
    /**
     * Jitter the dive: where it ends up, how quickly it gets going, and how long
     * the full stretch takes. `signedJitter` is centred on zero, so on average
     * the keeper still dives exactly where it decided to.
     */
    this.diveTarget.set(
      x + signedJitter(KEEPER_REACH_JITTER),
      Math.max(y + signedJitter(KEEPER_REACH_JITTER * 0.6), KEEPER_RADIUS),
      GOAL_LINE_Z + 0.35,
    );
    this.committedTarget.copy(this.diveTarget);

    this.reactionTime = Math.max(0, KEEPER_REACTION_SECONDS + signedJitter(KEEPER_TIMING_JITTER));

    // Reaching above resting height costs time; dropping below it saves a little.
    const climb = this.diveTarget.y - this.homePosition.y;
    const heightScale = 1 + climb * KEEPER_HIGH_DIVE_PENALTY;

    this.diveDuration = Math.max(
      0.2,
      KEEPER_DIVE_SECONDS * heightScale + signedJitter(KEEPER_TIMING_JITTER * 1.6),
    );

    /**
     * How far to rotate into the dive.
     *
     * This is not decoration — it is what makes the six zones mean anything. An
     * upright 1.75 m capsule is tall and narrow, so it covers both rows of a
     * column and almost no extra width, collapsing the grid to three zones. A
     * *horizontal* keeper covers ~1.75 m of width and only ~0.55 m of height,
     * so the column extends its reach towards the corner while the row genuinely
     * decides whether a high or low shot beats it.
     *
     * Rotating the local +Y axis towards +X is a rotation about Z of -90°, hence
     * the sign. Central dives stay upright.
     */
    const lateralFraction = Math.min(Math.abs(x) / MAX_ZONE_OFFSET, 1);
    this.diveAngle = -Math.sign(x) * lateralFraction * MAX_DIVE_ANGLE;

    /**
     * A dive straight down the middle has no lateral distance and therefore no
     * rotation, which on screen is indistinguishable from standing still. Give
     * it a hop and a token lean so it reads as a save attempt.
     */
    if (lateralFraction < 0.2) {
      this.diveTarget.y += KEEPER_CENTRE_HOP;
      this.diveAngle = signedJitter(MAX_DIVE_ANGLE * 0.18);
    }
    // From the *body*, not the mesh: the body owns position (spec §5), and the
    // mesh only catches up at render time. With the idle shuffle running, the
    // keeper is rarely at dead centre when the kick comes, so this is the
    // difference between diving from where it is and from where it used to be.
    const { position } = this.link.body;
    this.diveOrigin.set(position.x, position.y, position.z);
    this.diveElapsed = 0;
    this.diving = true;
  }

  /**
   * Advance the dive by one physics tick.
   *
   * The keeper is moved by *setting a velocity that will land it where it should
   * be after this tick*: v = (desired - current) / dt. The integrator then
   * applies exactly that, so the body arrives on the tween path while still
   * carrying a real velocity into any contact.
   */
  update(fixedDeltaSeconds: number, ball?: CANNON.Body): void {
    if (!this.diving) {
      this.updateIdle(fixedDeltaSeconds);
      return;
    }

    this.diveElapsed += fixedDeltaSeconds;

    if (ball !== undefined) this.correctTowards(ball, fixedDeltaSeconds);

    const afterReaction = Math.max(0, this.diveElapsed - this.reactionTime);
    const progress = Math.min(afterReaction / this.diveDuration, 1);

    /**
     * Ease-out quadratic: explosive off the line, decelerating into the stretch.
     * Linear motion reads as a sliding box; an eased curve reads as a body
     * committing. The exponent is also a difficulty dial — a sharper ease-out
     * gets the keeper to the corner sooner and saves more shots.
     */
    const eased = 1 - Math.pow(1 - progress, 2);

    const desired = this.diveOrigin.clone().lerp(this.diveTarget, eased);
    this.setVelocityTowards(desired, fixedDeltaSeconds);

    /**
     * Orientation is set directly rather than driven by angular velocity. For
     * position that would be wrong (a teleporting body carries no contact
     * velocity, so the ball would dribble off it) but the dive's *spin* adds
     * almost nothing to the contact, and tweening a quaternion by hand is much
     * easier to reason about than integrating an angular velocity to hit a
     * target pose exactly.
     */
    this.link.body.quaternion.setFromAxisAngle(
      DIVE_AXIS,
      this.diveAngle * eased,
    );

    if (progress >= 1) this.diving = false;
  }

  private setVelocityTowards(desired: THREE.Vector3, fixedDeltaSeconds: number): void {
    const body = this.link.body;

    body.velocity.set(
      (desired.x - body.position.x) / fixedDeltaSeconds,
      (desired.y - body.position.y) / fixedDeltaSeconds,
      (desired.z - body.position.z) / fixedDeltaSeconds,
    );

    this.clampSpeed(KEEPER_MAX_DIVE_SPEED);
  }

  /** Keep the body's velocity within a human ceiling — see the constants. */
  private clampSpeed(limit: number): void {
    const { velocity } = this.link.body;
    const speed = velocity.length();

    if (speed > limit) velocity.scale(limit / speed, velocity);
  }

  /**
   * Late correction: steer the dive towards where the ball is actually going.
   *
   * The keeper committed to a zone before it could know, and a body already in
   * the air cannot change its mind — but it can stretch. So the dive target is
   * allowed to drift from the committed zone towards the predicted crossing
   * point, by at most `KEEPER_CORRECTION_LIMIT` metres.
   *
   * That cap is the whole design. Without a correction the keeper looks blind:
   * it dives past a curling ball with no attempt to adjust, and a shot bent
   * around it goes in untouched. With an uncapped one, the initial guess stops
   * mattering and the difficulty dial does nothing. Half a metre buys the
   * fingertip save without rescuing a keeper who went the wrong way.
   */
  private correctTowards(ball: CANNON.Body, fixedDeltaSeconds: number): void {
    const predicted = this.readFlight(ball);
    if (predicted === null) return;

    const offsetX = predicted.x - this.committedTarget.x;
    const offsetY = predicted.y - this.committedTarget.y;

    const distance = Math.hypot(offsetX, offsetY);
    if (distance < 1e-4) return;

    const allowed = Math.min(distance, KEEPER_CORRECTION_LIMIT) / distance;

    // Where the correction is allowed to end up...
    const goalX = this.committedTarget.x + offsetX * allowed;
    const goalY = Math.max(this.committedTarget.y + offsetY * allowed, KEEPER_RADIUS);

    // ...and how far it may travel towards it this tick. Without this rate cap
    // the target can snap across the whole allowance in one step, and since the
    // dive is driven by (desired − current) / dt, that snap becomes an enormous
    // keeper velocity and punts the ball into orbit.
    const step = KEEPER_CORRECTION_RATE * fixedDeltaSeconds;
    this.diveTarget.x = moveTowards(this.diveTarget.x, goalX, step);
    this.diveTarget.y = moveTowards(this.diveTarget.y, goalY, step);
  }

  /**
   * Shift weight on the line, and pick itself up after a dive.
   *
   * The move towards the resting pose is a proportional lerp rather than the
   * exact `setVelocityTowards` used mid-dive: from a full-stretch dive the exact
   * form would demand the entire distance in a single tick, and a kinematic body
   * moving several metres per frame would launch the ball into orbit on contact.
   */
  private updateIdle(fixedDeltaSeconds: number): void {
    this.idleElapsed += fixedDeltaSeconds;

    const sway = Math.sin(this.idleElapsed * KEEPER_IDLE_SPEED) * KEEPER_IDLE_SWAY;
    const bob = Math.abs(Math.sin(this.idleElapsed * KEEPER_IDLE_SPEED * 2)) * 0.045;

    this.desired.set(
      this.homePosition.x + sway,
      this.homePosition.y + bob,
      this.homePosition.z,
    );

    const approach = Math.min(1, fixedDeltaSeconds * 4);
    const body = this.link.body;
    this.desired.set(
      body.position.x + (this.desired.x - body.position.x) * approach,
      body.position.y + (this.desired.y - body.position.y) * approach,
      body.position.z + (this.desired.z - body.position.z) * approach,
    );

    this.setVelocityTowards(this.desired, fixedDeltaSeconds);

    // Never scramble back faster than a person gets up.
    this.clampSpeed(KEEPER_RECOVERY_SPEED);

    // Straighten up again after a dive.
    body.quaternion.slerp(UPRIGHT, approach, body.quaternion);
  }

  /** Where the keeper *believes* the ball will cross, bias included. */
  private readFlight(ball: CANNON.Body): { x: number; y: number } | null {
    const predicted = predictCrossing(ball);
    if (predicted === null) return null;

    return {
      x: predicted.x + this.predictionBias.x,
      y: predicted.y + this.predictionBias.y,
    };
  }

  /** Snap back to the centre of the goal, at rest, for the next kick. */
  returnHome(): void {
    const body = this.link.body;

    body.position.set(this.homePosition.x, this.homePosition.y, this.homePosition.z);
    body.velocity.setZero();
    body.angularVelocity.setZero();
    body.quaternion.set(0, 0, 0, 1);
    body.wakeUp();

    this.link.mesh.position.copy(this.homePosition);
    this.link.mesh.quaternion.identity();
    this.diving = false;
    this.diveElapsed = 0;
    this.diveAngle = 0;
  }
}

/**
 * A capsule: a cylinder with hemispherical caps. It is the standard character
 * shape because it has no edges to catch on geometry.
 *
 * cannon-es has no capsule primitive, so the *body* is a box of the same
 * bounding size. Visual and collision shapes disagreeing slightly is normal and
 * fine — the box is marginally more generous at the corners, which costs the
 * player a few saves they might have squeezed past a true capsule.
 */
function createKeeperMesh(): THREE.Mesh {
  const geometry = new THREE.CapsuleGeometry(
    KEEPER_RADIUS,
    KEEPER_HEIGHT - KEEPER_RADIUS * 2,
    4,
    12,
  );
  const material = new THREE.MeshLambertMaterial({
    color: PALETTE.keeper,
    flatShading: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'keeper';
  mesh.castShadow = true;
  return mesh;
}

function createKeeperBody(): CANNON.Body {
  return new CANNON.Body({
    type: CANNON.Body.KINEMATIC,
    shape: new CANNON.Box(
      new CANNON.Vec3(KEEPER_RADIUS, KEEPER_REACH_HALF_LENGTH, KEEPER_RADIUS),
    ),
    material: MATERIALS.keeper,
  });
}

/**
 * Where the ball will cross the goal plane, as the keeper estimates it.
 *
 * Plain projectile motion: horizontal velocity is constant, so the flight time
 * to z = 0 falls straight out of the current position and z-velocity, and the
 * vertical drop over that time is ½·g·t². It ignores drag and the curve force,
 * which is fine and even desirable — the keeper is reading the flight by eye in
 * the first fraction of a second, not integrating the trajectory.
 *
 * Returns null if the ball is not travelling towards the goal at all.
 */
function predictCrossing(ball: CANNON.Body): { x: number; y: number } | null {
  const towardsGoal = -ball.velocity.z;
  if (towardsGoal <= 0.1) return null;

  const flightTime = (ball.position.z - GOAL_LINE_Z) / towardsGoal;
  if (flightTime < 0) return null;

  return {
    x: ball.position.x + ball.velocity.x * flightTime,
    y:
      ball.position.y +
      ball.velocity.y * flightTime -
      0.5 * GRAVITY * flightTime * flightTime,
  };
}

/** Is this shot missing by enough that diving would just look silly? */
function isClearlyMissing(predicted: { x: number; y: number }): boolean {
  const outsidePosts = Math.abs(predicted.x) > GOAL_WIDTH / 2 + KEEPER_IGNORE_MARGIN;
  const overTheBar = predicted.y > GOAL_HEIGHT + KEEPER_IGNORE_MARGIN;

  return outsidePosts || overTheBar;
}

/** Step `current` towards `goal` by at most `maxStep`. */
function moveTowards(current: number, goal: number, maxStep: number): number {
  const delta = goal - current;
  if (Math.abs(delta) <= maxStep) return goal;
  return current + Math.sign(delta) * maxStep;
}

/** A random offset in [-amount, +amount], averaging zero. */
function signedJitter(amount: number): number {
  return (Math.random() * 2 - 1) * amount;
}

/** Index of the entry in `values` closest to `value`. */
function nearestIndex(values: readonly number[], value: number): number {
  let bestIndex = 0;
  let bestDistance = Infinity;

  values.forEach((candidate, index) => {
    const distance = Math.abs(candidate - value);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return bestIndex;
}

/**
 * Pick among the five zones that are not the true one, weighted by column.
 *
 * Not uniform: staying central is only the right call if the taker goes down the
 * middle, so a keeper that picked the centre as often as either side would be
 * both weaker and duller to play against.
 */
function pickDifferentZone(trueZone: KeeperZone): KeeperZone {
  const others: { zone: KeeperZone; weight: number }[] = [];
  let totalWeight = 0;

  for (let column = 0; column < KEEPER_ZONE_COLUMNS.length; column++) {
    for (let row = 0; row < KEEPER_ZONE_ROWS.length; row++) {
      if (column === trueZone.column && row === trueZone.row) continue;

      const weight = KEEPER_COLUMN_WEIGHTS[column] ?? 1;
      totalWeight += weight;
      others.push({ zone: { column, row }, weight });
    }
  }

  let roll = Math.random() * totalWeight;
  for (const candidate of others) {
    roll -= candidate.weight;
    if (roll <= 0) return candidate.zone;
  }

  return others[others.length - 1]?.zone ?? trueZone;
}
