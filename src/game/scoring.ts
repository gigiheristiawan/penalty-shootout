import type * as CANNON from 'cannon-es';
import { GOAL_LINE_Z, KICKS_PER_ROUND, MISS_TIMEOUT_SECONDS } from '../constants';

/**
 * Outcome detection and best-of-5 bookkeeping (spec §6, §7).
 *
 * Two separate jobs live here on purpose:
 *   `ShotJudge`  — watches one kick and decides what happened.
 *   `Scoreboard` — remembers what happened across a round.
 */

export type Outcome = 'GOAL' | 'SAVE' | 'MISS' | 'POST';

export const OUTCOME_LABEL: Record<Outcome, string> = {
  GOAL: 'GOAL!',
  SAVE: 'SAVED',
  MISS: 'MISSED',
  POST: 'OFF THE WOODWORK',
};

/**
 * Judges a single shot.
 *
 * Collision *events* (the sensor, the posts, later the keeper) are pushed in by
 * the physics world as they happen; `evaluate` is then polled once per tick to
 * decide whether the shot is over. Splitting it that way matters: a collision
 * handler runs deep inside `world.step()`, and mutating game state from there —
 * resetting the ball mid-solve, say — is how you get a physics explosion.
 * Recording a flag and acting on it after the step is the safe shape.
 */
export class ShotJudge {
  private elapsed = 0;
  private crossedSensor = false;
  private hitWoodwork = false;
  private saved = false;

  /** Begin watching a new kick. */
  start(): void {
    this.elapsed = 0;
    this.crossedSensor = false;
    this.hitWoodwork = false;
    this.saved = false;
  }

  noteSensorCrossed(): void {
    this.crossedSensor = true;
  }

  noteWoodwork(): void {
    this.hitWoodwork = true;
  }

  /** Called by the keeper in phase 4. */
  noteSave(): void {
    this.saved = true;
  }

  /**
   * Advance the shot clock and decide whether it has resolved.
   * Returns the outcome, or null while the ball is still live.
   */
  evaluate(ball: CANNON.Body, fixedDeltaSeconds: number): Outcome | null {
    this.elapsed += fixedDeltaSeconds;

    /**
     * A goal beats everything, a keeper's touch included.
     *
     * Getting a hand to it is not the same as keeping it out: a parry that ends
     * up over the line is a goal, and it is the *sensor* that decides, never the
     * contact. Note this cannot be fixed by ordering alone — the old code also
     * resolved the shot on the tick the keeper touched the ball, so a deflection
     * was never given the chance to finish crossing.
     */
    if (this.crossedSensor) return 'GOAL';

    /**
     * A touched ball travelling back out can no longer go in, so the save is
     * settled. Waiting for the ball to come to rest instead would leave the
     * player watching a rebound trickle around for a second or two.
     */
    if (this.saved && ball.velocity.z > 0.5) return 'SAVE';

    /**
     * Past the goal line but never through the sensor: wide, over, or round the
     * back. Resolving here rather than waiting for the timeout is purely feel —
     * three seconds of watching a ball you already know missed is dead air.
     */
    if (ball.position.z < GOAL_LINE_Z - 1) return this.settledOutcome();

    /**
     * A shot that came off the woodwork and stayed in play, or a weak roller
     * that stopped short. `sleepState === 2` is cannon-es's SLEEPING: the body
     * has been near-motionless long enough to be frozen, which is a more honest
     * "the ball has stopped" test than comparing velocity to an epsilon.
     */
    const stopped = ball.sleepState === 2 || ball.velocity.lengthSquared() < 0.05;
    if (stopped && this.elapsed > 1) return this.settledOutcome();

    /** Backstop (spec §6): nothing else triggered, call it a miss. */
    if (this.elapsed > MISS_TIMEOUT_SECONDS) return this.settledOutcome();

    return null;
  }

  /**
   * What a shot that did not go in should be called.
   *
   * A keeper's touch outranks the woodwork: if both happened and it stayed out,
   * the keeper gets the credit.
   */
  private settledOutcome(): Outcome {
    if (this.saved) return 'SAVE';
    return this.hitWoodwork ? 'POST' : 'MISS';
  }
}

export interface RoundSummary {
  goals: number;
  kicksTaken: number;
  outcomes: readonly Outcome[];
}

/** Best-of-5 bookkeeping, plus the personal best in `localStorage`. */
export class Scoreboard {
  private goals = 0;
  private outcomes: Outcome[] = [];

  get kicksTaken(): number {
    return this.outcomes.length;
  }

  get score(): number {
    return this.goals;
  }

  get isRoundOver(): boolean {
    /**
     * A real shootout can end early once it is mathematically decided, but that
     * needs an opponent taking alternate kicks. Single-player, all five are
     * always worth taking, so the round simply runs its length.
     */
    return this.kicksTaken >= KICKS_PER_ROUND;
  }

  record(outcome: Outcome): void {
    this.outcomes.push(outcome);
    if (outcome === 'GOAL') this.goals += 1;
  }

  reset(): void {
    this.goals = 0;
    this.outcomes = [];
  }

  summary(): RoundSummary {
    return { goals: this.goals, kicksTaken: this.kicksTaken, outcomes: [...this.outcomes] };
  }
}

/**
 * Personal best in `localStorage` (spec §3: this is the only persisted state).
 *
 * Every access is wrapped: `localStorage` throws outright in a Safari private
 * window and in some embedded contexts, and a crash on boot because the browser
 * declined to remember a number would be an absurd way to lose the game.
 */
const BEST_SCORE_KEY = 'penalty-shootout:best-score';

export function readBestScore(): number {
  try {
    const stored = window.localStorage.getItem(BEST_SCORE_KEY);
    const parsed = Number(stored);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= KICKS_PER_ROUND ? parsed : 0;
  } catch {
    return 0;
  }
}

/** Stores `score` if it beats the stored best. Returns the best after the write. */
export function writeBestScore(score: number): number {
  const best = Math.max(readBestScore(), score);

  try {
    window.localStorage.setItem(BEST_SCORE_KEY, String(best));
  } catch {
    // Persistence is a nicety, not a requirement.
  }

  return best;
}
