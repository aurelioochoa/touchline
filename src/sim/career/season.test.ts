import { describe, expect, it } from 'vitest';
import { caOf } from '../ratings/ability.js';
import { createWorld, CLUBS_PER_DIVISION, SQUAD_SIZE, TIERS, clubStrength } from '../world/worldgen.js';
import { squadOf, type World } from '../world/types.js';
import { buildTable, positionOf } from './fixtures.js';
import { advanceDay, endSeason, startSeason } from './season.js';
import { pickEleven } from './squad.js';

/** Play a whole season, day by day, exactly as the game does. */
function playSeason(world: World): void {
  let guard = 0;
  for (;;) {
    const report = advanceDay(world);
    if (report.seasonEnded) return;
    if (guard++ > 400) throw new Error('season never ended');
  }
}

describe('fixtures', () => {
  const world = createWorld(31337);
  startSeason(world);

  it('gives every club 38 matches, 19 at home', () => {
    for (const club of world.clubs) {
      const own = world.fixtures.filter((f) => f.homeId === club.id || f.awayId === club.id);
      expect(own.length).toBe((CLUBS_PER_DIVISION - 1) * 2);
      expect(own.filter((f) => f.homeId === club.id).length).toBe(CLUBS_PER_DIVISION - 1);
    }
  });

  it('pairs every club with every other exactly twice, once each way', () => {
    const division = world.divisions[0]!;
    for (const a of division.clubIds) {
      for (const b of division.clubIds) {
        if (a === b) continue;
        const meetings = world.fixtures.filter(
          (f) => (f.homeId === a && f.awayId === b) || (f.homeId === b && f.awayId === a),
        );
        expect(meetings.length).toBe(2);
        expect(meetings.filter((f) => f.homeId === a).length).toBe(1);
      }
    }
  });

  it('never asks a club to play twice on the same day', () => {
    const seen = new Map<string, number>();
    for (const f of world.fixtures) {
      for (const id of [f.homeId, f.awayId]) {
        const key = `${f.day}:${id}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
    for (const [, n] of seen) expect(n).toBe(1);
  });

  it('never pits a club against a club from another division', () => {
    for (const f of world.fixtures) {
      expect(world.clubs[f.homeId]?.tier).toBe(f.tier);
      expect(world.clubs[f.awayId]?.tier).toBe(f.tier);
    }
  });
});

describe('a season', () => {
  const world = createWorld(4242);
  startSeason(world);
  playSeason(world);

  it('plays every fixture', () => {
    expect(world.fixtures.every((f) => f.played)).toBe(true);
  });

  it('produces a table that adds up', () => {
    for (let tier = 0; tier < TIERS; tier++) {
      const table = buildTable(world, tier);
      expect(table.length).toBe(CLUBS_PER_DIVISION);
      let goalsFor = 0;
      let goalsAgainst = 0;
      for (const row of table) {
        expect(row.played).toBe((CLUBS_PER_DIVISION - 1) * 2);
        expect(row.won + row.drawn + row.lost).toBe(row.played);
        expect(row.points).toBe(row.won * 3 + row.drawn);
        goalsFor += row.goalsFor;
        goalsAgainst += row.goalsAgainst;
      }
      // Every goal scored is a goal conceded.
      expect(goalsFor).toBe(goalsAgainst);
    }
  });

  it('is won by a good side, not a random one', () => {
    // Correlation between squad strength and league position, over all five divisions.
    let agree = 0;
    let total = 0;
    for (let tier = 0; tier < TIERS; tier++) {
      const table = buildTable(world, tier);
      const byStrength = [...table].sort(
        (a, b) => clubStrength(world, world.clubs[b.clubId]!) - clubStrength(world, world.clubs[a.clubId]!),
      );
      for (let i = 0; i < table.length; i++) {
        const actual = i;
        const expected = byStrength.findIndex((r) => r.clubId === table[i]!.clubId);
        if (Math.abs(actual - expected) <= 6) agree++;
        total++;
      }
    }
    expect(agree / total).toBeGreaterThan(0.6);
  });

  it('spreads points the way a league does', () => {
    const table = buildTable(world, 0);
    const top = table[0]!.points;
    const bottom = table[table.length - 1]!.points;
    expect(top).toBeGreaterThan(bottom + 20);
    expect(top).toBeLessThan(114); // nobody wins every match
    expect(bottom).toBeGreaterThan(0);
  });

  it('tires players out and gets some of them injured', () => {
    const played = world.players.filter((p) => p.season.apps > 0);
    expect(played.length).toBeGreaterThan(world.players.length * 0.3);
    const tired = world.players.filter((p) => p.condition < 0.95);
    expect(tired.length).toBeGreaterThan(0);
    const scorers = world.players.filter((p) => p.season.goals > 0);
    expect(scorers.length).toBeGreaterThan(100);
  });

  it('produces a believable top scorer', () => {
    const best = [...world.players].sort((a, b) => b.season.goals - a.season.goals)[0]!;
    expect(best.season.goals).toBeGreaterThan(9);
    expect(best.season.goals).toBeLessThan(60);
  });
});

describe('the squad picker', () => {
  const world = createWorld(77);
  startSeason(world);

  it('fields eleven players in the right shape', () => {
    for (const club of world.clubs.slice(0, 30)) {
      const { eleven, bench } = pickEleven(world, club);
      expect(eleven.length).toBe(11);
      expect(bench.length).toBe(7);
      expect(new Set(eleven.map((p) => p.id)).size).toBe(11);
      for (const b of bench) expect(eleven).not.toContain(b);
    }
  });

  it('always picks a goalkeeper, and puts a keeper on the bench', () => {
    for (const club of world.clubs.slice(0, 30)) {
      const { eleven, bench } = pickEleven(world, club);
      expect(eleven[0]?.natural).toBe('GK');
      expect(bench.some((p) => p.natural === 'GK')).toBe(true);
    }
  });

  it('picks better players over worse ones', () => {
    const club = world.clubs[0]!;
    const { eleven } = pickEleven(world, club);
    const chosenAvg = eleven.reduce((t, p) => t + caOf(p.attrs, p.natural), 0) / 11;
    const squad = squadOf(world, club.id);
    const squadAvg = squad.reduce((t, p) => t + caOf(p.attrs, p.natural), 0) / squad.length;
    expect(chosenAvg).toBeGreaterThan(squadAvg);
  });
});

describe('twenty seasons', () => {
  const world = createWorld(2026);
  startSeason(world);
  const championTiers: number[] = [];
  for (let s = 0; s < 20; s++) {
    playSeason(world);
    const { champions } = endSeason(world);
    championTiers.push(champions.length);
  }

  it('crowns a champion in every division, every season', () => {
    for (const n of championTiers) expect(n).toBe(TIERS);
  });

  it('keeps every division at twenty clubs', () => {
    for (const d of world.divisions) expect(d.clubIds.length).toBe(CLUBS_PER_DIVISION);
  });

  it('keeps the transfer market moving players between clubs', () => {
    const fresh = createWorld(2026);
    const stayed = world.players.filter(
      (p) => p.clubId >= 0 && fresh.players[p.id] && fresh.players[p.id]!.clubId === p.clubId,
    );
    // Some continuity, but not a world where nobody ever moves.
    expect(stayed.length).toBeLessThan(world.players.length * 0.5);
  });

  it('keeps every squad fieldable and every player at exactly one club', () => {
    // Squads float rather than being pinned at the starting size — the market fills them,
    // not a generator (see rollSquads).
    for (const club of world.clubs) {
      expect(club.playerIds.length).toBeGreaterThanOrEqual(18);
      expect(club.playerIds.length).toBeLessThanOrEqual(32);
    }
    const seen = new Set<number>();
    for (const club of world.clubs) {
      for (const id of club.playerIds) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
        expect(world.players[id]?.clubId).toBe(club.id);
      }
    }
  });

  it('does not let the world degenerate — the pyramid still has a gradient', () => {
    const byTier = world.divisions.map((d) => {
      const s = d.clubIds.map((id) => clubStrength(world, world.clubs[id]!));
      return s.reduce((a, b) => a + b, 0) / s.length;
    });
    for (let i = 1; i < byTier.length; i++) {
      expect(byTier[i]!).toBeLessThan(byTier[i - 1]!);
    }
    // And it has not drifted away from where it started. A league's standard does move
    // over twenty years; what must not happen is the collapse an earlier version had, when
    // the top flight fell from 153 to 89 because youth intakes replaced retirees wholesale
    // (see career/track.ts, which is the harness that found it).
    expect(byTier[0]!).toBeGreaterThan(110);
    expect(byTier[0]!).toBeLessThan(195);
    expect(byTier[TIERS - 1]!).toBeGreaterThan(50);
    // The pyramid must not flatten either: the gap top to bottom stays a real gap.
    expect(byTier[0]! - byTier[TIERS - 1]!).toBeGreaterThan(35);
  });

  it('keeps ages realistic after twenty rounds of churn', () => {
    const ages = world.players.filter((p) => p.clubId >= 0).map((p) => p.age);
    const mean = ages.reduce((a, b) => a + b, 0) / ages.length;
    expect(mean).toBeGreaterThan(21);
    expect(mean).toBeLessThan(33);
    expect(Math.max(...ages)).toBeLessThan(45);
  });

  it('moves clubs between divisions', () => {
    const fresh = createWorld(2026);
    const moved = world.clubs.filter((c) => c.tier !== fresh.clubs[c.id]?.tier);
    expect(moved.length).toBeGreaterThan(10);
  });

  it('still has somebody at the top of every table', () => {
    for (let tier = 0; tier < TIERS; tier++) {
      expect(positionOf(world, buildTable(world, tier)[0]!.clubId)).toBe(1);
    }
  });
});
