// The solicitor's letter, in three states.
//
// The inheritance story is three cards of prose on an otherwise empty screen, and it is
// where a new player forms their whole first impression of the game. What it was missing is
// the thing the prose is describing: an envelope arrives, it is opened, there is a letter
// inside. One drawing, three states, driven by which of the three cards is showing — so the
// picture advances with the story rather than sitting beside it.
//
// The wax seal is the club's colour. On the first card the club has not been chosen yet, so
// it is the game's default accent and changes the moment one is — which is a small thing
// that makes the letter feel addressed to you rather than printed.

import { scene } from './index.js';

const ENVELOPE_BODY = `
  <rect x="26" y="52" width="188" height="118" rx="7" fill="var(--art-paper)"/>
  <rect x="26" y="52" width="188" height="118" rx="7" fill="none"
        stroke="var(--art-paper-ink)" stroke-width="2.4" opacity="0.35"/>`;

/** Sealed: flap down, wax seal in the middle, a stamp in the corner. */
const SEALED = `
  ${ENVELOPE_BODY}
  <path d="M26 59 L120 128 L214 59 L214 52 L26 52 Z" fill="var(--art-paper-fold)"/>
  <path d="M26 59 L120 128 L214 59" fill="none" stroke="var(--art-paper-ink)"
        stroke-width="2.4" opacity="0.3"/>
  <rect x="170" y="62" width="34" height="26" rx="3" fill="var(--tl-club)" opacity="0.28"/>
  <rect x="170" y="62" width="34" height="26" rx="3" fill="none"
        stroke="var(--art-paper-ink)" stroke-width="2" opacity="0.35" stroke-dasharray="4 3"/>
  <circle cx="120" cy="122" r="17" fill="var(--tl-club)"/>
  <circle cx="120" cy="122" r="17" fill="none" stroke="var(--art-paper-ink)"
          stroke-width="2" opacity="0.25"/>
  <path d="M120 112 l3.2 6.5 7.2 1.1-5.2 5 1.2 7.1-6.4-3.4-6.4 3.4 1.2-7.1-5.2-5 7.2-1.1Z"
        fill="var(--tl-club-ink)" opacity="0.8"/>`;

/** Opened: flap up and back, the seal broken in two, paper edge showing inside. */
const OPENED = `
  ${ENVELOPE_BODY}
  <path d="M26 52 L120 8 L214 52 L214 60 L120 22 L26 60 Z" fill="var(--art-paper-fold)"/>
  <rect x="52" y="42" width="136" height="94" rx="4" fill="var(--art-paper-lit)"/>
  <g stroke="var(--art-paper-ink)" stroke-width="4" stroke-linecap="round" opacity="0.28">
    <path d="M68 62 H162"/><path d="M68 78 H172"/><path d="M68 94 H144"/>
  </g>
  <path d="M26 52 L214 52 L214 170 L26 170 Z" fill="var(--art-paper)" opacity="0.55"/>
  <path d="M26 52 L120 122 L214 52" fill="none" stroke="var(--art-paper-ink)"
        stroke-width="2.4" opacity="0.28"/>
  <path d="M108 118 a17 17 0 0 1 12-16 l0 17 Z" fill="var(--tl-club)"/>
  <path d="M132 126 a17 17 0 0 1-12 10 l0-17 Z" fill="var(--tl-club)" opacity="0.75"/>`;

/** Read: the letter out of the envelope, signed at the bottom. */
const READ = `
  <g transform="rotate(-4 120 110)">
    <rect x="28" y="70" width="184" height="102" rx="7" fill="var(--art-paper-fold)"/>
    <path d="M28 76 L120 138 L212 76" fill="none" stroke="var(--art-paper-ink)"
          stroke-width="2.2" opacity="0.25"/>
  </g>
  <g transform="rotate(5 120 84)">
    <rect x="40" y="14" width="160" height="126" rx="6" fill="var(--art-paper-lit)"/>
    <rect x="40" y="14" width="160" height="126" rx="6" fill="none"
          stroke="var(--art-paper-ink)" stroke-width="2.2" opacity="0.28"/>
    <rect x="56" y="30" width="46" height="9" rx="4" fill="var(--tl-club)" opacity="0.75"/>
    <g stroke="var(--art-paper-ink)" stroke-width="4.5" stroke-linecap="round" opacity="0.26">
      <path d="M56 54 H182"/><path d="M56 68 H186"/><path d="M56 82 H160"/>
      <path d="M56 96 H178"/><path d="M56 110 H120"/>
    </g>
    <path d="M132 126 c8-14 14-12 15-2 c1 9-6 11-8 5 c-2-7 8-12 15-4 c4 5 2 10 8 8 c7-2 6-11 12-8 c5 3 3 9 9 8 c6-1 9-6 15-4"
          fill="none" stroke="var(--art-signature)" stroke-width="2.6"
          stroke-linecap="round" stroke-linejoin="round"/>
  </g>`;

const STATES = [SEALED, OPENED, READ];

/**
 * The letter at story beat `step` (0, 1 or 2).
 *
 * Clamped rather than indexed blindly: the three letter cards are a fixed list today, and a
 * fourth one added later should get the last picture rather than a blank box.
 */
export function letterScene(step: number): SVGSVGElement {
  const i = Math.max(0, Math.min(STATES.length - 1, Math.trunc(step)));
  return scene({
    viewBox: '0 0 240 190',
    markup: STATES[i] as string,
    className: 'tl-art-letter',
  });
}
