import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {
  GOAL_HEIGHT,
  GOAL_LINE_Z,
  GOAL_WIDTH,
  PALETTE,
  POST_RADIUS,
} from '../constants';
import { MATERIALS } from '../physics/physics';

/**
 * A Three.js `Scene` is a *scene graph*: a tree of objects, each with a local
 * position/rotation/scale. A child's world transform is its parent's transform
 * composed with its own. Nothing here draws by itself — the renderer walks this
 * tree once per frame and issues draw calls.
 */
export function createWorld(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);

  /**
   * Fog fades distant geometry towards a colour. It costs nothing and hides the
   * hard edge where our finite pitch plane stops.
   */
  scene.fog = new THREE.Fog(PALETTE.fog, 30, 130);

  scene.add(createPitch());
  scene.add(createGoal());
  addLighting(scene);

  return scene;
}

/**
 * The pitch is a single flat plane.
 *
 * A `PlaneGeometry` is created in the XY plane facing +Z, so it stands upright
 * like a wall. Rotating it -90° about X lays it down as a floor. (Three.js
 * rotations are in radians.)
 */
function createPitch(): THREE.Object3D {
  const pitch = new THREE.Group();

  const geometry = new THREE.PlaneGeometry(300, 300);
  const material = new THREE.MeshLambertMaterial({ color: PALETTE.grass });
  const ground = new THREE.Mesh(geometry, material);
  ground.rotation.x = -Math.PI / 2;
  // Push the plane a hair below y = 0 so it never z-fights with flat decals.
  ground.position.set(0, -0.001, 0);
  ground.receiveShadow = true;
  pitch.add(ground);

  // Mowing stripes: thin darker planes laid on top, purely decorative.
  const stripeMaterial = new THREE.MeshLambertMaterial({
    color: PALETTE.grassStripe,
  });
  for (let i = 0; i < 10; i++) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(60, 4), stripeMaterial);
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(0, 0, GOAL_LINE_Z + 2 + i * 8);
    stripe.receiveShadow = true;
    pitch.add(stripe);
  }

  return pitch;
}

/**
 * The goal frame: two posts and a crossbar, built from cylinders.
 *
 * `CylinderGeometry` is generated standing up along +Y, so the posts need no
 * rotation and the crossbar is rotated 90° about Z to lie horizontally.
 *
 * In phase 3 these same three cylinders get static physics bodies so the ball
 * can rattle off them. Keeping the dimensions in one place (constants.ts) is
 * what makes that cheap.
 */
function createGoal(): THREE.Object3D {
  const goal = new THREE.Group();
  goal.name = 'goal';

  const material = new THREE.MeshLambertMaterial({ color: PALETTE.goalFrame });
  const halfWidth = GOAL_WIDTH / 2;

  const postGeometry = new THREE.CylinderGeometry(
    POST_RADIUS,
    POST_RADIUS,
    GOAL_HEIGHT,
    16,
  );

  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(postGeometry, material);
    // A cylinder's origin is its centre, so lift it by half its height.
    post.position.set(side * halfWidth, GOAL_HEIGHT / 2, GOAL_LINE_Z);
    post.castShadow = true;
    goal.add(post);
  }

  const barGeometry = new THREE.CylinderGeometry(
    POST_RADIUS,
    POST_RADIUS,
    GOAL_WIDTH + POST_RADIUS * 2,
    16,
  );
  const crossbar = new THREE.Mesh(barGeometry, material);
  crossbar.rotation.z = Math.PI / 2;
  crossbar.position.set(0, GOAL_HEIGHT, GOAL_LINE_Z);
  crossbar.castShadow = true;
  goal.add(crossbar);

  goal.add(createNet());

  return goal;
}

/**
 * Placeholder net (spec §9: static semi-transparent mesh is fine for v1).
 * Three quads — back, roof, and two sides — behind the goal line at -Z.
 */
function createNet(): THREE.Object3D {
  const net = new THREE.Group();
  net.name = 'net';

  const depth = 2;
  const material = new THREE.MeshLambertMaterial({
    color: PALETTE.net,
    transparent: true,
    opacity: 0.14,
    // A plane is only drawn from the side its normal faces unless we say
    // otherwise; the net must be visible from both inside and outside.
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const back = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_WIDTH, GOAL_HEIGHT), material);
  back.position.set(0, GOAL_HEIGHT / 2, GOAL_LINE_Z - depth);
  net.add(back);

  const roof = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_WIDTH, depth), material);
  roof.rotation.x = -Math.PI / 2;
  roof.position.set(0, GOAL_HEIGHT, GOAL_LINE_Z - depth / 2);
  net.add(roof);

  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(depth, GOAL_HEIGHT), material);
    wall.rotation.y = Math.PI / 2;
    wall.position.set((side * GOAL_WIDTH) / 2, GOAL_HEIGHT / 2, GOAL_LINE_Z - depth / 2);
    net.add(wall);
  }

  return net;
}

/**
 * Lighting (spec §9: one directional light plus ambient).
 *
 * - `AmbientLight` adds a flat amount of light to every surface regardless of
 *   orientation. Without it, everything facing away from the sun is pure black.
 * - `DirectionalLight` models a light infinitely far away, so all its rays are
 *   parallel — the sun. Its `position` only sets the *direction* it shines from
 *   (towards its `target`, which defaults to the origin); distance is irrelevant.
 *
 * Shadow mapping works by rendering the scene from the light's point of view
 * into a depth texture. Because a directional light has no perspective, that
 * render uses an orthographic camera, and we must size its box to cover the area
 * we care about — anything outside it simply casts no shadow.
 */
function addLighting(scene: THREE.Scene): void {
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));

  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-12, 18, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);

  const shadowCamera = sun.shadow.camera;
  shadowCamera.left = -20;
  shadowCamera.right = 20;
  shadowCamera.top = 20;
  shadowCamera.bottom = -20;
  shadowCamera.near = 1;
  shadowCamera.far = 60;
  shadowCamera.updateProjectionMatrix();

  scene.add(sun);
}

/**
 * The goal's physics half: three solid cylinders and one invisible sensor box.
 *
 * These are static (`mass: 0`) bodies with no meshes of their own — the frame is
 * already drawn by `createGoal()` above, and they are positioned from the same
 * constants, so the two agree by construction.
 */
export interface GoalColliders {
  /** Left post, right post, crossbar. Anything the ball can rattle off. */
  frame: CANNON.Body[];
  /** The scoring volume just behind the goal line. */
  sensor: CANNON.Body;
}

export function createGoalColliders(): GoalColliders {
  return { frame: createFrameBodies(), sensor: createGoalSensor() };
}

/**
 * Posts and crossbar as collision geometry.
 *
 * cannon-es builds a `Cylinder` along its local +Y axis — the same convention as
 * Three.js `CylinderGeometry` — so these need exactly the rotations their meshes
 * needed: none for the posts, 90° about Z for the bar.
 *
 * Spec §7 is right that this is free fun: nothing here special-cases a post hit.
 * The ball rattling in off the underside of the bar is just the solver doing its
 * job, and it is the moment the physics engine starts paying for itself.
 */
function createFrameBodies(): CANNON.Body[] {
  const bodies: CANNON.Body[] = [];
  const halfWidth = GOAL_WIDTH / 2;

  for (const side of [-1, 1]) {
    const post = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Cylinder(POST_RADIUS, POST_RADIUS, GOAL_HEIGHT, 12),
      material: MATERIALS.frame,
    });
    post.position.set(side * halfWidth, GOAL_HEIGHT / 2, GOAL_LINE_Z);
    bodies.push(post);
  }

  /**
   * The crossbar is a Box, not a Cylinder — deliberately, and not for tidiness.
   *
   * cannon-es implements `Cylinder` as a `ConvexPolyhedron`, and a *rotated*
   * convex polyhedron does not produce a contact the solver will resolve: a ball
   * dropped onto a crossbar-shaped cylinder rotated 90° fires a collision event
   * and then falls straight through it. Upright cylinders (the posts) are fine,
   * which is why only the bar is affected.
   *
   * A box needs no rotation at all — it can simply be made long in X — and it
   * sidesteps the bug entirely. The visible crossbar stays a cylinder; collision
   * shapes have never had to match the mesh.
   */
  const crossbar = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Box(
      new CANNON.Vec3(GOAL_WIDTH / 2 + POST_RADIUS, POST_RADIUS, POST_RADIUS),
    ),
    material: MATERIALS.frame,
  });
  crossbar.position.set(0, GOAL_HEIGHT, GOAL_LINE_Z);
  bodies.push(crossbar);

  return bodies;
}

/**
 * The goal sensor (spec §7).
 *
 * A **sensor** (cannon-es calls it a trigger) is a body that takes part in
 * collision *detection* but not in collision *response*: `isTrigger` keeps the
 * contact out of the solver, so the ball passes straight through while still
 * firing a `collide` event. That is the whole mechanism behind "did it go in".
 *
 * Detecting a goal this way rather than by testing the ball's position each tick
 * matters because of tunnelling: a 30 m/s shot moves half a metre per 60 Hz
 * step, so a position check against the goal *line* could be on one side at tick
 * n and well past it at tick n+1. A box with real depth is much harder to skip,
 * and cannon-es's own collision detection does the work.
 *
 * The box spans the full mouth (so a shot inside the post but under the bar
 * counts) and sits behind the line, so the ball must fully cross to score.
 *
 * `CANNON.Box` takes *half* extents, not sizes — a common off-by-two.
 */
function createGoalSensor(): CANNON.Body {
  const halfDepth = 0.25;

  const sensor = new CANNON.Body({
    mass: 0,
    isTrigger: true,
    shape: new CANNON.Box(
      new CANNON.Vec3(GOAL_WIDTH / 2, GOAL_HEIGHT / 2, halfDepth),
    ),
  });

  // Front face at z = -0.1, so the ball's centre is a radius past the line.
  sensor.position.set(0, GOAL_HEIGHT / 2, GOAL_LINE_Z - halfDepth - 0.1);

  return sensor;
}
