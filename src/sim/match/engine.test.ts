import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../core/rng.js';
import { MatchEngine } from './engine.js';
import { buildTeam, resetPlayerIds } from './quickTeam.js';
import type { MatchResult, TeamSetup } from './types.js';

function teams(seed: number, homeStrength = 110, awayStrength = 110): [TeamSetup, TeamSetup] {
  resetPlayerIds(1);
  const rng = mulberry32(seed);
  const home = buildTeam(rng, {
    side: 'home', clubId: 1, name: 'Home', shortName: 'HOM',
    strength: homeStrength, kitPrimary: 0xd42b2b, kitSecondary: 0xffffff,
  });
  const away = buildTeam(rng, {
    side: 'away', clubId: 2, name: 'Away', shortName: 'AWY',
    strength: awayStrength, kitPrimary: 0x2b4bd4, kitSecondary: 0xffffff,
  });
  return [home, away];
}

function playMatch(seed: number, hs = 110, as = 110): MatchResult {
  const [h, a] = teams(seed, hs, as);
  return new MatchEngine(h, a, seed).runToEnd();
}

describe('determinism', () => {
  it('produces an identical result from the same seed', () => {
    const a = playMatch(4242);
    const b = playMatch(4242);
    expect(a.homeGoals).toBe(b.homeGoals);
    expect(a.awayGoals).toBe(b.awayGoals);
    expect(a.homeShots).toBe(b.homeShots);
    expect(a.scorers).toEqual(b.scorers);
    expect(a.cards).toEqual(b.cards);
  });

  it('produces an identical tick-by-tick event log from the same seed', () => {
    const log = (seed: number) => {
      const [h, a] = teams(seed);
      const e = new MatchEngine(h, a, seed);
      const out: string[] = [];
      while (!e.state.finished && e.state.tick < 80_000) {
        for (const ev of e.step()) out.push(`${e.state.tick}:${ev.type}`);
      }
      return out;
    };
    expect(log(77)).toEqual(log(77));
  });

  it('different seeds give different matches', () => {
    const results = [11, 22, 33, 44, 55].map((s) => playMatch(s));
    const distinct = new Set(results.map((r) => `${r.homeGoals}-${r.awayGoals}-${r.homeShots}`));
    expect(distinct.size).toBeGreaterThan(1);
  });
});

describe('a match completes', () => {
  it('reaches full time with a full-length clock', () => {
    const [h, a] = teams(9);
    const e = new MatchEngine(h, a, 9);
    e.runToEnd();
    expect(e.state.finished).toBe(true);
    expect(e.state.period).toBe('over');
    // 90 minutes plus two lots of added time.
    expect(e.state.clock).toBeGreaterThan(90 * 60);
    expect(e.state.clock).toBeLessThan(102 * 60);
  });

  it('plays both halves and swaps ends', () => {
    const [h, a] = teams(13);
    const e = new MatchEngine(h, a, 13);
    let sawHalfTime = false;
    while (!e.state.finished && e.state.tick < 80_000) {
      for (const ev of e.step()) if (ev.type === 'halfTime') sawHalfTime = true;
    }
    expect(sawHalfTime).toBe(true);
  });

  it('keeps every player on the pitch and inside it', () => {
    const [h, a] = teams(31);
    const e = new MatchEngine(h, a, 31);
    while (!e.state.finished && e.state.tick < 80_000) {
      e.step();
      for (const t of [e.state.home, e.state.away]) {
        for (const p of t.players) {
          if (!p.onPitch) continue;
          expect(Number.isFinite(p.x)).toBe(true);
          expect(Number.isFinite(p.y)).toBe(true);
          expect(p.x).toBeGreaterThanOrEqual(-3);
          expect(p.x).toBeLessThanOrEqual(108);
          expect(p.y).toBeGreaterThanOrEqual(-3);
          expect(p.y).toBeLessThanOrEqual(71);
        }
      }
      const b = e.state.ball;
      expect(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.z)).toBe(true);
    }
  });

  it('never leaves eleven players standing still for a whole half', () => {
    const [h, a] = teams(57);
    const e = new MatchEngine(h, a, 57);
    while (!e.state.finished && e.state.tick < 80_000) e.step();
    for (const t of [e.state.home, e.state.away]) {
      for (const p of t.players) {
        // Every starter covers real ground over 90 minutes. A keeper covers least.
        const floor = p.role === 'GK' ? 200 : 3000;
        expect(p.stats.distanceM).toBeGreaterThan(floor);
      }
    }
  });
});

describe('football plausibility', () => {
  const sample = Array.from({ length: 14 }, (_, i) => playMatch(1000 + i * 37));

  // Ranges, not point values. These are the numbers the calibration harness
  // (calibrate.ts) is tuned against; the bounds are wide enough that ordinary variance
  // does not fail the build and tight enough that a real regression does. Run
  // `node scripts/run-ts.mjs src/sim/match/calibrate.ts 24` to see the full picture.
  it('scores a believable number of goals per game', () => {
    const total = sample.reduce((t, r) => t + r.homeGoals + r.awayGoals, 0) / sample.length;
    expect(total).toBeGreaterThan(1.3);
    expect(total).toBeLessThan(4.2);
  });

  it('converts about one shot in ten, as real football does', () => {
    const goals = sample.reduce((t, r) => t + r.homeGoals + r.awayGoals, 0);
    const shots = sample.reduce((t, r) => t + r.homeShots + r.awayShots, 0);
    expect(goals / shots).toBeGreaterThan(0.045);
    expect(goals / shots).toBeLessThan(0.17);
  });

  it('puts roughly a third of shots on target', () => {
    const onT = sample.reduce((t, r) => t + r.homeShotsOnTarget + r.awayShotsOnTarget, 0);
    const shots = sample.reduce((t, r) => t + r.homeShots + r.awayShots, 0);
    expect(onT / shots).toBeGreaterThan(0.18);
    expect(onT / shots).toBeLessThan(0.5);
  });

  it('does not produce absurd scorelines', () => {
    for (const r of sample) {
      expect(r.homeGoals).toBeLessThan(11);
      expect(r.awayGoals).toBeLessThan(11);
    }
  });

  it('takes a believable number of shots', () => {
    const shots = sample.reduce((t, r) => t + r.homeShots + r.awayShots, 0) / sample.length;
    expect(shots).toBeGreaterThan(14);
    expect(shots).toBeLessThan(42);
  });

  it('splits possession roughly evenly between evenly matched sides', () => {
    const avg = sample.reduce((t, r) => t + r.homePossession, 0) / sample.length;
    expect(avg).toBeGreaterThan(0.38);
    expect(avg).toBeLessThan(0.62);
  });

  it('gives every goal a scorer', () => {
    for (const r of sample) {
      expect(r.scorers.length).toBe(r.homeGoals + r.awayGoals);
      for (const s of r.scorers) expect(s.minute).toBeGreaterThan(0);
    }
  });
});

describe('the better team wins more often', () => {
  it('separates a strong side from a weak one over a run of matches', () => {
    let strongWins = 0;
    let weakWins = 0;
    let strongGoals = 0;
    let weakGoals = 0;
    for (let i = 0; i < 16; i++) {
      const r = playMatch(5000 + i * 91, 150, 70);
      strongGoals += r.homeGoals;
      weakGoals += r.awayGoals;
      if (r.homeGoals > r.awayGoals) strongWins++;
      else if (r.awayGoals > r.homeGoals) weakWins++;
    }
    expect(strongWins).toBeGreaterThan(weakWins * 2);
    expect(strongGoals).toBeGreaterThan(weakGoals);
  });
});

describe('substitutions', () => {
  it('brings a player on and takes one off', () => {
    const [h, a] = teams(64);
    const e = new MatchEngine(h, a, 64);
    for (let i = 0; i < 500; i++) e.step();
    const off = e.state.home.players.find((p) => p.role !== 'GK');
    const on = e.state.home.bench[0];
    expect(off && on).toBeTruthy();
    const ok = e.substitute('home', off!.id, on!.id);
    expect(ok).toBe(true);
    expect(off!.onPitch).toBe(false);
    expect(on!.onPitch).toBe(true);
    expect(e.state.home.players.filter((p) => p.onPitch).length).toBe(11);
  });

  it('refuses a substitution for a player who is not on the pitch', () => {
    const [h, a] = teams(65);
    const e = new MatchEngine(h, a, 65);
    expect(e.substitute('home', 99999, e.state.home.bench[0]!.id)).toBe(false);
  });
});
