// The club's colours, bound to the interface.
//
// `--tl-club` is the one accent in the whole design system, and it is the shirt the
// eleven are wearing. Every primary button, every focus ring, every selected tab and the
// stripe across the top of the application take it, so managing the yellow club and
// managing the navy one are visibly different games from the first screen.
//
// The catch is that a generated kit is any colour at all, including ones that are
// illegible on a dark green ground — a navy kit against `--tl-g1` is 1.3:1, which is a
// button you cannot see. So the colour is not used raw: it is lifted along its own hue
// until it clears the contrast floor, which keeps the club's identity and makes it
// readable, where clamping to a safe palette would lose the identity entirely.

import { clamp01 } from '../core/math.js';

/** WCAG relative luminance of an sRGB triple in 0..255. */
function luminance(r: number, g: number, b: number): number {
  const f = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio between two sRGB triples. */
export function contrast(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(a[0], a[1], a[2]);
  const lb = luminance(b[0], b[1], b[2]);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function toRgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

export function toCss(rgb: [number, number, number]): string {
  return `rgb(${Math.round(rgb[0])} ${Math.round(rgb[1])} ${Math.round(rgb[2])})`;
}

function toHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}

function fromHsl([h, s, l]: [number, number, number]): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number): number => {
    let v = t;
    if (v < 0) v += 1;
    if (v > 1) v -= 1;
    if (v < 1 / 6) return p + (q - p) * 6 * v;
    if (v < 1 / 2) return q;
    if (v < 2 / 3) return p + (q - p) * (2 / 3 - v) * 6;
    return p;
  };
  return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
}

/** The ground the accent has to sit on, from `--tl-g1` in styles.ts. */
const GROUND: [number, number, number] = [10, 32, 21];
/** Non-text UI needs 3:1 against its background; this leaves headroom over that. */
const MIN_ACCENT_CONTRAST = 3.6;

/**
 * Lift a kit colour until it is legible on the ground, keeping its hue and as much of
 * its saturation as possible. Walks lightness up in small steps rather than jumping,
 * because a navy that becomes sky blue is no longer the club's colour.
 */
export function accentFor(hex: number): [number, number, number] {
  const [h, s, l0] = toHsl(toRgb(hex));
  let l = l0;
  let rgb = fromHsl([h, s, l]);
  for (let i = 0; i < 40 && contrast(rgb, GROUND) < MIN_ACCENT_CONTRAST; i++) {
    l = clamp01(l + 0.02);
    rgb = fromHsl([h, Math.min(1, s * 1.01), l]);
    if (l >= 1) break;
  }
  return rgb;
}

const INK_DARK: [number, number, number] = [4, 21, 11];
const INK_LIGHT: [number, number, number] = [255, 255, 255];
/** Body text needs 4.5:1, and the label on a primary button is body text. */
const MIN_INK_CONTRAST = 4.5;

/** Black or white, whichever is readable on this colour. Text on the accent is text. */
export function inkFor(rgb: [number, number, number]): string {
  return contrast(rgb, INK_DARK) >= contrast(rgb, INK_LIGHT) ? '#04150b' : '#ffffff';
}

/**
 * Push a colour away from mid-lightness until SOMETHING readable can sit on it.
 *
 * Mid-tone kits are the problem case and there are a lot of them: a medium periwinkle
 * clears 3.6:1 against the dark ground, so `accentFor` is happy, and then neither black
 * nor white reaches 4.5:1 on top of it — which is a Watch button whose label is the least
 * legible text on the screen. Lightening is tried first because a football kit read at
 * button size wants to stay recognisably the club's colour, and lifting keeps the hue
 * where darkening tends to read as "some navy".
 */
export function readableAccent(rgb: [number, number, number]): [number, number, number] {
  const best = (c: [number, number, number]): number =>
    Math.max(contrast(c, INK_DARK), contrast(c, INK_LIGHT));
  if (best(rgb) >= MIN_INK_CONTRAST) return rgb;

  const [h, sat] = toHsl(rgb);
  let up = rgb;
  let down = rgb;
  for (let i = 1; i <= 50; i++) {
    const [, , l] = toHsl(rgb);
    up = fromHsl([h, sat, Math.min(1, l + i * 0.012)]);
    if (best(up) >= MIN_INK_CONTRAST) return up;
    down = fromHsl([h, sat, Math.max(0, l - i * 0.012)]);
    if (best(down) >= MIN_INK_CONTRAST) return down;
  }
  // Unreachable for any real colour, but a fallback beats returning something illegible.
  return best(up) >= best(down) ? up : down;
}

export interface ClubColors {
  kitPrimary: number;
  kitSecondary: number;
}

/**
 * Bind a club's kit to the design system's accent variables. Called on load, on picking
 * a club, and after promotion — anywhere the managed club can change.
 */
export function applyClubTheme(club: ClubColors | null): void {
  const root = document.documentElement;
  if (!club) {
    for (const k of ['--tl-club', '--tl-club-ink', '--tl-club-2', '--tl-club-soft']) {
      root.style.removeProperty(k);
    }
    return;
  }
  const accent = readableAccent(accentFor(club.kitPrimary));
  const second = accentFor(club.kitSecondary);
  root.style.setProperty('--tl-club', toCss(accent));
  root.style.setProperty('--tl-club-ink', inkFor(accent));
  root.style.setProperty('--tl-club-2', toCss(second));
  root.style.setProperty(
    '--tl-club-soft',
    `rgb(${Math.round(accent[0])} ${Math.round(accent[1])} ${Math.round(accent[2])} / 0.17)`,
  );
}

/** The raw kit colour as CSS, for places that draw the club rather than the theme. */
export function kitCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/**
 * Tell the stylesheet what the player asked for about movement.
 *
 * `null` removes the attribute and leaves the operating system's own preference in charge,
 * which is what Auto means. `true` and `false` are a choice, and a choice wins over an
 * inherited default in both directions — a player on a machine set to reduce motion who
 * picks Full gets Full.
 *
 * This exists because the setting was half wired: `Settings.reducedMotion` reached the match
 * camera and the intro's pen, and nothing else. Every CSS animation in the game — the card
 * entrances, the sheets, the coach's ring, the toast — was driven purely by the media query,
 * so turning motion off in the game's own Settings screen changed almost nothing on screen.
 */
export function applyMotion(reduced: boolean | null): void {
  const root = document.documentElement;
  if (reduced === null) root.removeAttribute('data-motion');
  else root.setAttribute('data-motion', reduced ? 'reduced' : 'full');
}
