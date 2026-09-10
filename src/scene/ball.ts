import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BALL_MASS, BALL_RADIUS, PALETTE, PENALTY_SPOT_DISTANCE } from '../constants';
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
