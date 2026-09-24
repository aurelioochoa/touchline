// The TV director.
//
// The broadcast camera frames the match; the director decides WHICH camera is live. It is
// what a real outside-broadcast truck does: the wide main camera for almost everything, a
// close-up on whoever is taking a throw or a goal kick while nothing is happening anyway,
// the camera behind the goal for a penalty, and a tighter shot that tracks the ball when
// an attack gets dangerous.
//
// Pure and DOM-free on purpose, so the cutting rules are testable without a renderer —
// the failure worth guarding against is not a wrong angle but a camera that cuts four
// times a second, and that is a property of the rules, not of any picture.

import type { PlayState } from '../sim/match/types.js';
import type { CameraPreset } from './camera.js';

export interface DirectorInput {
  play: PlayState['kind'];
  /** 0..1, camera.ts's `dangerOf`, already smoothed. */
  danger: number;
  /**
   * Match seconds per real second. A restart at 14× lasts a fraction of a real second, and
   * cutting to a close-up for it is a flicker, not a shot — so above FAST the director
   * keeps the wide camera and only a penalty is worth a cut.
   */
  pace: number;
  reducedMotion: boolean;
}

/** Real seconds a shot is held before the director will cut away from it. */
export const MIN_HOLD = 2.2;
/** Seconds of sustained danger before the tight attacking shot is taken. */
const HEAT_IN = 0.9;
/** Seconds of calm before it lets go again. */
const COOL_OUT = 1.3;
/** A restart close-up lingers this long into open play, so the kick itself is in it. */
const RESTART_TAIL = 0.9;
/** Above this pace only the wide camera and the penalty camera are used. */
export const FAST = 4;

export class Director {
  #shot: CameraPreset = 'broadcast';
  #held = MIN_HOLD;
  #heat = 0;
  #calm = 0;
  #sinceOpen = 0;

  get shot(): CameraPreset {
    return this.#shot;
  }

  reset(): void {
    this.#shot = 'broadcast';
    this.#held = MIN_HOLD;
    this.#heat = 0;
    this.#calm = 0;
    this.#sinceOpen = 0;
  }

  /** Advance by `dt` real seconds. Returns true when this frame is a cut. */
  update(input: DirectorInput, dt: number): boolean {
    this.#held += dt;
    this.#sinceOpen = input.play === 'open' ? this.#sinceOpen + dt : 0;
    this.#heat = input.danger > 0.55 ? this.#heat + dt : 0;
    this.#calm = input.danger < 0.25 ? this.#calm + dt : 0;

    const want = this.#want(input);
    if (want === this.#shot) return false;
    // A penalty is the one shot that does not wait its turn: it is the most important
    // moment in the match and it starts from a standstill.
    if (input.play !== 'penalty' && this.#held < MIN_HOLD) return false;
    this.#shot = want;
    this.#held = 0;
    return true;
  }

  #want(i: DirectorInput): CameraPreset {
    if (i.reducedMotion) return 'broadcast';
    if (i.play === 'penalty') return 'behindGoal';
    if (i.pace > FAST) return i.play === 'open' && this.#shot === 'behindGoal' && this.#sinceOpen < RESTART_TAIL
      ? 'behindGoal'
      : 'broadcast';

    switch (i.play) {
      case 'corner':
        return 'follow';
      case 'freeKick':
        return i.danger > 0.3 ? 'behindGoal' : 'player';
      case 'throwIn':
      case 'goalKick':
        return 'player';
      case 'kickoff':
      case 'halfTime':
      case 'fullTime':
        return 'broadcast';
      case 'open':
      default:
        break;
    }

    // Open play. A restart shot carries on for a moment so the kick is in frame.
    if ((this.#shot === 'player' || this.#shot === 'behindGoal') && this.#sinceOpen < RESTART_TAIL) return this.#shot;
    if (this.#shot === 'follow') return this.#calm > COOL_OUT ? 'broadcast' : 'follow';
    return this.#heat > HEAT_IN ? 'follow' : 'broadcast';
  }
}
