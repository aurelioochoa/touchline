// The club studio's pictures: a kit and the ground, drawn from the same numbers the 3D
// match reads — `kitColour` for the kit parts, `patternSvg` for the shirt pattern, the stand
// count from the facilities. (The ball has its own file, ./ball.ts.) A preview is a promise, so none of these carries a colour of
// its own that the match would not also use.
//
// House style as in ./index.ts: flat, two values of shade, geometry over organic shape.

import { roofColour } from '../../render/ballStyle.js';
import { NUMBER_STYLES, patternSvg } from '../../render/kitPattern.js';
import { kitColour, type ClubLook } from '../../sim/world/types.js';
import { kitCss } from '../theme.js';
import { scene } from './index.js';
import { inkOn } from '../../sim/world/worldgen.js';

export interface KitArtColours {
  primary: number;
  secondary: number;
}

export interface KitArtOptions {
  label?: string;
  className?: string;
  /** Front shows the pattern and the chest badge; back shows the name and the number. */
  side?: 'front' | 'back';
  /** The badge to wear on the chest, when the look asks for one. */
  crest?: SVGSVGElement;
  number?: number;
  name?: string;
  /** Just the shirt, cropped — for the pattern picker's thumbnails. */
  shirtOnly?: boolean;
}

let kitIds = 0;

/**
 * The colour the numbers are printed in — the one the look asks for, unless it would vanish
 * into the shirt, in which case whichever of black or white the shirt can carry. A number
 * nobody can read is not a design choice anybody meant to make.
 */
export function numberInk(look: ClubLook, c: KitArtColours): number {
  const want = kitColour(look.numberColour, c.primary, c.secondary);
  const diff = (x: number, y: number): number =>
    Math.abs(((x >> 16) & 255) - ((y >> 16) & 255))
    + Math.abs(((x >> 8) & 255) - ((y >> 8) & 255))
    + Math.abs((x & 255) - (y & 255));
  if (diff(want, c.primary) > 120) return want;
  return inkOn(c.primary) === '#ffffff' ? 0xf5f7fa : 0x12211a;
}

/** SVG text attributes for each NUMBER_STYLES entry. */
function numberAttrs(style: number, ink: string, outline: string): string {
  switch (NUMBER_STYLES[style] ?? 'classic') {
    case 'block':
      return `font-weight="900" letter-spacing="-1" fill="${ink}" stroke="${outline}" stroke-width="1.4" paint-order="stroke"`;
    case 'italic':
      return `font-weight="900" font-style="italic" fill="${ink}"`;
    case 'outline':
      return `font-weight="900" fill="none" stroke="${ink}" stroke-width="1.5"`;
    default:
      return `font-weight="760" fill="${ink}"`;
  }
}

/** A shirt, shorts and socks — front on, or from behind with a name and number. */
export function kitArt(look: ClubLook, c: KitArtColours, opts: KitArtOptions = {}): SVGSVGElement {
  const side = opts.side ?? 'front';
  const shirt = kitCss(c.primary);
  const sleeve = kitCss(kitColour(look.sleeves, c.primary, c.secondary));
  const shorts = kitCss(kitColour(look.shorts, c.primary, c.secondary));
  const sock = kitCss(kitColour(look.socks, c.primary, c.secondary));
  const trim = kitCss(c.secondary === c.primary ? 0xf5f7fa : c.secondary);
  const patternFill = kitCss(kitColour(look.patternColour, c.primary, c.secondary));
  const id = `tl-kit-${++kitIds}`;
  const edge = 'stroke="rgba(0,0,0,0.42)" stroke-width="1.6" stroke-linejoin="round"';
  const body = 'M40 16 51 11q9 9 18 0l11 5 4 54H36Z';
  const collar = side === 'front'
    ? `<path d="M51 11q9 11 18 0" fill="none" stroke="${trim}" stroke-width="3.2" stroke-linecap="round"/>`
    : `<path d="M51 11q9 4 18 0" fill="none" stroke="${trim}" stroke-width="3.2" stroke-linecap="round"/>`;
  // The pattern is painted in the shirt's unit box (u -1..1 across, v 0..1 down) and clipped
  // to the body — the same box the 3D shader reads, which is what keeps the two alike.
  const pattern = `<g clip-path="url(#${id}-body)"><g transform="translate(60 11) scale(24 59)">`
    + `${patternSvg(look.pattern, patternFill, `${id}-fade`)}</g></g>`;
  let back = '';
  if (side === 'back') {
    const inkHex = numberInk(look, c);
    const ink = kitCss(inkHex);
    const outline = inkOn(inkHex) === '#ffffff' ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.6)';
    const attrs = numberAttrs(look.numberStyle, ink, outline);
    back = `<text x="60" y="58" text-anchor="middle" font-family="system-ui, sans-serif" font-size="27" ${attrs}>${
      String(opts.number ?? 10).slice(0, 2)}</text>`;
  }
  const markup = `
    <defs><clipPath id="${id}-body"><path d="${body}"/></clipPath></defs>
    <path d="M40 16 20 28l6 20 13-6Z" fill="${sleeve}" ${edge}/>
    <path d="M80 16l20 12-6 20-13-6Z" fill="${sleeve}" ${edge}/>
    <path d="${body}" fill="${shirt}"/>
    ${pattern}
    <path d="${body}" fill="none" ${edge}/>
    <path d="M60 18q5-3 9-7l11 5 4 54H60Z" fill="#000" opacity="0.12"/>
    ${collar}
    ${back}
    <path d="M36 73h48l4 32H65l-5-10-5 10H32Z" fill="${shorts}" ${edge}/>
    <path d="M60 73h24l4 32H65l-5-10Z" fill="#000" opacity="0.14"/>
    <rect x="37" y="112" width="15" height="32" rx="3" fill="${sock}" ${edge}/>
    <rect x="68" y="112" width="15" height="32" rx="3" fill="${sock}" ${edge}/>
    <rect x="37" y="112" width="15" height="6" rx="2" fill="#000" opacity="0.2"/>
    <rect x="68" y="112" width="15" height="6" rx="2" fill="#000" opacity="0.2"/>`;
  const svg = scene({
    viewBox: opts.shirtOnly ? '17 8 86 64' : '14 6 92 142',
    markup,
    className: `tl-kit-art${opts.className ? ` ${opts.className}` : ''}`,
    ...(opts.label ? { label: opts.label } : {}),
  });
  const ns = 'http://www.w3.org/2000/svg';
  if (side === 'front' && look.chestBadge && opts.crest) {
    // The badge on the left of the chest, where the 3D shirt carries its patch.
    const badge = opts.crest;
    badge.setAttribute('x', '44');
    badge.setAttribute('y', '20');
    badge.setAttribute('width', '12');
    badge.setAttribute('height', '12');
    badge.removeAttribute('class');
    svg.append(badge);
  }
  if (side === 'back' && opts.name) {
    // A text node, never markup: it is a name a player typed.
    const inkHex = numberInk(look, c);
    const text = document.createElementNS(ns, 'text');
    text.setAttribute('x', '60');
    text.setAttribute('y', '27');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-family', 'system-ui, sans-serif');
    text.setAttribute('font-weight', '800');
    text.setAttribute('font-size', '6.4');
    text.setAttribute('letter-spacing', '0.6');
    text.setAttribute('textLength', String(Math.min(34, opts.name.length * 4.6)));
    text.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    text.setAttribute('fill', kitCss(inkHex));
    text.textContent = opts.name.toUpperCase().slice(0, 12);
    svg.append(text);
  }
  return svg;
}

/**
 * The ground from the side: a stand whose tiers grow with every extension, the roof in its
 * chosen colour, two floodlight pylons, and the ground's name on the fascia.
 */
export function stadiumArt(
  look: ClubLook,
  c: KitArtColours,
  standsLevel: number,
  name: string,
  opts: { className?: string } = {},
): SVGSVGElement {
  const tiers = 3 + Math.max(0, Math.min(4, standsLevel));
  const base = 112;
  const rowH = 10;
  const top = base - tiers * rowH;
  const roof = kitCss(roofColour(look.roof, c.primary, c.secondary));
  let rows = '';
  for (let i = 0; i < tiers; i++) {
    const inset = 18 + i * 7;
    const y = base - (i + 1) * rowH;
    // The crowd: the club's colour on alternate rows, the shade between them.
    rows += `<path d="M${inset} ${y + rowH}L${inset + 7} ${y}H${320 - inset - 7}L${320 - inset} ${y + rowH}Z"`
      + ` fill="${i % 2 === 0 ? 'var(--tl-club)' : 'var(--art-shade)'}" opacity="${i % 2 === 0 ? 0.72 : 1}"/>`;
    rows += `<path d="M${inset + 7} ${y}H${320 - inset - 7}" stroke="var(--art-ink)" stroke-width="1.2" opacity="0.6"/>`;
  }
  const roofL = 18 + tiers * 7 - 12;
  const roofR = 320 - roofL;
  const markup = `
    <rect x="0" y="${base}" width="320" height="28" fill="var(--art-grass)"/>
    <rect x="0" y="${base}" width="320" height="3" fill="var(--art-grass-lit)"/>
    <path d="M60 ${base + 14}H260" stroke="var(--art-line)" stroke-width="1.4" opacity="0.5"/>
    ${rows}
    <rect x="18" y="${base - 7}" width="284" height="8" fill="var(--art-ink)"/>
    <path d="M${roofL + 8} ${top - 1}V${top - 12}M${roofR - 8} ${top - 1}V${top - 12}M160 ${top - 1}V${top - 12}"
      stroke="var(--art-shade)" stroke-width="2.4"/>
    <path d="M${roofL} ${top - 12}H${roofR}l6 -11H${roofL - 6}Z" fill="${roof}" stroke="rgba(0,0,0,0.45)" stroke-width="1.2"/>
    <g stroke="var(--art-shade)" stroke-width="3" stroke-linecap="round">
      <path d="M8 ${base}V16M312 ${base}V16"/>
    </g>
    <g fill="var(--art-paper-lit)">
      <rect x="1" y="9" width="14" height="8" rx="1.5"/>
      <rect x="305" y="9" width="14" height="8" rx="1.5"/>
    </g>`;
  const svg = scene({
    viewBox: '0 0 320 140',
    markup,
    className: `tl-stadium-art${opts.className ? ` ${opts.className}` : ''}`,
    label: name,
  });
  // Anchored to the bottom, so the grass meets the stage's own ground line (styles.ts).
  svg.setAttribute('preserveAspectRatio', 'xMidYMax meet');
  // The name goes in as a text node, never through the markup string: it is the one thing
  // in these drawings a player typed.
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', '160');
  // On the roof's fascia, where a ground's name actually goes — and where the kit standing
  // on the pitch in front of the stand cannot cover it.
  text.setAttribute('y', String(top - 15.2));
  text.setAttribute('fill', inkOn(roofColour(look.roof, c.primary, c.secondary)));
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('class', 'tl-stadium-name');
  text.textContent = name.toUpperCase();
  svg.append(text);
  return svg;
}
