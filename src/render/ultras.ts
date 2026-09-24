// The home end: a barra, and the rest of the ground with its cameras and its signs.
//
// The crowd sheets (stadium.ts) are a texture, and at broadcast distance twenty thousand
// people ARE a texture. The home end is the exception. It is the part of the ground a
// camera behind the goal looks straight into, and it is not a crowd sitting down: it is a
// barra standing for ninety minutes, jumping on the beat of its drums, with flags going
// round, long ribbons down the terrace, banners on the wall, trumpets, and — when the home
// side scores — flares and a storm of paper. None of that reads as texture. So it is
// modelled, cheaply: a few hundred low-poly fans in ONE instanced draw, everything that
// moves animated in a vertex shader off a single clock, particles for smoke and paper.
//
// And the whole ground takes photographs. A flash is a point that is lit for a sixth of a
// second; a few thousand of them scattered over every stand, firing at a rate that follows
// the match, is the single cheapest thing that makes a stadium look full at night.
//
// Everything here is procedural: canvas textures, primitive geometry, no asset file
// (design §9). Everything shown on a sign or a banner is wholesome — this is a
// child-directed product (see the hoardings in stadium.ts).

import * as THREE from 'three';
import { streamOf, type Rng } from '../core/rng.js';
// The beat the barra jumps to is the beat its drums play (audio/barra.ts).
import { BARRA_BPM } from '../audio/barra.js';


/** A raked seating surface in world space: a stand's frame, and a slope across it. */
export interface Rake {
  /** The stand's origin and turn: its local +Z points away from the pitch. */
  x: number;
  z: number;
  rotY: number;
  width: number;
  /** Local (depth, height) of the front and back edges of the slope. */
  z0: number;
  y0: number;
  z1: number;
  y1: number;
}

export interface UltrasOptions {
  seed: number;
  primary: number;
  secondary: number;
  /** The club's name, for the banners. */
  name?: string;
  /** The terrace the barra stands on: the lower tier of the home end. */
  home: Rake;
  /** Every seating surface in the ground, for the flashes and the signs. */
  rakes: readonly Rake[];
}

/** A point on a rake: `u` across it (-0.5..0.5), `v` up it (0 front, 1 back). */
function onRake(r: Rake, u: number, v: number, out = new THREE.Vector3()): THREE.Vector3 {
  const lx = u * r.width;
  const lz = r.z0 + (r.z1 - r.z0) * v;
  const ly = r.y0 + (r.y1 - r.y0) * v;
  const c = Math.cos(r.rotY);
  const s = Math.sin(r.rotY);
  return out.set(r.x + lx * c + lz * s, ly, r.z - lx * s + lz * c);
}

/** The turn that faces something standing on a rake towards the pitch. */
const facingPitch = (r: Rake) => r.rotY + Math.PI;

/**
 * When the flares burn. Pure, so the show can be tested without a GPU.
 *
 * They go up for the teams walking out, for every home goal, and now and then on their
 * own when the barra is up — a flare lasts about a minute in real life, and a game that
 * burned them constantly would be a game played in fog.
 */
export class FlareShow {
  readonly burn: Float32Array;
  readonly #left: Float32Array;
  readonly #rng: Rng;
  #cooldown = 50;

  constructor(count: number, seed: number) {
    this.burn = new Float32Array(count);
    this.#left = new Float32Array(count);
    this.#rng = streamOf(seed, 'flares');
    // The walk-out: most of them, straight away.
    for (let i = 0; i < count; i++) if (this.#rng() < 0.75) this.#left[i] = 18 + this.#rng() * 14;
  }

  /** A home goal: every flare in the end, for about forty seconds. */
  goal(): void {
    for (let i = 0; i < this.#left.length; i++) this.#left[i] = Math.max(this.#left[i] as number, 28 + this.#rng() * 22);
    this.#cooldown = 90;
  }

  update(dt: number, excite: number): void {
    this.#cooldown -= dt;
    // Now and then, one or two go up on their own when the end is loud.
    if (this.#cooldown <= 0 && excite > 0.55 && this.#rng() < dt * 0.05) {
      const n = 1 + Math.floor(this.#rng() * 2);
      for (let k = 0; k < n; k++) {
        const i = Math.floor(this.#rng() * this.#left.length);
        this.#left[i] = 20 + this.#rng() * 15;
      }
      this.#cooldown = 60;
    }
    for (let i = 0; i < this.burn.length; i++) {
      const left = Math.max(0, (this.#left[i] as number) - dt);
      this.#left[i] = left;
      // Lights in a second, gutters out over three.
      const want = left > 0 ? Math.min(1, left / 3) : 0;
      const b = this.burn[i] as number;
      this.burn[i] = b + (want - b) * Math.min(1, dt * (want > b ? 3 : 1.2));
    }
  }

  get burning(): number {
    let s = 0;
    for (const b of this.burn) s += b;
    return s / Math.max(1, this.burn.length);
  }
}

/**
 * How often the ground's cameras go off, per person per second: a trickle all match, more
 * as a chance builds, and a blizzard for a goal. Pure, and tested.
 */
export function flashRate(excite: number, burst: number): number {
  return 0.012 + excite * 0.05 + burst * 0.9;
}

const FLARES = 12;
const FLAGS = 8;
const DRUMS = 5;
const TRUMPETS = 3;

interface Fan {
  pos: THREE.Vector3;
  rot: number;
  /** 0 waving, 1 arms down, 2 holding something up (a flare, a flag). */
  arms: number;
}

/** GLSL: a hash good enough to decide which camera fires. */
const HASH = /* glsl */ `
  float tlHash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }`;

export class Ultras {
  readonly group = new THREE.Group();
  readonly #disposables: { dispose(): void }[] = [];
  readonly #u = {
    uTime: { value: 0 },
    /** Beats since the start, fractional. */
    uBeat: { value: 0 },
    /** How hard the barra is jumping, 0..1. */
    uJump: { value: 0.5 },
    uExcite: { value: 0 },
    uNight: { value: 0 },
    /** Seconds since the last home goal, for the paper; large when there has not been one. */
    uPaper: { value: 1e4 },
    uFlashRate: { value: 0.01 },
    /** Pixels per metre at one metre: the points' size, set before each draw. */
    uPx: { value: 800 },
    uBurn: { value: new Array<number>(FLARES).fill(0) },
  };
  readonly #flares: FlareShow;
  readonly #rng: Rng;
  #t = 0;
  #excite = 0;
  #burst = 0;
  readonly #fans: Fan[] = [];
  #mallets!: THREE.InstancedMesh;
  #trumpets!: THREE.InstancedMesh;
  #flags!: THREE.InstancedMesh;
  #poles!: THREE.InstancedMesh;
  readonly #drumAt: { pos: THREE.Vector3; rot: number }[] = [];
  readonly #trumpetAt: { pos: THREE.Vector3; rot: number }[] = [];
  readonly #flagAt: { pos: THREE.Vector3; rot: number; phase: number }[] = [];
  readonly #m = new THREE.Matrix4();
  readonly #q = new THREE.Quaternion();
  readonly #e = new THREE.Euler();
  readonly #s = new THREE.Vector3(1, 1, 1);
  readonly #v = new THREE.Vector3();

  constructor(o: UltrasOptions) {
    this.group.name = 'ultras';
    this.#rng = streamOf(o.seed, 'ultras');
    this.#flares = new FlareShow(FLARES, o.seed);
    const primary = new THREE.Color(o.primary);
    const secondary = new THREE.Color(o.secondary);

    this.#placeFans(o.home);
    const flarePos = this.#pickHolders(FLARES, o.home, 0.3);
    const flagHolders = this.#pickHolders(FLAGS, o.home, 0.45);
    this.#addFans(primary, secondary);
    this.#addDrums(o.home, primary);
    this.#addTrumpets(o.home);
    this.#addFlags(flagHolders, o.primary, o.secondary, o.name);
    this.#addRibbons(o.home, o.primary, o.secondary);
    this.#addBanners(o.home, o.primary, o.secondary, o.name);
    this.#addFlares(flarePos, o.primary);
    this.#addPaper(o.home, o.primary, o.secondary);
    this.#addSigns(o.rakes.filter((r) => r !== o.home), o.primary, o.secondary, o.name);
    this.#addFlashes(o.rakes);
  }

  // ---- the people -----------------------------------------------------------------

  /** Rows of the barra, staggered like a terrace, with a gap in the middle for the drums. */
  #placeFans(r: Rake): void {
    const rows = 11;
    const across = 0.62;
    const half = Math.min(13, r.width * 0.3);
    for (let row = 0; row < rows; row++) {
      const v = 0.06 + (row / rows) * 0.86;
      const stagger = row % 2 ? across / 2 : 0;
      for (let x = -half + stagger; x <= half; x += across) {
        const u = (x + (this.#rng() - 0.5) * 0.12) / r.width;
        const pos = onRake(r, u, v + (this.#rng() - 0.5) * 0.02);
        this.#fans.push({ pos, rot: facingPitch(r) + (this.#rng() - 0.5) * 0.35, arms: this.#rng() < 0.3 ? 1 : 0 });
      }
    }
  }

  /** Choose fans to hold things above their heads, spread across the end. */
  #pickHolders(n: number, r: Rake, minV: number): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    const candidates = this.#fans.filter((f) => f.arms !== 2 && this.#depthOf(f, r) > minV);
    for (let i = 0; i < n && candidates.length; i++) {
      // Spread them: take from evenly spaced slices of a shuffled list, sorted across.
      const k = Math.floor(((i + 0.2 + this.#rng() * 0.6) / n) * candidates.length);
      const fan = candidates.splice(Math.min(k, candidates.length - 1), 1)[0] as Fan;
      fan.arms = 2;
      out.push(fan.pos.clone().setY(fan.pos.y + 2.05).add(this.#side(fan, 0.12)));
    }
    return out;
  }

  #depthOf(f: Fan, r: Rake): number {
    return (f.pos.y - r.y0) / (r.y1 - r.y0);
  }

  /** A vector `d` metres to a fan's right. */
  #side(f: Fan, d: number): THREE.Vector3 {
    return new THREE.Vector3(Math.cos(f.rot) * d, 0, -Math.sin(f.rot) * d);
  }

  #addFans(primary: THREE.Color, secondary: THREE.Color): void {
    // One figure, a hundred and fifty triangles: legs, a torso, a head, two arms. The part
    // each vertex belongs to is baked into its colour's red channel, which the shader
    // reads to colour it and to swing the arms.
    const parts: { geo: THREE.BufferGeometry; part: number }[] = [];
    const add = (geo: THREE.BufferGeometry, part: number, x = 0, y = 0, z = 0, rz = 0) => {
      if (rz) geo.rotateZ(rz);
      geo.translate(x, y, z);
      parts.push({ geo, part });
    };
    // Two legs in jeans, a torso that is wider at the shoulders than the waist, a neck
    // and a head: a person at thirty metres, not a skittle.
    for (const side of [-1, 1]) add(new THREE.CylinderGeometry(0.075, 0.06, 0.86, 6, 1), 6, side * 0.1, 0.43, 0);
    const torso = new THREE.CylinderGeometry(0.21, 0.165, 0.62, 8, 2);
    torso.scale(1, 1, 0.6);
    add(torso, 0, 0, 1.14, 0);
    const chest = new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    chest.scale(0.21, 0.08, 0.126);
    add(chest, 0, 0, 1.45, 0);
    add(new THREE.CylinderGeometry(0.05, 0.055, 0.12, 6, 1), 1, 0, 1.52, 0);
    const head = new THREE.SphereGeometry(1, 8, 6);
    head.scale(0.092, 0.118, 0.104);
    add(head, 1, 0, 1.64, 0.01);
    for (const side of [-1, 1]) {
      // Arms up: from the shoulder, up and a little out. The shader swings them down.
      const arm = new THREE.CylinderGeometry(0.056, 0.045, 0.62, 6, 1);
      arm.translate(0, 0.31, 0);
      add(arm, side < 0 ? 2 : 3, side * 0.2, 1.42, 0, -side * 0.25);
    }
    const geos: THREE.BufferGeometry[] = [];
    for (const p of parts) {
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
      if (g !== p.geo) p.geo.dispose();
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
      const n = g.getAttribute('position').count;
      g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(n).fill(p.part), 1));
      geos.push(g);
    }
    const geo = mergeAll(geos);

    const count = this.#fans.length;
    const seed = new Float32Array(count);
    const arms = new Float32Array(count);
    const shirt = new Float32Array(count * 3);
    const skin = new Float32Array(count * 3);
    const skins = [0xf1c7a5, 0xe0ac86, 0xc68a5f, 0x9c6644, 0x6e4a33, 0xd9a07a];
    const c = new THREE.Color();
    const mesh = new THREE.InstancedMesh(geo, this.#fanMaterial(), count);
    mesh.name = 'barra';
    this.#fans.forEach((f, i) => {
      seed[i] = this.#rng();
      arms[i] = f.arms;
      // The barra wears the shirt: mostly the first colour, some the second, a few in
      // black or white, which is what a real end looks like.
      const pick = this.#rng();
      if (pick < 0.62) c.copy(primary);
      else if (pick < 0.84) c.copy(secondary);
      else c.setHex(pick < 0.93 ? 0x16181c : 0xf2f2f2);
      c.offsetHSL(0, 0, (this.#rng() - 0.5) * 0.08);
      c.toArray(shirt, i * 3);
      c.setHex(skins[Math.floor(this.#rng() * skins.length)] as number).toArray(skin, i * 3);
      this.#e.set(0, f.rot, 0);
      this.#q.setFromEuler(this.#e);
      const s = 0.92 + this.#rng() * 0.14;
      this.#s.set(s, s, s);
      mesh.setMatrixAt(i, this.#m.compose(f.pos, this.#q, this.#s));
    });
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    geo.setAttribute('aArms', new THREE.InstancedBufferAttribute(arms, 1));
    geo.setAttribute('aShirt', new THREE.InstancedBufferAttribute(shirt, 3));
    geo.setAttribute('aSkin', new THREE.InstancedBufferAttribute(skin, 3));
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.#disposables.push(geo);
  }

  #fanMaterial(): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    const u = this.#u;
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, { uTime: u.uTime, uBeat: u.uBeat, uJump: u.uJump, uExcite: u.uExcite });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime; uniform float uBeat; uniform float uJump; uniform float uExcite;
          attribute float aPart; attribute float aSeed; attribute float aArms;
          attribute vec3 aShirt; attribute vec3 aSkin;
          varying vec3 vFan;`)
        .replace('#include <begin_vertex>', `
          vec3 transformed = position;
          float side = aPart == 2.0 ? -1.0 : (aPart == 3.0 ? 1.0 : 0.0);
          // Distance up the arm, before it swings: the top of it is a hand.
          float reach = side != 0.0 ? length(position.xy - vec2(side * 0.2, 1.42)) : 0.0;
          if (side != 0.0) {
            float a;
            if (aArms > 1.5) {
              // Holding a flare or a flag up: arms still, a little sway.
              a = side * 0.12 + 0.05 * sin(uTime * 1.7 + aSeed * 9.0);
            } else if (aArms > 0.5) {
              // Arms down: clapping in front of the chest on the beat.
              a = -side * 2.75 + side * 0.25 * abs(sin((uBeat + aSeed * 0.1) * 3.1416));
            } else {
              // Waving: arms over the head, pumping on the beat, swaying when it is loud.
              float pump = sin((uBeat + aSeed * 0.12) * 6.2832);
              a = side * (0.22 * pump * uJump - 0.1) + 0.3 * sin(uTime * 2.1 + aSeed * 6.0) * uExcite;
            }
            vec2 pivot = vec2(side * 0.2, 1.42);
            vec2 d = transformed.xy - pivot;
            float c = cos(a), s = sin(a);
            transformed.xy = pivot + vec2(c * d.x - s * d.y, s * d.x + c * d.y);
          }
          // Everybody jumps on the beat, each a hair early or late, so it ripples.
          float hop = max(0.0, sin((uBeat * 0.5 + aSeed * 0.08) * 6.2832));
          transformed.y += uJump * 0.2 * hop * hop;
          transformed.x += sin(uTime * 1.3 + aSeed * 10.0) * 0.03;
          vFan = aShirt;
          if (aPart == 1.0) vFan = position.y > 1.69 && fract(aSeed * 13.0) > 0.15 ? vec3(0.05, 0.04, 0.035) : aSkin;
          else if (aPart == 6.0) vFan = mix(vec3(0.06, 0.07, 0.1), vec3(0.16, 0.2, 0.3), step(0.5, fract(aSeed * 7.0)));
          else if (side != 0.0 && reach > 0.5) vFan = aSkin;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vFan;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          diffuseColor.rgb = vFan;`);
    };
    this.#disposables.push(m);
    return m;
  }

  // ---- the band ---------------------------------------------------------------------

  /** Bass drums at the front, each hung off a drummer, and the mallets that hit them. */
  #addDrums(r: Rake, club: THREE.Color): void {
    const front = this.#fans.filter((f) => this.#depthOf(f, r) < 0.12).sort((a, b) => a.pos.x - b.pos.x || a.pos.z - b.pos.z);
    for (let i = 0; i < DRUMS && front.length; i++) {
      const fan = front[Math.floor(((i + 0.5) / DRUMS) * front.length)] as Fan;
      fan.arms = 1;
      this.#drumAt.push({ pos: fan.pos, rot: fan.rot });
    }
    // A bombo: a deep shell on its side, two white heads, a rim at each.
    const shell = new THREE.CylinderGeometry(0.34, 0.34, 0.4, 16, 1, true);
    shell.rotateZ(Math.PI / 2);
    const heads = new THREE.CylinderGeometry(0.33, 0.33, 0.405, 16, 1, false);
    heads.rotateZ(Math.PI / 2);
    const shellMat = new THREE.MeshStandardMaterial({ color: club, roughness: 0.45, metalness: 0.1, side: THREE.DoubleSide });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xf1ede4, roughness: 0.7 });
    const shells = new THREE.InstancedMesh(shell, shellMat, this.#drumAt.length);
    const skins = new THREE.InstancedMesh(heads, headMat, this.#drumAt.length);
    this.#drumAt.forEach((d, i) => {
      this.#drumMatrix(d, 0);
      shells.setMatrixAt(i, this.#m);
      skins.setMatrixAt(i, this.#m);
    });
    const mallet = mergeAll([
      new THREE.CylinderGeometry(0.012, 0.012, 0.42, 5).translate(0, 0.21, 0),
      new THREE.SphereGeometry(0.05, 7, 5).translate(0, 0.44, 0),
    ]);
    const malletMat = new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.8 });
    this.#mallets = new THREE.InstancedMesh(mallet, malletMat, this.#drumAt.length);
    this.#mallets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (const m of [shells, skins, this.#mallets]) {
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.#disposables.push(shell, heads, shellMat, headMat, mallet, malletMat);
  }

  /** The drum hangs at the drummer's waist, in front of him, and jumps when he does. */
  #drumMatrix(d: { pos: THREE.Vector3; rot: number }, hop: number): THREE.Matrix4 {
    this.#e.set(0, d.rot, 0);
    this.#q.setFromEuler(this.#e);
    this.#v.set(Math.sin(d.rot) * 0.36, 0.95 + hop, Math.cos(d.rot) * 0.36).add(d.pos);
    this.#s.set(1, 1, 1);
    return this.#m.compose(this.#v, this.#q, this.#s);
  }

  #addTrumpets(r: Rake): void {
    const front = this.#fans.filter((f) => f.arms !== 2 && this.#depthOf(f, r) > 0.1 && this.#depthOf(f, r) < 0.25);
    for (let i = 0; i < TRUMPETS && front.length; i++) {
      const fan = front.splice(Math.floor(this.#rng() * front.length), 1)[0] as Fan;
      fan.arms = 1;
      this.#trumpetAt.push({ pos: fan.pos, rot: fan.rot });
    }
    // Bell, lead pipe, and the valve block: brass reads at any distance as a glint.
    const geo = mergeAll([
      new THREE.CylinderGeometry(0.075, 0.012, 0.2, 12, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.36),
      new THREE.CylinderGeometry(0.011, 0.011, 0.34, 6).rotateX(Math.PI / 2).translate(0, 0, 0.13),
      new THREE.BoxGeometry(0.035, 0.07, 0.07).translate(0, 0.02, 0.1),
    ]);
    const mat = new THREE.MeshStandardMaterial({ color: 0xd9a93a, roughness: 0.28, metalness: 0.9, side: THREE.DoubleSide });
    this.#trumpets = new THREE.InstancedMesh(geo, mat, Math.max(1, this.#trumpetAt.length));
    this.#trumpets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.#trumpets.frustumCulled = false;
    this.group.add(this.#trumpets);
    this.#disposables.push(geo, mat);
  }

  // ---- flags, ribbons and banners --------------------------------------------------

  #addFlags(holders: THREE.Vector3[], primary: number, secondary: number, name?: string): void {
    const atlas = flagAtlas(primary, secondary, name);
    // Hoisted on the pole's side, 2.2m by 1.4m, hanging from its top.
    const geo = new THREE.PlaneGeometry(2.2, 1.4, 22, 10).translate(1.1, 2.55 - 0.7, 0);
    const cell = new Float32Array(holders.length);
    const seed = new Float32Array(holders.length);
    holders.forEach((p, i) => {
      cell[i] = i % 4;
      seed[i] = this.#rng();
      this.#flagAt.push({ pos: p, rot: facingOf(this.#fans, p), phase: this.#rng() * Math.PI * 2 });
    });
    geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cell, 1));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    const mat = new THREE.MeshStandardMaterial({ map: atlas, side: THREE.DoubleSide, roughness: 0.9 });
    const u = this.#u;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = u.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime; attribute float aCell; attribute float aSeed;`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>
          vMapUv = vec2((mod(aCell, 2.0) + uv.x) * 0.5, (floor(aCell / 2.0) + uv.y) * 0.5);`)
        .replace('#include <begin_vertex>', `
          vec3 transformed = position;
          // Free at the fly, fixed at the pole: the wave grows along the flag.
          float f = position.x / 2.2;
          float w = sin(position.x * 2.6 - uTime * 7.0 + aSeed * 6.0) * 0.22
                  + sin(position.x * 5.1 - uTime * 11.0 + position.y * 2.0) * 0.06;
          transformed.z += w * f;
          transformed.y -= 0.18 * f * f;
          transformed.x -= abs(w) * f * 0.15;`);
    };
    this.#flags = new THREE.InstancedMesh(geo, mat, Math.max(1, holders.length));
    const pole = new THREE.CylinderGeometry(0.018, 0.022, 2.6, 5).translate(0, 1.3, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xcfcfcf, roughness: 0.4, metalness: 0.6 });
    this.#poles = new THREE.InstancedMesh(pole, poleMat, Math.max(1, holders.length));
    for (const m of [this.#flags, this.#poles]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.#disposables.push(atlas, geo, mat, pole, poleMat);
  }

  /**
   * "Tirantes": long ribbons of cloth in the club's colours running from the back of the
   * terrace to the front, held up over everyone's heads. They are how a South American end
   * is recognised from the far side of the ground.
   */
  #addRibbons(r: Rake, primary: number, secondary: number): void {
    const tex = ribbonTexture(primary, secondary);
    const n = 7;
    const len = Math.hypot(r.z1 - r.z0, r.y1 - r.y0) * 0.92;
    const geos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < n; i++) {
      const g = new THREE.PlaneGeometry(0.9, len, 1, 40);
      // Lay it along the rake, over the heads.
      g.rotateX(-Math.PI / 2 - Math.atan2(r.y1 - r.y0, r.z1 - r.z0));
      const across = ((i + 0.5) / n - 0.5) * Math.min(26, r.width * 0.6);
      g.translate(across, (r.y0 + r.y1) / 2 + 2.25, (r.z0 + r.z1) / 2);
      const seed = new Float32Array(g.getAttribute('position').count).fill(i * 1.7);
      g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
      geos.push(g);
    }
    const geo = mergeAll(geos);
    const mat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.85 });
    const u = this.#u;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = u.uTime;
      shader.uniforms.uBeat = u.uBeat;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime; uniform float uBeat; attribute float aSeed;`)
        .replace('#include <begin_vertex>', `
          vec3 transformed = position;
          // Held up by a hundred hands: it rises and falls in waves running down the end.
          transformed.y += 0.18 * sin(uv.y * 18.0 - uTime * 2.4 + aSeed) + 0.08 * sin(uBeat * 3.1416 + uv.y * 6.0);
          transformed.x += 0.06 * sin(uv.y * 11.0 + uTime * 1.3 + aSeed);`);
    };
    const mesh = new THREE.Mesh(geo, mat);
    this.#standFrame(mesh, r);
    this.#disposables.push(tex, geo, mat);
  }

  /** Banners hung over the front wall of the end: the name, and what the end sings. */
  #addBanners(r: Rake, primary: number, secondary: number, name?: string): void {
    const texts = [name ? name.toUpperCase() : 'VAMOS', 'LA 12', 'SIEMPRE CON VOS'];
    const tex = bannerAtlas(texts, primary, secondary);
    const widths = [11, 5, 8];
    const total = widths.reduce((a, b) => a + b, 0) + 2 * 0.8;
    let x = -total / 2;
    const geos: THREE.BufferGeometry[] = [];
    widths.forEach((w, i) => {
      const g = new THREE.PlaneGeometry(w, 1.25, 12, 2);
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setY(k, (uv.getY(k) + (2 - i)) / 3);
      // Facing the pitch (local −Z), draped over the wall's top.
      g.rotateY(Math.PI);
      g.translate(-(x + w / 2), r.y0 - 0.1, r.z0 - 0.05);
      geos.push(g);
      x += w + 0.8;
    });
    const geo = mergeAll(geos);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    this.#standFrame(mesh, r);
    this.#disposables.push(tex, geo, mat);
  }

  #standFrame(obj: THREE.Object3D, r: Rake): void {
    obj.position.set(r.x, 0, r.z);
    obj.rotation.y = r.rotY;
    obj.frustumCulled = false;
    this.group.add(obj);
  }

  // ---- fire, smoke and paper ------------------------------------------------------

  /**
   * Flares: a white-hot core, a red flame round it and a glow that lights the smoke, then
   * the smoke itself — a column of soft particles per flare, rising, spreading, thinning.
   * Everything is computed on the GPU from the clock; the CPU only says how hard each
   * flare is burning.
   */
  #addFlares(at: THREE.Vector3[], primary: number): void {
    const u = this.#u;
    // Fire: three points per flare (core, flame, glow).
    const fire = new THREE.BufferGeometry();
    const fp: number[] = [];
    const fk: number[] = [];
    const fi: number[] = [];
    at.forEach((p, i) => {
      for (let k = 0; k < 3; k++) {
        fp.push(p.x, p.y + 0.05, p.z);
        fk.push(k);
        fi.push(i);
      }
    });
    fire.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    fire.setAttribute('aKind', new THREE.Float32BufferAttribute(fk, 1));
    fire.setAttribute('aFlare', new THREE.Float32BufferAttribute(fi, 1));
    const fireMat = new THREE.ShaderMaterial({
      uniforms: { uTime: u.uTime, uPx: u.uPx, uBurn: u.uBurn },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uTime; uniform float uPx; uniform float uBurn[${FLARES}];
        attribute float aKind; attribute float aFlare;
        varying float vKind; varying float vI;
        ${HASH}
        void main() {
          float b = uBurn[int(aFlare + 0.5)];
          float flick = 0.75 + 0.25 * tlHash(floor(uTime * 24.0) + aFlare * 7.0);
          vKind = aKind;
          vI = b * flick;
          vec3 p = position + vec3(0.0, aKind * 0.08, 0.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float size = aKind < 0.5 ? 0.22 : (aKind < 1.5 ? 0.75 : 5.5);
          gl_PointSize = b < 0.01 ? 0.0 : size * flick * uPx / -mv.z;
        }`,
      fragmentShader: /* glsl */ `
        varying float vKind; varying float vI;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          if (r > 1.0) discard;
          vec3 c;
          float a;
          if (vKind < 0.5) { c = vec3(1.0, 0.95, 0.85) * 6.0; a = 1.0 - r * r; }
          else if (vKind < 1.5) { c = vec3(1.0, 0.25, 0.12) * 3.5; a = pow(1.0 - r, 1.6); }
          else { c = vec3(1.0, 0.18, 0.1); a = pow(1.0 - r, 2.2) * 0.35; }
          gl_FragColor = vec4(c * a * vI, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const firePts = new THREE.Points(fire, fireMat);
    this.#sized(firePts);

    // Smoke: particles cycling up out of each flare.
    const per = 70;
    const smoke = new THREE.BufferGeometry();
    const sp: number[] = [];
    const so: number[] = [];
    const sf: number[] = [];
    const sd: number[] = [];
    at.forEach((p, i) => {
      for (let k = 0; k < per; k++) {
        sp.push(p.x, p.y + 0.15, p.z);
        so.push(k / per + this.#rng() * 0.01);
        sf.push(i);
        sd.push(this.#rng() * 2 - 1, this.#rng() * 2 - 1, this.#rng());
      }
    });
    smoke.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    smoke.setAttribute('aOffset', new THREE.Float32BufferAttribute(so, 1));
    smoke.setAttribute('aFlare', new THREE.Float32BufferAttribute(sf, 1));
    smoke.setAttribute('aDrift', new THREE.Float32BufferAttribute(sd, 3));
    const tint = new THREE.Color(primary);
    const smokeMat = new THREE.ShaderMaterial({
      uniforms: { uTime: u.uTime, uPx: u.uPx, uBurn: u.uBurn, uNight: u.uNight, uTint: { value: tint } },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform float uTime; uniform float uPx; uniform float uBurn[${FLARES}];
        attribute float aOffset; attribute float aFlare; attribute vec3 aDrift;
        varying float vA; varying float vAge;
        void main() {
          float b = uBurn[int(aFlare + 0.5)];
          float life = 7.0;
          float age = fract(uTime / life + aOffset);
          vAge = age;
          // Up, spreading, and carried off toward the back of the stand by the draught.
          vec3 p = position;
          p.y += age * 7.5 + sin(uTime * 0.7 + aDrift.x * 5.0) * 0.3 * age;
          p.x += aDrift.x * age * 3.0 + sin(uTime * 0.5 + aDrift.z * 6.0) * age;
          p.z += aDrift.y * age * 3.0;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float size = mix(0.5, 4.2, sqrt(age)) * (0.8 + aDrift.z * 0.4);
          vA = b * smoothstep(0.0, 0.08, age) * pow(1.0 - age, 1.4);
          gl_PointSize = vA < 0.003 ? 0.0 : size * uPx / -mv.z;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTint; uniform float uNight;
        varying float vA; varying float vAge;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d) * 2.0;
          if (r > 1.0) discard;
          // Lit red by the flare near the source, the grey of the sky higher up, with a
          // little of the club's colour — a coloured smoke flare is half the show.
          vec3 grey = mix(vec3(0.62, 0.6, 0.62), vec3(0.2, 0.2, 0.24), uNight);
          vec3 lit = vec3(1.0, 0.36, 0.26) * (1.2 + uNight);
          vec3 c = mix(lit, mix(grey, uTint, 0.25), smoothstep(0.0, 0.35, vAge));
          float a = vA * (1.0 - r * r) * 0.5;
          gl_FragColor = vec4(c, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const smokePts = new THREE.Points(smoke, smokeMat);
    smokePts.renderOrder = 2;
    this.#sized(smokePts);
    this.#disposables.push(fire, fireMat, smoke, smokeMat);
  }

  /** Paper: a blizzard of it over the end for a home goal, drifting down for ten seconds. */
  #addPaper(r: Rake, primary: number, secondary: number): void {
    const n = 1400;
    const pos: number[] = [];
    const col: number[] = [];
    const seed: number[] = [];
    const c = new THREE.Color();
    const palette = [primary, secondary, 0xffffff, 0xffffff];
    for (let i = 0; i < n; i++) {
      const p = onRake(r, (this.#rng() - 0.5) * 0.75, this.#rng() * 0.95);
      pos.push(p.x, p.y + 3 + this.#rng() * 6, p.z);
      c.setHex(palette[i % palette.length] as number).toArray(col, i * 3);
      seed.push(this.#rng());
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
    const u = this.#u;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: u.uTime, uPaper: u.uPaper, uPx: u.uPx },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform float uTime; uniform float uPaper; uniform float uPx;
        attribute vec3 aColor; attribute float aSeed;
        varying vec3 vC; varying float vA; varying float vSpin;
        void main() {
          float t = uPaper - aSeed * 1.5;
          vec3 p = position;
          // Thrown up, then fluttering down on the air.
          p.y += 2.5 * clamp(t, 0.0, 0.6) - max(0.0, t - 0.6) * (0.9 + aSeed * 0.5);
          p.x += sin(uTime * (2.0 + aSeed * 3.0) + aSeed * 30.0) * 0.4;
          p.z += cos(uTime * (1.5 + aSeed * 2.0) + aSeed * 20.0) * 0.4;
          vC = aColor;
          vA = step(0.0, t) * (1.0 - smoothstep(8.0, 11.0, t)) * step(position.y - 9.0, p.y);
          vSpin = sin(uTime * (6.0 + aSeed * 8.0) + aSeed * 40.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = vA < 0.01 ? 0.0 : 0.12 * uPx / -mv.z;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vC; varying float vA; varying float vSpin;
        void main() {
          // A scrap turning over in the air: a thin rectangle that widens and narrows.
          vec2 d = abs(gl_PointCoord - 0.5) * 2.0;
          if (d.x > abs(vSpin) * 0.9 + 0.1 || d.y > 0.6) discard;
          gl_FragColor = vec4(vC * (0.7 + 0.3 * abs(vSpin)), vA);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.#sized(new THREE.Points(geo, mat));
    this.#disposables.push(geo, mat);
  }

  // ---- the rest of the ground -----------------------------------------------------

  /** Signs held up across every stand, bobbing: the club, a heart, "HOLA MAMÁ". */
  #addSigns(rakes: readonly Rake[], primary: number, secondary: number, name?: string): void {
    const atlas = signAtlas(primary, secondary, name);
    const ey = new THREE.Euler(0, 0, 0, 'YXZ');
    const per = 34;
    const count = rakes.length * per;
    const geo = new THREE.PlaneGeometry(0.95, 0.62);
    const cell = new Float32Array(count);
    const seed = new Float32Array(count);
    const mat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.9, side: THREE.DoubleSide });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    let i = 0;
    for (const r of rakes) {
      for (let k = 0; k < per; k++, i++) {
        const p = onRake(r, (this.#rng() - 0.5) * 0.94, 0.05 + this.#rng() * 0.9);
        p.y += 1.85;
        ey.set(-0.2, facingPitch(r) + (this.#rng() - 0.5) * 0.5, (this.#rng() - 0.5) * 0.3);
        this.#q.setFromEuler(ey);
        this.#s.set(1, 1, 1);
        mesh.setMatrixAt(i, this.#m.compose(p, this.#q, this.#s));
        cell[i] = Math.floor(this.#rng() * 16);
        seed[i] = this.#rng();
      }
    }
    geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cell, 1));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    const u = this.#u;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = u.uTime;
      shader.uniforms.uExcite = u.uExcite;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime; uniform float uExcite; attribute float aCell; attribute float aSeed;`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>
          vMapUv = vec2((mod(aCell, 4.0) + uv.x) * 0.25, (floor(aCell / 4.0) + uv.y) * 0.25);`)
        .replace('#include <begin_vertex>', `
          vec3 transformed = position;
          // Pumped up and down, harder when the ground is up.
          transformed.y += (0.06 + 0.12 * uExcite) * sin(uTime * (3.0 + aSeed * 2.0) + aSeed * 20.0);
          transformed.x += 0.04 * sin(uTime * 1.3 + aSeed * 11.0);`);
    };
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.#disposables.push(atlas, geo, mat);
  }

  /** Camera flashes, scattered over every seat in the ground. */
  #addFlashes(rakes: readonly Rake[]): void {
    const n = 3600;
    const pos: number[] = [];
    const seed: number[] = [];
    const area = rakes.map((r) => r.width * Math.hypot(r.z1 - r.z0, r.y1 - r.y0));
    const total = area.reduce((a, b) => a + b, 0);
    const p = new THREE.Vector3();
    rakes.forEach((r, k) => {
      const m = Math.round((n * (area[k] as number)) / total);
      for (let i = 0; i < m; i++) {
        onRake(r, (this.#rng() - 0.5) * 0.98, this.#rng(), p);
        pos.push(p.x, p.y + 1.35 + this.#rng() * 0.5, p.z);
        seed.push(this.#rng());
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
    const u = this.#u;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: u.uTime, uRate: u.uFlashRate, uPx: u.uPx, uNight: u.uNight },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uTime; uniform float uRate; uniform float uPx;
        attribute float aSeed;
        varying float vI;
        ${HASH}
        void main() {
          // Time in sixth-of-a-second slots, offset per camera. In each slot this camera
          // fires with probability rate / 6; if it does, it is bright and decays fast.
          float t = uTime * 6.0 + aSeed * 91.0;
          float slot = floor(t);
          float fires = step(tlHash(slot * 1.37 + aSeed * 311.0), uRate / 6.0);
          vI = fires * exp(-fract(t) * 9.0);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = vI < 0.02 ? 0.0 : max(2.0, 0.55 * uPx / -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uNight;
        varying float vI;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          if (r > 1.0) discard;
          float a = pow(1.0 - r, 2.0) * vI;
          // A flash is blue-white and, against a dark stand at night, blinding.
          gl_FragColor = vec4(vec3(0.85, 0.92, 1.0) * a * (2.5 + uNight * 4.0), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.#sized(new THREE.Points(geo, mat));
    this.#disposables.push(geo, mat);
  }

  /** Points are sized in metres: tell the shader how many pixels a metre is, per camera. */
  #sized(points: THREE.Points): void {
    const size = new THREE.Vector2();
    points.frustumCulled = false;
    points.onBeforeRender = (renderer, _scene, camera) => {
      renderer.getDrawingBufferSize(size);
      const cam = camera as THREE.PerspectiveCamera;
      const fov = cam.isPerspectiveCamera ? cam.fov : 50;
      this.#u.uPx.value = size.y / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    };
    this.group.add(points);
  }

  // ---- driving it ---------------------------------------------------------------------

  /** A home goal: flares, paper, and every camera in the ground. */
  goal(): void {
    this.#flares.goal();
    this.#u.uPaper.value = 0;
    this.#burst = 1;
  }

  /** A shot, a save, a big moment: a burst of flashes of this size. */
  flash(level: number): void {
    this.#burst = Math.max(this.#burst, Math.min(1, level) * 0.5);
  }

  setNight(on: boolean): void {
    this.#u.uNight.value = on ? 1 : 0;
  }

  /** `excite` is the stadium's 0..1 read of the ground. */
  update(dt: number, excite: number): void {
    this.#t += dt;
    this.#excite += (excite - this.#excite) * Math.min(1, dt * 2);
    this.#burst = Math.max(0, this.#burst - dt / 2.5);
    this.#flares.update(dt, this.#excite);
    const u = this.#u;
    u.uTime.value = this.#t;
    u.uBeat.value = (this.#t * BARRA_BPM) / 60;
    // The barra never stops; it only jumps higher.
    u.uJump.value = 0.45 + this.#excite * 0.55;
    u.uExcite.value = this.#excite;
    u.uPaper.value += dt;
    u.uFlashRate.value = flashRate(this.#excite, this.#burst);
    for (let i = 0; i < FLARES; i++) u.uBurn.value[i] = this.#flares.burn[i] as number;

    // The band: mallets strike on the beat, trumpets rise and fall with the phrase.
    const beat = u.uBeat.value;
    const strike = Math.pow(Math.abs(Math.cos(beat * Math.PI)), 6);
    const hop = 0.2 * u.uJump.value * Math.pow(Math.max(0, Math.sin(beat * Math.PI)), 2);
    this.#drumAt.forEach((d, i) => {
      // The mallet: from the drummer's right hand, swinging into the near head.
      this.#e.set(-0.4 - (1 - strike) * 1.1, d.rot, 1.2, 'YXZ');
      this.#q.setFromEuler(this.#e);
      this.#e.order = 'XYZ';
      this.#v.set(Math.cos(d.rot) * 0.42 + Math.sin(d.rot) * 0.2, 1.05 + hop, -Math.sin(d.rot) * 0.42 + Math.cos(d.rot) * 0.2).add(d.pos);
      this.#s.set(1, 1, 1);
      this.#mallets.setMatrixAt(i, this.#m.compose(this.#v, this.#q, this.#s));
    });
    this.#mallets.instanceMatrix.needsUpdate = true;
    this.#trumpetAt.forEach((t, i) => {
      const lift = 0.25 + 0.15 * Math.sin(this.#t * 1.1 + i * 2);
      this.#e.set(-lift, t.rot, 0, 'YXZ');
      this.#q.setFromEuler(this.#e);
      this.#e.order = 'XYZ';
      this.#v.set(Math.sin(t.rot) * 0.1, 1.55 + hop, Math.cos(t.rot) * 0.1).add(t.pos);
      this.#trumpets.setMatrixAt(i, this.#m.compose(this.#v, this.#q, this.#s));
    });
    this.#trumpets.instanceMatrix.needsUpdate = true;
    // Flags go round in big arcs over the bearer's head.
    this.#flagAt.forEach((f, i) => {
      const swing = Math.sin(this.#t * 1.6 + f.phase) * 0.85;
      this.#e.set(Math.cos(this.#t * 0.8 + f.phase) * 0.15, f.rot, swing, 'YXZ');
      this.#q.setFromEuler(this.#e);
      this.#e.order = 'XYZ';
      this.#v.copy(f.pos);
      this.#v.y += hop * 0.5 - 0.6;
      this.#m.compose(this.#v, this.#q, this.#s);
      this.#flags.setMatrixAt(i, this.#m);
      this.#poles.setMatrixAt(i, this.#m);
    });
    this.#flags.instanceMatrix.needsUpdate = true;
    this.#poles.instanceMatrix.needsUpdate = true;
  }

  /** 0..1: how much of the end is alight, for the audio's hiss and anything else. */
  get burning(): number {
    return this.#flares.burning;
  }

  dispose(): void {
    for (const d of this.#disposables) d.dispose();
    for (const c of this.group.children) if (c instanceof THREE.InstancedMesh) c.dispose();
    this.group.clear();
  }
}

/** Which way the fans nearest a point are facing: flags are waved at the pitch. */
function facingOf(fans: readonly Fan[], p: THREE.Vector3): number {
  let best = Infinity;
  let rot = 0;
  for (const f of fans) {
    const d = (f.pos.x - p.x) ** 2 + (f.pos.z - p.z) ** 2;
    if (d < best) {
      best = d;
      rot = f.rot;
    }
  }
  return rot;
}

/** Merge geometries that may or may not be indexed, keeping position, normal and uv. */
function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const names = Object.keys((flat[0] as THREE.BufferGeometry).attributes).filter((n) =>
    flat.every((g) => g.getAttribute(n) !== undefined),
  );
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const first = (flat[0] as THREE.BufferGeometry).getAttribute(name) as THREE.BufferAttribute;
    const size = first.itemSize;
    const total = flat.reduce((a, g) => a + g.getAttribute(name).count, 0);
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const g of flat) {
      const a = g.getAttribute(name) as THREE.BufferAttribute;
      arr.set(a.array as Float32Array, o);
      o += a.count * size;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  for (const g of geos) g.dispose();
  for (const g of flat) g.dispose();
  return out;
}

// ---- textures -------------------------------------------------------------------------

const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;
/** Black or white, whichever reads on this colour. */
function ink(hex: number): string {
  const c = new THREE.Color(hex);
  return c.r * 0.3 + c.g * 0.59 + c.b * 0.11 > 0.55 ? '#111418' : '#ffffff';
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d') as CanvasRenderingContext2D];
}

function texture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Fit a line of bold text into a box. */
function fitText(g: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, h: number): void {
  let size = h;
  g.font = `900 ${size}px sans-serif`;
  const m = g.measureText(text).width;
  if (m > w) size = Math.floor((size * w) / m);
  g.font = `900 ${size}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x, y);
}

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
}

/** Four flags, 2×2: stripes, halves with a star, a big star, and the name. */
function flagAtlas(primary: number, secondary: number, name?: string): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 660);
  const W = 512;
  const H = 330;
  const P = css(primary);
  const S = css(secondary);
  // Cell 0 (bottom-left in UV space is the canvas's bottom row).
  const cellAt = (i: number) => [(i % 2) * W, (1 - Math.floor(i / 2)) * H] as const;
  {
    const [x, y] = cellAt(0);
    for (let k = 0; k < 7; k++) {
      g.fillStyle = k % 2 ? S : P;
      g.fillRect(x + (k * W) / 7, y, W / 7 + 1, H);
    }
  }
  {
    const [x, y] = cellAt(1);
    g.fillStyle = P;
    g.fillRect(x, y, W / 2, H);
    g.fillStyle = S;
    g.fillRect(x + W / 2, y, W / 2, H);
    g.fillStyle = ink(primary) === '#ffffff' ? '#ffffff' : '#111418';
    star(g, x + W / 2, y + H / 2, 90);
  }
  {
    const [x, y] = cellAt(2);
    g.fillStyle = S;
    g.fillRect(x, y, W, H);
    g.fillStyle = P;
    g.fillRect(x, y + H * 0.3, W, H * 0.4);
    g.fillStyle = ink(primary);
    star(g, x + W * 0.2, y + H / 2, 50);
    star(g, x + W * 0.8, y + H / 2, 50);
    star(g, x + W * 0.5, y + H / 2, 60);
  }
  {
    const [x, y] = cellAt(3);
    g.fillStyle = P;
    g.fillRect(x, y, W, H);
    g.fillStyle = S;
    g.fillRect(x, y, W, 26);
    g.fillRect(x, y + H - 26, W, 26);
    g.fillStyle = ink(primary);
    fitText(g, (name ?? 'VAMOS').toUpperCase(), x + W / 2, y + H / 2, W - 50, 110);
  }
  return texture(c);
}

function ribbonTexture(primary: number, secondary: number): THREE.CanvasTexture {
  const [c, g] = canvas(64, 512);
  // Two long bands of the colours with a thin white seam, and a star every so often.
  g.fillStyle = css(primary);
  g.fillRect(0, 0, 32, 512);
  g.fillStyle = css(secondary);
  g.fillRect(32, 0, 32, 512);
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.fillRect(31, 0, 2, 512);
  const t = texture(c);
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 3);
  return t;
}

/** Three banners stacked vertically in one texture, each with its text. */
function bannerAtlas(texts: string[], primary: number, secondary: number): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 3 * 128);
  texts.forEach((text, i) => {
    const y = i * 128;
    const bg = i % 2 ? secondary : primary;
    const edge = i % 2 ? primary : secondary;
    g.fillStyle = css(bg);
    g.fillRect(0, y, 1024, 128);
    g.fillStyle = css(edge);
    g.fillRect(0, y, 1024, 12);
    g.fillRect(0, y + 116, 1024, 12);
    g.fillStyle = ink(bg);
    fitText(g, text, 512, y + 66, 960, 92);
  });
  return texture(c);
}

/** Sixteen hand-made signs, 4×4: card, marker pen, the odd heart. Cells match a sign's shape. */
function signAtlas(primary: number, secondary: number, name?: string): THREE.CanvasTexture {
  const CW = 256;
  const CH = 168;
  const [c, g] = canvas(CW * 4, CH * 4);
  const club = (name ?? 'VAMOS').toUpperCase();
  const words = ['VAMOS', 'OLÉ', 'DALE', '¡GOL!', club, '♥', 'HOLA MAMÁ', '12', 'FORZA', 'ALLEZ', 'COME ON', '★★★', club, 'SIEMPRE', '♥ ' + club, '#1'];
  const card = [0xffffff, primary, 0xffffff, 0xf7e36a, secondary, 0xffffff, 0xffffff, primary, 0xffffff, secondary, 0xffffff, primary, 0xffffff, 0xffffff, secondary, 0xf7e36a];
  const lum = (hex: number) => {
    const k = new THREE.Color(hex);
    return k.r * 0.3 + k.g * 0.59 + k.b * 0.11;
  };
  words.forEach((w, i) => {
    const x = (i % 4) * CW;
    // Row 0 of the atlas is the BOTTOM of UV space, which is the canvas's last row.
    const y = (3 - Math.floor(i / 4)) * CH;
    const bg = card[i] as number;
    g.fillStyle = '#20242a';
    g.fillRect(x, y, CW, CH);
    g.fillStyle = css(bg);
    g.fillRect(x + 5, y + 5, CW - 10, CH - 10);
    const pale = bg === 0xffffff || bg === 0xf7e36a;
    g.fillStyle = w.startsWith('♥') ? '#d41c3a' : pale ? (lum(primary) < 0.6 ? css(primary) : '#111418') : ink(bg);
    fitText(g, w, x + CW / 2, y + CH / 2 + 4, CW - 36, 92);
  });
  return texture(c);
}
