import * as THREE from 'three';
import {
  AIM_MARGIN_X,
  AIM_MARGIN_Y,
  GOAL_HEIGHT,
  GOAL_LINE_Z,
  GOAL_WIDTH,
  PALETTE,
} from '../constants';

/**
 * Aiming: turning a pointer position into a point in the world.
 *
 * This is *raycasting*. A perspective camera maps a 3D frustum onto a 2D
 * viewport, so a pixel does not correspond to a point in the world — it
 * corresponds to a whole ray leaving the camera through that pixel. To find out
 * what the player is pointing at, we build that ray and intersect it with
 * something.
 *
 * Raycasting is also how mouse-picking works in every 3D app (`Raycaster
 * .intersectObjects` walks meshes and tests triangles). Here we don't need a
 * mesh at all: the goal mouth is a flat vertical plane at z = 0, and
 * ray-vs-infinite-plane is a two-line closed-form solution, so it is both
 * cheaper and more accurate than intersecting geometry.
 */
export class AimController {
  private readonly raycaster = new THREE.Raycaster();

  /**
   * `THREE.Plane` is a *mathematical* plane, not geometry — a normal plus a
   * distance from the origin, with nothing to draw. The goal mouth faces the
   * player (+Z), and `constant` is the signed distance along that normal, so a
   * plane at z = 0 has constant 0.
   */
  private readonly goalPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -GOAL_LINE_Z);

  /** The current aim point in world space. Reused; never reallocated. */
  readonly target = new THREE.Vector3(0, GOAL_HEIGHT / 2, GOAL_LINE_Z);

  /** The visible marker, added to the scene by the caller. */
  readonly marker = createAimMarker();

  constructor(private readonly camera: THREE.Camera) {
    this.moveMarkerToTarget();
  }

  /**
   * Update the aim point from a pointer position in normalized device coords.
   *
   * `setFromCamera` builds the ray: its origin is the camera position and its
   * direction is that NDC point un-projected back through the inverse of the
   * camera's projection and world matrices.
   */
  aimAt(ndc: THREE.Vector2): void {
    this.raycaster.setFromCamera(ndc, this.camera);

    /**
     * `intersectPlane` writes the hit point into the target and returns null if
     * the ray is parallel to the plane or points away from it — which happens
     * whenever the pointer is above the horizon. Keeping the previous aim in
     * that case is better than snapping to nowhere.
     */
    const hit = this.raycaster.ray.intersectPlane(this.goalPlane, this.target);
    if (hit === null) return;

    this.clampTarget();
    this.moveMarkerToTarget();
  }

  /**
   * Keep the aim within reach of the goal. The margin is generous on purpose:
   * missing wide or over has to be possible, and a marker that can slide to the
   * corner flag makes the shot unreadable.
   */
  private clampTarget(): void {
    const maxX = GOAL_WIDTH / 2 + AIM_MARGIN_X;
    const maxY = GOAL_HEIGHT + AIM_MARGIN_Y;

    this.target.x = THREE.MathUtils.clamp(this.target.x, -maxX, maxX);
    // A small floor keeps the aim off the grass, where a kick has nowhere to go.
    this.target.y = THREE.MathUtils.clamp(this.target.y, 0.12, maxY);
    this.target.z = GOAL_LINE_Z;
  }

  private moveMarkerToTarget(): void {
    // Nudged towards the player so the ring never z-fights with the net quad.
    this.marker.position.set(this.target.x, this.target.y, this.target.z + 0.02);
  }

  setVisible(visible: boolean): void {
    this.marker.visible = visible;
  }
}

/**
 * A flat ring facing the player.
 *
 * `RingGeometry` lies in the XY plane facing +Z, which is exactly the goal-mouth
 * orientation, so no rotation is needed. The material is `MeshBasicMaterial` —
 * the one material that ignores lighting entirely and draws its flat colour.
 * That is correct for a UI element: a crosshair should not get darker because
 * the sun moved.
 */
function createAimMarker(): THREE.Mesh {
  const geometry = new THREE.RingGeometry(0.16, 0.22, 24);
  const material = new THREE.MeshBasicMaterial({
    color: PALETTE.aim,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    // Draw on top of the net and posts instead of being occluded by them.
    depthTest: false,
  });

  const marker = new THREE.Mesh(geometry, material);
  marker.name = 'aim-marker';
  // `renderOrder` breaks ties for transparent objects; higher draws later.
  marker.renderOrder = 10;
  return marker;
}
