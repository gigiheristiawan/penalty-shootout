import { FIXED_TIMESTEP } from '../physics/physics';

/**
 * The game loop: a fixed-timestep simulation driving a variable-rate renderer.
 *
 * The problem it solves: `requestAnimationFrame` fires whenever the display is
 * about to paint — 60 Hz here, 144 Hz there, 0 Hz in a background tab, and
 * occasionally a 200 ms outlier after a GC pause. Stepping physics by "however
 * long the last frame took" would make the simulation behave differently on
 * every machine.
 *
 * The fix is an *accumulator*. Each frame we add the elapsed real time to a
 * running total, then spend it in whole ticks of exactly FIXED_TIMESTEP:
 *
 *     accumulator += frameTime
 *     while (accumulator >= dt) { update(dt); accumulator -= dt }
 *     render()
 *
 * So both a 144 Hz and a 30 Hz display advance the world by the same amount per
 * second, with the same arithmetic — the faster one simply runs fewer physics
 * ticks per frame. The backend analogue: the simulation is a queue consumer
 * draining fixed-size units of work, not something running inline in the request
 * handler.
 *
 * Because physics runs at 240 Hz (see FIXED_TIMESTEP for why) and a typical
 * display refreshes at 60, this loop normally drains about four ticks per frame.
 * That is the accumulator doing exactly its job: the simulation rate and the
 * display rate are now completely independent numbers.
 */

export interface LoopCallbacks {
  /** One physics tick. Always receives exactly FIXED_TIMESTEP seconds. */
  update(fixedDeltaSeconds: number): void;
  /** Draw the current state. Called once per animation frame. */
  render(): void;
}

/**
 * If the loop has been starved (a background tab, a long stall), the elapsed
 * time can be huge. Running hundreds of catch-up ticks in one frame makes the
 * next frame even later, which schedules even more ticks — the "spiral of
 * death". Clamping the frame time drops the excess instead: the world runs in
 * slow motion for an instant rather than freezing outright.
 */
const MAX_FRAME_TIME = 0.25;

/** Starts the loop. Returns a function that stops it and detaches listeners. */
export function startLoop(callbacks: LoopCallbacks): () => void {
  let running = true;
  let paused = false;
  let lastTime = performance.now();
  let accumulator = 0;
  let frameHandle = 0;

  function frame(now: number): void {
    if (!running) return;
    frameHandle = requestAnimationFrame(frame);

    const frameTime = Math.min((now - lastTime) / 1000, MAX_FRAME_TIME);
    lastTime = now;

    if (!paused) {
      accumulator += frameTime;

      while (accumulator >= FIXED_TIMESTEP) {
        callbacks.update(FIXED_TIMESTEP);
        accumulator -= FIXED_TIMESTEP;
      }
    }

    // Rendering continues while paused so the window still repaints on resize.
    callbacks.render();
  }

  /**
   * Pause on blur (spec §5). Browsers already throttle rAF in hidden tabs, but
   * an unfocused *visible* window keeps ticking — and coming back to a shot that
   * was taken while you were reading email is worse than a frozen one.
   *
   * On resume we reset `lastTime`, otherwise the first frame back reports the
   * entire away-duration as elapsed time.
   */
  function pause(): void {
    paused = true;
  }

  function resume(): void {
    paused = false;
    lastTime = performance.now();
    accumulator = 0;
  }

  window.addEventListener('blur', pause);
  window.addEventListener('focus', resume);

  frameHandle = requestAnimationFrame(frame);

  return () => {
    running = false;
    cancelAnimationFrame(frameHandle);
    window.removeEventListener('blur', pause);
    window.removeEventListener('focus', resume);
  };
}
