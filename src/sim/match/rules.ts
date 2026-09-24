// The laws of the game, as far as this engine keeps them.
//
// Everything here is a pure predicate over positions and a couple of attributes, which is
// why it lives apart from the engine: offside and a refereeing decision are the two things
// most worth being able to test in isolation.

import { clamp01 } from '../../core/math.js';
import { attrUnit } from '../ratings/attributes.js';
import type { Rng } from '../../core/rng.js';
import { PITCH_LENGTH } from './pitch.js';
import type { Direction } from './pitch.js';
import type { MatchPlayer } from './types.js';

/**
 * Was the receiver offside at the moment the ball was played?
 *
 * All four conditions, in the order the law states them: in the opposition half, ahead of
 * the ball, ahead of the second-last opponent, and receiving from a team-mate. The
 * "second-last" part is what makes the keeper's position matter and is the half of the law
 * most implementations quietly skip.
 */
export function isOffside(
  receiver: MatchPlayer,
  ballX: number,
  opponents: readonly MatchPlayer[],
  dir: Direction,
): boolean {
  const ahead = (a: number, b: number) => (dir > 0 ? a > b : a < b);

  // Own half is always onside.
  const inOppHalf = dir > 0 ? receiver.x > PITCH_LENGTH / 2 : receiver.x < PITCH_LENGTH / 2;
  if (!inOppHalf) return false;

  // Level with the ball is onside.
  if (!ahead(receiver.x, ballX + (dir > 0 ? 0.3 : -0.3))) return false;

  const xs = opponents.map((o) => o.x).sort((a, b) => (dir > 0 ? b - a : a - b));
  if (xs.length < 2) return false;
  const secondLast = xs[1] as number;

  // Level with the second-last defender is onside, hence the tolerance.
  return ahead(receiver.x, secondLast + (dir > 0 ? 0.3 : -0.3));
}

export type Card = 'none' | 'yellow' | 'red';

/**
 * What the referee makes of a foul.
 *
 * `severity` 0..1 is how reckless the challenge was — how far the tackler was from winning
 * the ball cleanly. A denial of an obvious goalscoring opportunity is a red on its own,
 * which is why `lastMan` is a separate input rather than folded into severity.
 */
export function cardFor(
  offender: MatchPlayer,
  severity: number,
  lastMan: boolean,
  refLeniency: number,
  rng: Rng,
): Card {
  if (lastMan && severity > 0.45) return 'red';
  const dirty = attrUnit(offender.attrs, 'dirtiness');
  const p = clamp01((severity - 0.72) * 1.9 + dirty * 0.12) * (1 - refLeniency);
  if (severity > 0.96 && rng() < 0.05 + dirty * 0.08) return 'red';
  if (rng() < p) return 'yellow';
  return 'none';
}

/** A second yellow is a red, and this is the one place that is decided. */
export function applyCard(offender: MatchPlayer, card: Card): Card {
  // A player already off cannot be booked again; without this the card count keeps
  // climbing for someone who is in the dressing room.
  if (offender.sentOff) return 'none';
  if (card === 'red') {
    offender.sentOff = true;
    offender.onPitch = false;
    return 'red';
  }
  if (card === 'yellow') {
    offender.yellow += 1;
    if (offender.yellow >= 2) {
      offender.sentOff = true;
      offender.onPitch = false;
      return 'red';
    }
    return 'yellow';
  }
  return 'none';
}

/**
 * Chance a foul leaves the fouled player hurt. Injury proneness is hidden, so a manager
 * only ever learns it the slow way — which is the point of it being hidden.
 */
export function injuryChance(victim: MatchPlayer, severity: number): number {
  const prone = attrUnit(victim.attrs, 'injuryProneness');
  const robust = attrUnit(victim.attrs, 'naturalFitness');
  const tired = 1 - victim.stamina;
  return clamp01(severity * 0.05 * (0.4 + prone) * (1.3 - robust * 0.5) * (1 + tired * 0.6));
}

/** Added time, in seconds, from what actually happened in the half. */
export function stoppageFor(
  goals: number,
  substitutions: number,
  cards: number,
  injuries: number,
  rng: Rng,
): number {
  const base = 45 + goals * 28 + substitutions * 22 + cards * 15 + injuries * 55;
  return Math.round(base * (0.8 + rng() * 0.5));
}
