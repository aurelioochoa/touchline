// The footballer's body: its bones, the pose it is sculpted in, and the volumes it is
// sculpted from (sculpt.ts turns those into one skinned mesh).
//
// Measurements are a 1.8m adult male footballer's, not an artist's canon. Where the eye
// is least forgiving they are checked against published anthropometry of elite players —
// the ISAK profiles of Serie A squads put mean thigh girth at 54.8cm, calf at 37.5cm and
// waist at 75.9cm — and against the classical eight-head figure for the landmarks: chin to
// nipple one head, nipple to navel one, a hand that reaches mid-thigh. The first figure
// failed both: its skull was 21cm wide (a real one is about 15.5), its hands were half the
// length of a real hand, and two spheres stacked at each shoulder read as pads.
//
// Frame convention, as before: +Z is the way he is facing, +Y is up, the origin is on the
// grass between his feet. Every bone's frame has its JOINT at the origin, and a limb
// hangs down −Y from it.

import * as THREE from 'three';
import { RIG, emptyPose, type Pose } from './gait.js';
import type { Volume, Vec3 } from './sculpt.js';

export const BONES = [
  'hips',
  'chest',
  'head',
  'upperArm0',
  'forearm0',
  'upperArm1',
  'forearm1',
  'thigh0',
  'shin0',
  'foot0',
  'thigh1',
  'shin1',
  'foot1',
] as const;
export type Bone = (typeof BONES)[number];
export const BONE_COUNT = BONES.length;
export const bone = (name: Bone): number => BONES.indexOf(name);

const HIPS = 0;
const CHEST = 1;
const HEAD = 2;
const UPPER_ARM = [3, 5] as const;
const FOREARM = [4, 6] as const;
const THIGH = [7, 10] as const;
const SHIN = [8, 11] as const;
const FOOT = [9, 12] as const;

/**
 * Where the head joint sits above the chest's origin, which is the shoulder line. The
 * head hangs UP off it, so a nod pivots at the base of the neck, where a nod pivots.
 */
export const HEAD_JOINT_Y = 0.015;
/** Centre of the skull above the head joint. */
export const SKULL_Y = 0.208;
/** The eyeballs, relative to the skull's centre: across, up, forward, and their radius. */
export const EYE_X = 0.031;
export const EYE_Y = 0.009;
export const EYE_Z = 0.071;
export const EYE_R = 0.0125;
/** How far below the shoulder line the shirt's hem falls. */
export const SHIRT_HEM = 0.535;
/** Below the hip joints, the hem of the shorts. */
export const SHORTS_HEM = 0.19;
/** Below the knee, the top of the sock. */
export const SOCK_TOP = 0.075;
/** Above the ankle, the collar of the boot. */
export const BOOT_TOP = 0.035;
/** Down the arm from the shoulder joint, the hem of the sleeve. */
export const SLEEVE = 0.165;

/**
 * Write every bone's matrix, relative to the figure's own root, for a pose.
 *
 * Sign conventions are the ones figure.test.ts measures in world space: positive `lean`
 * tips the shoulders forward, positive `headPitch` nods down, positive `shoulderPitch` and
 * `hipPitch` swing the limb forward, positive `*Roll` takes a limb out from the body. An
 * elbow folds forward and a knee backward — they were once given the same sign, and every
 * figure ran with its forearms swinging out behind it.
 */
export function poseBones(pose: Pose, out: THREE.Matrix4[], s: PoseScratch = scratch): void {
  const { e, q, v, one, zero, body, m } = s;
  // Body: lean and roll about the hips.
  e.set(pose.lean, 0, pose.roll, 'XYZ');
  q.setFromEuler(e);
  v.set(0, pose.hipY, 0);
  body.compose(v, q, one);

  // Hips: the legs run along `legYaw`, which is not always where the chest is pointing.
  e.set(0, pose.legYaw, 0);
  q.setFromEuler(e);
  (out[HIPS] as THREE.Matrix4).compose(zero, q, one).premultiply(body);

  // Chest hangs UP from the hips, twisted against them and bent at the upper spine.
  e.set(pose.chest, pose.twist, 0);
  q.setFromEuler(e);
  v.set(0, RIG.torso, 0);
  const chest = (out[CHEST] as THREE.Matrix4).compose(v, q, one).premultiply(body);

  // Head: yaw first, then the nod.
  e.set(pose.headPitch, pose.headYaw, 0, 'YXZ');
  q.setFromEuler(e);
  e.order = 'XYZ';
  v.set(0, HEAD_JOINT_Y, 0);
  (out[HEAD] as THREE.Matrix4).compose(v, q, one).premultiply(chest);

  for (let arm = 0; arm < 2; arm++) {
    const side = arm === 0 ? -1 : 1;
    // A footballer runs with daylight under his elbows: 0.14 rad of abduction is the rest
    // position, and the pose adds its own on top.
    e.set(-(pose.shoulderPitch[arm] as number), 0, side * (0.14 + (pose.shoulderRoll[arm] as number)));
    q.setFromEuler(e);
    v.set((side * RIG.shoulderWidth) / 2, -0.05, 0);
    const upper = (out[(UPPER_ARM[arm] as number)] as THREE.Matrix4).compose(v, q, one).premultiply(chest);
    e.set(-(pose.elbowBend[arm] as number), 0, 0);
    q.setFromEuler(e);
    v.set(0, -RIG.upperArm, 0);
    (out[(FOREARM[arm] as number)] as THREE.Matrix4).compose(v, q, one).premultiply(upper);
  }

  const hips = out[HIPS] as THREE.Matrix4;
  for (let leg = 0; leg < 2; leg++) {
    const side = leg === 0 ? -1 : 1;
    e.set(-(pose.hipPitch[leg] as number), side * (pose.hipYaw[leg] as number), side * (pose.hipRoll[leg] as number));
    q.setFromEuler(e);
    v.set((side * RIG.hipWidth) / 2, -0.02, 0);
    const thigh = (out[(THIGH[leg] as number)] as THREE.Matrix4).compose(v, q, one).premultiply(hips);
    // The knee bends the shin BACKWARD relative to the thigh.
    e.set(pose.kneeBend[leg] as number, 0, 0);
    q.setFromEuler(e);
    v.set(0, -RIG.thigh, 0);
    const shin = (out[(SHIN[leg] as number)] as THREE.Matrix4).compose(v, q, one).premultiply(thigh);
    e.set(-(pose.anklePitch[leg] as number), 0, 0);
    q.setFromEuler(e);
    v.set(0, -RIG.shin, 0);
    m.compose(v, q, one);
    (out[(FOOT[leg] as number)] as THREE.Matrix4).multiplyMatrices(shin, m);
  }
}

export interface PoseScratch {
  e: THREE.Euler;
  q: THREE.Quaternion;
  v: THREE.Vector3;
  one: THREE.Vector3;
  zero: THREE.Vector3;
  body: THREE.Matrix4;
  m: THREE.Matrix4;
}

export function poseScratch(): PoseScratch {
  return {
    e: new THREE.Euler(),
    q: new THREE.Quaternion(),
    v: new THREE.Vector3(),
    one: new THREE.Vector3(1, 1, 1),
    zero: new THREE.Vector3(),
    body: new THREE.Matrix4(),
    m: new THREE.Matrix4(),
  };
}
const scratch = poseScratch();

/**
 * The pose the body is sculpted in: standing, arms out in an A. Arms held away from the
 * ribs keep the armpit from welding the arm to the shirt, and legs a little apart keep the
 * thighs from welding to each other — every bone's volumes have to be separable, or they
 * cannot move apart.
 */
export function bindPose(): Pose {
  const p = emptyPose();
  p.shoulderRoll = [0.26, 0.26];
  p.hipRoll = [0.03, 0.03];
  return p;
}

export function bindMatrices(): THREE.Matrix4[] {
  const out = BONES.map(() => new THREE.Matrix4());
  poseBones(bindPose(), out, poseScratch());
  return out;
}

/** Bind-space heights the shader colours the kit by. Derived, so they cannot drift. */
export interface KitLines {
  shirtHem: number;
  shortsHem: number;
  sockTop: number;
  bootTop: number;
  sole: number;
  collar: number;
  /** The shoulder joints and the arms' direction in the bind pose, for the sleeve. */
  shoulder: THREE.Vector3;
  armDir: THREE.Vector3;
  /** The skull's centre, for painting a face. */
  skull: THREE.Vector3;
}

export function kitLines(bind: readonly THREE.Matrix4[]): KitLines {
  const at = (b: number, x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(bind[b] as THREE.Matrix4);
  const shoulder = at(UPPER_ARM[1], 0, 0, 0);
  const armDir = at(UPPER_ARM[1], 0, -1, 0).sub(shoulder).normalize();
  const ankle = at(FOOT[1], 0, 0, 0).y;
  return {
    shirtHem: at(CHEST, 0, -SHIRT_HEM, 0).y,
    shortsHem: at(THIGH[1], 0, -SHORTS_HEM, 0).y,
    sockTop: at(SHIN[1], 0, -SOCK_TOP, 0).y,
    bootTop: ankle + BOOT_TOP,
    sole: ankle - 0.056,
    collar: at(CHEST, 0, 0.012, 0).y,
    shoulder,
    armDir,
    skull: at(HEAD, 0, SKULL_Y, 0),
  };
}

// ---- the volumes -------------------------------------------------------------------

const E = (bone: number, c: Vec3, r: Vec3, blend: number, extra: Partial<Volume> = {}, rot?: Vec3): Volume => ({
  shape: rot ? { kind: 'ellipsoid', c, r, rot } : { kind: 'ellipsoid', c, r },
  bone,
  blend,
  ...extra,
});
const C = (bone: number, a: Vec3, b: Vec3, ra: number, rb: number, blend: number, extra: Partial<Volume> = {}): Volume => ({
  shape: { kind: 'cone', a, b, ra, rb },
  bone,
  blend,
  ...extra,
});
/** Clip away everything below `y` in the bone's frame: a hem. */
const below = (y: number) => ({ n: [0, -1, 0] as Vec3, d: -y });
/** Clip away everything above `y`: the top edge of a cuff. */
const above = (y: number) => ({ n: [0, 1, 0] as Vec3, d: y });

/**
 * Every volume of the body, in draw order. Order matters only for the smooth union, and
 * only a little: garments go after the anatomy under them so their hems stay crisp.
 *
 * `bind` is needed for the spine and neck, which hand over between bones by height.
 */
export function bodyVolumes(bind: readonly THREE.Matrix4[]): Volume[] {
  const y = (b: number, ly: number) => new THREE.Vector3(0, ly, 0).applyMatrix4(bind[b] as THREE.Matrix4).y;
  const waistLow = y(HIPS, 0.02);
  const waistHigh = y(CHEST, -0.26);
  // The shirt bends with the spine: rigid to the ribcage at the top, to the pelvis at the hem.
  const spine = { spread: { to: HIPS, y0: waistHigh, y1: waistLow } };
  const spineUp = { spread: { to: CHEST, y0: waistLow, y1: waistHigh } };
  const neck = { spread: { to: CHEST, y0: y(HEAD, 0.09), y1: y(HEAD, -0.01) } };
  const S = SKULL_Y;
  const v: Volume[] = [];

  // --- trunk, in the shirt ---
  // Ribcage and chest: widest across the pecs and lats, a V down to the waist. The shirt
  // is cut loose, so these are the shirt's surface rather than the skin's.
  v.push(E(CHEST, [0, -0.17, 0.008], [0.176, 0.15, 0.112], 0.05, spine));
  v.push(E(CHEST, [0, -0.33, 0], [0.167, 0.16, 0.108], 0.05, spine));
  v.push(E(CHEST, [0, -0.46, -0.004], [0.17, 0.13, 0.11], 0.03, { ...spine, clip: below(-SHIRT_HEM) }));
  // The pecs, which are what make a chest a chest from the side.
  v.push(E(CHEST, [-0.07, -0.13, 0.066], [0.08, 0.065, 0.05], 0.04, spine));
  v.push(E(CHEST, [0.07, -0.13, 0.066], [0.08, 0.065, 0.05], 0.04, spine));
  // Shoulder blades and the upper back.
  v.push(E(CHEST, [0, -0.14, -0.03], [0.162, 0.13, 0.092], 0.05, spine));
  // Trapezius: the slope from the neck to the shoulder. A figure without it has a neck
  // standing on a shelf — the single most "made of parts" thing the old one did.
  v.push(E(CHEST, [-0.075, 0.014, -0.016], [0.1, 0.056, 0.064], 0.055, {}, [0, 0, 0.4]));
  v.push(E(CHEST, [0.075, 0.014, -0.016], [0.1, 0.056, 0.064], 0.055, {}, [0, 0, -0.4]));
  // The point of the shoulder, bridging the trapezius into the sleeve's cap.
  v.push(E(CHEST, [-0.165, -0.05, 0], [0.07, 0.048, 0.064], 0.05));
  v.push(E(CHEST, [0.165, -0.05, 0], [0.07, 0.048, 0.064], 0.05));
  // A collar band, just proud of the neck.
  v.push(C(CHEST, [0, 0.006, -0.006], [0, -0.014, 0.004], 0.066, 0.07, 0.02));

  // --- pelvis, in the shorts ---
  v.push(E(HIPS, [0, 0.07, 0], [0.152, 0.11, 0.1], 0.05, spineUp));
  v.push(E(HIPS, [0, -0.03, -0.004], [0.158, 0.12, 0.11], 0.04));
  v.push(E(HIPS, [-0.062, -0.085, -0.048], [0.072, 0.085, 0.066], 0.04));
  v.push(E(HIPS, [0.062, -0.085, -0.048], [0.072, 0.085, 0.066], 0.04));
  v.push(E(HIPS, [0, -0.13, 0.005], [0.075, 0.05, 0.07], 0.04));

  // --- neck and head ---
  // The neck is thick — a footballer's is 38–40cm round — and leans forward out of the
  // shoulders rather than standing straight up on them.
  v.push(C(HEAD, [0, -0.04, -0.02], [0, 0.13, 0.004], 0.066, 0.053, 0.04, neck));
  // Cranium, then the face hung off the front of it.
  v.push(E(HEAD, [0, S + 0.02, -0.012], [0.077, 0.092, 0.1], 0.02));
  v.push(E(HEAD, [0, S - 0.035, 0.018], [0.068, 0.075, 0.074], 0.045));
  v.push(E(HEAD, [0, S - 0.068, 0.01], [0.06, 0.04, 0.064], 0.035));
  v.push(E(HEAD, [0, S - 0.093, 0.056], [0.024, 0.02, 0.022], 0.03));
  v.push(E(HEAD, [-0.05, S - 0.012, 0.05], [0.022, 0.017, 0.024], 0.03));
  v.push(E(HEAD, [0.05, S - 0.012, 0.05], [0.022, 0.017, 0.024], 0.03));
  // Fuller cheeks over the cheekbones, where a face is soft rather than skull.
  v.push(E(HEAD, [-0.04, S - 0.036, 0.046], [0.027, 0.028, 0.028], 0.03));
  v.push(E(HEAD, [0.04, S - 0.036, 0.046], [0.027, 0.028, 0.028], 0.03));
  // Temples, so the forehead is as wide as the face under it.
  v.push(E(HEAD, [-0.048, S + 0.02, 0.045], [0.025, 0.03, 0.03], 0.025));
  v.push(E(HEAD, [0.048, S + 0.02, 0.045], [0.025, 0.03, 0.03], 0.025));
  // Brow ridge: shape, not colour — the brows themselves are painted in the hair colour.
  v.push(E(HEAD, [0, S + 0.03, 0.074], [0.056, 0.014, 0.022], 0.03));
  // The eyes: a socket cut under the brow, an eyeball set in it, and the lids over the
  // ball. The old face had two dark beads on a flat front, and it is the hollow and the
  // lid, more than the eye itself, that make a face look back at you.
  for (const x of [-EYE_X, EYE_X]) {
    v.push(E(HEAD, [x, S + 0.01, 0.089], [0.018, 0.012, 0.014], 0.01, { carve: true }));
    v.push(E(HEAD, [x, S + EYE_Y, EYE_Z], [EYE_R, EYE_R, EYE_R], 0.003));
    v.push(E(HEAD, [x, S + 0.018, 0.074], [0.016, 0.0055, 0.012], 0.005, {}, [-0.35, 0, 0]));
    v.push(E(HEAD, [x, S + 0.0, 0.074], [0.014, 0.004, 0.01], 0.005, {}, [0.2, 0, 0]));
  }
  // The nose: a bridge, a tip, the two wings either side and the nostrils under them.
  v.push(C(HEAD, [0, S + 0.014, 0.086], [0, S - 0.026, 0.108], 0.01, 0.013, 0.014));
  v.push(E(HEAD, [0, S - 0.034, 0.098], [0.017, 0.013, 0.016], 0.014));
  for (const x of [-0.014, 0.014]) {
    v.push(E(HEAD, [x, S - 0.035, 0.09], [0.009, 0.008, 0.01], 0.007));
    v.push(E(HEAD, [x * 0.55, S - 0.043, 0.098], [0.004, 0.003, 0.006], 0.003, { carve: true }));
  }
  // The mouth: an upper lip with its bow, a fuller lower lip, and the line between them.
  v.push(E(HEAD, [0, S - 0.053, 0.088], [0.021, 0.006, 0.01], 0.006));
  v.push(E(HEAD, [0, S - 0.064, 0.086], [0.019, 0.0065, 0.01], 0.006));
  v.push(E(HEAD, [0, S - 0.0585, 0.095], [0.02, 0.0016, 0.007], 0.002, { carve: true }));
  // Ears: a shell with its hollow.
  for (const sx of [-1, 1]) {
    v.push(E(HEAD, [sx * 0.078, S - 0.005, -0.006], [0.014, 0.032, 0.021], 0.012));
    v.push(E(HEAD, [sx * 0.087, S - 0.008, -0.002], [0.006, 0.017, 0.011], 0.004, { carve: true }));
  }
  // The neck's cords from behind the ear to the collarbone, and the Adam's apple: without
  // them a neck is a pipe.
  for (const sx of [-1, 1]) {
    v.push(C(HEAD, [sx * 0.055, S - 0.05, -0.012], [sx * 0.018, -0.005, 0.045], 0.016, 0.013, 0.025, neck));
  }
  v.push(E(HEAD, [0, 0.055, 0.044], [0.011, 0.015, 0.01], 0.012, neck));

  // --- arms ---
  for (let a = 0; a < 2; a++) {
    const U = (UPPER_ARM[a] as number);
    const F = (FOREARM[a] as number);
    const arm = { arm: true };
    // Deltoid, rounding the shoulder into the arm.
    v.push(E(U, [0, -0.035, 0], [0.05, 0.08, 0.056], 0.035, arm));
    v.push(C(U, [0, -0.02, 0], [0, -0.16, 0], 0.048, 0.046, 0.03, arm));
    v.push(C(U, [0, -0.16, 0], [0, -RIG.upperArm, 0], 0.046, 0.038, 0.03, arm));
    v.push(E(U, [0, -0.15, 0.012], [0.04, 0.08, 0.04], 0.03, arm));
    // Forearm: thick below the elbow, thin at the wrist.
    v.push(C(F, [0, 0, 0], [0, -0.08, 0.003], 0.039, 0.042, 0.025, arm));
    v.push(C(F, [0, -0.08, 0.003], [0, -RIG.forearm + 0.01, 0], 0.042, 0.026, 0.025, arm));
    // A hand, relaxed: palm towards the thigh, fingers loosely curled, thumb forward. A
    // real hand is about 19cm; the old one was 10.
    const w = -RIG.forearm;
    v.push(E(F, [0, w - 0.05, 0.004], [0.02, 0.052, 0.036], 0.018, arm));
    v.push(E(F, [0, w - 0.105, 0.012], [0.018, 0.036, 0.032], 0.014, arm, [0.28, 0, 0]));
    v.push(C(F, [0, w - 0.02, 0.028], [0, w - 0.07, 0.046], 0.013, 0.01, 0.012, arm));
    // The sleeve, loose over the top of the arm, with a hem.
    v.push(C(U, [0, 0.01, 0], [0, -SLEEVE, 0], 0.054, 0.053, 0.006, { ...arm, clip: below(-SLEEVE) }));
  }

  // --- legs ---
  for (let l = 0; l < 2; l++) {
    const T = (THIGH[l] as number);
    const H = (SHIN[l] as number);
    const F = (FOOT[l] as number);
    // Thigh: 55cm round below the hip, the quad in front and the hamstrings behind it,
    // running hard into the knee.
    v.push(C(T, [0, 0.02, 0], [0, -0.12, 0.004], 0.082, 0.088, 0.03));
    v.push(C(T, [0, -0.12, 0.004], [0, -0.3, 0.006], 0.088, 0.07, 0.03));
    v.push(C(T, [0, -0.3, 0.006], [0, -RIG.thigh, 0], 0.07, 0.052, 0.03));
    v.push(E(T, [0, -0.2, 0.03], [0.062, 0.13, 0.055], 0.03));
    v.push(E(T, [0, -0.2, -0.026], [0.058, 0.14, 0.05], 0.03));
    v.push(E(T, [0, -RIG.thigh + 0.01, 0.042], [0.028, 0.032, 0.018], 0.015));
    // Shin: the calf sits BEHIND the bone, which is what makes a leg read side-on.
    v.push(C(H, [0, 0, 0], [0, -0.1, -0.005], 0.052, 0.049, 0.025));
    v.push(E(H, [0, -0.125, -0.022], [0.05, 0.1, 0.05], 0.03));
    v.push(C(H, [0, -0.1, -0.005], [0, -0.3, -0.004], 0.049, 0.036, 0.025));
    v.push(C(H, [0, -0.3, -0.004], [0, -RIG.shin, 0], 0.036, 0.03, 0.02));
    // Shin pad under the sock, and the sock's turned-over top.
    v.push(E(H, [0, -0.21, 0.034], [0.04, 0.105, 0.02], 0.02));
    v.push(C(H, [0, -SOCK_TOP + 0.01, -0.006], [0, -SOCK_TOP - 0.022, -0.008], 0.062, 0.06, 0.006, { clip: above(-SOCK_TOP) }));
    // The shorts' leg, over the top of the thigh: a loose tube to a hem.
    v.push(C(T, [0, 0.03, 0], [0, -SHORTS_HEM, 0.002], 0.098, 0.1, 0.006, { clip: below(-SHORTS_HEM) }));
    // The boot: collar, heel counter, an upper tapering to a rounded toe, a sole.
    v.push(C(F, [0, 0.035, -0.004], [0, -0.03, -0.01], 0.04, 0.045, 0.02));
    v.push(E(F, [0, -0.034, -0.03], [0.042, 0.034, 0.05], 0.025));
    v.push(E(F, [0, -0.038, 0.06], [0.045, 0.03, 0.11], 0.03));
    v.push(E(F, [0, -0.044, 0.14], [0.038, 0.024, 0.05], 0.02));
    v.push(E(F, [0, -0.058, 0.045], [0.048, 0.012, 0.145], 0.01));
  }
  return v;
}

/** The box the bind pose fits in, with room for the smooth unions. */
export const BODY_MIN: Vec3 = [-0.62, -0.06, -0.2];
export const BODY_MAX: Vec3 = [0.62, 1.82, 0.26];
