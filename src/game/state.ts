/**
 * The game's finite state machine (spec §6).
 *
 * Every piece of input asks the machine what state the game is in before doing
 * anything. That is the rule that keeps this from becoming flag soup: with
 * booleans you eventually need `isCharging && !isResolving && !isRoundOver` at
 * every call site, and the bug is always the combination nobody wrote down.
 *
 *   AIMING → CHARGING → BALL_IN_FLIGHT → RESOLVED → (AIMING | ROUND_OVER)
 */
export type GameState =
  /** Marker follows the pointer. Press-and-hold begins charging. */
  | 'AIMING'
  /** Power meter oscillating. Release kicks. */
  | 'CHARGING'
  /** Physics runs, input ignored, outcome pending. */
  | 'BALL_IN_FLIGHT'
  /** Outcome decided and shown briefly. */
  | 'RESOLVED'
  /** Best-of-5 finished; waiting for a restart. */
  | 'ROUND_OVER';

/**
 * The legal moves, written down once.
 *
 * Being explicit costs a few lines and buys a real guarantee: an illegal
 * transition throws at the moment of the mistake, rather than leaving the game
 * in a state some later handler quietly misreads.
 */
const ALLOWED_TRANSITIONS: Record<GameState, readonly GameState[]> = {
  AIMING: ['CHARGING'],
  CHARGING: ['BALL_IN_FLIGHT', 'AIMING'],
  BALL_IN_FLIGHT: ['RESOLVED'],
  RESOLVED: ['AIMING', 'ROUND_OVER'],
  ROUND_OVER: ['AIMING'],
};

export class GameStateMachine {
  private state: GameState = 'AIMING';
  private readonly listeners: ((next: GameState, previous: GameState) => void)[] = [];

  get current(): GameState {
    return this.state;
  }

  is(...states: readonly GameState[]): boolean {
    return states.includes(this.state);
  }

  transitionTo(next: GameState): void {
    const previous = this.state;
    if (next === previous) return;

    if (!ALLOWED_TRANSITIONS[previous].includes(next)) {
      throw new Error(`Illegal state transition: ${previous} → ${next}`);
    }

    this.state = next;
    for (const listener of this.listeners) listener(next, previous);
  }

  /** Force a state, ignoring the transition table. Restart only. */
  reset(): void {
    const previous = this.state;
    this.state = 'AIMING';
    for (const listener of this.listeners) listener('AIMING', previous);
  }

  onChange(listener: (next: GameState, previous: GameState) => void): void {
    this.listeners.push(listener);
  }
}
