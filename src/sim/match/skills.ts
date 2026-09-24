// Feints and tricks: which one a player on the ball reaches for, and when.
//
// Deliberately COSMETIC as far as the result is concerned. The engine already decides who
// wins a duel — `tackleChance` weighs the carrier's dribbling, agility and balance against
// the defender — and a trick is how that decision looks, not a second roll on top of it.
// So nothing here draws from the match's Rng. Every choice is a hash of the tick and the
// players involved, which keeps a seed's match exactly the match it was before tricks
// existed (core/rng.ts: a new die roll on a shared stream changes every result after it).
//
// What the attributes DO decide is who tries what. A centre-half with no flair does a body
// feint at most; a winger with flair and technique does the elastico. That is the part a
// kid can read off the pitch: the good dribbler is the one doing the tricks.

import { clamp01 } from '../../core/math.js';
import { attrUnit } from '../ratings/attributes.js';
import type { MatchPlayer, SkillMove } from './types.js';

/** Every trick, roughly from the simplest to the showiest. */
export const SKILL_MOVES: readonly SkillMove[] = [
  'bodyFeint',
  'stepover',
  'dragBack',
  'cutInside',
  'nutmeg',
  'roulette',
  'elastico',
  'flick',
];

/**
 * How long each trick takes, in seconds of match time. The renderer plays it over this
 * long, and the engine will not start another on the same player until it is over.
 */
export const SKILL_SECONDS: Readonly<Record<SkillMove, number>> = {
  bodyFeint: 0.55,
  stepover: 0.7,
  dragBack: 0.65,
  cutInside: 0.55,
  nutmeg: 0.6,
  roulette: 0.8,
  elastico: 0.6,
  flick: 0.9,
};

/** A small, fast integer hash. Only its spread matters, not its quality. */
export function skillHash(a: number, b: number, c: number): number {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (b | 0) ^ (h >>> 13), 0xc2b2ae35);
  h = Math.imul(h ^ (c | 0) ^ (h >>> 16), 0x27d4eb2f);
  return (h ^ (h >>> 15)) >>> 0;
}

/** 0..1 from a hash, for comparing against a probability. */
export function skillRoll(a: number, b: number, c: number): number {
  return skillHash(a, b, c) / 4294967296;
}

/** How showy this player is, 0..1: flair and technique, carried by his dribbling. */
export function showmanship(p: MatchPlayer): number {
  return clamp01(
    attrUnit(p.attrs, 'flair') * 0.45 +
      attrUnit(p.attrs, 'technique') * 0.3 +
      attrUnit(p.attrs, 'dribbling') * 0.25,
  );
}

/**
 * The chance, per tick, that a carrier with a defender closing in front of him shows him
 * something. Low on purpose: at 10 ticks a second a defender is "closing" for most of a
 * second, and a trick every time two players meet is a circus, not a match.
 */
export function feintChance(p: MatchPlayer): number {
  const s = showmanship(p);
  return 0.005 + s * s * 0.035;
}

/**
 * Which trick. `beat` is true when the defender has just committed and missed, so the move
 * is the reason he missed: the nutmeg only makes sense then, with him square in front. A
 * pre-emptive feint (beat false) is the carrier trying to unbalance a man who has not
 * committed yet, which is what stepovers and body feints are for.
 *
 * `inFront` is whether the defender is roughly straight ahead rather than coming from the
 * side — a roulette spins away from pressure from the side, a nutmeg needs him in front.
 */
export function pickSkill(p: MatchPlayer, tick: number, beat: boolean, inFront: boolean): SkillMove {
  const s = showmanship(p);
  const r = skillRoll(tick, p.id, 0x51c1);
  // The showier the player, the further along the list he is allowed to reach.
  const reach = 2 + Math.round(s * 9);
  const pool: SkillMove[] = [];
  for (let i = 0; i < SKILL_MOVES.length && i < reach; i++) {
    const m = SKILL_MOVES[i] as SkillMove;
    if (m === 'nutmeg' && !(beat && inFront)) continue;
    if (m === 'roulette' && inFront && !beat) continue;
    pool.push(m);
  }
  if (pool.length === 0) return 'bodyFeint';
  return pool[Math.floor(r * pool.length)] as SkillMove;
}
