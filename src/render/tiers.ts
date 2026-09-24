// Quality tiers, and the governor that moves between them.
//
// Same shape as games/starhaven/src/render/tiers.ts, because it was right there: a data
// table rather than branches, a governor that steps down fast and up slowly with a
// cooldown so it can never oscillate, and a player-chosen tier that switches the governor
// off entirely — an option that silently overrode itself would be worse than no option.
//
// Pure logic, no Three.js and no DOM, so the governor can be driven with synthetic frame
// times in a unit test.

export interface QualityTier {
  /** Multiplier on device pixel ratio. */
  renderScale: number;
  /** Texels per metre in the baked pitch texture. */
  pitchDetail: number;
  /** Segments on the crowd sheets and stands. */
  crowd: boolean;
  /** Whether the sky dome is drawn. */
  sky: boolean;
  /** Contact blobs under the players — cheap ambient occlusion, always readable. */
  playerShadows: boolean;
  /**
   * Real cast shadows from the sun. A second scene pass, so it is the first thing the
   * governor gives up, and the contact blobs below it mean losing it degrades rather
   * than breaks: a figure without a shadow of any kind floats.
   */
  shadowMap: boolean;
  /**
   * Falling rain. A few thousand GPU-driven line segments in one draw call — cheap, but
   * it is transparent geometry over the whole frame, which is exactly what a weak
   * fill-rate machine cannot afford. So it goes with the shadow pass.
   */
  rain: boolean;
  /**
   * The HDR post chain (post.ts): bloom, tone mapping and grade, multisampled. Two
   * full-screen passes and a mip chain for the bloom, so it goes before the shadow map.
   */
  post: boolean;
  /** Sun shadow map resolution, when there is one. */
  shadowRes: number;
}

/** Index 0 = low … index 3 = ultra. Tier 2 ("high") is the boot default. */
export const TIERS: QualityTier[] = [
  { renderScale: 0.6, pitchDetail: 7, crowd: false, sky: true, playerShadows: true, shadowMap: false, rain: false, post: false, shadowRes: 1024 },
  { renderScale: 0.75, pitchDetail: 10, crowd: true, sky: true, playerShadows: true, shadowMap: false, rain: true, post: false, shadowRes: 1024 },
  { renderScale: 0.9, pitchDetail: 15, crowd: true, sky: true, playerShadows: true, shadowMap: true, rain: true, post: true, shadowRes: 2048 },
  { renderScale: 1.0, pitchDetail: 22, crowd: true, sky: true, playerShadows: true, shadowMap: true, rain: true, post: true, shadowRes: 4096 },
];

/** The `settings.quality` vocabulary, and the tier each word means. */
export const QUALITY_TIERS: Record<'low' | 'medium' | 'high' | 'ultra', number> = {
  low: 0, medium: 1, high: 2, ultra: 3,
};

export const DEFAULT_TIER = 2;

const WINDOW_DEFAULT = 45;
const LOW_FPS = 46;
const HIGH_FPS = 57;
const DOWN_CONFIRM = 2;
const UP_CONFIRM = 5;
const UP_COOLDOWN = 15;

/**
 * Watches the frame rate and returns a new tier index when it wants one, or null.
 *
 * Stepping down is quick and decisive; stepping up needs a sustained comfortable frame
 * rate plus a cooldown since the last change. That asymmetry is the hysteresis, and
 * without it the governor finds a tier where it is borderline and flickers between two.
 */
export class FpsGovernor {
  #tier: number;
  #window: number[] = [];
  #windowSize: number;
  #lowRuns = 0;
  #highRuns = 0;
  #cooldown = 0;

  constructor(tier = DEFAULT_TIER, windowSize = WINDOW_DEFAULT) {
    this.#tier = tier;
    this.#windowSize = windowSize;
  }

  get tier(): number {
    return this.#tier;
  }

  /** Feed it a frame delta in seconds. Returns a tier index when it changes, else null. */
  update(dt: number): number | null {
    // Garbage frames — a tab coming back, a long GC — say nothing about the tier.
    if (!(dt > 0 && dt < 1)) return null;
    this.#window.push(dt);
    if (this.#window.length < this.#windowSize) return null;
    if (this.#window.length > this.#windowSize) this.#window.shift();

    let total = 0;
    for (const d of this.#window) total += d;
    const fps = this.#window.length / total;
    this.#window.length = 0;
    if (this.#cooldown > 0) this.#cooldown--;

    if (fps < LOW_FPS) {
      this.#highRuns = 0;
      this.#lowRuns++;
      if (this.#lowRuns >= DOWN_CONFIRM && this.#tier > 0) {
        this.#lowRuns = 0;
        this.#cooldown = UP_COOLDOWN;
        this.#tier--;
        return this.#tier;
      }
      return null;
    }

    if (fps > HIGH_FPS) {
      this.#lowRuns = 0;
      this.#highRuns++;
      if (this.#highRuns >= UP_CONFIRM && this.#cooldown === 0 && this.#tier < TIERS.length - 1) {
        this.#highRuns = 0;
        this.#cooldown = UP_COOLDOWN;
        this.#tier++;
        return this.#tier;
      }
      return null;
    }

    this.#lowRuns = 0;
    this.#highRuns = 0;
    return null;
  }
}
