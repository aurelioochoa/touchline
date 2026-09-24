// Feints, tricks and touches: the ball-work poses, and where the ball goes during each.
//
// A trick is two things that have to agree — what the legs do, and where the ball is — so
// both live here, keyed by the same `k` (0..1 through the move). The pose overlays follow
// gait.ts's `applyAction` pattern: keyframed tracks, blended over whatever the figure was
// already doing by an envelope, so a stepover grows out of a run and settles back into it.
//
// The ball's path is an OFFSET from where it would normally sit at the carrier's feet, in
// the figure's own frame: `side` along its +X, `fwd` along its facing, `up` off the grass.
// The renderer adds it on top of the ordinary carry, which is why none of these paths has
// to end exactly at zero — the renderer's ball spring eases the ball back into the carry
// when the move is over, the same way it eases every other change of hands.
//
// Pure: no Three.js, no state. tricks.test.ts holds the choreography to its promises.

import { clamp01, lerp, TAU } from '../core/math.js';
import { SKILL_SECONDS } from '../sim/match/skills.js';
import type { SkillMove } from '../sim/match/types.js';
import { RIG, smooth, track, type Pose } from './gait.js';

/** The ball-work actions the renderer can play: the eight tricks, and the two first touches. */
export type BallWork = SkillMove | 'control' | 'chest' | 'wrongFooted';

export const BALL_WORK: readonly BallWork[] = [
  'bodyFeint', 'stepover', 'dragBack', 'cutInside', 'nutmeg', 'roulette', 'elastico', 'flick',
  'control', 'chest', 'wrongFooted',
];

export function isBallWork(a: string): a is BallWork {
  return (BALL_WORK as readonly string[]).includes(a);
}

/** Where the ball is relative to its ordinary carry, in the figure's frame. Metres. */
export interface BallOffset {
  side: number;
  fwd: number;
  up: number;
}

/** Which way a leg sits along the figure's X: leg 0 is on -X (figure.ts builds it so). */
function sideOfLeg(leg: 0 | 1): -1 | 1 {
  return leg === 0 ? -1 : 1;
}

/**
 * Overlay a trick on a pose. `foot` is the leg that does the work; the move goes toward
 * that leg's side and comes back across the other.
 */
export function applyBallWork(pose: Pose, move: BallWork, t: number, foot: 0 | 1): void {
  const k = clamp01(t);
  const env = smooth(k / 0.12) * smooth((1 - k) / 0.22);
  const work = foot;
  const stand: 0 | 1 = foot === 0 ? 1 : 0;
  const sg = sideOfLeg(foot);
  const set = (field: 'hipPitch' | 'kneeBend' | 'anklePitch' | 'hipRoll' | 'hipYaw' | 'shoulderPitch' | 'shoulderRoll' | 'elbowBend', i: 0 | 1, v: number, w = env) => {
    pose[field][i] = lerp(pose[field][i], v, w);
  };

  switch (move) {
    case 'bodyFeint': {
      // Drop the shoulder one way, carry the hips with it, and go the other. The dip is
      // the tell a defender buys: knees bent, weight fully on the fake side.
      const fake = -sg;
      pose.shift = lerp(pose.shift, track([[0, 0], [0.35, 0.16 * fake], [0.62, -0.12 * fake], [1, 0]], k), env);
      pose.roll = lerp(pose.roll, track([[0, 0], [0.35, 0.32 * fake], [0.62, -0.22 * fake], [1, 0]], k), env);
      pose.hipY = lerp(pose.hipY, RIG.hipHeight - track([[0, 0.02], [0.35, 0.1], [0.62, 0.05], [1, 0.02]], k), env);
      pose.lean = lerp(pose.lean, 0.22, env);
      pose.twist = lerp(pose.twist, track([[0, 0], [0.35, 0.3 * fake], [0.62, -0.2 * fake], [1, 0]], k), env);
      // The arm on the fake side swings out with the dip — it is half of what sells it.
      const fakeArm: 0 | 1 = fake === sideOfLeg(0) ? 0 : 1;
      set('shoulderRoll', fakeArm, track([[0, 0.1], [0.35, 0.75], [0.62, 0.3], [1, 0.1]], k));
      set('shoulderRoll', fakeArm === 0 ? 1 : 0, 0.35);
      for (const i of [0, 1] as const) set('kneeBend', i, track([[0, 0.3], [0.35, 0.75], [0.62, 0.5], [1, 0.3]], k));
      pose.headPitch = lerp(pose.headPitch, 0.3, env);
      break;
    }
    case 'stepover': {
      // The working leg circles OVER the ball from the inside out and plants wide; the body
      // follows it; then the other foot takes the ball away across the front.
      set('hipPitch', work, track([[0, 0.05], [0.18, 0.55], [0.34, 0.6], [0.5, 0.12], [1, 0.05]], k));
      set('kneeBend', work, track([[0, 0.3], [0.18, 1.1], [0.34, 0.85], [0.5, 0.35], [1, 0.3]], k));
      set('hipRoll', work, track([[0, 0], [0.16, -0.18], [0.34, 0.42], [0.52, 0.28], [0.75, 0], [1, 0]], k));
      set('anklePitch', work, track([[0, 0], [0.2, -0.4], [0.45, 0.1], [1, 0]], k));
      set('hipPitch', stand, track([[0, 0], [0.4, -0.12], [0.62, 0.45], [0.8, 0.1], [1, 0]], k));
      set('kneeBend', stand, track([[0, 0.3], [0.4, 0.55], [0.62, 0.5], [1, 0.3]], k));
      set('hipYaw', stand, track([[0, 0], [0.55, 0], [0.66, 0.7], [0.85, 0.2], [1, 0]], k));
      pose.shift = lerp(pose.shift, track([[0, 0], [0.45, 0.14 * sg], [0.78, -0.12 * sg], [1, 0]], k), env);
      pose.roll = lerp(pose.roll, track([[0, 0], [0.45, 0.28 * sg], [0.78, -0.2 * sg], [1, 0]], k), env);
      pose.hipY = lerp(pose.hipY, RIG.hipHeight - track([[0, 0.03], [0.45, 0.1], [1, 0.03]], k), env);
      pose.lean = lerp(pose.lean, 0.2, env);
      for (const i of [0, 1] as const) set('shoulderRoll', i, 0.5);
      pose.headPitch = lerp(pose.headPitch, 0.42, env);
      break;
    }
    case 'dragBack': {
      // Sole on the ball, pull it back under the body, and turn off it.
      set('hipPitch', work, track([[0, 0.05], [0.22, 0.62], [0.5, -0.25], [0.7, -0.1], [1, 0]], k));
      set('kneeBend', work, track([[0, 0.3], [0.22, 0.35], [0.5, 1.25], [0.7, 0.6], [1, 0.3]], k));
      // Toe up: the sole is what meets the ball.
      set('anklePitch', work, track([[0, 0], [0.22, 0.55], [0.5, 0.3], [0.7, 0], [1, 0]], k));
      set('kneeBend', stand, 0.55);
      pose.lean = lerp(pose.lean, track([[0, 0.1], [0.3, -0.12], [0.6, 0.18], [1, 0.1]], k), env);
      pose.yaw = lerp(pose.yaw, track([[0, 0], [0.45, 0], [0.72, 0.9 * sg], [1, 0.5 * sg]], k), env);
      for (const i of [0, 1] as const) set('shoulderRoll', i, 0.55);
      pose.headPitch = lerp(pose.headPitch, 0.45, env);
      break;
    }
    case 'cutInside': {
      // Shape to shoot — a real back-lift — and instead drag the ball back behind the
      // standing leg with the inside of the foot. The defender blocks a shot that never came.
      set('hipPitch', work, track([[0, 0.05], [0.25, -0.55], [0.45, 0.42], [0.62, -0.1], [1, 0]], k));
      set('kneeBend', work, track([[0, 0.3], [0.25, 1.7], [0.45, 0.55], [0.62, 0.9], [1, 0.3]], k));
      set('hipYaw', work, track([[0, 0], [0.4, 0.1], [0.55, 0.85], [0.75, 0.3], [1, 0]], k));
      set('hipPitch', stand, -0.1);
      set('kneeBend', stand, 0.5);
      pose.twist = lerp(pose.twist, track([[0, 0], [0.25, -0.35 * sg], [0.5, 0.1 * sg], [1, 0]], k), env);
      pose.yaw = lerp(pose.yaw, track([[0, 0], [0.45, 0], [0.7, -0.75 * sg], [1, -0.35 * sg]], k), env);
      pose.shift = lerp(pose.shift, track([[0, 0], [0.5, 0], [0.75, -0.12 * sg], [1, 0]], k), env);
      set('shoulderRoll', stand, track([[0, 0.2], [0.25, 0.95], [0.6, 0.5], [1, 0.2]], k));
      pose.headPitch = lerp(pose.headPitch, 0.35, env);
      break;
    }
    case 'nutmeg': {
      // A quick toe-poke through his legs, and away after it.
      set('hipPitch', work, track([[0, 0.05], [0.18, -0.3], [0.32, 0.55], [0.5, 0.2], [1, 0]], k));
      set('kneeBend', work, track([[0, 0.3], [0.18, 0.95], [0.32, 0.2], [0.5, 0.4], [1, 0.3]], k));
      set('anklePitch', work, track([[0, 0], [0.3, -0.45], [0.5, 0], [1, 0]], k));
      pose.lean = lerp(pose.lean, track([[0, 0.1], [0.32, 0.05], [0.6, 0.34], [1, 0.25]], k), env);
      pose.headPitch = lerp(pose.headPitch, 0.3, env);
      break;
    }
    case 'roulette': {
      // Sole on it, spin on the other foot, sole on it again with the other foot, and out
      // the far side: a full turn with the ball never leaving him.
      // Not weighted by the envelope: a turn scaled down on the way out would unwind. A
      // full turn ends where it started, so the hand-back to the sim's facing is seamless.
      pose.yaw = track([[0, 0], [0.12, 0], [0.88, TAU * sg], [1, TAU * sg]], k);
      set('hipPitch', work, track([[0, 0.05], [0.15, 0.5], [0.3, -0.1], [1, 0]], k));
      set('anklePitch', work, track([[0, 0], [0.15, 0.5], [0.3, 0], [1, 0]], k));
      set('hipPitch', stand, track([[0, 0], [0.45, 0], [0.58, 0.45], [0.72, -0.1], [1, 0]], k));
      set('anklePitch', stand, track([[0, 0], [0.5, 0], [0.58, 0.5], [0.72, 0], [1, 0]], k));
      for (const i of [0, 1] as const) {
        set('kneeBend', i, 0.55);
        set('shoulderRoll', i, 0.8);
        set('elbowBend', i, 0.9);
      }
      pose.hipY = lerp(pose.hipY, RIG.hipHeight - 0.08, env);
      pose.lean = lerp(pose.lean, 0.16, env);
      pose.headPitch = lerp(pose.headPitch, 0.4, env);
      break;
    }
    case 'elastico': {
      // Outside of the foot pushes it one way; before it has gone, the inside snaps it back
      // the other. All in the ankle and the hip — the rest of him barely moves, which is
      // exactly why it works.
      set('hipYaw', work, track([[0, 0], [0.3, -0.65], [0.52, 0.85], [0.8, 0.2], [1, 0]], k));
      set('hipRoll', work, track([[0, 0], [0.3, 0.38], [0.52, -0.22], [0.8, 0], [1, 0]], k));
      set('hipPitch', work, track([[0, 0.05], [0.3, 0.35], [0.52, 0.3], [1, 0]], k));
      set('kneeBend', work, 0.55);
      set('kneeBend', stand, 0.6);
      pose.shift = lerp(pose.shift, track([[0, 0], [0.3, 0.1 * sg], [0.6, -0.16 * sg], [1, 0]], k), env);
      pose.roll = lerp(pose.roll, track([[0, 0], [0.3, 0.22 * sg], [0.6, -0.3 * sg], [1, 0]], k), env);
      for (const i of [0, 1] as const) set('shoulderRoll', i, 0.6);
      pose.headPitch = lerp(pose.headPitch, 0.38, env);
      break;
    }
    case 'flick': {
      // The rainbow flick: the ball rolled up the back of the standing leg with the heel
      // of the other, and flicked over both their heads.
      set('hipPitch', work, track([[0, 0.05], [0.18, 0.3], [0.34, -0.72], [0.5, -0.2], [1, 0]], k));
      set('kneeBend', work, track([[0, 0.3], [0.18, 0.4], [0.34, 2.05], [0.5, 1.0], [1, 0.3]], k));
      set('anklePitch', work, track([[0, 0], [0.34, -0.6], [0.5, 0], [1, 0]], k));
      set('kneeBend', stand, track([[0, 0.3], [0.3, 0.7], [0.4, 0.2], [0.6, 0.4], [1, 0.3]], k));
      pose.hipY = lerp(pose.hipY, RIG.hipHeight + track([[0, 0], [0.3, -0.06], [0.4, 0.1], [0.55, 0], [1, 0]], k), env);
      pose.lean = lerp(pose.lean, track([[0, 0.1], [0.34, 0.38], [0.6, 0.05], [1, 0.1]], k), env);
      for (const i of [0, 1] as const) set('shoulderRoll', i, 0.65);
      // He looks up for it as it comes over.
      pose.headPitch = lerp(pose.headPitch, track([[0, 0.3], [0.4, 0.2], [0.6, -0.5], [1, 0]], k), env);
      break;
    }
    case 'control': {
      // The first touch: the inside of the foot goes out to meet the ball and gives with it,
      // the way you catch an egg.
      set('hipYaw', work, track([[0, 0], [0.3, 0.8], [1, 0.3]], k));
      set('hipPitch', work, track([[0, 0.05], [0.3, 0.5], [0.6, 0.1], [1, 0.05]], k));
      set('kneeBend', work, track([[0, 0.3], [0.3, 0.45], [0.6, 0.6], [1, 0.3]], k));
      set('kneeBend', stand, 0.42);
      for (const i of [0, 1] as const) set('shoulderRoll', i, 0.4);
      pose.lean = lerp(pose.lean, 0.08, env);
      pose.headPitch = lerp(pose.headPitch, 0.55, env);
      break;
    }
    case 'chest': {
      // A high ball killed on the chest: lean back under it, arms wide, and let it drop.
      pose.lean = lerp(pose.lean, track([[0, 0], [0.3, -0.32], [0.6, -0.1], [1, 0.05]], k), env);
      pose.chest = lerp(pose.chest, track([[0, 0], [0.3, -0.35], [0.6, 0], [1, 0]], k), env);
      for (const i of [0, 1] as const) {
        set('shoulderRoll', i, 0.95);
        set('shoulderPitch', i, 0.3);
        set('elbowBend', i, 0.7);
        set('kneeBend', i, 0.5);
      }
      pose.headPitch = lerp(pose.headPitch, track([[0, 0], [0.3, 0.2], [0.6, 0.55], [1, 0.3]], k), env);
      break;
    }
    case 'wrongFooted': {
      // The defender who bought it: weight thrown the wrong way, a stagger, arms out to
      // catch himself. `foot` here is the side he was sold.
      pose.shift = lerp(pose.shift, track([[0, 0], [0.35, 0.22 * sg], [0.7, 0.18 * sg], [1, 0]], k), env);
      pose.roll = lerp(pose.roll, track([[0, 0], [0.35, 0.45 * sg], [0.7, 0.3 * sg], [1, 0]], k), env);
      pose.hipY = lerp(pose.hipY, RIG.hipHeight - track([[0, 0.02], [0.35, 0.16], [0.7, 0.1], [1, 0.02]], k), env);
      set('hipRoll', work, track([[0, 0], [0.35, 0.4], [0.7, 0.3], [1, 0]], k));
      set('kneeBend', work, 0.8);
      set('kneeBend', stand, 0.5);
      for (const i of [0, 1] as const) set('shoulderRoll', i, track([[0, 0.1], [0.35, 1.0], [0.7, 0.7], [1, 0.1]], k));
      pose.headYaw = lerp(pose.headYaw, pose.headYaw + track([[0, 0], [0.5, 0], [0.8, -0.9 * sg], [1, 0]], k), env);
      break;
    }
  }
}

/**
 * The ball during a trick, relative to its ordinary carry. `out` is written and returned.
 * Moves that do not move the ball (the first touches, the defender) return zero.
 */
export function ballWorkOffset(out: BallOffset, move: BallWork, t: number, foot: 0 | 1): BallOffset {
  const k = clamp01(t);
  const sg = sideOfLeg(foot);
  out.side = 0;
  out.fwd = 0;
  out.up = 0;
  switch (move) {
    case 'bodyFeint':
      // It stays put through the dip and is taken away on the outside of the other foot.
      out.side = track([[0, 0], [0.45, 0], [0.75, 0.3 * sg], [1, 0.2 * sg]], k);
      out.fwd = track([[0, 0], [0.4, -0.12], [0.75, 0.15], [1, 0]], k);
      break;
    case 'stepover':
      // Under him while the leg goes round it, then across and away with the other foot.
      out.fwd = track([[0, 0], [0.3, -0.2], [0.55, -0.2], [0.85, 0.2], [1, 0.1]], k);
      out.side = track([[0, 0], [0.55, 0], [0.85, -0.35 * sg], [1, -0.25 * sg]], k);
      break;
    case 'dragBack':
      out.fwd = track([[0, 0], [0.22, 0.12], [0.5, -0.55], [0.75, -0.35], [1, -0.1]], k);
      out.side = track([[0, 0], [0.5, 0], [0.75, 0.25 * sg], [1, 0.2 * sg]], k);
      break;
    case 'cutInside':
      // Behind the standing leg and out the other side of him.
      out.fwd = track([[0, 0], [0.4, 0.1], [0.62, -0.25], [0.85, 0], [1, 0]], k);
      out.side = track([[0, 0], [0.45, 0.04 * sg], [0.72, -0.42 * sg], [1, -0.3 * sg]], k);
      break;
    case 'nutmeg':
      // Poked well ahead — through where the defender's legs are — and run on to.
      out.fwd = track([[0, 0], [0.28, 0], [0.62, 1.7], [0.85, 1.5], [1, 0.9]], k);
      break;
    case 'roulette': {
      // Kept under him the whole way round, drawing a small circle as each sole takes it.
      const turn = track([[0, 0], [0.12, 0], [0.88, 1], [1, 1]], k);
      const close = track([[0, 0], [0.12, -0.32], [0.88, -0.32], [1, 0]], k);
      out.fwd = close + Math.cos(turn * TAU) * 0.12 - 0.12;
      out.side = Math.sin(turn * TAU) * 0.14 * sg;
      break;
    }
    case 'elastico':
      out.side = track([[0, 0], [0.3, 0.3 * sg], [0.55, -0.34 * sg], [0.8, -0.3 * sg], [1, -0.18 * sg]], k);
      out.fwd = track([[0, 0], [0.3, 0.05], [0.8, 0.15], [1, 0]], k);
      break;
    case 'flick':
      // Between the feet, up the back of the leg, and over the top of his head.
      out.fwd = track([[0, 0], [0.2, -0.38], [0.36, -0.6], [0.6, 0.25], [0.88, 1.6], [1, 1.3]], k);
      out.up = track([[0, 0], [0.25, 0], [0.36, 0.3], [0.58, 2.5], [0.8, 1.3], [0.95, 0.1], [1, 0]], k);
      break;
    default:
      break;
  }
  return out;
}

/** How long each ball-work action plays, in seconds. The tricks use the sim's own table. */
export function ballWorkSeconds(move: BallWork): number {
  if (move === 'control') return 0.36;
  if (move === 'chest') return 0.55;
  if (move === 'wrongFooted') return 0.85;
  return SKILL_SECONDS[move];
}

/** Figure-frame offset → sim coordinates, for a figure facing `facing` (sim convention). */
export function offsetToSim(o: BallOffset, facing: number, out: { x: number; y: number }): void {
  // Forward is (cos f, sin f); the figure's +X, measured in the scene, is (sin f, -cos f).
  const c = Math.cos(facing);
  const s = Math.sin(facing);
  out.x = c * o.fwd + s * o.side;
  out.y = s * o.fwd - c * o.side;
}
