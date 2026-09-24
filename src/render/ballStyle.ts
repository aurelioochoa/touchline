// The match balls a club can choose, and the roofs its ground can wear.
//
// A ball is a FUNCTION of a direction on the sphere, not a picture. `paintBall` answers "what
// colour is the ball at this point", and both the 3D texture (an equirectangular map, see
// render/textures.ts) and the studio's 2D preview (a lit disc, see ui/art/ball.ts) are drawn
// by asking it. That is the whole trick: a preview drawn from its own copy of a design is a
// preview that one day shows a ball the match never plays with, and a pattern painted in
// equirectangular space is a pattern that pinches to nothing at the poles. Painting in 3D
// gets a truncated icosahedron that is actually a truncated icosahedron.
//
// Plain data and arithmetic — no three.js — so the UI can import it without the renderer.
//
// The designs in the middle group are INSPIRED by eras of the game's balls, not copies of
// any: their names are descriptions ("Triad '78") rather than anybody's product name.
//
// ORDER IS A SAVE FORMAT. `ClubLook.ball` is an index into BALL_STYLES, so the first six keep
// the places they had when there were only six, and every new design goes on the end.

export type Rgb = number;
export interface ClubColours {
  primary: number;
  secondary: number;
}
type Vec = readonly [number, number, number];

export type BallGroup = 'club' | 'eras' | 'fantasy';

export interface BallStyle {
  /** The string key suffix: the label is `ball.style.<id>`. */
  id: string;
  group: BallGroup;
  paint(d: Vec, c: ClubColours): Rgb;
  /** How much the ball lights itself, 0..1. The fantasy balls glow; a leather one does not. */
  glow?: number;
  metal?: number;
  rough?: number;
  /** The colour of the smear a struck shot leaves. White for a real ball. */
  trail?: Rgb;
}

// ---- colour and vector helpers ------------------------------------------------------------

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  const ch = (s: number): number => {
    const x = (a >> s) & 255;
    const y = (b >> s) & 255;
    return Math.round(x + (y - x) * k) << s;
  };
  return (ch(16) | ch(8) | ch(0)) >>> 0;
}

/** A multi-stop colour ramp, t in 0..1. */
function ramp(stops: readonly Rgb[], t: number): Rgb {
  const k = Math.max(0, Math.min(0.9999, t)) * (stops.length - 1);
  const i = Math.floor(k);
  return mix(stops[i] as Rgb, stops[i + 1] as Rgb, k - i);
}

function hsl(h: number, s: number, l: number): Rgb {
  const f = (n: number): number => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return ((f(0) << 16) | (f(8) << 8) | f(4)) >>> 0;
}

const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (v: Vec): Vec => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const PHI = (1 + Math.sqrt(5)) / 2;
/** The 12 pentagon centres of a football. */
const ICO: readonly Vec[] = [
  [0, 1, PHI], [0, -1, PHI], [0, 1, -PHI], [0, -1, -PHI],
  [1, PHI, 0], [-1, PHI, 0], [1, -PHI, 0], [-1, -PHI, 0],
  [PHI, 0, 1], [-PHI, 0, 1], [PHI, 0, -1], [-PHI, 0, -1],
].map((v) => norm(v as unknown as Vec));
/**
 * The 20 hexagon centres: the icosahedron's face centres, which is the dodecahedron in the
 * orientation DUAL to the one above. The other cyclic permutation of (0, 1/φ, φ) is also a
 * dodecahedron, and it is the wrong one — it puts the hexagons across the pentagons.
 */
const DODECA: readonly Vec[] = [
  ...[-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [x, y, z] as Vec))),
  ...[-1, 1].flatMap((a) => [-1, 1].flatMap((b) => [
    [0, a * PHI, b / PHI] as Vec, [a / PHI, 0, b * PHI] as Vec, [a * PHI, b / PHI, 0] as Vec,
  ])),
].map(norm);
const TETRA: readonly Vec[] = ([[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]] as Vec[]).map(norm);
const AXES: readonly Vec[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1]];

/** Nearest of a set of centres, and how close the runner-up is — the seam. */
function nearest(d: Vec, set: readonly Vec[]): { i: number; best: number; gap: number } {
  let i = 0;
  let best = -2;
  let second = -2;
  for (let k = 0; k < set.length; k++) {
    const v = dot(d, set[k] as Vec);
    if (v > best) {
      second = best;
      best = v;
      i = k;
    } else if (v > second) {
      second = v;
    }
  }
  return { i, best, gap: best - second };
}

/** A direction in polar coordinates around a centre: angular distance, and angle around it. */
function polar(d: Vec, c: Vec): { r: number; theta: number } {
  const up: Vec = Math.abs(c[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const t1 = norm(cross(up, c));
  const t2 = cross(c, t1);
  return { r: Math.acos(Math.max(-1, Math.min(1, dot(d, c)))), theta: Math.atan2(dot(d, t2), dot(d, t1)) };
}

/** Distance-like measure to a regular n-gon of radius R: inside when <= 1. */
function polygon(r: number, theta: number, n: number, R: number, spin = 0): number {
  const seg = (2 * Math.PI) / n;
  const a = (((theta + spin) % seg) + seg) % seg - seg / 2;
  return (r * Math.cos(a)) / (R * Math.cos(Math.PI / n));
}

/** The 32-panel classic: which panel, whether it is a pentagon, and the seam. */
function football(d: Vec): { pent: boolean; seam: boolean; index: number } {
  const a = nearest(d, ICO);
  const b = nearest(d, DODECA);
  // Pentagons are weighted a touch larger, which is closer to the real proportions than an
  // unweighted Voronoi of the two sets.
  const pentScore = a.best * 1.018;
  const pent = pentScore > b.best;
  const edge = Math.min(Math.abs(pentScore - b.best), pent ? a.gap : b.gap);
  return { pent, seam: edge < 0.011, index: pent ? a.i : 12 + b.i };
}

// ---- noise -------------------------------------------------------------------------------

function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const s = (t: number): number => t * t * (3 - 2 * t);
  const u = s(x - xi);
  const v = s(y - yi);
  const w = s(z - zi);
  const l = (a: number, b: number, t: number): number => a + (b - a) * t;
  const c = (i: number, j: number, k: number): number => hash3(xi + i, yi + j, zi + k);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}

function fbm(d: Vec, scale: number, octaves = 4, seed = 0): number {
  let a = 0.5;
  let f = scale;
  let t = 0;
  let n = 0;
  for (let o = 0; o < octaves; o++) {
    t += a * vnoise(d[0] * f + seed, d[1] * f - seed, d[2] * f + seed * 0.5);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return t / n;
}

/** Points scattered evenly over the sphere, for crack and cell patterns. */
const CELLS: readonly Vec[] = Array.from({ length: 46 }, (_, i) => {
  const y = 1 - ((i + 0.5) / 46) * 2;
  const r = Math.sqrt(1 - y * y);
  const a = i * Math.PI * (3 - Math.sqrt(5)) + hash3(i, 7, 3) * 0.7;
  return norm([Math.cos(a) * r, y + (hash3(i, 1, 9) - 0.5) * 0.08, Math.sin(a) * r]);
});

// ---- pattern families ----------------------------------------------------------------------

const WHITE = 0xf7f8fa;
const INK = 0x1b1e24;

/** Two-colour classic panels. */
const panels = (base: (c: ClubColours) => Rgb, patch: (c: ClubColours) => Rgb) =>
  (d: Vec, c: ClubColours): Rgb => {
    const f = football(d);
    if (f.seam) return mix(f.pent ? patch(c) : base(c), 0x000000, 0.35);
    return f.pent ? patch(c) : base(c);
  };

/** Arcs around the twelve pentagon centres — the family of the late-seventies ball. */
function triads(d: Vec, arc: Rgb, inner: Rgb | null): Rgb {
  const n = nearest(d, ICO);
  const { r, theta } = polar(d, ICO[n.i] as Vec);
  const around = ((theta / (2 * Math.PI)) * 3 + 10) % 1;
  if (r > 0.27 && r < 0.4 && around < 0.78) return arc;
  if (inner !== null && r > 0.17 && r < 0.215) return inner;
  if (n.gap < 0.004) return 0xd9dde2;
  return WHITE;
}

/** A twisted cube: six interlocking panels, with the seam between them. */
function twisted(d: Vec, twist: number): { axis: number; edge: number } {
  const t: Vec = [d[0] + twist * d[1], d[1] + twist * d[2], d[2] + twist * d[0]];
  const n = nearest(norm(t), AXES);
  return { axis: n.i % 3, edge: n.gap };
}

function cellEdge(d: Vec): number {
  const n = nearest(d, CELLS);
  return n.gap;
}

// ---- the catalogue ------------------------------------------------------------------------

export const BALL_STYLES: readonly BallStyle[] = [
  // --- the first six, in their original order ---
  { id: 'classic', group: 'club', paint: panels(() => WHITE, () => 0x20242c) },
  { id: 'clubPanels', group: 'club', paint: panels(() => WHITE, (c) => c.primary) },
  { id: 'hivis', group: 'club', paint: panels(() => 0xffd23f, () => 0x1b2a63) },
  { id: 'gold', group: 'fantasy', metal: 0.7, rough: 0.28, trail: 0xffe08a, paint: panels(() => 0xe3b341, () => 0x7a5712) },
  { id: 'street', group: 'club', paint: panels(() => 0xff7a2f, () => WHITE) },
  { id: 'allClub', group: 'club', paint: panels((c) => c.primary, (c) => c.secondary) },

  // --- through the years ---
  {
    id: 'leather30', group: 'eras', rough: 0.9,
    paint: (d) => {
      const n = nearest(d, AXES);
      const main = n.i % 3;
      const u = d[(main + 1) % 3] as number;
      const v = d[(main + 2) % 3] as number;
      const strip = Math.floor((u / Math.max(0.35, Math.abs(d[main] as number)) + 1) * 1.5);
      if (n.gap < 0.03) return 0x3e230f;
      // The laces, across the top panel.
      if (n.i === 1 && Math.abs(u) < 0.05 && Math.abs(v) < 0.3) {
        return ((v * 28 + 20) % 1) < 0.55 ? 0xe9dcc0 : 0x5a3516;
      }
      const grain = fbm(d, 14, 2) * 0.35;
      return mix(strip % 2 === 0 ? 0xa3642c : 0xbf8246, 0x4a2a12, grain);
    },
  },
  {
    id: 'winter50', group: 'eras', rough: 0.8,
    paint: (d) => {
      const n = nearest(d, AXES);
      const main = n.i % 3;
      const u = d[(main + 1) % 3] as number;
      const strip = Math.floor((u / Math.max(0.35, Math.abs(d[main] as number)) + 1) * 1.5);
      if (n.gap < 0.025) return 0x5a3516;
      return (strip + n.i) % 2 === 0 ? 0xf07a1a : 0xf3ead8;
    },
  },
  { id: 'triad78', group: 'eras', paint: (d) => triads(d, INK, null) },
  { id: 'aztec86', group: 'eras', paint: (d) => triads(d, INK, 0x1d7a4a) },
  { id: 'tricolour98', group: 'eras', paint: (d) => triads(d, 0x1d3f9e, 0xd7263d) },
  {
    id: 'flame02', group: 'eras',
    paint: (d) => {
      const n = nearest(d, TETRA);
      const { r, theta } = polar(d, TETRA[n.i] as Vec);
      const p = polygon(r, theta, 3, 0.95);
      if (p < 0.78) return 0xe0a91f;
      if (p < 0.9) return 0xc2261d;
      if (p < 0.96) return INK;
      return 0xf6f1e3;
    },
  },
  {
    id: 'propeller06', group: 'eras',
    paint: (d) => {
      const n = nearest(d, AXES);
      const main = n.i % 3;
      const s = Math.abs(d[main] as number) || 1;
      const u = (d[(main + 1) % 3] as number) / s;
      const v = (d[(main + 2) % 3] as number) / s;
      const arm = Math.min(Math.abs(u + 0.3 * v * v), Math.abs(v - 0.3 * u * u));
      if (arm < 0.09) return INK;
      if (arm < 0.14) return 0xd4a017;
      if (n.gap < 0.012) return 0xc9cdd3;
      return WHITE;
    },
  },
  {
    id: 'kaleido10', group: 'eras',
    paint: (d) => {
      const colours = [0xe8452c, 0x2f8fd8, 0x36c06a, 0xf2c53d, 0xd83fa0, 0x7b2ff7, 0xff7a2f, 0x00b3c8];
      const sx = d[0] >= 0 ? 1 : -1;
      const sy = d[1] >= 0 ? 1 : -1;
      const sz = d[2] >= 0 ? 1 : -1;
      const c = norm([sx, sy, sz]);
      const { r, theta } = polar(d, c);
      const p = polygon(r, theta, 3, 0.62, 0.4);
      const k = (sx > 0 ? 1 : 0) + (sy > 0 ? 2 : 0) + (sz > 0 ? 4 : 0);
      if (p < 0.45) return WHITE;
      if (p < 0.92) return colours[k] as number;
      if (p < 1) return INK;
      return WHITE;
    },
  },
  {
    id: 'carnival14', group: 'eras',
    paint: (d) => {
      const t = twisted(d, 0.55);
      if (t.edge < 0.014) return INK;
      if (t.edge < 0.15) return ([0xf2a900, 0x1b4fb0, 0x19a05a] as const)[t.axis] as number;
      if (t.edge < 0.165) return INK;
      return WHITE;
    },
  },
  {
    id: 'pixel18', group: 'eras',
    paint: (d) => {
      const n = nearest(d, ICO);
      const { r, theta } = polar(d, ICO[n.i] as Vec);
      const a = r * Math.cos(theta);
      const b = r * Math.sin(theta);
      const g = 0.052;
      const ci = Math.floor(a / g);
      const cj = Math.floor(b / g);
      const cell = Math.max(Math.abs((ci + 0.5) * g), Math.abs((cj + 0.5) * g));
      if (cell < 0.14) return 0x23262c;
      if (cell < 0.36 && hash3(ci, cj, n.i) < 0.55 - cell) return hash3(cj, ci, n.i) < 0.5 ? 0x23262c : 0x676c76;
      return WHITE;
    },
  },
  {
    id: 'journey22', group: 'eras',
    paint: (d) => {
      const n = nearest(d, DODECA);
      const { r, theta } = polar(d, DODECA[n.i] as Vec);
      const colour = ([0xe0322c, 0x1f5fd6, 0x2db34a, 0xf2b632] as const)[n.i % 4] as number;
      const outer = polygon(r, theta, 3, 0.36, n.i * 0.5);
      const notch = polygon(r, theta + Math.PI / 3, 3, 0.16, n.i * 0.5);
      if (outer < 1 && notch > 1) return colour;
      if (outer < 1.1 && notch > 1) return mix(colour, WHITE, 0.55);
      return WHITE;
    },
  },
  {
    id: 'waves26', group: 'eras',
    paint: (d) => {
      const a = Math.atan2(d[2], d[0]) + 0.5 * Math.sin(d[1] * Math.PI * 2);
      const sector = ((a / ((2 * Math.PI) / 3)) % 1 + 1) % 1;
      const edge = Math.min(sector, 1 - sector);
      const which = Math.floor((((a / ((2 * Math.PI) / 3)) % 3) + 3) % 3);
      if (edge < 0.05) return ([0xd7263d, 0x1f9e4d, 0x2f6ed8] as const)[which] as number;
      if (edge < 0.065) return INK;
      if (Math.abs(d[1]) > 0.93) return 0xd4a017;
      return WHITE;
    },
  },

  // --- fantasy ---
  {
    id: 'fire', group: 'fantasy', glow: 0.85, trail: 0xff7a1a,
    paint: (d) => {
      const n = fbm([d[0], d[1] * 1.6, d[2]], 3.2, 5, 11);
      return ramp([0x3a0600, 0xa3140a, 0xff4a10, 0xffa21e, 0xffe27a, 0xfff6d0], n * 1.25 - 0.1 + d[1] * 0.18);
    },
  },
  {
    id: 'galaxy', group: 'fantasy', glow: 0.55, trail: 0x9f7dff,
    paint: (d) => {
      const n = fbm(d, 2.6, 4, 3);
      let c = ramp([0x05061a, 0x151447, 0x3b1a6e], n);
      const arm = Math.sin(3 * Math.atan2(d[2], d[0]) + 7 * d[1] + n * 5);
      if (arm > 0.55) c = mix(c, arm > 0.85 ? 0xf2b0ff : 0xb04fd8, (arm - 0.55) * 1.6);
      const q = hash3(Math.floor(d[0] * 70), Math.floor(d[1] * 70), Math.floor(d[2] * 70));
      if (q > 0.985) c = 0xffffff;
      else if (q > 0.97) c = mix(c, 0x9fc4ff, 0.7);
      return c;
    },
  },
  {
    id: 'darkMatter', group: 'fantasy', glow: 0.7, trail: 0x7b2ff7,
    paint: (d) => {
      const r = 1 - Math.abs(2 * fbm(d, 3, 5, 21) - 1);
      const vein = Math.pow(r, 7);
      const tint = fbm(d, 1.5, 2, 5) > 0.5 ? 0x13c2c2 : 0x8a3cff;
      return mix(0x06050b, tint, vein * 1.4);
    },
  },
  {
    id: 'blackHole', group: 'fantasy', glow: 1, trail: 0xff9a3c,
    paint: (d) => {
      const axis = norm([0.25, 1, 0.15]);
      const p = dot(d, axis);
      const band = Math.abs(p);
      let c = 0x020203;
      if (band < 0.24) {
        const streak = fbm([d[0] * 3, d[1] * 0.3, d[2] * 3], 4, 3, 9);
        const k = Math.pow(1 - band / 0.24, 1.6) * (0.55 + 0.6 * streak);
        c = ramp([0x020203, 0x7a1f05, 0xff7a18, 0xffd79a, 0xffffff], k);
      } else if (band > 0.36 && band < 0.39) {
        c = 0x6a3a1a;
      }
      return c;
    },
  },
  {
    id: 'ice', group: 'fantasy', glow: 0.18, rough: 0.12, metal: 0.1, trail: 0xbff2ff,
    paint: (d) => {
      const e = cellEdge(d);
      const base = mix(0x8fd3f5, 0xd8f4ff, fbm(d, 5, 3, 2));
      if (e < 0.012) return 0xffffff;
      if (e < 0.03) return mix(0xffffff, base, (e - 0.012) / 0.018);
      return base;
    },
  },
  {
    id: 'lava', group: 'fantasy', glow: 0.9, trail: 0xff5a1a,
    paint: (d) => {
      const e = cellEdge(d);
      const rock = mix(0x140a07, 0x3a1d12, fbm(d, 7, 3, 4));
      if (e < 0.05) return ramp([0xfff0a0, 0xffb020, 0xff4a10, 0x7a1405], e / 0.05);
      return rock;
    },
  },
  {
    id: 'lightning', group: 'fantasy', glow: 0.8, trail: 0x7fe0ff,
    paint: (d) => {
      const j = fbm(d, 9, 2, 13) * 0.08;
      const e = cellEdge(norm([d[0] + j, d[1] - j, d[2] + j]));
      const base = mix(0x07102e, 0x14245e, fbm(d, 3, 3, 8));
      if (e < 0.008) return 0xe8fbff;
      if (e < 0.022) return 0x5fc8ff;
      if (e < 0.045) return mix(0x2f6ed8, base, (e - 0.022) / 0.023);
      return base;
    },
  },
  {
    id: 'rainbow', group: 'fantasy', glow: 0.25,
    paint: (d) => {
      const f = football(d);
      if (f.seam) return WHITE;
      const h = (Math.atan2(d[2], d[0]) / (2 * Math.PI) + 1 + d[1] * 0.2) % 1;
      return hsl(h, 0.85, f.pent ? 0.42 : 0.58);
    },
  },
  {
    id: 'plasma', group: 'fantasy', glow: 0.75, trail: 0xff4fe0,
    paint: (d) => {
      const s = Math.sin(fbm(d, 2.4, 4, 17) * 14 + d[1] * 4);
      return ramp([0x2a0640, 0xff2fd0, 0xffffff, 0x19e0ff, 0x06244a], s * 0.5 + 0.5);
    },
  },
  {
    id: 'aurora', group: 'fantasy', glow: 0.6, trail: 0x3dffa0,
    paint: (d) => {
      const wave = d[1] - 0.15 + 0.35 * (fbm(d, 2.2, 3, 30) - 0.5);
      const curtain = Math.exp(-Math.pow(wave * 5.5, 2));
      const top = Math.exp(-Math.pow((wave - 0.35) * 5, 2));
      let c = mix(0x031018, 0x0b2a3a, d[1] * 0.5 + 0.5);
      c = mix(c, 0x3dffa0, curtain * 0.95);
      c = mix(c, 0xb06bff, top * 0.8);
      const q = hash3(Math.floor(d[0] * 60), Math.floor(d[1] * 60), Math.floor(d[2] * 60));
      return q > 0.988 ? 0xffffff : c;
    },
  },
];

export function ballStyle(index: number): BallStyle {
  return BALL_STYLES[index] ?? (BALL_STYLES[0] as BallStyle);
}

/** The colour of a ball at a direction on its surface. `d` need not be normalised. */
export function paintBall(index: number, d: Vec, c: ClubColours): Rgb {
  return ballStyle(index).paint(norm(d), c);
}

/**
 * The equirectangular map three.js wraps a SphereGeometry in, as RGBA bytes. Row 0 is the
 * top of the ball, matching a CanvasTexture's default flipY.
 */
export function ballPixels(index: number, c: ClubColours, width = 256, height = 128): Uint8ClampedArray<ArrayBuffer> {
  const style = ballStyle(index);
  const out = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
  for (let row = 0; row < height; row++) {
    const theta = ((row + 0.5) / height) * Math.PI;
    const st = Math.sin(theta);
    const ct = Math.cos(theta);
    for (let col = 0; col < width; col++) {
      const phi = ((col + 0.5) / width) * Math.PI * 2;
      const rgb = style.paint([-Math.cos(phi) * st, ct, Math.sin(phi) * st], c);
      const o = (row * width + col) * 4;
      out[o] = (rgb >> 16) & 255;
      out[o + 1] = (rgb >> 8) & 255;
      out[o + 2] = rgb & 255;
      out[o + 3] = 255;
    }
  }
  return out;
}

/** The top of the roof: slate, or one of the club's two colours. */
export const ROOF_STYLES = ['slate', 'primary', 'secondary'] as const;

export function roofColour(index: number, primary: number, secondary: number): number {
  switch (ROOF_STYLES[index] ?? 'slate') {
    case 'primary': return primary;
    case 'secondary': return secondary;
    default: return 0x2f3944;
  }
}
