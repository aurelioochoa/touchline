// Building a football world from a seed.
//
// One nation, five divisions, twenty clubs each, twenty-six players each — about 2,600
// players. That size is not a guess: it is the largest world that fits the localStorage
// budget with room for twenty seasons of history behind it (design §5a and §C), and
// choosing it here rather than discovering it at save time is the point.

import { chance, gauss, int, mulberry32, pick, range, shuffle, streamOf, type Rng } from '../../core/rng.js';
import { clamp } from '../../core/math.js';
import { caOf, generateAttributes, rollPotential } from '../ratings/ability.js';
import { POSITIONS, POSITION_INDEX, POSITION_NEIGHBOURS, type Position } from '../ratings/positions.js';
import { DEFAULT_FORMATION, FORMATIONS, formationById } from '../match/tactics.js';
import { defaultInstructions } from '../match/types.js';
import { buildNameBook, CULTURES, rollClubName, rollName, rollStadiumName, type Culture } from './names.js';
import { defaultLook, emptySeason, noFacilities, type Club, type Division, type World, type WorldPlayer } from './types.js';

export const TIERS = 5;
export const CLUBS_PER_DIVISION = 20;
export const SQUAD_SIZE = 26;

/** Average Current Ability of a mid-table club in each division. */
const TIER_STRENGTH = [142, 118, 96, 78, 62];
/** Reputation of a mid-table club in each division, on the same 1-200 scale. */
const TIER_REPUTATION = [150, 118, 92, 70, 52];
/** Stadium capacity of a mid-table club in each division. */
const TIER_CAPACITY = [42000, 22000, 11000, 5500, 2600];

const DIVISION_NAMES = [
  'Premier Division',
  'Championship',
  'League One',
  'League Two',
  'National League',
];

/** The squad a club needs: enough of everything, weighted the way a real squad is. */
const SQUAD_TEMPLATE: Position[] = [
  'GK', 'GK', 'GK',
  'DC', 'DC', 'DC', 'DC',
  'DL', 'DL', 'DR', 'DR',
  'DM', 'DM',
  'MC', 'MC', 'MC',
  'ML', 'MR',
  'AMC', 'AMC',
  'AML', 'AMR',
  'ST', 'ST', 'ST', 'ST',
];

export function createWorld(seed: number): World {
  const book = buildNameBook();
  const clubRng = streamOf(seed, 'clubs');
  const playerRng = streamOf(seed, 'players');

  const world: World = {
    seed,
    book,
    players: [],
    clubs: [],
    divisions: [],
    fixtures: [],
    season: 0,
    day: 0,
    managedClubId: -1,
    managerName: '',
    crest: null,
    look: defaultLook(),
    facilities: noFacilities(),
    formations: new Map(FORMATIONS.map((f) => [f.id, f])),
  };

  const usedNames = new Set<string>();
  let clubId = 0;
  let playerId = 0;

  for (let tier = 0; tier < TIERS; tier++) {
    const division: Division = {
      tier,
      name: DIVISION_NAMES[tier] ?? `Division ${tier + 1}`,
      clubIds: [],
      // Three up and three down everywhere except the top, which has nowhere to go.
      promoted: tier === 0 ? 0 : 3,
      relegated: tier === TIERS - 1 ? 0 : 3,
    };

    for (let i = 0; i < CLUBS_PER_DIVISION; i++) {
      const culture = pick(clubRng, CULTURES);
      const { name, short } = rollClubName(clubRng, culture, usedNames);
      // Spread within the division, so a league has a shape rather than twenty equals.
      const strength = clamp(
        (TIER_STRENGTH[tier] as number) + gauss(clubRng) * 11,
        18,
        195,
      );
      const reputation = clamp(
        (TIER_REPUTATION[tier] as number) + (strength - (TIER_STRENGTH[tier] as number)) * 0.8 + gauss(clubRng) * 6,
        10,
        200,
      );
      const capacity = Math.round(
        (TIER_CAPACITY[tier] as number) * range(clubRng, 0.55, 1.55),
      );
      const kit = rollKit(clubRng);

      const club: Club = {
        id: clubId,
        name,
        short,
        culture,
        tier,
        kitPrimary: kit.primary,
        kitSecondary: kit.secondary,
        stadium: rollStadiumName(clubRng, name),
        capacity,
        reputation,
        balance: Math.round(capacity * range(clubRng, 40, 160)),
        transferBudget: 0,
        wageBudget: 0,
        formationId: pick(clubRng, FORMATIONS).id,
        instructions: defaultInstructions(),
        playerIds: [],
        boardConfidence: 0.65,
        expectation: Math.round(CLUBS_PER_DIVISION / 2),
      };

      for (const role of SQUAD_TEMPLATE) {
        const p = createPlayer(playerRng, book, playerId++, club.id, role, strength, culture);
        world.players.push(p);
        club.playerIds.push(p.id);
      }
      assignSquadNumbers(world, club);
      setBudgets(club);

      world.clubs.push(club);
      division.clubIds.push(club.id);
      clubId++;
    }
    world.divisions.push(division);
  }

  return world;
}

/**
 * Kit colours. The two must differ from each other, not only from the grass: the crest, the
 * tactics tokens and the squad chips are all drawn from this pair, and a black-on-black
 * club is an invisible crest and an unreadable shirt number.
 */
function rollKit(rng: Rng): { primary: number; secondary: number } {
  const PALETTE = [
    0xd8353a, 0x1f4fd8, 0xf5f7fa, 0x18181c, 0xf5a623, 0x7b2ff7,
    0x0f9d58, 0x00b3c8, 0x8b1e3f, 0x2d3f6e, 0xe45c9a, 0xffd447,
  ];
  const primary = pick(rng, PALETTE);
  // Shorts are white, black or the kit colour — the three real football does — but never
  // the same shade as the shirt.
  const options = [0xf5f7fa, 0x18181c, primary].filter((c) => contrast(c, primary) > 0.18 || c === primary);
  const secondary = pick(rng, options.length > 1 ? options.filter((c) => c !== primary) : [0xf5f7fa]);
  return { primary, secondary };
}

/** Crude luminance gap, enough to tell "these two read as different colours". */
function contrast(a: number, b: number): number {
  const lum = (c: number): number =>
    (((c >> 16) & 255) * 0.299 + ((c >> 8) & 255) * 0.587 + (c & 255) * 0.114) / 255;
  return Math.abs(lum(a) - lum(b));
}

/** Ink that will be legible on a given kit colour — white on dark, near-black on light. */
export function inkOn(colour: number): string {
  const lum = (((colour >> 16) & 255) * 0.299 + ((colour >> 8) & 255) * 0.587 + (colour & 255) * 0.114) / 255;
  return lum > 0.55 ? '#12211a' : '#ffffff';
}

export function createPlayer(
  rng: Rng,
  book: ReturnType<typeof buildNameBook>,
  id: number,
  clubId: number,
  natural: Position,
  clubStrength: number,
  clubCulture: Culture,
): WorldPlayer {
  // Most players share the club's culture; a handful do not, which is what makes a squad
  // list read like a football squad rather than a phone book from one town.
  const culture = chance(rng, 0.72) ? clubCulture : pick(rng, CULTURES);
  const { first, last } = rollName(rng, book, culture);

  // Age: a squad is mostly mid-twenties with a tail either side.
  const age = clamp(Math.round(25 + gauss(rng) * 4.2), 16, 38);
  // Squad players sit below the club's headline strength; a few sit above it.
  const ca = clamp(Math.round(clubStrength + gauss(rng) * 13 - 4), 12, 198);

  const attrs = generateAttributes(rng, natural, ca);
  const pa = rollPotential(rng, caOf(attrs, natural), age);

  const familiarity = new Uint8Array(POSITIONS.length);
  familiarity[POSITION_INDEX[natural]] = 20;
  for (const [pos, level] of Object.entries(POSITION_NEIGHBOURS[natural])) {
    const idx = POSITION_INDEX[pos as Position];
    // Versatility is hidden and decides how much of the neighbouring ground he covers.
    familiarity[idx] = Math.round((level ?? 0) * 20 * range(rng, 0.7, 1.05));
  }

  return {
    id,
    firstIdx: first,
    lastIdx: last,
    culture,
    age,
    natural,
    familiarity,
    attrs,
    pa,
    clubId,
    squadNumber: 0,
    contractYears: int(rng, 1, 4),
    wage: wageFor(ca, age),
    condition: 1,
    morale: range(rng, 0.55, 0.9),
    form: [],
    injuryDays: 0,
    yellows: 0,
    banMatches: 0,
    season: emptySeason(),
    career: { apps: 0, goals: 0, assists: 0, honours: 0 },
    retired: false,
  };
}

/**
 * Weekly wage from ability and age. Superlinear in ability, because football is: the gap
 * between a good player and a great one is far more than the gap in their attributes.
 */
export function wageFor(ca: number, age: number): number {
  const base = Math.pow(Math.max(ca, 10) / 100, 3.4) * 9000;
  const peak = 1 - Math.abs(age - 27) * 0.02;
  return Math.max(150, Math.round((base * clamp(peak, 0.55, 1)) / 50) * 50);
}

/**
 * Transfer value. Ability, then how much of a career is left, then how much of it might
 * still be in front of him — a 19-year-old with room to grow costs more than a 31-year-old
 * who is better today, which is the single most important shape in a transfer market.
 */
export function valueFor(ca: number, pa: number, age: number, contractYears: number): number {
  const ability = Math.pow(Math.max(ca, 10) / 100, 4.1) * 4_000_000;
  const yearsLeft = clamp((34 - age) / 12, 0.15, 1);
  const upside = 1 + clamp((pa - ca) / 60, 0, 1) * clamp((26 - age) / 10, 0, 1) * 1.6;
  // A player in the last year of his contract is cheap, because next summer he is free.
  const leverage = contractYears <= 1 ? 0.42 : contractYears === 2 ? 0.78 : 1;
  return Math.max(5000, Math.round((ability * yearsLeft * upside * leverage) / 1000) * 1000);
}

/** Squad numbers: 1 for the first keeper, then low numbers to the better players. */
export function assignSquadNumbers(world: World, club: Club): void {
  const squad = club.playerIds.map((id) => world.players[id]).filter((p): p is WorldPlayer => !!p);
  const keepers = squad.filter((p) => p.natural === 'GK');
  const outfield = squad.filter((p) => p.natural !== 'GK');
  outfield.sort((a, b) => caOf(b.attrs, b.natural) - caOf(a.attrs, a.natural));

  const taken = new Set<number>();
  keepers.forEach((k, i) => {
    const n = i === 0 ? 1 : 12 + i;
    k.squadNumber = n;
    taken.add(n);
  });
  let next = 2;
  for (const p of outfield) {
    while (taken.has(next) && next < 40) next++;
    p.squadNumber = next;
    taken.add(next);
  }
}

/** The board's budgets for the season, from what the club can afford. */
export function setBudgets(club: Club): void {
  const income = club.capacity * 19 * 26 + (5 - club.tier) * 900_000;
  club.wageBudget = Math.round((income * 0.62) / 52);
  club.transferBudget = Math.round(Math.max(0, club.balance * 0.4 + income * 0.14));
}

/**
 * Pick a club for a new manager to start at, from a tier. Deliberately excludes the very
 * strongest — starting at the best club in the country is the least interesting career
 * available, and the game should not offer it as the obvious default.
 */
export function startingClubs(world: World, tier: number): Club[] {
  const division = world.divisions[tier];
  if (!division) return [];
  const clubs = division.clubIds
    .map((id) => world.clubs[id])
    .filter((c): c is Club => !!c)
    .sort((a, b) => b.reputation - a.reputation);
  return tier === 0 ? clubs.slice(3) : clubs;
}

/** A quick strength estimate for a club, from the best eleven it could field. */
export function clubStrength(world: World, club: Club): number {
  const squad = club.playerIds
    .map((id) => world.players[id])
    .filter((p): p is WorldPlayer => !!p)
    .map((p) => caOf(p.attrs, p.natural))
    .sort((a, b) => b - a)
    .slice(0, 11);
  if (squad.length === 0) return 0;
  let t = 0;
  for (const c of squad) t += c;
  return t / squad.length;
}

/** Deterministic per-world stream for anything that needs one after generation. */
export function worldStream(world: World, label: string): Rng {
  return streamOf(world.seed, label);
}

export { mulberry32, shuffle, formationById, DEFAULT_FORMATION };
