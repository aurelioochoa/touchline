// The key moment, on screen (design player-career §10).
//
// Every option is a real <button> of at least 56px, anchored to where its thing is on the
// pitch and fanned apart when two would overlap. Keyboard: arrows or Tab walk the options
// in screen order, Enter picks, A lets him play. The goal opens a 3x2 aim grid with a soft
// circle the size of how far the strike may stray; a second press on the same zone shoots.
// There is no timer: the freeze waits forever.

import { clamp, lerp } from '../../core/math.js';
import { t, type StringKey } from '../../i18n.js';
import { aimSpread, shotAt, AIM_COLUMNS, type MomentKind, type MomentOption } from '../../sim/player/moments.js';
import type { BallAction } from '../../sim/match/agent.js';
import type { MatchPlayer, MatchState } from '../../sim/match/types.js';
import { button, el } from '../dom.js';
import type { IconName } from '../icons.js';
import { audio } from '../../audio/audio.js';

export interface MomentPadOptions {
  host: HTMLElement;
  project(x: number, y: number, z: number): { x: number; y: number } | null;
  state: MatchState;
  hero: MatchPlayer;
  options: MomentOption[];
  suggested: BallAction;
  /** Seconds before the option the coach would pick starts to pulse, if ever. */
  hintAfter?: number;
  onChoose(option: MomentOption, action: BallAction): void;
}

const GLYPH: Record<MomentKind, IconName> = { pass: 'squad', shoot: 'goal', cross: 'flag', dribble: 'up', auto: 'play' };
const LABEL: Record<MomentKind, StringKey> = {
  pass: 'moment.pass', shoot: 'moment.shoot', cross: 'moment.cross', dribble: 'moment.dribble', auto: 'moment.auto',
};
const TARGET = 60;

interface Placed {
  option: MomentOption;
  button: HTMLButtonElement;
  x: number;
  y: number;
}

export class MomentPad {
  readonly root = el('div', { class: 'tl-moment', role: 'group' });
  readonly #opts: MomentPadOptions;
  #placed: Placed[] = [];
  #grid: HTMLElement | null = null;
  #aimZone = -1;
  #raf = 0;
  #hintTimer = 0;
  #done = false;

  constructor(opts: MomentPadOptions) {
    this.#opts = opts;
    this.root.setAttribute('aria-label', t('moment.label'));
    for (const option of opts.options) {
      const glow = option.kind === 'auto' ? '' : ` risk-${option.risk < 0.3 ? 'low' : option.risk < 0.6 ? 'mid' : 'high'}`;
      const control = button(option.kind === 'auto' ? t(LABEL.auto) : '', () => this.#pick(option), {
        class: `tl-btn tl-moment-opt kind-${option.kind}${glow}`,
        icon: GLYPH[option.kind],
        'aria-label': `${t(LABEL[option.kind])}${option.kind === 'auto' ? ' · A' : ''}`,
        style: `--ring:${lerp(10, 3, option.risk).toFixed(1)}px`,
      });
      this.root.append(control);
      this.#placed.push({ option, button: control, x: 0, y: 0 });
    }
    opts.host.append(this.root);
    addEventListener('keydown', this.#onKey, true);
    this.#layout();
    this.#focus(0);
    if (opts.hintAfter !== undefined) {
      this.#hintTimer = window.setTimeout(() => this.#hint(), opts.hintAfter * 1000);
    }
  }

  dispose(): void {
    this.#done = true;
    cancelAnimationFrame(this.#raf);
    clearTimeout(this.#hintTimer);
    removeEventListener('keydown', this.#onKey, true);
    this.root.remove();
  }

  /** The buttons, in the order the keyboard walks them. */
  get buttons(): HTMLButtonElement[] {
    return this.#ordered().map((placed) => placed.button);
  }

  #ordered(): Placed[] {
    return [...this.#placed].sort((a, b) => a.x - b.x || a.y - b.y);
  }

  #pick(option: MomentOption): void {
    if (this.#done) return;
    audio.tick();
    if (option.kind === 'shoot') {
      this.#openAim(option);
      return;
    }
    this.#finish(option, option.action);
  }

  #finish(option: MomentOption, action: BallAction): void {
    this.dispose();
    this.#opts.onChoose(option, action);
  }

  /** Follow the picture: the camera may still be easing while the match is frozen. */
  #layout = (): void => {
    if (this.#done) return;
    const { host, project } = this.#opts;
    const width = host.clientWidth;
    const height = host.clientHeight;
    for (const placed of this.#placed) {
      if (placed.option.kind === 'auto') {
        placed.x = width / 2;
        placed.y = height - 92;
        continue;
      }
      const point = project(placed.option.x, placed.option.y, placed.option.z) ?? { x: width / 2, y: height / 2 };
      placed.x = point.x;
      placed.y = point.y;
    }
    // Fan apart anything closer than a target's width, a few relaxation passes.
    for (let pass = 0; pass < 6; pass++) {
      for (const first of this.#placed) {
        for (const second of this.#placed) {
          if (first === second) continue;
          const dx = second.x - first.x;
          const dy = second.y - first.y;
          const gap = Math.hypot(dx, dy);
          if (gap >= TARGET + 4) continue;
          const push = (TARGET + 4 - gap) / 2;
          const ux = gap > 0.01 ? dx / gap : 1;
          const uy = gap > 0.01 ? dy / gap : 0;
          if (first.option.kind !== 'auto') {
            first.x -= ux * push;
            first.y -= uy * push;
          }
          if (second.option.kind !== 'auto') {
            second.x += ux * push;
            second.y += uy * push;
          }
        }
      }
    }
    const heroPoint = project(this.#opts.hero.x, this.#opts.hero.y, 0);
    for (const placed of this.#placed) {
      placed.x = clamp(placed.x, 40, width - 40);
      placed.y = clamp(placed.y, 76, height - 60);
      placed.button.style.left = `${placed.x.toFixed(0)}px`;
      placed.button.style.top = `${placed.y.toFixed(0)}px`;
      if (placed.option.kind === 'dribble' && heroPoint) {
        const angle = Math.atan2(placed.y - heroPoint.y, placed.x - heroPoint.x) + Math.PI / 2;
        placed.button.style.setProperty('--turn', `${angle.toFixed(3)}rad`);
      }
    }
    this.#raf = requestAnimationFrame(this.#layout);
  };

  #focus(index: number): void {
    const list = this.#grid ? [...this.#grid.querySelectorAll<HTMLButtonElement>('button')] : this.buttons;
    const target = list[(index + list.length) % list.length];
    target?.focus({ preventScroll: true });
  }

  #onKey = (event: KeyboardEvent): void => {
    if (this.#done) return;
    const list = this.#grid ? [...this.#grid.querySelectorAll<HTMLButtonElement>('button')] : this.buttons;
    const current = list.indexOf(document.activeElement as HTMLButtonElement);
    const step = (delta: number): void => {
      event.preventDefault();
      event.stopPropagation();
      this.#focus(current < 0 ? 0 : current + delta);
    };
    if (this.#grid) {
      // The aim grid is three across and two down.
      if (event.key === 'ArrowLeft') step(-1);
      else if (event.key === 'ArrowRight' || (event.key === 'Tab' && !event.shiftKey)) step(1);
      else if (event.key === 'Tab') step(-1);
      else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') step(current < 3 ? 3 : -3);
      else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.#closeAim();
      }
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)) step(1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'Tab') step(-1);
    else if (event.key === 'a' || event.key === 'A') {
      event.preventDefault();
      const auto = this.#placed.find((placed) => placed.option.kind === 'auto');
      if (auto) this.#pick(auto.option);
    }
  };

  /** The goal, close up: six zones, the aim circle in the chosen one. */
  #openAim(option: MomentOption): void {
    const { state, hero, suggested, project, host } = this.#opts;
    this.root.classList.add('is-aiming');
    const spread = aimSpread(state, hero);
    // One column of the grid is AIM_COLUMNS' spacing of real goal, so the circle is to scale.
    const circle = clamp((spread / ((AIM_COLUMNS[1] ?? 0) - (AIM_COLUMNS[0] ?? -2.4))) * 64, 14, 120);
    const grid = el('div', { class: 'tl-aim', role: 'group', 'aria-label': t('moment.aim') });
    grid.style.setProperty('--spread', `${circle.toFixed(0)}px`);
    for (let zone = 0; zone < 6; zone++) {
      // Rows render top first; zone numbers keep the low row first, as the engine does.
      const engineZone = zone < 3 ? zone + 3 : zone - 3;
      const cell = button('', () => {
        if (this.#aimZone === engineZone) this.#finish(option, shotAt(state, hero, engineZone, suggested));
        else this.#aim(engineZone, cell);
      }, { class: 'tl-aim-zone', 'aria-label': t(engineZone >= 3 ? 'moment.aimHigh' : 'moment.aimLow', { n: (engineZone % 3) + 1 }) });
      cell.addEventListener('focus', () => this.#aim(engineZone, cell));
      grid.append(cell);
    }
    const back = button('', () => this.#closeAim(), { class: 'tl-btn tl-ghost tl-icon-only tl-aim-back', icon: 'back', 'aria-label': t('moment.backOut') });
    const goal = project(option.x, option.y, option.z);
    const left = clamp(goal?.x ?? host.clientWidth / 2, 120, host.clientWidth - 120);
    const top = clamp(goal?.y ?? host.clientHeight / 3, 110, host.clientHeight - 200);
    const wrap = el('div', { class: 'tl-aim-wrap', style: `left:${left.toFixed(0)}px;top:${top.toFixed(0)}px` }, [grid, back]);
    this.root.append(wrap);
    this.#grid = wrap;
    // Tapping the pitch outside the goal backs out of the aim.
    this.root.addEventListener('pointerdown', this.#outside);
    this.#focus(1);
  }

  #outside = (event: PointerEvent): void => {
    if (this.#grid && !this.#grid.contains(event.target as Node)) this.#closeAim();
  };

  #aim(zone: number, cell: HTMLElement): void {
    this.#aimZone = zone;
    for (const other of this.#grid?.querySelectorAll('.tl-aim-zone') ?? []) other.classList.toggle('is-aimed', other === cell);
  }

  #closeAim(): void {
    this.#grid?.remove();
    this.#grid = null;
    this.#aimZone = -1;
    this.root.classList.remove('is-aiming');
    this.root.removeEventListener('pointerdown', this.#outside);
    this.#focus(0);
  }

  /** A kid who hesitates gets the coach's finger on the option he would choose. */
  #hint(): void {
    const suggested = this.#opts.suggested;
    const match = this.#placed.find((placed) => {
      const action = placed.option.action;
      if (suggested.kind === 'pass') return placed.option.receiverId === suggested.to.id;
      return placed.option.kind !== 'auto' && action.kind === suggested.kind;
    }) ?? this.#placed.find((placed) => placed.option.kind === 'auto');
    match?.button.classList.add('tl-hint');
  }
}
