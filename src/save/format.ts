// The save format.
//
// Design §C sets a hard budget: the whole world, twice over (the slots are double
// buffered), inside a localStorage origin that is about 5 MB. A world is ~2,600 players
// with 59 attributes each, so the naive JSON — one object per player, one named field per
// attribute — is about 9 MB for one copy and does not fit at all.
//
// So attributes are packed. Every player's 59 bytes go into one contiguous Uint8Array
// which is base64'd once, and the rest of each player rides in parallel arrays rather than
// an array of objects. That turns roughly 3,400 bytes per player into about 90, and it is
// what makes save-anywhere possible rather than aspirational.

import { ATTR_COUNT, type Attributes } from '../sim/ratings/attributes.js';
import { POSITIONS, POSITION_COUNT, type Position } from '../sim/ratings/positions.js';
import { CULTURES, buildNameBook, type Culture } from '../sim/world/names.js';
import { FORMATIONS } from '../sim/match/tactics.js';
import type { Club, ClubLook, CrestSpec, EmblemLayer, Facilities, Fixture, World, WorldPlayer } from '../sim/world/types.js';
import { defaultLook, emptySeason, noFacilities } from '../sim/world/types.js';
import type { CameraMode } from '../render/camera.js';

export const SAVE_VERSION = 4;

export interface Settings {
  lang: string | null;
  sound: boolean;
  quality: 'auto' | 'low' | 'medium' | 'high' | 'ultra';
  matchSpeed: number;
  /** null = follow `prefers-reduced-motion`; true/false = the player said so. */
  reducedMotion: boolean | null;
  /** Whether the guided first match has been seen. Reset by the settings screen. */
  onboarded: boolean;
  /**
   * Live commentary during a match: none, on-screen text, or text read aloud.
   *
   * 'voice' is opt-in and never the default — see `src/ui/voice.ts` for why a spoken
   * option in a child-directed game needs more care than a toggle.
   */
  commentary: 'off' | 'text' | 'voice';
  /** The match camera last picked. 'tv' is the director cutting between them. */
  camera: CameraMode;
  /**
   * A modelled spectator in every seat, and how many of them. 'auto' follows the quality
   * tier; 'off' is the painted crowd, which costs nothing.
   */
  crowd3d: 'auto' | 'full' | 'half' | 'off';
  /** Flares, smoke, paper and camera flashes in the stands. */
  stadiumFx: boolean;
  /** Low-poly players with painted skins, or the sculpted ones (render/psx.ts, figure.ts). */
  playerStyle: 'retro' | 'realistic';
}

export function defaultSettings(): Settings {
  return {
    lang: null,
    sound: true,
    quality: 'auto',
    matchSpeed: 14,
    reducedMotion: null,
    onboarded: false,
    commentary: 'text',
    camera: 'tv',
    crowd3d: 'auto',
    stadiumFx: true,
    playerStyle: 'retro',
  };
}

/** What actually gets written. `world` is the packed blob; the rest is small. */
export interface SaveData {
  version: number;
  savedAt: number;
  /** Shown on the load screen without unpacking the whole world. */
  summary: {
    clubName: string;
    season: number;
    day: number;
    tier: number;
    position: number;
    points: number;
    /**
     * Enough to draw the club's badge on its slot, without unpacking two thousand players
     * to find out what colour it is. All three are optional because a save written before
     * this existed has none of them, and a career slot with no badge is a career slot with
     * no badge — not an error.
     */
    kitPrimary?: number;
    kitSecondary?: number;
    crest?: number[];
  };
  settings: Settings;
  world: PackedWorld;
}

export interface PackedWorld {
  seed: number;
  season: number;
  day: number;
  managedClubId: number;
  /** Both added with the intro. Older saves simply do not have them. */
  managerName?: string;
  /**
   * The managed club's badge, packed as six numbers in the order `CREST_FIELDS` names.
   *
   * A tuple rather than an object because it goes next to two thousand packed players and
   * six field names repeated in JSON is more bytes than the badge itself. Absent means the
   * player never opened the editor and the club wears whatever its id derives.
   */
  crest?: number[];
  /**
   * The managed club's kit parts, ball and roof, as five numbers in `packLook` order, and
   * its three facility levels. Both absent on a save from before the club studio, which
   * unpacks to the defaults — what that club was already wearing and had already built.
   */
  look?: number[];
  facilities?: number[];
  /** Base64 of every player's attributes, concatenated. */
  attrs: string;
  /** Base64 of every player's positional familiarity, concatenated. */
  familiarity: string;
  players: PackedPlayers;
  clubs: PackedClubs;
  divisions: { tier: number; name: string; clubIds: number[]; promoted: number; relegated: number }[];
  fixtures: number[];
}

interface PackedPlayers {
  count: number;
  firstIdx: number[];
  lastIdx: number[];
  culture: number[];
  age: number[];
  natural: number[];
  pa: number[];
  clubId: number[];
  squadNumber: number[];
  contractYears: number[];
  wage: number[];
  condition: number[];
  morale: number[];
  injuryDays: number[];
  yellows: number[];
  banMatches: number[];
  retired: number[];
  form: number[][];
  season: number[][];
  career: number[][];
}

interface PackedClubs {
  count: number;
  name: string[];
  short: string[];
  culture: number[];
  tier: number[];
  kitPrimary: number[];
  kitSecondary: number[];
  stadium: string[];
  capacity: number[];
  reputation: number[];
  balance: number[];
  transferBudget: number[];
  wageBudget: number[];
  formationId: number[];
  instructions: number[][];
  boardConfidence: number[];
  expectation: number[];
  playerIds: number[][];
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Two decimal places is plenty for a 0..1 value and saves two thirds of the bytes. */
const q = (v: number): number => Math.round(v * 100);
const unq = (v: number): number => v / 100;

/**
 * The badge, as six numbers.
 *
 * The order is the contract between `packCrest` and `unpackCrest` and nothing else may
 * depend on it — a field appended here is a new save version, never a reshuffle of what is
 * already written down.
 */
export function packCrest(c: CrestSpec): number[] {
  const out = [c.shape, c.pattern, c.border, c.emblem, c.stars, c.initials ? 1 : 0];
  // Layers are appended: a count, then seven numbers each. An older build reads the first
  // six and never sees them, which is the whole reason they go on the end.
  const layers = c.layers ?? [];
  if (layers.length > 0) {
    out.push(layers.length);
    for (const l of layers) out.push(l.glyph, l.colour, l.x, l.y, l.size, l.rot, l.flip ? 1 : 0);
  }
  return out;
}

export function unpackCrest(packed: number[] | undefined): CrestSpec | null {
  if (!packed || packed.length < 6) return null;
  const spec: CrestSpec = {
    shape: packed[0] ?? 0,
    pattern: packed[1] ?? 0,
    border: packed[2] ?? 1,
    emblem: packed[3] ?? 0,
    stars: packed[4] ?? 0,
    initials: (packed[5] ?? 1) === 1,
  };
  const count = Math.min(16, packed[6] ?? 0);
  if (count > 0) {
    const layers: EmblemLayer[] = [];
    for (let i = 0; i < count; i++) {
      const o = 7 + i * 7;
      if (packed.length < o + 7) break;
      layers.push({
        glyph: packed[o] ?? 0, colour: packed[o + 1] ?? 0, x: packed[o + 2] ?? 0, y: packed[o + 3] ?? 0,
        size: packed[o + 4] ?? 24, rot: packed[o + 5] ?? 0, flip: (packed[o + 6] ?? 0) === 1,
      });
    }
    spec.layers = layers;
  }
  return spec;
}

/** Same contract as `packCrest`: append a field, never reorder one. */
function packLook(l: ClubLook): number[] {
  return [
    l.shorts, l.sleeves, l.socks, l.ball, l.roof,
    l.pattern, l.patternColour, l.chestBadge ? 1 : 0, l.numberColour, l.numberStyle,
  ];
}

function unpackLook(packed: number[] | undefined): ClubLook {
  const d = defaultLook();
  if (!packed) return d;
  return {
    shorts: packed[0] ?? d.shorts,
    sleeves: packed[1] ?? d.sleeves,
    socks: packed[2] ?? d.socks,
    ball: packed[3] ?? d.ball,
    roof: packed[4] ?? d.roof,
    pattern: packed[5] ?? d.pattern,
    patternColour: packed[6] ?? d.patternColour,
    chestBadge: (packed[7] ?? (d.chestBadge ? 1 : 0)) === 1,
    numberColour: packed[8] ?? d.numberColour,
    numberStyle: packed[9] ?? d.numberStyle,
  };
}

function unpackFacilities(packed: number[] | undefined): Facilities {
  const d = noFacilities();
  if (!packed) return d;
  return { stands: packed[0] ?? 0, training: packed[1] ?? 0, shop: packed[2] ?? 0 };
}

export function packWorld(world: World): PackedWorld {
  const n = world.players.length;
  const attrs = new Uint8Array(n * ATTR_COUNT);
  const fam = new Uint8Array(n * POSITION_COUNT);

  const p: PackedPlayers = {
    count: n,
    firstIdx: [], lastIdx: [], culture: [], age: [], natural: [], pa: [], clubId: [],
    squadNumber: [], contractYears: [], wage: [], condition: [], morale: [], injuryDays: [],
    yellows: [], banMatches: [], retired: [], form: [], season: [], career: [],
  };

  world.players.forEach((pl, i) => {
    attrs.set(pl.attrs, i * ATTR_COUNT);
    fam.set(pl.familiarity, i * POSITION_COUNT);
    p.firstIdx.push(pl.firstIdx);
    p.lastIdx.push(pl.lastIdx);
    p.culture.push(CULTURES.indexOf(pl.culture));
    p.age.push(pl.age);
    p.natural.push(POSITIONS.indexOf(pl.natural));
    p.pa.push(pl.pa);
    p.clubId.push(pl.clubId);
    p.squadNumber.push(pl.squadNumber);
    p.contractYears.push(pl.contractYears);
    p.wage.push(pl.wage);
    p.condition.push(q(pl.condition));
    p.morale.push(q(pl.morale));
    p.injuryDays.push(pl.injuryDays);
    p.yellows.push(pl.yellows);
    p.banMatches.push(pl.banMatches);
    p.retired.push(pl.retired ? 1 : 0);
    p.form.push(pl.form.map((f) => Math.round(f * 10)));
    p.season.push([
      pl.season.apps, pl.season.minutes, pl.season.goals, pl.season.assists,
      Math.round(pl.season.ratingSum * 10), pl.season.cleanSheets,
    ]);
    p.career.push([pl.career.apps, pl.career.goals, pl.career.assists, pl.career.honours]);
  });

  const c: PackedClubs = {
    count: world.clubs.length,
    name: [], short: [], culture: [], tier: [], kitPrimary: [], kitSecondary: [], stadium: [],
    capacity: [], reputation: [], balance: [], transferBudget: [], wageBudget: [],
    formationId: [], instructions: [], boardConfidence: [], expectation: [], playerIds: [],
  };
  const formationIds = FORMATIONS.map((f) => f.id);
  for (const cl of world.clubs) {
    c.name.push(cl.name);
    c.short.push(cl.short);
    c.culture.push(CULTURES.indexOf(cl.culture));
    c.tier.push(cl.tier);
    c.kitPrimary.push(cl.kitPrimary);
    c.kitSecondary.push(cl.kitSecondary);
    c.stadium.push(cl.stadium);
    c.capacity.push(cl.capacity);
    c.reputation.push(Math.round(cl.reputation));
    c.balance.push(Math.round(cl.balance));
    c.transferBudget.push(Math.round(cl.transferBudget));
    c.wageBudget.push(Math.round(cl.wageBudget));
    c.formationId.push(Math.max(0, formationIds.indexOf(cl.formationId)));
    const i = cl.instructions;
    c.instructions.push([q(i.tempo), q(i.width), q(i.lineHeight), q(i.pressing), q(i.directness), q(i.attackingIntent)]);
    c.boardConfidence.push(q(cl.boardConfidence));
    c.expectation.push(cl.expectation);
    c.playerIds.push(cl.playerIds);
  }

  // Fixtures are five small integers each, flattened — 1,900 objects with named fields is
  // most of a megabyte on its own.
  const fixtures: number[] = [];
  for (const f of world.fixtures) {
    fixtures.push(f.day, f.round, f.homeId, f.awayId, f.tier, f.played ? 1 : 0, f.homeGoals, f.awayGoals);
  }

  return {
    seed: world.seed,
    season: world.season,
    day: world.day,
    managedClubId: world.managedClubId,
    managerName: world.managerName,
    ...(world.crest ? { crest: packCrest(world.crest) } : {}),
    look: packLook(world.look),
    facilities: [world.facilities.stands, world.facilities.training, world.facilities.shop],
    attrs: toBase64(attrs),
    familiarity: toBase64(fam),
    players: p,
    clubs: c,
    divisions: world.divisions.map((d) => ({
      tier: d.tier, name: d.name, clubIds: d.clubIds, promoted: d.promoted, relegated: d.relegated,
    })),
    fixtures,
  };
}

export function unpackWorld(packed: PackedWorld): World {
  const attrs = fromBase64(packed.attrs);
  const fam = fromBase64(packed.familiarity);
  const pp = packed.players;
  const players: WorldPlayer[] = [];

  for (let i = 0; i < pp.count; i++) {
    const s = pp.season[i] ?? [0, 0, 0, 0, 0, 0];
    const car = pp.career[i] ?? [0, 0, 0, 0];
    players.push({
      id: i,
      firstIdx: pp.firstIdx[i] ?? 0,
      lastIdx: pp.lastIdx[i] ?? 0,
      culture: (CULTURES[pp.culture[i] ?? 0] ?? CULTURES[0]) as Culture,
      age: pp.age[i] ?? 20,
      natural: (POSITIONS[pp.natural[i] ?? 0] ?? 'MC') as Position,
      familiarity: fam.slice(i * POSITION_COUNT, (i + 1) * POSITION_COUNT),
      attrs: attrs.slice(i * ATTR_COUNT, (i + 1) * ATTR_COUNT) as Attributes,
      pa: pp.pa[i] ?? 100,
      clubId: pp.clubId[i] ?? -1,
      squadNumber: pp.squadNumber[i] ?? 0,
      contractYears: pp.contractYears[i] ?? 1,
      wage: pp.wage[i] ?? 0,
      condition: unq(pp.condition[i] ?? 100),
      morale: unq(pp.morale[i] ?? 70),
      form: (pp.form[i] ?? []).map((f) => f / 10),
      injuryDays: pp.injuryDays[i] ?? 0,
      yellows: pp.yellows[i] ?? 0,
      banMatches: pp.banMatches[i] ?? 0,
      retired: (pp.retired[i] ?? 0) === 1,
      season: {
        apps: s[0] ?? 0, minutes: s[1] ?? 0, goals: s[2] ?? 0, assists: s[3] ?? 0,
        ratingSum: (s[4] ?? 0) / 10, cleanSheets: s[5] ?? 0,
      },
      career: { apps: car[0] ?? 0, goals: car[1] ?? 0, assists: car[2] ?? 0, honours: car[3] ?? 0 },
    });
  }

  const cc = packed.clubs;
  const formationIds = FORMATIONS.map((f) => f.id);
  const clubs: Club[] = [];
  for (let i = 0; i < cc.count; i++) {
    const ins = cc.instructions[i] ?? [50, 50, 50, 50, 40, 50];
    clubs.push({
      id: i,
      name: cc.name[i] ?? `Club ${i}`,
      short: cc.short[i] ?? 'CLB',
      culture: (CULTURES[cc.culture[i] ?? 0] ?? CULTURES[0]) as Culture,
      tier: cc.tier[i] ?? 0,
      kitPrimary: cc.kitPrimary[i] ?? 0xffffff,
      kitSecondary: cc.kitSecondary[i] ?? 0x000000,
      stadium: cc.stadium[i] ?? 'Ground',
      capacity: cc.capacity[i] ?? 5000,
      reputation: cc.reputation[i] ?? 50,
      balance: cc.balance[i] ?? 0,
      transferBudget: cc.transferBudget[i] ?? 0,
      wageBudget: cc.wageBudget[i] ?? 0,
      formationId: formationIds[cc.formationId[i] ?? 0] ?? formationIds[0] ?? '4-4-2',
      instructions: {
        tempo: unq(ins[0] ?? 50), width: unq(ins[1] ?? 50), lineHeight: unq(ins[2] ?? 50),
        pressing: unq(ins[3] ?? 50), directness: unq(ins[4] ?? 40), attackingIntent: unq(ins[5] ?? 50),
      },
      boardConfidence: unq(cc.boardConfidence[i] ?? 65),
      expectation: cc.expectation[i] ?? 10,
      playerIds: cc.playerIds[i] ?? [],
    });
  }

  const fixtures: Fixture[] = [];
  for (let i = 0; i + 7 < packed.fixtures.length + 1; i += 8) {
    fixtures.push({
      day: packed.fixtures[i] ?? 0,
      round: packed.fixtures[i + 1] ?? 0,
      homeId: packed.fixtures[i + 2] ?? 0,
      awayId: packed.fixtures[i + 3] ?? 0,
      tier: packed.fixtures[i + 4] ?? 0,
      played: (packed.fixtures[i + 5] ?? 0) === 1,
      homeGoals: packed.fixtures[i + 6] ?? 0,
      awayGoals: packed.fixtures[i + 7] ?? 0,
    });
  }

  return {
    seed: packed.seed,
    book: buildNameBook(),
    players,
    clubs,
    divisions: packed.divisions.map((d) => ({ ...d, clubIds: [...d.clubIds] })),
    fixtures,
    season: packed.season,
    day: packed.day,
    managedClubId: packed.managedClubId,
    // Defaulted rather than migrated: both arrived with the intro, and a career started
    // before it simply has no manager name and wears whatever its club id derives.
    managerName: packed.managerName ?? '',
    crest: unpackCrest(packed.crest),
    look: unpackLook(packed.look),
    facilities: unpackFacilities(packed.facilities),
    formations: new Map(FORMATIONS.map((f) => [f.id, f])),
  };
}

export { emptySeason };
