// The stamina calibration, pinned.
//
// This file exists because the constants it guards were wrong by a factor of about sixty
// for the whole of the game's first version, and nothing caught it: no test looked at
// stamina, the engine's own assertions are about goals and possession, and the screenshot
// harness photographs a pitch rather than a bar. What the bug actually broke was the
// substitution — the first decision design §3 promises a new player in their first thirty
// seconds — because every one of the twenty-two figures was empty before the third minute,
// so "one of them is flashing amber, bring on a fresh one" was eleven of them flashing and
// the replacement draining just as fast.
//
// The assertions below are in two halves. The projection tests pin the SHAPE of the model
// and run instantly. The engine test pins the DISTRIBUTION a real ninety minutes produces,
// which is the thing that actually matters and the thing a closed-form projection got
// wrong twice.

import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../core/rng.js';
import { generateAttributes } from '../ratings/ability.js';
import { setAttr, type Attributes } from '../ratings/attributes.js';
import { MatchEngine } from './engine.js';
import { projectStamina, TICK } from './physics.js';
import { buildTeam, resetPlayerIds } from './quickTeam.js';
import type { TeamSetup } from './types.js';

const MATCH_TICKS = (90 * 60) / TICK;

function playerWithEndurance(level: number): Attributes {
  const attrs = generateAttributes(mulberry32(7), 'MC', 110);
  setAttr(attrs, 'stamina', level);
  setAttr(attrs, 'naturalFitness', level);
  return attrs;
}

describe('the stamina model', () => {
  // The regression itself, stated as the thing a player would notice. Two minutes is the
  // point at which the broken version had already drained more than half the bar.
  it('has barely moved after two minutes, at any work rate', () => {
    const twoMinutes = (2 * 60) / TICK;
    for (const frac of [0, 0.3, 0.6, 1]) {
      const end = projectStamina(playerWithEndurance(12), frac, twoMinutes);
      expect(end, `frac ${frac}`).toBeGreaterThan(0.9);
    }
  });

  it('rewards endurance monotonically', () => {
    let previous = -1;
    for (const level of [4, 8, 12, 16, 20]) {
      const end = projectStamina(playerWithEndurance(level), 0.3, MATCH_TICKS);
      expect(end).toBeGreaterThan(previous);
      previous = end;
    }
  });

  // The invariant that is easiest to lose while tuning the other two constants: a player
  // who is not working must gain, not lose. Without it every match is a slide to zero
  // whatever anyone does, which is the bug this file was written for wearing a smaller hat.
  it('recovers a player who is standing still', () => {
    const tenMinutes = (10 * 60) / TICK;
    for (const level of [4, 12, 20]) {
      const rested = projectStamina(playerWithEndurance(level), 0, tenMinutes, 0.5);
      expect(rested, `endurance ${level}`).toBeGreaterThan(0.5);
    }
  });

  it('charges more for sprinting than for jogging', () => {
    const jog = projectStamina(playerWithEndurance(12), 0.25, MATCH_TICKS);
    const sprint = projectStamina(playerWithEndurance(12), 0.75, MATCH_TICKS);
    expect(sprint).toBeLessThan(jog);
  });
});

describe('a real ninety minutes', () => {
  /** Every starter's final stamina, across a few complete matches. */
  const ends: number[] = (() => {
    const out: number[] = [];
    for (let m = 0; m < 3; m++) {
      resetPlayerIds(1);
      const rng = mulberry32(4242 + m * 7919);
      const spec = (side: 'home' | 'away', id: number): TeamSetup =>
        buildTeam(rng, {
          side, clubId: id, name: String(id), shortName: String(id), strength: 120,
          kitPrimary: 0xd42b2b, kitSecondary: 0xffffff,
        });
      const engine = new MatchEngine(spec('home', 1), spec('away', 2), 4242 + m);
      let guard = 0;
      while (!engine.state.finished && guard++ < 200_000) engine.step();
      for (const p of [...engine.state.home.players, ...engine.state.away.players]) {
        if (p.onPitch) out.push(p.stamina);
      }
    }
    return out.sort((a, b) => a - b);
  })();

  const q = (f: number): number => ends[Math.min(ends.length - 1, Math.floor(ends.length * f))] as number;

  it('runs to completion with a full pitch of players', () => {
    expect(ends.length).toBeGreaterThan(50);
  });

  // Not "tires everybody": the freshest man on the pitch finishes around 0.97 and he is
  // a goalkeeper, which is correct — he covers about two kilometres. The claim worth
  // making is about the outfield, so it is made about the median.
  it('tires the typical outfielder noticeably', () => {
    expect(q(0.5)).toBeLessThan(0.8);
  });

  it('leaves even the least-worked player short of full', () => {
    expect(q(1)).toBeLessThan(0.99);
  });

  it('empties nobody', () => {
    // A player at zero is a player the speed model stops entirely, which looks like the
    // game has frozen him rather than like he is tired.
    expect(q(0)).toBeGreaterThan(0.2);
  });

  it('leaves the typical starter tired but usable', () => {
    const mean = ends.reduce((t, v) => t + v, 0) / ends.length;
    expect(mean).toBeGreaterThan(0.55);
    expect(mean).toBeLessThan(0.75);
  });

  // The whole point. `match.ts` paints a chip amber below 0.55, and that has to pick out a
  // minority worth acting on: if nobody is under it the substitution never comes up, and
  // if everybody is it is not a decision.
  it('leaves a minority under the amber line, not nobody and not everybody', () => {
    const tired = ends.filter((s) => s < 0.55).length / ends.length;
    expect(tired).toBeGreaterThan(0.05);
    expect(tired).toBeLessThan(0.5);
  });
});
