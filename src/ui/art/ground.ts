// The ground you have been left.
//
// A small non-league ground at dusk: a hillside, a terrace, a covered stand, four pylons and
// a striped pitch running away from the viewer. It is the single highest-reach drawing in
// the game — it sits behind the whole inheritance story and behind the front door, which
// between them are the first two screens anybody ever sees, and both were previously a flat
// dark green rectangle with a card floating on it.
//
// It is a BACKDROP, not a picture: it lives behind the content at low opacity, fades out
// toward the top so text stays legible over it, and never contains anything a player has to
// see. The floodlights burn in the club's own colour, which is the one thing about it that
// changes from career to career.

import { scene } from './index.js';

/** Four pylons, two per side, at the corners a real ground puts them. */
function pylon(x: number, h: number, scale: number): string {
  const w = 13 * scale;
  const headW = 30 * scale;
  const headH = 15 * scale;
  const top = 300 - h;
  return `
    <g>
      <path d="M${x - w / 2} 300 L${x - w / 6} ${top + headH} L${x + w / 6} ${top + headH} L${x + w / 2} 300 Z"
            fill="var(--art-shade)"/>
      <path d="M${x - headW / 2} ${top + headH} L${x - headW / 2 + 3} ${top} L${x + headW / 2 - 3} ${top}
               L${x + headW / 2} ${top + headH} Z" fill="var(--art-ink)"/>
      <ellipse cx="${x}" cy="${top + headH / 2}" rx="${headW * 1.5}" ry="${headH * 1.9}"
               fill="var(--tl-club)" opacity="0.16"/>
    </g>`;
}

const MARKUP = `
  <defs>
    <linearGradient id="tl-art-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="var(--art-sky-top)"/>
      <stop offset="1" stop-color="var(--art-sky-low)"/>
    </linearGradient>
    <!--
      WHITE, not black. An SVG mask is a LUMINANCE mask by default, so the mask value is the
      stop's brightness times its alpha — and black at any alpha is zero brightness, which
      masks the whole drawing away rather than fading it. Painted black first, and the result
      was an empty rectangle that looked exactly like the flat background it was replacing.
    -->
    <linearGradient id="tl-art-fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/>
      <stop offset="0.34" stop-color="#fff" stop-opacity="0.75"/>
      <stop offset="0.6" stop-color="#fff" stop-opacity="1"/>
      <stop offset="1" stop-color="#fff" stop-opacity="1"/>
    </linearGradient>
    <mask id="tl-art-mask">
      <rect x="0" y="0" width="800" height="420" fill="url(#tl-art-fade)"/>
    </mask>
  </defs>

  <g mask="url(#tl-art-mask)">
    <rect x="0" y="0" width="800" height="420" fill="url(#tl-art-sky)"/>

    <!-- The hill behind the far side. Two values, no blend: the lit slope and its shade. -->
    <path d="M0 232 L96 196 L188 216 L268 180 L352 210 L438 184 L534 214 L628 190 L716 216 L800 198 L800 300 L0 300 Z"
          fill="var(--art-shade)" opacity="0.85"/>
    <path d="M268 180 L352 210 L438 184 L438 300 L268 300 Z" fill="var(--art-ink)" opacity="0.35"/>

    <!-- Floodlights, behind the stands so the pylons read as further away than the roof. -->
    ${pylon(92, 176, 1)}
    ${pylon(708, 176, 1)}
    ${pylon(236, 150, 0.82)}
    ${pylon(564, 150, 0.82)}

    <!-- The far stand: a flat roof on posts, a terrace of seats under it. -->
    <path d="M150 214 H650 L662 226 H138 Z" fill="var(--art-ink)"/>
    <rect x="146" y="226" width="508" height="10" fill="var(--art-shade)"/>
    <path d="M158 236 H642 L654 268 H146 Z" fill="var(--art-shade)"/>
    <g fill="var(--tl-club)" opacity="0.5">
      ${Array.from({ length: 30 }, (_, i) => {
        const x = 168 + i * 16;
        return `<rect x="${x}" y="${242 + (i % 3)}" width="9" height="5" rx="2"/>`;
      }).join('')}
    </g>
    <g fill="var(--art-ink)" opacity="0.55">
      ${Array.from({ length: 26 }, (_, i) => `<rect x="${176 + i * 18}" y="${254}" width="10" height="5" rx="2"/>`).join('')}
    </g>

    <!-- The advertising boards, then the grass. -->
    <rect x="120" y="268" width="560" height="12" fill="var(--art-ink)" opacity="0.9"/>
    <path d="M120 280 L680 280 L800 420 L0 420 Z" fill="var(--art-grass)"/>

    <!-- Mown stripes, converging because the pitch runs away from us. -->
    <g fill="var(--art-grass-lit)" opacity="0.28">
      ${Array.from({ length: 6 }, (_, i) => {
        const top = 120 + i * 94;
        const bottom = -100 + i * 226;
        return `<path d="M${top} 280 L${top + 47} 280 L${bottom + 113} 420 L${bottom} 420 Z"/>`;
      }).join('')}
    </g>

    <!-- A halfway line and the centre circle, seen almost edge on. The circle sits ON the
         line rather than beside it: at y=330 the line has already leaned to x=342, and a
         centre circle the halfway line misses is the kind of wrong nobody can name but
         everybody sees. -->
    <path d="M356 280 L318 420" stroke="var(--art-line)" stroke-width="2.5" fill="none" opacity="0.3"/>
    <ellipse cx="342" cy="330" rx="72" ry="17" stroke="var(--art-line)" stroke-width="2.5"
             fill="none" opacity="0.26"/>
  </g>
`;

/**
 * The backdrop, as an element.
 *
 * One instance per screen that wants it; the markup is a constant, so building it is a parse
 * and nothing else.
 */
export function groundScene(): SVGSVGElement {
  // Not `fill`: the CSS gives it a width and lets the height follow, so the drawing is
  // never cropped horizontally and the viewport trims the sky instead.
  return scene({ viewBox: '0 0 800 420', markup: MARKUP, className: 'tl-art-ground' });
}
