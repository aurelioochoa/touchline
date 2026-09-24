// Players getting better, then getting worse, then stopping.
//
// This is what makes a career a career rather than a series of seasons. A squad that never
// changes has no story in it; the long hook of the genre is a sixteen-year-old you played
// when nobody else would, who is the best player in the division five years later.
//
// Everything moves CA, and the attributes follow. Moving attributes directly and letting
// CA fall out would let a player "improve" into a worse footballer by gaining the wrong
// things.

import { clamp, clamp01, lerp } from '../../core/math.js';
import { chance, gauss, int, range, type Rng } from '../../core/rng.js';
import { caOf, scaleToCa } from '../ratings/ability.js';
import { attr, attrUnit, setAttr, type AnyAttr } from '../ratings/attributes.js';
import type { WorldPlayer } from '../world/types.js';

/** Physical attributes decline with age; technical and mental ones do not. */
const DECLINING: AnyAttr[] = ['pace', 'acceleration', 'agility', 'stamina', 'jumpingReach', 'balance'];
/** These keep improving into a player's thirties, which is why old players stay useful. */
const RIPENING: AnyAttr[] = ['positioning', 'anticipation', 'decisions', 'composure', 'concentration', 'leadership'];

/**
 * How much of the gap to potential a player closes this season.
 *
 * Peaks in the late teens and is gone by the late twenties. Professionalism and
 * Determination are hidden, so a manager only ever learns which of his youngsters had them
 * by watching who actually kicked on — which is the point of them being hidden.
 */
export function growthRate(p: WorldPlayer, coaching: number, minutesShare: number): number {
  // Open until about thirty rather than twenty-six. The narrower window was the reason a
  // simulated world decayed: a sixteen-year-old with the potential to be the best player
  // in the country closed a tenth of the gap a year, stopped improving at twenty-four
  // having reached half of it, and retired never having been any good. Twenty seasons of
  // that and the top division is playing at third-tier standard (career/track.ts).
  const youth = clamp01((29 - p.age) / 12);
  const attitude =
    attrUnit(p.attrs, 'professionalism') * 0.45 +
    attrUnit(p.attrs, 'determination') * 0.35 +
    attrUnit(p.attrs, 'ambition') * 0.2;
  // Playing matters, but not so much that a promising teenager who cannot get in the side
  // is finished at nineteen.
  const playing = lerp(0.55, 1.3, clamp01(minutesShare));
  return youth * lerp(0.16, 0.46, attitude) * playing * lerp(0.6, 1.35, clamp01(coaching));
}

/**
 * Age a player one season: grow toward potential, or decline, then move the attributes to
 * match. Returns the change in Current Ability, for the news feed.
 */
export function developPlayer(p: WorldPlayer, rng: Rng, coaching: number, minutesShare: number): number {
  const before = caOf(p.attrs, p.natural);
  let target = before;

  if (before < p.pa && p.age < 33) {
    const rate = growthRate(p, coaching, minutesShare);
    target = before + (p.pa - before) * rate + gauss(rng) * 1.5;
  }

  // Decline. Starts around thirty and accelerates; Natural Fitness slows it down, which is
  // why some players are still quick at thirty-four.
  if (p.age >= 29) {
    const years = p.age - 28;
    const durability = attrUnit(p.attrs, 'naturalFitness');
    const loss = years * lerp(3.2, 1.2, durability) * range(rng, 0.6, 1.4);
    target -= loss;
  }

  const after = clamp(Math.round(target), 8, 200);
  scaleToCa(p.attrs, p.natural, after);

  // On top of the level change, shift the SHAPE of an older player: he loses a yard and
  // gains a season's worth of reading the game.
  if (p.age >= 29) {
    for (const key of DECLINING) {
      setAttr(p.attrs, key, attr(p.attrs, key) - (chance(rng, 0.55) ? 1 : 0));
    }
    for (const key of RIPENING) {
      setAttr(p.attrs, key, attr(p.attrs, key) + (chance(rng, 0.3) ? 1 : 0));
    }
  }

  return after - before;
}

/**
 * Whether a player hangs up his boots. Age first, then how far he has fallen — a player
 * still good enough for the top division does not retire at thirty-three, and one who has
 * dropped out of the fifth does.
 */
export function retires(p: WorldPlayer, rng: Rng, divisionStrength: number): boolean {
  if (p.age < 32) return false;
  const ca = caOf(p.attrs, p.natural);
  const stillUseful = clamp01(ca / Math.max(divisionStrength, 20));
  const base = clamp01((p.age - 32) / 7);
  return chance(rng, clamp01(base * lerp(1.5, 0.35, stillUseful) + (p.age >= 38 ? 1 : 0)));
}

/**
 * A youth intake player, to replace someone who left.
 *
 * Deliberately generous with potential and stingy with current ability: almost all of them
 * will not make it, and the handful who do are the reason anyone looks. A world where
 * every regen is useful has no scouting in it.
 */
export function youthPotential(rng: Rng, clubReputation: number): { ca: number; pa: number; age: number } {
  const age = int(rng, 16, 18);
  const pull = clamp01(clubReputation / 200);
  // A big club's academy produces better prospects, because a big club can attract them.
  const ca = clamp(Math.round(range(rng, 22, 55) + pull * 22 + gauss(rng) * 6), 12, 110);
  const spark = Math.max(0, gauss(rng));
  // POTENTIAL scales hard with the club, not just current ability. A non-league academy
  // that turns out future internationals at the same rate as a European champion's does
  // not just feel wrong — it flattens the whole pyramid, because those players stay where
  // they were produced. Twenty seasons of it lifted the fifth tier from 68 to 88 while the
  // first fell from 153 to 128 (career/track.ts).
  const pa = clamp(Math.round(ca + range(rng, 6, 26) * (0.5 + pull) + spark * (10 + pull * 62)), ca, 198);
  return { ca, pa, age };
}

/** Morale drifts toward a resting point set by playing time and results. */
export function updateMorale(p: WorldPlayer, playedRecently: boolean, teamForm: number, rng: Rng): void {
  const wants = clamp01(0.35 + (playedRecently ? 0.3 : -0.05) + teamForm * 0.35);
  const temperament = attrUnit(p.attrs, 'temperament');
  // A steady character moves slowly in both directions.
  const rate = lerp(0.42, 0.12, temperament);
  p.morale = clamp01(p.morale + (wants - p.morale) * rate + gauss(rng) * 0.03);
}

/** Recover condition on a rest day; a fitter player recovers faster. */
export function recoverCondition(p: WorldPlayer, days: number): void {
  const fitness = attrUnit(p.attrs, 'naturalFitness');
  p.condition = clamp01(p.condition + days * lerp(0.055, 0.11, fitness));
}

/** Condition lost by playing. Ninety minutes takes a lot out of anyone. */
export function tireFromMatch(p: WorldPlayer, minutes: number): void {
  const stamina = (attrUnit(p.attrs, 'stamina') + attrUnit(p.attrs, 'naturalFitness')) / 2;
  const cost = (minutes / 90) * lerp(0.42, 0.24, stamina);
  p.condition = clamp01(p.condition - cost);
}
