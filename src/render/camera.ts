// The broadcast camera.
//
// With no commentary and no text, the camera IS the commentary (design §7a): it decides
// what the viewer is told to look at, and its push-in is how a move reads as dangerous
// before anything has happened. Everything is damped per-axis with the frame-rate
// independent `damp` from core/math, so it behaves identically at 30fps and 144.

import * as THREE from 'three';
import { angleDelta, clamp, clamp01, damp, invLerp, lerp } from '../core/math.js';
import { PITCH_LENGTH, PITCH_WIDTH } from '../sim/match/pitch.js';
import { toSceneX, toSceneZ } from './pitch.js';
import {
  BOWL_HALF_LENGTH,
  BOWL_HALF_WIDTH,
  STAND_DEPTH,
  STAND_HEIGHT,
  WALL_HEIGHT,
} from './stadium.js';

export type CameraPreset = 'broadcast' | 'tactical' | 'behindGoal' | 'ground' | 'follow' | 'player';

/**
 * What the viewer picks. Every preset, plus 'tv': the director (director.ts) choosing
 * between them live, the way a broadcast does.
 */
export type CameraMode = 'tv' | CameraPreset;

/** The order the camera button offers them, and the order C cycles through. */
export const CAMERA_MODES: readonly CameraMode[] = ['tv', 'broadcast', 'follow', 'player', 'behindGoal', 'tactical', 'ground'];

export function isCameraMode(v: unknown): v is CameraMode {
  return typeof v === 'string' && (CAMERA_MODES as readonly string[]).includes(v);
}

export interface CameraTarget {
  /** Where the action is, in simulation coordinates. */
  ballX: number;
  ballY: number;
  ballZ: number;
  /** Ball velocity, simulation coordinates, m/s. The follow camera leads with it. */
  ballVX?: number;
  ballVY?: number;
  /** 0..1 — how close this is to being a chance. Drives the push-in. */
  danger: number;
  /**
   * The player the player camera rides behind — the man on the ball, or the one about to
   * be — in simulation coordinates, and the direction (radians, sim frame) it should look.
   * Absent before the first frame has a figure to follow.
   */
  focusX?: number;
  focusY?: number;
  focusHeading?: number;
}

// `back` is measured from the STAND FRONT (the edge of the grass rectangle), positive
// away from the pitch, and every preset has to clear the geometry between it and the
// football. The bowl is imported rather than retyped, because a camera placed against
// remembered numbers is a camera that ends up inside a roof the next time the stadium
// changes — and this file's presets were all placed against a stadium that no longer
// exists.
//
// The seating deck at distance `d` behind the front is `WALL_HEIGHT + d·tan(rake)` high;
// the roof underside is a flat ROOF_HEIGHT over the back ROOF_DEPTH metres. Every
// `height` below clears both along the whole sight line to the centre spot.
const RAKE = Math.atan2(STAND_HEIGHT, STAND_DEPTH);

const PRESETS: Record<CameraPreset, { height: number; back: number; lag: number; fov: number; tilt: number }> = {
  // The main camera: at the halfway line, up and behind the near side stand.
  //
  // The distance is not taste. A camera `back` metres behind the stand front, `height`
  // up, looking at the centre spot, sees the near touchline at atan(h / (bowl+back−34))
  // below horizontal and the far one at atan(h / (bowl+back+34)); the difference has to
  // fit inside the vertical field of view or one touchline is off screen. At 25/25 that
  // span is 23°, comfortably inside 32°, and the far stand's roof line lands a fraction
  // under the top edge — which is the framing every televised match has.
  //
  // The version before this sat at back 12, where the span is 37° against a 32° lens:
  // the near half of the pitch was simply not in shot, in every screenshot ever taken.
  broadcast: { height: 25, back: 25, lag: 0.62, fov: 32, tilt: 0.0 },
  // Near-overhead. The whole pitch has to fit: 68 metres of width across a 42-degree
  // vertical field needs about a hundred metres of distance, which is where these come
  // from rather than from taste.
  tactical: { height: 84, back: 6, lag: 0.5, fov: 42, tilt: 0.0 },
  // From behind whichever goal the ball is nearer, high in the end stand and just in
  // front of the roof's leading edge.
  behindGoal: { height: 16, back: 12, lag: 0.55, fov: 34, tilt: 0.0 },
  // Pitch-side and low, for replays and goals. NEGATIVE back: in front of the hoardings,
  // on the grass surround, not buried in the terrace behind them.
  ground: { height: 2.3, back: -3.2, lag: 0.78, fov: 30, tilt: 0.012 },
  // The ball camera: lower and much closer than the main camera, and it TRUCKS — runs
  // along the touchline with the play — rather than panning from halfway. The main
  // camera cannot do that (see the note in `update`), but this one is allowed to because
  // it never gets near an end stand: its x is clamped inside the goal lines, and `back`
  // is short enough that at 12 metres up it sits over the seating deck's front rows and
  // well in front of the roof. Tracking in and out with the ball as well keeps the
  // distance constant, which is the whole point of a close camera.
  follow: { height: 12, back: 24, lag: 0.7, fov: 38, tilt: 0.0 },
  // Over the shoulder of the man on the ball, looking the way his team attacks.
  // `back` here is metres behind HIM, not behind a stand.
  player: { height: 4.2, back: 8.5, lag: 0.8, fov: 50, tilt: 0.0 },
};

/** How far behind the stand front the follow camera may go. The roof starts at 12. */
const FOLLOW_MAX_BACK = 8;
/** How far ahead of the player the player camera looks. */
const PLAYER_AHEAD = 11;

/** Height of the seating deck `d` metres behind the stand front. For the placement note. */
export function deckHeightAt(d: number): number {
  return d <= 0 ? 0 : WALL_HEIGHT + d * Math.tan(RAKE);
}

export class BroadcastCamera {
  readonly camera: THREE.PerspectiveCamera;
  #preset: CameraPreset = 'broadcast';
  /** Smoothed point the camera is looking at, in scene space. */
  #lookX = 0;
  #lookZ = 0;
  #lookY = 0;
  #fov = 34;
  #shake = 0;
  #shakePhase = 0;
  /** Which side of the pitch the camera sits on; flipped by `mirror`. */
  #side = -1;
  #reducedMotion = false;
  #aspectGain = 1;
  /** The next update is a cut: every smoothed value jumps straight to its target. */
  #snap = true;
  /** Player camera: the smoothed man it rides behind (scene space) and its heading. */
  #focusX = 0;
  #focusZ = 0;
  #yaw = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(34, aspect, 0.5, 900);
    this.camera.position.set(0, 26, -46);
  }

  /** Change camera. A change is always a hard cut, never a glide between two framings. */
  setPreset(p: CameraPreset): void {
    if (p !== this.#preset) this.#snap = true;
    this.#preset = p;
  }

  get preset(): CameraPreset {
    return this.#preset;
  }

  /** Calm the camera for a viewer who asked for less motion (design §D). */
  setReducedMotion(on: boolean): void {
    this.#reducedMotion = on;
    if (on) this.#shake = 0;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    // On a narrow frame a vertical field of view tuned for a laptop shows a strip of pitch
    // about twenty metres wide, so the vertical angle widens as the aspect narrows and the
    // HORIZONTAL view — the one the football actually happens across — stays roughly
    // constant.
    //
    // Capped at 1.45 rather than the 1.9 it used to be. Past about that the lens is wide
    // enough to put the near stand's roof, the sky and forty metres of grass at the
    // camera's own feet in the same frame, and the pitch becomes a small trapezium in the
    // middle of a fisheye. The real answer for a phone held upright is the letterbox in
    // styles.ts, which keeps the canvas near 1.15 and never asks this for more than 1.3.
    this.#aspectGain = aspect < 1.5 ? Math.min(1.45, 1.5 / Math.max(aspect, 0.35)) : 1;
    this.camera.updateProjectionMatrix();
  }

  /** A goal, a save, a crunching tackle. Ignored under reduced motion. */
  kick(strength: number): void {
    if (this.#reducedMotion) return;
    this.#shake = Math.min(1, this.#shake + strength);
  }

  /** Which touchline the camera watches from. */
  mirror(side: -1 | 1): void {
    this.#side = side;
  }

  update(target: CameraTarget, frameDt: number): void {
    const cfg = PRESETS[this.#preset];
    // On a cut every damp below closes the whole gap in one step. A cut that eased in
    // would read as a slow swoop across the stadium, which is exactly what a cut is not.
    const dt = this.#snap ? 1e3 : frameDt;
    this.#snap = false;
    if (this.#preset === 'player') {
      this.#updatePlayer(target, cfg, dt, frameDt);
      return;
    }
    if (this.#preset === 'follow') {
      this.#updateFollow(target, cfg, dt, frameDt);
      return;
    }
    const tx = toSceneX(target.ballX);
    const tz = toSceneZ(target.ballY);

    // The look-at point trails the ball. A camera locked to the ball is unwatchable —
    // it makes the world move rather than the ball, and it is the single most common
    // mistake in a first football camera.
    const lag = this.#reducedMotion ? cfg.lag * 0.6 : cfg.lag;
    // Clamped inside the goal lines. Left free, the look point follows the ball into the
    // corner, the camera swings round with it, and half the frame is the end stand.
    this.#lookX = damp(this.#lookX, clamp(tx, -PITCH_LENGTH * 0.42, PITCH_LENGTH * 0.42), lag * 4.2, dt);
    // Across the pitch the look point barely moves, and it sits a few metres to the
    // camera's OWN side of wherever the ball is.
    //
    // Both halves matter. At 0.55 the point swung far enough that a ball on the far
    // touchline tilted the camera up until the near touchline left the bottom of the
    // frame entirely — most visible on an ultrawide window, where the vertical field of
    // view is doing the least work. The near bias then buys that touchline back: it costs
    // a couple of degrees of far stand, which the frame has plenty of.
    const nearBias = this.#preset === 'behindGoal' ? 0 : this.#side * 5;
    this.#lookZ = damp(this.#lookZ, tz * 0.38 + nearBias, lag * 3.0, dt);
    this.#lookY = damp(this.#lookY, Math.min(target.ballZ * 0.35, 3), 5, dt);

    // Push in when it gets dangerous: narrower field of view, camera a little lower.
    const danger = this.#reducedMotion ? 0 : clamp01(target.danger);
    this.#setFov(cfg.fov - danger * 6, dt);

    let px: number;
    let py: number;
    let pz: number;
    if (this.#preset === 'behindGoal') {
      // Behind whichever goal the ball is nearer to. `back` is measured from the end
      // stand's front, so the camera is genuinely in the terrace behind the goal.
      const end = target.ballX > PITCH_LENGTH / 2 ? 1 : -1;
      px = end * (BOWL_HALF_LENGTH + cfg.back);
      py = cfg.height;
      pz = this.#lookZ * 0.3;
    } else {
      // A real main camera sits near the halfway line and PANS; it does not run up and
      // down the touchline. Tracking the ball laterally is both wrong and actively
      // broken — slide far enough toward a corner and the end stand ends up between the
      // camera and the football.
      px = clamp(this.#lookX * 0.34, -22, 22);
      py = cfg.height - danger * (cfg.height > 10 ? 3.5 : 0);
      pz = this.#side * (BOWL_HALF_WIDTH + cfg.back);
    }

    this.camera.position.set(px, py, pz);
    this.#applyShake(frameDt);
    this.camera.lookAt(this.#lookX, this.#lookY + 1.2, this.#lookZ);
    if (cfg.tilt) this.camera.rotateZ(cfg.tilt);
  }

  /** Shake decays in real time, whether or not this frame was a cut. */
  #applyShake(dt: number): void {
    if (this.#shake <= 0.001) return;
    this.#shakePhase += dt * 42;
    const a = this.#shake * 0.55;
    this.camera.position.x += Math.sin(this.#shakePhase) * a;
    this.camera.position.y += Math.sin(this.#shakePhase * 1.7) * a * 0.6;
    this.#shake = damp(this.#shake, 0, 3.4, dt);
  }

  #setFov(want: number, dt: number): void {
    this.#fov = damp(this.#fov, want, 2.2, dt);
    this.camera.fov = Math.min(this.#fov * this.#aspectGain, 88);
    this.camera.updateProjectionMatrix();
  }

  /**
   * The ball camera. The look point LEADS the ball a little along its velocity — a close
   * camera that trails the ball spends every long pass with the ball at the edge of the
   * frame — and the camera sits a fixed distance to its own side of that point.
   */
  #updateFollow(target: CameraTarget, cfg: (typeof PRESETS)['follow'], dt: number, frameDt: number): void {
    const vx = target.ballVX ?? 0;
    const vy = target.ballVY ?? 0;
    const lag = this.#reducedMotion ? cfg.lag * 0.6 : cfg.lag;
    const wantX = clamp(toSceneX(target.ballX) + clamp(vx * 0.45, -7, 7), -PITCH_LENGTH / 2, PITCH_LENGTH / 2);
    const wantZ = toSceneZ(target.ballY) + clamp(vy * 0.25, -4, 4);
    this.#lookX = damp(this.#lookX, wantX, lag * 4.5, dt);
    this.#lookZ = damp(this.#lookZ, wantZ, lag * 4.0, dt);
    this.#lookY = damp(this.#lookY, Math.min(target.ballZ * 0.5, 4), 5, dt);

    const danger = this.#reducedMotion ? 0 : clamp01(target.danger);
    this.#setFov(cfg.fov - danger * 5, dt);

    const reach = BOWL_HALF_WIDTH + FOLLOW_MAX_BACK;
    const pz = clamp(this.#lookZ + this.#side * cfg.back, -reach, reach);
    this.camera.position.set(this.#lookX, cfg.height, pz);
    this.#applyShake(frameDt);
    this.camera.lookAt(this.#lookX, this.#lookY + 0.8, this.#lookZ);
  }

  /**
   * Over the shoulder. The heading is smoothed as an ANGLE, so a player who turns round
   * swings the camera round behind him rather than through him, and the focus position is
   * smoothed as well so that a pass from one man to the next is a glide down the line of
   * the pass, not a jump.
   */
  #updatePlayer(target: CameraTarget, cfg: (typeof PRESETS)['player'], dt: number, frameDt: number): void {
    const fx = toSceneX(target.focusX ?? target.ballX);
    const fz = toSceneZ(target.focusY ?? target.ballY);
    const heading = target.focusHeading ?? (this.#side < 0 ? 0 : Math.PI);
    const turn = this.#reducedMotion ? 1.2 : 2.0;
    this.#focusX = damp(this.#focusX, fx, 4.5, dt);
    this.#focusZ = damp(this.#focusZ, fz, 4.5, dt);
    this.#yaw += angleDelta(this.#yaw, heading) * (1 - Math.exp(-turn * dt));
    this.#lookY = damp(this.#lookY, Math.min(target.ballZ * 0.3, 2), 4, dt);
    this.#setFov(cfg.fov, dt);

    const dx = Math.cos(this.#yaw);
    const dz = Math.sin(this.#yaw);
    // Kept inside the grass rectangle. A keeper with the ball on his own line would
    // otherwise put the camera inside the end stand's front wall.
    const px = clamp(this.#focusX - dx * cfg.back, -(BOWL_HALF_LENGTH - 0.8), BOWL_HALF_LENGTH - 0.8);
    const pz = clamp(this.#focusZ - dz * cfg.back, -(BOWL_HALF_WIDTH - 0.8), BOWL_HALF_WIDTH - 0.8);
    this.camera.position.set(px, cfg.height, pz);
    this.#applyShake(frameDt);
    // The look point is ahead of him, not on him: this is a view OF the play he is about
    // to make, with him in the lower part of the frame.
    this.#lookX = this.#focusX + dx * PLAYER_AHEAD;
    this.#lookZ = this.#focusZ + dz * PLAYER_AHEAD;
    this.camera.lookAt(this.#lookX, this.#lookY + 0.6, this.#lookZ);
  }

  /** Snap to the target with no easing — used when cutting to a new camera. */
  reset(target: CameraTarget): void {
    this.#lookX = toSceneX(target.ballX);
    this.#lookZ = toSceneZ(target.ballY) * 0.55;
    this.#lookY = 0;
    this.#shake = 0;
    this.#snap = true;
  }
}

/**
 * How dangerous the current moment is, 0..1 — the input to the camera's push-in and to the
 * crowd noise. Distance to whichever goal the ball is nearer, sharpened so it only really
 * bites in the final twenty metres.
 */
export function dangerOf(ballX: number, ballY: number): number {
  const toEnd = Math.min(ballX, PITCH_LENGTH - ballX);
  const central = 1 - clamp01(Math.abs(ballY - PITCH_WIDTH / 2) / (PITCH_WIDTH / 2));
  return clamp01(lerp(0.35, 1, central) * (1 - clamp01(invLerp(4, 34, toEnd)))) ** 1.4;
}

export function clampCamera(v: number, lo: number, hi: number): number {
  return clamp(v, lo, hi);
}
