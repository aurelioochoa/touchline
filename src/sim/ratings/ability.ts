// Current Ability and Potential Ability.
//
// CA is the budget the attributes were bought with, on a 1-200 scale. It is the single
// idea that makes the rest of the career model coherent: development raises CA and the
// attributes follow; scouting narrows a PA range rather than revealing a number; a
// transfer fee is a function of CA, PA and age rather than a hand-tuned guess.
//
// A note on direction: CA is DERIVED from attributes, never stored as the truth. Storing
// both invites them to disagree, and the attributes are what the match engine reads.

import {
  ATTR_KEYS,
  ATTR_MAX,
  attr,
  attrUnit,
  emptyAttributes,
  setAttr,
  type AnyAttr,
  type Attributes,
} from './attributes.js';
import { POSITION_WEIGHTS, type Position } from './positions.js';
import { clamp, clamp01 } from '../../core/math.js';
import { gauss, type Rng } from '../../core/rng.js';

export const CA_MIN = 1;
export const CA_MAX = 200;

/** Normalised weights for a position, cached — this runs inside generation loops. */
const weightCache = new Map<Position, { keys: AnyAttr[]; weights: number[]; total: number }>();

function weightsFor(pos: Position) {
  const hit = weightCache.get(pos);
  if (hit) return hit;
  const raw = POSITION_WEIGHTS[pos];
  const keys: AnyAttr[] = [];
  const weights: number[] = [];
  let total = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (!v || v <= 0) continue;
    keys.push(k as AnyAttr);
    weights.push(v);
    total += v;
  }
  const entry = { keys, weights, total };
  weightCache.set(pos, entry);
  return entry;
}

/**
 * Current Ability from attributes, in this position. The weighted mean of the attributes
 * that matter here, scaled to 1-200.
 */
export function caOf(a: Attributes, pos: Position): number {
  return clamp(Math.round(caRaw(a, pos)), CA_MIN, CA_MAX);
}

/**
 * CA before rounding. The tuner needs this: attributes are integers and most of them are
 * worth a fraction of a CA point, so a search that compares ROUNDED ability cannot see
 * that a step helped and stalls several points short of its target. Only the tuner and
 * development should care about the fraction; everything else reads `caOf`.
 */
export function caRaw(a: Attributes, pos: Position): number {
  const { keys, weights, total } = weightsFor(pos);
  if (total <= 0) return CA_MIN;
  let acc = 0;
  for (let i = 0; i < keys.length; i++) {
    acc += attrUnit(a, keys[i] as AnyAttr) * (weights[i] as number);
  }
  return (acc / total) * CA_MAX;
}

/**
 * The best CA this player would have in any position — what "how good is he, really"
 * means when he is played out of position.
 */
export function bestCa(a: Attributes, positions: readonly Position[]): { ca: number; pos: Position } {
  let best = CA_MIN;
  let bestPos = positions[0] ?? 'MC';
  for (const p of positions) {
    const c = caOf(a, p);
    if (c > best) {
      best = c;
      bestPos = p;
    }
  }
  return { ca: best, pos: bestPos };
}

/**
 * Build an attribute set that comes out at roughly `targetCa` in `pos`.
 *
 * The shape matters as much as the level. A striker at CA 120 is not "every attribute at
 * 12" — he is 16 for Finishing, 15 Off The Ball, and 7 for Tackling. So each attribute is
 * drawn around a base that leans on how much this position values it, and then the whole
 * set is scaled until the CA lands where it was asked to.
 *
 * `spread` widens the per-attribute noise: 0 gives the archetype, 1 gives a distinctive
 * player with real strengths and real holes.
 */
export function generateAttributes(
  rng: Rng,
  pos: Position,
  targetCa: number,
  spread = 0.6,
): Attributes {
  const a = emptyAttributes();
  const { keys, weights } = weightsFor(pos);
  const maxW = Math.max(1, ...weights);

  // Importance 0..1 per weighted key; unweighted attributes get a low floor so a player
  // is never literally 1 at something he simply is not paid for.
  const importance = new Map<AnyAttr, number>();
  for (let i = 0; i < keys.length; i++) {
    importance.set(keys[i] as AnyAttr, (weights[i] as number) / maxW);
  }

  const u = clamp01(targetCa / CA_MAX);
  for (const key of ATTR_KEYS) {
    const imp = importance.get(key) ?? 0;
    // Weighted attributes track the player's level; unweighted ones hover around average
    // regardless, which is why a great striker is still a mediocre tackler rather than a
    // hopeless one.
    const base = imp > 0 ? u * (0.5 + 0.8 * imp) : 0.18 + u * 0.22;
    const noise = gauss(rng) * 0.085 * (0.35 + spread);
    setAttr(a, key, 1 + clamp01(base + noise) * (ATTR_MAX - 1));
  }

  // Hidden attributes are independent of ability — a bad player can be a model
  // professional and a great one can be fragile. Redraw them flat.
  for (const key of ['consistency', 'importantMatches', 'injuryProneness', 'versatility',
    'adaptability', 'ambition', 'loyalty', 'pressure', 'professionalism', 'sportsmanship',
    'temperament', 'dirtiness'] as const) {
    setAttr(a, key, clamp(10 + gauss(rng) * 4, 1, 20));
  }

  scaleToCa(a, pos, targetCa);
  return a;
}

/**
 * Nudge the weighted attributes until CA lands on target. A multiplicative scale converges
 * in a handful of passes and, unlike adding a constant, preserves the player's shape —
 * which is the whole reason generation bothered to give him one.
 */
export function scaleToCa(a: Attributes, pos: Position, targetCa: number): void {
  const { keys } = weightsFor(pos);
  const want = clamp(targetCa, CA_MIN, CA_MAX);

  // Coarse pass: a multiplicative scale in unit space converges fast and, unlike adding a
  // constant, preserves the player's shape — which is the whole reason generation bothered
  // to give him one.
  for (let pass = 0; pass < 24; pass++) {
    const have = caRaw(a, pos);
    if (Math.abs(have - want) < 0.5) return;
    const ratio = want / Math.max(1, have);
    let moved = false;
    for (const key of keys) {
      const next = clamp01(attrUnit(a, key) * ratio);
      const before = attr(a, key);
      setAttr(a, key, 1 + next * (ATTR_MAX - 1));
      if (attr(a, key) !== before) moved = true;
    }
    if (!moved) break;
  }

  // Fine pass. Attributes are integers, so the coarse loop can only ever land within a
  // few points of the target — at CA 30 one attribute step is worth more than the whole
  // remaining error. Nudge single attributes by one while that still helps.
  //
  // This is not cosmetic: generation asks for an exact CA to hit a division's strength
  // curve, and a systematic 3-point miss across 2,600 players is a whole division's worth
  // of drift.
  for (let pass = 0; pass < 400; pass++) {
    const have = caRaw(a, pos);
    if (Math.abs(have - want) < 0.5) return;
    const dir = want > have ? 1 : -1;
    let bestKey: AnyAttr | null = null;
    let bestErr = Math.abs(have - want);
    for (const key of keys) {
      const before = attr(a, key);
      const next = before + dir;
      if (next < 1 || next > ATTR_MAX) continue;
      setAttr(a, key, next);
      const err = Math.abs(caRaw(a, pos) - want);
      setAttr(a, key, before);
      if (err < bestErr - 1e-9) {
        bestErr = err;
        bestKey = key;
      }
    }
    if (bestKey === null) return; // saturated: no single step gets closer
    setAttr(a, bestKey, attr(a, bestKey) + dir);
  }
}

/**
 * Potential Ability. Young players get a wide gap over CA, older ones almost none. The
 * long tail is deliberate: most academy players are not going to make it, and the ones who
 * do are the reason anyone runs an academy.
 */
export function rollPotential(rng: Rng, ca: number, age: number): number {
  const room = clamp01((24 - age) / 8); // fully open at 16, closed by 24
  const base = ca + room * 55;
  const tail = Math.max(0, gauss(rng)) * room * 45;
  return clamp(Math.round(base + gauss(rng) * 8 + tail), ca, CA_MAX);
}

/**
 * What a scout knows. Knowledge 0..1 narrows the reported band around the true value;
 * at 0 the band is most of the scale, at 1 it is the number. The band is never a lie —
 * the true value is always inside it — because a scout who is wrong rather than vague is
 * a different and much more annoying game.
 */
export function potentialBand(pa: number, knowledge: number): { lo: number; hi: number } {
  const k = clamp01(knowledge);
  const width = (1 - k) * 55 + 4;
  return {
    lo: clamp(Math.round(pa - width / 2), CA_MIN, CA_MAX),
    hi: clamp(Math.round(pa + width / 2), CA_MIN, CA_MAX),
  };
}

/**
 * CA as the 1-5 star rating the squad screen shows, relative to a reference level (the
 * division's average CA). Stars are relative on purpose: five stars in the fifth division
 * should mean "brilliant here", not "brilliant anywhere".
 */
export function stars(ca: number, referenceCa: number): number {
  const rel = ca / Math.max(20, referenceCa);
  return clamp(Math.round(rel * 3 * 2) / 2, 0.5, 5);
}
