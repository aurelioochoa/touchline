// The first run: a guided match, pointed at the real controls.
//
// Design §14 said "no tutorial — §3 is the answer, and if the first thirty seconds need
// explaining they are wrong". That is right about a *tutorial* and wrong about a coach.
// What is built here explains nothing in the abstract: it dims the screen except for one
// live control, puts an arrow on it, and waits for the kid to press it. The control does
// the explaining. Nothing is simulated, no step is a screenshot, and the match keeps
// running underneath the whole time.
//
// Three rules it has to keep:
//
// - **The highlighted thing stays live.** The dimming is four panes around a hole, not a
//   sheet with a cutout drawn on it. A step that says "tap him" and then swallows the tap
//   is worse than no step.
// - **It survives `?blank=1`.** Every string in the game blanks (design §11), so the ring,
//   the arrow and the progress dots carry each step on their own, and the two buttons are
//   icons with accessible names. The flow is still completable with no text at all.
// - **It is skippable at every step and never comes back.** One flag in the save.

import { t, type StringKey } from '../i18n.js';
import { audio } from '../audio/audio.js';
import { button, el } from './dom.js';
import { icon } from './icons.js';

export interface CoachStep {
  /** The control this step is about. Re-measured continuously; may return null. */
  target?: () => Element | null | undefined;
  body: StringKey;
  /**
   * `next` waits for the coach's own button. `target` waits for the highlighted control
   * to be used, which is what makes a step a thing you did rather than a thing you read.
   * `auto` moves on when `until` says so — used for "watch what happens next".
   */
  advance: 'next' | 'target' | 'auto';
  /** For `auto` steps: polled four times a second. */
  until?: () => boolean;
  /** Called once when the step opens — e.g. to open the drawer the next step points at. */
  onEnter?: () => void;
  /** Extra padding around the hole, for controls that need room to breathe. */
  pad?: number;
}

const POLL_MS = 220;

export class Coach {
  readonly root = el('div', { class: 'tl-coach', role: 'group', 'aria-live': 'polite' });
  readonly #steps: CoachStep[];
  readonly #host: HTMLElement;
  readonly #onDone: () => void;
  readonly #panes: HTMLElement[] = [];
  readonly #ring = el('div', { class: 'ring' });
  readonly #bubble = el('div', { class: 'bubble' });
  readonly #arrow: HTMLElement;
  readonly #text = el('p', {});
  readonly #dots = el('div', { class: 'tl-dots' });
  #index = -1;
  #timer: number | null = null;
  #boundTarget: Element | null = null;
  #disposed = false;

  constructor(host: HTMLElement, steps: CoachStep[], onDone: () => void) {
    this.#host = host;
    this.#steps = steps;
    this.#onDone = onDone;

    for (let i = 0; i < 4; i++) {
      const pane = el('div', { class: 'pane' });
      this.#panes.push(pane);
      this.root.append(pane);
    }
    this.#arrow = el('div', { class: 'arrow' });
    this.#arrow.append(arrowSvg());
    this.root.append(this.#arrow, this.#ring, this.#bubble);

    this.#bubble.append(
      this.#text,
      el('div', { class: 'foot' }, [
        this.#dots,
        el('span', { class: 'tl-spacer' }),
        button(t('coach.skip'), () => this.finish(), {
          class: 'tl-btn tl-sm tl-ghost',
          'aria-label': t('coach.skip') || 'Skip',
        }),
        button(t('coach.next'), () => this.#advance(), {
          class: 'tl-btn tl-sm tl-primary',
          icon: 'chevron',
          'aria-label': t('coach.next') || 'Next',
        }),
      ]),
    );
    for (let i = 0; i < steps.length; i++) this.#dots.append(el('i', {}));

    host.append(this.root);
    this.#advance();
    this.#timer = setInterval(() => this.#poll(), POLL_MS) as unknown as number;
    addEventListener('resize', this.#reposition, { passive: true });
    addEventListener('keydown', this.#onKey, true);
  }

  /**
   * Escape leaves the tour, from any step. Captured, so it gets there before the match
   * screen's own Escape handler, which would otherwise abandon the match instead — a kid
   * pressing Escape to dismiss a tooltip has not asked to stop watching the football.
   */
  #onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || this.#disposed) return;
    e.preventDefault();
    e.stopPropagation();
    this.finish();
  };

  /** End the flow, whether it was completed or skipped. Idempotent. */
  finish(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
    removeEventListener('resize', this.#reposition);
    removeEventListener('keydown', this.#onKey, true);
    this.#unbind();
    this.root.remove();
    this.#onDone();
  }

  get active(): boolean {
    return !this.#disposed;
  }

  // ---- steps -------------------------------------------------------------------

  #advance(): void {
    this.#unbind();
    this.#index++;
    const step = this.#steps[this.#index];
    if (!step) {
      this.finish();
      return;
    }
    audio.tick();
    step.onEnter?.();
    this.#text.textContent = t(step.body);
    // With every string blanked the paragraph is an empty box that still takes 20px of
    // the bubble; take it out of the flow instead.
    this.#text.hidden = this.#text.textContent === '';
    [...this.#dots.children].forEach((d, i) => d.classList.toggle('on', i <= this.#index));

    // A `target` step is completed by using the control, so its own Next button would be
    // a second way to pass it without doing it. Hide the button rather than disable it.
    const nextBtn = this.#bubble.querySelector<HTMLElement>('.tl-primary');
    if (nextBtn) nextBtn.hidden = step.advance !== 'next';

    if (step.advance === 'target') {
      const node = step.target?.();
      if (node) {
        this.#boundTarget = node;
        node.addEventListener('click', this.#onTargetUsed, { once: true, capture: true });
        node.addEventListener('pointerup', this.#onTargetUsed, { once: true, capture: true });
      } else {
        // Nothing to point at — a control that is not on this screen is not a step.
        this.#advance();
        return;
      }
    }
    this.#reposition();

    // Focus follows the highlight. On a step the player completes by USING a control, the
    // control itself takes focus so Enter does the thing the arrow is pointing at; on a
    // step they read and dismiss, the button that dismisses it does. Without this a
    // keyboard-only player has to Tab blindly through a dimmed screen to find either.
    const focusTarget = step.advance === 'target'
      ? (this.#boundTarget as HTMLElement | null)
      : this.#bubble.querySelector<HTMLElement>('.tl-primary');
    focusTarget?.focus?.({ preventScroll: true });
  }

  #onTargetUsed = (): void => {
    // A beat later: the click that finished this step is also the click that opens
    // whatever the next step points at, and measuring before that lands puts the hole in
    // the wrong place. A timer rather than requestAnimationFrame, which does not fire in
    // a background tab and would leave the tour stuck on the step it just completed.
    setTimeout(() => this.#advance(), 60);
  };

  #unbind(): void {
    if (!this.#boundTarget) return;
    this.#boundTarget.removeEventListener('click', this.#onTargetUsed, true);
    this.#boundTarget.removeEventListener('pointerup', this.#onTargetUsed, true);
    this.#boundTarget = null;
  }

  #poll(): void {
    if (this.#disposed) return;
    const step = this.#steps[this.#index];
    if (!step) return;
    if (step.advance === 'auto' && step.until?.()) {
      this.#advance();
      return;
    }
    this.#reposition();
  }

  // ---- geometry ----------------------------------------------------------------

  #reposition = (): void => {
    if (this.#disposed) return;
    const step = this.#steps[this.#index];
    if (!step) return;
    const hostBox = this.#host.getBoundingClientRect();
    const W = hostBox.width;
    const H = hostBox.height;
    const node = step.target?.();

    if (!node) {
      // No target: dim everything and centre the bubble. Used by the opening and closing
      // steps, which are about the game rather than about a button.
      this.#setPanes(0, 0, W, 0, W, H);
      this.#ring.style.opacity = '0';
      this.#arrow.style.opacity = '0';
      this.#bubble.style.left = `${Math.round(W / 2 - this.#bubble.offsetWidth / 2)}px`;
      this.#bubble.style.top = `${Math.round(H / 2 - this.#bubble.offsetHeight / 2)}px`;
      return;
    }

    const pad = step.pad ?? 8;
    const b = node.getBoundingClientRect();
    const x = b.left - hostBox.left - pad;
    const y = b.top - hostBox.top - pad;
    const w = b.width + pad * 2;
    const h = b.height + pad * 2;

    this.#setPanes(x, y, w, h, W, H);
    this.#ring.style.opacity = '1';
    Object.assign(this.#ring.style, {
      left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`,
    });

    // The bubble goes on whichever side of the hole has the most room, and the arrow
    // points back at it. Clamped inside the viewport, because a bubble half off the
    // screen next to a control at the edge is the usual way this breaks.
    const bw = this.#bubble.offsetWidth || 300;
    const bh = this.#bubble.offsetHeight || 130;
    const gap = 22;
    const below = y + h + gap + bh <= H - 8;
    const bx = Math.max(12, Math.min(W - bw - 12, x + w / 2 - bw / 2));
    const by = below ? y + h + gap : Math.max(12, y - gap - bh);
    this.#bubble.style.left = `${Math.round(bx)}px`;
    this.#bubble.style.top = `${Math.round(by)}px`;

    this.#arrow.style.opacity = '1';
    this.#arrow.style.left = `${Math.round(x + w / 2 - 13)}px`;
    this.#arrow.style.top = `${Math.round(below ? y + h + 2 : y - 30)}px`;
    // Pointing up at the hole when the bubble is below it, down when it is above.
    this.#arrow.style.transform = below ? 'rotate(180deg)' : 'none';
    this.#arrow.style.setProperty('--ny', below ? '-5px' : '5px');
  };

  /** Four rectangles around a hole. Their union is the whole host minus the hole. */
  #setPanes(x: number, y: number, w: number, h: number, W: number, H: number): void {
    const set = (i: number, l: number, tp: number, wd: number, ht: number): void => {
      const pane = this.#panes[i] as HTMLElement;
      pane.style.left = `${Math.round(l)}px`;
      pane.style.top = `${Math.round(tp)}px`;
      pane.style.width = `${Math.max(0, Math.round(wd))}px`;
      pane.style.height = `${Math.max(0, Math.round(ht))}px`;
    };
    set(0, 0, 0, W, y);                      // above
    set(1, 0, y + h, W, H - (y + h));        // below
    set(2, 0, y, x, h);                      // left
    set(3, x + w, y, W - (x + w), h);        // right
  }
}

/** A solid arrow head, drawn rather than a glyph — see icons.ts for why. */
function arrowSvg(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 26 28');
  svg.setAttribute('width', '26');
  svg.setAttribute('height', '28');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M13 27 3 13h6V2h8v11h6Z');
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
}

// ---- the two flows -------------------------------------------------------------

/**
 * On the club screen, before the first match. Two steps, and the second one is the Watch
 * button — so the tour hands straight over to the match flow below.
 */
export function clubSteps(watchButton: () => Element | null): CoachStep[] {
  return [
    { body: 'coach.welcome', advance: 'next' },
    { body: 'coach.watch', advance: 'target', target: watchButton, pad: 10 },
  ];
}

export interface MatchCoachTargets {
  strip: () => Element | null;
  speed: () => Element | null;
  tactics: () => Element | null;
  drawer: () => Element | null;
  goalsSoFar: () => number;
}

/**
 * Inside the match. Every step is one of the three levers design §5b puts on rungs 1–3,
 * in the order a kid meets them: who is playing, how fast you are watching, and how they
 * play. Nothing on rungs 4–6 appears here at all.
 */
export function matchSteps(targets: MatchCoachTargets): CoachStep[] {
  const start = targets.goalsSoFar();
  // "Watch for a goal" needs a way out: a 0-0 is a perfectly ordinary football match, and
  // a tour step that waits for something that may never happen is a tour that never ends.
  let deadline = Number.POSITIVE_INFINITY;
  return [
    { body: 'coach.yourTeam', advance: 'next', target: targets.strip, pad: 6 },
    { body: 'coach.speed', advance: 'target', target: targets.speed, pad: 8 },
    { body: 'coach.subs', advance: 'next', target: targets.strip, pad: 6 },
    { body: 'coach.tactics', advance: 'target', target: targets.tactics, pad: 8 },
    { body: 'coach.sliders', advance: 'next', target: targets.drawer, pad: 6 },
    // The last step has no target and no button: it ends when a goal goes in, which is
    // the game teaching the last thing itself — or after forty seconds, whichever the
    // match gets to first.
    {
      body: 'coach.watchIt',
      advance: 'auto',
      onEnter: () => {
        deadline = Date.now() + 40_000;
      },
      until: () => targets.goalsSoFar() > start || Date.now() > deadline,
    },
    { body: 'coach.done', advance: 'next' },
  ];
}
