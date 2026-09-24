import { describe, expect, it } from 'vitest';
import { BALL_STYLES } from './ballStyle.js';
import { trailFor } from './ballTrail.js';

describe('trailFor', () => {
  it('gives every fantasy ball an effect of its own, and every real ball only the air streak', () => {
    const kinds = new Set<string>();
    BALL_STYLES.forEach((style, i) => {
      const fx = trailFor(i);
      if (style.group === 'fantasy') {
        expect(fx.always, style.id).toBe(true);
        expect(fx.kind, style.id).not.toBe('air');
        kinds.add(fx.kind);
      } else {
        // A leather ball with sparks coming off it is a bug, not a feature.
        expect(fx.kind, style.id).toBe('air');
        expect(fx.always, style.id).toBe(false);
      }
    });
    // Distinct, not ten recolours of one effect.
    expect(kinds.size).toBe(BALL_STYLES.filter((s) => s.group === 'fantasy').length);
  });

  it('keeps trails short enough to stay behind the ball rather than across the pitch', () => {
    BALL_STYLES.forEach((_, i) => {
      const fx = trailFor(i);
      expect(fx.length).toBeLessThanOrEqual(10);
      expect(fx.life).toBeLessThanOrEqual(1);
    });
  });
});
