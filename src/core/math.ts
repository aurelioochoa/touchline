// Small maths kit for the match engine. Everything here is 2D and allocation-free in the
// hot path: the engine steps 23 entities 54,000 times per match and then simulates a few
// hundred more matches per season, so a Vector2 per operation is not affordable.
//
// The convention throughout the sim is a flat pitch in metres, x along the length
// (0 = home goal line, LENGTH = away goal line) and y across the width. Height is tracked
// only for the ball, which is the one thing that leaves the ground.

export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Inverse lerp, clamped — "where does v sit between a and b", 0..1. */
export function invLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : clamp01((v - a) / (b - a));
}

/** Remap v from one range to another, clamped at both ends. */
export function remap(v: number, inLo: number, inHi: number, outLo: number, outHi: number): number {
  return lerp(outLo, outHi, invLerp(inLo, inHi, v));
}

/** Smoothstep easing on an already-normalised t. */
export function smoothstep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/**
 * Frame-rate independent exponential approach. `rate` is the fraction of the remaining
 * distance closed per second, so the result is identical at 30fps and 144fps — which a
 * naive `a += (b - a) * 0.1` is not.
 */
export function damp(a: number, b: number, rate: number, dt: number): number {
  return b + (a - b) * Math.exp(-rate * dt);
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt(dist2(ax, ay, bx, by));
}

export function len(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

/** Shortest signed difference between two angles, in (-PI, PI]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

/** Normalise an angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  return angleDelta(0, a);
}

/** Rotate `from` toward `to` by at most `maxStep` radians. */
export function turnToward(from: number, to: number, maxStep: number): number {
  const d = angleDelta(from, to);
  if (Math.abs(d) <= maxStep) return wrapAngle(to);
  return wrapAngle(from + Math.sign(d) * maxStep);
}

/**
 * A scratch pair for the handful of places a function genuinely has two results. Callers
 * pass one in and read it immediately; nothing holds a reference. This is the `out:`
 * parameter pattern the house style uses instead of returning objects from hot paths.
 */
export interface Vec2 {
  x: number;
  y: number;
}

export function vec2(x = 0, y = 0): Vec2 {
  return { x, y };
}

export function setVec(out: Vec2, x: number, y: number): Vec2 {
  out.x = x;
  out.y = y;
  return out;
}

/** Unit vector from a to b, into `out`. Zero-length input yields (0, 0). */
export function dirTo(out: Vec2, ax: number, ay: number, bx: number, by: number): Vec2 {
  const dx = bx - ax;
  const dy = by - ay;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-9) return setVec(out, 0, 0);
  return setVec(out, dx / d, dy / d);
}

/** Clamp a vector's magnitude in place. */
export function limit(out: Vec2, max: number): Vec2 {
  const m = len(out.x, out.y);
  if (m <= max || m < 1e-9) return out;
  const s = max / m;
  out.x *= s;
  out.y *= s;
  return out;
}

/** Mean of a numeric array; 0 for an empty one. */
export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let t = 0;
  for (const x of xs) t += x;
  return t / xs.length;
}

/** Population standard deviation. */
export function stdev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let t = 0;
  for (const x of xs) t += (x - m) * (x - m);
  return Math.sqrt(t / xs.length);
}
