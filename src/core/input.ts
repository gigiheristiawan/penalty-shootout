import * as THREE from 'three';

/**
 * Input: raw browser events → semantic game events.
 *
 * Nothing downstream should ever see a `PointerEvent`. The rest of the game
 * asks about "aim", "charge", "kick" — which is what makes it possible to add
 * touch or keyboard control in phase 7 by changing only this file.
 *
 * This module deliberately holds no game logic. It does not know whether the
 * game is currently accepting a kick; the state machine (phase 3) decides that
 * by checking the current state when a handler fires.
 */

export interface InputHandlers {
  /** Pointer moved. `ndc` is in normalized device coordinates (see below). */
  onAim(ndc: THREE.Vector2): void;
  /** Primary button pressed — begin charging. */
  onChargeStart(): void;
  /** Primary button released — take the kick. */
  onChargeRelease(): void;
  /** Curve bias nudged before the kick. `delta` is -1 (left) or +1 (right). */
  onCurve(delta: number): void;
  /** Confirm / restart (space or enter on the result screen). */
  onConfirm(): void;
  /** Debug/reset key. */
  onReset(): void;
  /** Toggle the dev orbit camera. */
  onToggleOrbit(): void;
  /** Toggle sound. */
  onToggleMute(): void;
  /** Toggle the debug panel. */
  onToggleDebug(): void;
}

/**
 * Normalized device coordinates (NDC) are the coordinate system the GPU works
 * in after projection: x and y both run from -1 to +1 across the viewport, with
 * (0, 0) at the centre and +y *up*.
 *
 * DOM pointer coordinates are the opposite in almost every way: pixels, origin
 * at the top-left, +y down. Converting is the standard first step of any
 * screen → world operation, and `Raycaster.setFromCamera` expects NDC exactly.
 */
function toNormalizedDeviceCoords(
  event: PointerEvent,
  element: HTMLElement,
  out: THREE.Vector2,
): THREE.Vector2 {
  const bounds = element.getBoundingClientRect();

  const x = (event.clientX - bounds.left) / bounds.width;
  const y = (event.clientY - bounds.top) / bounds.height;

  return out.set(x * 2 - 1, -(y * 2 - 1));
}

/** Attaches all listeners. Returns a function that detaches them. */
export function createInput(
  element: HTMLElement,
  handlers: InputHandlers,
): () => void {
  // Reused across events so that moving the mouse allocates nothing. Per-frame
  // allocation is the classic source of GC stutter in a game loop.
  const ndc = new THREE.Vector2();

  function handlePointerMove(event: PointerEvent): void {
    handlers.onAim(toNormalizedDeviceCoords(event, element, ndc));
  }

  function handlePointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;

    /**
     * Pointer capture routes all further events for this pointer to this
     * element, even if the cursor leaves it. Without it, releasing the mouse
     * outside the canvas would drop the `pointerup` and leave the meter charging
     * forever.
     */
    element.setPointerCapture(event.pointerId);
    handlers.onChargeStart();
  }

  function handlePointerUp(event: PointerEvent): void {
    if (event.button !== 0) return;

    if (element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
    handlers.onChargeRelease();
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.repeat) return;

    switch (event.code) {
      case 'KeyA':
      case 'ArrowLeft':
        handlers.onCurve(-1);
        break;
      case 'KeyD':
      case 'ArrowRight':
        handlers.onCurve(1);
        break;
      case 'Space':
      case 'Enter':
        // Space would otherwise scroll the page / re-click a focused button.
        event.preventDefault();
        handlers.onConfirm();
        break;
      case 'KeyR':
        handlers.onReset();
        break;
      case 'KeyO':
        handlers.onToggleOrbit();
        break;
      case 'KeyM':
        handlers.onToggleMute();
        break;
      case 'Backquote':
        handlers.onToggleDebug();
        break;
      default:
        break;
    }
  }

  element.addEventListener('pointermove', handlePointerMove);
  element.addEventListener('pointerdown', handlePointerDown);
  element.addEventListener('pointerup', handlePointerUp);
  // If the OS steals the pointer (alt-tab mid-drag), treat it as a release.
  element.addEventListener('pointercancel', handlePointerUp);
  window.addEventListener('keydown', handleKeyDown);

  return () => {
    element.removeEventListener('pointermove', handlePointerMove);
    element.removeEventListener('pointerdown', handlePointerDown);
    element.removeEventListener('pointerup', handlePointerUp);
    element.removeEventListener('pointercancel', handlePointerUp);
    window.removeEventListener('keydown', handleKeyDown);
  };
}
