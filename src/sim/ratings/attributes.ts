// The attribute model. Follows Football Manager's published shape because it is the one
// the genre has converged on and it is genuinely good: three visible groups on a 1-20
// scale where 10 is an average professional and 15+ is real quality, plus hidden
// attributes that only scouting narrows down.
//
// Everything is a Uint8 in [1, 20]. That is not an implementation detail — the save
// budget in design §C depends on one attribute being one byte (§5a: ~2,600 players).

/** The 1-20 scale, used everywhere. */
export const ATTR_MIN = 1;
export const ATTR_MAX = 20;

/** Outfield technical attributes. */
export const TECHNICAL = [
  'corners',
  'crossing',
  'dribbling',
  'finishing',
  'firstTouch',
  'freeKicks',
  'heading',
  'longShots',
  'longThrows',
  'marking',
  'passing',
  'penaltyTaking',
  'tackling',
  'technique',
] as const;

/** Goalkeeping attributes. Occupy the same slot in the record as TECHNICAL for a keeper. */
export const GOALKEEPING = [
  'aerialReach',
  'commandOfArea',
  'communication',
  'eccentricity',
  'handling',
  'kicking',
  'oneOnOnes',
  'reflexes',
  'rushingOut',
  'punching',
  'throwing',
] as const;

export const MENTAL = [
  'aggression',
  'anticipation',
  'bravery',
  'composure',
  'concentration',
  'decisions',
  'determination',
  'flair',
  'leadership',
  'offTheBall',
  'positioning',
  'teamwork',
  'vision',
  'workRate',
] as const;

export const PHYSICAL = [
  'acceleration',
  'agility',
  'balance',
  'jumpingReach',
  'naturalFitness',
  'pace',
  'stamina',
  'strength',
] as const;

/**
 * Hidden attributes. Never shown as a number; scouting narrows them to a word or a range,
 * and several of them are only ever felt through what the player does over a season.
 */
export const HIDDEN = [
  'consistency',
  'importantMatches',
  'injuryProneness',
  'versatility',
  'adaptability',
  'ambition',
  'loyalty',
  'pressure',
  'professionalism',
  'sportsmanship',
  'temperament',
  'dirtiness',
] as const;

export type TechnicalAttr = (typeof TECHNICAL)[number];
export type GoalkeepingAttr = (typeof GOALKEEPING)[number];
export type MentalAttr = (typeof MENTAL)[number];
export type PhysicalAttr = (typeof PHYSICAL)[number];
export type HiddenAttr = (typeof HIDDEN)[number];

export type VisibleAttr = TechnicalAttr | GoalkeepingAttr | MentalAttr | PhysicalAttr;
export type AnyAttr = VisibleAttr | HiddenAttr;

/**
 * The full ordered key list. Order is the storage layout, so it is append-only: inserting
 * a key in the middle would reinterpret every existing save (see save/migrations.ts).
 */
export const ATTR_KEYS: readonly AnyAttr[] = [
  ...TECHNICAL,
  ...GOALKEEPING,
  ...MENTAL,
  ...PHYSICAL,
  ...HIDDEN,
];

export const ATTR_COUNT = ATTR_KEYS.length;

/** Index of each key in the packed record, built once. */
export const ATTR_INDEX: Readonly<Record<AnyAttr, number>> = (() => {
  const m = {} as Record<AnyAttr, number>;
  ATTR_KEYS.forEach((k, i) => {
    m[k] = i;
  });
  return m;
})();

/**
 * A player's attributes, packed. Reading goes through `attr()` rather than a property so
 * the storage layout stays a private detail of this module.
 */
export type Attributes = Uint8Array;

export function emptyAttributes(): Attributes {
  return new Uint8Array(ATTR_COUNT).fill(1);
}

export function attr(a: Attributes, key: AnyAttr): number {
  return a[ATTR_INDEX[key]] ?? 1;
}

export function setAttr(a: Attributes, key: AnyAttr, value: number): void {
  const v = Math.round(value);
  a[ATTR_INDEX[key]] = v < ATTR_MIN ? ATTR_MIN : v > ATTR_MAX ? ATTR_MAX : v;
}

/** Mean of several attributes — the shape most engine calls want. */
export function attrMean(a: Attributes, keys: readonly AnyAttr[]): number {
  if (keys.length === 0) return 1;
  let t = 0;
  for (const k of keys) t += attr(a, k);
  return t / keys.length;
}

/**
 * Attributes normalised to 0..1 for use as a probability weight. The mapping is
 * deliberately not linear from 1: an attribute of 1 should be bad, not impossible, and
 * the interesting resolution in football is between 10 and 18.
 */
export function attrUnit(a: Attributes, key: AnyAttr): number {
  return (attr(a, key) - 1) / (ATTR_MAX - 1);
}

/** Which group a key belongs to, for grouping in the UI. */
export type AttrGroup = 'technical' | 'goalkeeping' | 'mental' | 'physical' | 'hidden';

export function groupOf(key: AnyAttr): AttrGroup {
  if ((TECHNICAL as readonly string[]).includes(key)) return 'technical';
  if ((GOALKEEPING as readonly string[]).includes(key)) return 'goalkeeping';
  if ((MENTAL as readonly string[]).includes(key)) return 'mental';
  if ((PHYSICAL as readonly string[]).includes(key)) return 'physical';
  return 'hidden';
}

export function isHidden(key: AnyAttr): boolean {
  return (HIDDEN as readonly string[]).includes(key);
}
