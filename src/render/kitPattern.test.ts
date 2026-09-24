// The shirt patterns are written twice — GLSL for the 3D players, SVG for the studio — and
// this holds the SVG half to the reference mask they both transcribe. (The GLSL half cannot
// run here; it is a line-for-line copy of patternMask and is read against it in review.)

import { describe, expect, it } from 'vitest';
import { KIT_PATTERNS, PATTERN_GLSL, patternMask, patternSvg } from './kitPattern.js';

/** Is (u, v) inside any rect or polygon of the SVG markup? */
function inside(svg: string, u: number, v: number): boolean {
  for (const m of svg.matchAll(/<rect x="([-\d.e]+)" y="([-\d.e]+)" width="([-\d.e]+)" height="([-\d.e]+)"/g)) {
    const [x, y, w, h] = m.slice(1).map(Number) as [number, number, number, number];
    if (u >= x && u <= x + w && v >= y && v <= y + h) return true;
  }
  for (const m of svg.matchAll(/<polygon points="([^"]+)"/g)) {
    const pts = (m[1] ?? '').split(' ').map((p) => p.split(',').map(Number) as [number, number]);
    let odd = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i] as [number, number];
      const [xj, yj] = pts[j] as [number, number];
      if ((yi > v) !== (yj > v) && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) odd = !odd;
    }
    if (odd) return true;
  }
  return false;
}

describe('shirt patterns', () => {
  it('draw the same shirt in SVG as the reference mask', () => {
    KIT_PATTERNS.forEach((id, p) => {
      if (id === 'fade') return; // a gradient, not shapes
      const svg = patternSvg(p, '#fff', 'g');
      let wrong = 0;
      let total = 0;
      // Off-grid sample points, so no sample lands exactly on a stripe's edge.
      for (let i = 0; i < 40; i++) {
        for (let j = 0; j < 30; j++) {
          const u = -1 + (i + 0.37) / 20;
          const v = (j + 0.41) / 30;
          total++;
          if ((patternMask(p, u, v) > 0.5) !== inside(svg, u, v)) wrong++;
        }
      }
      expect(wrong / total, id).toBeLessThan(0.01);
    });
  });

  it('has a GLSL branch for every pattern', () => {
    const branches = PATTERN_GLSL.match(/if \(p < /g)?.length ?? 0;
    // Plain is the first test, the last pattern is the fall-through.
    expect(branches).toBe(KIT_PATTERNS.length - 1);
  });
});
