// Watch a world age.
//
//   node scripts/run-ts.mjs src/sim/career/track.ts [seasons]
//
// A career sim can look perfect for one season and be broken over twenty. The failure is
// always slow: talent leaks out through retirement faster than development replaces it,
// and the best league in the country quietly becomes a bad one. Printing the pyramid every
// season is the only way to see it happen.

import { caOf } from '../ratings/ability.js';
import { clubStrength, createWorld, TIERS } from '../world/worldgen.js';
import type { World } from '../world/types.js';
import { advanceDay, endSeason, startSeason } from './season.js';

function tierStrengths(world: World): number[] {
  return world.divisions.map((d) => {
    const s = d.clubIds.map((id) => clubStrength(world, world.clubs[id]!));
    return s.reduce((a, b) => a + b, 0) / s.length;
  });
}

function playSeason(world: World): void {
  for (let guard = 0; guard < 400; guard++) {
    if (advanceDay(world).seasonEnded) return;
  }
}

export default function main(args: string[]): void {
  const seasons = Number(args[0] ?? 20);
  const world = createWorld(2026);
  startSeason(world);

  console.log('season  ' + world.divisions.map((d) => d.name.slice(0, 8).padStart(9)).join('') +
    '   bestCA   meanAge  players  peakAge');
  const show = (s: number): void => {
    const active = world.players.filter((p) => p.clubId >= 0);
    const cas = active.map((p) => caOf(p.attrs, p.natural));
    const best = Math.max(...cas);
    const meanAge = active.reduce((t, p) => t + p.age, 0) / active.length;
    // The age at which players are actually at their best tells you whether development
    // is working: if it drifts up, nobody is reaching their potential in time.
    let peakAge = 0;
    let peakCa = 0;
    for (let age = 16; age <= 38; age++) {
      const band = active.filter((p) => p.age === age).map((p) => caOf(p.attrs, p.natural));
      if (band.length < 20) continue;
      const m = band.reduce((a, b) => a + b, 0) / band.length;
      if (m > peakCa) {
        peakCa = m;
        peakAge = age;
      }
    }
    console.log(
      String(s).padStart(6) + '  ' +
      tierStrengths(world).map((v) => v.toFixed(1).padStart(9)).join('') +
      `   ${best.toFixed(0).padStart(6)}  ${meanAge.toFixed(1).padStart(8)}  ${String(active.length).padStart(7)}  ${String(peakAge).padStart(7)}`,
    );
  };

  show(0);
  for (let s = 1; s <= seasons; s++) {
    playSeason(world);
    endSeason(world);
    if (s % 2 === 0 || s === seasons) show(s);
  }
  void TIERS;
}
