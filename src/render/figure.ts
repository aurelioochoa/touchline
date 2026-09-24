// Twenty-five footballers and officials: one sculpted body, drawn twenty-five times.
//
// The body is a single closed mesh (body.ts describes it, sculpt.ts builds it), skinned to
// thirteen bones. There is no SkinnedMesh here, because three.js skins one mesh per draw
// call and twenty-five of them is twenty-five draw calls plus twenty-five skeleton
// uploads. Instead the body is ONE InstancedMesh, and the skinning happens in its vertex
// shader: every figure's bone matrices sit in a row of a small float texture, and each
// instance reads its own row by `gl_InstanceID`. The figure's colours ride in the same row,
// so the whole squad — both kits, every skin tone — is one draw call for the bodies and
// five for the haircuts (design §12).
//
// The first figure was the other way round: sixteen rigid primitives per player, one
// InstancedMesh per limb type. Cheap, and it looked exactly like what it was — a kit of
// parts, with a ball at every joint and a gap wherever two tubes met. A body that is one
// skin bends at the knee the way a knee bends, and has a shoulder rather than a sphere
// where the arm meets the chest.
//
// Frame convention, per figure: +Z is the way he is facing, +Y is up, the origin is on the
// grass between his feet.
//
// THE KIT IS PAINTED, NOT MODELLED. Which part of the body is shirt, shorts, sock or boot is
// decided per pixel from the vertex's position in the bind pose (body.ts `kitLines`), so a
// hem is a crisp line however coarse the mesh, and one mesh serves every kit.

import * as THREE from 'three';
import { ellipsoid, mergeParts } from './kit.js';
import { type Pose } from './gait.js';
import { PATTERN_GLSL, TORSO_HALF_WIDTH, TORSO_HEIGHT } from './kitPattern.js';
import { digitAtlas } from './textures.js';
import { sculpt } from './sculpt.js';
import {
  BODY_MAX, BODY_MIN, BONE_COUNT, BONES, EYE_R, EYE_X, EYE_Y, EYE_Z, SKULL_Y, SLEEVE,
  bindMatrices, bodyVolumes, bone, kitLines, poseBones, poseScratch, type Bone,
} from './body.js';

/**
 * The haircuts. Each is its own instanced group, and a figure shows exactly one of them:
 * the others get a zero matrix, the same way a substituted player is hidden. Five extra
 * draw calls buys a squad that is not eleven identical swim caps.
 */
export const HAIR_STYLES = ['hairCrop', 'hairShort', 'hairQuiff', 'hairCurly', 'hairBun'] as const;
type HairStyle = (typeof HAIR_STYLES)[number];

/** Grid spacing the body is sculpted at, unless the quality tier asks for another (tiers.ts). */
const BODY_CELL = 0.013;

/**
 * One row of the figure texture: the bones' skinning matrices (four texels each), then the
 * colours. The shader indexes these by number, so the order is load-bearing.
 */
const COL = {
  shirt: BONE_COUNT * 4,
  sleeve: BONE_COUNT * 4 + 1,
  shorts: BONE_COUNT * 4 + 2,
  sock: BONE_COUNT * 4 + 3,
  skin: BONE_COUNT * 4 + 4,
  boot: BONE_COUNT * 4 + 5,
  hair: BONE_COUNT * 4 + 6,
  /** rgb: the pattern's colour; a: the KIT_PATTERNS index. */
  trim: BONE_COUNT * 4 + 7,
  /** rgb: the badge; a: 1 if there is one. */
  chest: BONE_COUNT * 4 + 8,
  /** rgb: the number's colour; a: number + style / 8, or 0 for none. */
  number: BONE_COUNT * 4 + 9,
  /** rgb: the iris. */
  iris: BONE_COUNT * 4 + 10,
} as const;
const ROW = 64;

/**
 * Built once per page and resolution: sculpting takes a few hundred milliseconds and the
 * body never changes. The bind pose is the same at every resolution.
 */
const shared = new Map<number, THREE.BufferGeometry>();
const bind = bindMatrices();
const bindInv = bind.map((m) => m.clone().invert());
function body(cell = BODY_CELL) {
  let geometry = shared.get(cell);
  if (!geometry) {
    geometry = sculpt({ bind, volumes: bodyVolumes(bind), cell, min: BODY_MIN, max: BODY_MAX }).geometry;
    shared.set(cell, geometry);
  }
  return { geometry, bind, bindInv };
}

/**
 * The haircuts, as shells over the cranium in the head bone's frame.
 *
 * Written against the old, oversized skull and then fitted to the sculpted one by the same
 * affine map that takes one cranium onto the other — the shapes are the same haircut, the
 * head under them is simply the right size now.
 */
const OLD_SKULL = { c: new THREE.Vector3(0, SKULL_Y, -0.006), r: new THREE.Vector3(0.1035, 0.115, 0.115) };
const CRANIUM = { c: new THREE.Vector3(0, SKULL_Y + 0.02, -0.012), r: new THREE.Vector3(0.077, 0.092, 0.1) };
function buildHair(style: HairStyle): THREE.BufferGeometry {
  const HR = 0.115;
  const W = 0xffffff;
  const scalp = (rx: number, ry: number, rz: number, lift: number, tilt = -0.5) => ({
    geo: ellipsoid(rx, ry, rz, 16),
    color: W,
    pos: [0, SKULL_Y + lift, -0.012] as [number, number, number],
    rot: [tilt, 0, 0] as [number, number, number],
  });
  let geo: THREE.BufferGeometry;
  switch (style) {
    case 'hairCrop':
      geo = mergeParts([scalp(HR * 0.935, HR * 0.72, HR * 1.04, 0.026, -0.5)]);
      break;
    case 'hairShort':
      geo = mergeParts([scalp(HR * 0.96, HR * 0.78, HR * 1.07, 0.03)]);
      break;
    case 'hairQuiff':
      geo = mergeParts([
        scalp(HR * 0.95, HR * 0.74, HR * 1.05, 0.028),
        { geo: ellipsoid(HR * 0.62, HR * 0.4, HR * 0.9, 14), color: W, pos: [0, SKULL_Y + 0.085, 0.03], rot: [-0.25, 0, 0] },
      ]);
      break;
    case 'hairCurly':
      geo = mergeParts([
        scalp(HR * 1.08, HR * 0.95, HR * 1.14, 0.045, -0.35),
        { geo: ellipsoid(0.05, 0.045, 0.05, 8), color: W, pos: [-0.06, SKULL_Y + 0.085, -0.01] },
        { geo: ellipsoid(0.05, 0.045, 0.05, 8), color: W, pos: [0.06, SKULL_Y + 0.085, -0.01] },
        { geo: ellipsoid(0.055, 0.045, 0.05, 8), color: W, pos: [0, SKULL_Y + 0.1, 0.03] },
        { geo: ellipsoid(0.055, 0.05, 0.05, 8), color: W, pos: [0, SKULL_Y + 0.07, -0.08] },
      ]);
      break;
    case 'hairBun':
      geo = mergeParts([
        scalp(HR * 0.95, HR * 0.76, HR * 1.06, 0.028),
        { geo: ellipsoid(0.045, 0.04, 0.045, 10), color: W, pos: [0, SKULL_Y + 0.1, -0.085] },
      ]);
      break;
  }
  // Old cranium onto new, a few percent proud so the shell never sinks into the scalp.
  const s = CRANIUM.r.clone().divide(OLD_SKULL.r).multiplyScalar(1.035);
  geo.translate(-OLD_SKULL.c.x, -OLD_SKULL.c.y, -OLD_SKULL.c.z);
  geo.scale(s.x, s.y, s.z);
  geo.translate(CRANIUM.c.x, CRANIUM.c.y, CRANIUM.c.z);
  // And nowhere inside the cranium: a clippered cut is a millimetre-thin shell, and where
  // it dipped under the sculpted scalp the crown showed through as a bald patch.
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  const d = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    d.fromBufferAttribute(p, i).sub(CRANIUM.c);
    const k = Math.hypot(d.x / CRANIUM.r.x, d.y / CRANIUM.r.y, d.z / CRANIUM.r.z);
    if (k < 1.05) d.multiplyScalar(1.05 / k);
    p.setXYZ(i, CRANIUM.c.x + d.x, CRANIUM.c.y + d.y, CRANIUM.c.z + d.z);
  }
  geo.computeVertexNormals();
  return geo;
}

export interface FigureColors {
  /** KIT_PATTERNS index on the torso, its colour, and the chest badge's colour (-1: none). */
  pattern?: number;
  patternColour?: number;
  chest?: number;
  shirt: number;
  /** Contrast sleeves are a kit, not a pattern. */
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
  /** 0..1: how much stubble or beard, in the hair's colour. */
  beard?: number;
  /** The colour of his eyes. */
  eyes?: number;
}

/**
 * All the figures on the pitch. `count` is fixed at construction; a figure that is not
 * currently needed is scaled to nothing rather than removed, because changing an
 * InstancedMesh's count every frame defeats the point of instancing.
 */
export class FigureField {
  readonly group = new THREE.Group();
  readonly #body: THREE.InstancedMesh;
  readonly #hairMeshes: THREE.InstancedMesh[] = [];
  readonly #materials: THREE.Material[] = [];
  readonly #digits: THREE.Texture;
  /** One row per figure: skinning matrices, then colours. */
  readonly #data: Float32Array;
  readonly #tex: THREE.DataTexture;
  readonly #count: number;
  /** Per-figure uniform scale, so a squad is not eleven identical men. */
  readonly #builds: Float32Array;
  /** Per-figure HAIR_STYLES index. */
  readonly #hair: Uint8Array;
  /** The last pose's bone matrices per figure, root-relative, and each figure's root. */
  readonly #posed: THREE.Matrix4[][];
  readonly #roots: THREE.Matrix4[];
  readonly #bones = BONES.map(() => new THREE.Matrix4());
  readonly #scratch = poseScratch();
  readonly #m = new THREE.Matrix4();
  readonly #q = new THREE.Quaternion();
  readonly #e = new THREE.Euler();
  readonly #v = new THREE.Vector3();
  readonly #scale = new THREE.Vector3(1, 1, 1);
  readonly #hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  readonly #color = new THREE.Color();

  /** `cell` is the sculpting grid (tiers.ts `bodyCell`): the players' level of detail. */
  constructor(count: number, cell = BODY_CELL) {
    this.#count = count;
    this.#builds = new Float32Array(count).fill(1);
    this.#hair = new Uint8Array(count).fill(1);
    this.#posed = Array.from({ length: count }, () => BONES.map(() => new THREE.Matrix4()));
    this.#roots = Array.from({ length: count }, () => new THREE.Matrix4());
    this.group.name = 'figures';
    this.#digits = digitAtlas();

    this.#data = new Float32Array(ROW * 4 * Math.max(1, count));
    this.#tex = new THREE.DataTexture(this.#data, ROW, Math.max(1, count), THREE.RGBAFormat, THREE.FloatType);
    this.#tex.magFilter = THREE.NearestFilter;
    this.#tex.minFilter = THREE.NearestFilter;
    this.#tex.needsUpdate = true;

    const { geometry } = body(cell);
    const lines = kitLines(bind);
    const material = bodyMaterial(this.#tex, this.#digits, lines);
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    skinDepth(depth, this.#tex);
    this.#materials.push(material, depth);

    this.#body = new THREE.InstancedMesh(geometry, material, count);
    this.#body.name = 'body';
    this.#body.customDepthMaterial = depth;
    this.#initMesh(this.#body);

    // Hair is matte; it rides the head bone rigidly, as a haircut does.
    const hairMat = hairMaterial();
    this.#materials.push(hairMat);
    for (const style of HAIR_STYLES) {
      const mesh = new THREE.InstancedMesh(buildHair(style), hairMat, count);
      mesh.name = `hair:${style}`;
      this.#initMesh(mesh);
      this.#hairMeshes.push(mesh);
    }
  }

  #initMesh(mesh: THREE.InstancedMesh): void {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; // the pitch is always in view; culling six meshes saves nothing
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, this.#hidden);
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
  }

  #meshes(): THREE.InstancedMesh[] {
    return [this.#body, ...this.#hairMeshes];
  }

  /**
   * Turn cast shadows on or off for every figure at once. Called by the tier governor: the
   * shadow pass is the first thing a slow machine gives up.
   */
  setCastShadow(on: boolean): void {
    for (const mesh of this.#meshes()) mesh.castShadow = on;
  }

  /** Whether the figures take shadows as well as casting them: an arm shading a shirt. */
  setReceiveShadow(on: boolean): void {
    for (const mesh of this.#meshes()) mesh.receiveShadow = on;
  }

  /** Set one figure's kit, skin and hair. Cheap; call it when a team or a substitute changes. */
  setColors(index: number, colors: FigureColors): void {
    if (index < 0 || index >= this.#count) return;
    const put = (slot: number, hex: number, a = 1) => {
      // setHex converts to the working (linear) space, so the kit is lit like everything else.
      this.#color.setHex(hex);
      const o = (index * ROW + slot) * 4;
      this.#data[o] = this.#color.r;
      this.#data[o + 1] = this.#color.g;
      this.#data[o + 2] = this.#color.b;
      this.#data[o + 3] = a;
    };
    put(COL.shirt, colors.shirt);
    put(COL.sleeve, colors.sleeve);
    put(COL.shorts, colors.shorts);
    put(COL.sock, colors.sock);
    put(COL.skin, colors.skin);
    put(COL.boot, colors.boot);
    put(COL.hair, colors.hair, colors.beard ?? 0);
    put(COL.iris, colors.eyes ?? 0x4a2f1c);
    put(COL.trim, colors.patternColour ?? colors.shirt, colors.pattern ?? 0);
    const chest = colors.chest ?? -1;
    put(COL.chest, chest < 0 ? 0 : chest, chest < 0 ? 0 : 1);
    // The number rides as (colour, number + style / 8): the style is the fraction.
    const num = colors.number ?? 0;
    const style = Math.max(0, Math.min(3, colors.numberStyle ?? 0));
    put(COL.number, colors.numberColour ?? 0xffffff, num > 0 ? Math.min(99, num) + style / 8 : 0);
    this.#tex.needsUpdate = true;

    this.#color.setHex(colors.hair);
    for (const mesh of this.#hairMeshes) {
      mesh.setColorAt(index, this.#color);
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.#hair[index] = Math.max(0, Math.min(HAIR_STYLES.length - 1, colors.hairStyle ?? 1));
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
    for (const mesh of this.#meshes()) {
      mesh.setMatrixAt(index, this.#hidden);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Pose one figure.
   *
   * `x`/`z` are on the pitch plane in world units, `facing` is the heading in radians
   * measured the same way the simulation measures it. Sign conventions are in body.ts.
   */
  setPose(index: number, x: number, z: number, facing: number, pose: Pose): void {
    if (index < 0 || index >= this.#count) return;
    // Root: on the grass, turned to face, at this player's own size. The sim's facing is
    // measured from +X in its own 2D frame; the scene's forward for a figure is +Z, hence
    // the quarter turn.
    this.#e.set(0, -facing + Math.PI / 2, 0);
    this.#q.setFromEuler(this.#e);
    this.#v.set(x, 0, z);
    const build = this.#builds[index] as number;
    this.#scale.set(build, build, build);
    const root = (this.#roots[index] as THREE.Matrix4).compose(this.#v, this.#q, this.#scale);

    poseBones(pose, this.#bones, this.#scratch);
    const posed = this.#posed[index] as THREE.Matrix4[];
    for (let b = 0; b < BONE_COUNT; b++) {
      const m = this.#bones[b] as THREE.Matrix4;
      (posed[b] as THREE.Matrix4).copy(m);
      this.#m.multiplyMatrices(m, bindInv[b] as THREE.Matrix4);
      this.#data.set(this.#m.elements, (index * ROW + b * 4) * 4);
    }
    this.#body.setMatrixAt(index, root);

    // Only this figure's own haircut gets a real matrix.
    this.#m.multiplyMatrices(root, this.#bones[bone('head')] as THREE.Matrix4);
    const hair = this.#hair[index] as number;
    for (let h = 0; h < HAIR_STYLES.length; h++) {
      (this.#hairMeshes[h] as THREE.InstancedMesh).setMatrixAt(index, h === hair ? this.#m : this.#hidden);
    }
  }

  /**
   * Where one of a figure's joints is in the world after its last `setPose`: the bone's
   * frame, joint at the origin, limb hanging down −Y. What the tests measure directions on.
   */
  jointMatrix(index: number, name: Bone, out = new THREE.Matrix4()): THREE.Matrix4 {
    const posed = this.#posed[index] as THREE.Matrix4[];
    return out.multiplyMatrices(this.#roots[index] as THREE.Matrix4, posed[bone(name)] as THREE.Matrix4);
  }

  /** Push this frame's poses to the GPU. Called once per frame, after all setPose calls. */
  flush(): void {
    for (const mesh of this.#meshes()) mesh.instanceMatrix.needsUpdate = true;
    this.#tex.needsUpdate = true;
  }

  dispose(): void {
    // The body geometry is shared by every field on the page and outlives this one.
    for (const mesh of this.#hairMeshes) mesh.geometry.dispose();
    for (const mesh of this.#meshes()) mesh.dispose();
    for (const m of this.#materials) m.dispose();
    this.#tex.dispose();
    this.#digits.dispose();
    this.#hairMeshes.length = 0;
    this.group.clear();
  }

  get drawCalls(): number {
    return 1 + this.#hairMeshes.length;
  }

  get capacity(): number {
    return this.#count;
  }

  /** Triangles in one body, for the frame budget. */
  static bodyTriangles(cell = BODY_CELL): number {
    const g = body(cell).geometry;
    return (g.index?.count ?? 0) / 3;
  }
}

// ---- shaders ---------------------------------------------------------------------------

/** Shared GLSL: fetch this instance's skinning matrix for a bone. */
const SKIN_HEAD = /* glsl */ `
  uniform highp sampler2D tlFig;
  attribute vec4 skinIndex;
  attribute vec4 skinWeight;
  mat4 tlBone(float b) {
    int x = int(b + 0.5) * 4;
    return mat4(
      texelFetch(tlFig, ivec2(x, gl_InstanceID), 0),
      texelFetch(tlFig, ivec2(x + 1, gl_InstanceID), 0),
      texelFetch(tlFig, ivec2(x + 2, gl_InstanceID), 0),
      texelFetch(tlFig, ivec2(x + 3, gl_InstanceID), 0));
  }
  mat4 tlSkinMatrix() {
    return skinWeight.x * tlBone(skinIndex.x) + skinWeight.y * tlBone(skinIndex.y)
         + skinWeight.z * tlBone(skinIndex.z) + skinWeight.w * tlBone(skinIndex.w);
  }`;

/** The shadow pass has to bend the same body, or a running player casts a statue's shadow. */
function skinDepth(m: THREE.MeshDepthMaterial, tex: THREE.Texture): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.tlFig = { value: tex };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SKIN_HEAD}`)
      .replace('#include <begin_vertex>', `vec3 transformed = (tlSkinMatrix() * vec4(position, 1.0)).xyz;`);
  };
}

const f = (n: number) => n.toFixed(4);

/**
 * The body's material: physical, with the sheen lobe that makes cloth read as cloth, and
 * four things the stock shader does not do.
 *
 * 1. Skinning, per instance, from the figure texture.
 * 2. The kit, painted by bind-pose position: shirt, sleeve, shorts, sock, boot and skin.
 * 3. The shirt's pattern, badge and number, in the torso's own coordinates, so a hoop
 *    stays one hoop however the player twists (kitPattern.ts has the masks).
 * 4. A face: eyes, brows in the hair's colour, lips a shade of the skin's own.
 *
 * Roughness and sheen follow the paint: skin has a soft sheen and no more, cloth gets the
 * sheen lobe, boots are glossy synthetic.
 */
function bodyMaterial(tex: THREE.Texture, digits: THREE.Texture, k: ReturnType<typeof kitLines>): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    roughness: 0.8,
    metalness: 0,
    sheen: 0.55,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color(0xffffff),
  });
  const shoulderLine = k.collar - 0.012;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.tlFig = { value: tex };
    shader.uniforms.tlDigits = { value: digits };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        ${SKIN_HEAD}
        attribute float aArm;
        varying vec3 vTlBind;
        varying float vTlArm;
        flat varying int vTlInst;`)
      .replace('#include <beginnormal_vertex>', `
        mat4 tlSkin = tlSkinMatrix();
        vec3 objectNormal = normalize(mat3(tlSkin) * normal);`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = (tlSkin * vec4(position, 1.0)).xyz;
        vTlBind = position;
        vTlArm = aArm;
        vTlInst = gl_InstanceID;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform highp sampler2D tlFig;
        uniform sampler2D tlDigits;
        varying vec3 vTlBind;
        varying float vTlArm;
        flat varying int vTlInst;
        ${PATTERN_GLSL}
        vec4 tlCol(int slot) { return texelFetch(tlFig, ivec2(slot, vTlInst), 0); }
        float tlDigit(float d, float style, vec2 uv) {
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
          vec2 cell = vec2((d + uv.x) / 10.0, 1.0 - (style + uv.y) / 4.0);
          return texture2D(tlDigits, cell).a;
        }
        float tlEllipse(vec2 p, vec2 c, vec2 r) { return length((p - c) / r); }
        float tlHash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float tlNoise(vec3 p) {
          vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(tlHash3(i), tlHash3(i + vec3(1, 0, 0)), f.x), mix(tlHash3(i + vec3(0, 1, 0)), tlHash3(i + vec3(1, 1, 0)), f.x), f.y),
                     mix(mix(tlHash3(i + vec3(0, 0, 1)), tlHash3(i + vec3(1, 0, 1)), f.x), mix(tlHash3(i + vec3(0, 1, 1)), tlHash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
        }
        // Bump from a height field in metres: Mikkelsen's surface-gradient trick, the same
        // maths three.js's bump map uses, without a texture.
        vec3 tlBump(vec3 pos, vec3 n, float h) {
          vec3 dpx = dFdx(pos); vec3 dpy = dFdy(pos);
          float dhx = dFdx(h); float dhy = dFdy(h);
          vec3 r1 = cross(dpy, n); vec3 r2 = cross(n, dpx);
          float det = dot(dpx, r1);
          vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
          return normalize(abs(det) * n - grad);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 p = vTlBind;
        // 0 skin, 1 shirt, 2 sleeve, 3 shorts, 4 sock, 5 boot.
        int region = 0;
        if (vTlArm > 0.5) {
          vec3 s = vec3(${f(k.shoulder.x)}, ${f(k.shoulder.y)}, ${f(k.shoulder.z)});
          vec3 d = vec3(${f(k.armDir.x)}, ${f(k.armDir.y)}, ${f(k.armDir.z)});
          float t = dot(vec3(abs(p.x), p.y, p.z) - s, d);
          region = t < ${f(SLEEVE)} ? 2 : 0;
        } else {
          // A round neck, cut a little lower at the front: skin inside the neckline's ring,
          // shirt outside it — the trapezius rises above the collar and is still shirt.
          // The neckline rises steeply away from the neck, so the trapezius beside it stays
          // shirt: a height that depends on the distance from the neck, not a cylinder that
          // the surface grazes and frays against.
          float fromNeck = length(vec2(p.x, (p.z + 0.012) * 1.1));
          float collar = ${f(k.collar)} - 0.028 * smoothstep(0.01, 0.08, p.z) + 0.9 * max(0.0, fromNeck - 0.058);
          if (p.y > collar) region = 0;
          else if (p.y > ${f(k.shirtHem)}) region = 1;
          else if (p.y > ${f(k.shortsHem)}) region = 3;
          else if (p.y > ${f(k.sockTop)}) region = 0;
          else if (p.y > ${f(k.bootTop)}) region = 4;
          else region = 5;
        }
        vec3 tint = tlCol(${COL.skin}).rgb;
        float tlRough = 0.55;
        float tlCloth = 0.0;
        if (region == 1) { tint = tlCol(${COL.shirt}).rgb; tlRough = 0.82; tlCloth = 1.0; }
        else if (region == 2) { tint = tlCol(${COL.sleeve}).rgb; tlRough = 0.82; tlCloth = 1.0; }
        else if (region == 3) { tint = tlCol(${COL.shorts}).rgb; tlRough = 0.78; tlCloth = 1.0; }
        else if (region == 4) {
          tint = tlCol(${COL.sock}).rgb; tlRough = 0.9; tlCloth = 1.0;
          // Ribbing at the turned-over top of the sock.
          float rib = step(${f(k.sockTop - 0.03)}, p.y);
          tint *= 1.0 - rib * 0.12 * step(0.5, fract(atan(p.z, abs(p.x) - 0.12) * 14.0));
        }
        else if (region == 5) {
          tint = tlCol(${COL.boot}).rgb; tlRough = 0.32;
          // A darker sole with studs' shadow, and the stripe down the side every boot has.
          if (p.y < ${f(k.sole)}) tint *= 0.3;
          float stripe = abs(abs(p.x) - 0.165) < 0.03 && p.y > ${f(k.sole + 0.012)} && p.y < ${f(k.sole + 0.03)} ? 1.0 : 0.0;
          tint = mix(tint, vec3(1.0) - tint * 0.6, stripe * 0.55);
        }

        if (region == 1) {
          // The shirt, in the torso's own frame: origin on the shoulder line.
          vec3 L = p - vec3(0.0, ${f(shoulderLine)}, 0.0);
          vec4 trim = tlCol(${COL.trim});
          vec2 tlQ = vec2(L.x / ${f(TORSO_HALF_WIDTH)}, max(0.0, -L.y) / ${f(TORSO_HEIGHT)});
          tint = mix(tint, trim.rgb, tlPatternMask(trim.a, tlQ));
          vec4 badge = tlCol(${COL.chest});
          if (badge.a > 0.5 && L.z > 0.06 && length(L.xy - vec2(0.085, -0.13)) < 0.036) tint = badge.rgb;
          vec4 number = tlCol(${COL.number});
          if (number.a > 0.5 && L.z < -0.05) {
            float num = floor(number.a);
            float style = floor(fract(number.a) * 8.0 + 0.5);
            float nv = (-L.y - 0.1) / 0.28;
            float ink = 0.0;
            if (num >= 10.0) {
              float nu = (0.19 - L.x) / 0.38;
              ink = max(tlDigit(floor(num / 10.0), style, vec2(nu * 2.0, nv)),
                        tlDigit(mod(num, 10.0), style, vec2(nu * 2.0 - 1.0, nv)));
            } else {
              ink = tlDigit(num, style, vec2((0.095 - L.x) / 0.19, nv));
            }
            tint = mix(tint, number.rgb, ink);
          }
          // A darker band at the collar and the hem, where a real shirt is double-stitched.
          tint *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 0.012, ${f(k.collar)} - p.y))
                      - 0.1 * (1.0 - smoothstep(0.0, 0.01, p.y - ${f(k.shirtHem)}));
        }

        // Skin is never one flat colour: a faint mottle, and the blood under it.
        float tlSkinMask = region == 0 ? 1.0 : 0.0;
        if (region == 0) tint *= 0.95 + 0.1 * tlNoise(p * 90.0);
        if (region == 0 && p.y > ${f(k.collar + 0.06)}) {
          // The face, in the skull's frame.
          vec3 q = p - vec3(${f(k.skull.x)}, ${f(k.skull.y)}, ${f(k.skull.z)});
          vec2 e = vec2(abs(q.x), q.y);
          // Warmer where the blood is close: the nose, the cheeks, the ears, the lips.
          float flush = max(max(1.0 - length(q - vec3(0.0, -0.034, 0.1)) / 0.022,
                                1.0 - length(vec3(e.x - 0.045, q.y + 0.03, q.z - 0.07)) / 0.028),
                            smoothstep(0.068, 0.08, e.x) * step(-0.04, q.y) * step(q.y, 0.03));
          tint *= mix(vec3(1.0), vec3(1.04, 0.88, 0.86), clamp(flush, 0.0, 1.0) * 0.55);
          // Stubble on the jaw, the chin and the upper lip, in the hair's colour, for the
          // ones who have it — speckled, because a beard is hairs rather than paint.
          vec4 hairCol = tlCol(${COL.hair});
          float jaw = smoothstep(-0.012, -0.042, q.y) * smoothstep(-0.14, -0.112, q.y) * smoothstep(-0.045, -0.01, q.z)
                    * (1.0 - smoothstep(0.055, 0.075, e.x) * smoothstep(-0.07, -0.03, q.y));
          float moustache = smoothstep(0.026, 0.018, e.x) * smoothstep(-0.052, -0.049, q.y) * smoothstep(-0.038, -0.043, q.y) * step(0.08, q.z);
          float stubble = hairCol.a * max(jaw, moustache) * (0.5 + 0.5 * tlNoise(p * 900.0));
          tint = mix(tint, hairCol.rgb * 0.9 + tint * 0.1, stubble * 0.6);
          // The eyes: white, iris, pupil, painted on the sculpted eyeball — and wet, so
          // they catch the light, which is what makes a face look alive.
          vec3 d = vec3(e.x - ${f(EYE_X)}, q.y - ${f(EYE_Y)}, q.z - ${f(EYE_Z)});
          if (length(d) < ${f(EYE_R * 1.12)} && d.z > 0.0) {
            float r = length(d.xy);
            vec3 sclera = vec3(0.88, 0.85, 0.8) * (0.7 + 0.3 * smoothstep(0.008, -0.002, d.y));
            vec3 iris = tlCol(${COL.iris}).rgb * (0.75 + 0.35 * tlNoise(vec3(atan(d.y, d.x) * 8.0, r * 900.0, 1.0)));
            tint = r < 0.0026 ? vec3(0.02) : r < 0.0058 ? iris : sclera;
            tlRough = 0.12;
            tlSkinMask = 0.0;
          } else if (length(d) < ${f(EYE_R * 1.3)} && d.y > 0.003 && q.z > ${f(EYE_Z)}) {
            // Lashes and the crease of the upper lid.
            tint *= 0.45;
          }
          // Brows, in the hair's colour: thickest at the inner end, arching over the eye.
          float bu = (e.x - 0.012) / 0.04;
          float by = 0.026 + 0.005 * sin(bu * 3.1416) - bu * 0.002;
          if (q.z > 0.05 && bu > 0.0 && bu < 1.0 && abs(e.y - by) < 0.0042 * (1.0 - bu * 0.55))
            tint = mix(tint, hairCol.rgb, 0.8 * (0.7 + 0.3 * tlNoise(p * 1200.0)));
          // Lips: the skin's own colour, deeper and redder, and a little glossier.
          float lip = min(tlEllipse(e, vec2(0.0, -0.053), vec2(0.021, 0.0062)), tlEllipse(e, vec2(0.0, -0.064), vec2(0.019, 0.0068)));
          if (q.z > 0.075 && lip < 1.15) {
            float l = 1.0 - smoothstep(0.75, 1.15, lip);
            tint *= mix(vec3(1.0), vec3(0.84, 0.64, 0.62), l);
            tlRough = mix(tlRough, 0.38, l);
          }
        }
        diffuseColor.rgb = tint;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = tlRough;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // Cloth has a weave and folds; the eye reads both as "fabric" long before it
          // reads the colour. Folds gather at the waist and under the arms, the shorts
          // crease down the leg, and the weave fades out before it can shimmer.
          float h = 0.0;
          // The weave only where a pixel is well under a millimetre, or it swims as moiré.
          float weave = 1.0 - smoothstep(0.00012, 0.0003, fwidth(p.y));
          if (region == 1 || region == 2) {
            float waist = smoothstep(${f(k.shirtHem + 0.2)}, ${f(k.shirtHem + 0.02)}, p.y);
            h += 0.0022 * waist * sin(p.y * 150.0 + 3.0 * sin(atan(p.z, p.x) * 3.0) + tlNoise(p * 20.0) * 3.0);
            h += 0.0012 * tlNoise(p * 38.0);
            h += 0.00018 * weave * sin(p.x * 2600.0) * sin(p.y * 2600.0);
          } else if (region == 3) {
            h += 0.0028 * sin(atan(p.z, abs(p.x) - 0.12) * 7.0 + p.y * 30.0 + tlNoise(p * 16.0) * 2.0);
            h += 0.00018 * weave * sin(p.x * 2400.0 + p.y * 2400.0);
          } else if (region == 4) {
            h += 0.0006 * weave * sin(atan(p.z, abs(p.x) - 0.12) * 60.0);
          } else if (region == 0) {
            h += 0.00012 * weave * tlNoise(p * 1400.0);
          }
          if (h != 0.0) normal = tlBump(-vViewPosition, normal, h);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // Light that goes into skin comes back out warm and softened: a little red in the
        // shadows is the cheapest thing that stops a face looking like painted plaster.
        totalEmissiveRadiance += tint * vec3(0.05, 0.018, 0.012) * tlSkinMask;`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        #ifdef USE_SHEEN
          // Cloth: the soft white rim of fibres. Skin: a faint warm one, the same effect
          // skin gets from light scattering just under its surface.
          material.sheenColor = mix(tint * vec3(1.0, 0.55, 0.45) * 0.45 * tlSkinMask, material.sheenColor, tlCloth);
        #endif`);
  };
  return m;
}

/**
 * Hair: not a painted cap. Strands, as fine stripes running back from the hairline and
 * broken up by noise, over a soft sheen — hair's highlight is a band, not a spot. The
 * colour is the player's, per instance.
 */
function hairMaterial(): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.62,
    metalness: 0,
    sheen: 0.6,
    sheenRoughness: 0.35,
    sheenColor: new THREE.Color(0x8a7a6a),
  });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vTlHair;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vTlHair = position;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vTlHair;
        float tlH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float tlN(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(tlH(i), tlH(i + vec2(1, 0)), f.x), mix(tlH(i + vec2(0, 1)), tlH(i + vec2(1, 1)), f.x), f.y);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 c = vTlHair - vec3(0.0, ${f(SKULL_Y + 0.02)}, -0.012);
          // Around the head, strands; along them, they wander.
          float around = atan(c.x, c.z);
          float along = c.y * 40.0 + length(c.xz) * 20.0;
          float strand = tlN(vec2(around * 90.0 + tlN(vec2(along, around * 6.0)) * 4.0, along * 0.6));
          float clump = tlN(vec2(around * 14.0, along * 0.3));
          diffuseColor.rgb *= 0.62 + 0.5 * strand * (0.6 + 0.4 * clump);
        }`);
  };
  return m;
}
