// A training ground at dusk, drawn by the match renderer (design player-career §3, §9).
//
// The trial and the three drills are small MatchStates with a handful of figures. The stage
// draws one with the stands, crowd and officials hidden, asks the kid through the same
// MomentPad a match uses, and plays out what happened as short scripted tweens — a drill
// has no opponent AI to run, only a consequence to show.

import { lerp } from '../../core/math.js';
import { streamOf } from '../../core/rng.js';
import { decideOnBall } from '../../sim/match/agent.js';
import { TICK } from '../../sim/match/physics.js';
import type { MatchPlayer, MatchState } from '../../sim/match/types.js';
import { momentOptions, type MomentKind, type MomentOption } from '../../sim/player/moments.js';
import type { BallAction } from '../../sim/match/agent.js';
import { RenderClient } from '../../render/renderer.js';
import { el } from '../dom.js';
import { MomentPad } from './momentPad.js';

export interface StageOptions {
  tier: number;
  reducedMotion: boolean;
  playerStyle: 'retro' | 'realistic';
}

interface Tween {
  ticks: number;
  done: number;
  step(fraction: number): void;
  resolve(): void;
}

export class Stage {
  readonly root = el('div', { class: 'tl-canvas-holder tl-stage' });
  readonly client: RenderClient;
  state!: MatchState;
  pad: MomentPad | null = null;
  #tween: Tween | null = null;
  /** Something that moves while the kid thinks: the sliding keeper in Hoops. */
  idle: ((seconds: number) => void) | null = null;
  #seconds = 0;
  #accumulated = 0;
  #last = performance.now();
  #raf = 0;
  #rng = streamOf(Date.now() % 100000, 'stage');

  constructor(opts: StageOptions) {
    const canvas = el('canvas');
    this.root.append(canvas);
    document.body.append(this.root);
    this.client = new RenderClient({ canvas, tier: opts.tier, reducedMotion: opts.reducedMotion, crowd: 'off', stadiumFx: false, playerStyle: opts.playerStyle });
    this.client.setTrainingGround(true);
    this.client.setCameraMode('player');
    this.client.cam.mirror(-1);
    addEventListener('resize', this.#onResize, { passive: true });
    this.#raf = requestAnimationFrame(this.#frame);
  }

  get hero(): MatchPlayer {
    return this.state.home.players[0] as MatchPlayer;
  }

  setState(state: MatchState): void {
    this.state = state;
    // No applyGround: it rebuilds the stands, and a training ground has none.
    this.client.applyConditions(state.conditions);
    this.client.applyKits(state);
    this.client.setFollow(this.hero.id);
    this.client.captureTick(state);
    this.client.captureTick(state);
    this.client.resetCamera(state);
  }

  /** Freeze for a choice. `kinds` narrows what a drill offers; "let him play" is always there. */
  ask(kinds: readonly MomentKind[], hintAfter?: number): Promise<{ option: MomentOption; action: BallAction }> {
    const suggested = decideOnBall(this.state, this.hero, this.#rng);
    const options = momentOptions(this.state, this.hero, suggested)
      .filter((option) => option.kind === 'auto' || kinds.includes(option.kind));
    return new Promise((resolve) => {
      this.pad = new MomentPad({
        host: this.root,
        project: (x, y, z) => this.client.project(x, y, z),
        state: this.state,
        hero: this.hero,
        options,
        suggested,
        ...(hintAfter !== undefined ? { hintAfter } : {}),
        onChoose: (option, action) => {
          this.pad = null;
          resolve({ option, action });
        },
      });
    });
  }

  /** Play `step(0..1)` over `seconds`, one sim tick at a time so the renderer interpolates. */
  play(seconds: number, step: (fraction: number) => void): Promise<void> {
    return new Promise((resolve) => {
      this.#tween = { ticks: Math.max(1, Math.round(seconds / TICK)), done: 0, step, resolve };
    });
  }

  /** Carry the ball to a spot at running pace. */
  run(player: MatchPlayer, x: number, y: number, seconds = 1): Promise<void> {
    const fromX = player.x;
    const fromY = player.y;
    const ball = this.state.ball;
    return this.play(seconds, (fraction) => {
      const nextX = lerp(fromX, x, fraction);
      const nextY = lerp(fromY, y, fraction);
      player.vx = (nextX - player.x) / TICK;
      player.vy = (nextY - player.y) / TICK;
      player.facing = Math.atan2(y - fromY, x - fromX);
      player.x = nextX;
      player.y = nextY;
      if (ball.ownerId === player.id) {
        ball.x = player.x + Math.cos(player.facing) * 0.6;
        ball.y = player.y + Math.sin(player.facing) * 0.6;
      }
      if (fraction >= 1) player.vx = player.vy = 0;
    });
  }

  /** The ball along the grass to a point, with the slightest lift. */
  kickTo(x: number, y: number, seconds: number): Promise<void> {
    const ball = this.state.ball;
    const fromX = ball.x;
    const fromY = ball.y;
    ball.ownerId = -1;
    return this.play(seconds, (fraction) => {
      ball.x = lerp(fromX, x, fraction);
      ball.y = lerp(fromY, y, fraction);
      ball.z = Math.sin(Math.PI * fraction) * 0.25;
      ball.vx = (x - fromX) / seconds;
      ball.vy = (y - fromY) / seconds;
      ball.vz = 0;
    });
  }

  dispose(): void {
    cancelAnimationFrame(this.#raf);
    removeEventListener('resize', this.#onResize);
    this.pad?.dispose();
    this.client.dispose();
    this.root.remove();
  }

  #onResize = (): void => this.client.resize();

  #frame = (now: number): void => {
    this.#raf = requestAnimationFrame(this.#frame);
    const dt = Math.min((now - this.#last) / 1000, 0.25);
    this.#last = now;
    this.#seconds += dt;
    this.#accumulated += dt;
    if (!this.state) return;
    while (this.#accumulated >= TICK) {
      this.#accumulated -= TICK;
      this.tick();
    }
    this.client.frame(this.state, dt, this.#accumulated / TICK);
  };

  /** One sim tick. Public so a harness without animation frames can still drive it. */
  tick(): void {
    const tween = this.#tween;
    if (tween) {
      tween.done++;
      tween.step(Math.min(1, tween.done / tween.ticks));
      if (tween.done >= tween.ticks) {
        this.#tween = null;
        tween.resolve();
      }
    } else {
      this.idle?.(this.#seconds);
    }
    this.client.captureTick(this.state);
  }
}
