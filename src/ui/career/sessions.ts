// The trial and the three drills, played on the training stage (design player-career §3, §A).
//
// Turn-based on exactly the match's moment controls. What a choice does is decided by the
// pure rules in src/sim/player/drills.ts; this file only plays it out and keeps the tally.

import * as THREE from 'three';
import { lerp } from '../../core/math.js';
import type { Rng } from '../../core/rng.js';
import { interceptRisk, type BallAction } from '../../sim/match/agent.js';
import { HALF_WIDTH, PITCH_LENGTH } from '../../sim/match/pitch.js';
import type { MatchPlayer } from '../../sim/match/types.js';
import type { Attributes } from '../../sim/ratings/attributes.js';
import { aimSpread, crowdAt } from '../../sim/player/moments.js';
import {
  DRILL_LAYOUTS, DRILL_TURNS, TRIAL_LAYOUTS, dribbleBeats, gapRow, hoopPoints, keeperSlide, passArrives,
  rondoStep, shotOutcome, stageState,
} from '../../sim/player/drills.js';
import type { DrillKind } from '../../sim/player/hero.js';
import { toSceneX, toSceneZ } from '../../render/pitch.js';
import { audio } from '../../audio/audio.js';
import { el } from '../dom.js';
import { icon } from '../icons.js';
import type { Stage } from './stage.js';

export interface TrialCounts {
  shoot: number;
  pass: number;
  dribble: number;
}

/** The clipboard: one mark per turn, ticked or crossed. Wordless. */
function clipboard(stage: Stage, turns: number): (good: boolean) => void {
  const marks = el('div', { class: 'tl-clipboard', 'aria-hidden': 'true' }, [icon('clipboard', 20)]);
  for (let turn = 0; turn < turns; turn++) marks.append(el('i'));
  stage.root.querySelector('.tl-clipboard')?.remove();
  stage.root.append(marks);
  let next = 0;
  return (good) => {
    marks.querySelectorAll('i')[next++]?.classList.add(good ? 'good' : 'miss');
    audio.tick(good);
  };
}

/** A strike at the goal, the keeper reacting; resolves with what happened. */
async function strike(stage: Stage, action: BallAction & { kind: 'shoot' }, rng: Rng) {
  const state = stage.state;
  const keeper = state.away.players.find((player) => player.role === 'GK');
  const keeperFrom = keeper?.y ?? HALF_WIDTH;
  const outcome = shotOutcome(rng, action.targetY, action.targetZ, aimSpread(state, stage.hero), keeper ? keeperFrom : -99);
  const ball = state.ball;
  const fromX = ball.x;
  const fromY = ball.y;
  ball.ownerId = -1;
  stage.hero.action = 'shoot';
  stage.hero.actionTicks = 3;
  const endX = outcome.goal ? PITCH_LENGTH + 1.2 : PITCH_LENGTH - 0.6;
  await stage.play(0.8, (fraction) => {
    ball.x = lerp(fromX, endX, fraction);
    ball.y = lerp(fromY, outcome.y, fraction);
    ball.z = lerp(0.1, outcome.z, fraction) + Math.sin(Math.PI * fraction) * 0.3;
    // He reads it if it is near him and goes the wrong way if it is not.
    if (keeper) keeper.y = lerp(keeperFrom, outcome.goal ? keeperFrom - Math.sign(outcome.y - keeperFrom) * 0.6 : outcome.y, fraction);
  });
  if (outcome.goal) audio.netRipple();
  else audio.save();
  return outcome;
}

/** A pass along the chosen lane: it arrives, or the nearest defender cuts it out. */
async function pass(stage: Stage, action: BallAction & { kind: 'pass' }, rng: Rng): Promise<boolean> {
  const state = stage.state;
  const hero = stage.hero;
  const arrives = passArrives(rng, interceptRisk(state, hero, action.to.x, action.to.y, action.speed, action.loft));
  const cutBy = state.away.players.filter((player) => player.role !== 'GK')
    .sort((a, b) => Math.hypot(a.x - action.to.x, a.y - action.to.y) - Math.hypot(b.x - action.to.x, b.y - action.to.y))[0];
  const target = arrives || !cutBy ? action.to : cutBy;
  audio.kickBall(0.3);
  await stage.kickTo(target.x, target.y, 0.7);
  state.ball.ownerId = target.id;
  return arrives;
}

/** A one-two: the receiver plays it back into the hero's stride. */
async function giveAndGo(stage: Stage, from: MatchPlayer): Promise<void> {
  const hero = stage.hero;
  const run = stage.run(hero, hero.x + 5, lerp(hero.y, HALF_WIDTH, 0.5), 0.8);
  await run;
  stage.state.ball.x = from.x;
  stage.state.ball.y = from.y;
  await stage.kickTo(hero.x + 0.6, hero.y, 0.6);
  stage.state.ball.ownerId = hero.id;
}

/** Carry it at the chosen spot; a defender in the way may take it. */
async function carry(stage: Stage, action: BallAction & { kind: 'dribble' }, rng: Rng): Promise<boolean> {
  const beats = dribbleBeats(rng, crowdAt(stage.state, stage.hero, action.x, action.y), stage.hero);
  await stage.run(stage.hero, action.x, action.y, 0.9);
  if (!beats) audio.whistle('short');
  return beats;
}

/** Do whatever the choice was. True when the move carries on to another touch. */
async function perform(stage: Stage, action: BallAction, rng: Rng, tally?: TrialCounts): Promise<boolean> {
  if (action.kind === 'shoot') {
    if (tally) tally.shoot++;
    await strike(stage, action, rng);
    return false;
  }
  if (action.kind === 'pass') {
    if (tally) tally.pass++;
    if (!(await pass(stage, action, rng))) return false;
    await giveAndGo(stage, action.to);
    return true;
  }
  if (action.kind === 'dribble') {
    if (tally) tally.dribble++;
    return carry(stage, action, rng);
  }
  if (action.kind === 'cross') {
    await stage.kickTo(action.x, action.y, 0.9);
    return false;
  }
  return true;
}

/**
 * The trial: three moments, nothing read (§3). Shoot; pass to the free team-mate, then
 * shoot; take the defender on through the gap, then shoot. Returns what the kid chose.
 */
export async function playTrial(stage: Stage, rng: Rng, heroAttrs: Attributes): Promise<TrialCounts> {
  const tally: TrialCounts = { shoot: 0, pass: 0, dribble: 0 };
  const mark = clipboard(stage, TRIAL_LAYOUTS.length);
  for (const layout of TRIAL_LAYOUTS) {
    stage.setState(stageState(rng, heroAttrs, 0, layout));
    let scored = false;
    for (let touch = 0; touch < 3; touch++) {
      const { action } = await stage.ask(['shoot', 'pass', 'dribble'], 5);
      if (action.kind === 'shoot') {
        tally.shoot++;
        scored = (await strike(stage, action, rng)).goal;
        break;
      }
      if (!(await perform(stage, action, rng, tally))) break;
    }
    mark(scored);
  }
  return tally;
}

/** Cones, hoops and a mannequin's worth of props, in the renderer's own scene. */
function props(stage: Stage, kind: DrillKind): THREE.Object3D {
  const group = new THREE.Group();
  const orange = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.6 });
  if (kind === 'hoops') {
    for (const [across, height] of [[-2.9, 0.55], [2.9, 0.55], [-2.9, 1.85], [2.9, 1.85]] as const) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 8, 28), orange);
      hoop.position.set(toSceneX(PITCH_LENGTH - 0.1), height, toSceneZ(HALF_WIDTH + across));
      hoop.rotation.y = Math.PI / 2;
      group.add(hoop);
    }
  } else {
    const centreX = kind === 'gap' ? 83 : 60;
    for (let index = 0; index < 8; index++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 12), orange);
      const along = kind === 'gap' ? centreX - 10 + index * 3.2 : centreX + Math.cos(index * Math.PI / 4) * 13;
      const across = kind === 'gap' ? HALF_WIDTH + (index % 2 ? 7 : -7) : HALF_WIDTH + Math.sin(index * Math.PI / 4) * 13;
      cone.position.set(toSceneX(along), 0.25, toSceneZ(across));
      group.add(cone);
    }
  }
  stage.client.scene.add(group);
  return group;
}

/** One drill session. Returns its score; stars are the caller's, from `sessionStars`. */
export async function playDrill(stage: Stage, kind: DrillKind, rng: Rng, heroAttrs: Attributes, shirt: number): Promise<number> {
  const layout = DRILL_LAYOUTS[kind];
  stage.setState(stageState(rng, heroAttrs, shirt, layout));
  if (kind === 'rondo') stage.client.setCameraMode('broadcast');
  const scene = props(stage, kind);
  const mark = clipboard(stage, DRILL_TURNS[kind]);
  let score = 0;
  try {
    if (kind === 'hoops') {
      const keeper = stage.state.away.players[0] as MatchPlayer;
      stage.idle = (seconds) => {
        keeper.y = keeperSlide(seconds);
      };
      for (let turn = 0; turn < DRILL_TURNS.hoops; turn++) {
        const { action } = await stage.ask(['shoot']);
        stage.idle = null;
        const points = action.kind === 'shoot' ? hoopPoints(await strike(stage, action, rng)) : 0;
        score += points;
        mark(points > 0);
        stage.setState(stageState(rng, heroAttrs, shirt, layout));
        const next = stage.state.away.players[0] as MatchPlayer;
        stage.idle = (seconds) => {
          next.y = keeperSlide(seconds);
        };
      }
      stage.idle = null;
    } else if (kind === 'rondo') {
      for (let turn = 0; turn < DRILL_TURNS.rondo; turn++) {
        const { action } = await stage.ask(['pass']);
        const arrived = action.kind === 'pass' ? await pass(stage, action, rng) : true;
        mark(arrived);
        if (!arrived) break;
        score++;
        // The ball comes back and the two in the middle step to new spots.
        await stage.kickTo(stage.hero.x + 0.6, stage.hero.y, 0.5);
        stage.state.ball.ownerId = stage.hero.id;
        const spots = rondoStep(rng);
        const defenders = stage.state.away.players;
        const from = defenders.map((player) => [player.x, player.y]);
        await stage.play(0.6, (fraction) => defenders.forEach((player, index) => {
          player.x = lerp(from[index]?.[0] ?? player.x, spots[index]?.[0] ?? player.x, fraction);
          player.y = lerp(from[index]?.[1] ?? player.y, spots[index]?.[1] ?? player.y, fraction);
        }));
      }
    } else {
      for (let row = 0; row < DRILL_TURNS.gap; row++) {
        const defenders = stage.state.away.players.filter((player) => player.role !== 'GK');
        gapRow(rng, row).forEach(([x, y], index) => {
          const defender = defenders[index];
          if (defender) {
            defender.x = x;
            defender.y = y;
          }
        });
        stage.client.captureTick(stage.state);
        const { action } = await stage.ask(['dribble']);
        const beat = action.kind === 'dribble' ? await carry(stage, action, rng) : await perform(stage, action, rng);
        mark(beat);
        if (!beat) break;
        score++;
        // On to the next row: the run continues straight at the next pair.
        await stage.run(stage.hero, 76 + (row + 1) * 7 - 6, HALF_WIDTH, 0.6);
      }
    }
  } finally {
    stage.client.scene.remove(scene);
  }
  return score;
}
