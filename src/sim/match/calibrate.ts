// Balance harness. Runs a pile of matches and prints what football they add up to.
//
//   node scripts/run-ts.mjs src/sim/match/calibrate.ts [matches] [homeCA] [awayCA]
//
// This exists because the engine's constants cannot be reasoned about one at a time. Goals
// per game is the product of shot volume, shot quality, blocks and the keeper, and moving
// any one of them moves the others. The only honest way to tune it is to run a season's
// worth and look at the totals against real football's.

import { mulberry32 } from '../../core/rng.js';
import { MatchEngine } from './engine.js';
import { buildTeam, resetPlayerIds } from './quickTeam.js';
import type { TeamSetup } from './types.js';

// Where the engine stands against real football, as of the 2026-09-06 re-calibration.
//
// That pass was forced rather than chosen. The stamina model was draining a full bar in
// about two minutes (see physics.ts), and because everybody was pinned at zero for
// eighty-eight of the ninety, two OTHER constants had been fitted around the flat values
// that produced: `maxSpeedOf`'s tiredness factor, which was effectively a constant 0.72,
// and `reactionTicks`' tiredness multiplier, which was effectively a constant 1.5. Fixing
// stamina alone made the game 30% faster and 40% more talkative — sixteen shots a team,
// 656 passes, and a two-division mismatch finishing 14-0 — so all three were re-derived
// together. The table below is the result, and it is at or better than the pre-fix numbers
// on every line that was previously MATCHED.
//
// MATCHED — the numbers that decide results, and the ones worth defending:
//   goals per game, shots, shot conversion, save rate, possession split, home/draw share,
//   offsides, pass volume, cards.
//
// KNOWN GAPS, and why they are being left:
//   * The ball is in play about 5,000 seconds against a real 3,300. Real football stops
//     constantly for things this engine does not model at all — injuries, treatment,
//     substitutions, time-wasting, VAR — and adding fake stoppages to hit a number would
//     make the match worse to watch, not better.
//   * Throw-ins (7 against 40) and corners (1.7 against 5) follow from the same thing: 61%
//     of play happens in the central quarter of the pitch, because six of eleven players
//     stand there. Two attempts to widen it are recorded in agent.ts — both made the
//     football worse, one catastrophically (shots per side fell from eleven to four), and
//     both are described at the code that replaced them.
//   * Pass accuracy is 0.67 against a real 0.79, the difference being interceptions.
//
// The gaps are visible in the match stats screen and nowhere else. Nothing in this list
// changes who wins.
/** Real-football reference values, for comparison in the printed report. */
export const REAL = {
  goalsPerGame: 2.75,
  shotsPerTeam: 13,
  shotsOnTargetShare: 0.35,
  conversionOfShots: 0.105,
  savePctOfOnTarget: 0.7,
  homeWinShare: 0.44,
  drawShare: 0.24,
  possessionSpread: 0.11,
  passesPerTeam: 450,
  passAccuracy: 0.79,
  foulsPerTeam: 11,
  cardsPerGame: 3.5,
  cornersPerTeam: 5,
  offsidesPerTeam: 1.8,
  throwInsPerGame: 40,
  goalKicksPerGame: 25,
  ballInPlaySeconds: 3300,
};

export interface Totals {
  matches: number;
  goals: number;
  shots: number;
  onTarget: number;
  saves: number;
  passes: number;
  passesCompleted: number;
  fouls: number;
  cards: number;
  corners: number;
  offsides: number;
  throwIns: number;
  passComplete: number;
  passIntercepted: number;
  goalKicks: number;
  inPlayTicks: number;
  homeWins: number;
  draws: number;
  awayWins: number;
  possessionHome: number;
  ticks: number;
  ms: number;
}

export function runSample(count: number, homeCa: number, awayCa: number, seed0 = 1): Totals {
  const t: Totals = {
    matches: 0, goals: 0, shots: 0, onTarget: 0, saves: 0, passes: 0, passesCompleted: 0,
    fouls: 0, cards: 0, corners: 0, offsides: 0, throwIns: 0, passComplete: 0, passIntercepted: 0, goalKicks: 0, inPlayTicks: 0, homeWins: 0, draws: 0, awayWins: 0,
    possessionHome: 0, ticks: 0, ms: 0,
  };
  const start = Date.now();
  for (let i = 0; i < count; i++) {
    const seed = seed0 + i * 7919;
    resetPlayerIds(1);
    const rng = mulberry32(seed);
    const home: TeamSetup = buildTeam(rng, {
      side: 'home', clubId: 1, name: 'Home', shortName: 'HOM',
      strength: homeCa, kitPrimary: 0xd42b2b, kitSecondary: 0xffffff,
    });
    const away: TeamSetup = buildTeam(rng, {
      side: 'away', clubId: 2, name: 'Away', shortName: 'AWY',
      strength: awayCa, kitPrimary: 0x2b4bd4, kitSecondary: 0xffffff,
    });
    const e = new MatchEngine(home, away, seed);
    let offsides = 0;
    let throwIns = 0;
    let goalKicks = 0;
    while (!e.state.finished && e.state.tick < 80_000) {
      if (e.state.restartDelay === 0 && e.state.play.kind === 'open') t.inPlayTicks++;
      for (const ev of e.step()) {
        if (ev.type === 'offside') offsides++;
        else if (ev.type === 'throwIn') throwIns++;
        else if (ev.type === 'goalKick') goalKicks++;
        else if (ev.type === 'passComplete') t.passComplete++;
        else if (ev.type === 'passIntercepted') t.passIntercepted++;
      }
    }
    const s = e.state;
    t.matches++;
    t.ticks += s.tick;
    t.goals += s.score.home + s.score.away;
    t.shots += s.shots.home + s.shots.away;
    t.onTarget += s.shotsOnTarget.home + s.shotsOnTarget.away;
    t.corners += s.corners.home + s.corners.away;
    t.fouls += s.fouls.home + s.fouls.away;
    t.offsides += offsides;
    t.throwIns += throwIns;
    t.goalKicks += goalKicks;
    for (const team of [s.home, s.away]) {
      for (const p of [...team.players, ...team.bench]) {
        t.passes += p.stats.passes;
        t.passesCompleted += p.stats.passesCompleted;
        t.saves += p.stats.saves;
        t.cards += p.yellow + (p.sentOff ? 1 : 0);
      }
    }
    if (s.score.home > s.score.away) t.homeWins++;
    else if (s.score.home < s.score.away) t.awayWins++;
    else t.draws++;
    const tot = s.possessionTicks.home + s.possessionTicks.away;
    t.possessionHome += tot > 0 ? s.possessionTicks.home / tot : 0.5;
  }
  t.ms = Date.now() - start;
  return t;
}

function row(label: string, got: number, want: number, unit = ''): string {
  const ratio = want === 0 ? 1 : got / want;
  const flag = ratio > 1.35 || ratio < 0.74 ? '  <-- OFF' : '';
  return `${label.padEnd(26)} ${got.toFixed(2).padStart(8)}${unit}   real ${want.toFixed(2)}${flag}`;
}

export function report(t: Totals): string {
  const m = t.matches;
  const lines = [
    `matches ${m}   ${(t.ms / m).toFixed(0)} ms/match   ${(t.ticks / m).toFixed(0)} ticks/match`,
    '',
    row('goals per game', t.goals / m, REAL.goalsPerGame),
    row('shots per team', t.shots / m / 2, REAL.shotsPerTeam),
    row('on target / shots', t.onTarget / Math.max(t.shots, 1), REAL.shotsOnTargetShare),
    row('goals / shots', t.goals / Math.max(t.shots, 1), REAL.conversionOfShots),
    row('saves / on target', t.saves / Math.max(t.onTarget, 1), REAL.savePctOfOnTarget),
    row('passes per team', t.passes / m / 2, REAL.passesPerTeam),
    row('pass accuracy', t.passesCompleted / Math.max(t.passes, 1), REAL.passAccuracy),
    row('  ...intercepted share', t.passIntercepted / Math.max(t.passes, 1), 0.12),
    row('  ...lost otherwise', (t.passes - t.passComplete - t.passIntercepted) / Math.max(t.passes, 1), 0.09),
    row('fouls per team', t.fouls / m / 2, REAL.foulsPerTeam),
    row('cards per game', t.cards / m, REAL.cardsPerGame),
    row('corners per team', t.corners / m / 2, REAL.cornersPerTeam),
    row('offsides per team', t.offsides / m / 2, REAL.offsidesPerTeam),
    row('throw-ins per game', t.throwIns / m, REAL.throwInsPerGame),
    row('goal kicks per game', t.goalKicks / m, REAL.goalKicksPerGame),
    row('ball in play (s)', t.inPlayTicks / m / 10, REAL.ballInPlaySeconds),
    row('home win share', t.homeWins / m, REAL.homeWinShare),
    row('draw share', t.draws / m, REAL.drawShare),
    row('home possession', t.possessionHome / m, 0.5),
  ];
  return lines.join('\n');
}

export default function main(args: string[]): void {
  const count = Number(args[0] ?? 20);
  const homeCa = Number(args[1] ?? 110);
  const awayCa = Number(args[2] ?? 110);
  console.log(`\n=== even sides, CA ${homeCa} vs ${awayCa} ===`);
  console.log(report(runSample(count, homeCa, awayCa)));
}
