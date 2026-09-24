// The trail behind a ball: a ribbon, a spray of particles and a halo.
//
// A real ball leaves nothing, except a faint streak on a hard strike — which is what the
// white "air" trail below is, and all a club ball ever shows. The fantasy balls are the
// other end of that: the studio sells them as fire, ice and galaxies, and a ball that
// glows at rest and then flies across the box leaving nothing behind it is a ball that
// under-delivers on the one moment anybody is watching it.
//
// Three parts, all procedural (design §9: zero asset files):
//
//   RIBBON    A strip of quads through the ball's recent positions, turned each frame to
//             face the camera, so it has width from every angle. Its look is one shader
//             with a branch per FX kind — flame tongues, ice crystals, a star field, a
//             lightning core, a spectrum — driven by how old each point is and how far
//             along the trail it sits. The CPU only moves points.
//   SPARKS    A small particle pool: embers, snow, stars, arcs. Sprites drawn as
//             shapes in the fragment shader, so there is no sprite sheet either.
//   HALO      A billboard glow around the ball itself, so a fire ball at the kickoff spot
//             already looks like it is burning.
//
// The trail is bounded by distance along the path as well as by age. The frame loop runs
// in real time while the match can run at 14× (ui/match.ts), so a trail measured in
// seconds alone would reach across half the pitch at speed and be a stub at 1×.

import * as THREE from 'three';
import { ballStyle } from './ballStyle.js';

export type TrailKind =
  | 'air'
  | 'fire'
  | 'lava'
  | 'ice'
  | 'galaxy'
  | 'void'
  | 'blackHole'
  | 'lightning'
  | 'rainbow'
  | 'plasma'
  | 'aurora'
  | 'gold';

/** A spark's shape, drawn in the fragment shader. */
const SHAPE = { dot: 0, star: 1, flake: 2, square: 3 } as const;

export interface TrailFx {
  kind: TrailKind;
  /** Ribbon colours at the ball and at the far end. */
  head: number;
  tail: number;
  /** Half-width of the ribbon at the ball, metres. */
  width: number;
  /** Longest the ribbon ever gets, metres along the path, and how long a point lives. */
  length: number;
  life: number;
  /**
   * Normal blending darkens (the void balls); additive glows (everything else). Only the
   * ground pool reads this now — see `cover`.
   */
  additive: boolean;
  /**
   * How much the ribbon covers what is behind it, 0..1, as opposed to adding light to it.
   *
   * The trail is drawn premultiplied (ONE, ONE_MINUS_SRC_ALPHA), the usual blend for VFX:
   * 0 is pure additive, 1 is an ordinary transparent surface. Pure additive was the first
   * version, and it is wrong on a football pitch — orange added to green grass is yellow-
   * green, so every fire ball left a lime streak. Fire needs to COVER the grass to stay
   * orange; lightning wants almost none, so it stays a glow.
   */
  cover: number;
  /** Visible at a walking pace as well as on a strike: every fantasy ball, never a real one. */
  always: boolean;
  /** Sparks per second at full speed, their colours, shape, size and drift. */
  sparkRate: number;
  sparkColors: readonly number[];
  sparkShape: number;
  sparkSize: number;
  /** Upward drift (fire rises, snow falls) and random scatter, m/s. */
  sparkLift: number;
  sparkScatter: number;
  /** The halo's colour and strength, 0 for none. */
  halo: number;
  haloStrength: number;
}

/** Shader branch per kind. The numbers are the `uKind` values the GLSL switches on. */
const KIND_ID: Readonly<Record<TrailKind, number>> = {
  air: 0, fire: 1, lava: 2, ice: 3, galaxy: 4, void: 5, blackHole: 6,
  lightning: 7, rainbow: 8, plasma: 9, aurora: 10, gold: 11,
};

const AIR: TrailFx = {
  kind: 'air', head: 0xffffff, tail: 0xdfe8ef, width: 0.07, length: 4.5, life: 0.28,
  cover: 0.1, additive: true, always: false, sparkRate: 0, sparkColors: [0xffffff], sparkShape: SHAPE.dot,
  sparkSize: 0, sparkLift: 0, sparkScatter: 0, halo: 0xffffff, haloStrength: 0,
};

/**
 * The effects, keyed by BALL_STYLES id. A style not listed here is a real ball and gets
 * the air streak. Kept here rather than in ballStyle.ts because that file is plain data the
 * UI imports without three.js, and none of this means anything outside the renderer.
 */
const FX: Readonly<Record<string, TrailFx>> = {
  gold: {
    kind: 'gold', head: 0xfff1b0, tail: 0xc98a1c, width: 0.18, length: 5, life: 0.45,
    cover: 0.45, additive: true, always: true, sparkRate: 70, sparkColors: [0xffe9a0, 0xffffff, 0xf2b93b],
    sparkShape: SHAPE.star, sparkSize: 0.11, sparkLift: 0.1, sparkScatter: 0.5,
    halo: 0xffd66b, haloStrength: 0.35,
  },
  fire: {
    kind: 'fire', head: 0xffc040, tail: 0xff2a00, width: 0.45, length: 8, life: 0.5,
    cover: 0.75, additive: true, always: true, sparkRate: 150, sparkColors: [0xffd060, 0xff8a1c, 0xff4a10],
    sparkShape: SHAPE.dot, sparkSize: 0.09, sparkLift: 1.4, sparkScatter: 0.9,
    halo: 0xff7a1a, haloStrength: 0.95,
  },
  lava: {
    kind: 'lava', head: 0xffc060, tail: 0x8a1a05, width: 0.27, length: 6, life: 0.6,
    cover: 0.85, additive: true, always: true, sparkRate: 90, sparkColors: [0xffb050, 0xff5a1a, 0x5a1a0a],
    sparkShape: SHAPE.square, sparkSize: 0.08, sparkLift: -1.2, sparkScatter: 0.7,
    halo: 0xff5a1a, haloStrength: 0.8,
  },
  ice: {
    kind: 'ice', head: 0xffffff, tail: 0x5fc8ff, width: 0.24, length: 6, life: 0.55,
    cover: 0.45, additive: true, always: true, sparkRate: 110, sparkColors: [0xffffff, 0xcff4ff, 0x8fdcff],
    sparkShape: SHAPE.flake, sparkSize: 0.12, sparkLift: -0.5, sparkScatter: 0.6,
    halo: 0xbff2ff, haloStrength: 0.45,
  },
  galaxy: {
    kind: 'galaxy', head: 0xd8c8ff, tail: 0x2a1a7a, width: 0.3, length: 7, life: 0.65,
    cover: 0.6, additive: true, always: true, sparkRate: 120, sparkColors: [0xffffff, 0xc9b8ff, 0x7fd0ff, 0xff9ee8],
    sparkShape: SHAPE.star, sparkSize: 0.1, sparkLift: 0, sparkScatter: 0.45,
    halo: 0x9f7dff, haloStrength: 0.6,
  },
  darkMatter: {
    kind: 'void', head: 0x2a0a4a, tail: 0x000000, width: 0.3, length: 6, life: 0.6,
    cover: 1, additive: false, always: true, sparkRate: 80, sparkColors: [0xb77dff, 0x7b2ff7, 0x3a0a6a],
    sparkShape: SHAPE.dot, sparkSize: 0.08, sparkLift: 0, sparkScatter: 0.35,
    halo: 0x7b2ff7, haloStrength: 0.55,
  },
  blackHole: {
    kind: 'blackHole', head: 0x1a0c05, tail: 0x000000, width: 0.33, length: 6, life: 0.6,
    cover: 1, additive: false, always: true, sparkRate: 130, sparkColors: [0xffc070, 0xff9a3c, 0xffffff],
    sparkShape: SHAPE.dot, sparkSize: 0.07, sparkLift: 0, sparkScatter: 0.25,
    halo: 0xff9a3c, haloStrength: 0.7,
  },
  lightning: {
    kind: 'lightning', head: 0xffffff, tail: 0x3fa8ff, width: 0.3, length: 7, life: 0.4,
    cover: 0.25, additive: true, always: true, sparkRate: 90, sparkColors: [0xffffff, 0x9fe8ff, 0x5fb8ff],
    sparkShape: SHAPE.star, sparkSize: 0.09, sparkLift: 0, sparkScatter: 1.6,
    halo: 0x7fe0ff, haloStrength: 0.8,
  },
  rainbow: {
    kind: 'rainbow', head: 0xffffff, tail: 0xffffff, width: 0.3, length: 8, life: 0.7,
    cover: 0.55, additive: true, always: true, sparkRate: 80, sparkColors: [0xff5a5a, 0xffd23f, 0x5aff8a, 0x5ab8ff, 0xc77dff],
    sparkShape: SHAPE.star, sparkSize: 0.09, sparkLift: 0.2, sparkScatter: 0.5,
    halo: 0xffffff, haloStrength: 0.3,
  },
  plasma: {
    kind: 'plasma', head: 0xffd6fb, tail: 0x8a1aff, width: 0.27, length: 6.5, life: 0.5,
    cover: 0.6, additive: true, always: true, sparkRate: 110, sparkColors: [0xff4fe0, 0xffffff, 0x8f5aff],
    sparkShape: SHAPE.dot, sparkSize: 0.08, sparkLift: 0.3, sparkScatter: 1.1,
    halo: 0xff4fe0, haloStrength: 0.75,
  },
  aurora: {
    kind: 'aurora', head: 0xc8ffe8, tail: 0x3a5aff, width: 0.36, length: 8, life: 0.8,
    cover: 0.45, additive: true, always: true, sparkRate: 60, sparkColors: [0x3dffa0, 0x7fffe0, 0x9f7dff],
    sparkShape: SHAPE.dot, sparkSize: 0.07, sparkLift: 0.5, sparkScatter: 0.4,
    halo: 0x3dffa0, haloStrength: 0.5,
  },
};

/** The effect for a BALL_STYLES index. Exported for the test. */
export function trailFor(style: number): TrailFx {
  return FX[ballStyle(style).id] ?? AIR;
}

const MAX_POINTS = 96;
const MAX_SPARKS = 256;

interface Point {
  x: number;
  y: number;
  z: number;
  age: number;
  /** Metres along the path from the ball, recomputed each frame. */
  dist: number;
  /** A per-point random, for the lightning jitter. */
  seed: number;
}

interface Spark {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  color: number;
  size: number;
}

export class BallTrail {
  readonly group = new THREE.Group();
  #fx: TrailFx = AIR;
  readonly #points: Point[] = [];
  readonly #sparks: Spark[] = [];
  #sparkDebt = 0;
  #time = 0;
  /** 0..1, smoothed: how much of the trail is showing. */
  #intensity = 0;
  readonly #rng = mulberry(0x7a11);

  // Ribbon
  readonly #ribbonGeo = new THREE.BufferGeometry();
  readonly #ribbonPos = new Float32Array(MAX_POINTS * 2 * 3);
  readonly #ribbonData = new Float32Array(MAX_POINTS * 2 * 3); // age, side, dist
  readonly #ribbonMat: THREE.ShaderMaterial;
  readonly #ribbon: THREE.Mesh;

  // Sparks
  readonly #sparkGeo = new THREE.BufferGeometry();
  readonly #sparkPos = new Float32Array(MAX_SPARKS * 3);
  readonly #sparkCol = new Float32Array(MAX_SPARKS * 4);
  readonly #sparkSize = new Float32Array(MAX_SPARKS);
  readonly #sparkMat: THREE.ShaderMaterial;
  readonly #sparkPoints: THREE.Points;

  // Halo
  readonly #haloMat: THREE.ShaderMaterial;
  readonly #halo: THREE.Mesh;

  readonly #tmp = new THREE.Vector3();
  readonly #tan = new THREE.Vector3();
  readonly #side = new THREE.Vector3();
  readonly #toCam = new THREE.Vector3();
  readonly #color = new THREE.Color();

  constructor() {
    this.group.name = 'ball-trail';

    // Two vertices per point, indexed as a strip of quads.
    this.#ribbonGeo.setAttribute('position', new THREE.BufferAttribute(this.#ribbonPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.#ribbonGeo.setAttribute('aData', new THREE.BufferAttribute(this.#ribbonData, 3).setUsage(THREE.DynamicDrawUsage));
    const index: number[] = [];
    for (let i = 0; i < MAX_POINTS - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.#ribbonGeo.setIndex(index);
    this.#ribbonGeo.setDrawRange(0, 0);
    this.#ribbonMat = new THREE.ShaderMaterial({
      uniforms: {
        uHead: { value: new THREE.Color() },
        uTail: { value: new THREE.Color() },
        uKind: { value: 0 },
        uTime: { value: 0 },
        uIntensity: { value: 0 },
        uCover: { value: 0 },
      },
      vertexShader: RIBBON_VERT,
      fragmentShader: RIBBON_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      premultipliedAlpha: true,
    });
    this.#ribbon = new THREE.Mesh(this.#ribbonGeo, this.#ribbonMat);
    this.#ribbon.frustumCulled = false;
    this.#ribbon.renderOrder = 3;
    this.group.add(this.#ribbon);

    this.#sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.#sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.#sparkGeo.setAttribute('aColor', new THREE.BufferAttribute(this.#sparkCol, 4).setUsage(THREE.DynamicDrawUsage));
    this.#sparkGeo.setAttribute('aSize', new THREE.BufferAttribute(this.#sparkSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.#sparkGeo.setDrawRange(0, 0);
    this.#sparkMat = new THREE.ShaderMaterial({
      uniforms: {
        uShape: { value: 0 },
        uScale: { value: 600 },
        uTime: { value: 0 },
      },
      vertexShader: SPARK_VERT,
      fragmentShader: SPARK_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.#sparkPoints = new THREE.Points(this.#sparkGeo, this.#sparkMat);
    this.#sparkPoints.frustumCulled = false;
    this.#sparkPoints.renderOrder = 4;
    this.group.add(this.#sparkPoints);

    this.#haloMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color() },
        uStrength: { value: 0 },
        uTime: { value: 0 },
        uKind: { value: 0 },
      },
      vertexShader: HALO_VERT,
      fragmentShader: HALO_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.#halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.#haloMat);
    this.#halo.frustumCulled = false;
    this.#halo.renderOrder = 5;
    this.#halo.visible = false;
    this.group.add(this.#halo);
  }

  /** Pick the effect for a ball. Clears whatever the old one left behind. */
  setStyle(style: number): void {
    this.#fx = trailFor(style);
    const fx = this.#fx;
    this.#points.length = 0;
    this.#sparks.length = 0;
    (this.#ribbonMat.uniforms.uHead as THREE.IUniform).value.setHex(fx.head);
    (this.#ribbonMat.uniforms.uTail as THREE.IUniform).value.setHex(fx.tail);
    (this.#ribbonMat.uniforms.uKind as THREE.IUniform).value = KIND_ID[fx.kind];
    (this.#ribbonMat.uniforms.uCover as THREE.IUniform).value = fx.cover;
    (this.#sparkMat.uniforms.uShape as THREE.IUniform).value = fx.sparkShape;
    (this.#haloMat.uniforms.uColor as THREE.IUniform).value.setHex(fx.halo);
    (this.#haloMat.uniforms.uKind as THREE.IUniform).value = KIND_ID[fx.kind];
    this.#halo.visible = fx.haloStrength > 0;
  }

  /** Whether this ball is a fantasy one — the ball view takes its own smear out if so. */
  get fantasy(): boolean {
    return this.#fx.always;
  }

  /**
   * Advance one frame. `x,y,z` is the ball's centre in scene space; `speed` its speed in
   * m/s; `camera` is this frame's, already placed.
   */
  update(x: number, y: number, z: number, speed: number, dt: number, camera: THREE.Camera, heightScale: number): void {
    const fx = this.#fx;
    this.#time += dt;
    const t = this.#time;

    // How much trail to show. A fantasy ball always has a little, and it builds with pace;
    // a real one shows only on a genuine strike.
    // A ball at rest has no path, and a ribbon over a pile of points sitting on the ball
    // is a wedge of colour pointing nowhere. So even a fantasy ball's trail waits for it to
    // move; the halo is what shows it is special while it sits still.
    const want = fx.always
      ? smoothstep(0.8, 4, speed) * (0.3 + 0.7 * smoothstep(3, 20, speed))
      : smoothstep(15, 28, speed) * 0.75;
    const rate = want > this.#intensity ? 10 : 3;
    this.#intensity += (want - this.#intensity) * Math.min(1, rate * dt);
    const k = this.#intensity;

    // --- points ------------------------------------------------------------------
    for (const p of this.#points) p.age += dt;
    const head = this.#points[0];
    const moved = head ? Math.hypot(head.x - x, head.y - y, head.z - z) : Infinity;
    if (moved > 2.5) {
      // A teleport — a kickoff reset, a goal — is not a path. Start over.
      this.#points.length = 0;
    }
    if (!head || moved > 0.035 || this.#points.length < 2) {
      this.#points.unshift({ x, y, z, age: 0, dist: 0, seed: this.#rng() });
      if (this.#points.length > MAX_POINTS) this.#points.length = MAX_POINTS;
    } else {
      head.x = x;
      head.y = y;
      head.z = z;
      head.age = 0;
    }
    let dist = 0;
    let keep = this.#points.length;
    for (let i = 0; i < this.#points.length; i++) {
      const p = this.#points[i] as Point;
      if (i > 0) {
        const q = this.#points[i - 1] as Point;
        dist += Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
      }
      p.dist = dist;
      if ((p.age > fx.life || dist > fx.length) && i > 1) {
        keep = i;
        break;
      }
    }
    this.#points.length = keep;

    this.#buildRibbon(camera, k);

    // --- sparks ------------------------------------------------------------------
    if (fx.sparkRate > 0) {
      this.#sparkDebt += fx.sparkRate * (0.15 + 0.85 * smoothstep(2, 18, speed)) * k * dt;
      while (this.#sparkDebt >= 1) {
        this.#sparkDebt -= 1;
        this.#emit(x, y, z);
      }
    }
    this.#stepSparks(dt, heightScale);

    // --- halo --------------------------------------------------------------------
    if (this.#halo.visible) {
      this.#halo.position.set(x, y, z);
      this.#halo.quaternion.copy(camera.quaternion);
      const pulse = 1 + Math.sin(t * 7.3) * 0.06 + Math.sin(t * 13.1) * 0.04;
      // Scaled to the ball: a unit plane at 0.5 is a halo reaching about twice its radius.
      const s = (0.5 + 0.18 * k) * pulse;
      this.#halo.scale.set(s, s, s);
      (this.#haloMat.uniforms.uStrength as THREE.IUniform).value = fx.haloStrength * (0.55 + 0.45 * k);
    }
    (this.#ribbonMat.uniforms.uTime as THREE.IUniform).value = t;
    (this.#ribbonMat.uniforms.uIntensity as THREE.IUniform).value = k;
    (this.#sparkMat.uniforms.uTime as THREE.IUniform).value = t;
    (this.#haloMat.uniforms.uTime as THREE.IUniform).value = t;
  }

  /** Pixel scale for the sparks: the canvas height over the lens, so a spark is metres. */
  setViewport(heightPx: number, fovDeg: number): void {
    (this.#sparkMat.uniforms.uScale as THREE.IUniform).value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  dispose(): void {
    this.#ribbonGeo.dispose();
    this.#ribbonMat.dispose();
    this.#sparkGeo.dispose();
    this.#sparkMat.dispose();
    this.#halo.geometry.dispose();
    this.#haloMat.dispose();
    this.group.clear();
  }

  #buildRibbon(camera: THREE.Camera, k: number): void {
    const pts = this.#points;
    const n = pts.length;
    if (n < 2 || k < 0.01) {
      this.#ribbonGeo.setDrawRange(0, 0);
      return;
    }
    const fx = this.#fx;
    const jag = fx.kind === 'lightning';
    const camPos = camera.position;
    for (let i = 0; i < n; i++) {
      const p = pts[i] as Point;
      const a = pts[Math.max(0, i - 1)] as Point;
      const b = pts[Math.min(n - 1, i + 1)] as Point;
      this.#tan.set(a.x - b.x, a.y - b.y, a.z - b.z);
      if (this.#tan.lengthSq() < 1e-8) this.#tan.set(1, 0, 0);
      this.#tan.normalize();
      this.#toCam.set(camPos.x - p.x, camPos.y - p.y, camPos.z - p.z).normalize();
      this.#side.crossVectors(this.#tan, this.#toCam);
      if (this.#side.lengthSq() < 1e-8) this.#side.set(0, 1, 0);
      this.#side.normalize();

      const u = Math.min(1, Math.max(p.age / fx.life, p.dist / fx.length));
      // Fattest a little behind the ball, tapering to nothing at the end.
      const taper = Math.sin(Math.min(1, u * 1.15 + 0.12) * Math.PI) * (1 - u * 0.35);
      let w = fx.width * (0.45 + 0.55 * k) * Math.max(taper, i === 0 ? 0.35 : 0);
      if (fx.kind === 'fire' || fx.kind === 'plasma') w *= 1 + u * 0.8;

      this.#tmp.set(p.x, p.y, p.z);
      if (jag && i > 0) {
        // Lightning: every point kinks sideways, re-rolled a dozen times a second.
        const flick = Math.floor(this.#time * 14);
        const j = (hash(p.seed * 997 + flick) - 0.5) * 0.7 * Math.min(1, u * 3) * (1 + k);
        this.#tmp.addScaledVector(this.#side, j);
        this.#tmp.y += (hash(p.seed * 131 + flick) - 0.5) * 0.45 * Math.min(1, u * 3);
      }
      const o = i * 6;
      this.#ribbonPos[o] = this.#tmp.x + this.#side.x * w;
      this.#ribbonPos[o + 1] = this.#tmp.y + this.#side.y * w;
      this.#ribbonPos[o + 2] = this.#tmp.z + this.#side.z * w;
      this.#ribbonPos[o + 3] = this.#tmp.x - this.#side.x * w;
      this.#ribbonPos[o + 4] = this.#tmp.y - this.#side.y * w;
      this.#ribbonPos[o + 5] = this.#tmp.z - this.#side.z * w;
      this.#ribbonData[o] = u;
      this.#ribbonData[o + 1] = 1;
      this.#ribbonData[o + 2] = p.dist;
      this.#ribbonData[o + 3] = u;
      this.#ribbonData[o + 4] = -1;
      this.#ribbonData[o + 5] = p.dist;
    }
    (this.#ribbonGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.#ribbonGeo.getAttribute('aData') as THREE.BufferAttribute).needsUpdate = true;
    this.#ribbonGeo.setDrawRange(0, (n - 1) * 6);
  }

  #emit(x: number, y: number, z: number): void {
    const fx = this.#fx;
    if (this.#sparks.length >= MAX_SPARKS) this.#sparks.shift();
    const r = this.#rng;
    const sc = fx.sparkScatter;
    // Born on the ball's surface, not at its centre.
    const ox = (r() - 0.5) * 0.2;
    const oy = (r() - 0.5) * 0.2;
    const oz = (r() - 0.5) * 0.2;
    this.#sparks.push({
      x: x + ox, y: y + oy, z: z + oz,
      vx: (r() - 0.5) * 2 * sc,
      vy: (r() - 0.5) * 2 * sc * 0.6 + fx.sparkLift * (0.5 + r()),
      vz: (r() - 0.5) * 2 * sc,
      age: 0,
      life: fx.life * (0.7 + r() * 0.9),
      color: fx.sparkColors[Math.floor(r() * fx.sparkColors.length)] as number,
      size: fx.sparkSize * (0.5 + r()),
    });
  }

  #stepSparks(dt: number, heightScale: number): void {
    const fx = this.#fx;
    const s = this.#sparks;
    let w = 0;
    for (let i = 0; i < s.length; i++) {
      const p = s[i] as Spark;
      p.age += dt;
      if (p.age >= p.life) continue;
      const drag = Math.exp(-2.2 * dt);
      p.vx *= drag;
      p.vz *= drag;
      p.vy = p.vy * drag + (fx.kind === 'lava' ? -3 : 0) * dt;
      if (fx.kind === 'blackHole' || fx.kind === 'void') {
        // Spiralling in rather than flying off.
        p.vx += -p.vz * 3 * dt;
        p.vz += p.vx * 3 * dt;
      }
      p.x += p.vx * dt;
      p.y = Math.max(0.02, p.y + p.vy * dt);
      p.z += p.vz * dt;
      s[w++] = p;
    }
    s.length = w;
    for (let i = 0; i < w; i++) {
      const p = s[i] as Spark;
      const u = p.age / p.life;
      this.#sparkPos[i * 3] = p.x;
      this.#sparkPos[i * 3 + 1] = p.y;
      this.#sparkPos[i * 3 + 2] = p.z;
      this.#color.setHex(p.color);
      // Fade in fast, out slow; a spark that pops into existence at full size reads as noise.
      const a = Math.min(1, u * 8) * (1 - u) * (1 - u);
      this.#sparkCol[i * 4] = this.#color.r;
      this.#sparkCol[i * 4 + 1] = this.#color.g;
      this.#sparkCol[i * 4 + 2] = this.#color.b;
      this.#sparkCol[i * 4 + 3] = a;
      this.#sparkSize[i] = p.size * (1 - u * 0.5) * heightScale;
    }
    (this.#sparkGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.#sparkGeo.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
    (this.#sparkGeo.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    this.#sparkGeo.setDrawRange(0, w);
  }
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function hash(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- shaders ------------------------------------------------------------------------------

const NOISE_GLSL = /* glsl */ `
float tlHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float tlNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tlHash(i), tlHash(i + vec2(1.0, 0.0)), u.x),
             mix(tlHash(i + vec2(0.0, 1.0)), tlHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float tlFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * tlNoise(p); p *= 2.03; a *= 0.5; }
  return v;
}
vec3 tlHue(float h) {
  return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}
`;

const RIBBON_VERT = /* glsl */ `
attribute vec3 aData;
varying vec3 vData;
void main() {
  vData = aData;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

/**
 * One shader, a branch per kind. `u` is 0 at the ball and 1 at the end of the trail, `s`
 * is -1..1 across it, `d` is metres along it (so a pattern stays put on the path while the
 * ball flies away from it, which is what makes flame look like it is left behind).
 */
const RIBBON_FRAG = /* glsl */ `
uniform vec3 uHead;
uniform vec3 uTail;
uniform float uKind;
uniform float uTime;
uniform float uIntensity;
uniform float uCover;
varying vec3 vData;
${NOISE_GLSL}
void main() {
  float u = clamp(vData.x, 0.0, 1.0);
  float s = vData.y;
  float d = vData.z;
  float edge = 1.0 - s * s;
  float core = pow(edge, 3.0);
  float fade = pow(1.0 - u, 1.6);
  vec3 col = mix(uHead, uTail, smoothstep(0.0, 0.85, u));
  float a = edge * fade;
  int k = int(uKind + 0.5);

  if (k == 0) {
    // Air: a thin bright streak.
    a = core * fade * 0.55;
  } else if (k == 1 || k == 9) {
    // Fire, plasma: tongues of flame licking back along the path.
    // Noise stretched along the path and scrolled backward, so the tongues trail off the
    // ball. The noise eats into the WIDTH as well as the alpha: a flame is ragged at its
    // edges, and a ribbon with straight sides is a wedge however it is coloured.
    float n = tlFbm(vec2(d * 1.6 - uTime * 7.0, s * 2.4 + uTime * 2.0));
    float n2 = tlNoise(vec2(d * 5.0 - uTime * 11.0, s * 4.0));
    float reach = 0.25 + 0.75 * (n * 0.9 + n2 * 0.4) - u * 0.35;
    float body = 1.0 - smoothstep(reach - 0.25, reach, abs(s));
    float heat = clamp(body * (1.0 - u * 0.8) + n2 * 0.2, 0.0, 1.0);
    col = mix(uTail, uHead, smoothstep(0.35, 1.0, heat));
    col = mix(vec3(0.25, 0.03, 0.0), col, smoothstep(0.0, 0.35, heat));
    if (k == 9) col += tlHue(0.8 + n * 0.15) * 0.25;
    a = body * smoothstep(0.0, 0.25, heat) * (1.0 - u * 0.5) * 1.2;
  } else if (k == 2) {
    // Lava: a dark crust with glowing cracks.
    float n = tlFbm(vec2(d * 3.0, s * 2.0 + uTime * 0.5));
    float crack = smoothstep(0.52, 0.5, abs(n - 0.5) * 2.0 + u * 0.3);
    col = mix(uTail * 0.4, uHead, crack);
    a = edge * fade * (0.45 + crack);
  } else if (k == 3) {
    // Ice: a frosted sheet with crystalline glints.
    float n = tlNoise(vec2(d * 9.0, s * 5.0));
    float glint = step(0.93, tlHash(floor(vec2(d * 18.0, s * 6.0))));
    col = mix(uTail, uHead, core + n * 0.3) + glint * 0.8;
    a = (edge * 0.6 + glint) * fade;
  } else if (k == 4) {
    // Galaxy: nebula colour with stars fixed along the path.
    float n = tlFbm(vec2(d * 1.4, s * 1.2 + 3.0));
    col = mix(uTail, uHead, n) + tlHue(0.7 + n * 0.3) * 0.25;
    vec2 cell = floor(vec2(d * 14.0, s * 5.0));
    float star = step(0.9, tlHash(cell)) * (0.6 + 0.4 * sin(uTime * 9.0 + tlHash(cell + 7.0) * 30.0));
    col += star * 1.4;
    a = (edge * (0.4 + n * 0.5) + star) * fade;
  } else if (k == 5 || k == 6) {
    // The void balls DARKEN (normal blending): a smoke of nothing, and for the black hole
    // a hot rim where the accretion disc would be.
    float n = tlFbm(vec2(d * 2.0 - uTime * 2.0, s * 1.5));
    col = uHead;
    a = edge * fade * (0.55 + n * 0.45);
    if (k == 6) {
      float rim = smoothstep(0.55, 0.85, abs(s)) * (1.0 - smoothstep(0.85, 1.0, abs(s)));
      col = mix(col, vec3(1.0, 0.6, 0.25), rim * (1.0 - u));
      a = max(a, rim * fade);
    }
  } else if (k == 7) {
    // Lightning: a white-hot core in a blue glow, flickering.
    float flick = 0.6 + 0.4 * step(0.3, tlHash(vec2(floor(uTime * 18.0), 1.0)));
    col = mix(uTail, vec3(1.0), core);
    a = (core * 1.5 + edge * 0.35) * fade * flick;
  } else if (k == 8) {
    // Rainbow: bands across the ribbon, drifting.
    col = tlHue(fract((s * 0.5 + 0.5) * 0.85 + uTime * 0.1)) * 1.1 + core * 0.3;
    a = edge * fade * 0.95;
  } else if (k == 10) {
    // Aurora: soft curtains that ripple.
    float n = tlFbm(vec2(d * 0.9 - uTime * 0.8, s * 0.8));
    col = mix(uTail, uHead, smoothstep(-0.6, 0.8, s + n * 0.8));
    col = mix(col, vec3(0.24, 1.0, 0.63), 0.4 * (1.0 - u));
    a = edge * fade * (0.35 + n * 0.8);
  } else if (k == 11) {
    // Gold: a shimmering band with glitter.
    float g = step(0.88, tlHash(floor(vec2(d * 20.0, s * 4.0 + floor(uTime * 12.0)))));
    col = mix(uTail, uHead, core) + g;
    a = (edge * 0.55 + g) * fade;
  }
  // Premultiplied: colour carries its own coverage, and alpha is only how much of the
  // background it hides. See TrailFx.cover.
  float alpha = clamp(a * uIntensity, 0.0, 1.0);
  // HDR: the glowing kinds are brighter than white so the bloom pass finds them.
  // Enough over 1 to bloom, not so far that the tone curve bleaches a colour to white —
  // at 2.6 an orange flame came out as a white wedge.
  float hdr = (k == 5 || k == 6) ? 1.0 : (k == 7 || k == 0 || k == 3) ? 2.4 : 1.5;
  gl_FragColor = vec4(col * alpha * hdr, alpha * uCover);
}
`;

const SPARK_VERT = /* glsl */ `
attribute vec4 aColor;
attribute float aSize;
uniform float uScale;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.0, aSize * uScale / max(-mv.z, 0.1));
  gl_Position = projectionMatrix * mv;
}
`;

const SPARK_FRAG = /* glsl */ `
uniform float uShape;
varying vec4 vColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  float a;
  int shape = int(uShape + 0.5);
  if (shape == 1) {
    // A four-point sparkle.
    a = max(0.0, 1.0 - r * 1.6) + max(0.0, 1.0 - abs(p.x) * 9.0) * max(0.0, 1.0 - abs(p.y))
        + max(0.0, 1.0 - abs(p.y) * 9.0) * max(0.0, 1.0 - abs(p.x));
  } else if (shape == 2) {
    // A six-armed flake.
    float ang = atan(p.y, p.x);
    float arm = abs(cos(ang * 3.0));
    a = smoothstep(0.08, 0.0, r * (1.0 - arm * 0.75) - 0.06) * step(r, 1.0) + max(0.0, 1.0 - r * 3.0);
  } else if (shape == 3) {
    // A hot chunk.
    a = step(max(abs(p.x), abs(p.y)), 0.7) * (1.0 - r * 0.4);
  } else {
    a = pow(max(0.0, 1.0 - r), 2.0);
  }
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb * (1.0 + a) * 2.2, vColor.a * min(a, 1.0));
}
`;

const HALO_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const HALO_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
uniform float uTime;
uniform float uKind;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  // Keep clear of the ball itself (r ≈ 0.35 at the default scale): a halo drawn over the
  // ball washes out the design the club chose.
  float glow = smoothstep(1.0, 0.35, r) * smoothstep(0.32, 0.5, r);
  int k = int(uKind + 0.5);
  if (k == 1 || k == 2 || k == 9) {
    // Flames flicker round the rim.
    float ang = atan(p.y, p.x);
    glow *= 0.6 + 0.8 * tlFbm(vec2(ang * 2.0, r * 3.0 - uTime * 4.0));
  }
  if (k == 7) glow *= 0.5 + step(0.5, tlHash(vec2(floor(uTime * 20.0), 3.0)));
  gl_FragColor = vec4(uColor * glow * uStrength * 3.0, glow * uStrength);
}
`;
