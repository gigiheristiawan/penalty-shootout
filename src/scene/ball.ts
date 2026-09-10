import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {
  BALL_MASS,
  BALL_RADIUS,
  CURVE_FORCE,
  GRAVITY,
  KICK_MAX_SPEED,
  KICK_MIN_SPEED,
  PALETTE,
  PENALTY_SPOT_DISTANCE,
} from '../constants';
import { MATERIALS } from '../physics/physics';
import type { PhysicsLink } from '../physics/sync';

/**
 * The ball, as the pairing of a mesh (what you see) and a body (what is true).
 * From here on the body owns the position; the mesh is copied from it each
 * frame by the sync layer.
 */
export function createBall(): PhysicsLink {
  const mesh = createBallMesh();
  const body = createBallBody();
  return { mesh, body };
}

/**
 * `SphereGeometry(radius, widthSegments, heightSegments)` — the segment counts
 * are the tessellation. 24×16 is plenty for a 0.11 m ball on screen; geometry
 * costs vertices, so there is no reason to pay for 64×64 here.
 */
function createBallMesh(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(BALL_RADIUS, 24, 16);

  /**
   * `MeshLambertMaterial` shades per-vertex with a simple diffuse model: no
   * specular highlight, no roughness/metalness. That flat look is the palette
   * choice from spec §9, and it is far cheaper than MeshStandardMaterial's PBR.
   * `flatShading` makes each triangle use a single normal, so the facets show —
   * which is also what makes the ball's spin readable once it is rolling.
   */
  const material = new THREE.MeshLambertMaterial({
    color: PALETTE.ball,
    flatShading: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'ball';
  mesh.castShadow = true;
  return mesh;
}

/**
 * A dynamic body: it has mass, so gravity and impacts move it.
 *
 * The collision shape is a perfect `Sphere`, entirely independent of the mesh's
 * 24×16 approximation. Shape and mesh agreeing is a decision *we* make by
 * passing the same radius — nothing enforces it. Keeping collision shapes
 * simpler than the visuals is the norm, and a sphere is the cheapest and most
 * numerically stable shape there is.
 *
 * `linearDamping` / `angularDamping` bleed off a small fraction of velocity each
 * step. Physically this stands in for air resistance; practically it stops a
 * frictionless-looking ball from rolling forever.
 */
function createBallBody(): CANNON.Body {
  const body = new CANNON.Body({
    mass: BALL_MASS,
    shape: new CANNON.Sphere(BALL_RADIUS),
    material: MATERIALS.ball,
    linearDamping: 0.12,
    angularDamping: 0.25,
  });

  resetBall(body);
  return body;
}

/**
 * Put the ball back on the penalty spot, at rest.
 *
 * Resetting a body means clearing its *motion*, not just its position: leftover
 * velocity or an accumulated force would otherwise be applied on the next tick
 * and fire the ball off the spot. This is the "no physics explosions on
 * restart" line in spec §11, and it is why the reset lives in one function.
 */
export function resetBall(body: CANNON.Body, height = BALL_RADIUS): void {
  body.position.set(0, height, PENALTY_SPOT_DISTANCE);
  body.quaternion.set(0, 0, 0, 1);

  body.velocity.setZero();
  body.angularVelocity.setZero();
  body.force.setZero();
  body.torque.setZero();

  // A sleeping body ignores position changes until something wakes it.
  body.wakeUp();
}

/** The painted penalty spot — a flat disc on the grass, decoration only. */
export function createPenaltySpot(): THREE.Mesh {
  const spot = new THREE.Mesh(
    new THREE.CircleGeometry(0.11, 24),
    new THREE.MeshLambertMaterial({ color: PALETTE.goalFrame }),
  );
  spot.rotation.x = -Math.PI / 2;
  spot.position.set(0, 0.01, PENALTY_SPOT_DISTANCE);
  spot.receiveShadow = true;
  return spot;
}

/**
 * Kick the ball at a target point (spec §7: one impulse from aim, power and
 * elevation).
 *
 * An **impulse** is an instantaneous change of momentum: J = m · Δv, measured in
 * newton-seconds. It is the right tool for a kick because the contact lasts
 * ~10 ms — far shorter than one 16 ms physics tick — so modelling it as a force
 * applied over time would need a sub-step the simulation does not have.
 * `applyImpulse` divides by the mass internally, which is why a heavier ball
 * would leave slower for the same impulse.
 */
export function kickBall(
  body: CANNON.Body,
  target: THREE.Vector3,
  power: number,
): void {
  body.wakeUp();

  // Aim direction, from wherever the ball actually is to the target.
  const toTarget = new CANNON.Vec3(
    target.x - body.position.x,
    target.y - body.position.y,
    target.z - body.position.z,
  );

  const speed = KICK_MIN_SPEED + (KICK_MAX_SPEED - KICK_MIN_SPEED) * power;
  const velocity = toTarget.unit().scale(speed);

  /**
   * Gravity compensation.
   *
   * Firing straight at the target would undershoot badly: at ~25 m/s the ball
   * takes ~0.45 s to cover 11 m and falls ~1 m in that time, so aiming at the
   * top corner would hit the turf. A real taker corrects for this without
   * thinking; the aim marker should mean what it says, so we do it in code.
   *
   * Projectile motion: vertical drop over a flight time t is ½·g·t². Adding
   * ½·g·t to the vertical velocity cancels exactly that drop. The flight time
   * is estimated from the horizontal speed, which is a slight underestimate
   * (the extra lift stretches the flight a little) — the residual error is a
   * few centimetres, and linear damping eats some of it back.
   */
  const horizontalDistance = Math.hypot(toTarget.x, toTarget.z);
  const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
  const flightTime = horizontalDistance / horizontalSpeed;
  velocity.y += 0.5 * GRAVITY * flightTime;

  // Δv is the whole velocity because the ball starts at rest on the spot.
  body.applyImpulse(velocity.scale(body.mass));
}

/**
 * Curve — a fake Magnus effect (spec §7).
 *
 * Real curve comes from spin. A spinning ball drags a thin layer of air around
 * with it; on one side that layer moves with the airflow and on the other
 * against it, so pressure differs across the ball and it is pushed sideways.
 * That is the Magnus force, and it depends on the spin axis, the spin rate and
 * the airspeed, all of which change continuously through the flight.
 *
 * cannon-es models none of it — it has no fluid. Simulating it properly would
 * mean tracking angular velocity and computing ω × v every tick, which is
 * doable but tunes badly: the player sets a curve *intent* before the kick, not
 * a spin vector.
 *
 * So this is a constant sideways force while the ball is airborne. It bends the
 * path smoothly, it is trivially tunable with one number, and at penalty
 * distance nobody can tell the difference. Applying it only while the ball is
 * off the ground matters — a rolling ball being shoved sideways by an invisible
 * hand looks obviously wrong.
 */
export function applyCurve(body: CANNON.Body, curve: number): void {
  if (curve === 0) return;
  if (body.position.y < BALL_RADIUS * 1.5) return;

  body.applyForce(new CANNON.Vec3(curve * CURVE_FORCE, 0, 0));
}
