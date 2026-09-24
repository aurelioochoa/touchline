import { describe, expect, it } from 'vitest';
import { TAU } from '../core/math.js';
import { emptyPose, runPose } from './gait.js';
import { applyBallWork, BALL_WORK, ballWorkOffset, ballWorkSeconds, offsetToSim, type BallOffset } from './tricks.js';
import { SKILL_MOVES } from '../sim/match/skills.js';

const off = (): BallOffset => ({ side: 0, fwd: 0, up: 0 });

describe('ball work poses', () => {
  it('grow out of the run and settle back into it', () => {
    for (const move of BALL_WORK) {
      const base = runPose(emptyPose(), 1, 5, 0, 1);
      for (const k of [0, 1]) {
        const p = runPose(emptyPose(), 1, 5, 0, 1);
        applyBallWork(p, move, k, 1);
        expect(p.hipPitch[0], `${move} at ${k}`).toBeCloseTo(base.hipPitch[0], 6);
        expect(p.kneeBend[1], `${move} at ${k}`).toBeCloseTo(base.kneeBend[1], 6);
        expect(p.shift, `${move} at ${k}`).toBeCloseTo(0, 6);
      }
    }
  });

  it('actually move the body somewhere in the middle', () => {
    for (const move of BALL_WORK) {
      const base = runPose(emptyPose(), 1, 5, 0, 1);
      let moved = 0;
      for (let k = 0.1; k < 0.95; k += 0.05) {
        const p = runPose(emptyPose(), 1, 5, 0, 1);
        applyBallWork(p, move, k, 0);
        moved = Math.max(
          moved,
          Math.abs(p.hipPitch[0] - base.hipPitch[0]) + Math.abs(p.hipPitch[1] - base.hipPitch[1]) +
            Math.abs(p.hipYaw[0] - base.hipYaw[0]) + Math.abs(p.hipYaw[1] - base.hipYaw[1]) +
            Math.abs(p.shift) + Math.abs(p.yaw) + Math.abs(p.lean - base.lean) +
            Math.abs(p.shoulderRoll[0] - base.shoulderRoll[0]),
        );
      }
      expect(moved, move).toBeGreaterThan(0.25);
    }
  });

  it('turns a roulette all the way round, so it ends facing where it started', () => {
    const p = emptyPose();
    applyBallWork(p, 'roulette', 0.999, 1);
    expect(Math.abs(p.yaw)).toBeCloseTo(TAU, 2);
    const mid = emptyPose();
    applyBallWork(mid, 'roulette', 0.5, 1);
    expect(Math.abs(mid.yaw)).toBeGreaterThan(2);
  });

  it('mirror with the working foot', () => {
    const l = emptyPose();
    const r = emptyPose();
    applyBallWork(l, 'elastico', 0.55, 0);
    applyBallWork(r, 'elastico', 0.55, 1);
    expect(l.shift).toBeCloseTo(-r.shift, 6);
  });
});

describe('ball work ball paths', () => {
  it('takes the ball over his head on a rainbow flick', () => {
    let top = 0;
    for (let k = 0; k <= 1; k += 0.02) top = Math.max(top, ballWorkOffset(off(), 'flick', k, 1).up);
    // A head is at about 1.8m.
    expect(top).toBeGreaterThan(1.9);
  });

  it('sends a nutmeg well ahead, through where the defender stands', () => {
    let far = 0;
    for (let k = 0; k <= 1; k += 0.02) far = Math.max(far, ballWorkOffset(off(), 'nutmeg', k, 0).fwd);
    expect(far).toBeGreaterThan(1.2);
  });

  it('takes an elastico out one side and back across the other', () => {
    const out = ballWorkOffset(off(), 'elastico', 0.3, 1).side;
    const back = ballWorkOffset(off(), 'elastico', 0.55, 1).side;
    expect(Math.sign(out)).toBe(-Math.sign(back));
  });

  it('leaves the ball alone on the first touches', () => {
    for (const k of [0.2, 0.5, 0.8]) {
      const o = ballWorkOffset(off(), 'control', k, 1);
      expect([o.side, o.fwd, o.up]).toEqual([0, 0, 0]);
    }
  });

  it('starts every trick with the ball where it already was', () => {
    for (const move of SKILL_MOVES) {
      const o = ballWorkOffset(off(), move, 0, 1);
      expect(Math.hypot(o.side, o.fwd, o.up), move).toBeLessThan(1e-9);
    }
  });

  it('plays each trick for as long as the engine allows it', () => {
    for (const move of SKILL_MOVES) expect(ballWorkSeconds(move)).toBeGreaterThan(0.4);
  });
});

describe('offsetToSim', () => {
  it('puts forward along the facing and side along the figure +X', () => {
    const o = { x: 0, y: 0 };
    offsetToSim({ side: 0, fwd: 1, up: 0 }, Math.PI / 2, o);
    expect(o.x).toBeCloseTo(0, 9);
    expect(o.y).toBeCloseTo(1, 9);
    // Facing +x, the figure's +X is (sin f, -cos f) = (0, -1) — see figure.ts setPose.
    offsetToSim({ side: 1, fwd: 0, up: 0 }, 0, o);
    expect(o.x).toBeCloseTo(0, 9);
    expect(o.y).toBeCloseTo(-1, 9);
  });
});
