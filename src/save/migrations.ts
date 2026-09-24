// Forward-only save migrations.
//
// Each step ADDS fields with defaults and never reinterprets an existing one; a save from
// a newer build is returned untouched rather than mangled. A kid must never lose a career
// to a deploy (design §C), and a multi-season save makes that a real risk rather than a
// theoretical one — so there is a test per step, not per release.

import { SAVE_VERSION, type SaveData } from './format.js';

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/**
 * Index i migrates a save at version i to version i+1. The array is append-only: editing
 * an existing entry rewrites history for every save already in the wild.
 */
export const MIGRATIONS: Migration[] = [
  // 0 -> 1. No save was ever written at version 0; the slot exists so the array index
  // and the version number stay the same number, which is what makes `MIGRATIONS[v]`
  // readable at the call site.
  (data) => data,
  // 1 -> 2: the settings screen and the guided first match arrived together.
  // `onboarded` is TRUE for an existing save on purpose — a career already in progress
  // has plainly got past the first match, and opening a tour over someone's tenth season
  // is worse than never showing it.
  (data) => {
    const settings = (data.settings ?? {}) as Record<string, unknown>;
    return {
      ...data,
      settings: {
        ...settings,
        onboarded: settings.onboarded ?? true,
      },
    };
  },
  // 2 -> 3: live commentary. Existing careers get the on-screen text, which is what the
  // three-line ticker they already had has become — and NOT the spoken option, which is
  // opt-in by design and must never arrive because somebody updated the game.
  (data) => {
    const settings = (data.settings ?? {}) as Record<string, unknown>;
    return {
      ...data,
      settings: {
        ...settings,
        commentary: settings.commentary ?? 'text',
      },
    };
  },
  // 3 -> 4: the badge stopped being one number.
  //
  // A save at 3 carries `crestStyle`, an index into the five patterns the intro's badge row
  // used to offer — sash, halves, hoops, stripes, star. Four of those are patterns in the
  // new vocabulary and one of them (star) is an emblem on a plain field, so the mapping is
  // exact and nobody's club changes appearance across the update. That matters more than it
  // sounds: the badge is the thing the intro spends a whole screen making theirs.
  //
  // A save with no `crestStyle` at all predates the intro. It gets `crest: undefined`, which
  // means "derive it from the club id" — which is what it has effectively been wearing.
  (data) => {
    const world = data.world as Record<string, unknown> | undefined;
    if (!world) return data;
    const style = typeof world.crestStyle === 'number' ? world.crestStyle : null;
    const { crestStyle: _dropped, ...rest } = world;
    if (style === null) return { ...data, world: rest };
    // old index:      0 sash   1 halves  2 hoops   3 stripes  4 star
    const PATTERN = [1, 2, 5, 6, 0];
    const EMBLEM = [0, 0, 0, 0, 2];
    const i = ((style % 5) + 5) % 5;
    return {
      ...data,
      world: { ...rest, crest: [0, PATTERN[i], 1, EMBLEM[i], 0, 1] },
    };
  },
];

export type MigrateResult =
  | { ok: true; data: SaveData }
  | { ok: false; reason: 'too-new' | 'corrupt' };

export function migrate(raw: unknown): MigrateResult {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'corrupt' };
  const data = raw as Record<string, unknown>;
  const version = typeof data.version === 'number' ? data.version : -1;
  if (version < 0) return { ok: false, reason: 'corrupt' };
  if (version > SAVE_VERSION) return { ok: false, reason: 'too-new' };

  let current = data;
  for (let v = version; v < SAVE_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) return { ok: false, reason: 'corrupt' };
    current = step(current);
    current.version = v + 1;
  }
  return { ok: true, data: current as unknown as SaveData };
}
