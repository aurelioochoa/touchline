// The club accent has to be legible for EVERY club the world generator can produce.
//
// This is the one piece of the design system that is not a fixed value a designer looked
// at: `--tl-club` is a generated football kit, and a generated football kit is any colour
// at all. The buttons, the focus ring, the selected tab and the table highlight all take
// it, so a kit that fails here is not a cosmetic problem — it is a Watch button a kid
// cannot find, on one career in twenty, with nothing in the build to say so.
//
// The sweep below is exhaustive over the hue/saturation/lightness cube at a resolution
// finer than the generator's own palette, which is cheaper and stricter than sampling the
// generator itself.

import { describe, expect, it } from 'vitest';
import { accentFor, contrast, inkFor, readableAccent, toRgb } from './theme.js';

/** `--tl-g1`, the ground the accent sits on. Kept in step with styles.ts by hand. */
const GROUND: [number, number, number] = [10, 32, 21];
const INK_DARK: [number, number, number] = [4, 21, 11];
const INK_LIGHT: [number, number, number] = [255, 255, 255];

function hsvHex(h: number, s: number, v: number): number {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const [r, g, b] = [
    [v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q],
  ][i % 6] as [number, number, number];
  const ch = (x: number): number => Math.round(x * 255);
  return (ch(r) << 16) | (ch(g) << 8) | ch(b);
}

/** Every colour a kit could plausibly be, at a finer step than the generator uses. */
function* kitSweep(): Generator<number> {
  for (let h = 0; h < 1; h += 1 / 36) {
    for (let s = 0; s <= 1; s += 0.25) {
      for (let v = 0.08; v <= 1; v += 0.115) {
        yield hsvHex(h, s, v);
      }
    }
  }
}

describe('the club accent', () => {
  const kits = [...kitSweep()];

  it('sweeps a real spread of colours', () => {
    expect(kits.length).toBeGreaterThan(500);
  });

  it('is visible against the ground for every possible kit', () => {
    const failures: string[] = [];
    for (const kit of kits) {
      const accent = readableAccent(accentFor(kit));
      // 3:1 is the WCAG floor for a non-text user-interface component, which is what a
      // button fill, a focus ring and a table highlight are.
      if (contrast(accent, GROUND) < 3) {
        failures.push(`#${kit.toString(16).padStart(6, '0')} -> ${contrast(accent, GROUND).toFixed(2)}:1`);
      }
    }
    expect(failures.slice(0, 8)).toEqual([]);
  });

  it('can carry readable text for every possible kit', () => {
    const failures: string[] = [];
    for (const kit of kits) {
      const accent = readableAccent(accentFor(kit));
      const ink = inkFor(accent) === '#ffffff' ? INK_LIGHT : INK_DARK;
      // 4.5:1 is the body-text floor, and a primary button's label is body text.
      if (contrast(accent, ink) < 4.5) {
        failures.push(`#${kit.toString(16).padStart(6, '0')} -> ${contrast(accent, ink).toFixed(2)}:1`);
      }
    }
    expect(failures.slice(0, 8)).toEqual([]);
  });

  it('keeps the club recognisable rather than clamping to a house colour', () => {
    // Legibility is not allowed to cost identity: two clearly different kits must stay
    // clearly different accents. A fix that mapped everything to one safe green would
    // pass both tests above and be a worse answer than failing them.
    // Checked by HUE, not by contrast(): WCAG contrast is a luminance ratio, so a red
    // and a blue of the same lightness score about 1:1 while being obviously different
    // colours. Using it here would assert the opposite of what this test is about.
    const red = readableAccent(accentFor(0xd42b2b));
    const blue = readableAccent(accentFor(0x2b4bd4));
    const yellow = readableAccent(accentFor(0xe8c33a));
    expect(red[0]).toBeGreaterThan(red[1] + 40);
    expect(red[0]).toBeGreaterThan(red[2] + 40);
    expect(blue[2]).toBeGreaterThan(blue[0] + 40);
    expect(yellow[0]).toBeGreaterThan(yellow[2] + 60);
    expect(yellow[1]).toBeGreaterThan(yellow[2] + 40);
  });

  it('leaves a colour that is already fine alone', () => {
    const bright = toRgb(0x46e08c);
    expect(readableAccent(bright)).toEqual(bright);
  });
});
