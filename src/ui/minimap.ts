// The match as a diagram: twenty-two dots, a ball, and the shape they are all in.
//
// The 3D view answers "what is happening"; this answers "where is everyone", which is the
// question a manager actually has and the one a broadcast camera is worst at. Pushing the
// defensive line slider and watching a back four step up ten metres is the whole of design
// §6's promise that a lever's effect is *visible* — and it is not visible from behind the
// goal.
//
// Read-only over MatchState, like everything in `src/render/`. Draws on a 2D canvas rather
// than DOM nodes: twenty-three moving elements is where per-node layout starts costing more
// than repainting the lot.

import { clamp01 } from '../core/math.js';
import {
  PENALTY_AREA_DEPTH,
  PENALTY_AREA_WIDTH,
  PITCH_LENGTH,
  PITCH_WIDTH,
  CENTRE_CIRCLE_RADIUS,
} from '../sim/match/pitch.js';
import { directionOf, type MatchState, type Side } from '../sim/match/types.js';
import { kitCss } from './theme.js';
import { el } from './dom.js';

/** Metres of grass drawn beyond the touchlines, so a dot on the line is not half cut off. */
const MARGIN = 3.5;
/**
 * Aspect of everything drawn, which the canvas keeps whatever width it is given.
 *
 * The margin is part of it. It was not, and the canvas was therefore 3% shorter than the
 * diagram painted into it: the bottom touchline and the lower half of both penalty areas
 * were cut off every time. Nobody caught it while this only ever floated in a corner of the
 * match view over a pitch that was showing the same thing in 3D — putting the same diagram
 * on the club screen as the only picture of a running match is what made it obvious.
 */
const ASPECT = (PITCH_WIDTH + MARGIN * 2) / (PITCH_LENGTH + MARGIN * 2);

export interface MinimapOptions {
  /** The side the player manages. His team always attacks to the RIGHT. */
  mine: Side;
  /** CSS width in pixels. Height follows the pitch. */
  width?: number;
  /** Extra classes on the wrapper. */
  className?: string;
}

export class Minimap {
  readonly root: HTMLElement;
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D | null;
  readonly #mine: Side;
  #width: number;
  #dpr = 1;
  /** Repaint budget. The simulation moves at 10 Hz; painting faster shows nothing new. */
  #since = 0;

  constructor(opts: MinimapOptions) {
    this.#mine = opts.mine;
    this.#width = opts.width ?? 188;
    this.#canvas = el('canvas', { 'aria-hidden': 'true' });
    this.root = el('div', {
      class: `tl-minimap${opts.className ? ` ${opts.className}` : ''}`,
      // A picture of the pitch is decoration for a screen reader — everything it says is
      // already in the scoreboard and the squad strip, which are real text.
      'aria-hidden': 'true',
    }, [this.#canvas]);
    this.#ctx = this.#canvas.getContext('2d');
    this.resize(this.#width);
  }

  /** Set the CSS width; the height and the backing store follow. */
  resize(width: number): void {
    this.#width = width;
    this.#dpr = Math.min(window.devicePixelRatio || 1, 2);
    const h = Math.round(width * ASPECT);
    this.#canvas.style.width = `${width}px`;
    this.#canvas.style.height = `${h}px`;
    this.#canvas.width = Math.round(width * this.#dpr);
    this.#canvas.height = Math.round(h * this.#dpr);
    this.#since = Infinity;
  }

  dispose(): void {
    this.root.remove();
  }

  /**
   * Paint. `dt` is seconds since the last frame; pass 0 to force a repaint.
   *
   * Repainting at the display's rate would redraw the same twenty-three dots four or five
   * times per simulation tick. At 40x speed the sim outruns the display instead, so the
   * throttle is a floor on freshness rather than a cap on it.
   */
  update(state: MatchState, dt = 0): void {
    this.#since += dt;
    if (dt > 0 && this.#since < 1 / 14) return;
    this.#since = 0;
    const g = this.#ctx;
    if (!g) return;

    const W = this.#canvas.width;
    const H = this.#canvas.height;
    // Everything is drawn in metres and scaled once, so the geometry below reads as the
    // pitch rather than as pixel arithmetic.
    const scale = W / (PITCH_LENGTH + MARGIN * 2);
    // The managed side always attacks right, which is also what the 3D camera is mirrored
    // to do — two views of the same match disagreeing about which way is forward is worse
    // than either of them being wrong.
    const dir = directionOf(this.#mine, state.period);
    const mx = (x: number): number => (dir > 0 ? x + MARGIN : PITCH_LENGTH - x + MARGIN) * scale;
    const my = (y: number): number => (dir > 0 ? y + MARGIN : PITCH_WIDTH - y + MARGIN) * scale;

    g.clearRect(0, 0, W, H);

    // The grass.
    g.fillStyle = 'rgba(9, 38, 24, 0.92)';
    roundRect(g, 0, 0, W, H, 7 * this.#dpr);
    g.fill();

    // The markings, at the weight a diagram wants rather than the weight a pitch has.
    g.strokeStyle = 'rgba(214, 245, 226, 0.26)';
    g.lineWidth = Math.max(1, 0.9 * this.#dpr);
    g.strokeRect(mx(0), my(0), PITCH_LENGTH * scale, PITCH_WIDTH * scale);
    g.beginPath();
    g.moveTo(mx(PITCH_LENGTH / 2), my(0));
    g.lineTo(mx(PITCH_LENGTH / 2), my(PITCH_WIDTH));
    g.stroke();
    g.beginPath();
    g.arc(mx(PITCH_LENGTH / 2), my(PITCH_WIDTH / 2), CENTRE_CIRCLE_RADIUS * scale, 0, Math.PI * 2);
    g.stroke();
    for (const end of [0, 1]) {
      const x = end === 0 ? 0 : PITCH_LENGTH - PENALTY_AREA_DEPTH;
      g.strokeRect(
        Math.min(mx(x), mx(x + PENALTY_AREA_DEPTH)),
        my((PITCH_WIDTH - PENALTY_AREA_WIDTH) / 2),
        PENALTY_AREA_DEPTH * scale,
        PENALTY_AREA_WIDTH * scale,
      );
    }

    // The players. Mine carry a ring so a glance separates us from them even when the two
    // kits are close — the kit palette guarantees contrast, but a 3px dot is not a kit.
    const r = Math.max(2.2, 2.9 * this.#dpr);
    for (const side of ['home', 'away'] as const) {
      const team = side === 'home' ? state.home : state.away;
      const mine = side === this.#mine;
      for (const p of team.players) {
        if (!p.onPitch || p.sentOff) continue;
        g.beginPath();
        g.arc(mx(p.x), my(p.y), p.role === 'GK' ? r * 0.92 : r, 0, Math.PI * 2);
        g.fillStyle = p.role === 'GK' ? '#2fbf6b' : kitCss(team.kitPrimary);
        g.fill();
        if (mine) {
          g.lineWidth = Math.max(1, 1.1 * this.#dpr);
          g.strokeStyle = 'rgba(255,255,255,0.92)';
          g.stroke();
        } else {
          g.lineWidth = Math.max(1, 0.9 * this.#dpr);
          g.strokeStyle = 'rgba(0,0,0,0.45)';
          g.stroke();
        }
      }
    }

    // The ball, drawn last and brightest, with a halo that grows as it climbs so a cross
    // in the air is not a dot that has stopped moving.
    const b = state.ball;
    const lift = clamp01(b.z / 6);
    g.beginPath();
    g.arc(mx(b.x), my(b.y), r * (0.85 + lift * 1.5), 0, Math.PI * 2);
    g.fillStyle = `rgba(255,255,255,${0.22 + lift * 0.18})`;
    g.fill();
    g.beginPath();
    g.arc(mx(b.x), my(b.y), r * 0.72, 0, Math.PI * 2);
    g.fillStyle = '#ffffff';
    g.fill();
    g.lineWidth = Math.max(1, 0.9 * this.#dpr);
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.stroke();
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  const rr = Math.min(r, w / 2, h / 2);
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}
