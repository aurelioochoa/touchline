// The player career's footballer, and everything the world needs to know about him
// (design player-career §12, §A, §C).
//
// He is an ordinary WorldPlayer: stats, form, development, ageing and ratings apply
// untouched. This record is what is his alone — the shirt the kid chose, the three rings,
// the week, the shelf — and it is small and JSON-shaped because it rides in the save as is.

import { clamp, clamp01, lerp } from '../../core/math.js';
import { int, streamOf } from '../../core/rng.js';
import { attr, setAttr, type AnyAttr } from '../ratings/attributes.js';
import { caOf, scaleToCa } from '../ratings/ability.js';
import { pickEleven } from '../career/squad.js';
import { assignSquadNumbers, clubStrength, createPlayer } from '../world/worldgen.js';
import type { Club, World, WorldPlayer } from '../world/types.js';
import type { MomentControl } from '../match/engine.js';

/** Design §15 q2: the four attacking roles; a winger is a left or right attacker. */
export const HERO_POSITIONS = ['ST', 'AML', 'AMR', 'AMC', 'MC'] as const;
export type HeroPosition = (typeof HERO_POSITIONS)[number];

/** Boot colours. The last two are earned on the shelf, never bought. */
export const BOOT_COLOURS = [0xf5f7fa, 0x16181d, 0xff6b1a, 0x2fd4ff, 0xffd21f, 0xe23d8f] as const;

export const DRILLS = ['hoops', 'rondo', 'gap'] as const;
export type DrillKind = (typeof DRILLS)[number];
export const DRILL_ATTRS: Record<DrillKind, AnyAttr[]> = {
  hoops: ['finishing', 'technique', 'longShots'],
  rondo: ['passing', 'vision', 'firstTouch'],
  gap: ['dribbling', 'agility', 'balance'],
};

export const ACTIVITIES = ['drill', 'rest', 'kickabout', 'extra', 'fanday'] as const;
export type Activity = (typeof ACTIVITIES)[number];
export const SLOTS_PER_WEEK = 3;

/** The shelf, in bit order. Celebrations and boots unlock from it (§A). */
export const MILESTONES = ['firstStart', 'firstGoal', 'hatTrick', 'fifty', 'hundred', 'firstMove', 'trophy', 'twentyGoals'] as const;
export type Milestone = (typeof MILESTONES)[number];
/** What each celebration needs: the first is everyone's. */
export const CELEBRATION_UNLOCKS: readonly (Milestone | null)[] = [null, 'firstGoal', 'hatTrick', 'fifty'];
/** The two extra boot colours. */
export const BOOT_UNLOCKS: Partial<Record<number, Milestone>> = { 4: 'trophy', 5: 'hundred' };

/** Where Coach and Team start at a new club: new people, a fresh first impression. */
export const NEW_CLUB_RING = 0.35;

export interface Offer {
  clubId: number;
  /** Whether he would be in that club's first eleven — `pickEleven` with him in it. */
  starts: boolean;
  /** Young and benched: a season away, then back. */
  loan: boolean;
}

export interface Hero {
  playerId: number;
  number: number;
  boots: number;
  position: HeroPosition;
  /** The three rings, 0..1. They move only on events; nothing decays with time away. */
  coach: number;
  team: number;
  fans: number;
  /** What the week's slots have been spent on so far. */
  week: Activity[];
  /** Stars from this season's drill sessions; their average is the training quality. */
  stars: number[];
  /** One bar per drill, 0..1; a full bar pays out an attribute point. */
  bars: number[];
  /** Ability already paid out in-season by full bars, taken off the season roll. */
  paid: number;
  offers: Offer[];
  /** The club he is on loan from, or -1. */
  loanFromClubId: number;
  firstClubId: number;
  milestones: number;
  celebration: number;
  benchStreak: number;
  /** The next match is his last. */
  farewell: boolean;
  retired: boolean;
  /** One entry per finished season, as parallel arrays (§C). */
  history: { season: number[]; clubId: number[]; apps: number[]; goals: number[] };
}

/** What a retired hero becomes: framed in his last club's honours after Legacy. */
export interface Legend {
  firstIdx: number;
  lastIdx: number;
  number: number;
  apps: number;
  goals: number;
  honours: number;
  clubId: number;
}

export interface HeroChoices {
  clubId: number;
  position: HeroPosition;
  number: number;
  boots: number;
}

/** Sign him: a sixteen-year-old with a top-flight ceiling (§15 q4) at the club the kid chose. */
export function createHero(world: World, choices: HeroChoices): WorldPlayer {
  const club = world.clubs[choices.clubId] as Club;
  const rng = streamOf(world.seed + world.season * 613, 'hero');
  // A squad player at a small club, so the first season is about earning the shirt.
  const ability = clamp(Math.round(clubStrength(world, club) * 0.86), 40, 92);
  const player = createPlayer(rng, world.book, world.players.length, club.id, choices.position, ability, club.culture);
  scaleToCa(player.attrs, choices.position, ability);
  player.age = 16;
  player.pa = int(rng, 160, 190);
  player.contractYears = 3;
  player.morale = 0.75;
  world.players.push(player);
  club.playerIds.push(player.id);
  world.hero = {
    playerId: player.id, number: choices.number, boots: choices.boots, position: choices.position,
    coach: NEW_CLUB_RING, team: NEW_CLUB_RING, fans: 0.2,
    week: [], stars: [], bars: [0, 0, 0], paid: 0, offers: [], loanFromClubId: -1,
    firstClubId: club.id, milestones: 0, celebration: 0, benchStreak: 0,
    farewell: false, retired: false, history: { season: [], clubId: [], apps: [], goals: [] },
  };
  assignSquadNumbers(world, club);
  return player;
}

export function heroPlayer(world: World): WorldPlayer | null {
  return world.hero ? world.players[world.hero.playerId] ?? null : null;
}

export function isHero(world: World, player: WorldPlayer): boolean {
  return world.hero?.playerId === player.id;
}

/** How much the coach's opinion bends selection: never a guarantee, never a wall. */
export function trustOf(hero: Hero): number {
  return lerp(0.85, 1.12, hero.coach);
}

export function hasMilestone(hero: Hero, milestone: Milestone): boolean {
  return (hero.milestones & (1 << MILESTONES.indexOf(milestone))) !== 0;
}

function award(hero: Hero, milestone: Milestone): void {
  hero.milestones |= 1 << MILESTONES.indexOf(milestone);
}

export function bump(hero: Hero, ring: 'coach' | 'team' | 'fans', amount: number): void {
  hero[ring] = clamp01(hero[ring] + amount);
}

/** Whether the coach would pick him today, which is what the locker's shirt row shows. */
export function startsFor(world: World, club: Club): boolean {
  const hero = world.hero;
  return !!hero && pickEleven(world, club).eleven.some((player) => player.id === hero.playerId);
}

/** How this match will treat him: his moment budget, and when he comes on if benched. */
export function heroControl(world: World, club: Club): MomentControl {
  const hero = world.hero as Hero;
  const starts = startsFor(world, club);
  return {
    playerId: hero.playerId,
    budget: hero.farewell ? 12 : starts ? 8 : 3,
    // From the 75th minute at worst (§8): trust brings him on sooner.
    enterAt: starts ? Infinity : lerp(75, 58, hero.coach) * 60,
    takesPenalties: hero.coach > 0.7 || hero.farewell,
  };
}

export interface MatchLine {
  started: boolean;
  minutes: number;
  rating: number;
  goals: number;
  assists: number;
  /** Passes he chose to play to a team-mate in key moments, and how many arrived. */
  passesChosen: number;
  passesArrived: number;
}

/** What the match changed in his rings, for the post-match card. */
export interface RingChange {
  coach: number;
  team: number;
  fans: number;
}

/**
 * After `applyResult`: what only the hero's match means. A substitute appearance the
 * career layer does not count, the rings, the shelf, the bench streak.
 */
export function recordHeroMatch(world: World, line: MatchLine): RingChange {
  const hero = world.hero as Hero;
  const player = heroPlayer(world) as WorldPlayer;
  const before = { coach: hero.coach, team: hero.team, fans: hero.fans };
  if (!line.started && line.minutes > 0) {
    player.season.apps++;
    player.career.apps++;
    player.season.minutes += line.minutes;
    player.season.ratingSum += line.rating;
    player.form.push(line.rating);
    if (player.form.length > 5) player.form.shift();
  }
  bump(hero, 'coach', clamp((line.rating - 6.6) * 0.05, -0.06, 0.08));
  bump(hero, 'team', line.passesChosen * 0.01 + line.passesArrived * 0.01 + line.assists * 0.03);
  bump(hero, 'fans', line.goals * 0.04 + (line.rating >= 7.5 ? 0.03 : 0));

  if (line.started) award(hero, 'firstStart');
  if (player.career.goals > 0) award(hero, 'firstGoal');
  if (line.goals >= 3) award(hero, 'hatTrick');
  if (player.career.apps >= 50) award(hero, 'fifty');
  if (player.career.apps >= 100) award(hero, 'hundred');
  if (player.season.goals >= 20) award(hero, 'twentyGoals');
  if (player.career.honours > 0) award(hero, 'trophy');

  hero.benchStreak = line.started ? 0 : hero.benchStreak + 1;
  hero.week = [];
  if (hero.farewell) hero.retired = true;
  return { coach: hero.coach - before.coach, team: hero.team - before.team, fans: hero.fans - before.fans };
}

/** Spend a slot. Rings move now, so the kid sees the choice land (§A). */
export function doActivity(world: World, activity: Activity, drill?: { kind: DrillKind; stars: number }): void {
  const hero = world.hero as Hero;
  if (hero.week.length >= SLOTS_PER_WEEK) return;
  hero.week.push(activity);
  if (activity === 'kickabout') bump(hero, 'team', 0.05);
  if (activity === 'extra') bump(hero, 'coach', 0.05);
  if (activity === 'fanday') bump(hero, 'fans', 0.05);
  if (activity === 'drill' && drill) train(world, drill.kind, drill.stars);
}

/**
 * A drill session: stars into the season's quality, and into the drill's bar. A full bar
 * pays a point into each of the drill's three attributes — only while he is below his
 * potential, which is what keeps drilling from being a cheat code (§12).
 */
function train(world: World, kind: DrillKind, stars: number): void {
  const hero = world.hero as Hero;
  const player = heroPlayer(world) as WorldPlayer;
  hero.stars.push(stars);
  bump(hero, 'coach', stars * 0.01);
  const index = DRILLS.indexOf(kind);
  hero.bars[index] = (hero.bars[index] ?? 0) + 0.25 + stars * 0.1;
  if ((hero.bars[index] ?? 0) < 1) return;
  hero.bars[index] = (hero.bars[index] ?? 1) - 1;
  const before = caOf(player.attrs, player.natural);
  if (before >= player.pa) return;
  for (const key of DRILL_ATTRS[kind]) setAttr(player.attrs, key, attr(player.attrs, key) + 1);
  hero.paid += Math.max(0, caOf(player.attrs, player.natural) - before);
}

/** The week's slots meet the matchday: drilling all three means starting a little tired. */
export function closeWeek(world: World): void {
  const hero = world.hero as Hero;
  const player = heroPlayer(world) as WorldPlayer;
  const rests = SLOTS_PER_WEEK - hero.week.length + hero.week.filter((activity) => activity === 'rest').length;
  const efforts = hero.week.filter((activity) => activity !== 'rest' && activity !== 'fanday').length;
  player.condition = clamp01(player.condition + rests * 0.03 - efforts * 0.03);
}

/**
 * Training quality as the coaching term `growthRate` expects: 1.0x for a coach-run season
 * up to 1.25x for three-star drilling, mapped onto its lerp(0.6, 1.35) (§12).
 */
export function heroCoaching(hero: Hero): number {
  const average = hero.stars.length ? hero.stars.reduce((sum, stars) => sum + stars, 0) / hero.stars.length : 1;
  const quality = lerp(1, 1.25, clamp01((average - 1) / 2));
  return (quality - 0.6) / 0.75;
}

/** The season roll grows only what the bars have not already paid out. */
export function settleHeroGrowth(hero: Hero, player: WorldPlayer, grown: number): void {
  const taken = Math.min(hero.paid, Math.max(0, grown));
  if (taken > 0) scaleToCa(player.attrs, player.natural, caOf(player.attrs, player.natural) - taken);
  hero.paid = 0;
  hero.stars = [];
}

/** Write the season into the history, before `startSeason` wipes it. */
export function closeHeroSeason(world: World): void {
  const hero = world.hero as Hero;
  const player = heroPlayer(world) as WorldPlayer;
  hero.history.season.push(world.season);
  hero.history.clubId.push(player.clubId);
  hero.history.apps.push(player.season.apps);
  hero.history.goals.push(player.season.goals);
}

/** The shelf as names, for the locker. */
export function shelfOf(hero: Hero): Milestone[] {
  return MILESTONES.filter((milestone) => hasMilestone(hero, milestone));
}

export function celebrationUnlocked(hero: Hero, index: number): boolean {
  const need = CELEBRATION_UNLOCKS[index];
  return need === null || (need !== undefined && hasMilestone(hero, need));
}

export function bootsUnlocked(hero: Hero, index: number): boolean {
  const need = BOOT_UNLOCKS[index];
  return !need || hasMilestone(hero, need);
}

/** Move him: offers accepted, a loan, or a loan ending. Coach and Team reset, Fans do not. */
export function moveHero(world: World, toClubId: number, loan: boolean): void {
  const hero = world.hero as Hero;
  const player = heroPlayer(world) as WorldPlayer;
  const from = world.clubs[player.clubId];
  const to = world.clubs[toClubId];
  if (!to || to === from) return;
  if (from) {
    from.playerIds = from.playerIds.filter((id) => id !== player.id);
    assignSquadNumbers(world, from);
  }
  to.playerIds.push(player.id);
  player.clubId = to.id;
  hero.loanFromClubId = loan && from ? from.id : -1;
  if (!loan) player.contractYears = Math.max(player.contractYears, 3);
  hero.coach = NEW_CLUB_RING;
  hero.team = NEW_CLUB_RING;
  hero.offers = [];
  hero.benchStreak = 0;
  if (to.id !== hero.firstClubId) award(hero, 'firstMove');
  assignSquadNumbers(world, to);
}

/** Hang up the boots: the next match is the farewell. */
export function announceRetirement(world: World): void {
  if (world.hero) world.hero.farewell = true;
}

/** From 33 the locker offers it; from 36 the coach suggests a testimonial; at 40 it happens. */
export function retirementStage(player: WorldPlayer): 'none' | 'offer' | 'testimonial' | 'forced' {
  if (player.age >= 40) return 'forced';
  if (player.age >= 36) return 'testimonial';
  return player.age >= 33 ? 'offer' : 'none';
}
