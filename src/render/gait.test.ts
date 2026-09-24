import { describe, expect, it } from 'vitest';
import { TAU } from '../core/math.js';
import {
  advancePhase,
  applyAction,
  emptyPose,
  idlePose,
  keeperPose,
  legIk,
  LEG_LENGTH,
  RIG,
  runPose,
  isPlanted,
  stanceFraction,
  strideHz,
} from './gait.js';

/** Foot position implied by a leg's joint angles, in the figure's own frame. */
function footOf(hipY: number, hipPitch: number, kneeBend: number): { z: number; y: number } {
  const kneeZ = Math.sin(hipPitch) * RIG.thigh;
  const kneeY = hipY - Math.cos(hipPitch) * RIG.thigh;
  const shinAngle = hipPitch - kneeBend;
  return {
    z: kneeZ + Math.sin(shinAngle) * RIG.shin,
    y: kneeY - Math.cos(shinAngle) * RIG.shin,
  };
}

describe('strideHz', () => {
  it('rises with speed but far less than proportionally', () => {
    const slow = strideHz(1.5);
    const fast = strideHz(8.5);
    expect(fast).toBeGreaterThan(slow);
    // If the cycle rate tracked speed, a 5.7x speed increase would give 5.7x the rate and
    // the figure would take comically fast tiny steps. Stride LENGTH grows too.
    expect(fast / slow).toBeLessThan(2.6);
  });

  it('stays in the range real humans run at', () => {
    expect(strideHz(0)).toBeGreaterThan(0.7);
    expect(strideHz(9.5)).toBeLessThan(3.2);
  });
});

describe('advancePhase', () => {
  it('wraps into a single cycle', () => {
    let ph = 0;
    for (let i = 0; i < 500; i++) ph = advancePhase(ph, 7, 1 / 60);
    expect(ph).toBeGreaterThanOrEqual(0);
    expect(ph).toBeLessThan(TAU);
  });

  it('is frame-rate independent to within a rounding error', () => {
    let a = 0;
    for (let i = 0; i < 120; i++) a = advancePhase(a, 6, 1 / 120);
    let b = 0;
    for (let i = 0; i < 30; i++) b = advancePhase(b, 6, 1 / 30);
    expect(Math.abs(a - b)).toBeLessThan(1e-9);
  });
});

describe('runPose', () => {
  const pose = emptyPose();

  it('keeps the legs half a cycle apart', () => {
    runPose(pose, 0, 6, 0, 1);
    const left = pose.hipPitch[0];
    runPose(pose, Math.PI, 6, 0, 1);
    const rightAtOpposite = pose.hipPitch[1];
    expect(Math.abs(left - rightAtOpposite)).toBeLessThan(1e-9);
  });

  it('swings the arms opposite the legs', () => {
    runPose(pose, Math.PI / 2, 7, 0, 1);
    // Left leg forward should mean left arm back.
    expect(Math.sign(pose.hipPitch[0])).toBe(-Math.sign(pose.shoulderPitch[0]));
  });

  it('never puts a foot through the ground', () => {
    for (let speed = 0; speed <= 9; speed += 0.5) {
      for (let i = 0; i < 64; i++) {
        runPose(pose, (i / 64) * TAU, speed, 0, 1);
        for (let leg = 0; leg < 2; leg++) {
          const foot = footOf(pose.hipY, pose.hipPitch[leg] as number, pose.kneeBend[leg] as number);
          // A little tolerance: the foot is a box with thickness, and the plant is
          // supposed to reach the ground.
          expect(foot.y).toBeGreaterThan(-0.16);
        }
      }
    }
  });

  it('plants at least one foot near the ground through the whole cycle', () => {
    // If both feet are airborne all cycle the figure is floating; if neither ever lands it
    // is skating. Over a full cycle at running speed, some foot must get near the floor.
    let lowest = Infinity;
    for (let i = 0; i < 64; i++) {
      runPose(pose, (i / 64) * TAU, 6, 0, 1);
      for (let leg = 0; leg < 2; leg++) {
        const foot = footOf(pose.hipY, pose.hipPitch[leg] as number, pose.kneeBend[leg] as number);
        lowest = Math.min(lowest, foot.y);
      }
    }
    expect(lowest).toBeLessThan(0.1);
  });

  it('bends the knees more and leans further the faster it goes', () => {
    runPose(pose, 0.7, 1.5, 0, 1);
    const slowLean = pose.lean;
    const slowKnee = Math.max(pose.kneeBend[0] as number, pose.kneeBend[1] as number);
    runPose(pose, 0.7, 8.5, 0, 1);
    expect(pose.lean).toBeGreaterThan(slowLean);
    expect(Math.max(pose.kneeBend[0] as number, pose.kneeBend[1] as number)).toBeGreaterThan(slowKnee);
  });

  it('settles to a still pose at a standstill', () => {
    runPose(pose, 1.234, 0, 0, 1);
    expect(Math.abs(pose.hipPitch[0] as number)).toBeLessThan(0.02);
    expect(Math.abs(pose.shoulderPitch[0] as number)).toBeLessThan(0.02);
    expect(pose.hipY).toBeCloseTo(RIG.hipHeight, 2);
  });

  it('rolls into a turn, and the other way for the other direction', () => {
    runPose(pose, 1, 6, 2, 1);
    const rollRight = pose.roll;
    runPose(pose, 1, 6, -2, 1);
    expect(Math.sign(rollRight)).toBe(-Math.sign(pose.roll));
  });

  it('produces finite angles across the whole parameter space', () => {
    for (const speed of [0, 0.4, 3, 6, 9.5, 20]) {
      for (const turn of [-6, 0, 6]) {
        for (const effort of [0, 0.5, 1]) {
          runPose(pose, 2.1, speed, turn, effort);
          const all = [
            pose.hipY, pose.lean, pose.roll, pose.twist, pose.headPitch,
            ...pose.hipPitch, ...pose.kneeBend, ...pose.anklePitch,
            ...pose.shoulderPitch, ...pose.elbowBend,
          ];
          for (const v of all) expect(Number.isFinite(v)).toBe(true);
          expect(pose.kneeBend[0]).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

describe('idlePose', () => {
  it('moves a little rather than standing frozen', () => {
    const a = emptyPose();
    const b = emptyPose();
    idlePose(a, 0, 1);
    idlePose(b, 1.4, 1);
    expect(a.hipY).not.toBe(b.hipY);
  });

  it('shows a tired player blowing harder than a fresh one', () => {
    const fresh = emptyPose();
    const spent = emptyPose();
    idlePose(fresh, 0.3, 1);
    idlePose(spent, 0.3, 0);
    expect(spent.lean).toBeGreaterThan(fresh.lean);
  });
});

describe('legIk', () => {
  const out: [number, number] = [0, 0];

  it('reaches a target inside its range', () => {
    for (const [fwd, down] of [[0.2, 0.7], [0.5, 0.5], [0, 0.8], [-0.3, 0.6]] as const) {
      legIk(out, fwd, down);
      const foot = footOf(0, out[0], out[1]);
      // footOf measures down from the hip, so y is negative going down.
      expect(Math.hypot(foot.z - fwd, -foot.y - down)).toBeLessThan(0.02);
    }
  });

  it('straightens rather than folding when the target is out of reach', () => {
    legIk(out, 0, LEG_LENGTH * 2);
    expect(out[1]).toBeLessThan(0.05);
  });

  it('always bends the knee the way a knee bends', () => {
    for (let f = -0.6; f <= 0.6; f += 0.1) {
      for (let d = 0.2; d <= 0.85; d += 0.1) {
        legIk(out, f, d);
        expect(out[1]).toBeGreaterThanOrEqual(0);
        expect(out[1]).toBeLessThan(Math.PI);
      }
    }
  });
});

describe('applyAction', () => {
  it('peaks in the middle and returns to the base pose at both ends', () => {
    const base = emptyPose();
    runPose(base, 1, 6, 0, 1);
    const start = { ...base, hipPitch: [...base.hipPitch] as [number, number], kneeBend: [...base.kneeBend] as [number, number] };

    const p0 = emptyPose();
    runPose(p0, 1, 6, 0, 1);
    applyAction(p0, 'kick', 0, 1);
    expect(p0.hipPitch[1]).toBeCloseTo(start.hipPitch[1] as number, 4);

    // Measured across the leg rather than on the hip alone. A swinging leg passes through
    // roughly the angle a kick asks the hip for, so at some phases the hip barely moves
    // while the knee snaps from fully folded to straight — which is the strike. Asking
    // "did the pose depart" instead of "did this one joint depart" tests the same thing
    // without depending on where in the cycle the strike happened to land.
    const pMid = emptyPose();
    runPose(pMid, 1, 6, 0, 1);
    applyAction(pMid, 'kick', 0.35, 1);
    const departure = Math.max(
      Math.abs((pMid.hipPitch[1] as number) - (start.hipPitch[1] as number)),
      Math.abs((pMid.kneeBend[1] as number) - (start.kneeBend[1] as number)),
    );
    expect(departure).toBeGreaterThan(0.3);

    const p1 = emptyPose();
    runPose(p1, 1, 6, 0, 1);
    applyAction(p1, 'kick', 1, 1);
    expect(p1.hipPitch[1]).toBeCloseTo(start.hipPitch[1] as number, 4);
  });

  it('gets a goalkeeper off the ground and onto his side for a dive', () => {
    const pose = emptyPose();
    runPose(pose, 0, 2, 0, 1);
    applyAction(pose, 'dive', 0.35, 0);
    expect(pose.hipY).toBeLessThan(RIG.hipHeight * 0.75);
    expect(Math.abs(pose.roll)).toBeGreaterThan(0.7);
  });

  it('mirrors a kick for a left-footed player', () => {
    const right = emptyPose();
    runPose(right, 0.4, 5, 0, 1);
    applyAction(right, 'kick', 0.35, 1);
    const left = emptyPose();
    runPose(left, 0.4, 5, 0, 1);
    applyAction(left, 'kick', 0.35, 0);
    expect(Math.sign(right.twist)).toBe(-Math.sign(left.twist));
  });

  it('keeps every action inside sane joint limits', () => {
    for (const action of ['kick', 'tackle', 'header', 'dive', 'celebrate', 'throw'] as const) {
      for (let t = 0; t <= 1; t += 0.05) {
        const pose = emptyPose();
        runPose(pose, t * TAU, 5, 0, 1);
        applyAction(pose, action, t, 0);
        expect(pose.hipY).toBeGreaterThan(0.2);
        expect(pose.hipY).toBeLessThan(1.6);
        for (const k of pose.kneeBend) {
          expect(k).toBeGreaterThanOrEqual(-0.05);
          expect(k).toBeLessThan(Math.PI);
        }
        expect(Math.abs(pose.roll)).toBeLessThan(2);
      }
    }
  });
});

describe('the plant', () => {
  it('spends more of the cycle on the ground walking than sprinting', () => {
    // Over 0.5 is a walk by definition (two feet down at once); under 0.5 is a run.
    expect(stanceFraction(1.3)).toBeGreaterThan(0.5);
    expect(stanceFraction(8.5)).toBeLessThan(0.4);
  });

  it('holds the stance foot still in the world while the body travels over it', () => {
    // The assertion the whole solver exists for. Walk the figure forward at its own speed
    // and measure where each planted foot actually is on the grass: if it slides, the
    // figure is skating, which no screenshot and no other test in this file can see.
    //
    // Per leg, not "whichever foot is lowest". At a walk both feet are down at once for a
    // quarter of the cycle, so the lowest foot swaps from the trailing one to the leading
    // one mid-stride — and measuring that swap reports half a stride of drift on a solver
    // that is not sliding at all.
    const pose = emptyPose();
    for (const speed of [1.4, 3.5, 6, 8.2]) {
      let worldZ = 0;
      let phase = 0;
      const dt = 1 / 120;
      const planted: (number | null)[] = [null, null];
      let drift = 0;
      let contacts = 0;
      for (let i = 0; i < 900; i++) {
        phase = advancePhase(phase, speed, dt);
        worldZ += speed * dt;
        runPose(pose, phase, speed, 0, 1);
        for (const leg of [0, 1] as const) {
          if (!isPlanted(phase, leg, speed)) {
            planted[leg] = null;
            continue;
          }
          const f = footOf(pose.hipY, pose.hipPitch[leg] as number, pose.kneeBend[leg] as number);
          const here = worldZ + f.z;
          // Against where this foot FIRST touched down, not against the previous frame.
          // Per-frame slip is tiny by construction at 120Hz, so a frame-to-frame bound
          // passes a foot that creeps a whole step over the course of one contact.
          const from = planted[leg];
          if (from !== null && from !== undefined) {
            drift = Math.max(drift, Math.abs(here - from));
            contacts++;
          } else {
            planted[leg] = here;
          }
        }
      }
      // There has to be a plant at all, or the assertion below is vacuous.
      expect(contacts, `speed ${speed} never planted`).toBeGreaterThan(100);
      // A planted foot should not move at all; a centimetre is rounding and the shortfall
      // where a leg is at the very limit of its reach. A sliding foot travels a step.
      expect(drift, `speed ${speed}`).toBeLessThan(0.01);
    }
  });
});

describe('keeperPose', () => {
  it('crouches lower and puts the hands up as he sets', () => {
    const loose = emptyPose();
    const set = emptyPose();
    keeperPose(loose, 0, 0);
    keeperPose(set, 0, 1);
    expect(set.hipY).toBeLessThan(loose.hipY);
    expect(set.kneeBend[0] as number).toBeGreaterThan(loose.kneeBend[0] as number);
    // Positive shoulder pitch is arms FORWARD — measured in world space by figure.test.ts.
    // This assertion used to say the opposite, and with it every keeper in the game set
    // himself with his hands behind his back.
    expect(set.shoulderPitch[0] as number).toBeGreaterThan(loose.shoulderPitch[0] as number);
  });

  it('stands lower than an outfield player at rest', () => {
    const idle = emptyPose();
    const keeper = emptyPose();
    idlePose(idle, 0, 1);
    keeperPose(keeper, 0, 1);
    expect(keeper.hipY).toBeLessThan(idle.hipY);
  });
});
