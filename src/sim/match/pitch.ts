// The pitch, in metres, and the geometry questions the engine keeps asking about it.
//
// Coordinates: x runs along the length, 0 at the "left" goal line and PITCH_LENGTH at the
// "right" one; y runs across the width, 0 to PITCH_WIDTH. Nothing in here knows which team
// is which — a team carries a direction (+1 attacks +x, -1 attacks -x) and flips it at
// half time, which is how ends get swapped without every calculation growing a special
// case.
//
// Metres rather than an abstract unit because every constant in the physics model is a
// real football number and would have to be converted somewhere. Better here than nowhere.

import { clamp } from '../../core/math.js';

/** Regulation dimensions. FIFA permits a range; these are the standard used for finals. */
export const PITCH_LENGTH = 105;
export const PITCH_WIDTH = 68;

export const GOAL_WIDTH = 7.32;
export const GOAL_HEIGHT = 2.44;

export const PENALTY_AREA_DEPTH = 16.5;
export const PENALTY_AREA_WIDTH = 40.32;
export const GOAL_AREA_DEPTH = 5.5;
export const GOAL_AREA_WIDTH = 18.32;
export const PENALTY_SPOT_DIST = 11;
export const CENTRE_CIRCLE_RADIUS = 9.15;
export const CORNER_ARC_RADIUS = 1;

export const HALF_LENGTH = PITCH_LENGTH / 2;
export const HALF_WIDTH = PITCH_WIDTH / 2;

/** +1 attacks toward x = PITCH_LENGTH, -1 attacks toward x = 0. */
export type Direction = 1 | -1;

/** x of the goal line this direction attacks. */
export function attackingGoalX(dir: Direction): number {
  return dir > 0 ? PITCH_LENGTH : 0;
}

/** x of the goal line this direction defends. */
export function defendingGoalX(dir: Direction): number {
  return dir > 0 ? 0 : PITCH_LENGTH;
}

/** Centre of the goal being attacked. */
export function attackingGoalY(): number {
  return HALF_WIDTH;
}

/** Is (x, y) inside the penalty area in front of the goal at `goalX`? */
export function inPenaltyArea(x: number, y: number, goalX: number): boolean {
  const depth = Math.abs(x - goalX);
  return (
    depth <= PENALTY_AREA_DEPTH &&
    Math.abs(y - HALF_WIDTH) <= PENALTY_AREA_WIDTH / 2 &&
    x >= 0 &&
    x <= PITCH_LENGTH
  );
}

export function inGoalArea(x: number, y: number, goalX: number): boolean {
  const depth = Math.abs(x - goalX);
  return depth <= GOAL_AREA_DEPTH && Math.abs(y - HALF_WIDTH) <= GOAL_AREA_WIDTH / 2;
}

/** Inside the field of play, goal lines and touchlines inclusive. */
export function onPitch(x: number, y: number): boolean {
  return x >= 0 && x <= PITCH_LENGTH && y >= 0 && y <= PITCH_WIDTH;
}

/** Clamp a point to the field of play. */
export function clampToPitch(out: { x: number; y: number }): void {
  out.x = clamp(out.x, 0, PITCH_LENGTH);
  out.y = clamp(out.y, 0, PITCH_WIDTH);
}

/**
 * Does a ball crossing `goalX` at this y and height go in? Called only once the ball has
 * actually crossed the line, so it is a pure "between the posts and under the bar" test.
 */
export function betweenPosts(y: number, z: number): boolean {
  return Math.abs(y - HALF_WIDTH) <= GOAL_WIDTH / 2 && z >= 0 && z <= GOAL_HEIGHT;
}

/** Distance from a point to the centre of the goal at `goalX`. */
export function distToGoal(x: number, y: number, goalX: number): number {
  const dx = goalX - x;
  const dy = HALF_WIDTH - y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * How much of the goal a shooter can see, 0..1, ignoring players. Pure geometry: a shot
 * from the corner flag has almost no angle even though it is close, which is exactly the
 * thing a distance-only chance model gets wrong.
 */
export function goalAngle(x: number, y: number, goalX: number): number {
  const postA = { x: goalX, y: HALF_WIDTH - GOAL_WIDTH / 2 };
  const postB = { x: goalX, y: HALF_WIDTH + GOAL_WIDTH / 2 };
  const a = Math.atan2(postA.y - y, postA.x - x);
  const b = Math.atan2(postB.y - y, postB.x - x);
  let d = Math.abs(a - b);
  if (d > Math.PI) d = Math.PI * 2 - d;
  // Straight in front of an open goal from six yards is about 0.9 rad; normalise on that.
  return clamp(d / 0.9, 0, 1);
}

/** Which third of the pitch is this, from the point of view of a team attacking `dir`? */
export type Third = 'defensive' | 'middle' | 'attacking';

export function thirdOf(x: number, dir: Direction): Third {
  const along = dir > 0 ? x : PITCH_LENGTH - x;
  if (along < PITCH_LENGTH / 3) return 'defensive';
  if (along < (PITCH_LENGTH * 2) / 3) return 'middle';
  return 'attacking';
}

/**
 * Turn a normalised formation spot (0..1 along, 0..1 across) into pitch coordinates for a
 * team attacking `dir`. The formation editor and the engine share this so a shape dragged
 * on screen is literally the shape the players take up.
 */
export function spotToPitch(
  out: { x: number; y: number },
  along: number,
  across: number,
  dir: Direction,
): void {
  const a = clamp(along, 0, 1);
  const c = clamp(across, 0, 1);
  out.x = dir > 0 ? a * PITCH_LENGTH : PITCH_LENGTH - a * PITCH_LENGTH;
  out.y = dir > 0 ? c * PITCH_WIDTH : PITCH_WIDTH - c * PITCH_WIDTH;
}

/** Inverse of spotToPitch, for reading a live position back into formation space. */
export function pitchToSpot(
  out: { along: number; across: number },
  x: number,
  y: number,
  dir: Direction,
): void {
  out.along = dir > 0 ? x / PITCH_LENGTH : 1 - x / PITCH_LENGTH;
  out.across = dir > 0 ? y / PITCH_WIDTH : 1 - y / PITCH_WIDTH;
}

/** Nearest point on the pitch boundary that the ball crossed, for a restart. */
export function restartSpot(x: number, y: number): { x: number; y: number } {
  return { x: clamp(x, 0, PITCH_LENGTH), y: clamp(y, 0, PITCH_WIDTH) };
}
