// The icon set, as a set.
//
// There is no way to look at these in a suite — an SVG path is a string of numbers and the
// only real check is a human looking at one. What CAN be checked is the property that makes
// them a set rather than a pile, and it is the one that broke: `table` and `sliders` were
// stroke for stroke the same drawing, so the league and the tactics panel wore one icon
// between them and nothing said a word. Nobody notices two identical glyphs on two screens
// they never see at once.

import { describe, expect, it } from 'vitest';
import { ICON_NAMES, ICON_PATHS } from './icons.js';

describe('the icon set', () => {
  it('has a path for every name', () => {
    for (const name of ICON_NAMES) {
      expect(ICON_PATHS[name], name).toBeTruthy();
    }
  });

  it('draws no two icons the same', () => {
    const seen = new Map<string, string>();
    for (const name of ICON_NAMES) {
      const d = ICON_PATHS[name].replace(/\s+/g, ' ').trim();
      const first = seen.get(d);
      expect(first, `${name} is the same drawing as ${first ?? ''}`).toBeUndefined();
      seen.set(d, name);
    }
  });

  it('draws every icon inside the 24-unit box it claims', () => {
    // Not a rendering check — it cannot be — but a coordinate a long way outside the viewBox
    // is a typo, and a typo in path data fails silently as a shape that is simply not there.
    for (const name of ICON_NAMES) {
      for (const n of ICON_PATHS[name].match(/-?\d+(\.\d+)?/g) ?? []) {
        expect(Math.abs(Number(n)), `${name} has a coordinate of ${n}`).toBeLessThanOrEqual(32);
      }
    }
  });
});
