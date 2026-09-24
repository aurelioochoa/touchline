// Fit the quick engine to the full one.
//
//   node scripts/run-ts.mjs src/sim/match/fit-quick.ts [samplesPerPair]
//
// The quick engine only earns its place if its results are indistinguishable from the full
// engine's in aggregate. Even strength is easy; the hard part is how each responds to a
// STRENGTH GAP, because the errors compound — a power on the shot ratio multiplied by a
// power on the conversion rate turns a modest mismatch into a cricket score.
//
// This prints both engines side by side across a ladder of mismatches so the exponents can
// be fitted to data rather than guessed.

import { mulberry32, streamOf } from '../../core/rng.js';
import { MatchEngine } from './engine.js';
import { quickMatch } from './quick.js';
import { buildTeam, resetPlayerIds } from './quickTeam.js';
import type { MatchResult, TeamSetup } from './types.js';

function pair(seed: number, hs: number, as: number): [TeamSetup, TeamSetup] {
  resetPlayerIds(1);
  const rng = mulberry32(seed);
  return [
    buildTeam(rng, { side: 'home', clubId: 1, name: 'H', shortName: 'H', strength: hs, kitPrimary: 1, kitSecondary: 2 }),
    buildTeam(rng, { side: 'away', clubId: 2, name: 'A', shortName: 'A', strength: as, kitPrimary: 3, kitSecondary: 4 }),
  ];
}

interface Row {
  goalsHome: number;
  goalsAway: number;
  shots: number;
  homeWin: number;
  draw: number;
  poss: number;
  n: number;
}

function agg(rs: MatchResult[]): Row {
  const r: Row = { goalsHome: 0, goalsAway: 0, shots: 0, homeWin: 0, draw: 0, poss: 0, n: rs.length };
  for (const m of rs) {
    r.goalsHome += m.homeGoals;
    r.goalsAway += m.awayGoals;
    r.shots += m.homeShots + m.awayShots;
    r.poss += m.homePossession;
    if (m.homeGoals > m.awayGoals) r.homeWin++;
    else if (m.homeGoals === m.awayGoals) r.draw++;
  }
  return r;
}

function line(label: string, r: Row): string {
  const n = r.n;
  return [
    label.padEnd(12),
    `GF ${(r.goalsHome / n).toFixed(2)}`,
    `GA ${(r.goalsAway / n).toFixed(2)}`,
    `margin ${((r.goalsHome - r.goalsAway) / n).toFixed(2)}`.padEnd(14),
    `shots ${(r.shots / n).toFixed(1)}`.padEnd(12),
    `W ${(r.homeWin / n).toFixed(2)}`,
    `D ${(r.draw / n).toFixed(2)}`,
    `poss ${(r.poss / n).toFixed(2)}`,
  ].join('  ');
}

export default function main(args: string[]): void {
  const n = Number(args[0] ?? 24);
  const pairs: [number, number][] = [
    [110, 110],
    [125, 95],
    [140, 80],
    [155, 70],
    [170, 55],
    [80, 140],
  ];
  for (const [hs, as] of pairs) {
    const quick: MatchResult[] = [];
    const full: MatchResult[] = [];
    for (let i = 0; i < n; i++) {
      const seed = 1000 + i * 13;
      const [h1, a1] = pair(seed, hs, as);
      quick.push(quickMatch(h1, a1, streamOf(seed, 'quick')));
      const [h2, a2] = pair(seed, hs, as);
      full.push(new MatchEngine(h2, a2, seed).runToEnd());
    }
    console.log(`\n=== ${hs} vs ${as} (${n} matches each) ===`);
    console.log(line('full', agg(full)));
    console.log(line('quick', agg(quick)));
  }
}
