// The laws of the game, as pictures.
//
// Every assertion here is something a referee would enforce and a viewer would notice: a
// wall at the right distance, a kickoff with both teams in their own half, a penalty with
// nobody but two men inside the area. They are cheap to check and impossible to eyeball
// reliably across a whole season, which is exactly the split between this file and
// `make shots`.

import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../core/rng.js';
import { createMatchState } from './engine.js';
import {
  HALF_WIDTH,
  PENALTY_AREA_DEPTH,
  PENALTY_AREA_WIDTH,
  PITCH_LENGTH,
  PITCH_WIDTH,
} from './pitch.js';
import { buildTeam, resetPlayerIds } from './quickTeam.js';
import { RESTART_CLEARANCE, setPiecePositioning } from './setpieces.js';
import type { MatchPlayer, MatchState, PlayState, Side } from './types.js';

function stateWith(play: PlayState, seed = 77): MatchState {
  resetPlayerIds(1);
  const rng = mulberry32(seed);
  const home = buildTeam(rng, {
    side: 'home', clubId: 1, name: 'Home', shortName: 'HOM',
    strength: 110, kitPrimary: 0xd42b2b, kitSecondary: 0xffffff,
  });
  const away = buildTeam(rng, {
    side: 'away', clubId: 2, name: 'Away', shortName: 'AWY',
    strength: 110, kitPrimary: 0x2b4bd4, kitSecondary: 0xffffff,
  });
  const s = createMatchState(home, away);
  s.play = play;
  return s;
}

function active(s: MatchState, side: Side): MatchPlayer[] {
  return (side === 'home' ? s.home : s.away).players.filter((p) => p.onPitch && !p.sentOff);
}

function all(s: MatchState): MatchPlayer[] {
  return [...active(s, 'home'), ...active(s, 'away')];
}

/** Put the ball where the restart says it is, the way the engine's `#setRestart` does. */
function ballAt(s: MatchState, x: number, y: number): void {
  s.ball.x = x;
  s.ball.y = y;
}

describe('setPiecePositioning', () => {
  it('declines open play, half time and full time', () => {
    expect(setPiecePositioning(stateWith({ kind: 'open' }))).toBe(false);
    expect(setPiecePositioning(stateWith({ kind: 'halfTime' }))).toBe(false);
    expect(setPiecePositioning(stateWith({ kind: 'fullTime' }))).toBe(false);
  });

  it('puts both teams in their own half for a kickoff, and only the takers in the circle', () => {
    const s = stateWith({ kind: 'kickoff', side: 'home' });
    ballAt(s, PITCH_LENGTH / 2, HALF_WIDTH);
    expect(setPiecePositioning(s)).toBe(true);

    // Home attacks +x in the first half, so home belongs in the LOW half.
    for (const p of active(s, 'home')) expect(p.targetX, p.name).toBeLessThanOrEqual(PITCH_LENGTH / 2 + 0.01);
    for (const p of active(s, 'away')) expect(p.targetX, p.name).toBeGreaterThanOrEqual(PITCH_LENGTH / 2 - 0.01);

    // Nobody from the defending side is inside the circle.
    for (const p of active(s, 'away')) {
      const d = Math.hypot(p.targetX - s.ball.x, p.targetY - s.ball.y);
      expect(d, p.name).toBeGreaterThanOrEqual(RESTART_CLEARANCE - 0.01);
    }
    // And at most two of the kicking side are.
    const inside = active(s, 'home').filter(
      (p) => Math.hypot(p.targetX - s.ball.x, p.targetY - s.ball.y) < RESTART_CLEARANCE,
    );
    expect(inside.length).toBeLessThanOrEqual(2);
  });

  it('builds a wall at exactly the distance the law gives, on the line to goal', () => {
    const s = stateWith({ kind: 'freeKick', side: 'home', x: 84, y: 30 });
    ballAt(s, 84, 30);
    setPiecePositioning(s);

    const goalX = PITCH_LENGTH;
    const toGoal = Math.hypot(goalX - 84, HALF_WIDTH - 30);
    const ux = (goalX - 84) / toGoal;
    const uy = (HALF_WIDTH - 30) / toGoal;

    // Somebody is standing on the shooting line at the clearance distance.
    const wall = active(s, 'away').filter((p) => {
      const d = Math.hypot(p.targetX - 84, p.targetY - 30);
      if (Math.abs(d - RESTART_CLEARANCE) > 1.2) return false;
      // Within a couple of metres of the ball-to-goal line.
      const along = (p.targetX - 84) * ux + (p.targetY - 30) * uy;
      const off = Math.hypot(p.targetX - 84 - along * ux, p.targetY - 30 - along * uy);
      return along > 0 && off < 2.2;
    });
    expect(wall.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps everyone but the taker out of the ring at a free kick', () => {
    const s = stateWith({ kind: 'freeKick', side: 'home', x: 84, y: 30 });
    ballAt(s, 84, 30);
    setPiecePositioning(s);
    const near = all(s).filter(
      (p) => Math.hypot(p.targetX - 84, p.targetY - 30) < RESTART_CLEARANCE - 0.01,
    );
    expect(near.length).toBeLessThanOrEqual(1);
  });

  it('fills both boxes at a corner and puts two defenders on the posts', () => {
    const s = stateWith({ kind: 'corner', side: 'home', x: PITCH_LENGTH, y: 0 });
    ballAt(s, PITCH_LENGTH - 0.4, 0.4);
    setPiecePositioning(s);

    const inBox = (p: MatchPlayer): boolean =>
      PITCH_LENGTH - p.targetX <= PENALTY_AREA_DEPTH &&
      Math.abs(p.targetY - HALF_WIDTH) <= PENALTY_AREA_WIDTH / 2;

    expect(active(s, 'home').filter(inBox).length).toBeGreaterThanOrEqual(4);
    expect(active(s, 'away').filter(inBox).length).toBeGreaterThanOrEqual(6);

    // Two of them are on the goal line beside the posts.
    const onPosts = active(s, 'away').filter(
      (p) => PITCH_LENGTH - p.targetX < 1.2 && Math.abs(Math.abs(p.targetY - HALF_WIDTH) - 3.46) < 0.6,
    );
    expect(onPosts.length).toBe(2);

    // And somebody stays back for the counter.
    expect(active(s, 'home').some((p) => p.targetX < PITCH_LENGTH * 0.55)).toBe(true);
  });

  it('puts the thrower off the pitch at a throw-in, and nobody else', () => {
    const s = stateWith({ kind: 'throwIn', side: 'home', x: 60, y: 0 });
    ballAt(s, 60, 0);
    setPiecePositioning(s);
    const off = all(s).filter((p) => p.targetY < -0.2 || p.targetY > PITCH_WIDTH + 0.2);
    expect(off.length).toBe(1);
    expect(off[0]?.side).toBe('home');
  });

  it('clears the penalty area at a goal kick', () => {
    const s = stateWith({ kind: 'goalKick', side: 'home' });
    ballAt(s, 5.5, HALF_WIDTH);
    setPiecePositioning(s);
    // Home defends x = 0 in the first half, so the box in question is the low one.
    const intruders = active(s, 'away').filter(
      (p) => p.targetX < PENALTY_AREA_DEPTH && Math.abs(p.targetY - HALF_WIDTH) < PENALTY_AREA_WIDTH / 2,
    );
    expect(intruders.length).toBe(0);
    // The keeper is on the ball.
    const gk = active(s, 'home').find((p) => p.role === 'GK');
    expect(Math.hypot((gk?.targetX ?? 0) - 5.5, (gk?.targetY ?? 0) - HALF_WIDTH)).toBeLessThan(0.5);
  });

  it('leaves only the taker and the keeper inside the area at a penalty', () => {
    const s = stateWith({ kind: 'penalty', side: 'home' });
    ballAt(s, PITCH_LENGTH - 11, HALF_WIDTH);
    setPiecePositioning(s);
    const inside = all(s).filter(
      (p) =>
        PITCH_LENGTH - p.targetX <= PENALTY_AREA_DEPTH &&
        Math.abs(p.targetY - HALF_WIDTH) <= PENALTY_AREA_WIDTH / 2,
    );
    expect(inside.length).toBe(2);
    // Everyone else is out of the D as well, which the box alone does not give.
    for (const p of all(s)) {
      if (inside.includes(p)) continue;
      const d = Math.hypot(p.targetX - (PITCH_LENGTH - 11), p.targetY - HALF_WIDTH);
      expect(d, p.name).toBeGreaterThanOrEqual(RESTART_CLEARANCE - 0.01);
    }
  });

  it('never sends a defending side away from the goal it is defending', () => {
    // `along` runs from a team's own goal to the opposition's, and reading it the other
    // way round is silent: the explicit overrides in each routine put most of the side in
    // the right place anyway, so only the leftover players end up marching upfield while
    // their box is under siege. Assert the whole side, not the ones with a named job.
    const cases: [PlayState, [number, number]][] = [
      [{ kind: 'corner', side: 'home', x: PITCH_LENGTH, y: 0 }, [PITCH_LENGTH - 0.4, 0.4]],
      [{ kind: 'freeKick', side: 'home', x: 84, y: 30 }, [84, 30]],
      [{ kind: 'penalty', side: 'home' }, [PITCH_LENGTH - 11, HALF_WIDTH]],
    ];
    for (const [play, [bx, by]] of cases) {
      const s = stateWith(play);
      ballAt(s, bx, by);
      setPiecePositioning(s);
      // Away defends x = PITCH_LENGTH in the first half. Every one of them should be in
      // that half of the pitch, not stranded in the half the ball is nowhere near.
      for (const p of active(s, 'away')) {
        expect(p.targetX, `${play.kind}: ${p.name}`).toBeGreaterThan(PITCH_LENGTH * 0.42);
      }
    }
  });

  it('survives a team reduced to nine men', () => {
    // Every pick in the module counts back from the front of the shape, so a short team
    // used to index past the end and throw inside the engine's hot loop.
    for (const play of [
      { kind: 'corner', side: 'home', x: PITCH_LENGTH, y: 0 },
      { kind: 'throwIn', side: 'home', x: 60, y: 0 },
      { kind: 'freeKick', side: 'home', x: 84, y: 30 },
      { kind: 'penalty', side: 'home' },
      { kind: 'goalKick', side: 'home' },
      { kind: 'kickoff', side: 'home' },
    ] as PlayState[]) {
      const s = stateWith(play);
      for (const p of s.home.players.slice(-2)) p.sentOff = true;
      for (const p of s.away.players.slice(-3)) p.sentOff = true;
      expect(() => setPiecePositioning(s)).not.toThrow();
    }
  });

  it('is deterministic and does not churn between ticks', () => {
    // Roles are keyed off the shape, not off who is nearest, so running the same restart
    // twice must give byte-identical targets — otherwise players swap jobs, set off toward
    // each other, and swap back.
    const a = stateWith({ kind: 'corner', side: 'home', x: PITCH_LENGTH, y: 0 });
    ballAt(a, PITCH_LENGTH - 0.4, 0.4);
    setPiecePositioning(a);
    const first = all(a).map((p) => `${p.id}:${p.targetX.toFixed(6)},${p.targetY.toFixed(6)}`);
    setPiecePositioning(a);
    const second = all(a).map((p) => `${p.id}:${p.targetX.toFixed(6)},${p.targetY.toFixed(6)}`);
    expect(second).toEqual(first);
  });
});
