// The render client: everything visual, and a read-only consumer of MatchState.
//
// The contract from design §12: this file reads the simulation and never writes to it. It
// owns the WebGLRenderer, the scene graph, and one visual subsystem per thing on the
// screen. The simulation ticks at 10Hz (physics.TICK); this interpolates between ticks and
// draws at whatever rate the display runs at, which is why the football looks smooth
// without the engine having to.

import * as THREE from 'three';
import { clamp, clamp01, damp, invLerp, lerp, TAU, wrapAngle } from '../core/math.js';
import { directionOf, type MatchEvent, type MatchState } from '../sim/match/types.js';
import { TICK } from '../sim/match/physics.js';
import { PITCH_LENGTH } from '../sim/match/pitch.js';
import { BallView } from './ball.js';
import { BroadcastCamera, dangerOf, type CameraMode, type CameraPreset } from './camera.js';
import { Director } from './director.js';
import { OFFICIAL_KIT, appearanceOf, buildOf, hashId, numberInk, type KitColors } from './appearance.js';
import { FigureField, type FigureStyle } from './figure.js';
import { OFFICIAL_COUNT, emptyOfficials, officialsFor, type Official } from './officials.js';
import {
  advancePhase,
  applyAction,
  blendPose,
  CELEBRATIONS,
  copyPose,
  isPlanted,
  emptyPose,
  idlePose,
  keeperPose,
  runPose,
  smooth,
  type ActionPose,
  type Pose,
} from './gait.js';
import { PitchScene, toSceneX, toSceneZ } from './pitch.js';
import { Stadium, type StadiumOptions } from './stadium.js';
import { blobTexture } from './textures.js';
import { Rain, paletteFor, sunDirection } from './weather.js';
import { fairConditions, type Conditions } from '../sim/match/conditions.js';
import { TIERS, crowdDensity, type QualityTier } from './tiers.js';
import { PostChain } from './post.js';
import { BallMotion, type BallDraw, type Carrier } from './ballMotion.js';
import { applyBallWork, ballWorkOffset, ballWorkSeconds, isBallWork, offsetToSim, type BallOffset, type BallWork } from './tricks.js';

/**
 * How much of the lighting comes from the environment map rather than the analytic lights.
 * The ambient and hemisphere terms are scaled down by the same token, or adding image-based
 * light would simply brighten everything.
 */
const ENV_INTENSITY = 0.55;
const FILL_SCALE = 0.55;

/** Twenty-two players plus a referee and two assistants. */
const MAX_PLAYERS = 22;
const MAX_FIGURES = MAX_PLAYERS + OFFICIAL_COUNT;

/**
 * Ceilings the pose solver is fed, not limits anybody is meant to hit.
 *
 * A little above a real sprint and a real pivot, so they clamp nothing that is working and
 * catch anything that is not. See where they are used, in captureTick.
 */
const HUMAN_SPRINT = 11;
const HUMAN_TURN = 9;

/**
 * Where in each strike the boot meets the ball, as a fraction of the action: the peaks of
 * the hip tracks in gait.ts's 'kick' (0.35) and 'pass' (0.45), a touch early so the ball
 * is moving as the leg goes through it rather than after.
 */
const KICK_CONTACT = 0.33;
const PASS_CONTACT = 0.42;

/**
 * Where the sun starts. No longer a constant: `applyConditions` moves it with the time of
 * day, and two other things follow it — the shadow ortho volume, and the contact blobs,
 * which are stretched ALONG it. A blob directly under a player is what a light straight
 * overhead would cast, and the light is only straight overhead under floodlights.
 */
const DEFAULT_KEY_DIR = new THREE.Vector3(0.42, 1, 0.3).normalize();

/** Per-figure visual state: where he was, where he is, and what his legs are doing. */
interface Visual {
  id: number;
  prevX: number;
  prevZ: number;
  prevFacing: number;
  currX: number;
  currZ: number;
  currFacing: number;
  phase: number;
  speed: number;
  turnRate: number;
  action: ActionPose | BallWork | null;
  actionT: number;
  actionLen: number;
  footed: 0 | 1;
  keeper: boolean;
  live: boolean;
  /** Which feet were down last frame, so a plant is an edge and not a level. */
  planted: [boolean, boolean];
  /** Which team, for who celebrates and who does not. Officials are null. */
  side: 'home' | 'away' | null;
  /** Sim velocity at the last tick, so the legs know which way they are running. */
  vx: number;
  vz: number;
  /** 0..1, from the sim. A blown player stands like one. */
  stamina: number;
  /** Smoothed lower-body heading against the chest, and the head's turn toward the ball. */
  legYaw: number;
  headYaw: number;
  /** Running backwards: the cycle plays in reverse. Latched with hysteresis. */
  back: boolean;
  /** Celebration pick and dive side for the current action. */
  variant: number;
  actionFoot: 0 | 1;
  /** Sim velocity at the tick before, so the path between ticks is a curve, not a polyline. */
  pvx: number;
  pvz: number;
  /**
   * Speed as the legs see it: smoothed across ticks. The raw figure changes in 10Hz steps,
   * and a stride rate that steps ten times a second is a stutter in every run.
   */
  gaitSpeed: number;
  /** Smoothed change of speed, m/s². Drives the lean into a burst and back off a brake. */
  accel: number;
  /** Speed at the previous tick, for the acceleration. */
  lastSpeed: number;
  /** This frame's drawn position and facing, sim coordinates — the ball is placed off them. */
  drawX: number;
  drawZ: number;
  drawFacing: number;
}

function emptyVisual(): Visual {
  return {
    id: -1, prevX: 0, prevZ: 0, prevFacing: 0, currX: 0, currZ: 0, currFacing: 0,
    phase: 0, speed: 0, turnRate: 0, action: null, actionT: 0, actionLen: 1, footed: 1,
    keeper: false, live: false, planted: [false, false], side: null, vx: 0, vz: 0,
    stamina: 1, legYaw: 0, headYaw: 0, back: false, variant: 0, actionFoot: 1,
    pvx: 0, pvz: 0, gaitSpeed: 0, accel: 0, lastSpeed: 0, drawX: 0, drawZ: 0, drawFacing: 0,
  };
}

export interface RenderOptions {
  canvas: HTMLCanvasElement;
  tier?: number;
  reducedMotion?: boolean;
  /**
   * Called when the player on the ball plants a foot.
   *
   * The carrier only. Twenty-five figures each planting twice a stride is four hundred
   * events a second at 24x speed, which is not footsteps, it is a drum roll — and the one
   * pair of feet a viewer is actually watching is the pair with the ball at them.
   */
  onFootPlant?: (simX: number, simY: number, speed: number) => void;
  /** The modelled crowd, as the settings word it, and the stands' fire and light. */
  crowd?: 'auto' | 'full' | 'half' | 'off';
  stadiumFx?: boolean;
  /** How the players are drawn: low-poly with painted skins, or sculpted. */
  playerStyle?: FigureStyle;
}

/**
 * What the managed club has chosen for a match: its ball, always, and its roof when the
 * match is at its own ground. Absent fields keep the defaults.
 */
export interface MatchDress {
  /** A BALL_STYLES index and the club colours the club designs are painted in. */
  ball?: { style: number; primary: number; secondary: number };
  roof?: number;
}

export class RenderClient {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly cam: BroadcastCamera;
  #pitch: PitchScene;
  #stadium: Stadium;
  /** How much of the ground is modelled, fixed for the match (settings: graphics). */
  #groundOpts: StadiumOptions;
  #figures: FigureField;
  #ball: BallView;
  #shadows: THREE.InstancedMesh | null = null;
  #shadowDisposables: { dispose(): void }[] = [];
  #visuals: Visual[] = [];
  #pose: Pose = emptyPose();
  /** The standing pose, blended against the run so stopping is not a snap. */
  #rest: Pose = emptyPose();
  /** Ball height at the last tick: a strike above the shoulders is a header. */
  #ballZ = 0;
  #ballX = 0;
  #ballY = 0;
  /** Ball speed at the last tick, m/s: how hard a goal hits the net. */
  #ballSpeed = 0;
  /** Where the ball is drawn: see ballMotion.ts for why that is not where the sim has it. */
  #ballMotion = new BallMotion(TICK);
  #ballDraw: BallDraw = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  #carrier: Carrier = {
    id: -1, x: 0, y: 0, facing: 0, vx: 0, vy: 0, phase: 0, foot: 1, trickX: 0, trickY: 0, trickZ: 0, touch: 1,
    gather: 0,
  };
  #trickOffset: BallOffset = { side: 0, fwd: 0, up: 0 };
  #trickSim = { x: 0, y: 0 };
  #tier: number;
  #clock = 0;
  #danger = 0;
  #reducedMotion: boolean;
  #dummy = new THREE.Object3D();
  #key!: THREE.DirectionalLight;
  #ambient!: THREE.AmbientLight;
  #hemi!: THREE.HemisphereLight;
  #keyDir = new THREE.Vector3();
  #shadowYaw = 0;
  #rain: Rain | null = null;
  #conditions: Conditions = fairConditions();
  #officials: Official[] = emptyOfficials();
  #onFootPlant: RenderOptions['onFootPlant'];
  /** A harness-only camera override: see setDebugView. */
  #debugView: { pos: [number, number, number]; target: [number, number, number]; fov?: number } | null = null;
  #post: PostChain | null = null;
  /** What the viewer chose. 'tv' hands the choice of preset to the director. */
  #cameraMode: CameraMode = 'broadcast';
  #director = new Director();
  /** Match seconds per real second, for the director's sense of how long a restart lasts. */
  #pace = 1;
  /** A short forced shot — the grass after a goal — that overrides the mode, and for how long. */
  #cutaway: CameraPreset | null = null;
  #cutawayLeft = 0;
  /** Who the player camera is riding behind. Sticky, so a loose ball does not flick it about. */
  #focusId = -1;
  #pmrem: THREE.PMREMGenerator;
  #envTarget: THREE.WebGLRenderTarget | null = null;

  constructor(opts: RenderOptions) {
    this.#tier = opts.tier ?? 2;
    this.#reducedMotion = opts.reducedMotion ?? false;
    this.#onFootPlant = opts.onFootPlant;
    const tier = TIERS[this.#tier] as QualityTier;

    this.renderer = new THREE.WebGLRenderer({
      canvas: opts.canvas,
      // Antialiasing on a high-DPI screen is paying twice for the same edge.
      antialias: (window.devicePixelRatio || 1) < 2,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setClearColor(0x9fcdec, 1);
    this.renderer.shadowMap.enabled = tier.shadowMap;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.#pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environmentIntensity = ENV_INTENSITY;

    // A bright afternoon: strong warm key from high and to one side, a big cool sky
    // bounce, and enough ambient that nothing on a player's shaded side goes black.
    // Post-r155 physical units, so these run higher than pre-155 intuition suggests.
    //
    // Less fill than the first version had. Flat lighting is what made twenty-two chunky
    // figures read as twenty-two smudges: with no shaded side there is no silhouette,
    // and silhouette is the whole of design §9's "motion reads through silhouette".
    this.#ambient = new THREE.AmbientLight(0xd8e6f2, 0.85);
    this.scene.add(this.#ambient);
    this.#hemi = new THREE.HemisphereLight(0xbfe0ff, 0x4e7f45, 1.5);
    this.scene.add(this.#hemi);
    const key = new THREE.DirectionalLight(0xfff4e0, 3.6);
    this.#key = key;
    this.#keyDir.copy(DEFAULT_KEY_DIR);
    this.#shadowYaw = Math.atan2(this.#keyDir.x, this.#keyDir.z);
    key.position.copy(this.#keyDir).multiplyScalar(120);
    key.castShadow = true;
    // One ortho volume over the whole pitch. 130×95 across a 2048 map is a 6cm texel,
    // which is finer than a boot.
    key.shadow.mapSize.set(tier.shadowRes, tier.shadowRes);
    key.shadow.camera.left = -66;
    key.shadow.camera.right = 66;
    key.shadow.camera.top = 50;
    key.shadow.camera.bottom = -50;
    key.shadow.camera.near = 40;
    key.shadow.camera.far = 260;
    key.shadow.bias = -0.0012;
    key.shadow.normalBias = 0.035;
    this.scene.add(key);
    this.scene.add(key.target);

    // Aerial haze. The far stand is 110 metres away and a stadium that far off is never
    // the same colour as the one you are standing in.
    this.scene.fog = new THREE.Fog(0xb6d8ef, 150, 460);

    this.cam = new BroadcastCamera(1);
    this.cam.setReducedMotion(this.#reducedMotion);

    this.#pitch = new PitchScene(tier.pitchDetail);
    this.scene.add(this.#pitch.group);
    this.#groundOpts = { crowd: crowdDensity(opts.crowd ?? 'auto', this.#tier), fx: opts.stadiumFx ?? true };
    this.#stadium = new Stadium(0x1d5a, undefined, this.#groundOpts);
    this.scene.add(this.#stadium.group);
    this.#figures = new FigureField(MAX_FIGURES, tier.bodyCell, opts.playerStyle ?? 'retro');
    this.#figures.setCastShadow(tier.shadowMap);
    this.#figures.setReceiveShadow(tier.shadowMap);
    this.scene.add(this.#figures.group);
    this.#ball = new BallView();
    this.#ball.setCastShadow(tier.shadowMap);
    this.scene.add(this.#ball.group);

    for (let i = 0; i < MAX_FIGURES; i++) this.#visuals.push(emptyVisual());
    if (tier.playerShadows) this.#buildShadows();
    this.#pitch.setReceiveShadow(tier.shadowMap);
    if (tier.rain) this.#buildRain();
    if (tier.post) this.#buildPost();
    this.resize();
  }

  get tier(): number {
    return this.#tier;
  }

  /** Swap quality tier. Rebuilds only what the tier actually changes. */
  applyTier(index: number): void {
    const next = TIERS[index];
    if (!next || index === this.#tier) return;
    const prev = TIERS[this.#tier] as QualityTier;
    this.#tier = index;

    if (next.pitchDetail !== prev.pitchDetail) {
      this.scene.remove(this.#pitch.group);
      this.#pitch.dispose();
      this.#pitch = new PitchScene(next.pitchDetail);
      this.scene.add(this.#pitch.group);
    }
    this.#pitch.setReceiveShadow(next.shadowMap);
    if (next.playerShadows !== prev.playerShadows) {
      if (next.playerShadows) this.#buildShadows();
      else this.#dropShadows();
    }
    if (next.rain !== prev.rain) {
      if (next.rain) this.#buildRain();
      else this.#dropRain();
    }
    if (next.post !== prev.post) {
      if (next.post) this.#buildPost();
      else this.#dropPost();
    }
    if (next.shadowRes !== prev.shadowRes) {
      this.#key.shadow.mapSize.set(next.shadowRes, next.shadowRes);
      this.#key.shadow.map?.dispose();
      this.#key.shadow.map = null;
    }
    if (next.shadowMap !== prev.shadowMap) {
      this.renderer.shadowMap.enabled = next.shadowMap;
      this.#figures.setCastShadow(next.shadowMap);
      this.#figures.setReceiveShadow(next.shadowMap);
      this.#ball.setCastShadow(next.shadowMap);
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.resize();
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const tier = TIERS[this.#tier] as QualityTier;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * tier.renderScale);
    this.renderer.setSize(w, h, false);
    this.#post?.setSize(w, h, this.renderer.getPixelRatio());
    this.cam.setAspect(w / Math.max(h, 1));
  }

  /** Kept for the harnesses: a preset is a mode that never changes by itself. */
  setCameraPreset(p: CameraPreset): void {
    this.setCameraMode(p);
  }

  /** Choose a camera, or 'tv' to let the director choose. Cancels any cutaway. */
  setCameraMode(mode: CameraMode): void {
    this.#cameraMode = mode;
    this.#cutaway = null;
    this.#cutawayLeft = 0;
    if (mode === 'tv') this.#director.reset();
    this.cam.setPreset(mode === 'tv' ? this.#director.shot : mode);
  }

  get cameraMode(): CameraMode {
    return this.#cameraMode;
  }

  /** The preset actually on screen — the director's pick in TV mode, or a cutaway. */
  get liveShot(): CameraPreset {
    return this.cam.preset;
  }

  /** The player the camera and the HUD consider to be on the ball, or -1. */
  get focusId(): number {
    return this.#focusId;
  }

  /** Tell the director how fast the match is running. */
  setPace(speed: number): void {
    this.#pace = speed;
  }

  /**
   * Cut to `preset` for `seconds`, then back to whatever the mode says. The grass after a
   * goal. Ignored when the viewer has chosen a fixed camera other than the main one: a kid
   * who picked the tactical view picked it to see shape, not a celebration.
   */
  cutaway(preset: CameraPreset, seconds: number): void {
    if (this.#cameraMode !== 'tv' && this.#cameraMode !== 'broadcast') return;
    this.#cutaway = preset;
    this.#cutawayLeft = seconds;
    this.cam.setPreset(preset);
  }

  /** Decide which preset is live this frame: cutaway, then director, then the mode. */
  #directShot(state: MatchState, dt: number): void {
    if (this.#cutaway) {
      this.#cutawayLeft -= dt;
      if (this.#cutawayLeft > 0) return;
      this.#cutaway = null;
      if (this.#cameraMode === 'tv') this.#director.reset();
      this.cam.setPreset(this.#cameraMode === 'tv' ? this.#director.shot : this.#cameraMode);
      return;
    }
    if (this.#cameraMode !== 'tv') return;
    const cut = this.#director.update({
      play: state.play.kind,
      danger: this.#danger,
      pace: this.#pace,
      reducedMotion: this.#reducedMotion,
    }, dt);
    if (cut) this.cam.setPreset(this.#director.shot);
  }

  /**
   * The man on the ball, or the one it is travelling to, or failing both whoever was last
   * followed — and only if there is nobody at all, the player nearest the ball. Written
   * into `#focus`, in simulation coordinates, with the heading the player camera wants.
   */
  #findFocus(state: MatchState, bx: number, by: number): void {
    const ball = state.ball;
    const want = ball.ownerId >= 0 ? ball.ownerId : ball.intendedReceiverId >= 0 ? ball.intendedReceiverId : this.#focusId;
    let pick: Visual | null = null;
    let best = Infinity;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const v = this.#visuals[i] as Visual;
      if (!v.live || v.side === null) continue;
      if (v.id === want) {
        pick = v;
        break;
      }
      const d = (v.drawX - bx) ** 2 + (v.drawZ - by) ** 2;
      if (d < best) {
        best = d;
        pick = v;
      }
    }
    const f = this.#focus;
    if (!pick || pick.side === null) {
      f.ok = false;
      return;
    }
    this.#focusId = pick.id;
    f.ok = true;
    f.x = pick.drawX;
    f.y = pick.drawZ;
    // Looking the way his side attacks, pulled round toward the way he is running. Pure
    // velocity would spin the camera every time he checks back; pure attack direction
    // would film a winger's run down the line side-on.
    const dir = directionOf(pick.side, state.period);
    f.heading = Math.atan2(pick.vz * 0.25, dir * 2 + pick.vx * 0.25);
  }

  #focus = { ok: false, x: 0, y: 0, heading: 0 };

  /**
   * Dress the ground in the home club's colours. Separate from `applyKits` because the
   * crowd is a set of generated textures and rebuilding them on every substitution would
   * be absurd; the stands do not change when a winger comes off.
   */
  applyGround(state: MatchState, dress: MatchDress = {}): void {
    this.scene.remove(this.#stadium.group);
    this.#stadium.dispose();
    this.#stadium = new Stadium(state.home.clubId * 2654435761 % 0x7fffffff, {
      primary: state.home.kitPrimary,
      secondary: state.home.kitSecondary,
      name: state.home.name,
      ...(dress.roof !== undefined ? { roof: dress.roof } : {}),
    }, this.#groundOpts);
    if (dress.ball) this.#ball.setStyle(dress.ball.style, dress.ball);
    this.scene.add(this.#stadium.group);
    // A rebuilt stadium is a fresh sky shader, so the weather has to be told again.
    this.applyConditions(this.#conditions);
  }

  /**
   * Team colours and player builds. Called once at kickoff and again after a substitution.
   *
   * The kit is the club's; the skin, the hair, the boots and the height are the player's
   * own and come from his id, so he is recognisably himself for a whole career.
   */
  applyKits(state: MatchState): void {
    let i = 0;
    for (const team of [state.home, state.away]) {
      // Socks take the shirt colour, which is how a kit is actually built: the shorts are
      // the odd band out, and that is what makes a running figure read as three parts.
      const kit: KitColors = team.trim
        ? { ...team.trim, shirt: team.kitPrimary, number: team.trim.number ?? numberInk(team.kitPrimary, team.kitSecondary) }
        : {
          shirt: team.kitPrimary, shorts: team.kitSecondary, sock: team.kitPrimary,
          number: numberInk(team.kitPrimary, team.kitSecondary),
        };
      for (const p of team.players) {
        if (i >= MAX_PLAYERS) break;
        // A keeper wears something else, so he is findable at a glance.
        const worn: KitColors =
          p.role === 'GK' ? { shirt: 0x2fbf6b, shorts: 0x18324a, sock: 0x2fbf6b, number: 0x0e2a1a } : kit;
        this.#figures.setColors(i, appearanceOf(p.id, worn, p.shirt));
        this.#figures.setBuild(i, buildOf(p.id));
        i++;
      }
    }
    // The officials, in black, so nobody mistakes one for a twelfth man.
    for (let k = 0; k < OFFICIAL_COUNT; k++) {
      this.#figures.setColors(MAX_PLAYERS + k, appearanceOf(9001 + k, OFFICIAL_KIT));
      this.#figures.setBuild(MAX_PLAYERS + k, buildOf(9001 + k));
    }
  }

  /**
   * Take a snapshot at a simulation tick. Everything drawn between two ticks is
   * interpolated between the last two of these.
   */
  captureTick(state: MatchState): void {
    let i = 0;
    for (const team of [state.home, state.away]) {
      for (const p of team.players) {
        if (i >= MAX_PLAYERS) break;
        const v = this.#visuals[i] as Visual;
        const wasLive = v.live && v.id === p.id;
        v.id = p.id;
        v.live = p.onPitch && !p.sentOff;
        v.prevX = wasLive ? v.currX : p.x;
        v.prevZ = wasLive ? v.currZ : p.y;
        v.prevFacing = wasLive ? v.currFacing : p.facing;
        v.pvx = wasLive ? v.vx : p.vx;
        v.pvz = wasLive ? v.vz : p.vy;
        v.currX = p.x;
        v.currZ = p.y;
        v.currFacing = p.facing;
        v.speed = Math.hypot(p.vx, p.vy);
        v.accel = wasLive ? (v.speed - v.lastSpeed) / TICK : 0;
        v.lastSpeed = v.speed;
        if (!wasLive) v.gaitSpeed = v.speed;
        v.turnRate = wrapAngle(v.currFacing - v.prevFacing) / 0.1;
        v.footed = (p.shirt % 2) as 0 | 1;
        v.keeper = p.role === 'GK';
        v.side = team.side;
        v.vx = p.vx;
        v.vz = p.vy;
        v.stamina = p.stamina;
        i++;
      }
    }
    for (; i < MAX_PLAYERS; i++) {
      const v = this.#visuals[i] as Visual;
      if (v.live) this.#figures.hide(i);
      v.live = false;
    }

    // The officials. Derived from the state rather than simulated in it — the engine has
    // no referee, and giving it one would be a change to the thing that decides matches
    // for the sake of something only the camera can see.
    //
    // `#officials` is passed in and mutated rather than rebuilt because it is the
    // officials' only memory of where they were: `officialsFor` walks them toward their
    // targets at a human speed, and it can only do that if the array it is handed is the
    // one it wrote last tick.
    officialsFor(state, this.#officials, TICK);
    for (let k = 0; k < OFFICIAL_COUNT; k++) {
      const o = this.#officials[k] as Official;
      const v = this.#visuals[MAX_PLAYERS + k] as Visual;
      const wasLive = v.live;
      v.id = -100 - k;
      v.live = true;
      v.prevX = wasLive ? v.currX : o.x;
      v.prevZ = wasLive ? v.currZ : o.y;
      v.prevFacing = wasLive ? v.currFacing : o.facing;
      v.pvx = v.vx;
      v.pvz = v.vz;
      v.currX = o.x;
      v.currZ = o.y;
      v.currFacing = o.facing;
      // Belt and braces on top of the speed limits in officials.ts. The gait solver takes
      // `speed` as metres per second and `turnRate` as radians per second and has no upper
      // bound of its own, so a discontinuity anywhere upstream — a snap at half time, a
      // future set-piece reposition — would come out as a figure with spinning legs rather
      // than as a visible error. HUMAN_SPRINT is faster than any official is allowed to
      // run, so this clamp never fires in normal play.
      v.speed = Math.min(Math.hypot(v.currX - v.prevX, v.currZ - v.prevZ) / TICK, HUMAN_SPRINT);
      v.turnRate = clamp(wrapAngle(v.currFacing - v.prevFacing) / TICK, -HUMAN_TURN, HUMAN_TURN);
      v.keeper = false;
      v.side = null;
      v.vx = (v.currX - v.prevX) / TICK;
      v.vz = (v.currZ - v.prevZ) / TICK;
      v.accel = (v.speed - v.lastSpeed) / TICK;
      v.lastSpeed = v.speed;
      v.stamina = 1;
    }
    this.#ballMotion.capture(state.ball);
    this.#ballX = state.ball.x;
    this.#ballY = state.ball.y;
    this.#ballZ = state.ball.z;
    this.#ballSpeed = Math.hypot(state.ball.vx, state.ball.vy, state.ball.vz);
  }

  /** The stands react: `lift` 0..1 (crowdReact.ts's standLift). */
  crowdReact(lift: number): void {
    if (lift > 0) this.#stadium.react(lift);
  }

  /** A Mexican wave round the ground. */
  crowdWave(seconds = 6): void {
    this.#stadium.wave(seconds);
  }

  /** React to what just happened. Actions and camera kicks live here. */
  handleEvent(e: MatchEvent): void {
    switch (e.type) {
      case 'goal': {
        this.cam.kick(0.5);
        this.#stadium.roar();
        // The barra is the HOME end: its flares are for a goal that counts for the home
        // side, whoever put it in. `side` is the scorer's, so an own goal flips it.
        if ((e.side === 'home') !== e.ownGoal) this.#stadium.homeGoal();
        this.#pitch.netHit(this.#ballX < PITCH_LENGTH / 2 ? 0 : 1, toSceneZ(this.#ballY), this.#ballZ, this.#ballSpeed);
        // The side that scored celebrates, whoever put it in; the other side does not.
        for (const v of this.#visuals) {
          if (!v.live || v.side === null) continue;
          if (v.side === e.side) {
            if (v.id === e.by && !e.ownGoal) continue;
            this.#startAction(v.id, 'cheer', 3 + (hashId(v.id, 0x3c1) % 100) / 200);
          } else {
            this.#startAction(v.id, 'dejected', 3.4);
          }
        }
        if (!e.ownGoal) this.#startAction(e.by, 'celebrate', 3.8, hashId(e.by, 0xce1) % CELEBRATIONS);
        break;
      }
      case 'shot':
        // Above the shoulders it was not a kick.
        if (this.#ballZ > 1.25) this.#startAction(e.by, 'header', 0.6);
        else this.#strike(e.by, 'kick', 0.48, KICK_CONTACT);
        // Every phone in the ground comes up for a shot.
        this.#stadium.flash(0.5 + this.#danger * 0.5);
        break;
      case 'pass':
        if (this.#ballZ > 1.25) this.#startAction(e.from, 'header', 0.55);
        else if (e.long) this.#strike(e.from, 'kick', 0.44, KICK_CONTACT);
        else this.#strike(e.from, 'pass', 0.34, PASS_CONTACT);
        break;
      case 'passComplete': {
        // The first touch. A ball arriving at chest height is killed on the chest; anything
        // lower is met with the inside of the foot. A header won is its own action already.
        const z = this.#ballZ;
        if (z > 0.9 && z < 1.7) this.#startAction(e.to, 'chest', ballWorkSeconds('chest'));
        else if (z <= 0.9) this.#startAction(e.to, 'control', ballWorkSeconds('control'), 0, undefined, true);
        break;
      }
      case 'skill': {
        const foot = (hashId(e.by, this.#clock * 10 | 0) & 1) as 0 | 1;
        this.#startAction(e.by, e.move, ballWorkSeconds(e.move), 0, foot);
        // Sold: the defender goes the way the trick told him to. When he had already gone
        // in (beat), his own slide is the reaction, and it is already playing.
        if (!e.beat) this.#startAction(e.on, 'wrongFooted', ballWorkSeconds('wrongFooted'), 0, foot === 0 ? 1 : 0, true);
        break;
      }
      case 'save': {
        this.cam.kick(0.22);
        if (e.spectacular) {
          // Dive toward the ball: which side of him it is, in his own frame.
          const v = this.#visuals.find((x) => x.live && x.id === e.by);
          let foot: 0 | 1 = 1;
          if (v) {
            const rel = wrapAngle(Math.atan2(this.#ballY - v.currZ, this.#ballX - v.currX) - v.currFacing);
            // The figure's +X is its left, and a ball at a positive relative angle is on
            // its local -X side (see #legYawFor); a positive roll tips toward +X.
            foot = -Math.sin(rel) > 0 ? 1 : 0;
          }
          this.#startAction(e.by, 'dive', 1.05, 0, foot);
        } else {
          this.#startAction(e.by, 'catch', 0.9);
        }
        break;
      }
      case 'tackle':
        this.cam.kick(0.1);
        this.#startAction(e.by, 'tackle', 0.7);
        break;
      case 'foul':
        this.cam.kick(0.18);
        this.#startAction(e.by, 'tackle', 0.8);
        this.#startAction(e.on, 'fall', 2.4);
        break;
      default:
        break;
    }
  }

  /**
   * Draw a frame. `alpha` is how far between the last two simulation ticks we are, so the
   * football is smooth however far apart the ticks land.
   */
  frame(state: MatchState, dt: number, alpha: number): void {
    this.#clock += dt;
    const a = clamp01(alpha);

    for (let i = 0; i < MAX_FIGURES; i++) {
      const v = this.#visuals[i] as Visual;
      if (!v.live) continue;

      // A curve between ticks, not a straight line: each tick's velocity is the tangent at
      // that end, so a player bending a run draws a bend rather than ten corners a second.
      const [simX, simZ] = pathAt(v, a);
      const facing = v.prevFacing + wrapAngle(v.currFacing - v.prevFacing) * a;
      v.gaitSpeed = damp(v.gaitSpeed, v.speed, 9, dt);
      const gs = v.gaitSpeed;

      // Which way the legs are going, against where the chest faces. Backwards is its own
      // gait, latched with a little hysteresis so a player drifting across the threshold
      // does not flip his hips every frame.
      const moving = gs > 0.6;
      const rel = moving ? wrapAngle(Math.atan2(v.vz, v.vx) - facing) : 0;
      if (!moving) v.back = false;
      else if (!v.back && Math.abs(rel) > 2.25) v.back = true;
      else if (v.back && Math.abs(rel) < 1.85) v.back = false;
      const wantLeg = !moving ? 0 : v.back ? legYawFor(wrapAngle(rel - Math.PI), 0.9) : legYawFor(rel, 1.2);
      v.legYaw = damp(v.legYaw, wantLeg, 7, dt);

      v.phase = v.back
        ? (v.phase - advancePhase(0, gs, dt) + TAU) % TAU
        : advancePhase(v.phase, gs, dt);

      // Locomotion and standing are computed separately and blended by speed, so a player
      // pulling up does not snap from one to the other.
      const run = clamp01(invLerp(0.2, 1.1, gs));
      if (run < 1) {
        if (v.keeper) {
          // A keeper standing like an outfielder is the thing that most says "not football".
          // He sets as the ball comes toward him, which also makes him the one figure on
          // the pitch whose posture tells you where the danger is.
          const near = Math.hypot(state.ball.x - simX, state.ball.y - simZ);
          keeperPose(this.#rest, this.#clock + i * 0.7, clamp01(1 - near / 42));
        } else {
          idlePose(this.#rest, this.#clock + i * 0.7, lerp(0.35, 1, clamp01(v.stamina * 1.4 - 0.2)), v.id >>> 0);
        }
      }
      if (run > 0) {
        runPose(this.#pose, v.phase, gs, v.turnRate, 1);
        // Sideways is upright and backwards leans a touch back; only forward leans in.
        const side = Math.abs(v.legYaw) / 1.2;
        this.#pose.lean *= v.back ? -0.35 : 1 - 0.6 * side;
        // Into a burst and back off a brake. The lean the run cycle gives is the lean of a
        // steady speed; a sprinter getting going is further over than that, and a man
        // pulling up sits back on his heels. Without it every change of pace is invisible
        // until the legs catch up with it.
        v.accel = damp(v.accel, 0, 3, dt);
        this.#pose.lean += clamp(v.accel * 0.045, -0.22, 0.24) * (v.back ? -0.5 : 1);
        this.#pose.headPitch = -(this.#pose.lean + this.#pose.chest) * 0.8;
        this.#pose.legYaw = v.legYaw;
        // The chest stays square to the play as the hips turn under it.
        this.#pose.twist *= 1 - 0.5 * side;
        if (run < 1) {
          blendPose(this.#rest, this.#pose, run);
          copyPose(this.#pose, this.#rest);
        }
      } else {
        copyPose(this.#pose, this.#rest);
      }

      // Everybody watches the ball. The head turns up to about 70°, and the chest takes
      // some of anything beyond that. The player on the ball looks down at it.
      const toBall = wrapAngle(Math.atan2(state.ball.y - simZ, state.ball.x - simX) - facing);
      const wantHead = clamp(-toBall, -1.25, 1.25);
      v.headYaw = damp(v.headYaw, wantHead, 6, dt);
      this.#pose.headYaw = v.headYaw;
      this.#pose.twist += clamp(-toBall - v.headYaw, -0.5, 0.5) * 0.45;
      if (v.id === state.ball.ownerId) this.#pose.headPitch += 0.32;
      else if (state.ball.z > 2) this.#pose.headPitch -= clamp((state.ball.z - 2) * 0.08, 0, 0.35);

      if (v.action) {
        v.actionT += dt / v.actionLen;
        if (v.actionT >= 1) {
          v.action = null;
          v.actionT = 0;
        } else if (isBallWork(v.action)) {
          applyBallWork(this.#pose, v.action, v.actionT, v.actionFoot);
        } else {
          applyAction(this.#pose, v.action, v.actionT, v.actionFoot, v.variant);
        }
      }
      v.drawX = simX;
      v.drawZ = simZ;
      v.drawFacing = facing;

      // A footstep is the moment a foot goes from up to down.
      if (this.#onFootPlant && v.id === state.ball.ownerId && gs > 1.2) {
        for (const leg of [0, 1] as const) {
          const down = isPlanted(v.phase, leg, gs);
          if (down && !v.planted[leg]) this.#onFootPlant(simX, simZ, v.speed);
          v.planted[leg] = down;
        }
      }

      // The pose's own sideways shift and extra turn, which only tricks use, are applied
      // at the root: a feint moves the whole man, and a roulette turns all of him.
      const sideX = Math.sin(facing) * this.#pose.shift;
      const sideZ = -Math.cos(facing) * this.#pose.shift;
      const sx = toSceneX(simX) + sideX;
      const sz = toSceneZ(simZ) + sideZ;
      this.#figures.setPose(i, sx, sz, facing - this.#pose.yaw, this.#pose);
      if (this.#shadows) {
        // Offset and stretched along the sun, not a disc centred on the boots. The lean
        // is small — this is the contact darkening under a player, with the real cast
        // shadow (when the tier has one) doing the long throw.
        this.#dummy.position.set(sx - this.#keyDir.x * 0.45, 0.015, sz - this.#keyDir.z * 0.45);
        this.#dummy.rotation.set(-Math.PI / 2, 0, this.#shadowYaw);
        this.#dummy.scale.set(0.8, 1.45, 1);
        this.#dummy.updateMatrix();
        this.#shadows.setMatrixAt(i, this.#dummy.matrix);
      }
    }
    this.#figures.flush();
    if (this.#shadows) this.#shadows.instanceMatrix.needsUpdate = true;

    const b = this.#drawBall(a, dt);
    this.#ball.update(b.x, b.y, b.z, b.vx, b.vy, dt, b.vz);
    this.#stadium.setDanger(this.#danger);
    this.#stadium.update(dt);
    this.#pitch.update(dt);
    this.#rain?.update(dt, this.cam.camera);

    const want = dangerOf(b.x, b.y);
    this.#danger = damp(this.#danger, want, 2.5, dt);
    this.#directShot(state, dt);
    this.#findFocus(state, b.x, b.y);
    const f = this.#focus;
    this.cam.update({
      ballX: b.x, ballY: b.y, ballZ: b.z, ballVX: b.vx, ballVY: b.vy, danger: this.#danger,
      ...(f.ok ? { focusX: f.x, focusY: f.y, focusHeading: f.heading } : {}),
    }, dt);
    if (this.#debugView) {
      const c = this.cam.camera;
      const d = this.#debugView;
      c.position.set(d.pos[0], d.pos[1], d.pos[2]);
      c.lookAt(d.target[0], d.target[1], d.target[2]);
      if (d.fov && c.fov !== d.fov) {
        c.fov = d.fov;
        c.updateProjectionMatrix();
      }
    }

    this.#ball.updateTrail(dt, this.cam.camera, this.renderer.domElement.height);
    if (this.#post) this.#post.render(dt);
    else this.renderer.render(this.scene, this.cam.camera);
  }

  /**
   * Where the ball is drawn this frame: flying on its interpolated curve, or at the feet of
   * the figure it belongs to, with that figure's trick on top. ballMotion.ts has the why.
   */
  #drawBall(alpha: number, dt: number): BallDraw {
    const id = this.#ballMotion.carrierId;
    let carrier: Carrier | null = null;
    if (id >= 0) {
      const v = this.#visuals.find((x) => x.live && x.id === id);
      if (v) {
        const c = this.#carrier;
        c.id = v.id;
        c.x = v.drawX;
        c.y = v.drawZ;
        c.facing = v.drawFacing;
        c.vx = v.vx;
        c.vy = v.vz;
        c.phase = v.phase;
        c.foot = v.footed;
        c.touch = 1;
        c.gather = 0;
        c.trickX = c.trickY = c.trickZ = 0;
        if (v.action && isBallWork(v.action)) {
          ballWorkOffset(this.#trickOffset, v.action, v.actionT, v.actionFoot);
          // A trick's path is in the frame the figure was facing when it began, which is
          // the sim's facing — the extra turn of a roulette is drawn, not steered.
          offsetToSim(this.#trickOffset, v.drawFacing, this.#trickSim);
          c.trickX = this.#trickSim.x;
          c.trickY = this.#trickSim.y;
          c.trickZ = this.#trickOffset.up;
          c.touch = 0;
          // Drawn in to his feet for the move and let out again after it.
          const k = v.actionT;
          c.gather = v.action === 'control' || v.action === 'chest' ? 0 : smooth(k / 0.15) * smooth((1 - k) / 0.25);
        } else if (v.action === 'kick' || v.action === 'pass') {
          // The boot meets it about half a metre out, whatever speed he was carrying it at.
          c.touch = 0;
          c.gather = 0.5;
        }
        carrier = c;
      }
    }
    return this.#ballMotion.evaluate(this.#ballDraw, alpha, dt, carrier);
  }

  /**
   * Point the camera somewhere by hand, in scene coordinates, or hand it back with null.
   *
   * For the close-up contact sheet only (scripts/closeups.mjs). The broadcast camera never
   * gets near enough to a player to judge a knee or a boot, and a model that is only ever
   * judged from forty metres away is a model nobody is judging.
   */
  setDebugView(v: { pos: [number, number, number]; target: [number, number, number]; fov?: number } | null): void {
    this.#debugView = v;
    if (!v) this.cam.setAspect(this.cam.camera.aspect);
  }

  /** Scene position of a live figure, for the close-up harness. */
  debugFigure(playerId: number): [number, number] | null {
    const v = this.#visuals.find((x) => x.live && x.id === playerId);
    return v ? [toSceneX(v.currX), toSceneZ(v.currZ)] : null;
  }

  /** Snap the camera, e.g. after a cut or on the first frame. */
  resetCamera(state: MatchState): void {
    this.cam.reset({ ballX: state.ball.x, ballY: state.ball.y, ballZ: 0, danger: 0 });
  }

  dispose(): void {
    this.#pitch.dispose();
    this.#stadium.dispose();
    this.#figures.dispose();
    this.#ball.dispose();
    this.#dropRain();
    this.#dropShadows();
    this.#dropPost();
    this.#envTarget?.dispose();
    this.#pmrem.dispose();
    this.renderer.dispose();
  }

  /**
   * Put the whole scene into one set of conditions.
   *
   * Everything the weather touches is here, in one place, because the alternative is a
   * dozen literals scattered across the constructor and a fifth of them getting missed:
   * the first version of this had the fog colour hardcoded next to the sky shader, so a
   * night match had a bright blue haze sitting on a black horizon.
   */
  applyConditions(c: Conditions): void {
    this.#conditions = c;
    const p = paletteFor(c);

    sunDirection(c, this.#keyDir);
    this.#shadowYaw = Math.atan2(this.#keyDir.x, this.#keyDir.z);
    this.#key.position.copy(this.#keyDir).multiplyScalar(120);
    this.#key.color.setHex(p.key);
    this.#key.intensity = p.keyIntensity;

    this.#ambient.color.setHex(p.ambient);
    this.#ambient.intensity = p.ambientIntensity * FILL_SCALE;
    this.#hemi.color.setHex(p.hemiSky);
    this.#hemi.groundColor.setHex(p.hemiGround);
    this.#hemi.intensity = p.hemiIntensity * FILL_SCALE;
    this.#buildEnvironment(p.top, p.mid, p.bottom, p.hemiGround, c.floodlit);
    this.#post?.setNight(c.floodlit);

    this.renderer.toneMappingExposure = p.exposure;
    this.renderer.setClearColor(p.mid, 1);
    const fog = this.scene.fog as THREE.Fog | null;
    if (fog) {
      fog.color.setHex(p.fog);
      fog.near = p.fogNear;
      fog.far = p.fogFar;
    }

    this.#stadium.setSky(p.top, p.mid, p.bottom);
    this.#stadium.setFloodlights(c.floodlit);
    this.#pitch.setWet(c.wetness);
    this.#rain?.setConditions(c);
  }

  /**
   * Image-based light: a tiny procedural world — the sky, a dark band of stands at the
   * horizon, the grass below and, at night, four floodlight banks — prefiltered into a PMREM
   * so every PBR material in the scene reflects and is filled by it.
   *
   * What it buys is mostly on the things that SHINE: the gold ball reflects a sky, a wet
   * pitch reflects the stands, a boot catches a highlight, and the shaded side of a shirt
   * picks up green from the grass instead of flat grey ambient. Rebuilt only when the
   * conditions change, which is once a match.
   */
  #buildEnvironment(top: number, mid: number, bottom: number, ground: number, night: boolean): void {
    const env = new THREE.Scene();
    const geo = new THREE.SphereGeometry(50, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        top: { value: new THREE.Color(top) },
        mid: { value: new THREE.Color(mid) },
        bottom: { value: new THREE.Color(bottom) },
        ground: { value: new THREE.Color(ground) },
        stands: { value: new THREE.Color(night ? 0x0b0d12 : 0x39414c) },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; uniform vec3 ground; uniform vec3 stands;
        varying vec3 vDir;
        void main() {
          float h = vDir.y;
          vec3 sky = mix(mix(bottom, mid, smoothstep(0.0, 0.25, h)), top, smoothstep(0.25, 0.9, h));
          // The bowl: stands from the grass up to about 20 degrees.
          vec3 c = mix(stands, sky, smoothstep(0.3, 0.36, h));
          c = mix(ground * 0.9, c, smoothstep(-0.05, 0.02, h));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    env.add(new THREE.Mesh(geo, mat));
    const lampGeo = new THREE.PlaneGeometry(8, 3);
    const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 7.6, 6.8), side: THREE.DoubleSide });
    if (night) {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const lamp = new THREE.Mesh(lampGeo, lampMat);
          lamp.position.set(sx * 34, 22, sz * 26);
          lamp.lookAt(0, 0, 0);
          env.add(lamp);
        }
      }
    }
    const next = this.#pmrem.fromScene(env, 0, 0.1, 100);
    geo.dispose();
    mat.dispose();
    lampGeo.dispose();
    lampMat.dispose();
    this.#envTarget?.dispose();
    this.#envTarget = next;
    this.scene.environment = next.texture;
  }

  #buildPost(): void {
    if (this.#post) return;
    this.#post = new PostChain(this.renderer, this.scene, this.cam.camera, 4);
    this.#post.setNight(this.#conditions.floodlit);
    const canvas = this.renderer.domElement;
    this.#post.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, this.renderer.getPixelRatio());
  }

  #dropPost(): void {
    this.#post?.dispose();
    this.#post = null;
  }

  #buildRain(): void {
    if (this.#rain) return;
    this.#rain = new Rain();
    this.#rain.setConditions(this.#conditions);
    this.scene.add(this.#rain.group);
  }

  #dropRain(): void {
    if (!this.#rain) return;
    this.scene.remove(this.#rain.group);
    this.#rain.dispose();
    this.#rain = null;
  }

  /**
   * A kick or a pass. The engine has already launched the ball; the leg has not swung yet.
   * The ball is held on the boot until the swing reaches it (ballMotion.ts). A ball in the
   * air is not held — there is no boot under it to hold it to.
   */
  #strike(playerId: number, action: 'kick' | 'pass', seconds: number, contact: number): void {
    this.#startAction(playerId, action, seconds);
    if (this.#ballZ < 0.5) this.#ballMotion.hold(playerId, seconds * contact);
  }

  /**
   * `soft` actions — a first touch, a defender's stagger — never interrupt something
   * already playing: they are what a player does when he is doing nothing more important.
   */
  #startAction(playerId: number, action: ActionPose | BallWork, seconds: number, variant = 0, foot?: 0 | 1, soft = false): void {
    if (playerId < 0) return;
    for (const v of this.#visuals) {
      if (v.id !== playerId || !v.live) continue;
      if (soft && v.action !== null) return;
      // A celebration outranks whatever else lands on the same player in the same beat.
      if (v.action === 'celebrate' && action !== 'celebrate') return;
      v.action = action;
      v.actionT = 0;
      v.actionLen = seconds;
      v.variant = variant;
      v.actionFoot = foot ?? v.footed;
      return;
    }
  }

  #buildShadows(): void {
    const tex = blobTexture(64);
    const geo = new THREE.PlaneGeometry(1.15, 1.15);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0.26, color: 0x0b1f10, depthWrite: false,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, MAX_FIGURES);
    mesh.name = 'player-shadows';
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.renderOrder = 1;
    this.#shadows = mesh;
    this.#shadowDisposables = [tex, geo, mat];
    this.scene.add(mesh);
  }

  #dropShadows(): void {
    if (!this.#shadows) return;
    this.scene.remove(this.#shadows);
    this.#shadows.dispose();
    for (const d of this.#shadowDisposables) d.dispose();
    this.#shadowDisposables = [];
    this.#shadows = null;
  }
}

/**
 * A figure's position `a` of the way between its last two ticks, as a cubic Hermite with
 * the sim velocity at each end as the tangent. Straight-line interpolation is continuous
 * in position and not in velocity, so every tick was a tiny change of direction — ten a
 * second, on every player, which reads as a shimmer rather than as running.
 *
 * Falls back to the straight line when the velocities disagree with the move (a player
 * put down in a foul keeps a decaying velocity while standing still; a restart teleports).
 */
const pathOut: [number, number] = [0, 0];
function pathAt(v: Visual, a: number): [number, number] {
  const t = clamp01(a);
  const dx = v.currX - v.prevX;
  const dz = v.currZ - v.prevZ;
  const chord = Math.hypot(dx, dz);
  const m0 = Math.hypot(v.pvx, v.pvz) * TICK;
  const m1 = Math.hypot(v.vx, v.vz) * TICK;
  if (chord > 3 || m0 > chord * 2.2 + 0.12 || m1 > chord * 2.2 + 0.12) {
    pathOut[0] = v.prevX + dx * t;
    pathOut[1] = v.prevZ + dz * t;
    return pathOut;
  }
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  pathOut[0] = h00 * v.prevX + h10 * v.pvx * TICK + h01 * v.currX + h11 * v.vx * TICK;
  pathOut[1] = h00 * v.prevZ + h10 * v.pvz * TICK + h01 * v.currZ + h11 * v.vz * TICK;
  return pathOut;
}

/**
 * Lower-body heading, in the figure's own frame, for a direction of travel `rel` radians
 * off its facing (sim convention). The figure's local +X is its left, which is where a
 * travel direction at a NEGATIVE relative angle points — hence the minus.
 */
function legYawFor(rel: number, limit: number): number {
  return clamp(-rel, -limit, limit);
}
