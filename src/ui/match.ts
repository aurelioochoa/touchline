// Matchday.
//
// This is rungs 1 to 3 of the depth ladder (design §5b), and the only screen that has to
// work with every string blanked: watch, see a bar go orange, tap two portraits to make a
// substitution, push a slider and watch the shape move. Nothing here reads.
//
// The screen is deliberately mostly football. Everything that is not the pitch either sits
// in the top gradient, sits in the bottom gradient, or is off screen until asked for — the
// tactics panel used to be permanently open over the top-right quarter of the picture,
// which is a quarter of the game covered by four sliders nobody was touching.

import { clamp01 } from '../core/math.js';
import { t, type StringKey } from '../i18n.js';
import { audio } from '../audio/audio.js';
import { MatchEngine } from '../sim/match/engine.js';
import { TICK } from '../sim/match/physics.js';
import { PITCH_LENGTH } from '../sim/match/pitch.js';
import type { MatchEvent, MatchPlayer, MatchState, Side, TeamSetup } from '../sim/match/types.js';
import { RenderClient, type MatchDress } from '../render/renderer.js';
import { trailFor } from '../render/ballTrail.js';
import { fairConditions, type Conditions } from '../sim/match/conditions.js';
import { FpsGovernor } from '../render/tiers.js';
import { CAMERA_MODES, dangerOf, isCameraMode, type CameraMode } from '../render/camera.js';
import { crowdReaction, standLift } from '../audio/crowdReact.js';
import { icon, type IconName } from './icons.js';
import { inkOn } from '../sim/world/worldgen.js';
import { kitCss } from './theme.js';
import { bar, button, clear, el, heading, sheet, stat, toneOf } from './dom.js';
import { Minimap } from './minimap.js';
import { Commentator, type Line } from './commentary.js';
import { Voice } from './voice.js';
import { emptyScene } from './art/empty.js';

const MAX_STEPS = 40;

/** Each camera's icon and name. The icon has to carry it alone when strings are blanked. */
const CAMERA_LOOK: Record<CameraMode, { icon: IconName; name: StringKey }> = {
  tv: { icon: 'tv', name: 'camera.tv' },
  broadcast: { icon: 'camera', name: 'camera.broadcast' },
  follow: { icon: 'ball', name: 'camera.follow' },
  player: { icon: 'shirt', name: 'camera.player' },
  behindGoal: { icon: 'goal', name: 'camera.behindGoal' },
  tactical: { icon: 'tactics', name: 'camera.tactical' },
  ground: { icon: 'flag', name: 'camera.ground' },
};

/** Design §15 q3: how long you want to watch is not an advanced question. */
export const MATCH_SPEEDS = [1, 4, 8, 14, 24, 40] as const;

/** How many events the ticker keeps on screen at once. */
const TICKER_MAX = 3;

export interface MatchScreenOptions {
  /** The managed club's ball, and its roof at home. From the club studio. */
  dress?: MatchDress;
  engine: MatchEngine;
  /** The side the player manages, so the strip and the substitutions are his. */
  mine: Side;
  speed: number;
  reducedMotion: boolean;
  sound: boolean;
  tier?: number;
  /** Weather and time of day, derived from the fixture. Fair and bright if omitted. */
  conditions?: Conditions;
  /** Live commentary: none, on-screen text, or text read aloud. */
  commentary?: 'off' | 'text' | 'voice';
  /**
   * Whether the frame-rate governor may change the tier. False when the player has
   * chosen a quality by hand — an option that silently overrode itself would be worse
   * than no option (the rule tiers.ts already states for the governor).
   */
  autoQuality?: boolean;
  /** The modelled crowd and the stands' fire and light (settings: graphics). */
  crowd?: 'auto' | 'full' | 'half' | 'off';
  stadiumFx?: boolean;
  onFinished(state: MatchState): void;
  /**
   * The Back button and Escape.
   *
   * Leaving is NOT abandoning. This used to play the fixture out with `runToEnd()` and
   * record the result, so a kid who tapped Back to glance at the table had silently
   * fast-forwarded the whole match — the one thing a Back button must never do. The host
   * now detaches the screen and lets the match carry on.
   */
  onLeave(): void;
  /** Half time reached while nobody is watching, so the host can say so. */
  onHalfTime?(state: MatchState): void;
  /** Told whenever the speed control is used, so the setting follows the player. */
  onSpeedChange?(speed: number): void;
  /** The camera to start on. Anything unrecognised — an old save — is the TV director. */
  camera?: string;
  /** Told whenever the camera is changed, so the next match starts on the same one. */
  onCameraChange?(camera: CameraMode): void;
}

/** One live chip in the bottom strip, kept so it can be updated rather than rebuilt. */
interface Chip {
  root: HTMLElement;
  fill: HTMLElement;
  player: MatchPlayer;
  tired: boolean;
}

export class MatchScreen {
  readonly root = el('div', { class: 'tl-canvas-holder' });
  readonly #engine: MatchEngine;
  readonly #client: RenderClient;
  readonly #governor: FpsGovernor;
  readonly #mine: Side;
  readonly #onFinished: (s: MatchState) => void;
  readonly #onLeave: () => void;
  readonly #onHalfTime: ((s: MatchState) => void) | undefined;
  readonly #onSpeedChange: ((n: number) => void) | undefined;
  readonly #reducedMotion: boolean;
  readonly #autoQuality: boolean;
  #speed: number;
  #paused = false;
  #acc = 0;
  #last = 0;
  #raf = 0;
  #camera: CameraMode = 'tv';
  readonly #onCameraChange: ((c: CameraMode) => void) | undefined;
  #camBtn!: HTMLButtonElement;
  #camMenu: HTMLElement | null = null;
  #camToast: HTMLElement | null = null;
  #camToastTimer = 0;
  #pausedBadge!: HTMLButtonElement;
  #onBall!: HTMLElement;
  #onBallId = -2;
  #period!: HTMLElement;
  #lastScore = { home: 0, away: 0 };
  #scoreHome!: HTMLElement;
  #scoreAway!: HTMLElement;
  #clockEl!: HTMLElement;
  #momentum!: HTMLElement;
  #strip!: HTMLElement;
  #ticker!: HTMLElement;
  #playBtn!: HTMLButtonElement;
  #speedBtn!: HTMLButtonElement;
  #tacticsBtn!: HTMLButtonElement;
  #drawer: HTMLElement | null = null;
  #minimap!: Minimap;
  /** A second one inside the tactics drawer, so a slider's effect is watchable. */
  #drawerMap: Minimap | null = null;
  #chips: Chip[] = [];
  #finished = false;
  #disposed = false;
  /** Whether the match is the thing on screen, or is running behind the club screen. */
  #attached = true;
  #halfTimeShown = false;
  #lastClockText = '';
  #conditions: Conditions;
  /** Last frame's vertical ball speed, so a bounce is an edge and not a level. */
  #lastBallVz = 0;
  /**
   * The last shot that has not yet been saved or scored, and when (match seconds). What
   * tells the crowd that a goal kick is a MISS — see crowdReact.ts's `recentShot`.
   */
  #shotSide: Side | null = null;
  #shotAt = -1e9;
  /** Real seconds until the crowd will consider another Mexican wave. */
  #waveIn = 45;
  readonly #commentator: Commentator;
  readonly #voice = new Voice();
  readonly #commentary: 'off' | 'text' | 'voice';
  /** Everything said this match, oldest first. The log reads it back. */
  readonly #log: Line[] = [];
  #logBtn!: HTMLButtonElement;
  /** Events seen this frame, batched so the commentator picks ONE thing to say. */
  #tickEvents: MatchEvent[] = [];

  constructor(opts: MatchScreenOptions) {
    this.#engine = opts.engine;
    this.#mine = opts.mine;
    this.#speed = opts.speed;
    this.#onFinished = opts.onFinished;
    this.#onLeave = opts.onLeave;
    this.#onHalfTime = opts.onHalfTime;
    this.#onSpeedChange = opts.onSpeedChange;
    this.#onCameraChange = opts.onCameraChange;
    this.#camera = isCameraMode(opts.camera) ? opts.camera : 'tv';
    this.#reducedMotion = opts.reducedMotion;
    this.#autoQuality = opts.autoQuality ?? true;
    this.#governor = new FpsGovernor(opts.tier ?? 2);
    this.#commentary = opts.commentary ?? 'text';
    this.#commentator = new Commentator(opts.engine.seed, this.#mine);
    this.#voice.setEnabled(this.#commentary === 'voice');

    const canvas = el('canvas');
    this.root.append(canvas);
    this.#conditions = opts.conditions ?? fairConditions();
    this.#client = new RenderClient({
      canvas, reducedMotion: opts.reducedMotion, tier: opts.tier ?? 2,
      crowd: opts.crowd ?? 'auto', stadiumFx: opts.stadiumFx ?? true,
      onFootPlant: (x, _y, speed) => {
        if (audio.enabled) audio.footstep(this.#panAt(x), this.#conditions.wetness);
      },
    });
    this.#client.applyConditions(this.#conditions);
    this.#client.applyGround(this.#engine.state, opts.dress);
    this.#client.applyKits(this.#engine.state);
    this.#client.captureTick(this.#engine.state);
    this.#client.captureTick(this.#engine.state);
    this.#client.resetCamera(this.#engine.state);
    // The camera watches from the side the managed club attacks toward, so "our end" is
    // always the same end for the whole match.
    this.#client.cam.mirror(this.#mine === 'home' ? -1 : 1);
    this.#client.setPace(this.#speed);
    this.#client.setCameraMode(this.#camera);

    this.#buildHud();
    this.#buildStrip();
    this.#minimap = new Minimap({ mine: this.#mine });
    this.root.append(this.#minimap.root);
    this.#ticker = el('div', { class: 'tl-ticker', role: 'log', 'aria-live': 'polite' });
    this.root.append(this.#ticker);
    this.#buildOverlays();

    if (opts.sound) {
      audio.start();
      audio.setEnabled(true);
      audio.setWeather(
        this.#conditions.sky,
        this.#conditions.wetness,
        Math.hypot(this.#conditions.windX, this.#conditions.windY),
      );
      audio.whistle('short');
    }
    // Set whether or not sound is on now: a player who turns it on mid-match should hear
    // the ball they are playing with.
    const fx = opts.dress?.ball ? trailFor(opts.dress.ball.style) : null;
    audio.setBallFx(fx && fx.always ? fx.kind : null);

    addEventListener('resize', this.#onResize, { passive: true });
    addEventListener('keydown', this.#onKey);
    this.#last = performance.now();
    this.#raf = requestAnimationFrame(this.#frame);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    cancelAnimationFrame(this.#raf);
    removeEventListener('resize', this.#onResize);
    removeEventListener('keydown', this.#onKey);
    removeEventListener('pointerdown', this.#onOutside, true);
    clearTimeout(this.#camToastTimer);
    this.#voice.stop();
    this.#client.dispose();
    this.#minimap.dispose();
    this.#drawerMap?.dispose();
    this.root.remove();
  }

  get state(): MatchState {
    return this.#engine.state;
  }

  get paused(): boolean {
    return this.#paused;
  }

  get attached(): boolean {
    return this.#attached;
  }

  /** Exactly what the Back button does, for the debug hook and the Escape key. */
  requestLeave(): void {
    this.#onLeave();
  }

  /** Pause or resume from outside — the club screen's live card uses this. */
  setPaused(on: boolean): void {
    if (this.#paused !== on) this.#togglePause();
  }

  /**
   * Everything the commentator has said, oldest first.
   *
   * Plain data, so it outlives the screen: the club screen offers the match log after full
   * time, by which point this object has been disposed.
   */
  logLines(): readonly Line[] {
    return this.#log;
  }

  /** What the club screen's live card needs. Cheap enough to poll several times a second. */
  liveSummary(): {
    minute: number;
    home: number;
    away: number;
    homeShort: string;
    awayShort: string;
    paused: boolean;
    finished: boolean;
  } {
    const s = this.#engine.state;
    return {
      minute: Math.min(Math.floor(s.clock / 60), 120),
      home: s.score.home,
      away: s.score.away,
      homeShort: s.home.shortName,
      awayShort: s.away.shortName,
      paused: this.#paused,
      finished: s.finished,
    };
  }

  /**
   * Show or hide the match without stopping it.
   *
   * Detaching is what Back does. The engine keeps ticking, the commentator keeps talking
   * and the log keeps filling; only the drawing stops — see the guard in `#frame`. The
   * RenderClient is deliberately NOT disposed: rebuilding a stadium, twenty-five figures
   * and a sky costs most of a second, and the whole point of being able to leave is that
   * coming back is instant.
   */
  setAttached(on: boolean): void {
    if (this.#disposed || this.#attached === on) return;
    this.#attached = on;
    this.root.classList.toggle('tl-hidden', !on);
    if (!on) return;

    // Back from the club screen: the window may have been resized while the canvas had no
    // layout, and the camera is still looking at where the ball was when the player left.
    // The figures themselves are already current — `captureTick` runs above the guard.
    this.#client.resize();
    this.#client.resetCamera(this.#engine.state);
    this.#rebuildStrip();
    this.#lastClockText = '';
    this.#onBallId = -2;
    this.#drawHud(this.#engine.state);
    this.#minimap.update(this.#engine.state, 0);
  }

  /** Handles for the onboarding coach, which points at these controls by name. */
  get coachTargets(): { strip: HTMLElement; speed: HTMLElement; tactics: HTMLElement; drawer: HTMLElement | null } {
    return { strip: this.#strip, speed: this.#speedBtn, tactics: this.#tacticsBtn, drawer: this.#drawer };
  }

  /**
   * One simulation tick, for the headless harnesses.
   *
   * Goes through the same path the live loop does, commentary included. It did not, and
   * the consequence was the exact blind spot design §16 already records for the break
   * screens: `smoke.mjs` and `shots.mjs` drive the match with this method, so the whole
   * commentary and match-log feature was invisible to every gate the game has — the log
   * came back empty in a browser and no check said a word.
   */
  stepOnce(): void {
    if (this.#engine.state.finished) return;
    this.#advance();
    this.#client.captureTick(this.#engine.state);
    // A tick of match clock, so the commentator's rate limiter behaves as it does live.
    this.#speak(this.#engine.state, TICK);
    // Full time, which is a FACT about the match rather than a beat of the frame loop.
    // Without this a harness-driven match reaches the ninetieth minute and simply never
    // ends — the fixture stays unplayed and the career cannot move past it — because
    // ending is something `#frame` notices and a harness has no frame.
    //
    // Half time is deliberately not here. That one IS a beat: it opens a panel and pauses
    // the match for somebody who is watching, and something stepping thirty thousand ticks
    // inside one turn is not watching. `openBreak('half')` is how a harness asks for it,
    // and is the reason that hook exists.
    this.#finishCheck(this.#engine.state);
  }

  /** Step the engine once and route what happened to both the HUD and the commentator. */
  #advance(): void {
    for (const e of this.#engine.step()) {
      this.#onEvent(e);
      this.#tickEvents.push(e);
    }
  }

  /**
   * Open one of the two break screens, for the harnesses.
   *
   * Both are normally reached from inside the frame loop, and both were invisible to every
   * gate the game has: `smoke.mjs` plays a match out with `stepOnce` and then leaves
   * through `quitMatch`, which is the Back button's path and never touches full time. So
   * the two screens a player sees at the end of every match they watch had no coverage at
   * all. This is the seam that gives them some.
   */
  openBreak(which: 'half' | 'full', onClose: () => void): void {
    if (which === 'half') {
      // Opened by hand counts as opened. Otherwise the automatic one fires again when the
      // clock actually reaches forty-five and stacks a second sheet on the first.
      this.#halfTimeShown = true;
      this.#showHalfTime(this.#engine.state);
    } else {
      this.showFullTime(onClose);
    }
  }

  /** Override the weather. For the contact sheet; the fixture decides it in real play. */
  setConditions(c: Conditions): void {
    this.#client.applyConditions(c);
  }

  /** Draw without waiting on requestAnimationFrame, which automation throttles away. */
  /** The render client, for the close-up harness. */
  get renderClient(): RenderClient {
    return this.#client;
  }

  /** Draw one frame at an explicit interpolation point, for animation strips. */
  drawAt(dt: number, alpha: number): void {
    this.#client.frame(this.#engine.state, dt, alpha);
  }

  drawFrames(frames: number): void {
    for (let i = 0; i < frames; i++) this.#client.frame(this.#engine.state, 1 / 60, 1);
    this.#drawHud(this.#engine.state);
    this.#minimap.update(this.#engine.state);
    this.#drawerMap?.update(this.#engine.state);
    this.#updateChips();
  }

  #onResize = (): void => this.#client.resize();

  #onKey = (e: KeyboardEvent): void => {
    // A detached match is still listening on the window, and every key below belongs to a
    // screen the player is not looking at. Without this, Space on the club screen pauses an
    // invisible match and Escape leaves one the player has already left.
    if (!this.#attached) return;
    // Never swallow a key while a dialog is open: the sheet owns Escape and Tab, and the
    // substitution list is a real focus trap.
    if (this.root.querySelector('.tl-overlay')) return;
    switch (e.key) {
      case ' ':
        e.preventDefault();
        this.#togglePause();
        break;
      case 'c': case 'C':
        this.#cycleCamera(e.shiftKey ? -1 : 1);
        break;
      case 'f': case 'F':
        this.#cycleSpeed();
        break;
      case 't': case 'T':
        this.#toggleDrawer();
        break;
      case 'Escape':
        if (this.#camMenu) this.#closeCamMenu(true);
        else if (this.#drawer) this.#toggleDrawer();
        else this.#onLeave();
        break;
      default:
        break;
    }
  };

  #togglePause(): void {
    this.#paused = !this.#paused;
    if (this.#paused) this.#voice.stop();
    clear(this.#playBtn);
    this.#playBtn.append(icon(this.#paused ? 'play' : 'pause', 16));
    this.#playBtn.setAttribute('aria-pressed', String(this.#paused));
    const label = t(this.#paused ? 'match.play' : 'match.pause');
    this.#playBtn.setAttribute('aria-label', label);
    this.#playBtn.setAttribute('data-tip', `${label} · Space`);
    this.root.classList.toggle('tl-is-paused', this.#paused);
  }

  /** C and Shift+C: step through the cameras, and say which one it landed on. */
  #cycleCamera(step: 1 | -1 = 1): void {
    const i = CAMERA_MODES.indexOf(this.#camera);
    const n = CAMERA_MODES.length;
    this.#setCamera(CAMERA_MODES[(i + step + n) % n] as CameraMode);
  }

  #setCamera(mode: CameraMode): void {
    this.#camera = mode;
    this.#client.setCameraMode(mode);
    this.#paintCamBtn();
    this.#showCamToast();
    this.#onCameraChange?.(mode);
    audio.tick();
  }

  #paintCamBtn(): void {
    const look = CAMERA_LOOK[this.#camera];
    const name = t(look.name);
    clear(this.#camBtn);
    this.#camBtn.append(icon(look.icon, 16), el('span', { class: 'tl-cam-name', text: name }), icon('chevron', 12));
    this.#camBtn.setAttribute('aria-label', `${t('match.camera')}: ${name}`);
    this.#camBtn.setAttribute('data-tip', `${t('match.camera')} · C`);
  }

  /**
   * A caption naming the camera just chosen, over the picture for a moment. Pressing C is
   * otherwise a change nobody can name, and at the tactical camera the only clue is that
   * everything has become very small.
   */
  #showCamToast(): void {
    const look = CAMERA_LOOK[this.#camera];
    this.#camToast?.remove();
    const toast = el('div', { class: 'tl-cam-toast', 'aria-hidden': 'true' }, [
      icon(look.icon, 18),
      el('span', { text: t(look.name) }),
    ]);
    this.root.append(toast);
    this.#camToast = toast;
    clearTimeout(this.#camToastTimer);
    this.#camToastTimer = window.setTimeout(() => {
      toast.remove();
      if (this.#camToast === toast) this.#camToast = null;
    }, 1600);
  }

  /** The camera picker: every camera, its icon and its name, the current one ticked. */
  #toggleCamMenu(): void {
    if (this.#camMenu) {
      this.#closeCamMenu(false);
      return;
    }
    const menu = el('div', { class: 'tl-cam-menu', role: 'menu', 'aria-label': t('match.camera') });
    const items: HTMLButtonElement[] = [];
    for (const mode of CAMERA_MODES) {
      const look = CAMERA_LOOK[mode];
      const on = mode === this.#camera;
      const item = el('button', {
        class: `tl-cam-item${on ? ' on' : ''}`,
        type: 'button',
        role: 'menuitemradio',
        'aria-checked': String(on),
      }, [
        icon(look.icon, 18),
        el('span', { class: 'txt' }, [
          el('b', { text: t(look.name) }),
          mode === 'tv' ? el('small', { text: t('camera.tvHint') }) : null,
        ]),
        on ? icon('check', 14) : null,
      ]);
      item.addEventListener('click', () => {
        this.#closeCamMenu(true);
        if (mode !== this.#camera) this.#setCamera(mode);
      });
      items.push(item);
      menu.append(item);
    }
    // Arrow keys move through it, as they do through any menu. Tab leaves it.
    menu.addEventListener('keydown', (e) => {
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      let next = -1;
      if (e.key === 'ArrowDown') next = (at + 1) % items.length;
      else if (e.key === 'ArrowUp') next = (at - 1 + items.length) % items.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = items.length - 1;
      else if (e.key === 'Tab') this.#closeCamMenu(false);
      if (next >= 0) {
        e.preventDefault();
        items[next]?.focus();
      }
    });
    this.#camBtn.after(menu);
    this.#camMenu = menu;
    this.#camBtn.setAttribute('aria-expanded', 'true');
    (items[CAMERA_MODES.indexOf(this.#camera)] ?? items[0])?.focus();
    addEventListener('pointerdown', this.#onOutside, true);
  }

  #closeCamMenu(refocus: boolean): void {
    if (!this.#camMenu) return;
    this.#camMenu.remove();
    this.#camMenu = null;
    this.#camBtn.setAttribute('aria-expanded', 'false');
    removeEventListener('pointerdown', this.#onOutside, true);
    if (refocus) this.#camBtn.focus();
  }

  #onOutside = (e: PointerEvent): void => {
    const target = e.target as Node | null;
    if (!this.#camMenu || !target) return;
    if (this.#camMenu.contains(target) || this.#camBtn.contains(target)) return;
    this.#closeCamMenu(false);
  };

  #cycleSpeed(): void {
    const i = MATCH_SPEEDS.indexOf(this.#speed as (typeof MATCH_SPEEDS)[number]);
    this.#speed = MATCH_SPEEDS[(i + 1) % MATCH_SPEEDS.length] ?? 14;
    clear(this.#speedBtn);
    this.#speedBtn.append(icon('forward', 16), el('span', { text: `${this.#speed}×` }));
    this.#speedBtn.setAttribute('aria-label', `${t('match.speed')} ${this.#speed}×`);
    this.#client.setPace(this.#speed);
    this.#onSpeedChange?.(this.#speed);
    audio.tick();
  }

  // ---- chrome ------------------------------------------------------------------

  #buildHud(): void {
    const s = this.#engine.state;
    // Momentum lives UNDER the scoreboard now, home half on the left and away on the right,
    // filling toward whoever is on top in THEIR colour. As a hairline across the top edge
    // of the screen, always in our colour, it could not say whose way the game was going.
    this.#momentum = el('div', { class: 'tl-momentum', 'aria-hidden': 'true' }, [el('i')]);
    this.#scoreHome = el('span', { class: 'n', text: '0' });
    this.#scoreAway = el('span', { class: 'n', text: '0' });
    this.#clockEl = el('span', { class: 't', text: "0'" });
    this.#period = el('span', { class: 'p', text: t('match.half1') });

    const scoreboard = el('div', {
      class: 'tl-score', role: 'status', 'aria-label': t('match.score'),
    }, [
      el('span', { class: `side${this.#mine === 'home' ? ' mine' : ''}` }, [
        el('i', { style: `background:${kitCss(s.home.kitPrimary)}` }),
        el('span', { text: s.home.shortName }),
      ]),
      el('span', { class: 'goals' }, [this.#scoreHome, el('em', { text: '–' }), this.#scoreAway]),
      el('span', { class: `side${this.#mine === 'away' ? ' mine' : ''}` }, [
        el('span', { text: s.away.shortName }),
        el('i', { style: `background:${kitCss(s.away.kitPrimary)}` }),
      ]),
      el('span', { class: 'tl-clock' }, [this.#clockEl, this.#period]),
    ]);
    this.#momentum.style.setProperty('--home', kitCss(s.home.kitPrimary));
    this.#momentum.style.setProperty('--away', kitCss(s.away.kitPrimary));

    this.#playBtn = button('', () => this.#togglePause(), {
      class: 'tl-btn tl-sm tl-icon-only', icon: 'pause', 'aria-label': t('match.pause'),
    });
    this.#playBtn.setAttribute('data-tip', `${t('match.pause')} · Space`);
    this.#speedBtn = button(`${this.#speed}×`, () => this.#cycleSpeed(), {
      class: 'tl-btn tl-sm', icon: 'forward', 'aria-label': `${t('match.speed')} ${this.#speed}×`,
      tip: `${t('match.speed')} · F`,
    });
    this.#logBtn = button('', () => this.#openLog(), {
      class: 'tl-btn tl-sm tl-icon-only', icon: 'list', 'aria-label': t('match.log'),
    });
    this.#tacticsBtn = button('', () => this.#toggleDrawer(), {
      class: 'tl-btn tl-sm tl-icon-only', icon: 'sliders',
      'aria-label': t('match.tactics'), 'aria-expanded': 'false',
    });
    this.#tacticsBtn.setAttribute('data-tip', `${t('match.tactics')} · T`);
    this.#camBtn = button('', () => this.#toggleCamMenu(), {
      class: 'tl-btn tl-sm tl-cam-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
    });
    this.#paintCamBtn();

    const hud = el('div', { class: 'tl-hud' }, [
      el('div', { class: 'tl-scorewrap' }, [scoreboard, this.#momentum]),
      el('span', { class: 'tl-spacer' }),
      el('div', { class: 'tl-hud-btns' }, [
        // Three groups: how the match runs, what you are looking at, and the way out.
        el('div', { class: 'tl-hud-group' }, [this.#playBtn, this.#speedBtn]),
        el('div', { class: 'tl-hud-group tl-cam-wrap' }, [this.#camBtn]),
        el('div', { class: 'tl-hud-group' }, [this.#tacticsBtn, this.#logBtn]),
        button('', () => this.#onLeave(), {
          class: 'tl-btn tl-sm tl-icon-only', icon: 'back', 'aria-label': t('nav.back'),
        }),
      ]),
    ]);
    this.root.append(hud);
  }

  /**
   * The two things drawn over the picture that are not the HUD: a paused badge, which is
   * also the biggest resume button on the screen, and a TV-style caption naming the man
   * on the ball.
   */
  #buildOverlays(): void {
    this.#pausedBadge = button(t('match.paused'), () => {
      if (this.#paused) this.#togglePause();
    }, { class: 'tl-paused', icon: 'play', 'aria-label': t('match.play') });
    this.#pausedBadge.append(el('small', { text: t('match.resumeTap') }));
    this.#onBall = el('div', { class: 'tl-onball', 'aria-hidden': 'true' }, [
      el('i', { class: 'kit' }),
      el('b', { class: 'no' }),
      el('span', { class: 'nm' }),
    ]);
    this.root.append(this.#pausedBadge, this.#onBall);
  }

  /**
   * Where a thing at pitch position `x` sits across the frame, -1 to 1.
   *
   * Mirrored the same way the camera is, so the sound of a shot comes from the end of the
   * screen the shot is actually at. Getting the sign wrong is not loud, it is worse: it
   * quietly puts every sound on the wrong side and nobody can say why it feels off.
   */
  #panAt(x: number): number {
    const mirror = this.#mine === 'home' ? -1 : 1;
    return ((x / PITCH_LENGTH) * 2 - 1) * mirror;
  }

  #myTeam(): TeamSetup {
    return this.#mine === 'home' ? this.#engine.state.home : this.#engine.state.away;
  }

  /**
   * The eleven along the bottom, each with a stamina bar. This is the whole of §3's first
   * decision: a bar goes orange, you tap it, you tap a fresh face, the change happens on
   * the pitch. Not a word in it.
   */
  #buildStrip(): void {
    this.#strip = el('div', { class: 'tl-strip', role: 'group', 'aria-label': t('nav.squad') });
    this.root.append(this.#strip);
    this.#rebuildStrip();
  }

  /**
   * Build the chips from scratch. Only on a change of personnel — a substitution or a red
   * card. The previous version rebuilt the whole strip inside `#drawHud`, which runs every
   * frame: at 1× speed the tick number does not change between frames, so the `tick % 20`
   * guard fired for ten consecutive frames and threw away eleven buttons ten times over.
   * Anything a keyboard user had focused went with them.
   */
  #rebuildStrip(): void {
    clear(this.#strip);
    this.#chips = [];
    const team = this.#myTeam();
    const kit = kitCss(team.kitPrimary);
    const ink = inkOn(team.kitPrimary);
    for (const p of team.players) {
      if (!p.onPitch || p.sentOff) continue;
      const fill = el('i', { class: 'tl-bar-fill' });
      const chip = el('button', {
        class: `tl-chip${p.role === 'GK' ? ' gk' : ''}`,
        type: 'button',
        style: `--chip-kit:${kit};--chip-ink:${ink}`,
        'aria-label': `${p.shirt} ${p.name}`,
      }, [
        el('span', { class: 'no', text: String(p.shirt) }),
        el('span', { class: 'nm', text: shortName(p.name) }),
        el('span', { class: 'tl-bar' }, [fill]),
      ]);
      chip.addEventListener('click', () => this.#openSubs(p));
      this.#strip.append(chip);
      this.#chips.push({ root: chip, fill, player: p, tired: false });
    }
    this.#updateChips();
  }

  /** Move the bars. No DOM is created, nothing is replaced, focus survives. */
  #updateChips(): void {
    const owner = this.#engine.state.ball.ownerId;
    for (const chip of this.#chips) {
      // Which of ours has the ball, lit in the strip: the link between a face on the
      // bottom of the screen and a figure on the grass.
      chip.root.classList.toggle('on-ball', chip.player.id === owner);
      chip.root.classList.toggle('booked', chip.player.yellow > 0);
      const s = clamp01(chip.player.stamina);
      chip.fill.style.width = `${(s * 100).toFixed(0)}%`;
      chip.fill.className = `tl-bar-fill tone-${toneOf(s)}`;
      const tired = s < 0.55;
      if (tired !== chip.tired) {
        chip.tired = tired;
        chip.root.classList.toggle('tired', tired);
      }
    }
  }

  /** Two rows of faces and an arrow between them. */
  #openSubs(off: MatchPlayer): void {
    const team = this.#myTeam();
    const available = team.bench.filter((p) => !p.sentOff && !p.onPitch);
    const wasPaused = this.#paused;
    if (!wasPaused) this.#togglePause();

    const cards = el('div', { class: 'tl-rows' });
    const dialog = sheet({
      title: t('match.sub'),
      icon: 'sub',
      host: this.root,
      onClose: () => {
        if (!wasPaused && this.#paused) this.#togglePause();
      },
      body: [
        // Who is coming off, so the swap is a comparison and not a list.
        el('div', {
          style: 'display:flex;align-items:center;gap:12px;padding:12px 14px;margin-bottom:14px;'
            + 'border-radius:13px;background:rgba(255,255,255,0.05)',
        }, [
          el('span', {
            class: 'no',
            style: `width:34px;height:34px;border-radius:9px;display:grid;place-items:center;`
              + `font:800 16px/1 var(--tl-font);background:${kitCss(team.kitPrimary)};color:${inkOn(team.kitPrimary)}`,
            text: String(off.shirt),
          }),
          el('div', { style: 'display:grid;gap:5px;flex:1;min-width:0' }, [
            el('b', { text: off.name }),
            bar(off.stamina, { label: t('match.stamina'), tone: toneOf(off.stamina) }),
          ]),
          el('span', { class: 'tl-pill', text: t('match.comingOff') }),
        ]),
        heading(t('match.bench'), 'squad'),
        cards,
      ],
    });

    if (available.length === 0) {
      cards.append(el('div', { class: 'tl-empty' }, [emptyScene('thinSquad'), el('span', { text: t('match.benchEmpty') })]));
    }
    for (const on of available) {
      const item = el('button', { class: 'tl-row-item', type: 'button', 'aria-label': `${on.shirt} ${on.name}` }, [
        el('span', { class: 'rk', text: String(on.shirt) }),
        el('span', { class: 'who' }, [
          el('b', { text: on.name }),
          el('span', { class: 'meta' }, [el('span', { class: 'tl-pill tl-pos', text: on.role })]),
        ]),
        el('span', { class: 'end', style: 'width:92px' }, [
          bar(on.stamina, { label: t('match.stamina'), tone: toneOf(on.stamina) }),
        ]),
      ]);
      item.addEventListener('click', () => {
        if (this.#engine.substitute(this.#mine, off.id, on.id)) {
          this.#client.applyKits(this.#engine.state);
          this.#rebuildStrip();
          audio.applause();
          this.#pushTick(t('match.subMade', { off: shortName(off.name), on: shortName(on.name) }), 'sub');
        }
        dialog.close();
      });
      cards.append(item);
    }
  }

  /**
   * Everything that has happened, scrollable.
   *
   * The ticker is for the moment; this is for the question a kid actually asks, which is
   * "wait, when did they score?". Three lines that fade cannot answer it.
   */
  #openLog(): void {
    // One sheet at a time. Half time and full time both open by themselves, so the log can
    // otherwise end up stacked underneath one of them — two dialogs, one Escape key, and
    // no way to tell which is listening.
    if (this.root.querySelector('.tl-overlay')) return;
    const wasPaused = this.#paused;
    if (!wasPaused) this.#togglePause();
    logSheet(this.#log, this.root, () => {
      if (!wasPaused && this.#paused) this.#togglePause();
    });
  }

  /** Live tempo, pressing, line and intent — the levers whose effect is visible in seconds. */
  #toggleDrawer(): void {
    if (this.#drawer) {
      this.#drawer.remove();
      this.#drawer = null;
      this.#drawerMap?.dispose();
      this.#drawerMap = null;
      this.root.classList.remove('tl-drawer-open');
      this.#tacticsBtn.setAttribute('aria-expanded', 'false');
      this.#tacticsBtn.setAttribute('aria-pressed', 'false');
      return;
    }
    const team = this.#myTeam();
    const box = el('div', { class: 'tl-drawer', role: 'group', 'aria-label': t('match.tactics') });
    const levers: [StringKey, 'tempo' | 'pressing' | 'lineHeight' | 'attackingIntent', StringKey, StringKey][] = [
      ['tactics.tempo', 'tempo', 'tactics.slow', 'tactics.fast'],
      ['tactics.pressing', 'pressing', 'tactics.low', 'tactics.high'],
      ['tactics.line', 'lineHeight', 'tactics.deep', 'tactics.high'],
      ['tactics.intent', 'attackingIntent', 'tactics.cautious', 'tactics.bold'],
    ];
    for (const [label, field, lowKey, highKey] of levers) {
      const wordFor = (v: number): string => (v < 0.34 ? t(lowKey) : v > 0.66 ? t(highKey) : t('tactics.balanced'));
      const value = el('span', { class: 'val', text: wordFor(team.instructions[field]) });
      const input = el('input', {
        class: 'tl-range',
        type: 'range', min: 0, max: 100, step: 1,
        value: Math.round(team.instructions[field] * 100),
        'aria-label': t(label),
        style: `--pct:${Math.round(team.instructions[field] * 100)}%`,
      });
      input.addEventListener('input', () => {
        const v = Number(input.value) / 100;
        team.instructions[field] = v;
        value.textContent = wordFor(v);
        input.style.setProperty('--pct', `${Math.round(v * 100)}%`);
      });
      box.append(el('div', { class: 'tl-slider' }, [
        el('label', {}, [el('span', { text: t(label) }), value]),
        input,
      ]));
    }
    // The shape, above the levers that move it. Pushing the defensive line up and seeing
    // a back four step ten metres is design §6's "a lever whose effect a kid cannot see is
    // a lever that teaches nothing" — and from behind the goal you cannot see it.
    this.#drawerMap = new Minimap({ mine: this.#mine, width: 232, className: 'tl-minimap-inline' });
    this.#drawerMap.update(this.#engine.state);
    box.prepend(this.#drawerMap.root);
    this.root.append(box);
    this.#drawer = box;
    this.root.classList.add('tl-drawer-open');
    this.#tacticsBtn.setAttribute('aria-expanded', 'true');
    this.#tacticsBtn.setAttribute('aria-pressed', 'true');
  }

  // ---- the loop ----------------------------------------------------------------

  #frame = (now: number): void => {
    if (this.#disposed) return;
    this.#raf = requestAnimationFrame(this.#frame);
    const dt = Math.min((now - this.#last) / 1000, 0.25);
    this.#last = now;
    if (document.hidden) return;

    const state = this.#engine.state;
    if (!this.#paused && !state.finished) {
      this.#acc += dt * this.#speed;
      let steps = 0;
      while (this.#acc >= TICK && steps < MAX_STEPS) {
        this.#acc -= TICK;
        steps++;
        this.#advance();
        this.#client.captureTick(state);
        if (state.play.kind === 'halfTime' && !this.#halfTimeShown) break;
      }
      if (steps === MAX_STEPS) this.#acc = 0;
    }

    this.#speak(state, dt);

    // Everything below this line is the picture, and a detached match has no picture: the
    // WebGL draw, the HUD writes and the two minimaps are all skipped, which is what makes
    // a match running behind the club screen cost almost nothing. Everything ABOVE it —
    // the engine, the commentary, the log — keeps going on purpose. That is the difference
    // between leaving a match and ending one.
    //
    // The commentator is above the line as well as the engine, deliberately: the voice
    // option is the only thing that tells a kid on the transfer screen that a goal has just
    // gone in, and silencing it would make leaving feel like stopping.
    if (!this.#attached) {
      this.#checkBreaks(state);
      return;
    }

    this.#client.frame(state, dt, this.#acc / TICK);
    if (!this.#paused) this.#maybeWave(state, dt);
    this.#drawHud(state);
    this.#minimap.update(state, dt);
    this.#drawerMap?.update(state, dt);

    // The ball landing. There is no event for it — bouncing is something the physics does
    // between ticks rather than something the engine decides — so it is read off the sign
    // flip in the vertical speed.
    const vz = state.ball.vz;
    if (audio.enabled && this.#lastBallVz < -1.4 && vz > 0.2) {
      audio.bounce(Math.min(-this.#lastBallVz / 9, 1), this.#panAt(state.ball.x));
    }
    this.#lastBallVz = vz;

    if (audio.enabled) {
      const danger = dangerOf(state.ball.x, state.ball.y);
      const support = this.#mine === 'home' ? state.momentum : -state.momentum;
      audio.update(danger, support, dt);
    }

    if (this.#autoQuality) {
      const tier = this.#governor.update(dt);
      if (tier !== null) this.#client.applyTier(tier);
    }

    this.#checkBreaks(state);
  };

  /**
   * The two breaks, checked whether or not anybody is watching.
   *
   * Detached, half time does NOT open its panel. The panel pauses the match, and pausing a
   * match nobody is looking at would stop the clock on the club screen with nothing on
   * screen to say why — the host is told instead, and can put it in a toast. Full time
   * fires either way: a match always has to finish, in view or not.
   */
  #checkBreaks(state: MatchState): void {
    if (state.play.kind === 'halfTime' && !this.#halfTimeShown && !state.finished) {
      this.#halfTimeShown = true;
      if (this.#attached) this.#showHalfTime(state);
      else this.#onHalfTime?.(state);
    }
    this.#finishCheck(state);
  }

  /** Full time, once, however the match got there. */
  #finishCheck(state: MatchState): void {
    if (!state.finished || this.#finished) return;
    this.#finished = true;
    audio.whistle('long');
    this.#onFinished(state);
  }

  /** One line per frame at most, chosen from everything that happened. */
  #speak(state: MatchState, dt: number): void {
    this.#commentator.tick(dt);
    if (this.#tickEvents.length === 0) return;
    const line = this.#commentator.feed(state, this.#tickEvents);
    this.#tickEvents = [];
    if (!line || this.#commentary === 'off') return;
    // The log gets everything; the ticker gets what there is time to read.
    this.#log.push(line);
    if (!this.#commentator.worthShowing(line)) return;
    const text = t(line.key, line.params);
    this.#pushLine(text, line.kind, line.minute);
    if (this.#commentary === 'voice' && line.priority >= 40) this.#voice.say(text);
  }

  #onEvent(e: MatchEvent): void {
    this.#client.handleEvent(e);
    const mine = 'side' in e ? e.side === this.#mine : false;
    const minute = Math.min(Math.floor(this.#engine.state.clock / 60), 120);
    this.#crowdHears(e);

    switch (e.type) {
      case 'goal': {
        const scorer = this.#find(e.by);
        audio.goal(mine !== e.ownGoal);
        // The home end celebrates a goal for the home side, whoever you manage.
        if ((e.side === 'home') !== e.ownGoal) audio.homeGoal();
        this.#goalFlash(e.side, mine !== e.ownGoal);
        this.#pushTick(
          t('match.goalBy', { name: scorer ? shortName(scorer.name) : '', min: minute }),
          'goal',
        );
        // Cut to the grass for the celebration, unless the viewer asked for less motion —
        // or is not watching, in which case the camera would cut back before anyone saw it.
        // The render client decides whether the chosen camera allows it: TV and main do.
        if (!this.#reducedMotion && this.#attached) this.#client.cutaway('ground', 4.2);
        break;
      }
      case 'shot': {
        const pan = this.#panAt(this.#engine.state.ball.x);
        audio.kickBall(0.85, pan);
        audio.ballFx(0.9, pan);
        // The crowd's answer — a breath in, then an "ooh", a groan or a roar once the ball
        // has decided — is #crowdHears's. This used to play the near-miss "ooh" on every
        // shot at the moment it was struck, including the ones that went in.
        break;
      }
      case 'save':
        audio.save();
        this.#pushTick(t('match.saveBy', { min: minute }), 'save');
        break;
      case 'post':
        audio.post(this.#panAt(this.#engine.state.ball.x));
        this.#pushTick(t('match.post', { min: minute }), 'post');
        break;
      case 'pass':
        audio.kickBall(e.long ? 0.55 : 0.24, this.#panAt(this.#engine.state.ball.x));
        if (e.long) audio.ballFx(0.5, this.#panAt(this.#engine.state.ball.x));
        break;
      case 'foul':
        audio.whistle('short');
        if (e.card !== 'none') {
          const who = this.#find(e.by);
          this.#pushTick(
            t(e.card === 'red' ? 'match.redCard' : 'match.yellowCard', {
              name: who ? shortName(who.name) : '', min: minute,
            }),
            'card',
          );
        }
        if (e.card === 'red') this.#rebuildStrip();
        break;
      case 'substitution':
        this.#rebuildStrip();
        break;
      case 'injury': {
        const who = this.#find(e.playerId);
        if (e.side === this.#mine) {
          this.#pushTick(t('match.injury', { name: who ? shortName(who.name) : '', min: minute }), 'injury');
        }
        break;
      }
      case 'penaltyAwarded':
        audio.whistle('short');
        this.#pushTick(t('match.penalty', { min: minute }), 'penalty');
        break;
      case 'halfTime':
      case 'fullTime':
        audio.whistle('long');
        break;
      default:
        break;
    }
  }

  /**
   * The home crowd hears everything, whether or not anyone is watching the picture — the
   * sound carries on when the match screen is detached, same as the commentary.
   */
  #crowdHears(e: MatchEvent): void {
    const s = this.#engine.state;
    if (e.type === 'save' || e.type === 'goal' || e.type === 'kickoff') this.#shotSide = null;
    if (s.clock - this.#shotAt > 6) this.#shotSide = null;
    const reactions = crowdReaction(e, {
      home: 'home',
      danger: dangerOf(s.ball.x, s.ball.y),
      score: s.score,
      recentShot: this.#shotSide,
    });
    if (e.type === 'shot') {
      this.#shotSide = e.side;
      this.#shotAt = s.clock;
    } else if (e.type === 'goalKick' || e.type === 'corner') {
      this.#shotSide = null;
    }
    for (const r of reactions) {
      if (audio.enabled) audio.crowd(r);
      if (this.#attached) this.#client.crowdReact(standLift(r));
    }
  }

  /**
   * A Mexican wave, now and then: only in a lull, only when the home side is on top, and
   * never for a viewer who asked for less motion. A wave during an attack is a crowd not
   * watching the match.
   */
  #maybeWave(state: MatchState, dt: number): void {
    this.#waveIn -= dt;
    if (this.#waveIn > 0 || this.#reducedMotion || state.play.kind !== 'open') return;
    const calm = dangerOf(state.ball.x, state.ball.y) < 0.15;
    const onTop = state.momentum > 0.2 || state.score.home > state.score.away;
    if (!calm || !onTop) {
      this.#waveIn = 5;
      return;
    }
    this.#waveIn = 150 + Math.random() * 120;
    this.#client.crowdWave(6.5);
    if (audio.enabled) audio.wave(6.5);
  }

  #find(id: number): MatchPlayer | null {
    const s = this.#engine.state;
    for (const team of [s.home, s.away]) {
      for (const p of [...team.players, ...team.bench]) if (p.id === id) return p;
    }
    return null;
  }

  /** A goal: a full-screen wash in the scoring club's colour (design §D). */
  #goalFlash(side: Side, mine: boolean): void {
    if (!this.#attached) return;
    const team = side === 'home' ? this.#engine.state.home : this.#engine.state.away;
    const flash = el('div', {
      class: 'tl-flash',
      style: `--flash:${kitCss(team.kitPrimary)}`,
      'aria-hidden': 'true',
    }, [
      el('span', { class: 'word', text: mine ? t('match.goal') : '' }),
    ]);
    this.root.append(flash);
    setTimeout(() => flash.remove(), 2200);
  }

  /** A commentary line, which carries its own minute. */
  #pushLine(text: string, kind: string, minute: number): void {
    if (!text) return;
    const node = el('div', { class: `tl-tick ${kind}` }, [
      el('span', { class: 'min', text: `${minute}'` }),
      el('span', { text }),
    ]);
    this.#ticker.append(node);
    while (this.#ticker.childElementCount > TICKER_MAX) this.#ticker.firstElementChild?.remove();
    setTimeout(() => node.remove(), 8500);
  }

  /** One line of what just happened. Three at a time, oldest falls off. */
  #pushTick(text: string, kind: string): void {
    if (!text) return;
    const minute = Math.min(Math.floor(this.#engine.state.clock / 60), 120);
    const node = el('div', { class: `tl-tick ${kind}` }, [
      el('span', { class: 'min', text: `${minute}'` }),
      el('span', { text }),
    ]);
    this.#ticker.append(node);
    while (this.#ticker.childElementCount > TICKER_MAX) this.#ticker.firstElementChild?.remove();
    setTimeout(() => node.remove(), 7000);
  }

  /**
   * Half time. Design §3 promised the break opens onto the shape editor; what it opens
   * onto here is the two numbers that say why the half went the way it did, and the same
   * four levers, because the shape editor is a whole screen and this is a break.
   */
  #showHalfTime(state: MatchState): void {
    const wasPaused = this.#paused;
    if (!wasPaused) this.#togglePause();
    const total = state.possessionTicks.home + state.possessionTicks.away || 1;
    const mineTeam = this.#mine === 'home' ? 'home' : 'away';
    const possession = Math.round((state.possessionTicks[mineTeam] / total) * 100);

    const dialog = sheet({
      title: t('match.halfTime'),
      icon: 'whistle',
      host: this.root,
      onClose: () => {
        if (!wasPaused && this.#paused) this.#togglePause();
      },
      body: [
        scoreLine(state),
        el('div', { class: 'tl-stats', style: 'margin:16px 0' }, [
          stat(t('match.possession'), `${possession}`, { hot: true, sup: '%' }),
          stat(t('match.shots'), String(state.shots[mineTeam])),
          stat(t('match.onTarget'), String(state.shotsOnTarget[mineTeam])),
          stat(t('match.corners'), String(state.corners[mineTeam])),
        ]),
        el('p', { class: 'tl-lede', style: 'margin:0', text: t('match.halfTimeHint') }),
      ],
      foot: [
        button(t('match.changeShape'), () => {
          dialog.close();
          if (!this.#drawer) this.#toggleDrawer();
        }, { class: 'tl-btn tl-ghost', icon: 'sliders', style: 'flex:1' }),
        button(t('match.secondHalf'), () => dialog.close(), {
          class: 'tl-btn tl-primary', icon: 'play', style: 'flex:1',
        }),
      ],
    });
  }

  /**
   * Full time. The panel itself is a free function below, because the club screen shows it
   * again later, after this object has been disposed.
   */
  showFullTime(onClose: () => void, onLog?: () => void): void {
    fullTimeSheet({ state: this.#engine.state, host: this.root, onClose, onLog });
  }

  #drawHud(state: MatchState): void {
    // The number that just changed gets a bump, so a goal scored while you were looking
    // at the other end of the screen still shows up on the scoreboard as a movement.
    for (const [side, node] of [['home', this.#scoreHome], ['away', this.#scoreAway]] as const) {
      const n = state.score[side];
      if (n === this.#lastScore[side]) continue;
      this.#lastScore[side] = n;
      node.textContent = String(n);
      node.classList.remove('bump');
      void node.offsetWidth;
      node.classList.add('bump');
    }

    const minute = Math.min(Math.floor(state.clock / 60), 120);
    const regulation = state.period === 'first' ? 45 : 90;
    const over = minute > regulation;
    const text = state.finished
      ? t('match.fullTimeShort')
      : over ? `${regulation}+${minute - regulation}'` : `${minute}'`;
    // Only touch the DOM when the string actually changes. At 40× the clock moves every
    // frame; at 1× it moves every tenth of a second, and writing it sixty times a second
    // either way is sixty layout invalidations for no pixels.
    if (text !== this.#lastClockText) {
      this.#lastClockText = text;
      this.#clockEl.textContent = text;
      this.#clockEl.parentElement?.classList.toggle('stoppage', over);
      this.#period.textContent = state.finished ? '' : t(state.period === 'first' ? 'match.half1' : 'match.half2');
    }

    // Momentum: a bar growing from the centre toward whoever is on top — left for the
    // home side, right for the away side, in that side's colour, matching the scoreboard
    // above it.
    const m = state.momentum; // home-positive, -1..1
    const fill = this.#momentum.firstElementChild as HTMLElement | null;
    if (fill) {
      const half = Math.abs(m) * 50;
      fill.style.left = m >= 0 ? `${50 - half}%` : '50%';
      fill.style.right = m >= 0 ? '50%' : `${50 - half}%`;
      fill.style.background = m >= 0 ? 'var(--home)' : 'var(--away)';
    }
    this.#drawOnBall(state);
    this.#updateChips();
  }

  /**
   * The caption naming who has the ball. Only written when the man changes; hidden for a
   * loose ball, except under the player camera, which is always following SOMEBODY and
   * should say who.
   */
  #drawOnBall(state: MatchState): void {
    const owner = state.ball.ownerId;
    const id = owner >= 0 ? owner : this.#client.liveShot === 'player' ? this.#client.focusId : -1;
    const show = id >= 0 && state.play.kind !== 'halfTime' && !state.finished;
    const want = show ? id : -1;
    if (want === this.#onBallId) return;
    this.#onBallId = want;
    const p = want >= 0 ? this.#find(want) : null;
    this.#onBall.classList.toggle('on', !!p);
    if (!p) return;
    const team = p.side === 'home' ? state.home : state.away;
    const [kit, no, nm] = this.#onBall.children as unknown as [HTMLElement, HTMLElement, HTMLElement];
    kit.style.background = kitCss(team.kitPrimary);
    no.textContent = String(p.shirt);
    nm.textContent = shortName(p.name);
    this.#onBall.classList.toggle('mine', p.side === this.#mine);
  }
}

/** The two crest-coloured bars and the score between them, used by every break screen. */
function scoreLine(state: MatchState): HTMLElement {
  return el('div', { class: 'tl-vs' }, [
    el('div', { class: 't' }, [
      el('i', { style: `display:block;width:38px;height:6px;border-radius:99px;background:${kitCss(state.home.kitPrimary)}` }),
      el('b', { text: state.home.shortName }),
    ]),
    el('b', {
      style: 'font:800 40px/1 var(--tl-font);letter-spacing:-0.04em;font-variant-numeric:tabular-nums',
      text: `${state.score.home}–${state.score.away}`,
    }),
    el('div', { class: 't' }, [
      el('i', { style: `display:block;width:38px;height:6px;border-radius:99px;background:${kitCss(state.away.kitPrimary)}` }),
      el('b', { text: state.away.shortName }),
    ]),
  ]);
}

/**
 * Everything that has happened, scrollable.
 *
 * The ticker is for the moment; this is for the question a kid actually asks, which is
 * "wait, when did they score?". Three lines that fade cannot answer it.
 *
 * A free function rather than a method because the club screen offers it after full time,
 * by which point the MatchScreen is gone. `Line[]` is plain data and outlives it — which is
 * also what fixes the version of this that shipped: the full-time panel's log button closed
 * the panel (disposing the screen, which removes `root` from the document) and then mounted
 * the log inside that removed node, so it opened onto nothing at all.
 */
export function logSheet(lines: readonly Line[], host: HTMLElement, onClose?: () => void): void {
  const rows = el('div', { class: 'tl-log', role: 'log' });
  if (lines.length === 0) {
    rows.append(el('div', { class: 'tl-empty' }, [emptyScene('nothingYet'), el('span', { text: t('match.logEmpty') })]));
  }
  for (const line of lines) {
    rows.append(el('div', { class: `tl-tick ${line.kind}${line.mine ? ' mine' : ''}` }, [
      el('span', { class: 'min', text: `${line.minute}'` }),
      el('span', { text: t(line.key, line.params) }),
    ]));
  }
  sheet({ title: t('match.log'), icon: 'list', host, onClose, body: [rows] });
  // Newest at the bottom, and that is where a reader wants to start.
  rows.scrollTop = rows.scrollHeight;
}

export interface FullTimeOptions {
  state: MatchState;
  host: HTMLElement;
  onClose: () => void;
  /** The match log, opened AFTER this panel has closed. Omitted when there is none. */
  onLog?: (() => void) | undefined;
}

/**
 * Full time, as a picture rather than a stat table (design §8): the score, a possession
 * bar split between the two clubs' colours, and shots as counts either side of it.
 *
 * Free-standing for the same reason `logSheet` is: a match finished while the player was on
 * another screen still has to be showable afterwards, and by then there is no MatchScreen.
 * `MatchState` is plain data and survives its disposal.
 */
export function fullTimeSheet(opts: FullTimeOptions): void {
  const state = opts.state;
  const total = state.possessionTicks.home + state.possessionTicks.away || 1;
  const homeShare = Math.round((state.possessionTicks.home / total) * 100);
  const rows: [StringKey, number, number][] = [
    ['match.shots', state.shots.home, state.shots.away],
    ['match.onTarget', state.shotsOnTarget.home, state.shotsOnTarget.away],
    ['match.corners', state.corners.home, state.corners.away],
    ['match.fouls', state.fouls.home, state.fouls.away],
  ];

  const compare = el('div', { style: 'display:grid;gap:12px' });
  for (const [key, h, a] of rows) {
    const sum = h + a || 1;
    compare.append(el('div', { style: 'display:grid;gap:5px' }, [
      el('div', { style: 'display:flex;justify-content:space-between;font-size:12.5px' }, [
        el('b', { style: 'font-variant-numeric:tabular-nums', text: String(h) }),
        el('span', { class: 'tl-muted', style: 'font-size:11px;letter-spacing:0.08em;text-transform:uppercase', text: t(key) }),
        el('b', { style: 'font-variant-numeric:tabular-nums', text: String(a) }),
      ]),
      el('div', { style: 'display:flex;gap:3px;height:6px' }, [
        el('i', {
          style: `flex:${h};border-radius:99px;background:${kitCss(state.home.kitPrimary)};min-width:2px`,
        }),
        el('i', {
          style: `flex:${a};border-radius:99px;background:${kitCss(state.away.kitPrimary)};min-width:2px;opacity:0.85`,
        }),
        el('i', { style: sum === 1 && h + a === 0 ? 'flex:1;border-radius:99px;background:rgba(255,255,255,0.08)' : 'display:none' }),
      ]),
    ]));
  }

  const { close: closeSheet } = sheet({
    title: t('match.fullTime'),
    icon: 'whistle',
    host: opts.host,
    // The header's close button has to do the same thing as the footer's button. The
    // match is over: dismissing this panel any other way leaves a kid looking at a
    // frozen pitch with no way off it, which is exactly the dead end design §8 forbids.
    onClose: opts.onClose,
    body: [
      scoreLine(state),
      el('div', { style: 'margin:18px 0 6px' }, [heading(t('match.possession'), 'ball')]),
      el('div', { style: 'display:flex;gap:3px;height:12px;margin-bottom:6px' }, [
        el('i', { style: `flex:${homeShare};border-radius:99px;background:${kitCss(state.home.kitPrimary)}` }),
        el('i', { style: `flex:${100 - homeShare};border-radius:99px;background:${kitCss(state.away.kitPrimary)};opacity:0.85` }),
      ]),
      el('div', { style: 'display:flex;justify-content:space-between;margin-bottom:20px;font:700 12px/1 var(--tl-font);font-variant-numeric:tabular-nums' }, [
        el('span', { text: `${homeShare}%` }),
        el('span', { text: `${100 - homeShare}%` }),
      ]),
      compare,
    ],
    foot: [
      opts.onLog
        ? button(t('match.log'), () => {
          // Close first, then hand over. Closing runs `onClose`, which is what tears the
          // match down — the log has to be mounted by whoever is still standing after it.
          closeSheet();
          opts.onLog?.();
        }, { class: 'tl-btn tl-ghost', icon: 'list', style: 'flex:1' })
        : null,
      // Closing the sheet already runs `onClose`, so this button only has to close it.
      button(t('match.toClub'), () => closeSheet(), { class: 'tl-btn tl-primary', icon: 'club', style: 'flex:1' }),
    ],
  });
}

/** "Rasmus Ostergaard" in nine characters of chip. Surname, because that is what a shirt says. */
function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? (parts[parts.length - 1] as string) : name;
}
