/**
 * Everything in this project is in SI units: metres, kilograms, seconds.
 *
 * Why that matters in 3D: a scene has no inherent scale, but the physics engine
 * uses a gravity constant of -9.82 m/s^2. If we modelled the goal as "10 units
 * wide", gravity would feel like the moon (or like a marble on a table).
 * Building at real-world scale from the start is the cheapest way to make the
 * ball flight look right later.
 */

/** Earth gravity, m/s^2. Shared by the physics world and the kick maths. */
export const GRAVITY = 9.82;

/** Regulation goal: 7.32 m wide, 2.44 m high (inner measurements). */
export const GOAL_WIDTH = 7.32;
export const GOAL_HEIGHT = 2.44;
/** Radius of the posts and crossbar. Real ones are ~0.06 m thick. */
export const POST_RADIUS = 0.06;

/** Penalty spot distance from the goal line. */
export const PENALTY_SPOT_DISTANCE = 11;

/** Match ball: 0.11 m radius, 0.43 kg. Mass is unused until phase 1. */
export const BALL_RADIUS = 0.11;
export const BALL_MASS = 0.43;

/**
 * World axes convention used throughout this project (Three.js is Y-up):
 *   +X — to the player's right
 *   +Y — up
 *   +Z — from the goal towards the player (so the player stands at +Z)
 * The goal line sits at z = 0, the penalty spot at z = PENALTY_SPOT_DISTANCE.
 */
export const GOAL_LINE_Z = 0;

/** Eye height of the penalty taker, used for the camera. */
export const EYE_HEIGHT = 1.6;

/** A deliberately chosen flat palette (spec §9) rather than fake realism. */
export const PALETTE = {
  sky: 0x1b2b4a,
  fog: 0x1b2b4a,
  grass: 0x2f7d4f,
  grassStripe: 0x2a6f47,
  goalFrame: 0xf2f5ff,
  net: 0xdfe7f5,
  ball: 0xfff8e7,
  ballAccent: 0x1b2b4a,
  keeper: 0xf2b13c,
  aim: 0xff5d5d,
} as const;

/**
 * Kick tuning (spec §7). Power maps linearly onto this speed range so shots stay
 * plausible: ~15 m/s is a placed side-foot pass, ~34 m/s is a well-struck
 * professional penalty (real ones top out around 35 m/s).
 */
export const KICK_MIN_SPEED = 15;
export const KICK_MAX_SPEED = 34;

/**
 * Seconds for the power meter to travel 0 → 1 → 0 once. Short enough that a
 * full-power shot needs timing, long enough to be hittable.
 */
export const CHARGE_CYCLE_SECONDS = 1.4;

/**
 * How far outside the goal frame the aim marker may travel. Missing has to be
 * reachable (spec §11), so aiming wide and over must be possible on purpose.
 */
export const AIM_MARGIN_X = 1.6;
export const AIM_MARGIN_Y = 1.4;

/** A round is best-of-5, like a real shootout (spec §2). */
export const KICKS_PER_ROUND = 5;

/** Backstop for a shot that never resolves any other way (spec §6). */
export const MISS_TIMEOUT_SECONDS = 3;

/** How long an outcome is shown before the next kick is set up. */
export const RESOLVED_DISPLAY_SECONDS = 1.6;

/**
 * Keeper (spec §8). The goal mouth is divided into 6 zones: 3 columns × 2 rows.
 */
export const KEEPER_ZONE_COLUMNS = [-2.44, 0, 2.44];
export const KEEPER_ZONE_ROWS = [0.62, 1.85];

/**
 * Probability the keeper reads the true aim zone; otherwise it guesses among
 * the other five. This single number *is* the difficulty (spec §8).
 */
export const KEEPER_READ_PROBABILITY = 0.4;

/**
 * How long a full-stretch dive takes. This is what makes far corners at high
 * power nearly unsaveable: a hard shot reaches the line in ~0.35 s, so the
 * keeper is still travelling when it arrives.
 */
export const KEEPER_DIVE_SECONDS = 0.52;

/**
 * Per-dive variance.
 *
 * Without it the keeper is a step function: for any given aim there is an exact
 * power below which it always saves and above which it never does, so a player
 * who finds that edge scores 100% forever. Real keepers get away marginally
 * late, or reach marginally further, and that spread is what turns a hard edge
 * into a probability. Variance is not noise for its own sake — it is what makes
 * skill read as skill rather than as a lookup table.
 */
export const KEEPER_TIMING_JITTER = 0.05;
export const KEEPER_REACH_JITTER = 0.22;

/** Keeper body size (a stand-in for a diving human, spec §3: primitives only). */
export const KEEPER_RADIUS = 0.28;
export const KEEPER_HEIGHT = 1.9;

/**
 * Half-length of the keeper's *collision* box, deliberately longer than the
 * visible capsule. A diving keeper presents fingertips-to-toes, not just a
 * torso, and that outstretched reach is what lets three dive positions cover a
 * 7.32 m goal with only narrow gaps between them. Without it the zones tile so
 * badly that a shot halfway between two of them can never be saved — which is
 * precisely the "trivially exploitable" failure spec §8 rules out.
 */
export const KEEPER_REACH_HALF_LENGTH = 1.15;

/** Reaction delay before the dive starts — the keeper is not psychic. */
export const KEEPER_REACTION_SECONDS = 0.09;

/**
 * Curve (spec §7): a small constant lateral force while the ball is in flight.
 * Newtons; the ball is 0.43 kg, so this is a gentle nudge, not a banana shot.
 */
export const CURVE_FORCE = 1.9;

/**
 * How far outside the frame a shot must be predicted to land before the keeper
 * stops bothering. Real keepers watch balls they judge to be missing; diving at
 * one flying two metres wide is the single most obviously stupid thing a
 * scripted keeper can do.
 */
export const KEEPER_IGNORE_MARGIN = 0.45;

/**
 * How far the keeper may adjust mid-flight, in metres.
 *
 * This is the whole "reads it late" mechanic. It must stay small: it is meant to
 * refine a dive that was roughly right, never to rescue one that was wrong. Set
 * it near 1.5 m and the initial guess stops mattering, which would make the
 * read probability — the actual difficulty dial — meaningless.
 */
export const KEEPER_CORRECTION_LIMIT = 0.5;

/** Error in the keeper's read of the flight. It judges by eye, not by maths. */
export const KEEPER_PREDICTION_ERROR = 0.3;

/**
 * How much slower a high dive is than a low one, per metre above the keeper's
 * resting height.
 *
 * Dropping sideways is gravity-assisted; getting up to the top corner is a jump.
 * Without this the keeper takes equally long to reach both rows, and because a
 * lofted shot spends part of its speed budget climbing — so it arrives *later*
 * — the bottom corner ends up strictly better for the player than the top one.
 * That is backwards: low and hard should be the fast, dangerous shot, and it
 * should be the keeper's difficulty in getting down there that balances it.
 */
export const KEEPER_HIGH_DIVE_PENALTY = 0.22;

/**
 * Idle motion while the keeper waits for the kick.
 *
 * A keeper rooted to the spot reads as a prop, not an opponent — and it makes
 * the two centre zones indistinguishable from doing nothing at all. Shifting
 * weight is what a real keeper does on the line, and it costs one sine wave.
 */
export const KEEPER_IDLE_SWAY = 0.42;
export const KEEPER_IDLE_SPEED = 1.9;

/**
 * Ceiling on how fast the keeper may move while *not* diving, in m/s.
 *
 * Picking itself up after a full-stretch dive means covering a couple of metres,
 * and an uncapped proportional move does that fast enough to punt a resting ball
 * across the pitch — a kinematic body has infinite mass, so whatever speed it
 * carries goes straight into anything it touches. Getting up is not an explosive
 * movement; this says so.
 */
export const KEEPER_RECOVERY_SPEED = 2.6;

/**
 * Ceiling on the keeper's speed during a dive, in m/s.
 *
 * A kinematic body has infinite mass, so whatever velocity it carries is
 * transferred to whatever it hits — there is no equal-and-opposite reaction to
 * bleed it off. That makes an unbounded keeper velocity a live ammunition
 * hazard: the dive is driven by v = (desired − current) / dt, and at a 240 Hz
 * tick a half-metre jump in the target becomes 120 m/s. An elite keeper's hands
 * move at roughly 10 m/s; anything past that is a bug, not a save.
 */
export const KEEPER_MAX_DIVE_SPEED = 11;

/**
 * How fast the mid-flight correction may drag the dive target, in m/s.
 *
 * Capping the correction's *magnitude* is not enough on its own — the target
 * could still snap from one end of the allowance to the other within a single
 * tick. This bounds the rate as well, so the adjustment reads as a stretch
 * rather than a teleport.
 */
export const KEEPER_CORRECTION_RATE = 3.2;

/**
 * A centre-column dive still has to *look* like a save attempt: with no lateral
 * distance there is no dive rotation, so without this the keeper appears to
 * stand still while the ball flies past. A hop and a small lean sell it.
 */
export const KEEPER_CENTRE_HOP = 0.34;

/**
 * Relative likelihood of guessing each column when the keeper has *not* read the
 * shot. Real keepers commit to a side far more often than they stay: staying is
 * only right if the taker goes down the middle, and most do not. Lowering the
 * centre weight also directly reduces how often the keeper appears to do nothing.
 */
export const KEEPER_COLUMN_WEIGHTS = [1, 0.45, 1];
