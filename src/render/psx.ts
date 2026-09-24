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
const HEAD_V = { brow: 0.285, eyes: 0.34, nose: 0.47, mouth: 0.565, jaw: 0.71, chin: 0.79 } as const;

/**
 * The retro head's rings, crown to neck, relative to the skull centre `SKULL_Y` (except the
 * two neck rings, which are relative to the head joint). ONE profile, used to build the
 * head AND every haircut, so any cut sits on the head it is cut for.
 *
 * The jaw is the classic low-poly bust's: a ring at the angle of the jaw under the ears,
 * wide at the back, and planes running forward from it to a narrow, square chin.
 */
export interface HeadRing {
  y: number;
  rx: number;
  rxBack?: number;
  rz: number;
  rzBack?: number;
  z: number;
  v: number;
  front?: number;
  /** y is relative to the head joint rather than the skull centre. */
  neck?: boolean;
}
export const HEAD_PROFILE: readonly HeadRing[] = [
  { y: 0.1, rx: 0.05, rz: 0.058, rzBack: 0.07, z: -0.012, v: 0.06 },
  { y: 0.068, rx: 0.073, rz: 0.087, rzBack: 0.097, z: -0.01, v: 0.16 },
  { y: 0.022, rx: 0.078, rz: 0.093, rzBack: 0.1, z: -0.005, v: 0.31, front: 0.006 },
  { y: -0.025, rx: 0.074, rz: 0.09, rzBack: 0.093, z: 0, v: HEAD_V.nose, front: 0.022 },
  { y: -0.06, rx: 0.066, rxBack: 0.07, rz: 0.086, rzBack: 0.08, z: -0.004, v: 0.6 },
  { y: -0.098, rx: 0.048, rxBack: 0.066, rz: 0.074, rzBack: 0.068, z: -0.008, v: HEAD_V.jaw },
  { y: -0.12, rx: 0.03, rxBack: 0.056, rz: 0.068, rzBack: 0.056, z: -0.012, v: HEAD_V.chin },
  { y: 0.075, rx: 0.06, rz: 0.056, z: -0.012, v: 0.88, neck: true },
  { y: 0.02, rx: 0.075, rz: 0.066, z: -0.016, v: 1, neck: true },
];
const CROWN_Y = 0.116;

/** The head's surface at height `y` (skull frame) and angle `phi` (0 = the face), pushed out by `out`. */
export function headSurface(y: number, phi: number, out: number): [number, number] {
  const ys = HEAD_PROFILE.map((r) => (r.neck ? r.y - SKULL_Y : r.y));
  let i = ys.findIndex((ry) => ry <= y);
  if (i < 0) i = ys.length - 1;
  const hi = HEAD_PROFILE[Math.max(0, i - 1)] as HeadRing;
  const lo = HEAD_PROFILE[i] as HeadRing;
  const yh = ys[Math.max(0, i - 1)] as number;
  const yl = ys[i] as number;
  let t = yh === yl ? 0 : (y - yl) / (yh - yl);
  t = Math.min(1, Math.max(0, t));
  // Above the top ring, close in toward the crown.
  const cap = y > (ys[0] as number) ? 1 - Math.min(1, (y - (ys[0] as number)) / (CROWN_Y - (ys[0] as number))) : 1;
  const L = (a: number, b: number) => a + (b - a) * t;
  const front = Math.cos(phi) > 0;
  const rx = L(front ? lo.rx : lo.rxBack ?? lo.rx, front ? hi.rx : hi.rxBack ?? hi.rx) * cap;
  const rz = L(front ? lo.rz : lo.rzBack ?? lo.rz, front ? hi.rz : hi.rzBack ?? hi.rz) * cap;
  const z = L(lo.z, hi.z);
  return [Math.sin(phi) * (rx + out), z + Math.cos(phi) * (rz + out)];
}

type Weights = Partial<Record<number, number>>;

interface Ring {
  bone: number;
  y: number;
  rx: number;
  rz: number;
  z?: number;
  /**
   * The back's depth, when it differs from the front's (`rz`). Under the jaw the front of
   * the head is the chin but the back is still the nape: one centred ring there pinched the
   * back of the neck in, and the head looked stuck on rather than grown out of the neck.
   */
  rzBack?: number;
  /** And the back half's width: a chin is narrow, the neck behind it is not. */
  rxBack?: number;
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
        // The side vertices (cos = 0) belong to the back: they are the neck's, not the chin's.
        const back = Math.cos(phi) < 1e-6;
        const depth = back && ring.rzBack !== undefined ? ring.rzBack : ring.rz;
        const width = back && ring.rxBack !== undefined ? ring.rxBack : ring.rx;
        row.push(vert(ring.bone, width * Math.sin(phi), ring.y, (ring.z ?? 0) + depth * Math.cos(phi) + front, ring.w, k / n, ring.v, r));
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
    // The neck base sits high, on a trapezius that slopes out to the shoulder: without the
    // slope the neck stands on a shelf and the head looks pinned on.
    { bone: C, y: 0.06, rx: 0.07, rz: 0.064, z: -0.014, w: { [C]: 0.6, [HD]: 0.4 }, v: 0 },
    { bone: C, y: 0.035, rx: 0.13, rz: 0.08, z: -0.014, w: { [C]: 1 }, v: 0.05 },
    { bone: C, y: -0.075, rx: 0.192, rz: 0.108, w: { [C]: 1 }, v: V.shoulder },
    { bone: C, y: -0.2, rx: 0.178, rz: 0.12, w: { [C]: 1 }, v: 0.3 },
    { bone: C, y: -0.36, rx: 0.16, rz: 0.106, w: { [C]: 0.7, [H]: 0.3 }, v: 0.5 },
    { bone: C, y: -0.535, rx: 0.168, rz: 0.11, w: { [C]: 0.4, [H]: 0.6 }, v: V.hem },
    { bone: H, y: 0.06, rx: 0.158, rz: 0.104, w: { [H]: 1 }, v: 0.78 },
    { bone: H, y: -0.04, rx: 0.164, rz: 0.112, z: -0.01, w: { [H]: 1 }, v: 0.88 },
    { bone: H, y: -0.14, rx: 0.12, rz: 0.09, z: -0.01, w: { [H]: 1 }, v: 0.97 },
  ], 8, R.torso, undefined, [0, -0.17, -0.005]);

  // Neck and head, after the classic low-poly bust: a thick neck tapering up out of the
  // trapezius, a jaw of flat planes running in a V from under the ears to a narrow chin,
  // flat cheeks, a ridge down the middle of the face for the nose, and a square brow.
  // Eight sides, flat-shaded, so every plane reads.
  tube(
    HEAD_PROFILE.map((h) => ({
      bone: HD,
      y: h.neck ? h.y : S + h.y,
      rx: h.rx,
      ...(h.rxBack !== undefined ? { rxBack: h.rxBack } : {}),
      rz: h.rz,
      ...(h.rzBack !== undefined ? { rzBack: h.rzBack } : {}),
      z: h.z,
      v: h.v,
      ...(h.front !== undefined ? { front: h.front } : {}),
      // The base of the neck is half the chest's, so the neck bends out of the shoulders.
      w: h.neck && h.y < 0.05 ? { [C]: 0.5, [HD]: 0.5 } : { [HD]: 1 },
    })),
    8, R.head, [0, S + CROWN_Y, -0.012],
  );

  // Ears: a flat wedge either side, which is all a low-poly ear ever is.
  {
    const w = { [HD]: 1 };
    const mid = new THREE.Vector3(0, S, -0.01).applyMatrix4(bind[HD] as THREE.Matrix4);
    for (const sx of [-1, 1]) {
      const u = sx < 0 ? 0.5 : 0.02;
      const e = [
        vert(HD, sx * 0.073, S + 0.024, -0.004, w, u, HEAD_V.eyes - 0.04, R.head),
        vert(HD, sx * 0.07, S - 0.032, 0.004, w, u, HEAD_V.nose + 0.02, R.head),
        vert(HD, sx * 0.07, S - 0.03, -0.03, w, u + 0.03, HEAD_V.nose, R.head),
        vert(HD, sx * 0.09, S + 0.004, -0.022, w, u + 0.01, HEAD_V.eyes, R.head),
      ];
      const at = (i: number) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      for (const [a, b, c] of [[0, 1, 3], [1, 2, 3], [2, 0, 3]] as const) {
        const A = e[a]!, Bv = e[b]!, Cv = e[c]!;
        const n = new THREE.Vector3().crossVectors(at(Bv).sub(at(A)), at(Cv).sub(at(A)));
        const out = at(A).add(at(Bv)).add(at(Cv)).divideScalar(3).sub(mid);
        if (n.dot(out) >= 0) idx.push(A, Bv, Cv);
        else idx.push(A, Cv, Bv);
      }
    }
  }

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
    // Skin, shaded only UNDER the chin, at the front, fading in: a band all the way round
    // read as a seam between the head and the neck.
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const front = Math.max(0, Math.cos(2 * Math.PI * ((x + 0.5) / r.w - 0.75)));
        const under = Math.min(1, Math.max(0, (y - hy(HEAD_V.jaw + 0.06)) / Math.max(1, hy(0.12))));
        px(r.x + x, r.y + y, shade(c.skin, 1 - 0.16 * front * under));
      }
    }
    // Ears, on both sides of the head.
    for (const u of [0.5, 0]) {
      const x = r.x + Math.round(u * r.w);
      px(x - 1, r.y + hy(0.3), shade(c.skin, 0.8), 3, 7);
      px(x, r.y + hy(0.33), shade(c.skin, 0.65), 1, 3);
    }
    // Hair, painted under the modelled cut so no scalp shows between its facets: the same
    // hairline the cut is built to (hairlineOf), converted to the texture's rows.
    const style = HAIR_NAMES[c.hairStyle ?? 1] ?? 'hairShort';
    const hair = c.hair;
    if (style !== 'hairBald') {
      for (let x = 0; x < r.w; x++) {
        const phi = 2 * Math.PI * ((x + 0.5) / r.w - 0.75);
        const line = vOfSkullY(hairlineOf(style, phi));
        for (let y = 0; y < hy(line); y++) {
          // A fade is clippered at the sides and back: stubble in the hair's colour, not hair.
          const low = style === 'hairFade' && vOfSkullY(0.05) < (y + 0.5) / r.h;
          const col = low || style === 'hairCrop' ? mixHex(hair, c.skin, 0.4) : hair;
          px(r.x + x, r.y + y, shade(col, 0.82 + rnd() * 0.3));
        }
      }
    }
    // Stubble or a beard, speckled over the jaw and the upper lip.
    const beard = c.beard ?? 0;
    if (beard > 0) {
      // Stubble is a tint with a little grain, not a scatter of black pixels: the skin
      // shifted toward the hair, most along the jaw and on the chin.
      const tone = mixHex(c.skin, hair, 0.25 + beard * 0.45);
      const top = hy(HEAD_V.nose + 0.05);
      const bottom = hy(HEAD_V.chin + 0.02);
      const chinY = hy(HEAD_V.chin);
      for (let y = top; y < bottom; y++) {
        const lower = y >= hy(HEAD_V.mouth + 0.03);
        const half = lower ? 0.22 : 0.06;
        for (let du = -half; du <= half; du += 1 / r.w) {
          if (!lower && y < hy(HEAD_V.mouth) - 1 && Math.abs(du) > 0.05) continue;
          // Thinning at its edges — up the cheeks and down under the chin onto the neck —
          // with a dither rather than a line: a beard that stops in a hard edge at the jaw
          // reads as the edge of the head.
          const side = lower ? Math.min(1, (half - Math.abs(du)) / 0.07) : 1;
          const under = y > chinY ? 1 - (y - chinY) / Math.max(1, bottom - chinY) : 1;
          if (rnd() > side * under) continue;
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

/** The haircuts, in HAIR_STYLES order (figure.ts). */
export const HAIR_NAMES = ['hairCrop', 'hairShort', 'hairQuiff', 'hairCurly', 'hairBun', 'hairFade', 'hairLong', 'hairBald'] as const;
export type HairName = (typeof HAIR_NAMES)[number];

/** Skull-frame height → the head texture's row (0 crown … 1 neck). */
function vOfSkullY(y: number): number {
  const ys = [CROWN_Y, ...HEAD_PROFILE.map((r) => (r.neck ? r.y - SKULL_Y : r.y))];
  const vs = [0, ...HEAD_PROFILE.map((r) => r.v)];
  for (let i = 0; i + 1 < ys.length; i++) {
    const a = ys[i] as number;
    const b = ys[i + 1] as number;
    if (y <= a && y >= b) return (vs[i] as number) + ((vs[i + 1] as number) - (vs[i] as number)) * ((a - y) / (a - b));
  }
  return y > CROWN_Y ? 0 : 1;
}

/**
 * Where each cut's hair stops, as a skull-frame height at angle `phi` (0 = the face): over
 * the brow at the front, round the ears at the sides, at the nape behind.
 */
export function hairlineOf(style: HairName, phi: number): number {
  const f = Math.cos(phi); // 1 front, 0 sides, -1 back
  const line = (front: number, side: number, back: number) =>
    f > 0 ? side + (front - side) * f : side + (back - side) * -f;
  switch (style) {
    case 'hairCrop': return line(0.058, 0.012, -0.035);
    case 'hairShort': return line(0.05, 0.006, -0.048);
    case 'hairQuiff': return line(0.056, 0.01, -0.045);
    case 'hairCurly': return line(0.042, -0.006, -0.065);
    case 'hairBun': return line(0.056, 0.01, -0.03);
    case 'hairFade': return line(0.054, 0.004, -0.05);
    case 'hairLong': return line(0.048, -0.075, -0.16);
    case 'hairBald': return 1;
  }
}

/**
 * A retro haircut in the head bone's frame: faceted rings that follow THE head (the same
 * profile the head is built from, headSurface) down to the cut's own hairline, pushed out
 * by the cut's thickness with a little random chunking so it reads as locks rather than a
 * helmet — and, per cut, what makes it that cut: a fringe, a quiff, curls, a bun, a fade's
 * volume on top, or hair down to the shoulders. Colour comes per instance.
 */
export function retroHair(style: HairName): THREE.BufferGeometry {
  const S = SKULL_Y;
  const n = 12;
  const pos: number[] = [];
  const idx: number[] = [];
  const hash = (a: number, b: number) => {
    const h = Math.sin(a * 127.1 + b * 311.7 + 7.3) * 43758.5453;
    return h - Math.floor(h);
  };
  const add = (x: number, y: number, z: number) => {
    pos.push(x, y, z);
    return pos.length / 3 - 1;
  };
  const tri = (a: number, b: number, c: number) => idx.push(a, b, c);

  if (style !== 'hairBald') {
    // How thick the cut stands off the scalp, by height and angle; and how chunky.
    const thick = (y: number, f: number): number => {
      switch (style) {
        case 'hairCrop': return 0.004;
        case 'hairBun': return 0.006;
        case 'hairCurly': return 0.022 + 0.006 * Math.max(0, y / 0.1);
        case 'hairFade': return 0.016;
        case 'hairQuiff': return 0.01 + (f > 0.3 && y > 0.06 ? 0.03 * f : 0);
        case 'hairLong': return 0.014;
        default: return 0.011;
      }
    };
    const chunk = style === 'hairCrop' || style === 'hairBun' ? 0.002 : style === 'hairCurly' ? 0.016 : 0.007;
    // Rows from the crown down to the hairline, which is lower at the back than the front,
    // so each row is a fraction of the way from the crown to that column's hairline.
    const rows = style === 'hairLong' ? 7 : style === 'hairCurly' ? 5 : 4;
    const grid: number[][] = [];
    for (let r = 0; r < rows; r++) {
      const row: number[] = [];
      const t = (r + 1) / rows;
      for (let k = 0; k < n; k++) {
        const phi = (2 * Math.PI * k) / n;
        const f = Math.cos(phi);
        // A fade's clippered sides are paint, not hair: its cut stops where the length starts.
        const bottom = style === 'hairFade' ? Math.max(hairlineOf(style, phi), 0.042 + 0.012 * Math.max(0, f)) : hairlineOf(style, phi);
        // Rows gather near the crown, where the head turns fastest.
        let y = CROWN_Y - (CROWN_Y - bottom) * Math.pow(t, 1.25);
        // Ragged ends on the long cut, and on the curls.
        if (r === rows - 1 && (style === 'hairLong' || style === 'hairCurly')) y -= 0.018 * hash(k, 3);
        const out = thick(y, f) + chunk * hash(k, r);
        let [x, z] = headSurface(Math.max(y, -0.19), phi, out);
        // Below the chin the long hair falls straight: it hangs off the head, not the neck.
        if (style === 'hairLong' && y < -0.06) {
          const [xs, zs] = headSurface(-0.06, phi, out);
          x = xs * 1.02;
          z = f > 0 ? Math.min(z, zs) : Math.min(zs, z) - 0.01;
        }
        if (style === 'hairQuiff' && f > 0.4 && r < 2) {
          y += 0.03 * f;
          z += 0.015 * f;
        }
        row.push(add(x, S + y + (r < rows - 1 ? chunk * (hash(r, k) - 0.5) : 0), z));
      }
      grid.push(row);
    }
    const crown = add(0, S + CROWN_Y + thick(CROWN_Y, 0) + (style === 'hairQuiff' ? 0.012 : 0), -0.012);
    for (let k = 0; k < n; k++) tri(crown, (grid[0] as number[])[(k + 1) % n] as number, (grid[0] as number[])[k] as number);
    for (let r = 0; r + 1 < grid.length; r++) {
      const a = grid[r] as number[];
      const b = grid[r + 1] as number[];
      for (let k = 0; k < n; k++) {
        const k2 = (k + 1) % n;
        tri(a[k] as number, a[k2] as number, b[k] as number);
        tri(a[k2] as number, b[k2] as number, b[k] as number);
      }
    }
  }

  // A lock: a flat three-sided blade from a root on the head to a tip.
  const lock = (root: [number, number, number], tip: [number, number, number], width: number) => {
    const a = add(root[0] - width, root[1], root[2] - 0.006);
    const b = add(root[0] + width, root[1] + 0.004, root[2] - 0.004);
    const d = add(root[0], root[1] - 0.002, root[2] + 0.008);
    const c = add(tip[0], tip[1], tip[2]);
    tri(a, b, d);
    tri(b, c, d);
    tri(c, a, d);
    tri(a, c, b);
  };
  if (style === 'hairShort' || style === 'hairLong') {
    // A fringe: blades falling over the forehead, fanned, stopping above the brows.
    for (let i = 0; i < 4; i++) {
      const x = ((i + 0.5) / 4 - 0.5) * 0.1;
      const [, z] = headSurface(0.07, Math.asin(Math.max(-1, Math.min(1, x / 0.08))), 0.012);
      lock([x, S + 0.075, z - 0.004], [x * 1.25 + (x > 0 ? 0.006 : -0.006), S + 0.04 - 0.006 * hash(i, 9), z + 0.012], 0.02);
    }
  }
  if (style === 'hairQuiff') {
    // Swept up and back from the front: blades rising over the crown.
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 0.032;
      lock([x, S + 0.09, 0.085], [x * 0.7, S + 0.145 + 0.01 * hash(i, 2), 0.03], 0.024);
    }
  }
  if (style === 'hairFade') {
    // The volume on top of a fade, pushed forward in a few blades.
    for (let i = 0; i < 4; i++) {
      const x = ((i + 0.5) / 4 - 0.5) * 0.09;
      lock([x, S + 0.11, -0.01], [x * 1.1, S + 0.1 + 0.012 * hash(i, 5), 0.1], 0.026);
    }
  }
  if (style === 'hairCurly') {
    // Curls: short blunt blades all over, pointing out.
    // Tight curls all over: dozens of short blunt tufts standing off the cap, in rings, so
    // the silhouette is lumpy all the way round rather than a smooth dome.
    for (let ring = 0; ring < 4; ring++) {
      const y = 0.0 + ring * 0.035;
      const count = 12 - ring * 2;
      for (let i = 0; i < count; i++) {
        const phi = (2 * Math.PI * (i + (ring % 2) * 0.5)) / count + 0.2 * hash(i, ring);
        if (Math.cos(phi) > 0.55 && y < 0.045) continue; // not over the face
        const [x0, z0] = headSurface(y, phi, 0.02);
        const [x1, z1] = headSurface(y + 0.008, phi, 0.042 + 0.01 * hash(ring, i));
        lock([x0, S + y, z0], [x1, S + y + 0.01, z1], 0.02);
      }
    }
  }
  if (style === 'hairBun') {
    // A knot at the back of the crown.
    const cx = 0, cy = S + 0.1, cz = -0.105;
    const ring: number[] = [];
    for (let k = 0; k < 6; k++) {
      const a = (2 * Math.PI * k) / 6;
      ring.push(add(cx + Math.cos(a) * 0.036, cy + Math.sin(a) * 0.036, cz));
    }
    const back = add(cx, cy, cz - 0.04);
    const front = add(cx, cy, cz + 0.03);
    for (let k = 0; k < 6; k++) {
      tri(back, ring[(k + 1) % 6] as number, ring[k] as number);
      tri(front, ring[k] as number, ring[(k + 1) % 6] as number);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const flat = g.toNonIndexed();
  g.dispose();
  // Every face wound outward from the middle of the head.
  const p = flat.getAttribute('position') as THREE.BufferAttribute;
  const mid = new THREE.Vector3(0, S + 0.01, -0.01);
  const A = new THREE.Vector3(), Bv = new THREE.Vector3(), C = new THREE.Vector3();
  for (let t = 0; t < p.count; t += 3) {
    A.fromBufferAttribute(p, t);
    Bv.fromBufferAttribute(p, t + 1);
    C.fromBufferAttribute(p, t + 2);
    const nrm = new THREE.Vector3().crossVectors(Bv.clone().sub(A), C.clone().sub(A));
    const c = A.clone().add(Bv).add(C).divideScalar(3).sub(mid);
    if (nrm.dot(c) < 0) {
      p.setXYZ(t + 1, C.x, C.y, C.z);
      p.setXYZ(t + 2, Bv.x, Bv.y, Bv.z);
    }
  }
  flat.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(p.count * 3).fill(1), 3));
  flat.computeVertexNormals();
  return flat;
}
