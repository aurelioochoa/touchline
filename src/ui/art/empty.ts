// Empty states, as small scenes.
//
// Four places in the game answer a question with nothing: the fixture list at the end of a
// season, the transfer market with nobody in it, a squad too small to sell from, and the
// bench with nobody left on it. All four drew the same thing — one flat icon at 30px above
// a sentence — which says "this panel is empty" and nothing else.
//
// A scene can say the other half: why it is empty, and whether that is fine. An end-of-
// season fixture list is not a problem, it is an achievement, and it should not look like
// the transfer market failing to load.

import { scene } from './index.js';

/** The empty scenes, by name. Each is authored on the same 160x100 box. */
const SCENES: Record<string, string> = {
  // Season over: an empty pitch under the floodlights, with the goal still standing.
  seasonDone: `
    <path d="M8 74 L152 74 L160 100 L0 100 Z" fill="var(--art-grass)"/>
    <g fill="var(--art-grass-lit)" opacity="0.35">
      <path d="M28 74 L44 74 L34 100 L8 100 Z"/>
      <path d="M76 74 L92 74 L98 100 L72 100 Z"/>
      <path d="M124 74 L140 74 L158 100 L134 100 Z"/>
    </g>
    <g stroke="var(--art-line)" stroke-width="2" fill="none" opacity="0.45">
      <path d="M58 62 H102 V80 H58 Z"/>
      <path d="M58 62 L64 56 H96 L102 62"/>
    </g>
    <g fill="var(--art-ink)" opacity="0.8">
      <rect x="26" y="34" width="6" height="40" rx="2"/>
      <rect x="128" y="34" width="6" height="40" rx="2"/>
      <path d="M18 26h22l-3 10H21Z"/>
      <path d="M120 26h22l-3 10h-16Z"/>
    </g>
    <ellipse cx="29" cy="31" rx="20" ry="14" fill="var(--tl-club)" opacity="0.16"/>
    <ellipse cx="131" cy="31" rx="20" ry="14" fill="var(--tl-club)" opacity="0.16"/>`,

  // Nobody to buy: an empty chair at a table, and a pen nobody has picked up.
  noPlayers: `
    <rect x="20" y="62" width="120" height="7" rx="3" fill="var(--art-ink)" opacity="0.85"/>
    <g fill="var(--art-shade)">
      <rect x="28" y="69" width="6" height="26" rx="2"/>
      <rect x="126" y="69" width="6" height="26" rx="2"/>
    </g>
    <g fill="var(--art-ink)" opacity="0.7">
      <rect x="52" y="34" width="7" height="30" rx="3"/>
      <rect x="98" y="34" width="7" height="30" rx="3"/>
      <rect x="48" y="30" width="61" height="8" rx="4"/>
      <rect x="52" y="64" width="7" height="24" rx="3"/>
      <rect x="98" y="64" width="7" height="24" rx="3"/>
    </g>
    <rect x="66" y="52" width="30" height="10" rx="3" fill="var(--art-paper)" opacity="0.85"/>
    <path d="M74 58 h14" stroke="var(--tl-club)" stroke-width="2.4" stroke-linecap="round"/>`,

  // Too small a squad: a kit hanging on a peg, on its own.
  thinSquad: `
    <rect x="14" y="24" width="132" height="5" rx="2.5" fill="var(--art-ink)" opacity="0.7"/>
    <g fill="var(--art-shade)">
      <circle cx="46" cy="34" r="5"/><circle cx="114" cy="34" r="5"/>
    </g>
    <path d="M80 32 l20 8 6 14-9 4-3-6v34H66V52l-3 6-9-4 6-14Z"
          fill="var(--tl-club)" opacity="0.85"/>
    <path d="M80 32 l20 8 6 14-9 4-3-6v34H66V52l-3 6-9-4 6-14Z"
          fill="none" stroke="var(--art-ink)" stroke-width="2" opacity="0.4"/>
    <path d="M72 33 a8 8 0 0 0 16 0" fill="none" stroke="var(--art-ink)"
          stroke-width="2" opacity="0.4"/>`,

  // Nothing has happened yet: a whistle on a lanyard, not yet blown.
  nothingYet: `
    <path d="M60 12 C40 26 34 40 40 52" fill="none" stroke="var(--art-ink)"
          stroke-width="3" stroke-linecap="round" opacity="0.55"/>
    <path d="M104 12 C126 26 130 42 118 54" fill="none" stroke="var(--art-ink)"
          stroke-width="3" stroke-linecap="round" opacity="0.55"/>
    <!-- Mouthpiece first and in the same colour as the barrel, so the two read as one
         object. Drawn in the shade value it came out as a dark stub behind a bright disc,
         which is a lollipop. -->
    <path d="M92 54 H40 a5 5 0 0 0-5 5 v14 a5 5 0 0 0 5 5 h52Z" fill="var(--tl-club)" opacity="0.85"/>
    <path d="M92 54 H40 a5 5 0 0 0-5 5 v14 a5 5 0 0 0 5 5 h52" fill="none"
          stroke="var(--art-ink)" stroke-width="2.5" stroke-linejoin="round" opacity="0.45"/>
    <!-- The barrel goes on AFTER the mouthpiece outline, so it covers the part of that
         outline that would otherwise draw a seam straight across it. -->
    <circle cx="92" cy="66" r="22" fill="var(--tl-club)" opacity="0.85"/>
    <path d="M92 44 a22 22 0 0 1 0 44" fill="none" stroke="var(--art-ink)"
          stroke-width="2.5" opacity="0.45"/>
    <!-- The air hole, which is the one detail that says whistle rather than disc. -->
    <ellipse cx="99" cy="60" rx="6" ry="4" fill="var(--art-ink)" opacity="0.5"/>`,
};

export type EmptyScene = keyof typeof SCENES;

export function emptyScene(name: EmptyScene): SVGSVGElement {
  return scene({ viewBox: '0 0 160 100', markup: SCENES[name] as string, className: 'tl-art-empty' });
}
