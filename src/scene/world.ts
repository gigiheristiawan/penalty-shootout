import * as THREE from 'three';
import {
  GOAL_HEIGHT,
  GOAL_LINE_Z,
  GOAL_WIDTH,
  PALETTE,
  POST_RADIUS,
} from '../constants';

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
  scene.fog = new THREE.Fog(PALETTE.fog, 25, 90);

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

  const geometry = new THREE.PlaneGeometry(80, 120);
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
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(80, 4), stripeMaterial);
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
