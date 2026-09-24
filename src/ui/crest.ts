// The club badge, drawn rather than stored.
//
// Zero asset files (design §9), so a crest is SVG built from the club's two kit colours and
// a handful of small integers. Six of them, and what they buy is that no two clubs in a
// league table look alike:
//
//   shape · pattern · border · emblem · stars · initials
//
// WHY THE COLOURS ARE NOT IN THE SPEC. They are the club's kit, read at draw time. A crest
// that carried its own copy could disagree with the shirt the moment somebody changed one,
// and a badge that is not the team's colours is not a badge. This is the same rule
// `platform.ts` keeps on the site: one fact, one home.
//
// EVERY CLUB HAS ONE. The badge used to be a single index on the World, meaning the managed
// club and nobody else, and the function the rest of the game actually called was a CSS
// gradient in a rounded box — identical for all three hundred clubs, at every size, on every
// screen. So the league table, the club picker and the fixture card each drew twenty
// slightly differently coloured versions of the same blob. `derivedCrest` fixes that for
// nothing: a club's badge is a hash of its id, so it is stable for the life of the save, the
// same on every screen, and costs not one byte to store. Only the club the player manages
// has an authored crest, and only that one is written down.

import { inkOn } from '../sim/world/worldgen.js';
import type { Club, CrestSpec, World } from '../sim/world/types.js';
import { kitCss } from './theme.js';
import { clampLayer, layerMarkup, MAX_LAYERS } from './emblems.js';

// ---- shapes -------------------------------------------------------------------
//
// Closed outlines on a 64x64 grid, all of roughly equal visual mass so that a table of them
// reads as a set. The clip and the border stroke are the same path, which is what keeps a
// pattern from leaking past the edge.

export const CREST_SHAPES: readonly string[] = [
  // Heater — the classic pointed shield, and the one the game shipped with.
  'M32 3 L59 12 V33 C59 47 47 56 32 61 C17 56 5 47 5 33 V12 Z',
  // Roundel. Two half-arcs rather than one, because a single 360-degree arc has no
  // direction and renders as nothing at all.
  'M3 32 A29 29 0 1 1 61 32 A29 29 0 1 1 3 32 Z',
  // Hexagon.
  'M32 2.5 L57.5 17 V47 L32 61.5 L6.5 47 V17 Z',
  // Lozenge.
  'M32 2 L60 32 L32 62 L4 32 Z',
  // Banner, with the swallowtail a pennant has.
  'M7 4 H57 V50 L44.5 43 L32 52 L19.5 43 L7 50 Z',
  // Rounded square, for the clubs that read as a monogram.
  'M15 4 H49 A11 11 0 0 1 60 15 V49 A11 11 0 0 1 49 60 H15 A11 11 0 0 1 4 49 V15 A11 11 0 0 1 15 4 Z',
  // Scudetto: flat across the top, a deep U underneath.
  'M6 5 H58 V33 C58 47 46 56 32 61 C18 56 6 47 6 33 Z',
  // Spade — a shield with the shoulders drawn in.
  'M32 3 C36 8 46 9.5 56 11 V33 C56 47 45 56 32 61 C19 56 8 47 8 33 V11 C18 9.5 28 8 32 3 Z',
];

// ---- patterns -----------------------------------------------------------------
//
// Painted across the whole 64x64 box and clipped to the shape, so one pattern serves every
// outline. `a` is the club's primary, `b` its secondary.

type Pattern = (a: string, b: string) => string;

const band = (x: number, y: number, w: number, h: number, fill: string): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;

export const CREST_PATTERNS: readonly Pattern[] = [
  // Plain.
  (a) => band(0, 0, 64, 64, a),
  // Sash.
  (a, b) => band(0, 0, 64, 64, a) + `<path d="M-6 46 L46 -6 L64 8 L12 60 Z" fill="${b}"/>`,
  // Halves.
  (a, b) => band(0, 0, 32, 64, a) + band(32, 0, 32, 64, b),
  // Per fess — halved across rather than down.
  (a, b) => band(0, 0, 64, 32, a) + band(0, 32, 64, 32, b),
  // Quarters.
  (a, b) => band(0, 0, 64, 64, a) + band(32, 0, 32, 32, b) + band(0, 32, 32, 32, b),
  // Hoops.
  (a, b) => band(0, 0, 64, 64, a)
    + [0, 1, 2, 3].map((i) => band(0, 8 + i * 15, 64, 7.5, b)).join(''),
  // Stripes.
  (a, b) => band(0, 0, 64, 64, a)
    + [0, 1, 2].map((i) => band(9 + i * 17, 0, 8, 64, b)).join(''),
  // Chevron.
  (a, b) => band(0, 0, 64, 64, a)
    + `<path d="M32 8 L64 40 V56 L32 24 L0 56 V40 Z" fill="${b}"/>`,
  // Checks. Eight across is too fine to read at 22px and four is a quartered shield with
  // extra steps, so: six.
  (a, b) => band(0, 0, 64, 64, a)
    + Array.from({ length: 36 }, (_, i) => {
      const cx = i % 6;
      const cy = Math.floor(i / 6);
      return (cx + cy) % 2 === 0 ? band(cx * 11, cy * 11, 11, 11, b) : '';
    }).join(''),
  // Pale — one broad band down the middle.
  (a, b) => band(0, 0, 64, 64, a) + band(24, 0, 16, 64, b),
];

// ---- borders ------------------------------------------------------------------
//
// Stroked along the shape path AFTER the pattern, so half the stroke sits over the fill and
// the edge stays crisp whatever the pattern does underneath it.

type Border = (d: string, ink: string, secondary: string) => string;

const stroke = (d: string, colour: string, width: number, extra = ''): string =>
  `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${width}" stroke-linejoin="round" ${extra}/>`;

export const CREST_BORDERS: readonly Border[] = [
  // None. The pattern runs to the edge, which is what a modern minimal badge does.
  () => '',
  // A single light rule. The game's original.
  (d) => stroke(d, 'rgba(255,255,255,0.85)', 2.4),
  // Double: a heavy outer in the club's second colour with a light rule inside it.
  (d, _ink, secondary) => stroke(d, secondary, 6) + stroke(d, 'rgba(255,255,255,0.9)', 2),
  // Rope, which is a dash pattern and reads as stitching at small sizes.
  (d) => stroke(d, 'rgba(255,255,255,0.9)', 2.6, 'stroke-dasharray="4.5 3.2" stroke-linecap="round"'),
  // Bold, in whichever of black or white the primary can carry.
  (d, ink) => stroke(d, ink, 4.5),
];

// ---- emblems ------------------------------------------------------------------
//
// Solid shapes on a 24x24 grid, centred and scaled into the badge by `emblemMarkup`. Solid
// rather than stroked: an outline at 22px is a smudge, and a filled silhouette is still a
// silhouette. Index 0 is deliberately nothing — a plain badge has to remain reachable.

export const CREST_EMBLEMS: readonly string[] = [
  '',
  // A football: a disc with a pentagon cut out of it.
  'M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19Zm0 4.2 4.6 3.3-1.8 5.4H9.2L7.4 10Z',
  // A star.
  'M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.5 6.1 20.6l1.2-6.5L2.5 9.5l6.6-.9Z',
  // A boot.
  'M5 5.5h5.2l1.3 5.3 5.4 2.1c1.7.7 2.6 1.8 2.6 3.3v2.3H5Z',
  // A leaf.
  'M12 2c5 3.5 7.6 7.1 7.6 10.6A7.6 7.6 0 0 1 12 20.2a7.6 7.6 0 0 1-7.6-7.6C4.4 9.1 7 5.5 12 2Z',
  // A tower.
  'M6 21V9l2-1.6V4h2.3v2h3.4V4H16v3.4L18 9v12Z',
  // An anchor.
  'M11 4.6a1.9 1.9 0 1 1 2 0V7h2.4v2H13v8.5c2.4-.5 4.1-2.1 4.6-4.5H16l3-4 3 4h-1.9C19.4 17.2 16.2 20 12 20s-7.4-2.8-8.1-7H2l3-4 3 4H6.4c.5 2.4 2.2 4 4.6 4.5V9H8.6V7H11Z',
  // A crown.
  'M3 8l4.6 4.2L12 3.6l4.4 8.6L21 8v10.4H3Z',
  // A lightning bolt.
  'M13.6 2 5 13.6h5.4L9.5 22 19 10.2h-5.7Z',
  // A wing.
  'M2.5 12.4c4-6.2 10.2-8.4 18.5-8.4-2 4.1-4.2 6.3-7.2 7.3 2 .5 3.1 1.5 3.6 3.1-3.1 0-5.2.6-7.2 2.2-1.5-2.1-4.1-3.6-7.7-4.2Z',
];

/**
 * How many championship stars a badge may wear.
 *
 * Three, because four in a row across a 64-unit shield is 12 units each and stops being
 * three of anything.
 */
export const CREST_MAX_STARS = 3;

// ---- the spec -----------------------------------------------------------------

/** Every field wrapped into range, so a bad save or a stale index can never throw. */
function normalise(spec: CrestSpec): Required<CrestSpec> {
  const wrap = (v: number, n: number): number => ((Math.trunc(v) % n) + n) % n;
  return {
    layers: (spec.layers ?? []).slice(0, MAX_LAYERS).map(clampLayer),
    shape: wrap(spec.shape, CREST_SHAPES.length),
    pattern: wrap(spec.pattern, CREST_PATTERNS.length),
    border: wrap(spec.border, CREST_BORDERS.length),
    emblem: wrap(spec.emblem, CREST_EMBLEMS.length),
    stars: Math.max(0, Math.min(CREST_MAX_STARS, Math.trunc(spec.stars))),
    initials: spec.initials,
  };
}

/** The badge every club starts with — the shield the game shipped with. */
export function defaultCrest(): CrestSpec {
  return { shape: 0, pattern: 1, border: 1, emblem: 0, stars: 0, initials: true };
}

/**
 * A club's badge, derived from its id.
 *
 * Deterministic and stored nowhere: three hundred clubs get three hundred badges for zero
 * bytes of save, and the same club wears the same one on every screen and after every
 * reload. `Math.random` here would give a club a different badge each time a table
 * re-rendered, which is worse than the single blob it replaces.
 *
 * The hash is a plain integer mix rather than one of `core/rng.ts`'s streams because this is
 * not simulation: nothing about it may ever feed a result, and drawing from a world stream
 * would couple what a badge looks like to how many times something asked for one.
 */
export function derivedCrest(club: Club): CrestSpec {
  let h = Math.imul(club.id + 1, 2654435761) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 2246822519) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 3266489917) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  // Separate bit slices per field, so two clubs sharing a shape do not also share a pattern.
  const slice = (shift: number, n: number): number => ((h >>> shift) & 0xff) % n;
  return withFeature({
    shape: slice(0, CREST_SHAPES.length),
    pattern: slice(8, CREST_PATTERNS.length),
    border: slice(16, CREST_BORDERS.length),
    // Most badges carry no emblem. A league in which every club has a lion on it is a league
    // where the lion means nothing, so the odds are weighted rather than uniform.
    emblem: slice(24, 3) === 0 ? slice(20, CREST_EMBLEMS.length - 1) + 1 : 0,
    // And almost none carry a star. They are for winning things.
    stars: slice(12, 16) === 0 ? 1 : 0,
    initials: slice(4, 4) !== 0,
  }, slice(28, 251));
}

/**
 * A plain field with nothing on it is a swatch, not a badge — so give it something.
 *
 * The initials do not count. They stop being drawn below 44px, which is every crest in the
 * league table and every crest in the club picker, so a badge relying on them for its only
 * feature is a rectangle of colour exactly where twenty of them sit in a column. Seen at
 * 22px on the table before this rule existed.
 *
 * A player who deliberately picks a plain badge in the editor still gets one; this only
 * applies where nobody chose.
 */
function withFeature(spec: CrestSpec, seed: number): CrestSpec {
  if (spec.pattern !== 0 || spec.emblem !== 0) return spec;
  return { ...spec, emblem: (seed % (CREST_EMBLEMS.length - 1)) + 1 };
}

/**
 * Which badge a club actually wears.
 *
 * The managed club's is the one the player authored, if they ever opened the editor;
 * everybody else's is derived. A `null` on the world means "never customised", which is what
 * lets a career started before the editor existed keep the badge it has always had.
 */
export function crestOf(world: World, club: Club): CrestSpec {
  if (club.id === world.managedClubId && world.crest) return world.crest;
  return derivedCrest(club);
}

// ---- drawing ------------------------------------------------------------------

export interface CrestRenderOptions {
  spec: CrestSpec;
  primary: number;
  secondary: number;
  /** Up to three characters across the middle, when the spec asks for initials. */
  short?: string;
  size?: number;
  label?: string;
}

/**
 * Markup is cached, not elements.
 *
 * The league table draws twenty badges per render and the club picker forty-eight; each is a
 * dozen namespaced nodes, and building the string is most of the cost. A cached element
 * cannot be reused — it can only be in one place at a time — but a cached string can be
 * stamped into a fresh `<svg>` as many times as anybody asks.
 */
const MARKUP_CACHE = new Map<string, string>();
/** Roughly one full catalogue's worth at three sizes. Beyond that, oldest out. */
const CACHE_LIMIT = 900;

function emblemMarkup(index: number, colour: string, withInitials: boolean): string {
  const path = CREST_EMBLEMS[index];
  if (!path) return '';
  // Sharing the badge with three letters means going small and moving up out of their way.
  const scale = withInitials ? 0.72 : 1.35;
  const cy = withInitials ? 21 : 33;
  const offset = 12 * scale;
  return `<g transform="translate(${(32 - offset).toFixed(2)} ${(cy - offset).toFixed(2)}) scale(${scale})">`
    + `<path d="${path}" fill="${colour}" fill-rule="evenodd"/></g>`;
}

function starsMarkup(count: number, colour: string): string {
  if (count <= 0) return '';
  const star = 'M6 0.6l1.7 3.5 3.9.6-2.8 2.7.7 3.8L6 9.4 2.5 11.2l.7-3.8L0.4 4.7l3.9-.6Z';
  const gap = 11;
  const left = 32 - ((count - 1) * gap) / 2;
  return Array.from({ length: count }, (_, i) =>
    `<g transform="translate(${(left + i * gap - 6).toFixed(2)} 7) scale(0.62)">`
    + `<path d="${star}" fill="${colour}"/></g>`).join('');
}

function markupFor(opts: CrestRenderOptions): string {
  const spec = normalise(opts.spec);
  const a = kitCss(opts.primary);
  const b = kitCss(opts.secondary);
  const ink = inkOn(opts.primary);
  // The letters sit across the WHOLE badge, and half of it may be the other colour. Ink
  // chosen for the primary alone is invisible over the secondary — on a halved crest the
  // middle letter simply disappeared, so a club read as "P O". The halo is the opposite
  // value to the fill, which keeps three letters legible over any two colours we allow.
  const halo = ink === '#ffffff' ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.7)';
  const size = opts.size ?? 64;
  const d = CREST_SHAPES[spec.shape] as string;
  const pattern = CREST_PATTERNS[spec.pattern] as Pattern;
  const border = CREST_BORDERS[spec.border] as Border;
  // Unique per badge, because two crests on one page with the same clipPath id would both
  // resolve to whichever was parsed last.
  const clip = `tl-crest-${spec.shape}-${spec.pattern}-${opts.primary.toString(16)}-${opts.secondary.toString(16)}`;
  // Three letters in a 64-unit badge need about 36 device pixels before they are letters
  // rather than grey texture; below that the badge is the club's colours and shape, which is
  // all a 22px table row was ever going to carry anyway. 36 rather than a rounder number
  // because that is the size the chrome draws the managed club's badge at, and the three
  // letters on it are how a kid finds their own club in a list.
  const short = (opts.short ?? '').slice(0, 3).toUpperCase();
  const withInitials = spec.initials && !!short && size >= 36;

  return `<defs><clipPath id="${clip}"><path d="${d}"/></clipPath></defs>`
    + `<g clip-path="url(#${clip})">${pattern(a, b)}`
    + starsMarkup(spec.stars, ink)
    + emblemMarkup(spec.emblem, ink, withInitials)
    // Emblem layers: over the pattern and the symbol, under the letters, inside the clip.
    + spec.layers.map((l) => layerMarkup(l, opts.primary, opts.secondary)).join('')
    + `</g>`
    + border(d, ink, b)
    + (withInitials
      ? `<text x="32" y="${spec.emblem ? 47 : 41}" text-anchor="middle"
             font-family="system-ui, sans-serif" font-weight="800"
             font-size="19" letter-spacing="0.5"
             fill="${ink}"
             stroke="${halo}" stroke-width="2" stroke-linejoin="round" paint-order="stroke"
           >${escapeText(short)}</text>`
      : '');
}

/**
 * One crest as an inline SVG element.
 *
 * Built as markup and parsed, rather than assembled node by node: a badge is two dozen
 * elements with namespaced attributes, and `innerHTML` on an `<svg>` is both shorter and the
 * only version anybody can read.
 */
export function crestSvg(opts: CrestRenderOptions): SVGSVGElement {
  const size = opts.size ?? 64;
  const spec = normalise(opts.spec);
  const key = `${spec.shape}|${spec.pattern}|${spec.border}|${spec.emblem}|${spec.stars}`
    + `|${spec.initials ? 1 : 0}|${opts.primary}|${opts.secondary}|${opts.short ?? ''}|${size}`
    + `|${spec.layers.map((l) => `${l.glyph},${l.colour},${l.x},${l.y},${l.size},${l.rot},${l.flip ? 1 : 0}`).join(';')}`;
  let markup = MARKUP_CACHE.get(key);
  if (markup === undefined) {
    markup = markupFor(opts);
    if (MARKUP_CACHE.size >= CACHE_LIMIT) {
      const oldest = MARKUP_CACHE.keys().next().value;
      if (oldest !== undefined) MARKUP_CACHE.delete(oldest);
    }
    MARKUP_CACHE.set(key, markup);
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', 'tl-crest');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', opts.label ?? '');
  svg.innerHTML = markup;
  return svg;
}

/** The badge a club wears, at a size. What every screen in the game calls. */
export function clubCrest(world: World, club: Club, size = 34): SVGSVGElement {
  return crestSvg({
    spec: crestOf(world, club),
    primary: club.kitPrimary,
    secondary: club.kitSecondary,
    short: club.short,
    size,
    label: club.name,
  });
}

function escapeText(text: string): string {
  return text.replace(/[<>&]/g, (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'));
}
