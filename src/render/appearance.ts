// What one particular footballer looks like, as opposed to what his team looks like.
//
// A squad in which every man has the same face, the same hair and the same height is the
// thing that most says "these are counters, not people" — and it is free to fix, because
// every figure already carries its own instance colour and its own root scale.
//
// Everything here is derived from the player's id, so a player looks the same in every
// match of his career and across a reload. No storage, nothing in the save.

import type { FigureColors } from './figure.js';

/**
 * A spread of skin tones. Ordered light to dark and sampled uniformly, so a generated
 * league looks like a league rather than like one country.
 */
const SKIN: readonly number[] = [
  0xf2d0b0, 0xe8bd97, 0xd9a577, 0xc98f63, 0xb87a4e, 0x9a6238, 0x7d4c2b, 0x5d3720,
];

/** Hair, weighted the way a hair colour actually is: mostly dark. */
const HAIR: readonly number[] = [
  0x1c1512, 0x1c1512, 0x241a14, 0x3a2519, 0x3a2519, 0x53341f, 0x7a5330, 0xa97c3f,
  0xd9b46a, 0xb5581f, 0x8d8d8d,
];

/** Boots. Kids notice boots, and a pitch of twenty-two black pairs is a missed chance. */
const BOOTS: readonly number[] = [
  0x14171c, 0x14171c, 0x1e2229, 0xf2f4f6, 0xe8452c, 0x2f8fd8, 0xf2c53d, 0x36c06a, 0xd83fa0,
];

/**
 * A cheap, well-mixed integer hash. The multiply-xor-shift shape is the one `worldgen`
 * already leans on; what matters here is only that neighbouring ids do not give
 * neighbouring answers, or a back four comes out as a gradient.
 */
export function hashId(id: number, salt: number): number {
  let h = (id ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** A 0..1 draw from the hash. */
function unit(id: number, salt: number): number {
  return hashId(id, salt) / 0x100000000;
}

function pick<T>(list: readonly T[], id: number, salt: number): T {
  return list[Math.floor(unit(id, salt) * list.length) % list.length] as T;
}

/**
 * Haircuts, as HAIR_STYLES indices (crop, short, quiff, curly, bun), weighted the way a
 * squad actually looks: mostly short, a few of everything else.
 */
const HAIRCUTS: readonly number[] = [0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4];

/**
 * A number that reads against a shirt: the kit's second colour when that contrasts, else
 * white or near-black by the shirt's own lightness. Only the managed club chooses its own.
 */
export function numberInk(shirt: number, secondary: number): number {
  const lum = (c: number): number =>
    (0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)) / 255;
  if (Math.abs(lum(secondary) - lum(shirt)) > 0.35) return secondary;
  return lum(shirt) > 0.55 ? 0x14171c : 0xffffff;
}

/** The club's kit, before a particular player is dressed in it. */
export interface KitColors {
  shirt: number;
  /** Defaults to the shirt. */
  sleeve?: number;
  pattern?: number;
  patternColour?: number;
  chest?: number;
  shorts: number;
  sock: number;
  /** The shirt numbers' colour and NUMBER_STYLES index. */
  number?: number;
  numberStyle?: number;
}

/**
 * How tall and heavy this player is, as a multiplier on the whole rig.
 *
 * Deliberately narrow. Real footballers span about 1.65m to 1.95m, which is ±8% — and at
 * broadcast distance even that much reads as variety without anyone looking like a child
 * or a giant on the same pitch.
 */
export function buildOf(id: number): number {
  return 0.945 + unit(id, 0x9e37) * 0.11;
}

/**
 * Dress one player: the club's kit, his own skin, hair and boots, and his number. `shirt`
 * is the number on his back; leave it out for the officials, who wear none.
 */
export function appearanceOf(id: number, kit: KitColors, shirt = 0): FigureColors {
  return {
    ...(shirt > 0 ? { number: shirt, numberColour: kit.number ?? 0xffffff, numberStyle: kit.numberStyle ?? 0 } : {}),
    hairStyle: pick(HAIRCUTS, id, 0x51a3),
    shirt: kit.shirt,
    sleeve: kit.sleeve ?? kit.shirt,
    ...(kit.pattern !== undefined ? { pattern: kit.pattern } : {}),
    ...(kit.patternColour !== undefined ? { patternColour: kit.patternColour } : {}),
    ...(kit.chest !== undefined ? { chest: kit.chest } : {}),
    shorts: kit.shorts,
    sock: kit.sock,
    skin: pick(SKIN, id, 0x2545),
    hair: pick(HAIR, id, 0x7f4a),
    boot: pick(BOOTS, id, 0xb531),
  };
}

/** The referee and his assistants. Black, so nobody mistakes one for a player. */
export const OFFICIAL_KIT: KitColors = { shirt: 0x1b1e24, shorts: 0x15181d, sock: 0x1b1e24 };
