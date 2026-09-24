// The three officials, and the two things they are actually for.
//
// The assistants exist to make the offside line visible. That is a claim a screenshot
// cannot check — a linesman standing in a plausible place looks identical to one standing
// level with the wrong defender — so it is checked here instead.
//
// The referee exists to not be noticed, and the way he became impossible not to notice was
// speed. The old solver assigned a target instead of walking to one: measured against a
// real match he peaked at 149.7 m/s and turned at 31.4 rad/s, which the renderer reads as
// running speed and lean and draws as a smear with spinning legs. The three motion tests
// at the bottom are the ones that would have caught it, and none of them needs a picture.

import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng.js';
import { createMatchState } from '../sim/match/engine.js';
import { HALF_LENGTH, PITCH_LENGTH, PITCH_WIDTH } from '../sim/match/pitch.js';
import { TICK } from '../sim/match/physics.js';
import { buildTeam, resetPlayerIds } from '../sim/match/quickTeam.js';
import { OFFICIAL_COUNT, emptyOfficials, officialsFor, snapOfficials } from './officials.js';
import type { MatchState } from '../sim/match/types.js';

/** Faster than any official is allowed to move, with room for floating-point slop. */
const SPEED_CEILING = 7.05;
/** How far an assistant covers in one tick at his top speed. */
const ASSIST_STEP = 7 * TICK;

function state(seed = 31): MatchState {
  resetPlayerIds(1);
  const rng = mulberry32(seed);
  const home = buildTeam(rng, {
    side: 'home', clubId: 1, name: 'H', shortName: 'H',
    strength: 110, kitPrimary: 1, kitSecondary: 2,
  });
  const away = buildTeam(rng, {
    side: 'away', clubId: 2, name: 'A', shortName: 'A',
    strength: 110, kitPrimary: 3, kitSecondary: 4,
  });
  return createMatchState(home, away);
}

/** Scatter the players so the offside line is somewhere interesting. */
function scatter(s: MatchState, rng: () => number): void {
  for (const team of [s.home, s.away]) {
    for (const p of team.players) {
      p.x = rng() * PITCH_LENGTH;
      p.y = rng() * PITCH_WIDTH;
    }
  }
}

describe('officialsFor', () => {
  it('places three officials', () => {
    const out = emptyOfficials();
    expect(out).toHaveLength(OFFICIAL_COUNT);
    officialsFor(state(), out);
    for (const o of out) {
      expect(Number.isFinite(o.x)).toBe(true);
      expect(Number.isFinite(o.y)).toBe(true);
      expect(Number.isFinite(o.facing)).toBe(true);
    }
  });

  it('keeps both assistants off the field of play, on opposite touchlines', () => {
    const out = emptyOfficials();
    const rng = mulberry32(7);
    const s = state();
    for (let i = 0; i < 200; i++) {
      scatter(s, rng);
      s.ball.x = rng() * PITCH_LENGTH;
      s.ball.y = rng() * PITCH_WIDTH;
      officialsFor(s, out);
      const [, a, b] = out;
      // An assistant who strays onto the grass is a player as far as the picture is
      // concerned, and gets run over by the game he is judging.
      expect(a?.y).toBeLessThan(0);
      expect(b?.y).toBeGreaterThan(PITCH_WIDTH);
    }
  });

  it('gives each assistant his own half and keeps him in it', () => {
    const out = emptyOfficials();
    const rng = mulberry32(11);
    const s = state();
    for (let i = 0; i < 200; i++) {
      scatter(s, rng);
      s.ball.x = rng() * PITCH_LENGTH;
      s.ball.y = rng() * PITCH_WIDTH;
      officialsFor(s, out);
      expect(out[1]?.x).toBeLessThanOrEqual(HALF_LENGTH + 1.001);
      expect(out[2]?.x).toBeGreaterThanOrEqual(HALF_LENGTH - 1.001);
      expect(out[1]?.x).toBeGreaterThanOrEqual(0);
      expect(out[2]?.x).toBeLessThanOrEqual(PITCH_LENGTH);
    }
  });

  it('stands the assistant level with the offside line, not with the goalkeeper', () => {
    const s = state();
    // Home attacks +x in the first half, so away defends the far goal. Put away's outfield
    // defenders on a clean line at x = 74, with the keeper far behind them at x = 98.
    for (const p of s.away.players) {
      // Keeper deepest of all, back four in front of him, everyone else further upfield.
      p.x = p.role === 'GK' ? 98 : p.role.startsWith('D') ? 74 : 62;
      p.y = PITCH_WIDTH / 2;
    }
    for (const p of s.home.players) {
      p.x = 60;
      p.y = PITCH_WIDTH / 2;
    }
    s.ball.x = 58;
    s.ball.y = PITCH_WIDTH / 2;

    const out = emptyOfficials();
    // Where he is HEADING, not how long it takes him to get there — this is a test about
    // the offside law, and making it wait out a walk would only make it slower to fail.
    snapOfficials(s, out);
    // The far assistant sits on the deepest OUTFIELD defender — 74 — and not on the
    // keeper at 98, which is the half of the offside law most implementations skip.
    expect(out[2]?.x).toBeCloseTo(74, 0);
  });

  it('follows the ball when the ball is nearer the goal line than the defence is', () => {
    const s = state();
    for (const p of s.away.players) {
      p.x = p.role === 'GK' ? 100 : 70;
      p.y = PITCH_WIDTH / 2;
    }
    const out = emptyOfficials();
    // Ball behind the last defender: the assistant goes with the ball, which is the
    // instruction a real one works to.
    s.ball.x = 88;
    s.ball.y = PITCH_WIDTH / 2;
    snapOfficials(s, out);
    expect(out[2]?.x).toBeCloseTo(88, 0);
  });

  it('keeps the referee on the pitch and out of the play', () => {
    const out = emptyOfficials();
    const rng = mulberry32(5);
    const s = state();
    for (let i = 0; i < 300; i++) {
      scatter(s, rng);
      s.ball.x = rng() * PITCH_LENGTH;
      s.ball.y = rng() * PITCH_WIDTH;
      // Settle: the ball has just teleported across the pitch, which nothing in a real
      // match does, and the referee is not allowed to teleport after it. Give him the
      // second and a half it takes to walk to his new spot.
      for (let k = 0; k < 15; k++) officialsFor(s, out);
      const ref = out[0];
      if (!ref) throw new Error('no referee');
      expect(ref.x).toBeGreaterThanOrEqual(2);
      expect(ref.x).toBeLessThanOrEqual(PITCH_LENGTH - 2);
      expect(ref.y).toBeGreaterThanOrEqual(2);
      expect(ref.y).toBeLessThanOrEqual(PITCH_WIDTH - 2);
      // He may be squeezed by the touchline clamp, but he should never be standing on the
      // ball: a referee in the middle of the play is the one thing everyone notices.
      const d = Math.hypot(ref.x - s.ball.x, ref.y - s.ball.y);
      expect(d).toBeGreaterThan(1.5);
    }
  });

  // ---- motion --------------------------------------------------------------------

  it('never moves an official faster than a human can run', () => {
    const out = emptyOfficials();
    const rng = mulberry32(19);
    const s = state();
    // One snap to get everybody to a sensible starting place, then never again: from here
    // on every position must be reachable from the last one.
    snapOfficials(s, out);
    let worst = 0;
    for (let i = 0; i < 600; i++) {
      // A ball that jumps 60 metres between ticks is harsher than any real pass, which is
      // the point — the officials must not follow it any faster than they could run.
      s.ball.x = rng() * PITCH_LENGTH;
      s.ball.y = rng() * PITCH_WIDTH;
      if (i % 7 === 0) scatter(s, rng);
      const before = out.map((o) => ({ x: o.x, y: o.y }));
      officialsFor(s, out, TICK);
      for (let k = 0; k < OFFICIAL_COUNT; k++) {
        const a = before[k];
        const b = out[k];
        if (!a || !b) throw new Error('missing official');
        worst = Math.max(worst, Math.hypot(b.x - a.x, b.y - a.y) / TICK);
      }
    }
    expect(worst).toBeLessThanOrEqual(SPEED_CEILING);
  });

  it('never turns the referee faster than a human can turn', () => {
    const out = emptyOfficials();
    const rng = mulberry32(23);
    const s = state();
    snapOfficials(s, out);
    let worst = 0;
    for (let i = 0; i < 600; i++) {
      s.ball.x = rng() * PITCH_LENGTH;
      s.ball.y = rng() * PITCH_WIDTH;
      const before = out[0]?.facing ?? 0;
      officialsFor(s, out, TICK);
      const after = out[0]?.facing ?? 0;
      let delta = Math.abs(after - before);
      if (delta > Math.PI) delta = Math.PI * 2 - delta;
      worst = Math.max(worst, delta / TICK);
    }
    // The old solver reached 31.4 rad/s here — half a turn inside one tick.
    expect(worst).toBeLessThanOrEqual(4.6);
  });

  it('runs a diagonal rather than shadowing the ball down one line', () => {
    const out = emptyOfficials();
    const rng = mulberry32(29);
    const s = state();
    snapOfficials(s, out);
    let sharedColumn = 0;
    let facings = 0;
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      s.ball.x = rng() * PITCH_LENGTH;
      s.ball.y = rng() * PITCH_WIDTH;
      officialsFor(s, out, TICK);
      const ref = out[0];
      if (!ref) throw new Error('no referee');
      if (Math.abs(ref.x - s.ball.x) < 1e-6) sharedColumn++;
      // Bucketed to a tenth of a radian: what the broken version produced was exactly two
      // headings for a whole match, and a set is the shortest way to say so.
      seen.add((Math.round(ref.facing * 10) / 10).toFixed(1));
      facings++;
    }
    // The old solver assigned the ball's own x to the referee, every single tick.
    expect(sharedColumn).toBe(0);
    expect(facings).toBe(400);
    // And could therefore only ever face +90 or -90 degrees.
    expect(seen.size).toBeGreaterThan(10);
  });

  it('snaps rather than sprints when the ends swap at half time', () => {
    const out = emptyOfficials();
    const s = state();
    // Two defences dug in at opposite ends, so the two offside lines are unmistakably far
    // apart and swapping them is unmistakably a long way to travel.
    for (const p of s.home.players) p.x = p.role === 'GK' ? 3 : 8;
    for (const p of s.away.players) p.x = p.role === 'GK' ? 102 : 97;
    s.ball.x = HALF_LENGTH;
    s.ball.y = PITCH_WIDTH / 2;
    snapOfficials(s, out);
    const firstHalf = out.map((o) => ({ x: o.x, y: o.y }));

    // Half time. Home now defends the far goal, so both offside lines are at the other end
    // of the pitch; walking there at 7 m/s would be several seconds of officials jogging
    // across an otherwise still picture.
    s.period = 'second';
    officialsFor(s, out, TICK);
    let moved = 0;
    for (let k = 1; k < OFFICIAL_COUNT; k++) {
      const a = firstHalf[k];
      const b = out[k];
      if (!a || !b) throw new Error('missing official');
      moved = Math.max(moved, Math.hypot(b.x - a.x, b.y - a.y));
    }
    // Somebody has to have moved further than one tick of running allows, or the snap did
    // not happen and this test is passing for the wrong reason.
    expect(moved).toBeGreaterThan(ASSIST_STEP);

    // And from the next tick on he is back under the speed limit.
    const after = out.map((o) => ({ x: o.x, y: o.y }));
    officialsFor(s, out, TICK);
    for (let k = 0; k < OFFICIAL_COUNT; k++) {
      const a = after[k];
      const b = out[k];
      if (!a || !b) throw new Error('missing official');
      expect(Math.hypot(b.x - a.x, b.y - a.y) / TICK).toBeLessThanOrEqual(SPEED_CEILING);
    }
  });
});
