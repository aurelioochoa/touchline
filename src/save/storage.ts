// Durable storage: two slots and a pointer.
//
// Taken from games/starhaven/src/save/storage.ts, because it is the right shape and there
// is no reason for a second dialect of it. The write protocol is: serialise, checksum,
// write the whole payload to the INACTIVE slot, then flip the pointer. The flip is the
// commit, so a write interrupted half way through leaves the previous save intact and
// readable — which matters more here than it did there, because a career is many hours.

/**
 * How many careers can be kept at once.
 *
 * Three, and the number is a budget rather than a preference. Design §C sizes one career
 * at ~280 KB base64 per copy and ~560 KB across both buffers, against a localStorage
 * origin of about 5 MB — so three is ~1.7 MB and comfortable, and a fourth starts making
 * the ceiling a question rather than a footnote.
 */
export const SLOT_COUNT = 3;

/**
 * The three keys one slot needs.
 *
 * Slot 0 deliberately keeps the ORIGINAL key names. Every career that exists today lives
 * under them, and renaming the keys to make room for slots would have silently deleted
 * every player's game — a save format is a promise, and the promise includes where it is.
 */
function keysFor(slot: number): { a: string; b: string; pointer: string } {
  if (slot === 0) {
    return { a: 'touchline:save-a', b: 'touchline:save-b', pointer: 'touchline:save-active' };
  }
  return {
    a: `touchline:slot${slot}-a`,
    b: `touchline:slot${slot}-b`,
    pointer: `touchline:slot${slot}-active`,
  };
}

export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * A store that keeps everything in memory. Used when localStorage throws — private
 * browsing, a sandboxed iframe, a browser set to block site data. The game then runs for
 * the session and forgets, which is a much better failure than refusing to start.
 */
export function memoryStorage(): Store {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

export function browserStorage(): Store {
  try {
    const probe = '__touchline_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return memoryStorage();
  }
}

/** FNV-1a, 32-bit. Cheap, and enough to catch a truncated or corrupted slot. */
export function checksum(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

interface Envelope {
  sum: number;
  body: string;
}

export function writeSlot(store: Store, payload: string, slot = 0): void {
  const k = keysFor(slot);
  const active = store.getItem(k.pointer);
  const target = active === 'a' ? k.b : k.a;
  const envelope: Envelope = { sum: checksum(payload), body: payload };
  store.setItem(target, JSON.stringify(envelope));
  // The pointer flip is the commit. Everything before it is recoverable.
  store.setItem(k.pointer, target === k.a ? 'a' : 'b');
}

/** Read the newest slot that is intact, or null if neither is. */
export function readBest(store: Store, slot = 0): string | null {
  const k = keysFor(slot);
  const active = store.getItem(k.pointer);
  const order = active === 'b' ? [k.b, k.a] : [k.a, k.b];
  for (const key of order) {
    const raw = store.getItem(key);
    if (!raw) continue;
    try {
      const env = JSON.parse(raw) as Envelope;
      if (typeof env.body !== 'string') continue;
      if (checksum(env.body) !== env.sum) continue;
      return env.body;
    } catch {
      continue;
    }
  }
  return null;
}

export function clearSlots(store: Store, slot = 0): void {
  const k = keysFor(slot);
  store.removeItem(k.a);
  store.removeItem(k.b);
  store.removeItem(k.pointer);
}

/**
 * Bytes currently used, for the budget assertion in save.test.ts.
 *
 * One slot by default, every slot when asked — the ceiling that matters is the origin's,
 * and three careers share it.
 */
export function savedBytes(store: Store, slot?: number): number {
  const slots = slot === undefined ? Array.from({ length: SLOT_COUNT }, (_, i) => i) : [slot];
  let total = 0;
  for (const n of slots) {
    const k = keysFor(n);
    for (const key of [k.a, k.b, k.pointer]) total += (store.getItem(key) ?? '').length;
  }
  return total;
}
