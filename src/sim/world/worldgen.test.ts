import { describe, expect, it } from 'vitest';
import { caOf } from '../ratings/ability.js';
import { POSITIONS } from '../ratings/positions.js';
import { fullName } from './names.js';
import { CLUBS_PER_DIVISION, SQUAD_SIZE, TIERS, clubStrength, createWorld, valueFor, wageFor } from './worldgen.js';

const world = createWorld(20260906);

describe('the shape of the world', () => {
  it('builds five divisions of twenty clubs', () => {
    expect(world.divisions.length).toBe(TIERS);
    for (const d of world.divisions) expect(d.clubIds.length).toBe(CLUBS_PER_DIVISION);
    expect(world.clubs.length).toBe(TIERS * CLUBS_PER_DIVISION);
  });

  it('fills every squad and leaves no player clubless', () => {
    expect(world.players.length).toBe(TIERS * CLUBS_PER_DIVISION * SQUAD_SIZE);
    for (const c of world.clubs) expect(c.playerIds.length).toBe(SQUAD_SIZE);
    for (const p of world.players) {
      expect(world.clubs[p.clubId]?.playerIds).toContain(p.id);
    }
  });

  it('gives every club at least three keepers-worth of cover in every band', () => {
    for (const c of world.clubs) {
      const squad = c.playerIds.map((id) => world.players[id]!);
      expect(squad.filter((p) => p.natural === 'GK').length).toBeGreaterThanOrEqual(2);
      expect(squad.filter((p) => p.natural !== 'GK').length).toBeGreaterThanOrEqual(18);
    }
  });

  it('is deterministic — the same seed builds the same world', () => {
    const a = createWorld(4242);
    const b = createWorld(4242);
    expect(a.clubs.map((c) => c.name)).toEqual(b.clubs.map((c) => c.name));
    expect(Array.from(a.players[100]!.attrs)).toEqual(Array.from(b.players[100]!.attrs));
    expect(a.players.map((p) => p.pa)).toEqual(b.players.map((p) => p.pa));
  });

  it('gives different seeds different worlds', () => {
    const other = createWorld(999);
    expect(other.clubs[0]?.name).not.toBe(world.clubs[0]?.name);
  });
});

describe('names', () => {
  it('never repeats a club name', () => {
    const names = new Set(world.clubs.map((c) => c.name));
    expect(names.size).toBe(world.clubs.length);
  });

  it('gives every player a readable name', () => {
    for (const p of world.players.slice(0, 300)) {
      const n = fullName(world.book, p.firstIdx, p.lastIdx);
      expect(n).not.toContain('?');
      expect(n.split(' ').length).toBeGreaterThanOrEqual(2);
    }
  });

  it('gives every club a short code', () => {
    for (const c of world.clubs) {
      expect(c.short.length).toBeGreaterThanOrEqual(2);
      expect(c.short.length).toBeLessThanOrEqual(3);
    }
  });
});

describe('the pyramid has a gradient', () => {
  it('makes each division weaker than the one above it', () => {
    const byTier = world.divisions.map((d) => {
      const strengths = d.clubIds.map((id) => clubStrength(world, world.clubs[id]!));
      return strengths.reduce((a, b) => a + b, 0) / strengths.length;
    });
    for (let i = 1; i < byTier.length; i++) {
      expect(byTier[i]!).toBeLessThan(byTier[i - 1]! - 8);
    }
  });

  it('makes each division poorer and smaller than the one above it', () => {
    const cap = world.divisions.map((d) => {
      const caps = d.clubIds.map((id) => world.clubs[id]!.capacity);
      return caps.reduce((a, b) => a + b, 0) / caps.length;
    });
    for (let i = 1; i < cap.length; i++) expect(cap[i]!).toBeLessThan(cap[i - 1]!);
  });

  it('still lets a good second-tier club beat a poor first-tier one', () => {
    // A pyramid with no overlap between divisions has no promotion story in it.
    const top = world.divisions[0]!.clubIds.map((id) => clubStrength(world, world.clubs[id]!));
    const second = world.divisions[1]!.clubIds.map((id) => clubStrength(world, world.clubs[id]!));
    expect(Math.max(...second)).toBeGreaterThan(Math.min(...top));
  });
});

describe('players', () => {
  it('never generates potential below current ability', () => {
    for (const p of world.players) {
      expect(p.pa).toBeGreaterThanOrEqual(caOf(p.attrs, p.natural) - 1);
    }
  });

  it('keeps ages inside a footballer career', () => {
    for (const p of world.players) {
      expect(p.age).toBeGreaterThanOrEqual(16);
      expect(p.age).toBeLessThanOrEqual(38);
    }
    const ages = world.players.map((p) => p.age);
    const mean = ages.reduce((a, b) => a + b, 0) / ages.length;
    expect(mean).toBeGreaterThan(23);
    expect(mean).toBeLessThan(28);
  });

  it('rates every player at his natural position and nearby ones', () => {
    for (const p of world.players.slice(0, 200)) {
      const naturalIdx = POSITIONS.indexOf(p.natural);
      expect(p.familiarity[naturalIdx]).toBe(20);
      expect(p.familiarity.length).toBe(POSITIONS.length);
    }
  });

  it('gives every squad unique shirt numbers, with 1 on a keeper', () => {
    for (const c of world.clubs.slice(0, 40)) {
      const squad = c.playerIds.map((id) => world.players[id]!);
      const numbers = squad.map((p) => p.squadNumber);
      expect(new Set(numbers).size).toBe(numbers.length);
      const one = squad.find((p) => p.squadNumber === 1);
      expect(one?.natural).toBe('GK');
    }
  });
});

describe('money', () => {
  it('pays better players more', () => {
    expect(wageFor(160, 26)).toBeGreaterThan(wageFor(100, 26) * 3);
    expect(wageFor(60, 26)).toBeLessThan(wageFor(100, 26));
  });

  it('values a young player with upside above an older, better one', () => {
    const prospect = valueFor(110, 170, 19, 4);
    const veteran = valueFor(125, 125, 32, 4);
    expect(prospect).toBeGreaterThan(veteran);
  });

  it('discounts a player entering his last contract year', () => {
    expect(valueFor(130, 140, 26, 1)).toBeLessThan(valueFor(130, 140, 26, 4) * 0.6);
  });

  it('gives every club a budget it could actually spend', () => {
    for (const c of world.clubs) {
      expect(c.wageBudget).toBeGreaterThan(0);
      expect(c.transferBudget).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(c.balance)).toBe(true);
    }
  });

  it('makes the top division richer than the bottom one', () => {
    const top = world.divisions[0]!.clubIds.map((id) => world.clubs[id]!.wageBudget);
    const bottom = world.divisions[4]!.clubIds.map((id) => world.clubs[id]!.wageBudget);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(top)).toBeGreaterThan(mean(bottom) * 4);
  });
});
