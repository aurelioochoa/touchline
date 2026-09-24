// The inheritance.
//
// What a new player meets before the game: three screens of letter, the club they have
// been left, a badge and a name they choose themselves, and a contract they sign. Design
// §14 says no tutorial and it is right — none of this explains anything. It is the reason
// the club is theirs, which is a different job, and it is the thing the rest of the career
// hangs off.
//
// Three constraints, all from the design doc:
//
// - **Every string goes through `t()`**, so `?blank=1` blanks the story with everything
//   else and the wordless path still reaches the pitch (§11).
// - **Skippable at every step**, and skipping lands in exactly the same place as
//   finishing: a generated name, the club's own colours, and a career that starts.
// - **`prefers-reduced-motion` gets the signed contract without the stroke** (§D). The
//   signature animation informs nothing; it is decoration, and decoration is what that
//   setting is allowed to switch off.

import { t } from '../i18n.js';
import type { Club, World } from '../sim/world/types.js';
import { inkOn } from '../sim/world/worldgen.js';
import { crestEditor } from './crestEditor.js';
import { letterScene } from './art/letter.js';
import { button, clear, el, heading } from './dom.js';
import { icon } from './icons.js';
import { kitCss } from './theme.js';

export interface IntroHost {
  world: World;
  club: Club | null;
  /** Draw the club picker into a container; the intro frames it with its own copy. */
  renderPicker(into: HTMLElement): void;
  /** The intro is over — enter the career. */
  finish(): void;
  /** Save without re-rendering. */
  persist(): void;
}

type Step = 'letter1' | 'letter2' | 'letter3' | 'pick' | 'identity' | 'contract';
const LETTERS: Step[] = ['letter1', 'letter2', 'letter3'];

export class Intro {
  readonly root = el('div', { class: 'tl-intro' });
  #step: Step = 'letter1';
  /**
   * Set the moment the pen starts moving. The signature runs for a second and a half and
   * the career opens on a timer at the end of it, so for that second and a half there are
   * two ways out of a screen that has already decided where it is going — Skip and Back
   * would both re-render underneath a countdown that then dumps the player into the
   * career anyway. The buttons are disabled as well; this is the part that cannot be
   * clicked around.
   */
  #signing = false;
  readonly #host: IntroHost;
  readonly #reducedMotion: boolean;

  constructor(host: IntroHost, reducedMotion: boolean) {
    this.#host = host;
    this.#reducedMotion = reducedMotion;
    this.render();
  }

  render(): void {
    clear(this.root);
    switch (this.#step) {
      case 'letter1':
      case 'letter2':
      case 'letter3':
        this.#renderLetter(this.#step);
        break;
      case 'pick':
        this.#renderPick();
        break;
      case 'identity':
        this.#renderIdentity();
        break;
      case 'contract':
        this.#renderContract();
        break;
    }
  }

  #go(step: Step): void {
    if (this.#signing) return;
    this.#step = step;
    this.render();
  }

  /** Skip lands where finishing lands: the club keeps its generated identity. */
  #skip(): void {
    if (this.#signing) return;
    if (this.#host.world.managedClubId < 0) {
      this.#go('pick');
      return;
    }
    this.#ensureManagerName();
    this.#host.finish();
  }

  #ensureManagerName(): void {
    if (!this.#host.world.managerName.trim()) {
      this.#host.world.managerName = t('intro.defaultManager');
    }
  }

  /**
   * The card every step sits in.
   *
   * `back` is optional because the first letter has nowhere to go back to, and a Back
   * button that does nothing is worse than no Back button. It carries an icon so that
   * with every string blanked it is still an operable control rather than an empty box —
   * the same rule the two flows in `onboarding.ts` keep.
   */
  #chrome(body: HTMLElement[], next: HTMLElement | null, back?: () => void): HTMLElement {
    const skip = button(t('intro.skip'), () => this.#skip(), {
      class: 'tl-btn tl-ghost tl-sm', 'data-nav': 'skip',
    });
    const prev = back
      ? button(t('intro.back'), back, {
        class: 'tl-btn tl-ghost tl-sm', icon: 'back',
        'aria-label': t('intro.back') || 'Back', 'data-nav': 'back',
      })
      : null;
    // Named here rather than by every caller, and named at all because the harnesses used
    // to find Next by taking the last button in the footer — which stopped being true the
    // moment a step had a Back button and no Next.
    next?.setAttribute('data-nav', 'next');
    // No `tl-enter` here: that is the generic child stagger, and this card runs its own
    // four-beat arrival instead (see the keyframes in styles.ts). Having both meant the
    // stagger's `animation: none` on every child won against the letter's own unfold,
    // which simply never played.
    return el('div', { class: 'tl-intro-card' }, [
      ...body,
      el('div', { class: 'tl-intro-foot' }, [skip, prev, el('span', { class: 'tl-spacer' }), next]),
    ]);
  }

  // ---- the letter ---------------------------------------------------------------

  #renderLetter(step: Step): void {
    const index = LETTERS.indexOf(step);
    const next = button(t('intro.next'), () => {
      const following = LETTERS[index + 1];
      this.#go(following ?? 'pick');
    }, { class: 'tl-btn tl-primary', icon: 'chevron' });

    this.root.append(this.#chrome([
      el('div', { class: 'tl-letter' }, [
        el('div', { class: 'tl-letter-stamp' }, [icon('club', 22)]),
        // The picture advances with the story rather than sitting beside it: sealed, then
        // opened, then read. Three cards of prose about a letter arriving, with no letter
        // anywhere on screen, was the largest gap in the game's first thirty seconds.
        el('div', { class: 'tl-letter-art' }, [letterScene(index)]),
        el('div', { class: 'tl-letter-words' }, [
          el('h2', { text: t(`intro.${step}.title` as never) }),
          el('p', { text: t(`intro.${step}.body` as never) }),
        ]),
      ]),
      el('div', { class: 'tl-intro-dots', 'aria-hidden': 'true' },
        LETTERS.map((_, i) => el('i', { class: i === index ? 'on' : '' }))),
    ], next, index > 0 ? () => this.#go(LETTERS[index - 1] as Step) : undefined));
  }

  // ---- which club ---------------------------------------------------------------

  #renderPick(): void {
    const holder = el('div');
    this.#host.renderPicker(holder);
    this.root.append(el('div', { class: 'tl-intro-wide tl-enter' }, [
      el('div', { class: 'tl-intro-head' }, [
        el('h2', { text: t('intro.pick.title') }),
        el('p', { class: 'tl-lede', text: t('intro.pick.body') }),
      ]),
      holder,
    ]));
  }

  /** Called by the host once a club has actually been chosen. */
  clubChosen(): void {
    this.#go('identity');
  }

  // ---- make it yours ------------------------------------------------------------

  #renderIdentity(): void {
    const club = this.#host.club;
    if (!club) {
      this.#go('pick');
      return;
    }

    // The whole badge, in its own component: six dimensions is more than fits in a row of
    // five buttons, and the same editor is reachable later from Settings — a crest chosen
    // once in the intro and never changeable again was the smaller half of the problem.
    const editor = crestEditor({
      world: this.#host.world,
      club,
      onChange: () => {
        // The club's colour is the game's accent, so the preview is literally the theme.
        document.documentElement.style.setProperty('--tl-club', kitCss(club.kitPrimary));
        document.documentElement.style.setProperty('--tl-club-ink', inkOn(club.kitPrimary));
      },
    });
    // The theme starts out agreeing with whatever the club already wears.
    document.documentElement.style.setProperty('--tl-club', kitCss(club.kitPrimary));
    document.documentElement.style.setProperty('--tl-club-ink', inkOn(club.kitPrimary));

    const nameField = textField(t('intro.clubName'), club.name, 24, (v) => {
      club.name = v || club.name;
    });
    const shortField = textField(t('intro.clubShort'), club.short, 3, (v) => {
      club.short = (v || club.short).toUpperCase();
      // The three letters are written across the badge, so the badge has to hear about it.
      editor.repaint();
    });
    const managerField = textField(t('intro.manager'), this.#host.world.managerName, 22, (v) => {
      this.#host.world.managerName = v;
    }, t('intro.managerHint'));

    const next = button(t('intro.next'), () => {
      this.#ensureManagerName();
      this.#host.persist();
      this.#go('contract');
    }, { class: 'tl-btn tl-primary', icon: 'chevron' });

    this.root.append(this.#chrome([
      el('div', { class: 'tl-intro-head' }, [
        el('h2', { text: t('intro.identity.title') }),
        el('p', { class: 'tl-lede', text: t('intro.identity.body') }),
      ]),
      el('div', { class: 'tl-identity-fields' }, [managerField, nameField, shortField]),
      heading(t('intro.badge'), 'club'),
      editor.node,
    ], next, () => this.#go('pick')));
  }

  // ---- the contract -------------------------------------------------------------

  #renderContract(): void {
    const club = this.#host.club;
    if (!club) {
      this.#go('pick');
      return;
    }
    const name = this.#host.world.managerName;

    // A signature drawn as one path, revealed by running its dash offset to zero.
    //
    // The length is measured off the real curve with `getTotalLength()` and the reveal is
    // a Web Animations call, so the draw duration and the delay before the career opens
    // are ONE constant. The first version split them — `1.5s` in the stylesheet and
    // `1500` in a `setTimeout` — which is two numbers that have to agree forever and no
    // way to notice when they stop.
    //
    // WHAT THE CURVE IS. The first one was six identical sine bumps at a constant width,
    // which is not a signature, it is a scribble: no capital, no baseline, nothing above or
    // below the line, and the same stroke everywhere. Handwriting is none of those things,
    // so each of the three curves below has an initial with a loop through it, humps of
    // unequal height, one letter that drops under the line, and a long flourish that crosses
    // back over the name. The whole group is skewed nine degrees, which is what a hand does
    // to a page and is most of why it reads as written rather than drawn.
    const paper = el('div', { class: 'tl-contract' });
    paper.innerHTML = `
      <svg class="tl-contract-lines" viewBox="0 0 300 96" aria-hidden="true">
        ${[0, 1, 2, 3].map((i) => `<rect x="18" y="${10 + i * 13}" width="${i === 3 ? 150 : 264}" height="4" rx="2"/>`).join('')}
      </svg>
      <svg class="tl-signature" viewBox="0 0 300 78" aria-hidden="true">
        <g class="rule">
          <rect x="18" y="62" width="264" height="1.4" rx="0.7"/>
          <path d="M22 54l7 7M29 54l-7 7"/>
        </g>
        <g class="ink" transform="skewX(-9)">
          <path d="${signatureFor(name)}"/>
        </g>
      </svg>
    `;

    const path = paper.querySelector('.tl-signature .ink path') as SVGPathElement | null;
    const length = path?.getTotalLength() ?? 0;
    if (path && length > 0 && !this.#reducedMotion) {
      path.style.strokeDasharray = String(length);
      path.style.strokeDashoffset = String(length);
    }

    const signed = el('p', { class: 'tl-lede tl-contract-done', 'aria-live': 'polite' });
    const DRAW_MS = 1500;
    const signBtn = button(t('intro.contract.sign'), () => {
      signBtn.disabled = true;
      this.#signing = true;
      for (const b of this.root.querySelectorAll<HTMLButtonElement>('.tl-intro-foot button')) {
        b.disabled = true;
      }
      signed.textContent = t('intro.contract.signed', { club: club.name });
      // Calmed motion gets the signed contract without the stroke (design §D): the pen
      // informs nothing, so it is exactly the kind of decoration that setting turns off.
      const draw = path && length > 0 && !this.#reducedMotion;
      if (draw) {
        path.animate(
          [{ strokeDashoffset: String(length) }, { strokeDashoffset: '0' }],
          { duration: DRAW_MS, easing: 'cubic-bezier(0.4, 0, 0.25, 1)', fill: 'forwards' },
        );
      }
      window.setTimeout(() => this.#host.finish(), (draw ? DRAW_MS : 0) + 350);
    }, { class: 'tl-btn tl-primary tl-block', icon: 'check' });

    this.root.append(this.#chrome([
      el('div', { class: 'tl-intro-head' }, [
        el('h2', { text: t('intro.contract.title') }),
        el('p', { class: 'tl-lede', text: t('intro.contract.body', { club: club.name }) }),
      ]),
      el('div', { class: 'tl-contract-meta' }, [
        field(t('intro.contract.club'), club.name),
        field(t('intro.contract.role'), name),
      ]),
      paper,
      signBtn,
      signed,
    ], null, () => this.#go('identity')));
  }
}

function field(label: string, value: string): HTMLElement {
  return el('div', { class: 'tl-contract-field' }, [
    el('span', { class: 'k', text: label }),
    el('b', { text: value }),
  ]);
}

function textField(
  label: string,
  value: string,
  max: number,
  onChange: (v: string) => void,
  hint?: string,
): HTMLElement {
  const input = el('input', {
    class: 'tl-input', type: 'text', value, maxlength: max, 'aria-label': label,
  });
  input.addEventListener('input', () => onChange(input.value.trim()));
  // A blanked hint is an empty paragraph that still takes its line height, so it is left
  // out of the DOM entirely rather than rendered empty.
  return el('label', { class: 'tl-field' }, [
    el('span', { text: label }),
    input,
    hint ? el('small', { class: 'tl-hint', text: hint }) : null,
  ]);
}

/**
 * Which signature this manager writes.
 *
 * Three of them, chosen by a hash of the name rather than at random, so a career signs the
 * same way every time this screen is rendered — pressing Back from the contract and coming
 * again must not hand you somebody else's handwriting — and two careers rarely sign alike.
 *
 * Each is one continuous stroke on a 300x78 box with the baseline at y=52.
 */
function signatureFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) >>> 0;
  return SIGNATURES[h % SIGNATURES.length] as string;
}

const SIGNATURES: readonly string[] = [
  // A looping capital, four uneven humps, a descender under the line, and a rising flourish
  // that crosses back over the whole name.
  'M26 54 C14 44 20 14 36 12 C48 11 48 28 38 40 C30 50 22 48 24 38'
  + ' C27 26 40 28 44 42 C47 52 54 54 58 44 C61 36 58 28 55 34'
  + ' C51 43 60 52 70 48 C80 44 76 26 86 28 C95 30 88 50 98 52'
  + ' C110 54 110 24 122 26 C132 28 126 52 138 52 C150 52 148 22 162 26'
  + ' C173 29 166 52 178 52 C192 52 194 28 206 32 C216 35 210 54 220 54'
  + ' C232 54 234 40 246 42 C254 43 252 56 244 62 C236 68 224 64 222 56'
  + ' C220 46 240 44 268 48 C280 50 286 44 288 38',
  // A tall crossed initial, a tighter rhythm, and a tail that dives and lifts.
  'M22 56 C24 34 32 10 44 12 C53 14 47 32 36 44 C29 51 26 42 33 33'
  + ' C42 22 53 32 55 44 C57 54 65 52 67 42 C69 32 78 32 80 42'
  + ' C82 52 91 54 97 46 C104 37 99 26 106 28 C115 31 110 50 121 52'
  + ' C136 54 138 22 153 26 C164 29 157 52 170 52 C185 52 187 28 200 30'
  + ' C211 32 206 54 219 52 C236 50 246 40 262 34 C274 30 284 36 288 46'
  + ' M14 40 H72',
  // The roundest of the three: shallow humps and a big open loop at the end.
  'M20 52 C22 30 30 12 42 14 C52 16 50 32 40 42 C33 49 27 44 31 35'
  + ' C38 22 52 30 56 44 C59 54 68 54 72 46 C77 36 72 28 76 30'
  + ' C84 34 82 50 92 52 C106 55 106 26 120 28 C131 30 124 52 137 52'
  + ' C152 52 150 24 165 28 C177 31 169 52 182 52 C197 52 199 30 212 34'
  + ' C222 37 216 54 228 54 C244 54 250 34 266 36 C280 38 286 50 278 58'
  + ' C270 66 256 62 254 52 C252 42 268 38 292 42',
];
