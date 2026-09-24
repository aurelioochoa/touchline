// Names for a world that does not exist.
//
// Every club, player and stadium in the game is generated. That is a legal necessity —
// name-and-likeness licensing for real footballers runs into seven figures and is not
// available to anything this size — but it is also the better game: no two careers share a
// world, and nobody's favourite player is missing.
//
// Names are assembled from culture-tagged parts rather than drawn from a list, so a few
// hundred syllables produce tens of thousands of plausible names. Players store INDICES
// into these pools rather than strings: the save has ~2,600 players in it and a stored
// name is forty bytes against four (design §C).

import { int, pick, type Rng } from '../../core/rng.js';

/**
 * The naming cultures of the world. Chosen to sound like somewhere without being anywhere,
 * which is the whole trick: a league that reads as plausibly foreign and cannot be mapped
 * onto a real country nobody has asked us to represent.
 */
export const CULTURES = ['albion', 'norden', 'valen', 'meridia'] as const;
export type Culture = (typeof CULTURES)[number];

interface Pool {
  first: readonly string[];
  last: readonly string[];
  /** Parts a club name is built from. */
  place: readonly string[];
  suffix: readonly string[];
}

const POOLS: Readonly<Record<Culture, Pool>> = {
  albion: {
    first: ['Alfie', 'Bram', 'Callum', 'Dennis', 'Eddie', 'Finlay', 'George', 'Harvey', 'Isaac',
      'Jonty', 'Kit', 'Lewin', 'Marcus', 'Ned', 'Ollie', 'Percy', 'Quinn', 'Rory', 'Sam',
      'Toby', 'Wilf', 'Arlo', 'Barney', 'Cedric', 'Dexter', 'Elliot', 'Freddie', 'Gus'],
    last: ['Ashdown', 'Barlow', 'Carrick', 'Dunmore', 'Ellery', 'Fenwick', 'Garrow', 'Haldane',
      'Ingham', 'Jarrold', 'Kembley', 'Lockhart', 'Marchant', 'Northcote', 'Oakley', 'Pemberton',
      'Quilter', 'Radcliffe', 'Standish', 'Thorne', 'Underhill', 'Vance', 'Wetherby', 'Yardley',
      'Bracewell', 'Cranmer', 'Dallimore', 'Farthing', 'Greenhalgh', 'Hollis'],
    place: ['Ashford', 'Barrowfield', 'Coldharbour', 'Dunhaven', 'Eastmarch', 'Foxbridge',
      'Grimsdale', 'Hollowmere', 'Ironbourne', 'Kingsbridge', 'Larkfield', 'Marshgate',
      'Netherby', 'Oldcastle', 'Penforth', 'Riverside', 'Stonewick', 'Thornbury', 'Wexley',
      'Yarrowdale', 'Blackmoor', 'Copperfield'],
    suffix: ['Town', 'City', 'United', 'Athletic', 'Rovers', 'Wanderers', 'Albion', 'County'],
  },
  norden: {
    first: ['Anders', 'Bjorn', 'Kasper', 'Emil', 'Frode', 'Gustav', 'Halvor', 'Ivar', 'Jonas',
      'Leif', 'Magnus', 'Nils', 'Odd', 'Petter', 'Rasmus', 'Sten', 'Torvald', 'Ulf', 'Viggo',
      'Eirik', 'Sindre', 'Harald', 'Tobias'],
    last: ['Aaberg', 'Blomqvist', 'Dahlgren', 'Ekland', 'Fjeldstad', 'Granholm', 'Haugen',
      'Isaksen', 'Kjelland', 'Lindqvist', 'Moberg', 'Norheim', 'Ostergaard', 'Palmgren',
      'Rundqvist', 'Sundstrom', 'Thorsen', 'Vikander', 'Wallin', 'Ylvisaker', 'Brekke', 'Solheim'],
    place: ['Aalborg', 'Bergenfjord', 'Drammen', 'Eskilstad', 'Fjellvik', 'Granvik', 'Hammerdal',
      'Kvitnes', 'Lysaker', 'Molde', 'Nordvik', 'Rundvold', 'Solberg', 'Trollhaven', 'Vardo'],
    suffix: ['IF', 'FK', 'BK', 'Idrott', 'Fotball'],
  },
  valen: {
    first: ['Aurelio', 'Bruno', 'Cesare', 'Dario', 'Elio', 'Fabio', 'Gian', 'Iacopo', 'Lorenzo',
      'Matteo', 'Nico', 'Orsino', 'Paolo', 'Renzo', 'Silvio', 'Tullio', 'Vito', 'Enzo',
      'Massimo', 'Rocco', 'Giulio', 'Luca'],
    last: ['Aliprandi', 'Bellandi', 'Cavazza', 'Delfino', 'Ferraris', 'Gattoni', 'Insolera',
      'Lombardi', 'Marchetti', 'Nardone', 'Ottaviani', 'Pellegrino', 'Ravelli', 'Scarpa',
      'Tornabuoni', 'Vallese', 'Zampieri', 'Brancaleone', 'Costanzi', 'Donatelli'],
    place: ['Acquaviva', 'Bellagio', 'Castelrosso', 'Doriano', 'Ferrentino', 'Grosseto',
      'Lucania', 'Montebello', 'Nervi', 'Portovecchio', 'Ravenna', 'Sanremo', 'Valdarno'],
    suffix: ['Calcio', 'FC', 'Sportiva', 'Nuova', 'Unione'],
  },
  meridia: {
    first: ['Adán', 'Bruno', 'Cristo', 'Diego', 'Emiliano', 'Feliz', 'Gaspar', 'Héctor', 'Ignacio',
      'Joaquín', 'Lázaro', 'Mateo', 'Nuno', 'Óscar', 'Pablo', 'Rafa', 'Salvador', 'Tomás',
      'Vicente', 'Xavi', 'Andrés', 'Iker'],
    last: ['Aguirre', 'Bermúdez', 'Cifuentes', 'Delgado', 'Escamilla', 'Fuentes', 'Gallardo',
      'Herrera', 'Izquierdo', 'Jurado', 'Lozano', 'Mendoza', 'Nogueira', 'Olivares', 'Pizarro',
      'Quesada', 'Rivas', 'Salgado', 'Trujillo', 'Valverde', 'Zamora', 'Carrasco'],
    place: ['Altamira', 'Bahía Verde', 'Cabo Duro', 'Estrella', 'Fuentelago', 'Granada Nueva',
      'Isla Blanca', 'Marisol', 'Peñalta', 'Rioseco', 'San Cristo', 'Torrenova', 'Valdemar'],
    suffix: ['CF', 'Deportivo', 'Real', 'Atlético', 'Unión'],
  },
};

/** Flattened pools, so a player can store two small integers instead of two strings. */
export interface NameBook {
  first: string[];
  last: string[];
  /** Where each culture's slice begins in `first`/`last`. */
  firstRange: Record<Culture, [number, number]>;
  lastRange: Record<Culture, [number, number]>;
}

export function buildNameBook(): NameBook {
  const book: NameBook = {
    first: [],
    last: [],
    firstRange: {} as Record<Culture, [number, number]>,
    lastRange: {} as Record<Culture, [number, number]>,
  };
  for (const culture of CULTURES) {
    const pool = POOLS[culture];
    const f0 = book.first.length;
    book.first.push(...pool.first);
    book.firstRange[culture] = [f0, book.first.length];
    const l0 = book.last.length;
    book.last.push(...pool.last);
    book.lastRange[culture] = [l0, book.last.length];
  }
  return book;
}

/** Pick a name for a player of this culture, as indices into the book. */
export function rollName(rng: Rng, book: NameBook, culture: Culture): { first: number; last: number } {
  const [f0, f1] = book.firstRange[culture];
  const [l0, l1] = book.lastRange[culture];
  return { first: int(rng, f0, f1 - 1), last: int(rng, l0, l1 - 1) };
}

export function fullName(book: NameBook, first: number, last: number): string {
  return `${book.first[first] ?? '?'} ${book.last[last] ?? '?'}`;
}

/** Surname only — how a football player is usually referred to. */
export function surname(book: NameBook, last: number): string {
  return book.last[last] ?? '?';
}

/**
 * A club name. Two forms exist because both are needed: the full one for a league table,
 * and a three-letter one for a scoreboard, and deriving the short form from the long one
 * gives "THE" for anything beginning with "The".
 */
export function rollClubName(
  rng: Rng,
  culture: Culture,
  used: Set<string>,
): { name: string; short: string } {
  const pool = POOLS[culture];
  for (let attempt = 0; attempt < 80; attempt++) {
    const place = pick(rng, pool.place);
    const suffix = pick(rng, pool.suffix);
    // A quarter of clubs are just the place, the way many real ones are.
    const name = rng() < 0.25 ? place : `${place} ${suffix}`;
    if (used.has(name)) continue;
    used.add(name);
    return { name, short: shortCode(place, used) };
  }
  const fallback = `${pick(rng, pool.place)} ${used.size}`;
  return { name: fallback, short: shortCode(fallback, used) };
}

/**
 * Three letters for a scoreboard. The first three of the place name where that is free,
 * then the first two plus a later letter, and only then anything at all — so a code still
 * reads as belonging to its club rather than being an arbitrary trigram.
 */
function shortCode(place: string, used: Set<string>): string {
  const letters = place.replace(/[^A-Za-zÀ-ÿ]/g, '').toUpperCase();
  const tries: string[] = [];
  if (letters.length >= 3) tries.push(letters.slice(0, 3));
  for (let n = 3; n < letters.length; n++) tries.push(letters.slice(0, 2) + letters[n]);
  for (let n = 2; n < letters.length; n++) {
    tries.push(`${letters[0] ?? ''}${letters[n] ?? ''}${letters[n + 1] ?? letters[1] ?? ''}`);
  }
  for (const code of tries) {
    if (code.length === 3 && !used.has(`#${code}`)) {
      used.add(`#${code}`);
      return code;
    }
  }
  // Everything sensible is taken; fall back to something unique rather than a duplicate.
  for (let i = 0; i < 999; i++) {
    const code = (letters.slice(0, 2) + String.fromCharCode(65 + (i % 26))).slice(0, 3);
    if (!used.has(`#${code}`)) {
      used.add(`#${code}`);
      return code;
    }
  }
  return letters.slice(0, 3) || 'FCX';
}

/** A stadium name, built from the club's place name. */
export function rollStadiumName(rng: Rng, clubName: string): string {
  const place = clubName.split(' ')[0] ?? clubName;
  const kinds = ['Park', 'Stadium', 'Ground', 'Arena', 'Field', 'Road'];
  return `${place} ${pick(rng, kinds)}`;
}
