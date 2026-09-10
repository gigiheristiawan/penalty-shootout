import * as THREE from 'three';
import { EYE_HEIGHT, GOAL_HEIGHT, PENALTY_SPOT_DISTANCE } from '../constants';

/**
 * Camera feel (spec §9).
 *
 * Nothing here changes what happens in the game — the same shot scores or misses
 * either way. It changes how the shot *reads*, which is the actual product of
 * this project.
 *
 * Two effects:
 *   - **FOV punch.** Widening the field of view for a moment makes everything at
 *     the edges rush outward. That is the same trick a zoom-out gives a film
 *     camera, and the brain reads it as speed. Cheap: one number per frame.
 *   - **Shake.** A small random offset that decays. Applied as an offset from the
 *     rest position rather than by mutating the position directly, so it can
 *     never accumulate drift.
 */
export class CameraRig {
  /**
   * Framing.
   *
   * A literal first-person view — eyes at 1.6 m, standing on the spot — puts the
   * ball roughly 40° below the horizon, i.e. off the bottom of the screen. You
   * cannot aim at a ball you cannot see, so the camera sits a few metres further
   * back and looks slightly downward. It reads as "behind the ball at kick
   * height" (spec §9) while keeping both ball and goal in frame.
   */
  private readonly restPosition = new THREE.Vector3(
    0,
    EYE_HEIGHT * 0.92,
    PENALTY_SPOT_DISTANCE + 4.2,
  );
  private readonly lookTarget = new THREE.Vector3(0, GOAL_HEIGHT * 0.42, 0);
  private readonly shakeOffset = new THREE.Vector3();

  private readonly baseFov: number;
  private fovPunch = 0;
  private shakeStrength = 0;

  constructor(readonly camera: THREE.PerspectiveCamera) {
    this.baseFov = camera.fov;
    camera.position.copy(this.restPosition);
    camera.lookAt(this.lookTarget);
  }

  /** Called on kick. `power` in 0..1 scales the punch. */
  punch(power: number): void {
    this.fovPunch = 4 + power * 7;
  }

  /** Called on a post/bar hit, or any impact worth feeling. */
  shake(strength = 0.055): void {
    this.shakeStrength = Math.max(this.shakeStrength, strength);
  }

  update(fixedDeltaSeconds: number): void {
    /**
     * Exponential decay towards zero. `Math.pow(rate, dt)` rather than a plain
     * multiply keeps the decay frame-rate independent — the same reason physics
     * runs on a fixed step. (Here dt is already fixed, but writing it this way
     * means the constant still means the same thing if the tick rate changes.)
     */
    this.fovPunch *= Math.pow(0.02, fixedDeltaSeconds);
    this.shakeStrength *= Math.pow(0.008, fixedDeltaSeconds);

    this.camera.fov = this.baseFov + this.fovPunch;
    this.camera.updateProjectionMatrix();

    this.shakeOffset.set(
      (Math.random() - 0.5) * this.shakeStrength,
      (Math.random() - 0.5) * this.shakeStrength,
      0,
    );

    this.camera.position.copy(this.restPosition).add(this.shakeOffset);
    this.camera.lookAt(this.lookTarget);
  }

  /** Restore the resting lens and position exactly. */
  reset(): void {
    this.fovPunch = 0;
    this.shakeStrength = 0;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(this.restPosition);
    this.camera.lookAt(this.lookTarget);
  }
}
