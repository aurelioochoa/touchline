// Emblem layers: build a badge out of pieces, the way a console emblem editor does.
//
// A layer is one glyph from the library below, in one colour, placed, sized, turned and
// optionally mirrored. Up to MAX_LAYERS of them stack inside the badge's outline, over its
// pattern and under its letters, and because they are clipped to the shape nothing a kid
// does here can make a badge that spills out of itself.
//
// Everything is small integers, like the rest of the crest, so a badge with twelve layers
// is still well under a hundred numbers in the save (format.ts packs them).
//
// The library is drawn here on a 24x24 grid, filled rather than stroked, for the reason
// crest.ts gives for its emblems: at badge size a filled silhouette survives and a line
// does not. Nothing in it is a real club's mark, a flag, or a religious or weapon symbol.

import type { EmblemLayer } from '../sim/world/types.js';
import { kitCss } from './theme.js';

export const MAX_LAYERS = 12;

export interface Glyph {
  d: string;
  /** For glyphs with holes cut out of them. */
  evenodd?: boolean;
}

export const GLYPHS: readonly Glyph[] = [
  { d: 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20Z' },                                     // circle
  { d: 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20ZM12 6.5a5.5 5.5 0 1 1 0 11a5.5 5.5 0 1 1 0-11Z', evenodd: true }, // ring
  { d: 'M3 3H21V21H3Z' },                                                                // square
  { d: 'M12 1L23 12L12 23L1 12Z' },                                                      // diamond
  { d: 'M12 2L22.5 21H1.5Z' },                                                           // triangle
  { d: 'M12 1.5L21.5 7V17L12 22.5L2.5 17V7Z' },                                          // hexagon
  { d: 'M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.5 6.1 20.6l1.2-6.5L2.5 9.5l6.6-.9Z' },   // star
  { d: 'M12 1L14.5 9.5L23 12L14.5 14.5L12 23L9.5 14.5L1 12L9.5 9.5Z' },                   // sparkle
  { d: 'M0 9H24V15H0Z' },                                                                // bar
  { d: 'M0 11H24V13H0Z' },                                                               // line
  { d: 'M0 20L20 0H24V4L4 24H0Z' },                                                      // slash
  { d: 'M2 8L12 16L22 8V13L12 21L2 13Z' },                                               // chevron
  { d: 'M12 2L21 12H15.5V22H8.5V12H3Z' },                                                // arrow
  { d: 'M9 2H15V9H22V15H15V22H9V15H2V9H9Z' },                                            // plus
  { d: 'M2 14A10 10 0 0 1 22 14Z' },                                                     // half-moon
  { d: 'M12 21C5 16 2 12.5 2 8.5A5 5 0 0 1 12 6A5 5 0 0 1 22 8.5C22 12.5 19 16 12 21Z' }, // heart
  { d: 'M15 2A10 10 0 1 0 22 16A8 8 0 1 1 15 2Z' },                                      // crescent
  { d: 'M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10ZM11 0h2v5h-2ZM11 19h2v5h-2ZM0 11h5v2H0ZM19 11h5v2h-5ZM3.5 5l1.5-1.5 3.5 3.5L7 8.5ZM15.5 17l1.5-1.5 3.5 3.5-1.5 1.5ZM3.5 19l3.5-3.5 1.5 1.5-3.5 3.5ZM15.5 7L19 3.5l1.5 1.5L17 8.5Z' }, // sun
  { d: 'M12 1C13 6 18 8 18 14A6 6 0 0 1 6 14C6 11 8 9.5 8.5 7C10 9 11 9.5 11 11C12.5 9 13 5 12 1Z' }, // flame
  { d: 'M13.6 2 5 13.6h5.4L9.5 22 19 10.2h-5.7Z' },                                       // bolt
  { d: 'M0 10C4 6 8 6 12 10C16 14 20 14 24 10V16C20 20 16 20 12 16C8 12 4 12 0 16Z' },    // wave
  { d: 'M1 21L9 7L13 13L16 9L23 21Z' },                                                  // mountain
  { d: 'M12 1L19 11H15L20 17H13.5V23H10.5V17H4L9 11H5Z' },                               // tree
  { d: 'M12 2c5 3.5 7.6 7.1 7.6 10.6A7.6 7.6 0 0 1 12 20.2a7.6 7.6 0 0 1-7.6-7.6C4.4 9.1 7 5.5 12 2Z' }, // leaf
  { d: 'M6 19A5 5 0 0 1 6.5 9A6.5 6.5 0 0 1 19 10.5A4.3 4.3 0 0 1 18.5 19Z' },            // cloud
  { d: 'M12 6a6 6 0 1 0 0 12a6 6 0 1 0 0-12ZM1 15C3 11 21 7 23 9C24 11 6 17 1 15Z' },     // planet
  { d: 'M3 8l4.6 4.2L12 3.6l4.4 8.6L21 8v10.4H3Z' },                                      // crown
  { d: 'M6 21V9l2-1.6V4h2.3v2h3.4V4H16v3.4L18 9v12Z' },                                   // tower
  { d: 'M12 1L21 4V11C21 16.5 17 20.5 12 23C7 20.5 3 16.5 3 11V4Z' },                    // shield
  { d: 'M6 2H18V4H22V7C22 10 20 12 17.5 12.5C16.7 14.6 15 16 13 16.3V19H17V22H7V19H11V16.3C9 16 7.3 14.6 6.5 12.5C4 12 2 10 2 7V4H6ZM4 6V7C4 8.6 5 9.8 6 10.3V6ZM18 6V10.3C19 9.8 20 8.6 20 7V6Z', evenodd: true }, // trophy
  { d: 'M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19Zm0 4.2 4.6 3.3-1.8 5.4H9.2L7.4 10Z', evenodd: true }, // football
  { d: 'M5 5.5h5.2l1.3 5.3 5.4 2.1c1.7.7 2.6 1.8 2.6 3.3v2.3H5Z' },                       // boot
  { d: 'M2.5 12.4c4-6.2 10.2-8.4 18.5-8.4-2 4.1-4.2 6.3-7.2 7.3 2 .5 3.1 1.5 3.6 3.1-3.1 0-5.2.6-7.2 2.2-1.5-2.1-4.1-3.6-7.7-4.2Z' }, // wing
  { d: 'M20 2C12 3 6 9 5 17L3 22L5 21L7 17C14 16 19 10 20 2Z' },                          // feather
  { d: 'M1 9C5 9 8 11 12 15C13 11 16 7 23 5C19 9 17 13 16 18C13 16 10 15 7 16C8 14 7 11 1 9Z' }, // bird
  { d: 'M2 12C6 6 13 6 17 12C13 18 6 18 2 12ZM17 12L23 7V17Z' },                          // fish
  { d: 'M5 6.5a2.2 2.8 0 1 0 4.4 0a2.2 2.8 0 1 0-4.4 0ZM14.6 6.5a2.2 2.8 0 1 0 4.4 0a2.2 2.8 0 1 0-4.4 0ZM1.6 11.5a2 2.5 0 1 0 4 0a2 2.5 0 1 0-4 0ZM18.4 11.5a2 2.5 0 1 0 4 0a2 2.5 0 1 0-4 0ZM12 11c4 0 7 4 7 7.5c0 2.5-2 3.5-4 3.5c-1.2 0-2-.6-3-.6s-1.8.6-3 .6c-2 0-4-1-4-3.5C5 15 8 11 12 11Z' }, // paw
  { d: 'M11 4.6a1.9 1.9 0 1 1 2 0V7h2.4v2H13v8.5c2.4-.5 4.1-2.1 4.6-4.5H16l3-4 3 4h-1.9C19.4 17.2 16.2 20 12 20s-7.4-2.8-8.1-7H2l3-4 3 4H6.4c.5 2.4 2.2 4 4.6 4.5V9H8.6V7H11Z' }, // anchor
  { d: 'M4 2H8V11A4 4 0 0 0 16 11V2H20V11A8 8 0 0 1 4 11Z' },                            // horseshoe
  { d: 'M7 3a5 5 0 1 0 0 10a5 5 0 1 0 0-10ZM7 6a2 2 0 1 1 0 4a2 2 0 1 1 0-4ZM11 7H23V10.5H21V13H18V10.5H11Z', evenodd: true }, // key
  { d: 'M8 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0ZM8 17a4 4 0 1 0 8 0a4 4 0 1 0-8 0ZM3 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0ZM13 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0Z' }, // clover
  { d: 'M2 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0ZM9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0ZM16 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0Z' }, // dots
  { d: 'M12 1a11 11 0 1 0 0 22a11 11 0 1 0 0-22ZM12 5a7 7 0 1 1 0 14a7 7 0 1 1 0-14ZM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6Z', evenodd: true }, // target
];

/**
 * What a layer can be painted in. The first two are the club's own colours, READ AT DRAW
 * TIME, so a layer in "first colour" follows the kit when it changes, exactly as the rest
 * of the badge does. The rest are fixed.
 */
export const LAYER_COLOURS: readonly (number | 'primary' | 'secondary')[] = [
  'primary', 'secondary', 0xffffff, 0x101418,
  0xd7263d, 0xe8632a, 0xf2b632, 0xf2c14e, 0x3fb950, 0x1f9e8c, 0x2f6ed8, 0x1b2a63,
  0x6a4bd8, 0xc23bb0, 0x8a5a2b, 0x7a8794, 0xb8c2cc, 0x5fd3ff,
];

export function layerColour(index: number, primary: number, secondary: number): number {
  const c = LAYER_COLOURS[index] ?? 'primary';
  return c === 'primary' ? primary : c === 'secondary' ? secondary : c;
}

/** A new layer: a star in the middle, in whichever fixed colour stands out on the badge. */
export function newLayer(glyph = 6): EmblemLayer {
  return { glyph, colour: 2, x: 0, y: 0, size: 30, rot: 0, flip: false };
}

/** Every field into range, so a stale save or an odd edit can never throw or escape. */
export function clampLayer(l: EmblemLayer): EmblemLayer {
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(v) || 0));
  return {
    glyph: clamp(l.glyph, 0, GLYPHS.length - 1),
    colour: clamp(l.colour, 0, LAYER_COLOURS.length - 1),
    x: clamp(l.x, -32, 32),
    y: clamp(l.y, -32, 32),
    size: clamp(l.size, 4, 72),
    rot: ((clamp(l.rot, -720, 720) % 360) + 360) % 360,
    flip: !!l.flip,
  };
}

/** One layer as SVG markup in the badge's 64-unit box. */
export function layerMarkup(layer: EmblemLayer, primary: number, secondary: number): string {
  const l = clampLayer(layer);
  const g = GLYPHS[l.glyph] as Glyph;
  const s = l.size / 24;
  return `<g transform="translate(${32 + l.x} ${32 + l.y}) rotate(${l.rot}) scale(${l.flip ? -s : s} ${s}) translate(-12 -12)">`
    + `<path d="${g.d}" fill="${kitCss(layerColour(l.colour, primary, secondary))}"`
    + `${g.evenodd ? ' fill-rule="evenodd"' : ''}/></g>`;
}

/** A glyph on its own, for the picker. */
export function glyphSvg(index: number, colour: string, size: number): SVGSVGElement {
  const g = GLYPHS[index] ?? (GLYPHS[0] as Glyph);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '-2 -2 28 28');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<path d="${g.d}" fill="${colour}"${g.evenodd ? ' fill-rule="evenodd"' : ''}/>`;
  return svg;
}
