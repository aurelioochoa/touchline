// The weather, and what time of day it is.
//
// Derived, never stored. `conditionsFor` is a pure function of the world seed, the season
// and the fixture — the same three numbers `openMatch` already hashes into the match seed —
// so a fixture looks the same every time it is played, across a reload, and in the
// simulated results a player never watches. Nothing goes in the save file and no setting
// exists: a kid learns that their ground is wet in January the way they learn anything
// else about it, by turning up.
//
// It lives in `src/sim/` rather than `src/render/` for one reason: the weather CHANGES THE
// FOOTBALL. A wet pitch skids the ball on, wind bends a long ball, and both of those are
// the engine's business. The renderer and the audio read the same value so the picture and
// the physics cannot disagree about whether it is raining.

import { clamp01, lerp, TAU } from '../../core/math.js';
import { mulberry32 } from '../../core/rng.js';

export type Sky = 'clear' | 'overcast' | 'rain' | 'heavyRain';

export interface Conditions {
  sky: Sky;
  /** 0..1 — how wet the surface is. Drives skid, bounce and first-touch error. */
  wetness: number;
  /** Wind acceleration on a ball IN FLIGHT, m/s², in pitch coordinates. */
  windX: number;
  windY: number;
  /** 0 = bright midday, 1 = night. Drives the sun's elevation and colour. */
  timeOfDay: number;
  /** Whether the floodlights are on. */
  floodlit: boolean;
}

/** A dry, bright, still afternoon — the neutral the engine was calibrated against. */
export function fairConditions(): Conditions {
  return { sky: 'clear', wetness: 0, windX: 0, windY: 0, timeOfDay: 0.18, floodlit: false };
}

/** Rounds in a league season. Only used to place a fixture in the year. */
const ROUNDS = 38;
/** The strongest wind the model will produce, m/s² on a ball in the air. */
const WIND_MAX = 2.4;

/**
 * The conditions for one fixture.
 *
 * `round` places it in the calendar, and the calendar is the whole of the model: a season
 * runs from late summer through midwinter and out the other side, so the middle of it is
 * dark and wet and both ends are not. That is one cosine, and it does more for the feel of
 * a season than any amount of per-match randomness would.
 */
export function conditionsFor(seed: number, season: number, round: number): Conditions {
  const rng = mulberry32(((seed ^ (season * 7919)) + round * 104729) >>> 0);
  // Burn one: mulberry32's first draw off a low-entropy seed is correlated across seeds.
  rng();

  const progress = clamp01(round / ROUNDS);
  /** 0 at either end of the season, 1 in the depths of it. */
  const winter = (1 - Math.cos(progress * TAU)) / 2;

  const rainRoll = rng();
  const rains = rainRoll < lerp(0.1, 0.44, winter);
  const heavy = rains && rng() < 0.3;
  const overcast = !rains && rng() < lerp(0.18, 0.5, winter);
  const sky: Sky = heavy ? 'heavyRain' : rains ? 'rain' : overcast ? 'overcast' : 'clear';

  const soak = rng();
  const wetness = heavy
    ? 0.72 + soak * 0.28
    : rains
      ? 0.38 + soak * 0.3
      : overcast
        ? soak * 0.12
        : soak * 0.04;

  // Wind gets its own direction so a cross into it and a cross with it are different balls.
  const angle = rng() * TAU;
  const gust = lerp(0.1, 1, winter) * rng();
  const strength = gust * WIND_MAX;

  // Kick-off times drift later as the year closes in, with a spread so not every winter
  // fixture is a night match.
  const timeOfDay = clamp01(lerp(0.12, 0.62, winter) + (rng() - 0.5) * 0.34);
  const floodlit = timeOfDay > 0.42 || heavy;

  return {
    sky,
    wetness,
    windX: Math.cos(angle) * strength,
    windY: Math.sin(angle) * strength,
    timeOfDay,
    floodlit,
  };
}

/**
 * How much the surface skids, as a multiplier on the ball's rolling resistance.
 *
 * A wet pitch is FASTER, which is the opposite of most people's intuition and the whole
 * reason it is worth modelling: the ball runs on, a heavy touch becomes an overhit one,
 * and a defender who would have got there does not.
 */
export function rollFactor(c: Conditions): number {
  return lerp(1, 0.66, clamp01(c.wetness));
}

/** How much grip the ball loses on the bounce. Wet grass grabs less. */
export function bounceFactor(c: Conditions): number {
  return lerp(1, 1.12, clamp01(c.wetness));
}

/** Extra error on a first touch or a strike, 0..1 of the existing spread. */
export function touchPenalty(c: Conditions): number {
  return clamp01(c.wetness) * 0.22;
}
