// The world model: everything that persists between matches.
//
// Shapes here are chosen for the save budget as much as for convenience (design §C).
// Names are indices into the NameBook, attributes are a Uint8Array, and anything derivable
// — Current Ability, a player's value, a league table — is computed rather than stored, so
// it can never disagree with the thing it was derived from.

import type { Attributes } from '../ratings/attributes.js';
import type { Position } from '../ratings/positions.js';
import type { Formation, TeamInstructions } from '../match/types.js';
import type { Culture, NameBook } from './names.js';

/** Days in a season, from the first day of pre-season to the last day of the summer. */
export const SEASON_DAYS = 365;

export interface WorldPlayer {
  readonly id: number;
  /** Indices into NameBook. */
  firstIdx: number;
  lastIdx: number;
  culture: Culture;
  /** Age in years at the start of the current season. */
  age: number;
  natural: Position;
  /** 0-20 per position, indexed by POSITIONS order. How well he plays there. */
  familiarity: Uint8Array;
  attrs: Attributes;
  /** Potential Ability, 1-200. Never shown as a number; scouting narrows a band. */
  pa: number;
  clubId: number;
  squadNumber: number;
  /** Years left on the contract, counted down at each season roll. */
  contractYears: number;
  /** Weekly wage. */
  wage: number;
  /** 0..1 match fitness. Falls with minutes played and recovers with rest. */
  condition: number;
  /** 0..1 how happy he is. Drives performance and contract talks. */
  morale: number;
  /** Recent match ratings, newest last, capped at five. */
  form: number[];
  /** Days until he is fit again; 0 when fit. */
  injuryDays: number;
  /** Yellow cards this season; a threshold triggers a ban. */
  yellows: number;
  /** Matches still to sit out. */
  banMatches: number;
  season: PlayerSeason;
  career: PlayerCareer;
  /**
   * He has left the game for good. An explicit flag rather than a sentinel age: age 99 was
   * used for this once, and because a clubless player is a free agent, the market signed
   * ninety-nine-year-olds back into squads the following summer.
   */
  retired: boolean;
}

export interface PlayerSeason {
  apps: number;
  minutes: number;
  goals: number;
  assists: number;
  ratingSum: number;
  cleanSheets: number;
}

export interface PlayerCareer {
  apps: number;
  goals: number;
  assists: number;
  /** Trophies won, by division tier or cup id. Kept as a count, not a list of dates. */
  honours: number;
}

export function emptySeason(): PlayerSeason {
  return { apps: 0, minutes: 0, goals: 0, assists: 0, ratingSum: 0, cleanSheets: 0 };
}

export interface Club {
  readonly id: number;
  name: string;
  short: string;
  culture: Culture;
  /** 0 is the top division. */
  tier: number;
  kitPrimary: number;
  kitSecondary: number;
  stadium: string;
  capacity: number;
  /** 0-200, in the same units as ability, so the two can be compared. */
  reputation: number;
  balance: number;
  /** Set by the board at the season roll. */
  transferBudget: number;
  wageBudget: number;
  playerIds: number[];
  formationId: string;
  instructions: TeamInstructions;
  /** Board confidence, 0..1. Never reaches zero without an offer arriving (design §8). */
  boardConfidence: number;
  /** What the board asked for this season, as a league position. */
  expectation: number;
}

export interface Division {
  readonly tier: number;
  name: string;
  clubIds: number[];
  /** How many go up and come down. */
  promoted: number;
  relegated: number;
}

export interface Fixture {
  /** Day of the season this is played on. */
  day: number;
  round: number;
  homeId: number;
  awayId: number;
  tier: number;
  played: boolean;
  homeGoals: number;
  awayGoals: number;
}

export interface TableRow {
  clubId: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

export interface World {
  readonly seed: number;
  book: NameBook;
  /** Dense array indexed by player id, so a lookup is not a hash. */
  players: WorldPlayer[];
  clubs: Club[];
  divisions: Division[];
  fixtures: Fixture[];
  /** Seasons elapsed since the world was created. */
  season: number;
  /** Day within the season, 0..SEASON_DAYS-1. */
  day: number;
  /** The club the player manages, or -1 before they have chosen. */
  managedClubId: number;
  /** What the player called themselves. Empty until the intro asks. */
  managerName: string;
  /**
   * The badge the managed club wears, or null if the player has never changed it.
   *
   * On the world rather than on the Club because exactly one club in a hundred has a
   * player-chosen crest, and widening every club's record to carry a field that is only
   * ever set on one of them would cost a hundred entries in the packed save for one value.
   * Every OTHER club still has a badge — `derivedCrest` in `src/ui/crest.ts` hashes it out
   * of the club id, which is why three hundred distinct crests cost nothing to store.
   *
   * Null rather than a default so that a career started before the editor existed keeps
   * whatever its id derives, instead of being handed a badge somebody has to notice.
   */
  crest: CrestSpec | null;
  /**
   * How the managed club's kit, ball and ground are dressed, beyond its two colours.
   *
   * On the world for the same reason `crest` is: one club in a hundred has it. Never null —
   * `defaultLook()` is what a club that nobody has dressed is already wearing, so a career
   * saved before this existed looks exactly as it did.
   */
  look: ClubLook;
  /** What the managed club has built. Every level starts at zero. */
  facilities: Facilities;
  /** Formations are shared objects; the club stores an id. */
  formations: Map<string, Formation>;
}

/**
 * A club badge, as data.
 *
 * Six small integers and a flag. What a `shape` or a `pattern` index MEANS is
 * `src/ui/crest.ts`'s business — this is only the record of which one, which is why the
 * sim layer can carry it without knowing anything about SVG.
 *
 * The COLOURS are deliberately absent: a crest is drawn in the club's own kit colours, read
 * at draw time. A badge carrying its own copy could disagree with the shirt the moment
 * somebody edited one, and a badge that is not the team's colours is not a badge.
 */
export interface CrestSpec {
  /** The outline, and the clip everything else is painted inside. */
  shape: number;
  /** What is painted inside it: halves, hoops, a sash, a chequerboard. */
  pattern: number;
  /** The rule around the edge, if any. */
  border: number;
  /** A small symbol in the middle. 0 is none, and most clubs have none. */
  emblem: number;
  /** Championship stars across the top, 0 to CREST_MAX_STARS. */
  stars: number;
  /** Whether the three-letter short name is written across it. */
  initials: boolean;
  /**
   * Emblem layers, bottom first, built in the badge editor's Layers tab. Absent on every
   * derived badge and on any a player never layered, which draw exactly as before.
   */
  layers?: EmblemLayer[];
}

/**
 * One piece of an emblem: a glyph from `src/ui/emblems.ts`, a colour index, a position
 * from the badge's centre in its 64-unit box, a size in the same units, a turn in degrees,
 * and a mirror.
 */
export interface EmblemLayer {
  glyph: number;
  colour: number;
  x: number;
  y: number;
  size: number;
  rot: number;
  flip: boolean;
}

/**
 * Where one part of the kit takes its colour from. An index rather than a colour so that
 * editing the club's two colours carries every part of the kit along with it — a kit that
 * kept its own copy of red would stay red after the shirt turned blue.
 */
export const KIT_SOURCES = ['primary', 'secondary', 'white', 'black'] as const;
export type KitSource = (typeof KIT_SOURCES)[number];

/** Every field is a small index, so the whole look packs into a handful of numbers. */
export interface ClubLook {
  /** Index into KIT_SOURCES. The shorts are the secondary colour unless somebody says so. */
  shorts: number;
  sleeves: number;
  socks: number;
  /** Index into BALL_STYLES (src/render/ballStyle.ts). */
  ball: number;
  /** Index into ROOF_STYLES: slate, the club's first colour or its second. */
  roof: number;
  /** Index into KIT_PATTERNS (src/render/kitPattern.ts). 0 is a plain shirt. */
  pattern: number;
  /** KIT_SOURCES index for the pattern's colour: the second colour unless changed. */
  patternColour: number;
  /** Whether the badge is worn on the chest. */
  chestBadge: boolean;
  /** KIT_SOURCES index for the shirt numbers, and a NUMBER_STYLES index for how they look. */
  numberColour: number;
  numberStyle: number;
}

export function defaultLook(): ClubLook {
  return {
    shorts: 1, sleeves: 0, socks: 0, ball: 0, roof: 0,
    pattern: 0, patternColour: 1, chestBadge: true, numberColour: 2, numberStyle: 0,
  };
}

/**
 * The three things a club can build. Each is a level, 0 to its maximum in
 * `src/sim/career/facilities.ts`, which is also where what a level DOES is written down.
 */
export interface Facilities {
  /** Bigger stands: more seats, more gate money. */
  stands: number;
  /** A better training ground: players recover faster and young ones develop quicker. */
  training: number;
  /** A club shop: money from every home crowd on top of the gate. */
  shop: number;
}

export function noFacilities(): Facilities {
  return { stands: 0, training: 0, shop: 0 };
}

/** The colour a kit part is, given the club's two colours. */
export function kitColour(source: number, primary: number, secondary: number): number {
  switch (KIT_SOURCES[source] ?? 'primary') {
    case 'secondary': return secondary;
    case 'white': return 0xf5f7fa;
    case 'black': return 0x16181d;
    default: return primary;
  }
}

export function playerById(world: World, id: number): WorldPlayer | undefined {
  return world.players[id];
}

export function clubById(world: World, id: number): Club | undefined {
  return world.clubs[id];
}

export function squadOf(world: World, clubId: number): WorldPlayer[] {
  const club = clubById(world, clubId);
  if (!club) return [];
  const out: WorldPlayer[] = [];
  for (const id of club.playerIds) {
    const p = world.players[id];
    if (p) out.push(p);
  }
  return out;
}

/** Average of a player's recent ratings, or 6.5 if he has not played. */
export function formOf(p: WorldPlayer): number {
  if (p.form.length === 0) return 6.5;
  let t = 0;
  for (const r of p.form) t += r;
  return t / p.form.length;
}

export function isAvailable(p: WorldPlayer): boolean {
  return p.injuryDays === 0 && p.banMatches === 0;
}
