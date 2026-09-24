// Twenty-five footballers and officials, in about a dozen draw calls.
//
// The trick is to instance PER LIMB TYPE rather than per player: one InstancedMesh holding
// fifty thighs, another holding fifty shins, and so on. A mesh per player would be
// 25 × 16 = 400 draw calls before the pitch is drawn; this is eleven, which leaves the
// whole rest of the frame budget for everything else (design §12).
//
// No skeleton, no skinning, no loader, no asset file. Each limb is a rigid primitive from
// kit.ts and the pose solver decides where it goes.
//
// Frame convention, per figure: +Z is the way he is facing, +Y is up, the origin is on the
// grass between his feet. Limb geometries are built with the JOINT at their origin
// extending DOWN — the one exception is the head, which hangs UP off the shoulder line
// because that is where a neck actually goes.
//
// WHY ELEVEN GROUPS AND NOT EIGHT. A limb's colour comes from `instanceColor`, which
// MULTIPLIES the baked vertex colour. So one instance can be a shade of one hue and never
// two: a white sock on a red shirt is not expressible on the same instance as the shin
// above it. The first version worked around that by tinting the whole shin 'shirt' — it
// was standing in for a sock, and the leg above it was lost. Splitting sleeve, sock and
// hair into groups of their own is what buys a kit that reads as a kit.

import * as THREE from 'three';
import { capsule, cylinder, ellipsoid, lathe, mergeParts, smoothPaintMaterial, sphere, torus } from './kit.js';
import { RIG, type Pose } from './gait.js';
import { PATTERN_GLSL, TORSO_HALF_WIDTH, TORSO_HEIGHT } from './kitPattern.js';
import { digitAtlas } from './textures.js';

/**
 * The haircuts. Each is its own instanced group, and a figure shows exactly one of them:
 * the others get a zero matrix, the same way a substituted player is hidden. Five extra
 * draw calls buys a squad that is not eleven identical swim caps.
 */
export const HAIR_STYLES = ['hairCrop', 'hairShort', 'hairQuiff', 'hairCurly', 'hairBun'] as const;
type HairLimb = (typeof HAIR_STYLES)[number];

/** The limb groups, in draw order. Each becomes one InstancedMesh. */
export const LIMBS = [
  'head',
  ...HAIR_STYLES,
  'torso',
  'pelvis',
  'shortsLeg',
  'sleeve',
  'upperArm',
  'forearm',
  'thigh',
  'shin',
  'sock',
  'foot',
] as const;
export type Limb = (typeof LIMBS)[number];

const isHair = (limb: Limb): limb is HairLimb => (HAIR_STYLES as readonly string[]).includes(limb);

/** How many of each limb a figure has. */
const LIMB_COUNT: Readonly<Record<Limb, number>> = {
  head: 1,
  hairCrop: 1,
  hairShort: 1,
  hairQuiff: 1,
  hairCurly: 1,
  hairBun: 1,
  torso: 1,
  pelvis: 1,
  shortsLeg: 2,
  sleeve: 2,
  upperArm: 2,
  forearm: 2,
  thigh: 2,
  shin: 2,
  sock: 2,
  foot: 2,
};

/** Which colour a limb takes. Kit colours come from the club; skin and hair from the player. */
type Tint = 'shirt' | 'sleeve' | 'shorts' | 'sock' | 'skin' | 'hair' | 'boot';
const LIMB_TINT: Readonly<Record<Limb, Tint>> = {
  head: 'skin',
  hairCrop: 'hair',
  hairShort: 'hair',
  hairQuiff: 'hair',
  hairCurly: 'hair',
  hairBun: 'hair',
  torso: 'shirt',
  pelvis: 'shorts',
  shortsLeg: 'shorts',
  sleeve: 'sleeve',
  upperArm: 'skin',
  forearm: 'skin',
  thigh: 'skin',
  shin: 'skin',
  sock: 'sock',
  foot: 'boot',
};

/** What each limb is made of, which decides how it takes the light. */
type Surface = 'skin' | 'hair' | 'cloth' | 'boot';
const LIMB_SURFACE: Readonly<Record<Limb, Surface>> = {
  head: 'skin',
  hairCrop: 'hair',
  hairShort: 'hair',
  hairQuiff: 'hair',
  hairCurly: 'hair',
  hairBun: 'hair',
  torso: 'cloth',
  pelvis: 'cloth',
  shortsLeg: 'cloth',
  sleeve: 'cloth',
  upperArm: 'skin',
  forearm: 'skin',
  thigh: 'skin',
  shin: 'skin',
  sock: 'cloth',
  foot: 'boot',
};

/**
 * Where the head joint sits above the torso's own origin.
 *
 * Almost zero, and that is the point. The first version put the head node
 * `neck + 0.4 × headRadius` up and then built the skull entirely BELOW it, so the crown
 * landed 126mm above the shoulder line and the whole figure stood 1.57m — a head shorter
 * than the 1.8m the rig claims, which is most of why twenty-two of them read as lumps.
 * The head now hangs upward off the shoulder line, which also makes `headPitch` pivot at
 * the base of the neck, where a nod actually pivots.
 */
const HEAD_JOINT_Y = 0.015;
const NECK_LENGTH = 0.1;
/** Centre of the skull above the head joint. */
const SKULL_Y = NECK_LENGTH + RIG.headRadius * 0.94;
const HR = RIG.headRadius;

/**
 * Baked shades. The instance colour MULTIPLIES the vertex colour, so a part baked dark grey
 * comes out as a darker version of whatever the instance is — a boot's sole in the boot's
 * colour but deeper, lips in the player's own skin. Near-black is near-black on anyone,
 * which is what the eyes and brows want.
 */
const W = 0xffffff;
const SOLE = 0x2a2a2a;
const EYE = 0x141414;
const BROW = 0xb8aca6;
const LIP = 0xc7928a;
/** A little baked occlusion where cloth folds or meets skin. */
const CREASE = 0xd6d6d6;

/**
 * Geometry per limb, built once. White except where a shade is baked (see above) — the
 * colour arrives per instance, so one geometry serves both teams, every skin tone and every
 * hair colour.
 *
 * Smooth-shaded solids of revolution, not boxes. The first figure was flat-shaded boxes and
 * capsules, which holds up at broadcast distance and falls apart the moment the camera comes
 * in for a replay: a thigh that does not taper, a head with no face and a boot that is a
 * brick. The profiles below are measured off a 1.8m adult, and they are what a close-up is.
 */
function buildLimbGeometry(limb: Limb): THREE.BufferGeometry {
  // A scalp shell: tilted back so the hairline sits above the brow rather than over the
  // eyes, which is the failure mode of every procedural haircut.
  const scalp = (rx: number, ry: number, rz: number, lift: number, tilt = -0.5) => ({
    geo: ellipsoid(rx, ry, rz, 14),
    color: W,
    pos: [0, SKULL_Y + lift, -0.012] as [number, number, number],
    rot: [tilt, 0, 0] as [number, number, number],
  });
  switch (limb) {
    case 'head':
      // Neck, skull, jaw, and a face: brow, nose, eyes, ears, lips. At broadcast distance
      // none of it resolves; in a replay it is the difference between a person and a doll.
      return mergeParts([
        { geo: lathe([[0.05, NECK_LENGTH + 0.02], [0.052, NECK_LENGTH * 0.5], [0.06, 0]], 10), color: W },
        { geo: ellipsoid(HR * 0.9, HR * 1.0, HR * 1.0, 16), color: W, pos: [0, SKULL_Y, -0.006] },
        // The jaw: narrower than the skull, carried forward, and down.
        { geo: ellipsoid(HR * 0.7, HR * 0.6, HR * 0.74, 12), color: W, pos: [0, SKULL_Y - 0.055, 0.012] },
        { geo: ellipsoid(0.028, 0.02, 0.024, 8), color: W, pos: [0, SKULL_Y - 0.1, 0.045] },
        // Brow ridge: shape, not colour — a dark bar here reads as sunglasses.
        { geo: ellipsoid(0.05, 0.011, 0.018, 8), color: BROW, pos: [0, SKULL_Y + 0.028, 0.098] },
        { geo: ellipsoid(0.012, 0.024, 0.018, 8), color: W, pos: [0, SKULL_Y - 0.004, 0.11] },
        { geo: ellipsoid(0.008, 0.006, 0.004, 6), color: EYE, pos: [-0.032, SKULL_Y + 0.011, 0.103] },
        { geo: ellipsoid(0.008, 0.006, 0.004, 6), color: EYE, pos: [0.032, SKULL_Y + 0.011, 0.103] },
        { geo: ellipsoid(0.02, 0.006, 0.01, 6), color: LIP, pos: [0, SKULL_Y - 0.05, 0.093] },
        { geo: ellipsoid(0.01, 0.026, 0.018, 6), color: W, pos: [-HR * 0.9, SKULL_Y - 0.004, -0.005] },
        { geo: ellipsoid(0.01, 0.026, 0.018, 6), color: W, pos: [HR * 0.9, SKULL_Y - 0.004, -0.005] },
      ]);
    case 'hairCrop':
      // Clippered: a skin-tight shell.
      return mergeParts([scalp(HR * 0.935, HR * 0.72, HR * 1.04, 0.026, -0.5)]);
    case 'hairShort':
      return mergeParts([
        scalp(HR * 0.96, HR * 0.78, HR * 1.07, 0.03),
        // Sideburns down to the top of the ear.
        { geo: ellipsoid(0.008, 0.028, 0.02, 6), color: W, pos: [-HR * 0.9, SKULL_Y + 0.004, 0.02] },
        { geo: ellipsoid(0.008, 0.028, 0.02, 6), color: W, pos: [HR * 0.9, SKULL_Y + 0.004, 0.02] },
      ]);
    case 'hairQuiff':
      // Short at the sides, volume on top swept forward.
      return mergeParts([
        scalp(HR * 0.95, HR * 0.74, HR * 1.05, 0.028),
        { geo: ellipsoid(HR * 0.62, HR * 0.4, HR * 0.9, 12), color: W, pos: [0, SKULL_Y + 0.085, 0.03], rot: [-0.25, 0, 0] },
      ]);
    case 'hairCurly':
      // A full, rounded shape standing clear of the scalp, with a few lumps so the edge
      // against the sky is not a perfect curve.
      return mergeParts([
        scalp(HR * 1.08, HR * 0.95, HR * 1.14, 0.045, -0.35),
        { geo: ellipsoid(0.05, 0.045, 0.05, 8), color: W, pos: [-0.06, SKULL_Y + 0.085, -0.01] },
        { geo: ellipsoid(0.05, 0.045, 0.05, 8), color: W, pos: [0.06, SKULL_Y + 0.085, -0.01] },
        { geo: ellipsoid(0.055, 0.045, 0.05, 8), color: W, pos: [0, SKULL_Y + 0.1, 0.03] },
        { geo: ellipsoid(0.055, 0.05, 0.05, 8), color: W, pos: [0, SKULL_Y + 0.07, -0.08] },
      ]);
    case 'hairBun':
      // Pulled back tight, with a bun at the crown.
      return mergeParts([
        scalp(HR * 0.95, HR * 0.76, HR * 1.06, 0.028),
        { geo: ellipsoid(0.045, 0.04, 0.045, 10), color: W, pos: [0, SKULL_Y + 0.1, -0.085] },
      ]);
    case 'torso': {
      // Hem to shoulders as one lathe, flattened front-to-back into the shape of a chest,
      // plus deltoid caps and a collar. One continuous surface — the pattern shader draws
      // across it in the torso's own coordinates, so a hoop stays one hoop.
      const DEPTH = 0.58;
      const body = lathe([
        [0.06, 0.012], [0.13, 0.004], [0.18, -0.03], [0.205, -0.075], [0.212, -0.17],
        [0.2, -0.28], [0.183, -0.38], [0.176, -0.46], [0.18, -0.52], [0.17, -0.535],
      ], 20);
      body.scale(1, 1, DEPTH);
      return mergeParts([
        { geo: body, color: W },
        { geo: ellipsoid(0.08, 0.07, 0.075, 12), color: W, pos: [-0.172, -0.058, 0] },
        { geo: ellipsoid(0.08, 0.07, 0.075, 12), color: W, pos: [0.172, -0.058, 0] },
        { geo: torus(0.068, 0.014, 16), color: CREASE, pos: [0, 0.004, 0.006], rot: [Math.PI / 2 + 0.25, 0, 0], scale: [1, 0.78, 1] },
      ]);
    }
    case 'pelvis': {
      // The seat of the shorts: a rounded waist closing under the crotch. The legs of the
      // shorts are NOT here — they ride the thighs (shortsLeg), or a striding thigh pokes
      // out through a pair of shorts that stayed where they were.
      const hips = lathe([[0.168, 0.012], [0.182, -0.06], [0.186, -0.12], [0.16, -0.19], [0.08, -0.215]], 16);
      hips.scale(1, 1, 0.66);
      return mergeParts([
        { geo: hips, color: W },
        { geo: torus(0.17, 0.01, 18), color: CREASE, pos: [0, 0.008, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 0.66, 1] },
      ]);
    }
    case 'shortsLeg':
      // Over the top of the thigh, following it: a loose tube that flares to the hem.
      return mergeParts([
        { geo: ellipsoid(0.1, 0.07, 0.1, 12), color: W, pos: [0, 0.0, 0] },
        { geo: lathe([[0.1, 0], [0.104, -0.09], [0.108, -0.17], [0.106, -0.178]], 14), color: W, scale: [0.97, 1, 1.07] },
        { geo: torus(0.105, 0.006, 16), color: CREASE, pos: [0, -0.174, 0], rot: [Math.PI / 2, 0, 0], scale: [0.97, 1.07, 1] },
      ]);
    case 'sleeve':
      // A short sleeve over the top of the upper arm, with a cuff.
      return mergeParts([
        { geo: ellipsoid(0.072, 0.07, 0.07, 12), color: W, pos: [0, -0.012, 0] },
        { geo: lathe([[0.072, -0.01], [0.07, -0.08], [0.066, -0.155], [0.064, -0.162]], 12), color: W },
        { geo: torus(0.063, 0.007, 14), color: CREASE, pos: [0, -0.158, 0], rot: [Math.PI / 2, 0, 0] },
      ]);
    case 'upperArm':
      return mergeParts([
        { geo: sphere(0.052, 10), color: W },
        // Deltoid into bicep, narrowing to the elbow.
        { geo: lathe([[0.052, 0], [0.05, -0.06], [0.049, -0.13], [0.043, -0.22], [0.038, -RIG.upperArm]], 12), color: W },
      ]);
    case 'forearm':
      return mergeParts([
        { geo: sphere(0.039, 10), color: W },
        // Thick below the elbow, thin at the wrist — the forearm's one characteristic curve.
        { geo: lathe([[0.04, 0], [0.043, -0.06], [0.038, -0.15], [0.027, -RIG.forearm + 0.015], [0.026, -RIG.forearm]], 12), color: W, scale: [1, 1, 0.9] },
        // A loosely closed hand: palm, knuckles, thumb.
        { geo: ellipsoid(0.03, 0.05, 0.022, 10), color: W, pos: [0, -RIG.forearm - 0.045, 0.004] },
        { geo: ellipsoid(0.026, 0.02, 0.026, 8), color: W, pos: [0, -RIG.forearm - 0.088, 0.012] },
        { geo: capsule(0.011, 0.03), color: W, pos: [0, -RIG.forearm - 0.04, 0.03], rot: [0.5, 0, 0] },
      ]);
    case 'thigh':
      // Widest just below the hip where the quad sits, tapering hard into the knee.
      return mergeParts([
        { geo: sphere(0.08, 12), color: W, pos: [0, 0.005, 0] },
        { geo: lathe([[0.08, 0], [0.087, -0.09], [0.08, -0.2], [0.066, -0.32], [0.054, -RIG.thigh]], 14), color: W, scale: [0.95, 1, 1.06] },
        { geo: sphere(0.055, 10), color: W, pos: [0, -RIG.thigh, 0.004] },
      ]);
    case 'shin': {
      // The calf is behind the shinbone, not around it: a lathe for the bone line and an
      // offset ellipsoid for the muscle, which is what makes a leg read side-on.
      return mergeParts([
        { geo: sphere(0.054, 10), color: W, pos: [0, -0.01, 0] },
        { geo: lathe([[0.053, 0], [0.056, -0.07], [0.046, -0.2], [0.035, -0.34], [0.033, -RIG.shin]], 12), color: W },
        { geo: ellipsoid(0.045, 0.1, 0.045, 10), color: W, pos: [0, -0.13, -0.018] },
      ]);
    }
    case 'sock':
      // Knee-length, over the calf, with the turned-over top a real sock has. Radii sit
      // just outside the shin and calf at every height or the skin pokes through.
      return mergeParts([
        { geo: lathe([[0.066, -0.075], [0.068, -0.1], [0.063, -0.16], [0.05, -0.26], [0.041, -0.35], [0.039, -RIG.shin - 0.005]], 12), color: W, scale: [1, 1, 1.02], pos: [0, 0, -0.006] },
        { geo: torus(0.064, 0.009, 14), color: CREASE, pos: [0, -0.082, -0.006], rot: [Math.PI / 2, 0, 0] },
      ]);
    case 'foot':
      // Origin at the ankle. A boot: collar, a heel counter, a tapered upper running to a
      // rounded toe, and a darker sole, all in the boot colour. The sole's underside lands
      // at the ankle height gait.ts plants on.
      return mergeParts([
        { geo: cylinder(0.042, 0.046, 0.05, 10), color: W, pos: [0, -0.018, -0.008] },
        { geo: ellipsoid(0.048, 0.04, 0.058, 10), color: W, pos: [0, -0.034, -0.03] },
        { geo: ellipsoid(0.047, 0.033, 0.12, 12), color: W, pos: [0, -0.036, 0.055] },
        { geo: ellipsoid(0.04, 0.026, 0.05, 10), color: W, pos: [0, -0.042, 0.14] },
        { geo: ellipsoid(0.05, 0.009, 0.14, 12), color: SOLE, pos: [0, -0.059, 0.045] },
        // A stripe down the side: every boot has one, and it is what sells it as a boot.
        { geo: ellipsoid(0.049, 0.01, 0.05, 8), color: CREASE, pos: [0, -0.03, 0.035], rot: [0.35, 0, 0] },
      ]);
  }
}

export interface FigureColors {
  /** KIT_PATTERNS index on the torso, its colour, and the chest badge's colour (-1: none). */
  pattern?: number;
  patternColour?: number;
  chest?: number;
  shirt: number;
  /** Contrast sleeves are a kit, not a pattern: the sleeve is its own instanced group. */
  sleeve: number;
  shorts: number;
  sock: number;
  skin: number;
  hair: number;
  boot: number;
  /** HAIR_STYLES index. Defaults to the short cut. */
  hairStyle?: number;
  /** The number on the back, 1–99, or absent for none (the officials). */
  number?: number;
  /** Its colour, and a NUMBER_STYLES index for how it is set. */
  numberColour?: number;
  numberStyle?: number;
}

function tintOf(colors: FigureColors, tint: Tint): number {
  switch (tint) {
    case 'shirt':
      return colors.shirt;
    case 'sleeve':
      return colors.sleeve;
    case 'shorts':
      return colors.shorts;
    case 'sock':
      return colors.sock;
    case 'skin':
      return colors.skin;
    case 'hair':
      return colors.hair;
    case 'boot':
      return colors.boot;
  }
}

/**
 * All the figures on the pitch. `count` is fixed at construction; a figure that is not
 * currently needed is scaled to nothing rather than removed, because changing an
 * InstancedMesh's count every frame defeats the point of instancing.
 */
export class FigureField {
  readonly group = new THREE.Group();
  readonly #meshes = new Map<Limb, THREE.InstancedMesh>();
  readonly #materials: THREE.Material[] = [];
  readonly #digits: THREE.Texture;
  #pattern!: THREE.InstancedBufferAttribute;
  #trim!: THREE.InstancedBufferAttribute;
  #chest!: THREE.InstancedBufferAttribute;
  #number!: THREE.InstancedBufferAttribute;
  readonly #count: number;
  /** Per-figure uniform scale, so a squad is not eleven identical men. */
  readonly #builds: Float32Array;
  /** Per-figure HAIR_STYLES index. */
  readonly #hair: Uint8Array;
  readonly #m = new THREE.Matrix4();
  readonly #q = new THREE.Quaternion();
  readonly #e = new THREE.Euler();
  readonly #v = new THREE.Vector3();
  readonly #scale = new THREE.Vector3(1, 1, 1);
  readonly #one = new THREE.Vector3(1, 1, 1);
  readonly #zero = new THREE.Vector3(0, 0, 0);
  readonly #hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  readonly #color = new THREE.Color();
  /** Scratch matrices for the joint chain, so the hot path allocates nothing. */
  readonly #root = new THREE.Matrix4();
  readonly #body = new THREE.Matrix4();
  readonly #hips = new THREE.Matrix4();
  readonly #chain = new THREE.Matrix4();
  readonly #torso = new THREE.Matrix4();
  readonly #upper = new THREE.Matrix4();
  readonly #knee = new THREE.Matrix4();

  constructor(count: number) {
    this.#count = count;
    this.#builds = new Float32Array(count).fill(1);
    this.#hair = new Uint8Array(count).fill(1);
    this.group.name = 'figures';
    this.#digits = digitAtlas();

    // One material per surface. Skin has a soft sheen and no more; hair is matte; boots are
    // glossy synthetic; cloth gets the physical material's sheen lobe, which is the
    // grazing-angle brightening that makes a shirt read as fabric rather than plastic.
    const skin = smoothPaintMaterial(0.58);
    const hair = smoothPaintMaterial(0.85);
    const boot = smoothPaintMaterial(0.32);
    const cloth = clothMaterial();
    const torso = torsoMaterial(this.#digits);
    this.#materials.push(skin, hair, boot, cloth, torso);
    const surfaces: Record<Surface, THREE.Material> = { skin, hair, boot, cloth };

    for (const limb of LIMBS) {
      const geo = buildLimbGeometry(limb);
      if (limb === 'torso') {
        // Per player: which pattern and its colour, the badge, and the number on the back.
        this.#pattern = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
        this.#trim = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
        this.#chest = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
        this.#number = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
        geo.setAttribute('aTlPattern', this.#pattern);
        geo.setAttribute('aTlTrim', this.#trim);
        geo.setAttribute('aTlChest', this.#chest);
        geo.setAttribute('aTlNumber', this.#number);
      }
      const material = limb === 'torso' ? torso : surfaces[LIMB_SURFACE[limb]];
      const mesh = new THREE.InstancedMesh(geo, material, count * LIMB_COUNT[limb]);
      mesh.name = `limb:${limb}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false; // the pitch is always in view; culling a dozen meshes saves nothing
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.#meshes.set(limb, mesh);
      this.group.add(mesh);
      // Everything starts hidden; setPose reveals a figure by giving it a real matrix.
      for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, this.#hidden);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Turn cast shadows on or off for every limb at once. Called by the tier governor: the
   * shadow pass is the first thing a slow machine gives up.
   */
  setCastShadow(on: boolean): void {
    for (const mesh of this.#meshes.values()) mesh.castShadow = on;
  }

  /**
   * Whether the figures take shadows as well as casting them. On for the tiers with a
   * shadow map: a player's own arm shading his shirt is most of what makes him solid.
   */
  setReceiveShadow(on: boolean): void {
    for (const mesh of this.#meshes.values()) mesh.receiveShadow = on;
  }

  /** Set one figure's kit, skin and hair. Cheap; call it when a team or a substitute changes. */
  setColors(index: number, colors: FigureColors): void {
    for (const limb of LIMBS) {
      const mesh = this.#meshes.get(limb);
      if (!mesh) continue;
      this.#color.setHex(tintOf(colors, LIMB_TINT[limb]));
      const n = LIMB_COUNT[limb];
      for (let k = 0; k < n; k++) mesh.setColorAt(index * n + k, this.#color);
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    if (index < 0 || index >= this.#count) return;
    this.#hair[index] = Math.max(0, Math.min(HAIR_STYLES.length - 1, colors.hairStyle ?? 1));
    // setHex converts to the working (linear) space, exactly as setColorAt does, so the
    // pattern is lit the same way as the shirt around it.
    this.#pattern.setX(index, colors.pattern ?? 0);
    this.#color.setHex(colors.patternColour ?? colors.shirt);
    this.#trim.setXYZ(index, this.#color.r, this.#color.g, this.#color.b);
    const chest = colors.chest ?? -1;
    this.#color.setHex(chest < 0 ? 0 : chest);
    this.#chest.setXYZW(index, this.#color.r, this.#color.g, this.#color.b, chest < 0 ? 0 : 1);
    // The number rides as (colour.rgb, number + style / 8): the style is the fraction, so
    // one vec4 carries all of it. Zero means no number.
    const num = colors.number ?? 0;
    this.#color.setHex(colors.numberColour ?? 0xffffff);
    const style = Math.max(0, Math.min(3, colors.numberStyle ?? 0));
    this.#number.setXYZW(index, this.#color.r, this.#color.g, this.#color.b, num > 0 ? Math.min(99, num) + style / 8 : 0);
    this.#pattern.needsUpdate = true;
    this.#trim.needsUpdate = true;
    this.#chest.needsUpdate = true;
    this.#number.needsUpdate = true;
  }

  /**
   * How big this figure is, as a multiplier on the whole rig. Uniform on purpose: scale
   * the root and the joint offsets scale with it, so a taller player's legs still reach
   * the ground without the pose solver knowing anything about him.
   */
  setBuild(index: number, scale: number): void {
    if (index >= 0 && index < this.#count) this.#builds[index] = scale;
  }

  /** Hide a figure entirely (a substituted player, or an unused slot). */
  hide(index: number): void {
    for (const limb of LIMBS) {
      const mesh = this.#meshes.get(limb);
      if (!mesh) continue;
      const n = LIMB_COUNT[limb];
      for (let k = 0; k < n; k++) mesh.setMatrixAt(index * n + k, this.#hidden);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Write one figure's limb matrices from a pose.
   *
   * `x`/`z` are on the pitch plane in world units, `facing` is the heading in radians
   * measured the same way the simulation measures it.
   *
   * Sign conventions, all measured in world space by figure.test.ts rather than asserted:
   * positive `lean` tips the shoulders FORWARD, positive `headPitch` nods DOWN, positive
   * `shoulderPitch` and `hipPitch` swing the limb forward, and positive `*Roll` takes a limb
   * out from the body. Lean and head pitch were both applied with the opposite sign until
   * that test existed, and every sprinter in the game ran leaning back.
   */
  setPose(index: number, x: number, z: number, facing: number, pose: Pose): void {
    // Root: on the grass, turned to face, at this player's own size. The sim's facing is
    // measured from +X in its own 2D frame; the scene's forward for a figure is +Z, hence
    // the quarter turn.
    this.#e.set(0, -facing + Math.PI / 2, 0);
    this.#q.setFromEuler(this.#e);
    this.#v.set(x, 0, z);
    const build = this.#builds[index] as number;
    this.#scale.set(build, build, build);
    this.#root.compose(this.#v, this.#q, this.#scale);

    // Body: lean and roll about the hips.
    this.#e.set(pose.lean, 0, pose.roll);
    this.#q.setFromEuler(this.#e);
    this.#v.set(0, pose.hipY, 0);
    this.#body.compose(this.#v, this.#q, this.#one);
    this.#body.premultiply(this.#root);

    // Hips: the legs run along `legYaw`, which is not always where the chest is pointing.
    this.#e.set(0, pose.legYaw, 0);
    this.#q.setFromEuler(this.#e);
    this.#hips.compose(this.#zero, this.#q, this.#one);
    this.#hips.premultiply(this.#body);

    // --- pelvis and torso ---
    this.#setLimb('pelvis', index, 0, this.#hips);

    // Torso hangs UP from the hips, twisted against them and bent at the upper spine.
    this.#e.set(pose.chest, pose.twist, 0);
    this.#q.setFromEuler(this.#e);
    this.#v.set(0, RIG.torso, 0);
    this.#chain.compose(this.#v, this.#q, this.#one);
    this.#chain.premultiply(this.#body);
    this.#torso.copy(this.#chain);
    this.#setLimb('torso', index, 0, this.#torso);

    // Head, hanging up off the shoulder line: yaw first, then the nod. Hair rides with it,
    // and only this figure's own haircut gets a real matrix.
    this.#e.set(pose.headPitch, pose.headYaw, 0, 'YXZ');
    this.#q.setFromEuler(this.#e);
    this.#e.order = 'XYZ';
    this.#v.set(0, HEAD_JOINT_Y, 0);
    this.#chain.compose(this.#v, this.#q, this.#one);
    this.#chain.premultiply(this.#torso);
    this.#setLimb('head', index, 0, this.#chain);
    const hair = this.#hair[index] as number;
    for (let h = 0; h < HAIR_STYLES.length; h++) {
      this.#setLimb(HAIR_STYLES[h] as HairLimb, index, 0, h === hair ? this.#chain : this.#hidden);
    }

    // --- arms ---
    for (let arm = 0; arm < 2; arm++) {
      const side = arm === 0 ? -1 : 1;
      // The Z term is how far the arms hang off the body. At 0.13 they hugged the torso
      // and the figure read as armless from the broadcast angle; a footballer runs with
      // daylight under his elbows. The pose adds its own abduction on top.
      this.#e.set(-(pose.shoulderPitch[arm] as number), 0, side * (0.14 + (pose.shoulderRoll[arm] as number)));
      this.#q.setFromEuler(this.#e);
      this.#v.set((side * RIG.shoulderWidth) / 2, -0.05, 0);
      this.#chain.compose(this.#v, this.#q, this.#one);
      this.#chain.premultiply(this.#torso);
      this.#upper.copy(this.#chain);
      // Sleeve and bare arm share the shoulder joint exactly; two groups, one matrix.
      this.#setLimb('sleeve', index, arm, this.#upper);
      this.#setLimb('upperArm', index, arm, this.#upper);

      // An elbow folds FORWARD. A knee folds backward, and both joints were being given
      // the same +X rotation — so every figure ran with its forearms swinging out behind
      // it, which is the pose of something that does not have elbows. Limbs extend down
      // from their joint, and +X takes a down vector toward -Z, so the knee's sign is
      // right and the elbow's is the negation of it.
      this.#e.set(-(pose.elbowBend[arm] as number), 0, 0);
      this.#q.setFromEuler(this.#e);
      this.#v.set(0, -RIG.upperArm, 0);
      this.#chain.compose(this.#v, this.#q, this.#one);
      this.#chain.premultiply(this.#upper);
      this.#setLimb('forearm', index, arm, this.#chain);
    }

    // --- legs ---
    for (let leg = 0; leg < 2; leg++) {
      const side = leg === 0 ? -1 : 1;
      this.#e.set(-(pose.hipPitch[leg] as number), side * (pose.hipYaw[leg] as number), side * (pose.hipRoll[leg] as number));
      this.#q.setFromEuler(this.#e);
      this.#v.set((side * RIG.hipWidth) / 2, -0.02, 0);
      this.#chain.compose(this.#v, this.#q, this.#one);
      this.#chain.premultiply(this.#hips);
      this.#upper.copy(this.#chain);
      this.#setLimb('thigh', index, leg, this.#upper);
      this.#setLimb('shortsLeg', index, leg, this.#upper);

      // The knee bends the shin BACKWARD relative to the thigh, which is +X rotation
      // given limbs that extend down and swing forward on -X.
      this.#e.set(pose.kneeBend[leg] as number, 0, 0);
      this.#q.setFromEuler(this.#e);
      this.#v.set(0, -RIG.thigh, 0);
      this.#chain.compose(this.#v, this.#q, this.#one);
      this.#chain.premultiply(this.#upper);
      this.#knee.copy(this.#chain);
      this.#setLimb('shin', index, leg, this.#knee);
      this.#setLimb('sock', index, leg, this.#knee);

      this.#e.set(-(pose.anklePitch[leg] as number), 0, 0);
      this.#q.setFromEuler(this.#e);
      this.#v.set(0, -RIG.shin, 0);
      this.#chain.compose(this.#v, this.#q, this.#one);
      this.#chain.premultiply(this.#knee);
      this.#setLimb('foot', index, leg, this.#chain);
    }
  }

  /** Push every changed matrix to the GPU. Called once per frame, after all setPose calls. */
  flush(): void {
    for (const mesh of this.#meshes.values()) mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of this.#meshes.values()) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    for (const m of this.#materials) m.dispose();
    this.#digits.dispose();
    this.#meshes.clear();
  }

  get drawCalls(): number {
    return this.#meshes.size;
  }

  get capacity(): number {
    return this.#count;
  }

  #setLimb(limb: Limb, figure: number, which: number, matrix: THREE.Matrix4): void {
    const mesh = this.#meshes.get(limb);
    if (!mesh) return;
    mesh.setMatrixAt(figure * LIMB_COUNT[limb] + which, matrix);
  }
}

/**
 * Kit fabric: vertex-painted, smooth, with a sheen lobe. Sheen is the physical material's
 * model of fibres catching light at grazing angles — the soft bright edge a shirt has
 * against a dark background and a plastic one does not.
 */
function clothMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.82,
    metalness: 0,
    sheen: 0.55,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color(0xffffff),
  });
}

/**
 * The cloth material with three things added to the torso: the shirt pattern, evaluated
 * per pixel from the torso's own coordinates (src/render/kitPattern.ts has the masks and
 * the reasoning), a small badge on the left of the chest, and the number on the back.
 * Local coordinates, not UVs, because the torso is a lathe plus caps whose UVs have
 * nothing to do with the shirt — a hoop drawn in UV space would not be a hoop.
 *
 * The number samples `digitAtlas()`: ten digits across, one row per NUMBER_STYLES entry.
 * One digit sits centred; two sit side by side, each half the width. Seen from behind the
 * figure's +X is on the viewer's LEFT, so the tens digit goes on +X.
 */
function torsoMaterial(digits: THREE.Texture): THREE.MeshPhysicalMaterial {
  const m = clothMaterial();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.tlDigits = { value: digits };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aTlPattern;
        attribute vec3 aTlTrim;
        attribute vec4 aTlChest;
        attribute vec4 aTlNumber;
        varying float vTlPattern;
        varying vec3 vTlTrim;
        varying vec4 vTlChest;
        varying vec4 vTlNumber;
        varying vec3 vTlLocal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vTlPattern = aTlPattern;
        vTlTrim = aTlTrim;
        vTlChest = aTlChest;
        vTlNumber = aTlNumber;
        vTlLocal = position;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tlDigits;
        varying float vTlPattern;
        varying vec3 vTlTrim;
        varying vec4 vTlChest;
        varying vec4 vTlNumber;
        varying vec3 vTlLocal;
        ${PATTERN_GLSL}
        float tlDigit(float d, float style, vec2 uv) {
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
          vec2 cell = vec2((d + uv.x) / 10.0, 1.0 - (style + uv.y) / 4.0);
          return texture2D(tlDigits, cell).a;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 tlQ = vec2(vTlLocal.x / ${TORSO_HALF_WIDTH.toFixed(3)}, -vTlLocal.y / ${TORSO_HEIGHT.toFixed(3)});
        diffuseColor.rgb = mix(diffuseColor.rgb, vTlTrim, tlPatternMask(vTlPattern, tlQ));
        if (vTlChest.w > 0.5 && vTlLocal.z > 0.08
            && length(vTlLocal.xy - vec2(0.09, -0.14)) < 0.04) {
          diffuseColor.rgb = vTlChest.rgb;
        }
        if (vTlNumber.w > 0.5 && vTlLocal.z < -0.05) {
          float num = floor(vTlNumber.w);
          float style = floor(fract(vTlNumber.w) * 8.0 + 0.5);
          // The number block: 0.3m tall, from 0.1m below the collar.
          float nv = (-vTlLocal.y - 0.1) / 0.3;
          float ink = 0.0;
          if (num >= 10.0) {
            float nu = (0.2 - vTlLocal.x) / 0.4;
            ink = max(tlDigit(floor(num / 10.0), style, vec2(nu * 2.0, nv)),
                      tlDigit(mod(num, 10.0), style, vec2(nu * 2.0 - 1.0, nv)));
          } else {
            ink = tlDigit(num, style, vec2((0.1 - vTlLocal.x) / 0.2, nv));
          }
          diffuseColor.rgb = mix(diffuseColor.rgb, vTlNumber.rgb, ink);
        }`);
  };
  return m;
}
