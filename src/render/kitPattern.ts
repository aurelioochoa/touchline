// Shirt patterns: stripes, hoops, a sash, quarters and the rest.
//
// A pattern is a MASK over the front of the torso in two numbers — `u` across the shoulders
// from -1 to 1, `v` down the shirt from 0 at the collar to 1 at the waist — and it is written
// twice, side by side in this file on purpose: once as GLSL for the 3D players (figure.ts
// evaluates it per pixel on the torso, in the torso's own coordinates, so twenty-two players
// cost nothing extra and a stripe stays a stripe however the player twists), and once as SVG
// shapes for the studio's flat shirt. The two must describe the same shirt. If you change one
// line, change its twin, and the table test in kitPattern.test.ts checks the SVG side against
// the reference mask below.
//
// Plain data, no three.js, so the UI can import it.

/** In the order the save stores them. Append only. */
export const KIT_PATTERNS = [
  'plain', 'stripes', 'hoops', 'halves', 'sash', 'pinstripes', 'chevron',
  'quarters', 'checks', 'centre', 'yoke', 'fade', 'sides',
] as const;
export type KitPattern = (typeof KIT_PATTERNS)[number];

/** How the numbers on the back are set. The studio and the tactics board both read it. */
export const NUMBER_STYLES = ['classic', 'block', 'italic', 'outline'] as const;

/** The torso's half-width and height, in metres (gait.ts RIG), for the shader's u and v. */
export const TORSO_HALF_WIDTH = 0.21;
export const TORSO_HEIGHT = 0.52;

/**
 * The reference mask, 0..1. `fade` is the only one that is not 0 or 1. Used by the tests and
 * as the readable statement of what each pattern IS; the GLSL below is its transcription.
 */
export function patternMask(pattern: number, u: number, v: number): number {
  const fract = (x: number): number => x - Math.floor(x);
  const odd = (x: number): number => (((Math.floor(x) % 2) + 2) % 2);
  switch (KIT_PATTERNS[pattern] ?? 'plain') {
    case 'stripes': return odd((u + 1) * 3.5);
    case 'hoops': return odd(v * 5);
    case 'halves': return u >= 0 ? 1 : 0;
    case 'sash': return Math.abs(u + 0.9 * (2 * v - 1)) <= 0.28 ? 1 : 0;
    case 'pinstripes': return fract((u + 1) * 5) <= 0.2 ? 1 : 0;
    case 'chevron': return Math.abs(v - 0.25 - 0.35 * Math.abs(u)) <= 0.1 ? 1 : 0;
    case 'quarters': return (u >= 0) !== (v >= 0.5) ? 1 : 0;
    case 'checks': return odd(Math.floor((u + 1) * 3) + Math.floor(v * 4));
    case 'centre': return Math.abs(u) <= 0.3 ? 1 : 0;
    case 'yoke': return v <= 0.22 ? 1 : 0;
    case 'fade': {
      const t = Math.max(0, Math.min(1, (v - 0.3) / 0.7));
      return t * t * (3 - 2 * t);
    }
    case 'sides': return Math.abs(u) >= 0.72 ? 1 : 0;
    default: return 0;
  }
}

/** The same masks in GLSL. `p` is the pattern index as a float, `q` is (u, v). */
export const PATTERN_GLSL = /* glsl */ `
float tlPatternMask(float p, vec2 q) {
  float u = q.x;
  float v = q.y;
  if (p < 0.5) return 0.0;
  if (p < 1.5) return mod(floor((u + 1.0) * 3.5), 2.0);
  if (p < 2.5) return mod(floor(v * 5.0), 2.0);
  if (p < 3.5) return step(0.0, u);
  if (p < 4.5) return step(abs(u + 0.9 * (2.0 * v - 1.0)), 0.28);
  if (p < 5.5) return step(fract((u + 1.0) * 5.0), 0.2);
  if (p < 6.5) return step(abs(v - 0.25 - 0.35 * abs(u)), 0.1);
  if (p < 7.5) return abs(step(0.0, u) - step(0.5, v));
  if (p < 8.5) return mod(floor((u + 1.0) * 3.0) + floor(v * 4.0), 2.0);
  if (p < 9.5) return step(abs(u), 0.3);
  if (p < 10.5) return step(v, 0.22);
  if (p < 11.5) return smoothstep(0.3, 1.0, v);
  return step(0.72, abs(u));
}
`;

/**
 * The mask as SVG shapes in a unit box (u from -1 to 1 across, v from 0 to 1 down), for a
 * caller to transform onto its own drawing of a shirt. `fill` is the pattern colour; the
 * gradient pattern needs an id to be unique on the page.
 */
export function patternSvg(pattern: number, fill: string, gradientId: string): string {
  const r = (u0: number, v0: number, u1: number, v1: number): string =>
    `<rect x="${u0}" y="${v0}" width="${u1 - u0}" height="${v1 - v0}" fill="${fill}"/>`;
  const poly = (pts: [number, number][]): string =>
    `<polygon points="${pts.map(([u, v]) => `${u},${v}`).join(' ')}" fill="${fill}"/>`;
  let out = '';
  switch (KIT_PATTERNS[pattern] ?? 'plain') {
    case 'stripes':
      for (let k = 1; k < 7; k += 2) out += r(-1 + k / 3.5, 0, -1 + (k + 1) / 3.5, 1);
      return out;
    case 'hoops':
      for (let k = 1; k < 5; k += 2) out += r(-1, k / 5, 1, (k + 1) / 5);
      return out;
    case 'halves': return r(0, 0, 1, 1);
    case 'sash': return poly([[0.62, 0], [1.18, 0], [-0.62, 1], [-1.18, 1]]);
    case 'pinstripes':
      for (let k = 0; k < 10; k++) out += r(-1 + k / 5, 0, -1 + k / 5 + 0.04, 1);
      return out;
    case 'chevron': return poly([[-1, 0.5], [0, 0.15], [1, 0.5], [1, 0.7], [0, 0.35], [-1, 0.7]]);
    case 'quarters': return r(0, 0, 1, 0.5) + r(-1, 0.5, 0, 1);
    case 'checks':
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 4; j++) if ((i + j) % 2 === 1) out += r(-1 + i / 3, j / 4, -1 + (i + 1) / 3, (j + 1) / 4);
      }
      return out;
    case 'centre': return r(-0.3, 0, 0.3, 1);
    case 'yoke': return r(-1, 0, 1, 0.22);
    case 'fade':
      return `<defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">`
        + `<stop offset="0.3" stop-color="${fill}" stop-opacity="0"/>`
        + `<stop offset="1" stop-color="${fill}" stop-opacity="1"/></linearGradient></defs>`
        + `<rect x="-1" y="0" width="2" height="1" fill="url(#${gradientId})"/>`;
    case 'sides': return r(-1, 0, -0.72, 1) + r(0.72, 0, 1, 1);
    default: return '';
  }
}
