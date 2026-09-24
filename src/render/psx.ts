// The retro footballer: a PlayStation-era figure, about six hundred and fifty triangles,
// with the detail painted into a small texture rather than modelled.
//
// That is how a 1998 character was made, and it is a style, not a shortcut: a body of
// six- and eight-sided rings, a face that is a few dozen pixels — two eyes, a brow, a
// nose's shadow, a mouth — and a kit whose folds, seams, number and badge are all paint.
// At 128×128 per player and nearest-neighbour filtering the texels are visible on purpose.
//
// The rig is the same thirteen bones as the sculpted body (body.ts), skinned the same way
// on the GPU (figure.ts), so every animation works unchanged. Joint rings are shared
// between the two bones either side of them, weighted half and half: the elbow and knee
// bend without a gap, and still look like a low-poly model bending.
//
// Every figure's texture is painted once into its own 128px cell of one atlas: the kit,
// the skin, the haircut and beard, the number. One texture, one draw call.

import * as THREE from 'three';
import { bindMatrices, bone, SKULL_Y } from './body.js';
import { patternMask } from './kitPattern.js';
import type { FigureColors } from './figure.js';

/** Pixels per figure's cell in the atlas. */
export const CELL = 128;

/** Where each part's paint lives in a figure's cell, in pixels. */
const R = {
  torso: { x: 0, y: 0, w: 64, h: 56 },
  head: { x: 64, y: 0, w: 64, h: 48 },
  arm: { x: 0, y: 56, w: 32, h: 40 },
  leg: { x: 32, y: 56, w: 32, h: 72 },
  boot: { x: 64, y: 48, w: 32, h: 24 },
} as const;
type Region = (typeof R)[keyof typeof R];

/** Bind-pose rings on the torso, as fractions of the torso's paint (0 at the neck). */
const V = { hem: 0.68, shoulder: 0.15 } as const;
/** Down the arm and leg, where the kit changes. */
const ARM_HEM = 0.3;
const LEG_HEM = 0.28;
const KNEE = 0.55;
const SOCK_TOP = 0.61;
/** Down the head: the rings, crown to neck. */
const HEAD_V = { brow: 0.26, eyes: 0.32, nose: 0.45, mouth: 0.55, jaw: 0.62, chin: 0.75 } as const;

type Weights = Partial<Record<number, number>>;

interface Ring {
  bone: number;
  y: number;
  rx: number;
  rz: number;
  z?: number;
  w: Weights;
  v: number;
  /** Push the front-most vertex forward: a nose, a brow. */
  front?: number;
}

/**
 * The low-poly body in the bind pose, with UVs into ONE figure's cell (0..1). Attributes
 * match the sculpted body's: position, normal, uv, skinIndex, skinWeight.
 */
export function psxGeometry(): { geometry: THREE.BufferGeometry; triangles: number } {
  const bind = bindMatrices();
  const pos: number[] = [];
  const uv: number[] = [];
  const si: number[] = [];
  const sw: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  const B = (n: string) => bone(n as never);

  const vert = (b: number, lx: number, ly: number, lz: number, w: Weights, u: number, v: number, r: Region): number => {
    p.set(lx, ly, lz).applyMatrix4(bind[b] as THREE.Matrix4);
    pos.push(p.x, p.y, p.z);
    uv.push((r.x + u * r.w) / CELL, (r.y + v * r.h) / CELL);
    const entries = Object.entries(w).map(([k, x]) => [Number(k), x as number] as const);
    for (let k = 0; k < 4; k++) {
      const e = entries[k];
      si.push(e ? e[0] : 0);
      sw.push(e ? e[1] : 0);
    }
    return pos.length / 3 - 1;
  };

  /**
   * A tube through rings of `n` sides. Angle 0 is the front (+Z); the texture's seam runs
   * down the +X side, so the front of every part is at u = 0.75 and the back at 0.25.
   */
  const tube = (rings: Ring[], n: number, r: Region, capTop?: [number, number, number], capBottom?: [number, number, number]) => {
    const first: number[][] = [];
    for (const ring of rings) {
      const row: number[] = [];
      for (let k = 0; k <= n; k++) {
        const phi = Math.PI / 2 + (2 * Math.PI * k) / n;
        const front = ring.front && k === (3 * n) / 4 ? ring.front : 0;
        row.push(vert(ring.bone, ring.rx * Math.sin(phi), ring.y, (ring.z ?? 0) + ring.rz * Math.cos(phi) + front, ring.w, k / n, ring.v, r));
      }
      first.push(row);
    }
    for (let i = 0; i + 1 < first.length; i++) {
      const a = first[i] as number[];
      const b = first[i + 1] as number[];
      for (let k = 0; k < n; k++) {
        // Rings run from top to bottom, and the angle runs anticlockwise seen from above.
        idx.push(a[k] as number, b[k] as number, a[k + 1] as number, a[k + 1] as number, b[k] as number, b[k + 1] as number);
      }
    }
    const cap = (row: number[], ring: Ring, tip: [number, number, number], top: boolean) => {
      const c = vert(ring.bone, tip[0], tip[1], tip[2], ring.w, 0.5, top ? 0 : 1, r);
      for (let k = 0; k < n; k++) {
        if (top) idx.push(c, row[k] as number, row[k + 1] as number);
        else idx.push(c, row[k + 1] as number, row[k] as number);
      }
    };
    if (capTop) cap(first[0] as number[], rings[0] as Ring, capTop, true);
    if (capBottom) cap(first[first.length - 1] as number[], rings[rings.length - 1] as Ring, capBottom, false);
  };

  const H = B('hips');
  const C = B('chest');
  const HD = B('head');
  const S = SKULL_Y;

  // Torso, neck to crotch: shirt over the ribs, shorts over the hips.
  tube([
    { bone: C, y: 0.02, rx: 0.07, rz: 0.064, z: -0.012, w: { [C]: 0.7, [HD]: 0.3 }, v: 0 },
    { bone: C, y: 0.0, rx: 0.12, rz: 0.08, z: -0.01, w: { [C]: 1 }, v: 0.05 },
    { bone: C, y: -0.075, rx: 0.192, rz: 0.108, w: { [C]: 1 }, v: V.shoulder },
    { bone: C, y: -0.2, rx: 0.178, rz: 0.12, w: { [C]: 1 }, v: 0.3 },
    { bone: C, y: -0.36, rx: 0.16, rz: 0.106, w: { [C]: 0.7, [H]: 0.3 }, v: 0.5 },
    { bone: C, y: -0.535, rx: 0.168, rz: 0.11, w: { [C]: 0.4, [H]: 0.6 }, v: V.hem },
    { bone: H, y: 0.06, rx: 0.158, rz: 0.104, w: { [H]: 1 }, v: 0.78 },
    { bone: H, y: -0.04, rx: 0.164, rz: 0.112, z: -0.01, w: { [H]: 1 }, v: 0.88 },
    { bone: H, y: -0.14, rx: 0.12, rz: 0.09, z: -0.01, w: { [H]: 1 }, v: 0.97 },
  ], 8, R.torso, undefined, [0, -0.17, -0.005]);

  // Neck and head: eight sides, a nose and a brow pushed out of the front.
  tube([
    { bone: HD, y: -0.01, rx: 0.064, rz: 0.058, z: -0.012, w: { [C]: 0.5, [HD]: 0.5 }, v: 1 },
    { bone: HD, y: 0.08, rx: 0.058, rz: 0.055, z: -0.005, w: { [HD]: 1 }, v: 0.86 },
    { bone: HD, y: S - 0.115, rx: 0.034, rz: 0.035, z: 0.045, w: { [HD]: 1 }, v: HEAD_V.chin },
    { bone: HD, y: S - 0.07, rx: 0.06, rz: 0.072, z: 0.012, w: { [HD]: 1 }, v: HEAD_V.jaw },
    { bone: HD, y: S - 0.025, rx: 0.07, rz: 0.09, z: 0.005, w: { [HD]: 1 }, v: HEAD_V.nose, front: 0.022 },
    { bone: HD, y: S + 0.025, rx: 0.078, rz: 0.098, z: -0.004, w: { [HD]: 1 }, v: HEAD_V.eyes - 0.02, front: 0.004 },
    { bone: HD, y: S + 0.07, rx: 0.071, rz: 0.092, z: -0.01, w: { [HD]: 1 }, v: 0.16 },
    { bone: HD, y: S + 0.102, rx: 0.045, rz: 0.062, z: -0.012, w: { [HD]: 1 }, v: 0.06 },
  ].reverse(), 8, R.head, [0, S + 0.116, -0.012]);

  for (let a = 0; a < 2; a++) {
    const U = B(`upperArm${a}`);
    const F = B(`forearm${a}`);
    tube([
      { bone: U, y: 0.0, rx: 0.058, rz: 0.058, w: { [U]: 1 }, v: 0.02 },
      { bone: U, y: -0.16, rx: 0.058, rz: 0.055, w: { [U]: 1 }, v: ARM_HEM - 0.02 },
      { bone: U, y: -0.168, rx: 0.046, rz: 0.046, w: { [U]: 1 }, v: ARM_HEM + 0.01 },
      { bone: U, y: -0.3, rx: 0.04, rz: 0.04, w: { [U]: 0.5, [F]: 0.5 }, v: 0.5 },
      { bone: F, y: -0.12, rx: 0.042, rz: 0.04, z: 0.003, w: { [F]: 1 }, v: 0.68 },
      { bone: F, y: -0.27, rx: 0.026, rz: 0.024, w: { [F]: 1 }, v: 0.82 },
      { bone: F, y: -0.3, rx: 0.02, rz: 0.038, z: 0.005, w: { [F]: 1 }, v: 0.86 },
      { bone: F, y: -0.36, rx: 0.019, rz: 0.033, z: 0.012, w: { [F]: 1 }, v: 0.95 },
    ], 6, R.arm, [0, 0.035, 0], [0, -0.39, 0.014]);
  }

  for (let l = 0; l < 2; l++) {
    const T = B(`thigh${l}`);
    const SH = B(`shin${l}`);
    const F = B(`foot${l}`);
    tube([
      { bone: T, y: 0.05, rx: 0.1, rz: 0.1, w: { [T]: 1 }, v: 0.01 },
      { bone: T, y: -0.19, rx: 0.1, rz: 0.1, w: { [T]: 1 }, v: LEG_HEM - 0.01 },
      { bone: T, y: -0.2, rx: 0.082, rz: 0.088, z: 0.004, w: { [T]: 1 }, v: LEG_HEM + 0.01 },
      { bone: T, y: -0.44, rx: 0.054, rz: 0.058, z: 0.006, w: { [T]: 0.5, [SH]: 0.5 }, v: KNEE },
      { bone: SH, y: -0.13, rx: 0.056, rz: 0.06, z: -0.016, w: { [SH]: 1 }, v: 0.68 },
      { bone: SH, y: -0.3, rx: 0.04, rz: 0.04, w: { [SH]: 1 }, v: 0.85 },
      { bone: SH, y: -0.42, rx: 0.036, rz: 0.038, w: { [SH]: 0.5, [F]: 0.5 }, v: 1 },
    ], 6, R.leg, [0, 0.1, 0]);

    // The boot: a tapered box, heel to toe, sole down.
    const w = { [F]: 1 };
    const c: [number, number, number][] = [
      [-0.045, 0.02, -0.07], [0.045, 0.02, -0.07], [0.04, -0.03, 0.165], [-0.04, -0.03, 0.165],
      [-0.048, -0.068, -0.075], [0.048, -0.068, -0.075], [0.042, -0.068, 0.18], [-0.042, -0.068, 0.18],
    ];
    const bv = c.map(([x, y, z]) => vert(F, x, y, z, w, (z + 0.08) / 0.27, y > -0.05 ? (y > 0 ? 0.1 : 0.45) : 0.95, R.boot));
    // Each face wound to point away from the middle of the boot, whichever order it is listed in.
    const mid = new THREE.Vector3(0, -0.03, 0.05).applyMatrix4(bind[F] as THREE.Matrix4);
    const at = (i: number) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    const q = (a: number, b: number, cc: number, d: number) => {
      const [A, Bv, Cv, D] = [bv[a]!, bv[b]!, bv[cc]!, bv[d]!];
      const n = new THREE.Vector3().crossVectors(at(Bv).sub(at(A)), at(Cv).sub(at(A)));
      const out = at(A).add(at(Cv)).multiplyScalar(0.5).sub(mid);
      if (n.dot(out) >= 0) idx.push(A, Bv, Cv, A, Cv, D);
      else idx.push(A, Cv, Bv, A, D, Cv);
    };
    q(0, 1, 2, 3); // top
    q(4, 7, 6, 5); // sole
    q(3, 2, 6, 7); // toe
    q(1, 0, 4, 5); // heel
    q(0, 3, 7, 4); // one side
    q(2, 1, 5, 6); // the other
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geometry.setAttribute('aArm', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3), 1));
  geometry.setIndex(idx);
  // Rings run top to bottom and round anticlockwise from above, so every tube faces out.
  geometry.computeVertexNormals();
  return { geometry, triangles: idx.length / 3 };
}

// ---- the paint -----------------------------------------------------------------------

/** 3×5 pixel digits, doubled on the shirt: a number you can count the pixels of. */
const DIGITS = [
  '111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001',
  '111100111001111', '111100111101111', '111001001010010', '111101111101111', '111101111001111',
];

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
function shade(c: number, k: number): string {
  const r = Math.min(255, Math.max(0, Math.round(((c >> 16) & 255) * k)));
  const g = Math.min(255, Math.max(0, Math.round(((c >> 8) & 255) * k)));
  const b = Math.min(255, Math.max(0, Math.round((c & 255) * k)));
  return `rgb(${r},${g},${b})`;
}
function mixHex(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/**
 * Paint one figure into its cell at (ox, oy). Deterministic in its inputs plus `seed`,
 * which scatters the folds and the stubble so no two players are pixel-identical.
 */
export function paintFigure(g: CanvasRenderingContext2D, ox: number, oy: number, c: FigureColors, seed: number): void {
  let s = (seed * 2654435761) >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  const px = (x: number, y: number, col: string, w = 1, h = 1) => {
    g.fillStyle = col;
    g.fillRect(ox + x, oy + y, w, h);
  };
  g.clearRect(ox, oy, CELL, CELL);
  g.fillStyle = hex(c.skin);
  g.fillRect(ox, oy, CELL, CELL);

  // --- torso: shirt, then shorts below the hem ---
  {
    const r = R.torso;
    const hemY = Math.round(V.hem * r.h);
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const u = (x + 0.5) / r.w;
        const phi = Math.PI / 2 + 2 * Math.PI * u;
        let col: number;
        if (y < hemY) {
          const V2 = Math.max(0, ((y + 0.5) / r.h - V.shoulder) / (V.hem - V.shoulder));
          const mask = patternMask(c.pattern ?? 0, Math.sin(phi), V2);
          col = mixHex(c.shirt, c.patternColour ?? c.shirt, mask);
          // Baked shade: the sides turn away from the light, and a fold or two at the waist.
          let k = 0.9 + 0.1 * Math.cos(phi) ** 2;
          if (y > hemY - 8 && (x * 7 + y * 3 + Math.floor(rnd() * 3)) % 11 === 0) k *= 0.82;
          col = mixHex(col, 0, 1 - k);
        } else {
          col = mixHex(c.shorts, 0, y === hemY || y === hemY + 1 ? 0.25 : 0.06);
        }
        px(r.x + x, r.y + y, hex(col));
      }
    }
    // The collar, the side seams and the double-stitched hem.
    for (let x = 0; x < r.w; x++) px(r.x + x, r.y, shade(c.shirt, 0.62), 1, 2);
    for (let y = 2; y < hemY; y++) {
      px(r.x, r.y + y, shade(c.shirt, 0.8));
      px(r.x + r.w / 2, r.y + y, shade(c.shirt, 0.8));
    }
    for (let x = 0; x < r.w; x++) px(r.x + x, r.y + hemY - 1, shade(c.shirt, 0.72));
    // The badge, on the left of the chest.
    if (c.chest !== undefined && c.chest >= 0) {
      px(r.x + 51, r.y + 13, hex(c.chest), 3, 4);
      px(r.x + 50, r.y + 14, hex(c.chest), 5, 2);
    }
    // The number on the back, centred on u = 0.25, in pixels you can count.
    if (c.number && c.number > 0) {
      const digits = String(Math.min(99, c.number)).split('').map(Number);
      const scale = 2;
      const width = digits.length * 3 * scale + (digits.length - 1) * scale;
      let x0 = r.x + Math.round(r.w * 0.25 - width / 2);
      const y0 = r.y + 12;
      const ink = hex(c.numberColour ?? 0xffffff);
      for (const d of digits) {
        const bits = DIGITS[d] as string;
        for (let i = 0; i < 15; i++) if (bits[i] === '1') px(x0 + (i % 3) * scale, y0 + Math.floor(i / 3) * scale, ink, scale, scale);
        x0 += 4 * scale;
      }
    }
    // A waistband on the shorts.
    for (let x = 0; x < r.w; x++) px(r.x + x, r.y + hemY + 3, shade(c.shorts, 0.8));
  }

  // --- head: skin, hair, a face ---
  {
    const r = R.head;
    const hy = (v: number) => Math.round(v * r.h);
    const fx = (du: number) => r.x + Math.round((0.75 + du) * r.w);
    // Skin, darker under the jaw where the chin shades the neck.
    for (let y = 0; y < r.h; y++) {
      const k = y > hy(HEAD_V.chin) ? 0.82 : y > hy(HEAD_V.jaw) ? 0.93 : 1;
      px(r.x, r.y + y, shade(c.skin, k), r.w, 1);
    }
    // Ears, on both sides of the head.
    for (const u of [0.5, 0]) {
      const x = r.x + Math.round(u * r.w);
      px(x - 1, r.y + hy(0.3), shade(c.skin, 0.8), 3, 7);
      px(x, r.y + hy(0.33), shade(c.skin, 0.65), 1, 3);
    }
    // Hair: a hairline high at the front, down to the ears at the sides, to the nape behind.
    const style = c.hairStyle ?? 1;
    const hair = c.hair;
    const drop = style === 3 ? 0.06 : style === 0 ? -0.03 : 0;
    for (let x = 0; x < r.w; x++) {
      const u = (x + 0.5) / r.w;
      const toFront = Math.cos(2 * Math.PI * (u - 0.75)); // 1 at the face, -1 at the back
      const line = (toFront > 0 ? 0.24 - 0.06 * toFront : 0.24 - 0.3 * toFront) + drop;
      for (let y = 0; y < hy(Math.min(0.62, line)); y++) {
        const k = 0.8 + rnd() * 0.35 + (style === 0 ? 0.25 : 0);
        px(r.x + x, r.y + y, shade(style === 0 ? mixHex(hair, c.skin, 0.35) : hair, k));
      }
    }
    // Stubble or a beard, speckled over the jaw and the upper lip.
    const beard = c.beard ?? 0;
    if (beard > 0) {
      // Stubble is a tint with a little grain, not a scatter of black pixels: the skin
      // shifted toward the hair, most along the jaw and on the chin.
      const tone = mixHex(c.skin, hair, 0.25 + beard * 0.45);
      for (let y = hy(HEAD_V.nose + 0.05); y < hy(HEAD_V.chin + 0.05); y++) {
        const lower = y >= hy(HEAD_V.mouth + 0.03);
        const half = lower ? 0.2 : 0.06;
        for (let du = -half; du <= half; du += 1 / r.w) {
          if (!lower && y < hy(HEAD_V.mouth) - 1 && Math.abs(du) > 0.05) continue;
          px(fx(du), r.y + y, shade(tone, 0.94 + rnd() * 0.12));
        }
      }
    }
    // The face: brows, eyes, a nose's shadow, a mouth.
    const eyeY = r.y + hy(HEAD_V.eyes);
    for (const side of [-1, 1]) {
      const ex = fx(side * 0.062);
      px(ex - 1, eyeY - 2, shade(hair, 0.9), 3, 1);
      px(ex - 1, eyeY, '#e8e2d8', 3, 1);
      px(ex, eyeY, hex(c.eyes ?? 0x3b2414), 1, 1);
      px(ex - 1, eyeY + 1, shade(c.skin, 0.82), 3, 1);
    }
    px(fx(-0.01), r.y + hy(HEAD_V.nose) - 2, shade(c.skin, 0.85), 1, 3);
    px(fx(-0.02), r.y + hy(HEAD_V.nose) + 1, shade(c.skin, 0.72), 3, 1);
    px(fx(-0.03), r.y + hy(HEAD_V.mouth), shade(mixHex(c.skin, 0xa0303a, 0.35), 0.8), 5, 1);
    px(fx(-0.02), r.y + hy(HEAD_V.mouth) + 1, shade(mixHex(c.skin, 0xa0303a, 0.25), 0.95), 3, 1);
  }

  // --- arms: sleeve, skin, hand ---
  {
    const r = R.arm;
    const hem = Math.round(ARM_HEM * r.h);
    px(r.x, r.y, hex(c.sleeve), r.w, hem);
    px(r.x, r.y + hem - 1, shade(c.sleeve, 0.7), r.w, 1);
    for (let y = hem; y < r.h; y++) px(r.x, r.y + y, shade(c.skin, y > r.h * 0.84 ? 0.9 : y > r.h * 0.48 && y < r.h * 0.54 ? 0.88 : 1), r.w, 1);
    // Knuckles.
    for (let x = 0; x < r.w; x += 3) px(r.x + x, r.y + Math.round(r.h * 0.93), shade(c.skin, 0.75));
  }

  // --- legs: shorts, knee, sock ---
  {
    const r = R.leg;
    const hem = Math.round(LEG_HEM * r.h);
    px(r.x, r.y, hex(c.shorts), r.w, hem);
    px(r.x, r.y + hem - 1, shade(c.shorts, 0.72), r.w, 1);
    for (let y = hem; y < Math.round(SOCK_TOP * r.h); y++) {
      const k = Math.abs(y - KNEE * r.h) < 2 ? 0.86 : 1;
      px(r.x, r.y + y, shade(c.skin, k), r.w, 1);
    }
    const top = Math.round(SOCK_TOP * r.h);
    px(r.x, r.y + top, hex(c.sock), r.w, r.h - top);
    // The turned-over top, ribbed.
    for (let x = 0; x < r.w; x += 2) px(r.x + x, r.y + top, shade(c.sock, 0.8), 1, 4);
    px(r.x, r.y + top + 4, shade(c.sock, 0.7), r.w, 1);
    // The shin pad's edge under the sock.
    px(r.x + Math.round(0.75 * r.w) - 4, r.y + top + 8, shade(c.sock, 0.9), 8, 14);
  }

  // --- boots: upper, stripe, sole ---
  {
    const r = R.boot;
    px(r.x, r.y, hex(c.boot), r.w, r.h);
    const stripe = mixHex(c.boot, 0xffffff, ((c.boot >> 16) & 255) + ((c.boot >> 8) & 255) + (c.boot & 255) > 380 ? 0 : 0.8);
    const alt = stripe === c.boot ? 0x1a1d22 : stripe;
    for (let i = 0; i < 3; i++) px(r.x + 10 + i * 4, r.y + 6, hex(alt), 2, 8);
    for (let x = 18; x < r.w; x += 3) px(r.x + x, r.y + 2, shade(c.boot, 0.7), 2, 1);
    px(r.x, r.y + r.h - 5, shade(c.boot, 0.35), r.w, 5);
  }
}
