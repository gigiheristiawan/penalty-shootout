import type * as THREE from 'three';
import type * as CANNON from 'cannon-es';

/**
 * The sync layer: the one place where the physics simulation and the scene graph
 * meet.
 *
 * Each `PhysicsLink` pairs a mesh with the body that owns its transform. After
 * every batch of physics steps we copy body → mesh. This is the only direction
 * data ever flows (spec §5).
 */
export interface PhysicsLink {
  mesh: THREE.Object3D;
  body: CANNON.Body;
}

/**
 * Copy each body's position and orientation onto its mesh.
 *
 * The two libraries use structurally identical types (`CANNON.Vec3` /
 * `THREE.Vector3`, and both quaternions are x,y,z,w) but they are separate
 * classes, so the values are copied component-wise rather than assigned.
 *
 * Note there is no interpolation here. Physics runs at a fixed 60 Hz while the
 * display may refresh at 144 Hz, so some frames show a transform that is up to
 * one tick stale — a sub-millimetre judder at these speeds. The fix is to
 * interpolate between the previous and current body transform by the loop's
 * leftover-time fraction; it is worth adding only if it turns out to be visible.
 */
export function syncMeshes(links: readonly PhysicsLink[]): void {
  for (const link of links) {
    const { position, quaternion } = link.body;

    link.mesh.position.set(position.x, position.y, position.z);
    link.mesh.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  }
}
