/**
 * Everything in this project is in SI units: metres, kilograms, seconds.
 *
 * Why that matters in 3D: a scene has no inherent scale, but the physics engine
 * uses a gravity constant of -9.82 m/s^2. If we modelled the goal as "10 units
 * wide", gravity would feel like the moon (or like a marble on a table).
 * Building at real-world scale from the start is the cheapest way to make the
 * ball flight look right later.
 */

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
} as const;
