// Positions, and what each one is actually for.
//
// A position is a slot on the pitch plus the attributes that matter in it. The second
// half is what makes CA a budget rather than a number: a striker and a centre-back with
// the same Current Ability are equally good at different things, because the same 200
// points bought different attributes.

import type { AnyAttr } from './attributes.js';

export const POSITIONS = [
  'GK',
  'DL',
  'DC',
  'DR',
  'WBL',
  'WBR',
  'DM',
  'ML',
  'MC',
  'MR',
  'AML',
  'AMC',
  'AMR',
  'ST',
] as const;

export type Position = (typeof POSITIONS)[number];

export const POSITION_COUNT = POSITIONS.length;

export const POSITION_INDEX: Readonly<Record<Position, number>> = (() => {
  const m = {} as Record<Position, number>;
  POSITIONS.forEach((p, i) => {
    m[p] = i;
  });
  return m;
})();

/** Broad band, for squad grouping and for the formation editor's colour coding. */
export type PositionBand = 'keeper' | 'defence' | 'midfield' | 'attack';

export const BAND_OF: Readonly<Record<Position, PositionBand>> = {
  GK: 'keeper',
  DL: 'defence',
  DC: 'defence',
  DR: 'defence',
  WBL: 'defence',
  WBR: 'defence',
  DM: 'midfield',
  ML: 'midfield',
  MC: 'midfield',
  MR: 'midfield',
  AML: 'attack',
  AMC: 'attack',
  AMR: 'attack',
  ST: 'attack',
};

/** Nominal spot on a 0..1 pitch (x = own goal to opposition goal, y = left to right). */
export const POSITION_SPOT: Readonly<Record<Position, readonly [number, number]>> = {
  GK: [0.04, 0.5],
  DL: [0.2, 0.14],
  DC: [0.18, 0.5],
  DR: [0.2, 0.86],
  WBL: [0.3, 0.08],
  WBR: [0.3, 0.92],
  DM: [0.33, 0.5],
  ML: [0.48, 0.12],
  MC: [0.46, 0.5],
  MR: [0.48, 0.88],
  AML: [0.68, 0.13],
  AMC: [0.66, 0.5],
  AMR: [0.68, 0.87],
  ST: [0.82, 0.5],
};

/**
 * How much each attribute counts toward Current Ability in this position. Weights are
 * relative within a position; `caOf()` normalises them.
 *
 * These are the game's opinion about football, so they are worth reading as such: a
 * centre-back's Pace matters, but less than his Positioning; a striker's Finishing is
 * worth more than his Passing; everyone's Stamina counts because everyone runs.
 */
type Weights = Partial<Record<AnyAttr, number>>;

/** Applied to every outfield position on top of its own weights. */
const OUTFIELD_BASE: Weights = {
  stamina: 3,
  workRate: 3,
  teamwork: 3,
  decisions: 4,
  anticipation: 3,
  concentration: 3,
  determination: 2,
  balance: 2,
  agility: 2,
  naturalFitness: 1,
  firstTouch: 3,
  technique: 2,
  passing: 2,
};

const CENTRE_BACK: Weights = {
  marking: 8,
  tackling: 8,
  positioning: 8,
  heading: 7,
  jumpingReach: 6,
  strength: 6,
  bravery: 5,
  composure: 4,
  pace: 4,
  acceleration: 3,
  aggression: 3,
};

const FULL_BACK: Weights = {
  marking: 6,
  tackling: 6,
  positioning: 5,
  crossing: 5,
  pace: 6,
  acceleration: 5,
  stamina: 4,
  dribbling: 3,
  workRate: 3,
  concentration: 4,
};

const WING_BACK: Weights = {
  marking: 4,
  tackling: 5,
  crossing: 7,
  dribbling: 5,
  pace: 7,
  acceleration: 6,
  stamina: 6,
  workRate: 5,
  offTheBall: 4,
};

const HOLDING_MID: Weights = {
  tackling: 7,
  marking: 5,
  positioning: 7,
  passing: 6,
  composure: 5,
  strength: 4,
  vision: 4,
  aggression: 3,
};

const CENTRE_MID: Weights = {
  passing: 8,
  vision: 7,
  technique: 6,
  composure: 5,
  offTheBall: 5,
  tackling: 4,
  longShots: 3,
  flair: 3,
  stamina: 4,
};

const WIDE_MID: Weights = {
  crossing: 7,
  dribbling: 6,
  pace: 7,
  acceleration: 6,
  technique: 5,
  offTheBall: 5,
  stamina: 5,
  agility: 4,
};

const ATTACKING_MID: Weights = {
  passing: 7,
  vision: 8,
  technique: 7,
  dribbling: 6,
  flair: 6,
  composure: 5,
  longShots: 5,
  offTheBall: 6,
  finishing: 4,
};

const WINGER: Weights = {
  dribbling: 8,
  pace: 8,
  acceleration: 8,
  crossing: 6,
  technique: 6,
  flair: 6,
  agility: 5,
  offTheBall: 5,
  finishing: 4,
};

const STRIKER: Weights = {
  finishing: 9,
  offTheBall: 8,
  composure: 7,
  firstTouch: 6,
  acceleration: 6,
  pace: 6,
  dribbling: 5,
  heading: 5,
  strength: 5,
  technique: 5,
  jumpingReach: 4,
  longShots: 3,
};

const KEEPER: Weights = {
  reflexes: 9,
  handling: 8,
  oneOnOnes: 7,
  aerialReach: 6,
  commandOfArea: 6,
  positioning: 7,
  concentration: 6,
  anticipation: 5,
  agility: 6,
  kicking: 4,
  communication: 4,
  rushingOut: 4,
  bravery: 3,
  throwing: 3,
  decisions: 5,
};

function withBase(w: Weights): Weights {
  const out: Weights = { ...OUTFIELD_BASE };
  for (const [k, v] of Object.entries(w)) {
    const key = k as AnyAttr;
    out[key] = (out[key] ?? 0) + (v ?? 0);
  }
  return out;
}

export const POSITION_WEIGHTS: Readonly<Record<Position, Weights>> = {
  GK: KEEPER,
  DL: withBase(FULL_BACK),
  DC: withBase(CENTRE_BACK),
  DR: withBase(FULL_BACK),
  WBL: withBase(WING_BACK),
  WBR: withBase(WING_BACK),
  DM: withBase(HOLDING_MID),
  ML: withBase(WIDE_MID),
  MC: withBase(CENTRE_MID),
  MR: withBase(WIDE_MID),
  AML: withBase(WINGER),
  AMC: withBase(ATTACKING_MID),
  AMR: withBase(WINGER),
  ST: withBase(STRIKER),
};

/**
 * Positions a player of this position can cover without being out of place, and how well.
 * Used to seed familiarity at generation and to warn in the squad screen. 1.0 is natural.
 */
export const POSITION_NEIGHBOURS: Readonly<Record<Position, Partial<Record<Position, number>>>> = {
  GK: {},
  DL: { WBL: 0.85, DC: 0.5, ML: 0.55 },
  DC: { DL: 0.5, DR: 0.5, DM: 0.55 },
  DR: { WBR: 0.85, DC: 0.5, MR: 0.55 },
  WBL: { DL: 0.85, ML: 0.7, AML: 0.45 },
  WBR: { DR: 0.85, MR: 0.7, AMR: 0.45 },
  DM: { MC: 0.8, DC: 0.6 },
  ML: { AML: 0.75, WBL: 0.65, MC: 0.5 },
  MC: { DM: 0.8, AMC: 0.75, ML: 0.45, MR: 0.45 },
  MR: { AMR: 0.75, WBR: 0.65, MC: 0.5 },
  AML: { ML: 0.75, AMC: 0.55, ST: 0.5 },
  AMC: { MC: 0.75, ST: 0.6, AML: 0.5, AMR: 0.5 },
  AMR: { MR: 0.75, AMC: 0.55, ST: 0.5 },
  ST: { AMC: 0.6, AML: 0.45, AMR: 0.45 },
};

export function isKeeper(p: Position): boolean {
  return p === 'GK';
}
