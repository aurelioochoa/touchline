// The only door to persistence. Nothing outside src/save/ touches storage.

import type { World } from '../sim/world/types.js';
import { caOf } from '../sim/ratings/ability.js';
import { buildTable, positionOf } from '../sim/career/fixtures.js';
import {
  SAVE_VERSION,
  defaultSettings,
  packCrest,
  packWorld,
  unpackWorld,
  type SaveData,
  type Settings,
} from './format.js';
import { migrate } from './migrations.js';
import { SLOT_COUNT, browserStorage, clearSlots, readBest, savedBytes, writeSlot, type Store } from './storage.js';

let store: Store = browserStorage();

/** Swap the backing store. Tests use this; the game never does. */
export function setStore(s: Store): void {
  store = s;
}

export type LoadResult =
  | { kind: 'ok'; data: SaveData }
  | { kind: 'empty' }
  | { kind: 'corrupt' }
  | { kind: 'too-new' };

export function saveGame(world: World, settings: Settings, slot = 0): void {
  const club = world.clubs[world.managedClubId];
  const table = club ? buildTable(world, club.tier) : [];
  const row = table.find((r) => r.clubId === world.managedClubId);
  const data: SaveData = {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    summary: {
      clubName: club?.name ?? '—',
      season: world.season,
      day: world.day,
      tier: club?.tier ?? 0,
      position: club ? positionOf(world, club.id) : 0,
      points: row?.points ?? 0,
      ...(club ? { kitPrimary: club.kitPrimary, kitSecondary: club.kitSecondary } : {}),
      ...(world.crest ? { crest: packCrest(world.crest) } : {}),
    },
    settings,
    world: packWorld(world),
  };
  writeSlot(store, JSON.stringify(data), slot);
}

export function loadGame(slot = 0): LoadResult {
  const body = readBest(store, slot);
  if (!body) return { kind: 'empty' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { kind: 'corrupt' };
  }
  const result = migrate(parsed);
  if (!result.ok) return { kind: result.reason === 'too-new' ? 'too-new' : 'corrupt' };
  return { kind: 'ok', data: result.data };
}

export function restoreWorld(data: SaveData): World {
  return unpackWorld(data.world);
}

export function wipeSave(slot = 0): void {
  clearSlots(store, slot);
}

/** What the menu needs to draw one slot, without unpacking 2,600 players to get it. */
export interface SlotInfo {
  index: number;
  /** null when the slot is empty or unreadable. */
  summary: SaveData['summary'] | null;
  savedAt: number;
  /** True when the slot holds something this build cannot read. */
  unreadable: boolean;
}

/**
 * Every slot, for the main menu.
 *
 * Reads the `summary` field and stops. That field exists in the save format for exactly
 * this reason — a menu listing three careers must not cost three world unpacks, which is
 * about eight thousand players and most of a second.
 */
export function listSlots(): SlotInfo[] {
  const out: SlotInfo[] = [];
  for (let index = 0; index < SLOT_COUNT; index++) {
    const body = readBest(store, index);
    if (!body) {
      out.push({ index, summary: null, savedAt: 0, unreadable: false });
      continue;
    }
    try {
      const parsed = JSON.parse(body) as Partial<SaveData>;
      const summary = parsed.summary ?? null;
      const version = typeof parsed.version === 'number' ? parsed.version : -1;
      out.push({
        index,
        summary,
        savedAt: parsed.savedAt ?? 0,
        // A save from a NEWER build is readable enough to describe and not to load, which
        // is worth showing rather than presenting as an empty slot the player would
        // cheerfully start a new career over.
        unreadable: version > SAVE_VERSION || !summary,
      });
    } catch {
      out.push({ index, summary: null, savedAt: 0, unreadable: true });
    }
  }
  return out;
}

/** The slot to offer as "Continue": the most recently saved readable one, or none. */
export function mostRecentSlot(): number | null {
  let best: SlotInfo | null = null;
  for (const info of listSlots()) {
    if (!info.summary || info.unreadable) continue;
    if (!best || info.savedAt > best.savedAt) best = info;
  }
  return best ? best.index : null;
}

/**
 * The settings that belong to the DEVICE rather than to a career: sound, speed, graphics,
 * camera, commentary. They used to live only inside each save, so the main menu had no way
 * to offer them and a kid who turned the sound off had to do it again in every career.
 * Each save still carries its own copy, which is what an older build reads; this key wins.
 * `onboarded` is deliberately absent — the guided first match is per career.
 */
const PREFS_KEY = 'touchline:prefs';
const DEVICE_KEYS = ['sound', 'quality', 'matchSpeed', 'reducedMotion', 'commentary', 'camera', 'crowd3d', 'stadiumFx'] as const;
export type DevicePrefs = Pick<Settings, (typeof DEVICE_KEYS)[number]>;

export function loadPrefs(): Partial<DevicePrefs> {
  try {
    const raw = store.getItem(PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of DEVICE_KEYS) if (k in parsed) out[k] = parsed[k];
    return out as Partial<DevicePrefs>;
  } catch {
    return {};
  }
}

export function savePrefs(settings: Settings): void {
  const out: Record<string, unknown> = {};
  for (const k of DEVICE_KEYS) out[k] = settings[k];
  try {
    store.setItem(PREFS_KEY, JSON.stringify(out));
  } catch {
    // A full or blocked store costs the preference, never the game.
  }
}

/** A career's settings with the device's on top, over the defaults. */
export function settingsFor(saved: Partial<Settings> | undefined): Settings {
  return { ...defaultSettings(), ...saved, ...loadPrefs() };
}

export function saveSizeBytes(slot?: number): number {
  return savedBytes(store, slot);
}

/**
 * Rate-limit saves. The game saves on every meaningful action AND on a timer during a
 * match; packing 2,600 players thirty times a second would be the whole frame budget.
 */
export function makeThrottle(ms: number): (fn: () => void) => void {
  let last = 0;
  return (fn) => {
    const now = Date.now();
    if (now - last < ms) return;
    last = now;
    fn();
  };
}

export { SLOT_COUNT, defaultSettings, caOf };
export type { SaveData, Settings };
