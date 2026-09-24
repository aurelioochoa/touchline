// The calendar: the loop that turns fixtures into a career.
//
// One function does the work — `advanceDay` — and everything else hangs off it. Matches on
// today's date are played, everyone rests or recovers, and at the end of the last round
// the season rolls over: promotion, relegation, ageing, contracts, retirements and a new
// intake. A career is this called four hundred times a year.
//
// The managed club's fixture is handled differently from the other 1,899: it can be handed
// to the full engine so the player can watch it, while the rest go through the quick one
// (design §5c and match/quick.ts). Both produce the same MatchResult, so nothing
// downstream knows or cares which ran.

import { clamp, clamp01 } from '../../core/math.js';
import { conditionsFor } from '../match/conditions.js';
import { chance, int, range, shuffle, streamOf, type Rng } from '../../core/rng.js';
import { caOf } from '../ratings/ability.js';
import { attrUnit } from '../ratings/attributes.js';
import { MatchEngine } from '../match/engine.js';
import { quickMatch } from '../match/quick.js';
import type { MatchResult } from '../match/types.js';
import { buildNameBook } from '../world/names.js';
import { createPlayer, setBudgets, assignSquadNumbers, SQUAD_SIZE, clubStrength } from '../world/worldgen.js';
import {
  emptySeason,
  isAvailable,
  squadOf,
  type Club,
  type Fixture,
  type World,
  type WorldPlayer,
} from '../world/types.js';
import { buildSeasonFixtures, buildTable, lastMatchDay, positionOf } from './fixtures.js';
import {
  developPlayer,
  recoverCondition,
  retires,
  tireFromMatch,
  updateMorale,
  youthPotential,
} from './development.js';
import { buildTeamSetup, ensureKitContrast, pickEleven } from './squad.js';
import { coachingBonus, recoveryDays, shopIncome } from './facilities.js';
import { placeFreeAgents, pruneRetired, runTransferWindow } from './transfers.js';

/** Yellow cards that trigger a one-match ban. */
const YELLOW_BAN_THRESHOLD = 5;
/** A squad may float between these; SQUAD_SIZE is only the starting point. */
const MIN_SQUAD = 22;
const MAX_SQUAD = 30;
/** The positions a youth intake can arrive in. */
const YOUTH_ROLES = ['GK', 'DC', 'DL', 'DR', 'DM', 'MC', 'ML', 'MR', 'AMC', 'AML', 'AMR', 'ST'] as const;

export interface DayReport {
  day: number;
  played: Fixture[];
  /** The managed club's fixture today, if there was one. */
  ownFixture: Fixture | null;
  seasonEnded: boolean;
}

/** Set a world up for a new season: fixtures, budgets, expectations, clean stats. */
export function startSeason(world: World): void {
  const rng = streamOf(world.seed + world.season * 7919, 'fixtures');
  world.fixtures = buildSeasonFixtures(world, rng);
  world.day = 0;

  for (const club of world.clubs) {
    setBudgets(club);
    club.expectation = expectationFor(world, club);
    club.boardConfidence = clamp01(club.boardConfidence * 0.5 + 0.4);
  }
  for (const p of world.players) {
    p.season = emptySeason();
    p.yellows = 0;
    p.banMatches = 0;
    p.form = [];
    p.condition = 1;
  }
}

/**
 * What the board asks for. Based on where the club's wage bill sits in its division, which
 * is the fairest available proxy for what it ought to manage — and it means a promoted
 * side is asked to survive rather than to win.
 */
export function expectationFor(world: World, club: Club): number {
  const division = world.divisions[club.tier];
  if (!division) return 10;
  const ranked = division.clubIds
    .map((id) => world.clubs[id])
    .filter((c): c is Club => !!c)
    .sort((a, b) => clubStrength(world, b) - clubStrength(world, a));
  const rank = ranked.findIndex((c) => c.id === club.id) + 1;
  // Boards are optimistic by about two places, which is what gives the job its pressure.
  return clamp(rank - 2, 1, division.clubIds.length);
}

/**
 * Advance one day. `watchOwn` leaves the managed club's fixture unplayed and returns it, so
 * the caller can run the full engine and hand the result back through `applyResult`.
 */
export function advanceDay(world: World, opts: { watchOwn?: boolean } = {}): DayReport {
  const day = world.day;
  const rng = streamOf(world.seed + world.season * 104729 + day, 'day');
  const report: DayReport = { day, played: [], ownFixture: null, seasonEnded: false };

  const todays = world.fixtures.filter((f) => f.day === day && !f.played);
  for (const fixture of todays) {
    const isOwn = fixture.homeId === world.managedClubId || fixture.awayId === world.managedClubId;
    if (isOwn && opts.watchOwn) {
      report.ownFixture = fixture;
      continue;
    }
    const result = playQuick(world, fixture, rng);
    applyResult(world, fixture, result);
    report.played.push(fixture);
  }

  // Everyone who did not play today rests.
  const playedToday = new Set<number>();
  for (const f of report.played) {
    for (const id of [f.homeId, f.awayId]) {
      const club = world.clubs[id];
      if (club) for (const pid of club.playerIds) playedToday.add(pid);
    }
  }
  for (const p of world.players) {
    if (p.injuryDays > 0) {
      p.injuryDays--;
      if (p.injuryDays === 0) p.condition = Math.min(p.condition, 0.7);
      continue;
    }
    if (!playedToday.has(p.id)) recoverCondition(p, recoveryDays(world, p));
  }

  world.day++;
  if (world.day > lastMatchDay(world) && world.fixtures.every((f) => f.played || f.day < world.day)) {
    // Play out anything that was skipped, so a season can never end mid-table with
    // fixtures outstanding.
    for (const f of world.fixtures) {
      if (f.played) continue;
      applyResult(world, f, playQuick(world, f, rng));
    }
    report.seasonEnded = true;
  }
  return report;
}

/** Run one fixture through the quick engine. */
export function playQuick(world: World, fixture: Fixture, rng: Rng): MatchResult {
  const home = world.clubs[fixture.homeId];
  const away = world.clubs[fixture.awayId];
  if (!home || !away) throw new Error(`fixture references a club that does not exist`);
  const setupHome = buildTeamSetup(world, home, 'home');
  const setupAway = buildTeamSetup(world, away, 'away');
  ensureKitContrast(setupHome, setupAway);
  // The same weather the player would have watched, so a simulated round and a watched
  // one are the same match played two ways rather than two different matches.
  return quickMatch(setupHome, setupAway, rng, conditionsFor(world.seed, world.season, fixture.round));
}

/** Build a full-engine match for a fixture — the one the player watches. */
export function openMatch(world: World, fixture: Fixture): MatchEngine {
  const home = world.clubs[fixture.homeId];
  const away = world.clubs[fixture.awayId];
  if (!home || !away) throw new Error('fixture references a club that does not exist');
  const setupHome = buildTeamSetup(world, home, 'home');
  const setupAway = buildTeamSetup(world, away, 'away');
  ensureKitContrast(setupHome, setupAway);
  const seed = world.seed ^ (world.season * 7919) ^ (fixture.round * 104729) ^ (fixture.homeId * 31);
  return new MatchEngine(
    setupHome, setupAway, seed,
    conditionsFor(world.seed, world.season, fixture.round),
  );
}

/**
 * Write a result back into the world: the score, everyone's stats, condition, morale,
 * cards, injuries and the money.
 */
export function applyResult(world: World, fixture: Fixture, result: MatchResult): void {
  fixture.played = true;
  fixture.homeGoals = result.homeGoals;
  fixture.awayGoals = result.awayGoals;

  const home = world.clubs[fixture.homeId];
  const away = world.clubs[fixture.awayId];
  if (!home || !away) return;
  const rng = streamOf(world.seed + fixture.round * 7919 + fixture.homeId, 'aftermath');

  for (const [club, isHome] of [[home, true], [away, false]] as const) {
    const conceded = isHome ? result.awayGoals : result.homeGoals;
    const scored = isHome ? result.homeGoals : result.awayGoals;
    const outcome = scored > conceded ? 1 : scored === conceded ? 0.5 : 0;
    const selection = pickEleven(world, club);
    const played = new Set(selection.eleven.map((p) => p.id));

    for (const p of squadOf(world, club.id)) {
      if (!played.has(p.id)) {
        updateMorale(p, false, outcome, rng);
        continue;
      }
      p.season.apps++;
      p.career.apps++;
      p.season.minutes += 90;
      if (conceded === 0 && (p.natural === 'GK' || p.familiarity[1])) p.season.cleanSheets++;
      const rating = result.ratings.get(p.id) ?? 6.5;
      p.season.ratingSum += rating;
      p.form.push(rating);
      if (p.form.length > 5) p.form.shift();
      tireFromMatch(p, 90);
      updateMorale(p, true, outcome, rng);

      // An injury is possible in any match, not only from a foul.
      const prone = attrUnit(p.attrs, 'injuryProneness');
      if (chance(rng, 0.011 * (0.5 + prone) * (1.4 - p.condition))) {
        p.injuryDays = int(rng, 4, 70);
      }
    }

    for (const s of result.scorers) {
      if ((s.side === 'home') !== isHome) continue;
      const p = world.players[s.playerId];
      if (!p) continue;
      p.season.goals++;
      p.career.goals++;
    }
    for (const c of result.cards) {
      if ((c.side === 'home') !== isHome) continue;
      const p = world.players[c.playerId];
      if (!p) continue;
      if (c.red) p.banMatches += int(rng, 1, 3);
      else {
        p.yellows++;
        if (p.yellows % YELLOW_BAN_THRESHOLD === 0) p.banMatches += 1;
      }
    }
    for (const p of squadOf(world, club.id)) {
      if (p.banMatches > 0 && played.has(p.id)) p.banMatches--;
    }
  }

  // Gate receipts and the wage bill. A club's balance is the one number a manager can
  // actually run out of.
  const attendance = Math.round(
    home.capacity * clamp(0.45 + home.reputation / 260 + (result.homeGoals > result.awayGoals ? 0.05 : 0), 0.3, 1),
  );
  home.balance += attendance * 24 + shopIncome(world, home, attendance);
  for (const club of [home, away]) {
    const wages = squadOf(world, club.id).reduce((t, p) => t + p.wage, 0);
    club.balance -= wages;
  }
}

/**
 * Roll the season over: honours, promotion and relegation, then everybody gets a year
 * older and the squads churn.
 */
export function endSeason(world: World): { champions: number[]; promoted: number[]; relegated: number[] } {
  const rng = streamOf(world.seed + world.season * 31337, 'roll');
  const champions: number[] = [];
  const promoted: number[] = [];
  const relegated: number[] = [];

  // Board confidence, settled against what was asked for.
  for (const club of world.clubs) {
    const pos = positionOf(world, club.id);
    const beat = club.expectation - pos;
    club.boardConfidence = clamp01(club.boardConfidence + beat * 0.06);
  }

  // Work out movement before anything changes tier.
  const moves: { clubId: number; toTier: number }[] = [];
  for (const division of world.divisions) {
    const table = buildTable(world, division.tier);
    const champion = table[0];
    if (champion) {
      champions.push(champion.clubId);
      const p = world.clubs[champion.clubId];
      if (p) for (const id of p.playerIds) {
        const pl = world.players[id];
        if (pl) pl.career.honours++;
      }
    }
    for (let i = 0; i < division.promoted && i < table.length; i++) {
      const row = table[i];
      if (row) {
        promoted.push(row.clubId);
        moves.push({ clubId: row.clubId, toTier: division.tier - 1 });
      }
    }
    for (let i = 0; i < division.relegated; i++) {
      const row = table[table.length - 1 - i];
      if (row) {
        relegated.push(row.clubId);
        moves.push({ clubId: row.clubId, toTier: division.tier + 1 });
      }
    }
  }
  for (const m of moves) {
    const club = world.clubs[m.clubId];
    if (!club) continue;
    const from = world.divisions[club.tier];
    const to = world.divisions[m.toTier];
    if (!from || !to) continue;
    from.clubIds = from.clubIds.filter((id) => id !== club.id);
    to.clubIds.push(club.id);
    club.tier = m.toTier;
  }

  rollSquads(world, rng);
  // The market runs after the squads have churned, so it is trading with the world as it
  // will actually be next season rather than as it was last season, and it is what fills
  // the holes the churn left.
  placeFreeAgents(world, rng);
  runTransferWindow(world, rng);
  topUpSquads(world, rng);
  // Last, because it renumbers every player: anything holding an id from before this call
  // is stale afterwards.
  pruneRetired(world);

  world.season++;
  startSeason(world);
  return { champions, promoted, relegated };
}

/**
 * Age, develop, expire contracts, retire, and bring through a youth intake.
 *
 * The ORDER here is what keeps a world alive over twenty seasons. Squads are deliberately
 * left short after the churn: the market fills them (transfers.ts), and only what the
 * market cannot fill is generated. Filling every gap with a sixteen-year-old instead —
 * which is what this did first — drops the average age of the world from 25 to 20 inside
 * a decade and the whole pyramid with it.
 */
function rollSquads(world: World, rng: Rng): void {
  const book = world.book.first.length > 0 ? world.book : buildNameBook();
  let nextId = world.players.length;

  for (const club of world.clubs) {
    const strength = clubStrength(world, club);
    const coaching = clamp01(0.3 + club.reputation / 260 + coachingBonus(world, club));
    const leaving: number[] = [];

    for (const p of squadOf(world, club.id)) {
      const minutesShare = clamp01(p.season.minutes / (38 * 90));
      p.age++;
      developPlayer(p, rng, coaching, minutesShare);
      p.contractYears--;

      if (retires(p, rng, strength)) {
        leaving.push(p.id);
        p.retired = true;
        continue;
      }
      if (p.contractYears <= 0) {
        // Clubs keep the players they want, and most contracts are renewed. A world where
        // a third of every squad walks out each summer has no continuity in it.
        const ca = caOf(p.attrs, p.natural);
        const useful = ca > strength - 30;
        // Age is part of the decision, and not only for realism: retention that ignores it
        // lets a whole squad age together and then retire together, and the world's mean
        // age oscillates between 24 and 31 on a ten-year cycle (career/track.ts).
        const keep = useful && chance(rng, clamp01(0.52 + p.morale * 0.2 + (28 - p.age) * 0.045));
        if (keep) {
          p.contractYears = int(rng, 2, 5);
          p.wage = Math.round(p.wage * range(rng, 1.0, 1.25));
        } else {
          leaving.push(p.id);
        }
      }
    }

    club.playerIds = club.playerIds.filter((id) => !leaving.includes(id));
    for (const id of leaving) {
      const p = world.players[id];
      if (p) p.clubId = -1;
    }

    // The academy: two or three every year, which is what a youth intake actually is. Not
    // "however many bodies the squad is short of".
    const intake = int(rng, 2, 3);
    for (let i = 0; i < intake; i++) {
      const youth = youthPotential(rng, club.reputation);
      const role = neededRole(world, club, YOUTH_ROLES);
      const p = createPlayer(rng, book, nextId++, club.id, role, youth.ca, club.culture);
      p.age = youth.age;
      p.pa = youth.pa;
      p.contractYears = int(rng, 3, 5);
      world.players.push(p);
      club.playerIds.push(p.id);
    }
    assignSquadNumbers(world, club);
  }
}

/** After the market has run, make sure nobody is short of a fieldable squad. */
function topUpSquads(world: World, rng: Rng): void {
  const book = world.book;
  let nextId = world.players.length;
  for (const club of world.clubs) {
    while (club.playerIds.length < MIN_SQUAD) {
      const youth = youthPotential(rng, club.reputation);
      const role = neededRole(world, club, YOUTH_ROLES);
      const p = createPlayer(rng, book, nextId++, club.id, role, youth.ca + 12, club.culture);
      p.age = int(rng, 18, 24);
      p.pa = Math.max(p.pa, youth.pa);
      p.contractYears = int(rng, 2, 4);
      world.players.push(p);
      club.playerIds.push(p.id);
    }
    // And nobody carries a squad so big the wage bill is meaningless.
    while (club.playerIds.length > MAX_SQUAD) {
      const squad = squadOf(world, club.id).sort(
        (a, b) => caOf(a.attrs, a.natural) - caOf(b.attrs, b.natural),
      );
      const out = squad[0];
      if (!out) break;
      club.playerIds = club.playerIds.filter((id) => id !== out.id);
      out.clubId = -1;
    }
    assignSquadNumbers(world, club);
  }
}

/** Which position this squad is shortest of. */
function neededRole(
  world: World,
  club: Club,
  roles: readonly ('GK' | 'DC' | 'DL' | 'DR' | 'DM' | 'MC' | 'ML' | 'MR' | 'AMC' | 'AML' | 'AMR' | 'ST')[],
): (typeof roles)[number] {
  const counts = new Map<string, number>();
  for (const p of squadOf(world, club.id)) {
    counts.set(p.natural, (counts.get(p.natural) ?? 0) + 1);
  }
  const want: Record<string, number> = {
    GK: 3, DC: 4, DL: 2, DR: 2, DM: 2, MC: 3, ML: 1, MR: 1, AMC: 2, AML: 1, AMR: 1, ST: 4,
  };
  let worst = roles[0] as (typeof roles)[number];
  let gap = -Infinity;
  for (const r of roles) {
    const have = counts.get(r) ?? 0;
    const d = (want[r] ?? 1) - have;
    if (d > gap) {
      gap = d;
      worst = r;
    }
  }
  return worst;
}

/** Everyone a club could pick this weekend. */
export function availableSquad(world: World, clubId: number): WorldPlayer[] {
  return squadOf(world, clubId).filter(isAvailable);
}

export { shuffle };
