// The gait solver: what a running figure's limbs are doing at any instant.
//
// This is the piece design §12 called the largest technical risk in the game — no game in
// this repo has ever animated a humanoid, and there is no skeleton, no animation clip and
// no asset file to fall back on. What there is instead is the observation that a walk and
// a run are cyclic, and that the cycle is describable in closed form.
//
// Deliberately pure: no Three.js, no scene, no state beyond what is passed in. That is
// what lets the whole thing be unit-tested (gait.test.ts) rather than only ever judged by
// squinting at a screenshot.
//
// Model space, per figure: +Z is forward, +Y is up, origin at the feet.

import { clamp, clamp01, invLerp, lerp, TAU, wrapAngle } from '../core/math.js';

/** Segment lengths in metres, for a figure about 1.8m tall. */
export const RIG = {
  hipHeight: 0.92,
  thigh: 0.44,
  shin: 0.42,
  footLength: 0.24,
  torso: 0.52,
  neck: 0.08,
  headRadius: 0.115,
  shoulderWidth: 0.42,
  hipWidth: 0.24,
  upperArm: 0.3,
  forearm: 0.28,
} as const;

export const LEG_LENGTH = RIG.thigh + RIG.shin;

/** Height of the ankle joint above the grass when the foot is planted flat. */
export const ANKLE_HEIGHT = 0.065;
/**
 * Hip-to-ankle distance standing. Deliberately a hair under LEG_LENGTH, so a standing leg
 * is very nearly straight but never locked — and so `hipY` at a standstill comes out at
 * exactly `RIG.hipHeight` rather than at whatever the geometry happens to give.
 */
const HIP_REST = RIG.hipHeight - ANKLE_HEIGHT;

/**
 * What fraction of the stride cycle each foot spends on the ground.
 *
 * This is the number that separates a walk from a run and it is not a stylistic choice: a
 * walk has two feet down at once (duty factor over 0.5, hence double support), and a run
 * by definition does not (under 0.5, hence a flight phase). Sprinters are near 0.22.
 */
export function stanceFraction(speed: number): number {
  return lerp(0.62, 0.24, clamp01(invLerp(0.4, 8.6, speed)));
}

/**
 * Is this leg's foot on the ground at this point in the cycle?
 *
 * Exported because it is the solver's own answer to a question a test would otherwise
 * have to guess at from the foot's height — and a foot 10mm off the grass in early swing
 * is already travelling forward at twice the body's speed, so height alone reads a
 * perfectly good solver as a sliding one.
 */
export function isPlanted(phase: number, leg: 0 | 1, speed: number): boolean {
  const phi = wrapAngle(phase + (leg === 0 ? 0 : Math.PI));
  return Math.abs(phi) <= Math.PI * stanceFraction(speed);
}

/** Where every joint of one figure is this frame, in model space. */
export interface Pose {
  /** Pelvis centre. Bobs and leans; everything else hangs off it. */
  hipY: number;
  /** Forward/back lean in radians, positive = leaning into the run. */
  lean: number;
  /** Sideways roll, used when turning hard. */
  roll: number;
  /** Torso twist against the hips — the counter-rotation that sells a run. */
  twist: number;
  /** Per-leg joint angles, radians. Index 0 = left, 1 = right. */
  hipPitch: [number, number];
  kneeBend: [number, number];
  anklePitch: [number, number];
  /** Per-arm joint angles. */
  shoulderPitch: [number, number];
  elbowBend: [number, number];
  /** Head pitch, kept near level however much the body is doing. Positive nods DOWN. */
  headPitch: number;
  /**
   * Arm abduction per arm, radians: positive takes the arm OUT from the body. Balance on a
   * strike, the aeroplane, hands on the head — none of them is expressible as a swing.
   */
  shoulderRoll: [number, number];
  /** Leg abduction per leg, positive = out. A keeper's wide set and a slide need it. */
  hipRoll: [number, number];
  /** Leg turn-out per leg, positive = toe out. A side-foot pass is this and nothing else. */
  hipYaw: [number, number];
  /**
   * Which way the LEGS are running, relative to where the chest faces, radians.
   *
   * A footballer rarely runs exactly where he looks: he jockeys sideways, backpedals, and
   * turns his hips before his shoulders. Without this the stride is always along the chest,
   * so a defender shuffling across the box glides sideways on legs that run forward.
   */
  legYaw: number;
  /** Head turn, radians, positive to the figure's own left. Mostly: watching the ball. */
  headYaw: number;
  /** Extra bend in the upper spine, positive forward. Hunched blowing, arched celebrating. */
  chest: number;
  /**
   * An extra turn of the WHOLE figure on top of the sim's facing, radians, positive toward
   * the figure's own +X. Zero except inside a trick: a roulette is a full turn the engine
   * never sees, because to the engine the carrier is still running the same way.
   */
  yaw: number;
  /**
   * A sideways shift of the whole body along the figure's own X, metres. A body feint is a
   * weight transfer, and a weight transfer the hips do not travel with is a head wobble.
   */
  shift: number;
}

export function emptyPose(): Pose {
  return {
    hipY: RIG.hipHeight,
    lean: 0,
    roll: 0,
    twist: 0,
    hipPitch: [0, 0],
    kneeBend: [0, 0],
    anklePitch: [0, 0],
    shoulderPitch: [0, 0],
    elbowBend: [0, 0],
    headPitch: 0,
    shoulderRoll: [0, 0],
    hipRoll: [0, 0],
    hipYaw: [0, 0],
    legYaw: 0,
    headYaw: 0,
    chest: 0,
    yaw: 0,
    shift: 0,
  };
}

/** Copy one pose into another, field by field. The hot path allocates nothing. */
export function copyPose(out: Pose, from: Pose): Pose {
  out.hipY = from.hipY;
  out.lean = from.lean;
  out.roll = from.roll;
  out.twist = from.twist;
  out.headPitch = from.headPitch;
  out.legYaw = from.legYaw;
  out.headYaw = from.headYaw;
  out.chest = from.chest;
  out.yaw = from.yaw;
  out.shift = from.shift;
  for (let i = 0; i < 2; i++) {
    out.hipPitch[i] = from.hipPitch[i] as number;
    out.kneeBend[i] = from.kneeBend[i] as number;
    out.anklePitch[i] = from.anklePitch[i] as number;
    out.shoulderPitch[i] = from.shoulderPitch[i] as number;
    out.elbowBend[i] = from.elbowBend[i] as number;
    out.shoulderRoll[i] = from.shoulderRoll[i] as number;
    out.hipRoll[i] = from.hipRoll[i] as number;
    out.hipYaw[i] = from.hipYaw[i] as number;
  }
  return out;
}

/**
 * `out = lerp(out, to, t)`, joint by joint.
 *
 * What removes the pop between locomotion and standing. The run cycle, the idle and the
 * keeper's set are three different functions, and switching between them on a speed
 * threshold snapped every limb at once — the loudest single glitch on the pitch, because
 * it happened to all twenty-two players every time play stopped.
 */
export function blendPose(out: Pose, to: Pose, t: number): Pose {
  const k = clamp01(t);
  if (k <= 0) return out;
  out.hipY = lerp(out.hipY, to.hipY, k);
  out.lean = lerp(out.lean, to.lean, k);
  out.roll = lerp(out.roll, to.roll, k);
  out.twist = lerp(out.twist, to.twist, k);
  out.headPitch = lerp(out.headPitch, to.headPitch, k);
  out.legYaw = lerp(out.legYaw, to.legYaw, k);
  out.headYaw = lerp(out.headYaw, to.headYaw, k);
  out.chest = lerp(out.chest, to.chest, k);
  out.yaw = lerp(out.yaw, to.yaw, k);
  out.shift = lerp(out.shift, to.shift, k);
  for (let i = 0; i < 2; i++) {
    out.hipPitch[i] = lerp(out.hipPitch[i] as number, to.hipPitch[i] as number, k);
    out.kneeBend[i] = lerp(out.kneeBend[i] as number, to.kneeBend[i] as number, k);
    out.anklePitch[i] = lerp(out.anklePitch[i] as number, to.anklePitch[i] as number, k);
    out.shoulderPitch[i] = lerp(out.shoulderPitch[i] as number, to.shoulderPitch[i] as number, k);
    out.elbowBend[i] = lerp(out.elbowBend[i] as number, to.elbowBend[i] as number, k);
    out.shoulderRoll[i] = lerp(out.shoulderRoll[i] as number, to.shoulderRoll[i] as number, k);
    out.hipRoll[i] = lerp(out.hipRoll[i] as number, to.hipRoll[i] as number, k);
    out.hipYaw[i] = lerp(out.hipYaw[i] as number, to.hipYaw[i] as number, k);
  }
  return out;
}

/**
 * How fast the legs cycle at a given speed.
 *
 * Not linear, and that matters more than it sounds. Stride LENGTH grows with speed as well
 * as stride rate, so a figure whose cycle rate is proportional to speed takes comically
 * fast tiny steps at a sprint. Real humans run at roughly 1.4 strides/second walking and
 * 2.6 sprinting, over a fourfold change in speed.
 */
export function strideHz(speed: number): number {
  return lerp(0.85, 2.75, clamp01(invLerp(0, 9.5, speed)) ** 0.55);
}

/** Advance the cycle phase. Returned wrapped into [0, TAU). */
export function advancePhase(phase: number, speed: number, dt: number): number {
  const next = phase + strideHz(speed) * TAU * dt;
  return next % TAU;
}

/** Scratch for the stance solver, so the hot path allocates nothing. */
const ikScratch: [number, number] = [0, 0];

/**
 * Build the pose for one figure.
 *
 * `phase` is where in the stride cycle it is, `speed` how fast it is travelling, `turn`
 * how hard it is turning (radians/second, signed), and `effort` 0..1 how hard it is
 * working — a tired player at the same speed carries himself differently.
 */
export function runPose(out: Pose, phase: number, speed: number, turn: number, effort: number): Pose {
  const s = clamp01(invLerp(0.15, 8.6, speed));
  // Below a walk, blend the whole cycle out rather than letting a stationary figure
  // shuffle on the spot.
  const moving = clamp01(invLerp(0.05, 0.9, speed));

  // --- the plant ---------------------------------------------------------------
  //
  // The first version drove both legs from a sinusoid all the way round the cycle, which
  // means the stance foot swings backward at whatever rate the sine says rather than at
  // the rate the body is actually travelling. The two do not agree, and the difference is
  // the foot sliding over the grass — the loudest tell that a figure is a puppet.
  //
  // So the foot is the thing that is authored, and the joints are solved from it. Through
  // the stance it is pinned to a point on the ground and the body passes over it; through
  // the swing it travels from where it toed off to where it will land, lifting on the way.
  // The two halves share their endpoints exactly, which is why there is no cross-fade
  // between them: a blend was tried first, and blending a swung leg into a solved one
  // reintroduced a tenth of a metre of skate in the third of the cycle it covered.
  //
  // How far the foot travels under the body is NOT the stride length — it is
  // `speed × how long the foot is down`. Getting that wrong is what makes a sprinter reach
  // a metre in front of himself for a ball he is already past.
  const stanceFrac = stanceFraction(speed);
  const stanceHalf = Math.PI * stanceFrac;
  const swingSpan = Math.max(TAU - 2 * stanceHalf, 1e-3);
  // A moving leg never fully extends, so the hips ride a little lower the faster he goes.
  const legReach = HIP_REST * (1 - 0.06 * s * moving);
  const halfTravel =
    Math.min((speed * stanceFrac) / (2 * strideHz(speed)), legReach * 0.82) * moving;
  const lift = lerp(0.06, 0.24, s) * moving;

  const phi: [number, number] = [wrapAngle(phase), wrapAngle(phase + Math.PI)];

  // The hips ride on whichever leg is nearest its plant, and their height is not a free
  // parameter: with a foot pinned and a leg of fixed length, the hip is as high as that
  // triangle allows — highest over the plant, lowest as the foot reaches away. That is
  // where a walk's bob comes from, and deriving it beats tuning a sine to imitate it.
  const nearest = Math.abs(phi[0] as number) <= Math.abs(phi[1] as number) ? 0 : 1;
  const near = phi[nearest] as number;
  const uNear = clamp(near / Math.max(stanceHalf, 1e-4), -1, 1);
  const fwdNear = -uNear * halfTravel;
  let hips = ANKLE_HEIGHT + Math.sqrt(Math.max(legReach * legReach - fwdNear * fwdNear, 0.01));
  const away = Math.abs(near);
  if (away > stanceHalf) {
    // Both feet are off the ground: he is airborne, so let the body arc.
    const flight = clamp01((away - stanceHalf) / Math.max(Math.PI / 2 - stanceHalf, 1e-3));
    hips += lerp(0, 0.05, s) * flight;
  }
  out.hipY = lerp(RIG.hipHeight, hips, moving);
  const standing = out.hipY - ANKLE_HEIGHT;

  /** Each foot's forward offset as a fraction of half a step. Drives the arms too. */
  const fwdNorm: [number, number] = [0, 0];

  for (let leg = 0; leg < 2; leg++) {
    const p = phi[leg] as number;
    let fwd: number;
    let down = standing;
    let ankle: number;

    if (Math.abs(p) <= stanceHalf) {
      // On the ground. The foot is fixed; the hip and knee are whatever that requires.
      const u = p / Math.max(stanceHalf, 1e-4);
      fwd = -u * halfTravel;
      legIk(ikScratch, fwd, down);
      // Flat on the grass, plus a heel-first landing and a toe-down push off.
      ankle = -((ikScratch[0] as number) - (ikScratch[1] as number)) + lerp(0.2, -0.42, (u + 1) / 2);
    } else {
      // In the air, travelling from the toe-off point to the landing point. `v` is 0 at
      // the instant the toe leaves and 1 at the instant the heel arrives, so the swing
      // begins and ends exactly where the stance left off.
      let d = p - stanceHalf;
      if (d < 0) d += TAU;
      const v = clamp01(d / swingSpan);
      const e = smooth(v);
      fwd = lerp(-halfTravel, halfTravel, e);
      down = Math.max(down - lift * Math.sin(Math.PI * v), 0.12);
      legIk(ikScratch, fwd, down);
      ankle = -((ikScratch[0] as number) - (ikScratch[1] as number)) * 0.35 + lerp(-0.35, 0.22, e);
    }

    fwdNorm[leg] = halfTravel > 1e-4 ? fwd / halfTravel : 0;
    // Fade the whole solved leg out below a walk, or a figure standing on the spot adopts
    // the slightly-bent-hip pose the solver gives for a foot directly underneath him.
    out.hipPitch[leg] = (ikScratch[0] as number) * moving;
    out.kneeBend[leg] = lerp(0.12, ikScratch[1] as number, moving);
    out.anklePitch[leg] = ankle * moving;
  }

  // Arms swing opposite the legs and get more bent the faster he goes. Driven off the same
  // foot offsets rather than off the phase, so "opposite" is true by construction instead
  // of by two sinusoids agreeing about a convention.
  //
  // The swing is not symmetric about hanging: a runner's hand comes up to about chest
  // height in front and only a little way behind the hip, so the whole arc is biased
  // forward, and more so at a sprint. A symmetric swing is a pendulum, not a runner.
  const armAmp = lerp(0.3, 0.95, s) * moving;
  const armBias = lerp(0.05, 0.28, s) * moving;
  const elbow = lerp(0.35, 1.55, s);
  for (let arm = 0; arm < 2; arm++) {
    const opposite = -(fwdNorm[arm] as number);
    out.shoulderPitch[arm] = opposite * armAmp + armBias;
    // The forearm pumps: tighter on the way forward, opening on the way back.
    out.elbowBend[arm] = elbow + opposite * 0.3 * moving;
    // Elbows out a touch at speed, and a little more as the arm drives back.
    out.shoulderRoll[arm] = (0.04 + 0.1 * s + Math.max(0, -opposite) * 0.08 * s) * moving;
    out.hipRoll[arm] = 0;
    out.hipYaw[arm] = 0;
  }

  // Lean into the run, and into the turn. Positive lean is FORWARD in figure.ts; for the
  // project's first months it was applied with the wrong sign and every sprinter on the
  // pitch leaned back, which is the posture of somebody braking.
  out.lean = lerp(0.04, 0.3, s) * lerp(0.85, 1.15, effort);
  // Into the turn. A positive turn rate swings the heading toward the figure's left, which
  // figure.ts puts on +X, and a positive roll tips the shoulders the same way. This sign was
  // the other way round, leaning every runner OUT of his turn, until it was measured.
  out.roll = clamp(turn * 0.16, -0.45, 0.45) * moving;
  // Shoulders counter-rotate against the hips. This is the single cue that most makes a
  // procedural run read as a run rather than a puppet on strings.
  out.twist = -Math.sin(phase) * lerp(0.06, 0.3, s) * moving;
  out.chest = lerp(0, 0.08, s) * moving;
  // The head stays level whatever the body is doing: it cancels the lean and the chest.
  out.headPitch = -(out.lean + out.chest) * 0.8;
  out.headYaw = 0;
  out.legYaw = 0;
  out.yaw = 0;
  out.shift = 0;
  return out;
}

/**
 * A figure standing still, breathing slightly, so nobody on the pitch is a statue.
 *
 * `style` picks one of a few ways of standing — weight on one leg, hands on the hips when
 * blown — from the player's id, so a stoppage is eleven people waiting rather than eleven
 * copies of one.
 */
export function idlePose(out: Pose, t: number, effort: number, style = 0): Pose {
  const breathe = Math.sin(t * 1.7) * 0.012;
  // Blowing hard after a sprint: deeper, faster, and bent further forward.
  const puff = clamp01(1 - effort);
  const shift = (style & 1) === 0 ? 1 : -1;
  // A slow weight shift from one leg to the other, over about eight seconds.
  const weight = Math.sin(t * 0.75 + style) * 0.5 + 0.5;
  out.hipY = RIG.hipHeight - 0.025 + breathe * (1 + puff * 2);
  out.lean = 0.04 + puff * 0.2;
  out.chest = 0.03 + puff * 0.18 + breathe * 2;
  out.roll = shift * (weight - 0.5) * 0.07;
  out.twist = Math.sin(t * 0.9) * 0.03;
  out.legYaw = 0;
  out.yaw = 0;
  out.shift = 0;
  for (let i = 0; i < 2; i++) {
    const loaded = i === 0 ? weight : 1 - weight;
    out.hipPitch[i] = Math.sin(t * 0.8 + i) * 0.03 + (1 - loaded) * 0.08;
    // The unloaded leg softens; the loaded one straightens.
    out.kneeBend[i] = 0.08 + (1 - loaded) * 0.16 + puff * 0.12;
    out.anklePitch[i] = -(1 - loaded) * 0.08;
    out.hipRoll[i] = 0.06;
    out.hipYaw[i] = 0.12;
    out.shoulderPitch[i] = Math.sin(t * 0.85 + i * 2) * 0.05 + 0.05;
    out.elbowBend[i] = 0.22 + puff * 0.3;
    out.shoulderRoll[i] = 0.05;
  }
  // Hands on the hips: the one pose that says "knackered" from the halfway line.
  if (style % 3 === 0 && puff > 0.25) {
    const k = smooth((puff - 0.25) / 0.3);
    for (let i = 0; i < 2; i++) {
      out.shoulderRoll[i] = lerp(out.shoulderRoll[i] as number, 0.62, k);
      out.shoulderPitch[i] = lerp(out.shoulderPitch[i] as number, -0.28, k);
      out.elbowBend[i] = lerp(out.elbowBend[i] as number, 1.75, k);
    }
  }
  out.headPitch = -out.lean * 0.6 + puff * 0.2;
  out.headYaw = 0;
  return out;
}

/**
 * A goalkeeper waiting. Low, wide and hands up — which is what says "keeper" from the
 * halfway line as reliably as the different shirt does, and costs nothing.
 */
export function keeperPose(out: Pose, t: number, ready: number): Pose {
  const set = clamp01(ready);
  const sway = Math.sin(t * 1.3) * 0.02;
  // On his toes when set: a keeper bounces, he does not stand.
  const bounce = Math.abs(Math.sin(t * 5.2)) * 0.018 * set;
  out.hipY = RIG.hipHeight - lerp(0.06, 0.2, set) + bounce;
  out.lean = lerp(0.1, 0.28, set);
  out.chest = lerp(0.02, 0.12, set);
  out.roll = 0;
  out.twist = Math.sin(t * 0.7) * 0.04;
  out.legYaw = 0;
  out.yaw = 0;
  out.shift = 0;
  for (let i = 0; i < 2; i++) {
    out.hipPitch[i] = lerp(0.05, 0.3, set) + sway * (i === 0 ? 1 : -1);
    out.kneeBend[i] = lerp(0.22, 0.72, set);
    out.anklePitch[i] = lerp(0, -0.25, set);
    // Feet wider than the shoulders, toes a little out.
    out.hipRoll[i] = lerp(0.06, 0.22, set);
    out.hipYaw[i] = lerp(0.1, 0.25, set);
    // Hands up and IN FRONT, palms toward the ball, elbows out. Positive shoulder pitch is
    // forward: this used to be negative, and every keeper in the game set himself with his
    // hands behind his back.
    out.shoulderPitch[i] = lerp(0.3, 0.85, set) + sway;
    out.elbowBend[i] = lerp(0.55, 1.1, set);
    out.shoulderRoll[i] = lerp(0.12, 0.42, set);
  }
  out.headPitch = -(out.lean + out.chest) * 0.8;
  out.headYaw = 0;
  return out;
}

/**
 * Two-bone inverse kinematics: given a hip and a target for the foot, what are the hip and
 * knee angles? Used by the action poses, where the foot has to be somewhere specific — on
 * the ball, planted for a tackle — rather than wherever the cycle put it.
 *
 * `out` receives [hipPitch, kneeBend]. If the target is out of reach the leg straightens
 * and points at it, which is the right failure: a leg that cannot reach should look like a
 * leg stretching for something, not fold up.
 */
export function legIk(out: [number, number], reachForward: number, reachDown: number): void {
  const d = Math.hypot(reachForward, reachDown);
  const a = RIG.thigh;
  const b = RIG.shin;
  const maxReach = a + b - 1e-4;
  const dist = Math.min(d, maxReach);
  // Law of cosines for the knee's interior angle, converted to a bend from straight.
  const cosKnee = clamp((a * a + b * b - dist * dist) / (2 * a * b), -1, 1);
  const knee = Math.PI - Math.acos(cosKnee);
  // Angle of the whole leg from vertical, plus the offset of the thigh within the triangle.
  const cosThigh = clamp((a * a + dist * dist - b * b) / (2 * a * Math.max(dist, 1e-6)), -1, 1);
  const toTarget = Math.atan2(reachForward, Math.max(reachDown, 1e-6));
  out[0] = toTarget + Math.acos(cosThigh);
  out[1] = knee;
}

/** Named one-off actions the match engine can trigger, blended over the run cycle. */
export type ActionPose =
  | 'kick'
  | 'pass'
  | 'tackle'
  | 'header'
  | 'dive'
  | 'catch'
  | 'celebrate'
  | 'cheer'
  | 'dejected'
  | 'fall'
  | 'throw';

/** How many ways a scorer can celebrate. `applyAction`'s `variant` picks one. */
export const CELEBRATIONS = 4;

/** Piecewise-linear keyframes: `keys` are [t, value] pairs with ascending t. */
export function track(keys: readonly (readonly [number, number])[], t: number): number {
  const first = keys[0] as readonly [number, number];
  if (t <= first[0]) return first[1];
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i] as readonly [number, number];
    if (t <= b[0]) {
      const a = keys[i - 1] as readonly [number, number];
      return lerp(a[1], b[1], smooth((t - a[0]) / Math.max(b[0] - a[0], 1e-6)));
    }
  }
  return (keys[keys.length - 1] as readonly [number, number])[1];
}

/**
 * Overlay an action on top of a locomotion pose. `t` runs 0..1 across the action.
 *
 * Blended rather than replacing, and weighted by an envelope over t, so an action grows out
 * of whatever the player was already doing and settles back into it. A pose that snaps on
 * and off reads as a glitch however good the pose itself is.
 *
 * Inside the envelope an action is KEYFRAMED rather than being one target pose. A strike
 * has a back-lift, a whip and a follow-through, and a single bell toward "leg forward" has
 * none of them: it reads as a leg being raised, which is not what kicking a ball looks
 * like. `track()` is the whole keyframe system — piecewise, eased, and cheap.
 *
 * `footedness` picks the kicking leg, and for a dive, the side. `variant` picks between the
 * celebrations.
 */
export function applyAction(
  pose: Pose,
  action: ActionPose,
  t: number,
  footedness: 0 | 1,
  variant = 0,
): void {
  const k = clamp01(t);
  // Fast in, slow out — a strike is a whip, not a sine wave.
  const w = k < 0.35 ? smooth(k / 0.35) : smooth(1 - (k - 0.35) / 0.65);
  // A hold envelope for actions that have a body of their own: in quickly, held, out late.
  const hold = smooth(k / 0.12) * smooth((1 - k) / 0.3);
  const kickLeg = footedness;
  const plantLeg = footedness === 0 ? 1 : 0;
  const away = footedness === 0 ? 1 : -1;

  switch (action) {
    case 'kick': {
      // Back-lift, strike, follow-through. The strike lands at t≈0.35 — the envelope's
      // peak — so the leg is fully through the ball exactly when the pose is most itself.
      const env = smooth(k / 0.1) * smooth((1 - k) / 0.45);
      const hip = track([[0, 0.1], [0.2, -0.62], [0.35, 1.05], [0.55, 1.45], [1, 0.9]], k);
      const knee = track([[0, 0.5], [0.2, 1.95], [0.35, 0.18], [0.55, 0.1], [1, 0.3]], k);
      const ankle = track([[0, 0], [0.2, 0.3], [0.33, -0.7], [0.6, -0.5], [1, 0]], k);
      pose.hipPitch[kickLeg] = lerp(pose.hipPitch[kickLeg], hip, env);
      pose.kneeBend[kickLeg] = lerp(pose.kneeBend[kickLeg], knee, env);
      pose.anklePitch[kickLeg] = lerp(pose.anklePitch[kickLeg], ankle, env);
      // The plant leg takes the weight, a little bent, just behind the ball.
      pose.hipPitch[plantLeg] = lerp(pose.hipPitch[plantLeg], -0.18, env);
      pose.kneeBend[plantLeg] = lerp(pose.kneeBend[plantLeg], 0.38, env);
      pose.anklePitch[plantLeg] = lerp(pose.anklePitch[plantLeg], 0.1, env);
      pose.hipY = lerp(pose.hipY, RIG.hipHeight - 0.07, env);
      // Arms out wide for balance, the one opposite the kicking leg sweeping forward.
      pose.shoulderRoll[plantLeg] = lerp(pose.shoulderRoll[plantLeg], 1.05, env);
      pose.shoulderPitch[plantLeg] = lerp(pose.shoulderPitch[plantLeg], track([[0, 0], [0.2, -0.3], [0.4, 0.7], [1, 0.3]], k), env);
      pose.shoulderRoll[kickLeg] = lerp(pose.shoulderRoll[kickLeg], 0.55, env);
      pose.shoulderPitch[kickLeg] = lerp(pose.shoulderPitch[kickLeg], -0.35, env);
      pose.elbowBend[0] = lerp(pose.elbowBend[0], 0.5, env);
      pose.elbowBend[1] = lerp(pose.elbowBend[1], 0.5, env);
      // The hips open on the back-lift and close through the ball; the chest stays over it.
      pose.twist = lerp(pose.twist, (footedness === 0 ? 0.45 : -0.45) * track([[0, 0.3], [0.2, 1], [0.4, 0.2], [1, -0.2]], k) + (footedness === 0 ? 0.05 : -0.05), w);
      pose.lean = lerp(pose.lean, track([[0, 0.1], [0.2, 0.02], [0.4, -0.08], [1, 0.05]], k), env);
      pose.chest = lerp(pose.chest, 0.12, env);
      pose.headPitch = lerp(pose.headPitch, 0.35, env);
      break;
    }
    case 'pass': {
      // The side-foot: the leg turns out from the hip so the instep meets the ball, and the
      // swing is short. A pass struck like a shot is the most common procedural tell.
      const env = smooth(k / 0.12) * smooth((1 - k) / 0.45);
      pose.hipYaw[kickLeg] = lerp(pose.hipYaw[kickLeg], 0.95, env);
      pose.hipPitch[kickLeg] = lerp(pose.hipPitch[kickLeg], track([[0, 0.05], [0.25, -0.38], [0.45, 0.62], [1, 0.3]], k), env);
      pose.kneeBend[kickLeg] = lerp(pose.kneeBend[kickLeg], track([[0, 0.3], [0.25, 1.1], [0.45, 0.25], [1, 0.3]], k), env);
      pose.hipPitch[plantLeg] = lerp(pose.hipPitch[plantLeg], -0.08, env);
      pose.kneeBend[plantLeg] = lerp(pose.kneeBend[plantLeg], 0.32, env);
      pose.shoulderRoll[0] = lerp(pose.shoulderRoll[0], 0.4, env);
      pose.shoulderRoll[1] = lerp(pose.shoulderRoll[1], 0.4, env);
      pose.twist = lerp(pose.twist, footedness === 0 ? 0.22 : -0.22, w);
      pose.headPitch = lerp(pose.headPitch, 0.3, env);
      break;
    }
    case 'tackle': {
      // The slide: low, committed, one leg along the ground, the other folded under, and a
      // hand back to take the fall.
      pose.hipY = lerp(pose.hipY, RIG.hipHeight * 0.36, w);
      pose.hipPitch[kickLeg] = lerp(pose.hipPitch[kickLeg], 1.45, w);
      pose.kneeBend[kickLeg] = lerp(pose.kneeBend[kickLeg], 0.08, w);
      pose.anklePitch[kickLeg] = lerp(pose.anklePitch[kickLeg], -0.3, w);
      pose.hipPitch[plantLeg] = lerp(pose.hipPitch[plantLeg], 0.55, w);
      pose.kneeBend[plantLeg] = lerp(pose.kneeBend[plantLeg], 1.95, w);
      pose.hipRoll[plantLeg] = lerp(pose.hipRoll[plantLeg], 0.35, w);
      pose.lean = lerp(pose.lean, -0.55, w);
      pose.roll = lerp(pose.roll, away * 0.3, w);
      pose.shoulderPitch[plantLeg] = lerp(pose.shoulderPitch[plantLeg], -0.7, w);
      pose.shoulderRoll[plantLeg] = lerp(pose.shoulderRoll[plantLeg], 0.5, w);
      pose.elbowBend[plantLeg] = lerp(pose.elbowBend[plantLeg], 0.15, w);
      pose.shoulderPitch[kickLeg] = lerp(pose.shoulderPitch[kickLeg], 0.6, w);
      pose.shoulderRoll[kickLeg] = lerp(pose.shoulderRoll[kickLeg], 0.7, w);
      pose.headPitch = lerp(pose.headPitch, 0.35, w);
      break;
    }
    case 'header': {
      // Leap, arch back, snap through. Arms go up and out for the lift.
      const up = track([[0, 0], [0.3, 1], [0.6, 0.8], [1, 0]], k);
      pose.hipY = lerp(pose.hipY, RIG.hipHeight + 0.38, w * up);
      pose.lean = lerp(pose.lean, track([[0, 0], [0.35, -0.4], [0.55, 0.4], [1, 0.1]], k), w);
      pose.chest = lerp(pose.chest, track([[0, 0], [0.35, -0.25], [0.55, 0.3], [1, 0]], k), w);
      pose.hipPitch[0] = lerp(pose.hipPitch[0], -0.35, w);
      pose.hipPitch[1] = lerp(pose.hipPitch[1], 0.35, w);
      pose.kneeBend[0] = lerp(pose.kneeBend[0], 1.1, w);
      pose.kneeBend[1] = lerp(pose.kneeBend[1], 0.6, w);
      pose.shoulderPitch[0] = lerp(pose.shoulderPitch[0], 1.3, w);
      pose.shoulderPitch[1] = lerp(pose.shoulderPitch[1], 1.3, w);
      pose.shoulderRoll[0] = lerp(pose.shoulderRoll[0], 0.8, w);
      pose.shoulderRoll[1] = lerp(pose.shoulderRoll[1], 0.8, w);
      pose.elbowBend[0] = lerp(pose.elbowBend[0], 1.2, w);
      pose.elbowBend[1] = lerp(pose.elbowBend[1], 1.2, w);
      // Positive is a nod down: head back on the way up, forehead through the ball.
      pose.headPitch = lerp(pose.headPitch, track([[0, 0], [0.35, -0.55], [0.5, 0.45], [1, 0.1]], k), w);
      break;
    }
    case 'dive': {
      // Load, launch, land. Full length, sideways, both hands reaching past the head —
      // the roll is what makes it a dive rather than a trip, and the reach is what makes
      // it a keeper's.
      const side = footedness === 0 ? -1 : 1;
      const env = smooth(k / 0.1) * smooth((1 - k) / 0.25);
      pose.hipY = lerp(pose.hipY, track([[0, RIG.hipHeight - 0.15], [0.18, 0.62], [0.4, 0.52], [0.6, 0.3], [1, 0.34]], k), env);
      pose.roll = lerp(pose.roll, side * track([[0, 0.15], [0.25, 1.2], [0.55, 1.45], [1, 1.35]], k), env);
      pose.lean = lerp(pose.lean, 0.18, env);
      pose.chest = lerp(pose.chest, -0.1, env);
      for (let i = 0; i < 2; i++) {
        pose.shoulderPitch[i] = lerp(pose.shoulderPitch[i] as number, 2.75, env);
        pose.shoulderRoll[i] = lerp(pose.shoulderRoll[i] as number, 0.28, env);
        pose.elbowBend[i] = lerp(pose.elbowBend[i] as number, 0.12, env);
      }
      // Legs trail, the top one kicking up.
      pose.hipPitch[0] = lerp(pose.hipPitch[0], 0.25, env);
      pose.hipPitch[1] = lerp(pose.hipPitch[1], -0.1, env);
      pose.kneeBend[0] = lerp(pose.kneeBend[0], 0.55, env);
      pose.kneeBend[1] = lerp(pose.kneeBend[1], 0.25, env);
      pose.hipRoll[0] = lerp(pose.hipRoll[0], 0.2, env);
      pose.hipRoll[1] = lerp(pose.hipRoll[1], 0.2, env);
      pose.headPitch = lerp(pose.headPitch, -0.2, env);
      break;
    }
    case 'catch': {
      // The routine save: a step across, down behind the line of the ball, hands forward
      // and together, and gathered into the chest.
      const gather = track([[0, 0], [0.35, 0], [0.6, 1], [1, 1]], k);
      pose.hipY = lerp(pose.hipY, RIG.hipHeight - 0.2, hold);
      pose.lean = lerp(pose.lean, 0.3, hold);
      for (let i = 0; i < 2; i++) {
        pose.hipPitch[i] = lerp(pose.hipPitch[i] as number, 0.35, hold);
        pose.kneeBend[i] = lerp(pose.kneeBend[i] as number, 0.8, hold);
        pose.shoulderPitch[i] = lerp(pose.shoulderPitch[i] as number, lerp(1.25, 0.55, gather), hold);
        pose.elbowBend[i] = lerp(pose.elbowBend[i] as number, lerp(0.5, 1.9, gather), hold);
        pose.shoulderRoll[i] = lerp(pose.shoulderRoll[i] as number, lerp(0.1, 0.25, gather), hold);
      }
      pose.headPitch = lerp(pose.headPitch, 0.3, hold);
      break;
    }
    case 'fall': {
      // Brought down: a stumble forward, hands out, onto the grass, a moment there, and up.
      const down = track([[0, 0], [0.18, 0.35], [0.35, 1], [0.78, 1], [1, 0]], k);
      pose.hipY = lerp(pose.hipY, 0.26, down);
      pose.lean = lerp(pose.lean, 1.2, down);
      pose.roll = lerp(pose.roll, away * 0.25, down);
      for (let i = 0; i < 2; i++) {
        pose.shoulderPitch[i] = lerp(pose.shoulderPitch[i] as number, 1.9, down);
        pose.shoulderRoll[i] = lerp(pose.shoulderRoll[i] as number, 0.45, down);
        pose.elbowBend[i] = lerp(pose.elbowBend[i] as number, 0.8, down);
        pose.hipPitch[i] = lerp(pose.hipPitch[i] as number, i === kickLeg ? -0.3 : 0.05, down);
        pose.kneeBend[i] = lerp(pose.kneeBend[i] as number, i === kickLeg ? 1.2 : 0.4, down);
      }
      pose.headPitch = lerp(pose.headPitch, -0.9, down);
      break;
    }
    case 'throw': {
      // Both hands over the head and both feet on the ground — the two conditions a
      // throw-in has, and the only football restart with a rule about your arms.
      pose.shoulderPitch[0] = lerp(pose.shoulderPitch[0], 2.7, w);
      pose.shoulderPitch[1] = lerp(pose.shoulderPitch[1], 2.7, w);
      pose.elbowBend[0] = lerp(pose.elbowBend[0], track([[0, 1.6], [0.45, 1.9], [0.7, 0.2], [1, 0.3]], k), w);
      pose.elbowBend[1] = lerp(pose.elbowBend[1], track([[0, 1.6], [0.45, 1.9], [0.7, 0.2], [1, 0.3]], k), w);
      // Arch back, then whip forward over the top.
      pose.lean = lerp(pose.lean, k < 0.45 ? -0.4 : 0.36, w);
      pose.headPitch = lerp(pose.headPitch, k < 0.45 ? -0.3 : 0.15, w);
      // A split stance: one foot forward, both down.
      pose.hipPitch[0] = lerp(pose.hipPitch[0], 0.34, w);
      pose.hipPitch[1] = lerp(pose.hipPitch[1], -0.26, w);
      pose.kneeBend[0] = lerp(pose.kneeBend[0], 0.3, w);
      pose.kneeBend[1] = lerp(pose.kneeBend[1], 0.16, w);
      pose.twist = lerp(pose.twist, 0, w);
      break;
    }
    case 'celebrate': {
      celebrate(pose, k, footedness, ((variant % CELEBRATIONS) + CELEBRATIONS) % CELEBRATIONS);
      break;
    }
    case 'cheer': {
      // A teammate: both fists up and pumping, on the move toward the scorer.
      const c = smooth(clamp01(k * 4)) * smooth((1 - k) / 0.2);
      const pump = Math.sin(k * TAU * 5) * 0.5 + 0.5;
      for (let i = 0; i < 2; i++) {
        const mine = i === 0 ? pump : 1 - pump;
        pose.shoulderPitch[i] = lerp(pose.shoulderPitch[i] as number, lerp(1.9, 2.8, mine), c);
        pose.shoulderRoll[i] = lerp(pose.shoulderRoll[i] as number, 0.35, c);
        pose.elbowBend[i] = lerp(pose.elbowBend[i] as number, lerp(1.2, 0.4, mine), c);
      }
      pose.headPitch = lerp(pose.headPitch, -0.25, c);
      break;
    }
    case 'dejected': {
      // The other team: hands on the head, looking at the grass, and still.
      const c = smooth(clamp01((k - 0.05) * 5)) * smooth((1 - k) / 0.2);
      for (let i = 0; i < 2; i++) {
        pose.shoulderPitch[i] = lerp(pose.shoulderPitch[i] as number, 2.45, c);
        pose.shoulderRoll[i] = lerp(pose.shoulderRoll[i] as number, 0.95, c);
        pose.elbowBend[i] = lerp(pose.elbowBend[i] as number, 2.35, c);
      }
      pose.headPitch = lerp(pose.headPitch, 0.55, c);
      pose.chest = lerp(pose.chest, 0.15, c);
      pose.lean = lerp(pose.lean, 0.02, c);
      break;
    }
  }
}

/**
 * The scorer. Held rather than pulsed — a celebration is a pose you hold for the cameras —
 * and four of them, picked by the player, so a striker has a celebration of his own.
 */
function celebrate(pose: Pose, k: number, footedness: 0 | 1, variant: number): void {
  const c = smooth(clamp01(k * 3)) * smooth((1 - k) / 0.15);
  switch (variant) {
    case 0: {
      // Arms up, running away.
      for (let i = 0; i < 2; i++) {
        pose.shoulderPitch[i] = lerp(pose.shoulderPitch[i] as number, 2.7, c);
        pose.shoulderRoll[i] = lerp(pose.shoulderRoll[i] as number, 0.45, c);
        pose.elbowBend[i] = lerp(pose.elbowBend[i] as number, 0.3, c);
      }
      pose.lean = lerp(pose.lean, -0.05, c);
      pose.headPitch = lerp(pose.headPitch, -0.35, c);
      break;
    }
    case 1: {
      // The aeroplane: arms straight out, banking through the turns.
      for (let i = 0; i < 2; i++) {
        pose.shoulderPitch[i] = lerp(pose.shoulderPitch[i] as number, 0.1, c);
        pose.shoulderRoll[i] = lerp(pose.shoulderRoll[i] as number, 1.5, c);
        pose.elbowBend[i] = lerp(pose.elbowBend[i] as number, 0.08, c);
      }
      pose.roll = lerp(pose.roll, Math.sin(k * TAU * 1.5) * 0.4, c);
      pose.headPitch = lerp(pose.headPitch, -0.15, c);
      break;
    }
    case 2: {
      // The knee slide: run in, drop onto both knees, lean back, arms wide to the stand.
      const slide = track([[0, 0], [0.15, 0], [0.25, 1], [0.8, 1], [1, 0]], k);
      pose.hipY = lerp(pose.hipY, 0.48, slide);
      for (let i = 0; i < 2; i++) {
        pose.hipPitch[i] = lerp(pose.hipPitch[i] as number, -0.05, slide);
        pose.kneeBend[i] = lerp(pose.kneeBend[i] as number, 1.95, slide);
        pose.anklePitch[i] = lerp(pose.anklePitch[i] as number, -0.9, slide);
        pose.hipRoll[i] = lerp(pose.hipRoll[i] as number, 0.12, slide);
        pose.shoulderPitch[i] = lerp(pose.shoulderPitch[i] as number, 2.3, c);
        pose.shoulderRoll[i] = lerp(pose.shoulderRoll[i] as number, 0.75, c);
        pose.elbowBend[i] = lerp(pose.elbowBend[i] as number, 0.25, c);
      }
      pose.lean = lerp(pose.lean, -0.35, slide);
      pose.chest = lerp(pose.chest, -0.3, slide);
      pose.headPitch = lerp(pose.headPitch, -0.5, c);
      break;
    }
    default: {
      // The leap and the fist: one arm punching the sky, the other pumped in, on the jump.
      const jump = track([[0, 0], [0.12, 0], [0.22, 1], [0.34, 0], [0.46, 1], [0.58, 0], [1, 0]], k);
      pose.hipY = lerp(pose.hipY, RIG.hipHeight + 0.22, jump * c);
      const up = footedness;
      const pumped = footedness === 0 ? 1 : 0;
      pose.shoulderPitch[up] = lerp(pose.shoulderPitch[up], 2.9, c);
      pose.shoulderRoll[up] = lerp(pose.shoulderRoll[up], 0.25, c);
      pose.elbowBend[up] = lerp(pose.elbowBend[up], 0.3, c);
      pose.shoulderPitch[pumped] = lerp(pose.shoulderPitch[pumped], 0.25, c);
      pose.shoulderRoll[pumped] = lerp(pose.shoulderRoll[pumped], 0.3, c);
      pose.elbowBend[pumped] = lerp(pose.elbowBend[pumped], 2.1, c);
      for (let i = 0; i < 2; i++) {
        pose.kneeBend[i] = lerp(pose.kneeBend[i] as number, 0.2 + jump * 0.9, c);
        pose.hipPitch[i] = lerp(pose.hipPitch[i] as number, jump * 0.5, c);
      }
      pose.headPitch = lerp(pose.headPitch, -0.4, c);
      break;
    }
  }
}

export function smooth(x: number): number {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
}
