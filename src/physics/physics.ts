import * as CANNON from 'cannon-es';

/**
 * The physics world.
 *
 * A physics engine is a separate simulation running alongside the render tree.
 * It knows nothing about meshes, materials or cameras — only about *bodies*:
 * a mass, a shape, a position, a velocity. Every step it integrates forces into
 * velocities, velocities into positions, then finds and resolves overlaps.
 *
 * The rule for this project (spec §5): physics owns the position of anything
 * that moves. Meshes are copied from bodies every frame, never the reverse.
 * Writing to a mesh's position would be like editing a cache and expecting the
 * database to agree.
 */

/**
 * The physics tick rate: 60 simulation steps per second, i.e. dt = 1/60 s.
 *
 * This is deliberately a *constant*, not the frame time. Numerical integration
 * is only stable and repeatable for a fixed dt: feed the same simulation a 1/144
 * step on one machine and a 1/30 step on another and the ball lands in different
 * places, and a long frame (tab switch, GC pause) can push a body straight
 * through a wall. See `core/loop.ts` for how the variable frame rate is
 * reconciled with this fixed rate.
 */
export const FIXED_TIMESTEP = 1 / 60;

/**
 * Surface materials.
 *
 * In cannon-es a `Material` is just a name — it carries no properties itself.
 * The physical behaviour lives in a `ContactMaterial`, which describes what
 * happens when *two* named materials touch. That pairing is the right model:
 * "how bouncy is the ball" is meaningless on its own; a ball is bouncy against
 * turf and dead against a net.
 */
export const MATERIALS = {
  ball: new CANNON.Material('ball'),
  ground: new CANNON.Material('ground'),
  /** Posts and crossbar (used from phase 3). */
  frame: new CANNON.Material('frame'),
};

export function createPhysicsWorld(): CANNON.World {
  const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.82, 0),
  });

  /**
   * The broadphase is the cheap first pass of collision detection: it finds
   * *candidate* pairs before the expensive exact tests run. `SAPBroadphase`
   * (sweep-and-prune) sorts bodies along an axis and only tests overlapping
   * spans — much better than the default O(n²) all-pairs scan.
   */
  world.broadphase = new CANNON.SAPBroadphase(world);

  /**
   * Sleeping: a body whose velocity stays near zero for a while is frozen and
   * skipped until something touches it. A ball resting on the spot costs nothing.
   */
  world.allowSleep = true;

  /**
   * `restitution` is bounciness: 0 = the ball dies on impact, 1 = it returns to
   * the height it fell from (no energy lost). A real football on turf is around
   * 0.6–0.7.
   *
   * `friction` resists sliding at the contact point, which is what turns a
   * skidding ball into a rolling one.
   */
  world.addContactMaterial(
    new CANNON.ContactMaterial(MATERIALS.ball, MATERIALS.ground, {
      restitution: 0.65,
      friction: 0.4,
    }),
  );

  world.addContactMaterial(
    new CANNON.ContactMaterial(MATERIALS.ball, MATERIALS.frame, {
      // Woodwork is livelier than turf — this is what makes a post hit fun.
      restitution: 0.8,
      friction: 0.1,
    }),
  );

  world.addBody(createGroundBody());

  return world;
}

/**
 * The pitch as a physics body.
 *
 * `mass: 0` means *static*: infinitely heavy, never moved by the simulation.
 * Gravity and impacts are ignored for it, which is what you want for terrain.
 *
 * A `Plane` shape is an infinite half-space, not a quad — it has no size, and
 * everything on its negative side is "inside" it. It is born facing +Z (the
 * same convention as Three.js `PlaneGeometry`), so it needs the same -90°
 * rotation about X to become a floor. Rotations on a body are set as a
 * *quaternion*: a 4-number encoding of an orientation that, unlike three Euler
 * angles, has no gimbal lock and interpolates smoothly. `setFromAxisAngle` is
 * the readable way to build one.
 */
function createGroundBody(): CANNON.Body {
  const ground = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Plane(),
    material: MATERIALS.ground,
  });

  ground.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);

  return ground;
}
