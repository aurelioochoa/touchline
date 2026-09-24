import { describe, expect, it } from 'vitest';
import { mulberry32, streamOf } from '../../core/rng.js';
import { MatchEngine } from './engine.js';
import { quickMatch, rateTeam } from './quick.js';
import { buildTeam, resetPlayerIds } from './quickTeam.js';
import type { MatchResult, TeamSetup } from './types.js';

function pair(seed: number, hs: number, as: number): [TeamSetup, TeamSetup] {
  resetPlayerIds(1);
  const rng = mulberry32(seed);
  return [
    buildTeam(rng, { side: 'home', clubId: 1, name: 'Home', shortName: 'HOM', strength: hs, kitPrimary: 1, kitSecondary: 2 }),
    buildTeam(rng, { side: 'away', clubId: 2, name: 'Away', shortName: 'AWY', strength: as, kitPrimary: 3, kitSecondary: 4 }),
  ];
}

interface Agg {
  goalsFor: number;
  goalsAgainst: number;
  shots: number;
  homeWins: number;
  draws: number;
  awayWins: number;
  possession: number;
  n: number;
}

function aggregate(results: MatchResult[]): Agg {
  const a: Agg = { goalsFor: 0, goalsAgainst: 0, shots: 0, homeWins: 0, draws: 0, awayWins: 0, possession: 0, n: results.length };
  for (const r of results) {
    a.goalsFor += r.homeGoals;
    a.goalsAgainst += r.awayGoals;
    a.shots += r.homeShots + r.awayShots;
    a.possession += r.homePossession;
    if (r.homeGoals > r.awayGoals) a.homeWins++;
    else if (r.homeGoals < r.awayGoals) a.awayWins++;
    else a.draws++;
  }
  return a;
}

function quickSample(count: number, hs: number, as: number): Agg {
  const out: MatchResult[] = [];
  for (let i = 0; i < count; i++) {
    const [h, a] = pair(1000 + i * 13, hs, as);
    out.push(quickMatch(h, a, streamOf(1000 + i * 13, 'quick')));
  }
  return aggregate(out);
}

function fullSample(count: number, hs: number, as: number): Agg {
  const out: MatchResult[] = [];
  for (let i = 0; i < count; i++) {
    const seed = 1000 + i * 13;
    const [h, a] = pair(seed, hs, as);
    out.push(new MatchEngine(h, a, seed).runToEnd());
  }
  return aggregate(out);
}

describe('rateTeam', () => {
  it('rates a strong squad above a weak one in every phase', () => {
    const [strong] = pair(5, 160, 60);
    const [weak] = pair(5, 60, 60);
    const S = rateTeam(strong);
    const W = rateTeam(weak);
    expect(S.attack).toBeGreaterThan(W.attack);
    expect(S.midfield).toBeGreaterThan(W.midfield);
    expect(S.defence).toBeGreaterThan(W.defence);
    expect(S.keeper).toBeGreaterThan(W.keeper);
  });

  it('responds to instructions', () => {
    const [team] = pair(6, 110, 110);
    const balanced = rateTeam(team);
    team.instructions.attackingIntent = 1;
    team.instructions.lineHeight = 1;
    const gungHo = rateTeam(team);
    expect(gungHo.attack).toBeGreaterThan(balanced.attack);
    expect(gungHo.defence).toBeLessThan(balanced.defence);
  });
});

describe('quickMatch', () => {
  it('is deterministic for a given stream', () => {
    const [h1, a1] = pair(77, 110, 110);
    const r1 = quickMatch(h1, a1, streamOf(77, 'q'));
    const [h2, a2] = pair(77, 110, 110);
    const r2 = quickMatch(h2, a2, streamOf(77, 'q'));
    expect(r1.homeGoals).toBe(r2.homeGoals);
    expect(r1.awayGoals).toBe(r2.awayGoals);
    expect(r1.scorers).toEqual(r2.scorers);
  });

  it('gives every goal a scorer, and every scorer a plausible minute', () => {
    for (let i = 0; i < 200; i++) {
      const [h, a] = pair(2000 + i, 110, 105);
      const r = quickMatch(h, a, streamOf(2000 + i, 'q'));
      expect(r.scorers.length).toBe(r.homeGoals + r.awayGoals);
      for (const s of r.scorers) {
        expect(s.minute).toBeGreaterThan(0);
        expect(s.minute).toBeLessThan(96);
      }
      expect(r.homeShotsOnTarget).toBeGreaterThanOrEqual(r.homeGoals);
      expect(r.awayShotsOnTarget).toBeGreaterThanOrEqual(r.awayGoals);
    }
  });

  it('is fast enough to run a whole league season in a blink', () => {
    const t0 = Date.now();
    quickSample(380, 110, 110);
    // 380 matches is one full division-season. The full engine would take ten minutes.
    expect(Date.now() - t0).toBeLessThan(4000);
  });
});

// The calibration that makes the two engines interchangeable. If these drift, a result
// depends on whether the player happened to watch — the failure players notice first.
describe('the two engines agree', () => {
  const N = 40;
  const quick = quickSample(N, 110, 110);
  const full = fullSample(N, 110, 110);

  it('on goals per game', () => {
    const q = (quick.goalsFor + quick.goalsAgainst) / quick.n;
    const f = (full.goalsFor + full.goalsAgainst) / full.n;
    expect(Math.abs(q - f)).toBeLessThan(0.85);
  });

  it('on shots per game', () => {
    expect(Math.abs(quick.shots / quick.n - full.shots / full.n)).toBeLessThan(9);
  });

  it('on possession between even sides', () => {
    expect(Math.abs(quick.possession / quick.n - full.possession / full.n)).toBeLessThan(0.08);
  });

  it('on how often the home side wins', () => {
    expect(Math.abs(quick.homeWins / quick.n - full.homeWins / full.n)).toBeLessThan(0.24);
  });

  it('on how often a match is drawn', () => {
    expect(Math.abs(quick.draws / quick.n - full.draws / full.n)).toBeLessThan(0.24);
  });

  it('on the gap a much better side opens up', () => {
    const qs = quickSample(N, 155, 70);
    const fs = fullSample(N, 155, 70);
    const qMargin = (qs.goalsFor - qs.goalsAgainst) / qs.n;
    const fMargin = (fs.goalsFor - fs.goalsAgainst) / fs.n;
    expect(qMargin).toBeGreaterThan(0.5);
    expect(fMargin).toBeGreaterThan(0.5);
    expect(Math.abs(qMargin - fMargin)).toBeLessThan(1.6);
  });
});
