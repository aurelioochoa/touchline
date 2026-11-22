import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../core/rng.js';
import { caOf } from '../ratings/ability.js';
import { advanceDay, endSeason, startSeason } from '../career/season.js';
import { pickEleven } from '../career/squad.js';
import { createWorld, clubStrength, startingClubs } from '../world/worldgen.js';
import type { World } from '../world/types.js';
import { defaultSettings } from '../../save/format.js';
import { loadGame, restoreWorld, saveGame, saveSizeBytes, setStore } from '../../save/api.js';
import { memoryStorage } from '../../save/storage.js';
import { migrate } from '../../save/migrations.js';
import { HALF_WIDTH } from '../match/pitch.js';
import {
  SLOTS_PER_WEEK, closeHeroSeason, createHero, doActivity, heroPlayer, moveHero, recordHeroMatch, startsFor,
} from './hero.js';
import { heroOffers } from './offers.js';
import { legacyClubs, retireIntoManagement } from './legacy.js';
import { DRILL_TURNS, gapRow, sessionStars, shotOutcome, trialPosition, COACH_RUN_STARS } from './drills.js';

function signed(seed: number, tier = 4): World {
  const world = createWorld(seed);
  startSeason(world);
  const clubs = startingClubs(world, tier);
  createHero(world, { clubId: clubs[clubs.length - 1]!.id, position: 'ST', number: 23, boots: 2 });
  return world;
}

function playSeason(world: World): void {
  for (let guard = 0; guard < 400; guard++) if (advanceDay(world).seasonEnded) return;
  throw new Error('season never ended');
}

describe('signing', () => {
  const world = signed(515);
  const player = heroPlayer(world)!;

  it('is a sixteen-year-old with a top-flight ceiling, in the shirt the kid chose', () => {
    expect(player.age).toBe(16);
    expect(player.pa).toBeGreaterThanOrEqual(160);
    expect(player.pa).toBeLessThanOrEqual(190);
    expect(player.squadNumber).toBe(23);
    expect(world.managedClubId).toBe(-1);
    expect(world.clubs[player.clubId]!.playerIds).toContain(player.id);
  });

  it('spends three week slots and no more', () => {
    for (let index = 0; index < 5; index++) doActivity(world, 'kickabout');
    expect(world.hero!.week.length).toBe(SLOTS_PER_WEEK);
  });

  it('never drills him past his potential', () => {
    const copy = signed(516);
    const hero = heroPlayer(copy)!;
    hero.pa = caOf(hero.attrs, hero.natural);
    for (let index = 0; index < 40; index++) {
      copy.hero!.week = [];
      doActivity(copy, 'drill', { kind: 'hoops', stars: 3 });
    }
    expect(caOf(hero.attrs, hero.natural)).toBeLessThanOrEqual(hero.pa);
  });

  it('counts a substitute appearance and moves the rings only on events', () => {
    const copy = signed(517);
    const hero = copy.hero!;
    const before = { ...hero };
    const change = recordHeroMatch(copy, { started: false, minutes: 22, rating: 7.8, goals: 1, assists: 0, passesChosen: 2, passesArrived: 1 });
    expect(heroPlayer(copy)!.season.apps).toBe(1);
    expect(change.fans).toBeGreaterThan(0);
    expect(change.coach).toBeGreaterThan(0);
    expect(hero.benchStreak).toBe(before.benchStreak + 1);
  });
});

describe('never left out', () => {
  const world = signed(808);
  const top = startingClubs(world, 0)[0]!;
  moveHero(world, top.id, false);

  it('a fit hero at a club far above him is still in the matchday squad', () => {
    const selection = pickEleven(world, top);
    const ids = [...selection.eleven, ...selection.bench].map((player) => player.id);
    expect(startsFor(world, top)).toBe(false);
    expect(ids).toContain(world.hero!.playerId);
  });

  it('a benched hero is always offered a club where he would start', () => {
    const offers = heroOffers(world);
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.some((offer) => offer.starts)).toBe(true);
    expect(offers.every((offer) => offer.loan)).toBe(true);
  });
});

describe('twenty seasons with the hero on autopilot', () => {
  const world = signed(2027);
  const firstIdx = heroPlayer(world)!.firstIdx;
  const checks: string[] = [];
  for (let season = 0; season < 20; season++) {
    playSeason(world);
    closeHeroSeason(world);
    endSeason(world);
    const hero = world.hero!;
    const player = heroPlayer(world)!;
    if (player.firstIdx !== firstIdx) checks.push(`season ${season}: the hero id points at somebody else`);
    if (player.age !== 17 + season) checks.push(`season ${season}: age ${player.age}`);
    if (player.clubId < 0 || player.retired) checks.push(`season ${season}: left the game`);
    if (player.squadNumber !== hero.number) checks.push(`season ${season}: shirt ${player.squadNumber}`);
    if (caOf(player.attrs, player.natural) > player.pa + 1) checks.push(`season ${season}: above potential`);
    // What a kid does with the summer's crest cards: take one that would start him.
    hero.offers = heroOffers(world);
    const start = hero.offers.find((offer) => offer.starts && !offer.loan);
    if (!startsFor(world, world.clubs[player.clubId]!) && start) moveHero(world, start.clubId, false);
  }

  it('keeps the same hero, a year older each season, in his own shirt, through every prune', () => {
    expect(checks).toEqual([]);
    expect(world.hero!.history.season.length).toBe(20);
  });

  it('leaves the pyramid with its gradient', () => {
    const strength = (tier: number) => startingClubs(world, tier).reduce((sum, club) => sum + clubStrength(world, club), 0);
    expect(strength(0)).toBeGreaterThan(strength(4));
  });

  it('fits the twenty-season player save in the same budget as a club one', () => {
    setStore(memoryStorage());
    saveGame(world, defaultSettings());
    expect(saveSizeBytes()).toBeLessThan(1_400_000);
    const loaded = loadGame();
    if (loaded.kind !== 'ok') throw new Error('player save did not load');
    expect(loaded.data.mode).toBe('player');
    expect(loaded.data.summary.shirtNumber).toBe(world.hero!.number);
    expect(restoreWorld(loaded.data).hero).toEqual(world.hero);
  });

  it('retires into management at a club that would have him, in one write', () => {
    const clubs = legacyClubs(world);
    expect(clubs.length).toBeGreaterThan(0);
    const name = heroPlayer(world)!.lastIdx;
    retireIntoManagement(world, clubs[0]!);
    expect(world.hero).toBeUndefined();
    expect(world.managedClubId).toBe(clubs[0]);
    expect(world.legend!.lastIdx).toBe(name);
    saveGame(world, defaultSettings());
    const loaded = loadGame();
    if (loaded.kind !== 'ok') throw new Error('legacy save did not load');
    expect(loaded.data.mode).toBe('club');
    expect(restoreWorld(loaded.data).legend).toEqual(world.legend);
  });
});

describe('the save migration to version 5', () => {
  it('reads every older save as a Club career and changes nothing else', () => {
    const old = { version: 4, savedAt: 1, summary: { clubName: 'X' }, settings: { sound: false }, world: { seed: 3, managedClubId: 7 } };
    const result = migrate(structuredClone(old));
    if (!result.ok) throw new Error('migration failed');
    const { mode, version, ...rest } = result.data as unknown as Record<string, unknown>;
    expect(mode).toBe('club');
    expect(version).toBe(5);
    const { version: _old, ...unchanged } = old;
    expect(rest).toEqual(unchanged);
  });
});

describe('drills and the trial', () => {
  it('never score a played session below the coach running it', () => {
    for (const kind of ['hoops', 'rondo', 'gap'] as const) {
      for (let score = 0; score <= DRILL_TURNS[kind] * 2; score++) expect(sessionStars(kind, score)).toBeGreaterThanOrEqual(COACH_RUN_STARS);
      expect(sessionStars(kind, 99)).toBe(3);
    }
  });

  it('always leaves exactly one way through each row of the gap run', () => {
    for (let seed = 0; seed < 200; seed++) {
      const rng = mulberry32(seed);
      for (let row = 0; row < 3; row++) {
        const defenders = gapRow(rng, row);
        const open = [HALF_WIDTH - 3.4, HALF_WIDTH, HALF_WIDTH + 3.4]
          .filter((y) => defenders.every(([, defenderY]) => Math.abs(defenderY - y) > 2));
        expect(open.length).toBe(1);
      }
    }
  });

  it('rewards placing a shot away from the keeper', () => {
    const rng = mulberry32(9);
    let away = 0;
    let at = 0;
    for (let shot = 0; shot < 400; shot++) {
      if (shotOutcome(rng, HALF_WIDTH + 2.4, 0.45, 1, HALF_WIDTH - 1.5).goal) away++;
      if (shotOutcome(rng, HALF_WIDTH - 1.5, 0.45, 1, HALF_WIDTH - 1.5).goal) at++;
    }
    expect(away).toBeGreaterThan(at * 3);
  });

  it('reads the shirt position from what the kid did', () => {
    expect(trialPosition({ shoot: 3, pass: 1, dribble: 1 })).toBe('ST');
    expect(trialPosition({ shoot: 1, pass: 2, dribble: 0 })).toBe('MC');
    expect(trialPosition({ shoot: 1, pass: 0, dribble: 2 })).toBe('AML');
  });
});
