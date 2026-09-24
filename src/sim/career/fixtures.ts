// The fixture list and the table.
//
// A round-robin by the circle method: fix one club and rotate the rest, which produces a
// schedule where every club plays every other exactly once per half-season and nobody
// plays twice on the same day. Doing it by shuffling and hoping produces a list that looks
// fine until round thirty, when two clubs have four fixtures left against each other.

import { shuffle, type Rng } from '../../core/rng.js';
import type { Fixture, TableRow, World } from '../world/types.js';

/** Day the league season starts, and how many days between rounds. */
export const FIRST_MATCH_DAY = 24;
export const DAYS_PER_ROUND = 7;

/**
 * Every fixture for one division's season: a double round-robin, home and away.
 *
 * With an even number of clubs the circle method gives (n-1) rounds per half. The home and
 * away assignment alternates per round so no club has a long run of either.
 */
export function buildDivisionFixtures(clubIds: number[], tier: number, rng: Rng): Fixture[] {
  const ids = shuffle(rng, [...clubIds]);
  if (ids.length % 2 !== 0) ids.push(-1); // a bye, if a division ever has odd numbers
  const n = ids.length;
  const half = n / 2;
  const rounds: [number, number][][] = [];

  // Circle method: ids[0] is fixed and the rest rotate around it.
  const rotating = ids.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const pairs: [number, number][] = [];
    const first = ids[0] as number;
    const opposite = rotating[r % rotating.length] as number;
    pairs.push(r % 2 === 0 ? [first, opposite] : [opposite, first]);
    for (let i = 1; i < half; i++) {
      const a = rotating[(r + i) % rotating.length] as number;
      const b = rotating[(r + rotating.length - i) % rotating.length] as number;
      pairs.push(i % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
  }

  const out: Fixture[] = [];
  // First half as drawn, second half with the ends swapped.
  for (let leg = 0; leg < 2; leg++) {
    rounds.forEach((pairs, r) => {
      const round = leg * (n - 1) + r;
      for (const [h, a] of pairs) {
        if (h < 0 || a < 0) continue;
        out.push({
          day: FIRST_MATCH_DAY + round * DAYS_PER_ROUND,
          round,
          homeId: leg === 0 ? h : a,
          awayId: leg === 0 ? a : h,
          tier,
          played: false,
          homeGoals: 0,
          awayGoals: 0,
        });
      }
    });
  }
  return out;
}

/** Build the whole season's fixture list, every division at once. */
export function buildSeasonFixtures(world: World, rng: Rng): Fixture[] {
  const out: Fixture[] = [];
  for (const division of world.divisions) {
    out.push(...buildDivisionFixtures(division.clubIds, division.tier, rng));
  }
  out.sort((a, b) => a.day - b.day || a.tier - b.tier);
  return out;
}

export function emptyRow(clubId: number): TableRow {
  return { clubId, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 };
}

/**
 * The table for one division, from the fixtures played so far.
 *
 * Derived, never stored (design §C and the note at the top of world/types.ts): a stored
 * table is a second answer to a question the fixture list already answers, and the two
 * disagree the first time a result is corrected.
 */
export function buildTable(world: World, tier: number): TableRow[] {
  const division = world.divisions[tier];
  if (!division) return [];
  const rows = new Map<number, TableRow>();
  for (const id of division.clubIds) rows.set(id, emptyRow(id));

  for (const f of world.fixtures) {
    if (!f.played || f.tier !== tier) continue;
    const home = rows.get(f.homeId);
    const away = rows.get(f.awayId);
    if (!home || !away) continue;
    home.played++;
    away.played++;
    home.goalsFor += f.homeGoals;
    home.goalsAgainst += f.awayGoals;
    away.goalsFor += f.awayGoals;
    away.goalsAgainst += f.homeGoals;
    if (f.homeGoals > f.awayGoals) {
      home.won++;
      away.lost++;
      home.points += 3;
    } else if (f.homeGoals < f.awayGoals) {
      away.won++;
      home.lost++;
      away.points += 3;
    } else {
      home.drawn++;
      away.drawn++;
      home.points++;
      away.points++;
    }
  }

  return sortTable([...rows.values()], world);
}

/** Points, then goal difference, then goals scored, then name — the usual order. */
export function sortTable(rows: TableRow[], world: World): TableRow[] {
  return rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const gdA = a.goalsFor - a.goalsAgainst;
    const gdB = b.goalsFor - b.goalsAgainst;
    if (gdB !== gdA) return gdB - gdA;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
    const na = world.clubs[a.clubId]?.name ?? '';
    const nb = world.clubs[b.clubId]?.name ?? '';
    return na.localeCompare(nb);
  });
}

/** Where a club currently sits in its division, 1-based. */
export function positionOf(world: World, clubId: number): number {
  const club = world.clubs[clubId];
  if (!club) return 0;
  const table = buildTable(world, club.tier);
  return table.findIndex((r) => r.clubId === clubId) + 1;
}

/** Fixtures on a given day, optionally for one division. */
export function fixturesOnDay(world: World, day: number, tier?: number): Fixture[] {
  return world.fixtures.filter((f) => f.day === day && (tier === undefined || f.tier === tier));
}

/** The next fixture for a club, or null if the season is over. */
export function nextFixture(world: World, clubId: number): Fixture | null {
  for (const f of world.fixtures) {
    if (f.played) continue;
    if (f.homeId === clubId || f.awayId === clubId) return f;
  }
  return null;
}

/** The last round number in the fixture list — how long a season runs. */
export function lastMatchDay(world: World): number {
  let last = FIRST_MATCH_DAY;
  for (const f of world.fixtures) if (f.day > last) last = f.day;
  return last;
}
