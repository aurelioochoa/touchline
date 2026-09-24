// The icon set.
//
// Drawn here rather than pulled from a library, for the same reason everything else is:
// the game ships zero asset files and adds no runtime dependency (design §9, §12). They
// are authored to one grid and one weight so they read as a set — 24×24 viewBox, 1.9px
// stroke, round caps and joins, no fills except where a shape is genuinely solid.
//
// Emoji were the obvious shortcut and are not an icon system: they are a different
// typeface per platform, they carry their own colour, and half of them are a different
// size from the other half.

export type IconName =
  | 'club'
  | 'squad'
  | 'tactics'
  | 'table'
  | 'fixtures'
  | 'transfers'
  | 'settings'
  | 'play'
  | 'pause'
  | 'forward'
  | 'camera'
  | 'close'
  | 'back'
  | 'check'
  | 'chevron'
  | 'sound'
  | 'mute'
  | 'whistle'
  | 'sub'
  | 'sliders'
  | 'star'
  | 'ball'
  | 'skip'
  | 'list'
  | 'palette'
  | 'shirt'
  | 'stadium'
  | 'build'
  | 'coins'
  | 'home'
  | 'plus'
  | 'trash'
  | 'up'
  | 'down'
  | 'copy'
  | 'flip'
  | 'layers'
  | 'tv'
  | 'goal'
  | 'flag';

/** Path data only — the wrapper below supplies the shared stroke attributes. */
export const ICON_PATHS: Record<IconName, string> = {
  // A shield. The club, and the crest shape the generated crests echo.
  club: 'M12 3.2 4.8 5.9v5.4c0 4.4 3 7.5 7.2 9.5 4.2-2 7.2-5.1 7.2-9.5V5.9Z',
  // Two figures.
  squad: 'M9 11.2a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.4 19.6c0-3 2.5-4.9 5.6-4.9s5.6 1.9 5.6 4.9M16.2 6.1a2.7 2.7 0 0 1 0 5.3M17.4 14.9c2 .6 3.3 2.3 3.3 4.7',
  // A board with a shape on it.
  tactics: 'M4 4h16v16H4zM12 4v16M4 12h4M16 12h4M12 9.7a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6Z',
  // A standings table: a ruled grid with a narrow first column for the position.
  //
  // It used to be three rules with three ticks on them, which is stroke for stroke the
  // same drawing as `sliders` — the league and the tactics panel wore one icon between
  // them. `icons.test.ts` now refuses to let two glyphs share a path.
  table: 'M3.6 5h16.8v14H3.6zM8.2 5v14M3.6 9.7h16.8M3.6 14.3h16.8',
  // A calendar.
  fixtures: 'M4 6.4h16v14H4zM4 10.4h16M8.6 3.4v4M15.4 3.4v4',
  // Two arrows passing.
  transfers: 'M4 8.4h13M13.6 5l3.4 3.4-3.4 3.4M20 15.6H7M10.4 12.2 7 15.6l3.4 3.4',
  // A cog with six square-ended teeth and a wide hub.
  //
  // The first one had eight ROUND teeth on a small hub, which at 20px filled its own
  // negative space and read as a blob — and at any size it was twice the ink of anything
  // else here, in a set whose whole claim is one grid and one weight. Six teeth with gaps
  // wider than the teeth is what makes it survive being small.
  settings:
    'M9.99 5.82L10.15 2.89L13.85 2.89L14.01 5.82A6.5 6.5 0 0 1 16.35 7.17L18.97 5.84L20.82 9.05L18.36 10.65A6.5 6.5 0 0 1 18.36 13.35L20.82 14.95L18.97 18.16L16.35 16.83A6.5 6.5 0 0 1 14.01 18.18L13.85 21.11L10.15 21.11L9.99 18.18A6.5 6.5 0 0 1 7.65 16.83L5.03 18.16L3.18 14.95L5.64 13.35A6.5 6.5 0 0 1 5.64 10.65L3.18 9.05L5.03 5.84L7.65 7.17A6.5 6.5 0 0 1 9.99 5.82ZM15.1 12A3.1 3.1 0 1 1 8.9 12A3.1 3.1 0 1 1 15.1 12Z',
  play: 'M7.5 4.9 19 12 7.5 19.1Z',
  pause: 'M9 5v14M15 5v14',
  // Fast-forward: the speed control.
  forward: 'M4 5.6 12 12l-8 6.4ZM13 5.6 21 12l-8 6.4Z',
  camera: 'M3.4 8.6h4l1.6-2.4h6L16.6 8.6h4v10.8H3.4ZM12 17.2a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2Z',
  close: 'M6 6l12 12M18 6 6 18',
  back: 'M15 5.5 8 12l7 6.5',
  check: 'M4.8 12.6 9.6 17.4 19.2 6.9',
  chevron: 'M9 5.5 15.5 12 9 18.5',
  sound: 'M4 9.4h3.4L12 5.2v13.6L7.4 14.6H4ZM15.6 9.2a4 4 0 0 1 0 5.6M18.4 6.4a8 8 0 0 1 0 11.2',
  mute: 'M4 9.4h3.4L12 5.2v13.6L7.4 14.6H4ZM16.2 9.8l4.4 4.4M20.6 9.8l-4.4 4.4',
  // A referee's whistle: barrel, mouthpiece, lanyard, and the hole.
  //
  // The previous path drew a rounded rectangle open along one side and a stray line, which
  // at any size read as no object at all — and it is the glyph on the Next Match heading
  // and on both break screens, so it is one of the most-seen icons in the game.
  whistle: 'M20.4 12.5a5.4 5.4 0 1 1-10.8 0 5.4 5.4 0 0 1 10.8 0ZM9.6 10.3H3.6v4.4h6M18.4 8.1l1.9-2.8M15 12.5h.01',
  // A substitution: one arrow up, one down.
  sub: 'M8 19.6V5.4M8 5.4 4.8 8.7M8 5.4l3.2 3.3M16 4.4v14.2M16 18.6l3.2-3.3M16 18.6l-3.2-3.3',
  sliders: 'M5 6.6h14M5 12h14M5 17.4h14M9.4 4.4v4.4M15 9.8v4.4M8 15.2v4.4',
  star: 'M12 3.8 14.5 9l5.7.8-4.1 4 1 5.7-5.1-2.7L6.9 19.5l1-5.7-4.1-4L9.5 9Z',
  ball: 'M12 20.6a8.6 8.6 0 1 0 0-17.2 8.6 8.6 0 0 0 0 17.2ZM12 8.2l3.6 2.6-1.4 4.3H9.8L8.4 10.8Z',
  skip: 'M5.4 5.6 14 12l-8.6 6.4ZM18 5.4v13.2',
  // A written log: bullets down the left, lines beside them. Distinct from `table`, which
  // is the league and must not read as the same thing.
  list: 'M5.2 6.6h.01M5.2 12h.01M5.2 17.4h.01M9.4 6.6h9.4M9.4 12h9.4M9.4 17.4h9.4',
  // A painter's palette, for the badge editor's colour tab. The four wells use the same
  // zero-length-segment trick `list` does for its bullets: a round cap IS the dot.
  palette: 'M12 3.4a8.6 8.6 0 0 0 0 17.2c1.3 0 2-.8 2-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.1 0-.9.7-1.6 1.6-1.6h1.5a4.9 4.9 0 0 0 4.9-4.9c0-3.7-3.8-6.7-9-6.7ZM7.6 12.4h.01M8.6 8.6h.01M12.2 7.2h.01M15.8 8.6h.01',
  // The club studio's tabs and the chrome's two new buttons.
  shirt: 'M8.4 4.2 4 6.8l1.8 4 2.2-.9v9.7h8V9.9l2.2.9 1.8-4-4.4-2.6c-.6 1.4-2 2.2-3.6 2.2S9 5.6 8.4 4.2Z',
  stadium: 'M3 18.6h18M4.4 18.6V11l7.6-3.2 7.6 3.2v7.6M8 18.6v-4h8v4M4.4 11h15.2M12 7.8V3.8l3 1.2-3 1.2',
  build: 'M4.6 19.4l8-8M11 5.6l2.8-2.8 7.4 7.4-2.8 2.8ZM9.6 7l7.4 7.4',
  coins: 'M12 9.2c3.9 0 7-1.3 7-2.9s-3.1-2.9-7-2.9-7 1.3-7 2.9 3.1 2.9 7 2.9ZM5 6.3v5.4c0 1.6 3.1 2.9 7 2.9s7-1.3 7-2.9V6.3M5 11.7v5.4c0 1.6 3.1 2.9 7 2.9s7-1.3 7-2.9v-5.4',
  home: 'M4 11.2 12 4.6l8 6.6M6.2 9.4v10h11.6v-10M10 19.4V14h4v5.4',
  // The emblem editor's layer toolbar.
  plus: 'M12 5v14M5 12h14',
  trash: 'M5 7h14M10 7V4.6h4V7M7 7l1 13h8l1-13',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  copy: 'M8.5 8.5h11v11.5h-11ZM5 15.5V4h11',
  flip: 'M12 3v18M9 7 4 17h5ZM15 7l5 10h-5Z',
  layers: 'M12 3.5 21 8l-9 4.5L3 8ZM3 12l9 4.5 9-4.5M3 16l9 4.5 9-4.5',
  // The match cameras. A screen on a stand for the TV director, the goal frame and its
  // net for the camera behind it, a corner flag for the one at pitch level.
  tv: 'M3.4 6.4h17.2v10.8H3.4ZM8.6 20.4h6.8M12 17.2v3.2M9 3 12 6.2 15 3',
  goal: 'M3 18.8V6.8h18v12M3 6.8l3.4 3.6h11.2L21 6.8M6.4 10.4v8.4M17.6 10.4v8.4M3 18.8h18',
  flag: 'M6.4 20.6V3.6M6.4 4.4h10.8l-2.6 3.8 2.6 3.8H6.4',
};

/** Every name, for the set-wide checks in icons.test.ts. */
export const ICON_NAMES = Object.keys(ICON_PATHS) as IconName[];

/** Which icons are solid shapes rather than outlines. */
const FILLED = new Set<IconName>(['play', 'forward', 'skip']);

/**
 * One icon as an SVG element. `size` is the box; the stroke stays visually constant
 * because the viewBox scales with it.
 */
export function icon(name: IconName, size = 20): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('tl-icon');

  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICON_PATHS[name]);
  if (FILLED.has(name)) {
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.6');
    path.setAttribute('stroke-linejoin', 'round');
  } else {
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.9');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
  }
  svg.append(path);
  return svg;
}
