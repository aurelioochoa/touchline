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
import { ellipsoid, mergeParts, smoothPaintMaterial } from './kit.js';
import { type Pose } from './gait.js';
import { PATTERN_GLSL, TORSO_HALF_WIDTH, TORSO_HEIGHT } from './kitPattern.js';
import { digitAtlas } from './textures.js';
import { sculpt } from './sculpt.js';
import {
  BODY_MAX, BODY_MIN, BONE_COUNT, BONES, SKULL_Y, SLEEVE,
  bindMatrices, bodyVolumes, bone, kitLines, poseBones, poseScratch, type Bone,
} from './body.js';

/**
 * The haircuts. Each is its own instanced group, and a figure shows exactly one of them:
 * the others get a zero matrix, the same way a substituted player is hidden. Five extra
 * draw calls buys a squad that is not eleven identical swim caps.
 */
export const HAIR_STYLES = ['hairCrop', 'hairShort', 'hairQuiff', 'hairCurly', 'hairBun'] as const;
type HairStyle = (typeof HAIR_STYLES)[number];

/** Grid spacing the body is sculpted at. Finer is smoother and costs triangles. */
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
} as const;
const ROW = 64;

/** Built once per page: sculpting takes a few hundred milliseconds and the body never changes. */
let shared: { geometry: THREE.BufferGeometry; bind: THREE.Matrix4[]; bindInv: THREE.Matrix4[] } | null = null;
function body() {
  if (!shared) {
    const bind = bindMatrices();
    const { geometry } = sculpt({ bind, volumes: bodyVolumes(bind), cell: BODY_CELL, min: BODY_MIN, max: BODY_MAX });
    shared = { geometry, bind, bindInv: bind.map((m) => m.clone().invert()) };
  }
  return shared;
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

  constructor(count: number) {
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

    const { geometry, bind } = body();
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
    const hairMat = smoothPaintMaterial(0.85);
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
    put(COL.hair, colors.hair);
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
    const { bindInv } = body();
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
  static get bodyTriangles(): number {
    const g = body().geometry;
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
        float tlEllipse(vec2 p, vec2 c, vec2 r) { return length((p - c) / r); }`)
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
          float collar = ${f(k.collar)} - 0.028 * smoothstep(0.01, 0.08, p.z);
          bool neck = length(vec2(p.x, (p.z + 0.012) * 1.1)) < 0.078;
          if (p.y > ${f(k.collar + 0.05)} || (p.y > collar && neck)) region = 0;
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

        if (region == 0 && p.y > ${f(k.collar + 0.06)}) {
          // The face, in the skull's frame.
          vec3 q = p - vec3(${f(k.skull.x)}, ${f(k.skull.y)}, ${f(k.skull.z)});
          if (q.z > 0.05) {
            vec2 e = vec2(abs(q.x), q.y);
            float eye = tlEllipse(e, vec2(0.031, 0.009), vec2(0.013, 0.0065));
            if (eye < 1.0) tint = mix(vec3(0.85, 0.82, 0.78) * tint * 1.3, vec3(0.05, 0.04, 0.035), step(tlEllipse(e, vec2(0.031, 0.009), vec2(0.0065, 0.0065)), 1.0));
            // Lashes and the lid's shadow: a dark line along the top of the eye.
            if (abs(eye - 1.0) < 0.28 && e.y > 0.009) tint *= 0.45;
            // Brows, in the hair's colour, rising slightly to the outside.
            // Thickest at the inner end, tapering out and arching over the eye.
            float bu = (e.x - 0.012) / 0.04;
            float by = 0.026 + 0.005 * sin(bu * 3.1416) - bu * 0.002;
            if (bu > 0.0 && bu < 1.0 && abs(e.y - by) < 0.0042 * (1.0 - bu * 0.55)) tint = mix(tint, tlCol(${COL.hair}).rgb, 0.8);
            // Lips: the skin's own colour, deeper and redder.
            float lip = tlEllipse(e, vec2(0.0, -0.058), vec2(0.022, 0.0075));
            if (lip < 1.0) tint *= vec3(0.78, 0.58, 0.56);
            if (abs(e.y + 0.058) < 0.0012 && e.x < 0.02) tint *= 0.55;
          }
        }
        diffuseColor.rgb = tint;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = tlRough;`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        #ifdef USE_SHEEN
          material.sheenColor *= tlCloth;
        #endif`);
  };
  return m;
}
