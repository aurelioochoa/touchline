// Formations, and the shape a team holds when it is not doing anything else.
//
// A formation here is eleven points in normalised space, not a name. The name is derived
// from the points (`deriveLabel`), which is what lets design §3 promise that dragging a
// midfielder forward changes the label from 4-4-2 to 4-3-3 on its own — the kid makes the
// shape, they do not pick it off a list.

import { clamp, clamp01, lerp } from '../../core/math.js';
import type { Position } from '../ratings/positions.js';
import type { Formation, FormationSlot, TeamInstructions } from './types.js';

/**
 * Group outfield slots into rows and name the shape. Rows are found by gaps in depth
 * rather than by a fixed grid, so a shape a player invented still gets a sensible name.
 */
export function deriveLabel(slots: readonly FormationSlot[]): string {
  const outfield = slots.filter((s) => s.position !== 'GK').sort((a, b) => a.along - b.along);
  if (outfield.length === 0) return '';
  const rows: number[] = [];
  let count = 0;
  let prev = outfield[0]?.along ?? 0;
  for (const s of outfield) {
    if (s.along - prev > 0.085 && count > 0) {
      rows.push(count);
      count = 0;
    }
    count++;
    prev = s.along;
  }
  rows.push(count);
  return rows.join('-');
}

function make(id: string, slots: FormationSlot[]): Formation {
  return { id, label: deriveLabel(slots), slots };
}

function s(position: Position, along: number, across: number): FormationSlot {
  return { position, along, across };
}

const GK = s('GK', 0.05, 0.5);

export const FORMATIONS: readonly Formation[] = [
  make('4-4-2', [
    GK,
    s('DL', 0.22, 0.09),
    s('DC', 0.19, 0.38),
    s('DC', 0.19, 0.62),
    s('DR', 0.22, 0.91),
    s('ML', 0.47, 0.06),
    s('MC', 0.44, 0.38),
    s('MC', 0.44, 0.62),
    s('MR', 0.47, 0.94),
    s('ST', 0.75, 0.42),
    s('ST', 0.75, 0.58),
  ]),
  make('4-3-3', [
    GK,
    s('DL', 0.23, 0.08),
    s('DC', 0.19, 0.38),
    s('DC', 0.19, 0.62),
    s('DR', 0.23, 0.92),
    s('MC', 0.4, 0.5),
    s('MC', 0.48, 0.32),
    s('MC', 0.48, 0.68),
    s('AML', 0.72, 0.07),
    s('ST', 0.79, 0.5),
    s('AMR', 0.72, 0.93),
  ]),
  make('4-2-3-1', [
    GK,
    s('DL', 0.23, 0.08),
    s('DC', 0.19, 0.38),
    s('DC', 0.19, 0.62),
    s('DR', 0.23, 0.92),
    s('DM', 0.37, 0.4),
    s('DM', 0.37, 0.6),
    s('AML', 0.62, 0.08),
    s('AMC', 0.6, 0.5),
    s('AMR', 0.62, 0.92),
    s('ST', 0.8, 0.5),
  ]),
  make('3-5-2', [
    GK,
    s('DC', 0.18, 0.3),
    s('DC', 0.16, 0.5),
    s('DC', 0.18, 0.7),
    s('WBL', 0.44, 0.05),
    s('MC', 0.4, 0.36),
    s('MC', 0.42, 0.5),
    s('MC', 0.4, 0.64),
    s('WBR', 0.44, 0.95),
    s('ST', 0.76, 0.42),
    s('ST', 0.76, 0.58),
  ]),
  make('5-3-2', [
    GK,
    s('WBL', 0.24, 0.05),
    s('DC', 0.17, 0.32),
    s('DC', 0.15, 0.5),
    s('DC', 0.17, 0.68),
    s('WBR', 0.24, 0.95),
    s('MC', 0.44, 0.34),
    s('MC', 0.42, 0.5),
    s('MC', 0.44, 0.66),
    s('ST', 0.74, 0.42),
    s('ST', 0.74, 0.58),
  ]),
  make('4-1-4-1', [
    GK,
    s('DL', 0.23, 0.08),
    s('DC', 0.19, 0.38),
    s('DC', 0.19, 0.62),
    s('DR', 0.23, 0.92),
    s('DM', 0.34, 0.5),
    s('ML', 0.52, 0.06),
    s('MC', 0.5, 0.38),
    s('MC', 0.5, 0.62),
    s('MR', 0.52, 0.94),
    s('ST', 0.79, 0.5),
  ]),
  make('4-4-1-1', [
    GK,
    s('DL', 0.22, 0.09),
    s('DC', 0.19, 0.38),
    s('DC', 0.19, 0.62),
    s('DR', 0.22, 0.91),
    s('ML', 0.46, 0.06),
    s('MC', 0.43, 0.38),
    s('MC', 0.43, 0.62),
    s('MR', 0.46, 0.94),
    s('AMC', 0.63, 0.5),
    s('ST', 0.8, 0.5),
  ]),
  make('3-4-3', [
    GK,
    s('DC', 0.18, 0.3),
    s('DC', 0.16, 0.5),
    s('DC', 0.18, 0.7),
    s('ML', 0.45, 0.05),
    s('MC', 0.42, 0.4),
    s('MC', 0.42, 0.6),
    s('MR', 0.45, 0.95),
    s('AML', 0.72, 0.08),
    s('ST', 0.79, 0.5),
    s('AMR', 0.72, 0.92),
  ]),
  make('4-5-1', [
    GK,
    s('DL', 0.22, 0.13),
    s('DC', 0.18, 0.38),
    s('DC', 0.18, 0.62),
    s('DR', 0.22, 0.87),
    s('ML', 0.48, 0.05),
    s('MC', 0.42, 0.34),
    s('MC', 0.4, 0.5),
    s('MC', 0.42, 0.66),
    s('MR', 0.48, 0.95),
    s('ST', 0.76, 0.5),
  ]),
];

export const DEFAULT_FORMATION: Formation = FORMATIONS[0] as Formation;

export function formationById(id: string): Formation {
  return FORMATIONS.find((f) => f.id === id) ?? DEFAULT_FORMATION;
}

/**
 * Where a slot actually sits once the instructions are applied, in normalised space.
 *
 * This is the function §5c is about: line height, width and attacking intent are levers a
 * player pulls and then *sees* the whole shape move within a few seconds. If a lever does
 * not change a number here, it does not change the picture, and it belongs further up the
 * depth ladder.
 *
 * `phase` runs 0 (defending, ball at our end) to 1 (attacking, ball at theirs). The shape
 * compresses and slides as a unit, the way a real block does.
 */
export function slotTarget(
  out: { along: number; across: number },
  slot: FormationSlot,
  inst: TeamInstructions,
  phase: number,
): void {
  const ph = clamp01(phase);

  // Line height pushes everyone up or drops them off; the effect is strongest at the back,
  // because that is what a high line means.
  const rearWeight = clamp01(1 - slot.along / 0.55);
  const lineShift = (inst.lineHeight - 0.5) * (0.1 + 0.14 * rearWeight);

  // Attacking intent moves the players ahead of the ball further forward, and does almost
  // nothing to the back line — a manager who wants more bodies forward gets them from
  // midfield, not from his centre-backs.
  const frontWeight = clamp01((slot.along - 0.3) / 0.6);
  const intentShift = (inst.attackingIntent - 0.5) * 0.16 * frontWeight;

  // The whole block slides with the ball, and squeezes vertically when defending deep.
  const phaseShift = (ph - 0.5) * 0.3;
  const compress = lerp(0.88, 1.06, ph);

  const centred = 0.5 + (slot.along - 0.5) * compress;
  out.along = clamp(centred + lineShift + intentShift + phaseShift, 0.02, 0.96);

  // Width spreads the wide players and barely touches the middle, so "go wider" reads as
  // wingers hugging the touchline rather than the whole team drifting apart.
  const fromCentre = slot.across - 0.5;
  const widthGain = lerp(0.72, 1.24, inst.width) * lerp(0.9, 1.1, ph);
  out.across = clamp(0.5 + fromCentre * widthGain, 0.03, 0.97);

  if (slot.position === 'GK') {
    // The keeper sweeps with the line rather than living on his goal line, but only ever
    // a fraction of it.
    out.along = clamp(0.05 + (inst.lineHeight - 0.5) * 0.09 + ph * 0.05, 0.02, 0.2);
    out.across = 0.5;
  }
}

/** Preset instruction sets, so the assistant always has a defensible default (§5b). */
export const INSTRUCTION_PRESETS: Readonly<Record<string, TeamInstructions>> = {
  balanced: { tempo: 0.5, width: 0.5, lineHeight: 0.5, pressing: 0.5, directness: 0.4, attackingIntent: 0.5 },
  attacking: { tempo: 0.68, width: 0.66, lineHeight: 0.68, pressing: 0.68, directness: 0.42, attackingIntent: 0.78 },
  defensive: { tempo: 0.38, width: 0.36, lineHeight: 0.3, pressing: 0.3, directness: 0.55, attackingIntent: 0.26 },
  counter: { tempo: 0.6, width: 0.44, lineHeight: 0.34, pressing: 0.36, directness: 0.74, attackingIntent: 0.46 },
  possession: { tempo: 0.42, width: 0.7, lineHeight: 0.62, pressing: 0.6, directness: 0.16, attackingIntent: 0.55 },
  gungHo: { tempo: 0.82, width: 0.72, lineHeight: 0.8, pressing: 0.82, directness: 0.6, attackingIntent: 0.95 },
};
