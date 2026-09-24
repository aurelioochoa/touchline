import { describe, expect, it } from 'vitest';
import { BALL_STYLES, ballPixels, paintBall } from './ballStyle.js';

const club = { primary: 0xd7263d, secondary: 0xf2f4f6 };

describe('the ball catalogue', () => {
  it('keeps the first six where saves already point', () => {
    expect(BALL_STYLES.slice(0, 6).map((s) => s.id)).toEqual(['classic', 'clubPanels', 'hivis', 'gold', 'street', 'allClub']);
  });

  it('has unique ids', () => {
    expect(new Set(BALL_STYLES.map((s) => s.id)).size).toBe(BALL_STYLES.length);
  });

  it('paints every design as a real pattern: valid colours, and more than one of them', () => {
    BALL_STYLES.forEach((style, i) => {
      const seen = new Set<number>();
      for (let k = 0; k < 400; k++) {
        const y = 1 - (2 * (k + 0.5)) / 400;
        const r = Math.sqrt(1 - y * y);
        const a = k * 2.399963;
        const c = paintBall(i, [Math.cos(a) * r, y, Math.sin(a) * r], club);
        expect(Number.isInteger(c) && c >= 0 && c <= 0xffffff, style.id).toBe(true);
        seen.add(c);
      }
      expect(seen.size, style.id).toBeGreaterThan(1);
    });
  });

  it('follows the club colours where it says it does', () => {
    const red = new Set(Array.from(ballPixels(1, club, 64, 32).reduce<number[]>((acc, _, i, a) => {
      if (i % 4 === 0) acc.push(((a[i] as number) << 16) | ((a[i + 1] as number) << 8) | (a[i + 2] as number));
      return acc;
    }, [])));
    expect(red.has(club.primary)).toBe(true);
  });

  it('falls back to the classic ball for an index a save could not know', () => {
    expect(paintBall(999, [0, 1, 0], club)).toBe(paintBall(0, [0, 1, 0], club));
  });
});
