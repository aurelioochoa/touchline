// First-party illustration, as inline SVG in TypeScript.
//
// WHY NOT IMAGE FILES. The game ships zero asset files — no .png, no .webp, no .glb, no
// font — and `scripts/check-licenses.mjs` fails the build on any of them (design §9). That
// is not an obstacle worked around here, it is the reason this directory is shaped the way
// it is, and the shape turns out to be better than a bitmap for what these drawings have to
// do:
//
//   - **They re-colour.** Every scene takes the club's own primary as its accent, so the
//     ground a kid inherits is lit in their colours. A raster would be one club's colours
//     forever, or forty copies.
//   - **They cost kilobytes, not hundreds of them.** The whole of this directory is smaller
//     than one 800px screenshot.
//   - **They scale.** One drawing serves a phone and a 4K monitor with no @2x anything.
//
// HOUSE STYLE, so the pieces look like each other:
//
//   - Flat vector with a TWO-VALUE shading model — one lit face, one shade face. No
//     gradients except a single linear sky, and no blurs except one floodlight bloom.
//   - Dusk and floodlight throughout, so the illustrations and the 3D match look like they
//     happen on the same evening.
//   - Geometry over organic shape: straight roofs, honest ellipses, generous empty space.
//   - Colour comes from three custom properties and nothing else — --art-ink, --art-shade
//     and the club's --tl-club — so a scene inherits the page it is on.

import { el } from '../dom.js';

/**
 * Wrap scene markup in an element.
 *
 * `innerHTML` on a namespaced <svg> rather than node-by-node construction, for the same
 * reason `crest.ts` does it: a drawing is a hundred elements with namespaced attributes and
 * the assembled version is unreadable. Everything here is authored in this repo — none of it
 * is ever built from anything a player or a network supplied.
 */
export function scene(opts: {
  viewBox: string;
  markup: string;
  className?: string;
  /** Scenes are decoration. A named one gets a label; the rest are hidden from readers. */
  label?: string;
  /**
   * How the drawing meets its box. A BACKDROP fills it and lets the edges run off
   * ('xMidYMax slice'); a picture fits inside it whole, which is the default.
   */
  fill?: boolean;
}): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', opts.viewBox);
  svg.setAttribute('class', `tl-art${opts.className ? ` ${opts.className}` : ''}`);
  svg.setAttribute('preserveAspectRatio', opts.fill ? 'xMidYMax slice' : 'xMidYMid meet');
  if (opts.label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', opts.label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  svg.innerHTML = opts.markup;
  return svg;
}

export { el };
