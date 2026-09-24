// The whole ground in 3D: a person in every occupied seat.
//
// The crowd sheets (textures.ts) are a painting of a crowd, and from the broadcast gantry a
// painting is enough. From a camera behind the goal, or low on the touchline, it is not:
// the stand is flat, nobody's head is in front of anybody else's, and nobody stands up when
// the ball goes in. So when the player asks for it (settings: "3D crowd") every seat gets
// a modelled spectator, and the sheet underneath is repainted with empty seats.
//
// Fifteen thousand people is one instanced draw. Each is about seventy triangles — legs,
// a torso that is wider at the shoulders than the waist, a head, two arms, and a scarf for
// the ones who brought one — and EVERYTHING they do is in the vertex shader off the
// stadium's own clock and excitement: they sit when it is quiet, get up for a chance,
// throw their arms up for a goal, clap, hold scarves over their heads, and stand for the
// Mexican wave as it passes. The CPU never touches them after they are seated.

import * as THREE from 'three';
import { streamOf } from '../core/rng.js';
import type { Rake } from './ultras.js';

/** Seats, metres apart across a row, and rows up the rake. */
const SEAT = 0.56;
const ROW = 0.8;

export interface CrowdOptions {
  seed: number;
  primary: number;
  secondary: number;
  /** 0..1, the share of seats that are filled. */
  density: number;
  rakes: readonly Rake[];
  /** Where the tile's stairways fall: the crowd sheet's tile width in metres, and its seats. */
  tile: number;
  /** A box on one rake to leave empty (the barra stands there, and is modelled apart). */
  exclude?: { rake: Rake; halfWidth: number };
  /** The stadium's crowd uniforms: time, excitement, night, the wave. */
  uniforms: {
    uTime: { value: number };
    uExcite: { value: number };
    uWave: { value: number };
  };
}

/** How many people a crowd of this density puts in these stands. Pure, for budgets. */
export function seatsIn(rakes: readonly Rake[], density: number, tile: number): number {
  let n = 0;
  for (const r of rakes) {
    const rows = Math.max(1, Math.round(Math.hypot(r.z1 - r.z0, r.y1 - r.y0) / ROW));
    const across = Math.floor(r.width / SEAT);
    n += rows * across;
  }
  // Two stairways a tile, each a seat wide.
  const aisleShare = (2 * SEAT) / tile;
  return Math.round(n * (1 - aisleShare) * density * 0.94);
}

export class Crowd {
  readonly group = new THREE.Group();
  readonly #disposables: { dispose(): void }[] = [];
  readonly count: number;

  constructor(o: CrowdOptions) {
    this.group.name = 'crowd3d';
    const rng = streamOf(o.seed, 'crowd3d');
    const seats: { p: THREE.Vector3; rot: number; along: number }[] = [];
    for (const r of o.rakes) {
      const len = Math.hypot(r.z1 - r.z0, r.y1 - r.y0);
      const rows = Math.max(1, Math.round(len / ROW));
      const repeat = Math.max(1, Math.round(r.width / o.tile));
      const tileW = r.width / repeat;
      const c = Math.cos(r.rotY);
      const s = Math.sin(r.rotY);
      for (let row = 0; row < rows; row++) {
        const v = (row + 0.45) / rows;
        const lz = r.z0 + (r.z1 - r.z0) * v;
        const ly = r.y0 + (r.y1 - r.y0) * v;
        for (let x = -r.width / 2 + SEAT / 2; x < r.width / 2 - SEAT / 2; x += SEAT) {
          // The stairways, where the sheet paints steps.
          const inTile = (((x + r.width / 2) % tileW) + tileW) % tileW / tileW;
          const aisleW = SEAT / tileW;
          if (inTile < aisleW || Math.abs(inTile - 0.5) < aisleW / 2 + 0.004) continue;
          if (o.exclude && o.exclude.rake === r && Math.abs(x) < o.exclude.halfWidth) continue;
          if (rng() > o.density * 0.94) continue;
          const lx = x + (rng() - 0.5) * 0.06;
          seats.push({
            p: new THREE.Vector3(r.x + lx * c + lz * s, ly, r.z - lx * s + lz * c),
            rot: r.rotY + Math.PI + (rng() - 0.5) * 0.3,
            along: lx / r.width + 0.5,
          });
        }
      }
    }
    this.count = seats.length;
    if (!seats.length) return;

    const geo = spectatorGeometry();
    const n = seats.length;
    const seed = new Float32Array(n);
    const along = new Float32Array(n);
    const shirt = new Float32Array(n * 3);
    const skin = new Float32Array(n * 3);
    const hair = new Float32Array(n * 3);
    const skins = [0xf1c7a5, 0xe8b996, 0xd9a07a, 0xc68a5f, 0x9c6644, 0x7a4e32, 0x5c3a26];
    const hairs = [0x1c1410, 0x2b2016, 0x3a2618, 0x5b3a1f, 0x8c6a3c, 0xb9a58a, 0x6b6b6b, 0xd8c7a0];
    const primary = new THREE.Color(o.primary);
    const secondary = new THREE.Color(o.secondary);
    const col = new THREE.Color();
    const mesh = new THREE.InstancedMesh(geo, this.#material(o.uniforms), n);
    mesh.name = 'crowd3d';
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const sc = new THREE.Vector3();
    seats.forEach((st, i) => {
      seed[i] = rng();
      along[i] = st.along;
      // A home crowd: mostly the shirt, some the away colour of their own club, the rest
      // in whatever they came in — jackets, hoodies, the neutrals of a real stand.
      const pick = rng();
      if (pick < 0.5) col.copy(primary);
      else if (pick < 0.64) col.copy(secondary);
      else col.setHSL(rng(), 0.08 + rng() * 0.3, 0.14 + rng() * 0.5);
      col.offsetHSL(0, 0, (rng() - 0.5) * 0.08);
      col.toArray(shirt, i * 3);
      col.setHex(skins[Math.floor(rng() * skins.length)] as number).toArray(skin, i * 3);
      col.setHex(hairs[Math.floor(rng() * hairs.length)] as number).toArray(hair, i * 3);
      e.set(0, st.rot, 0);
      q.setFromEuler(e);
      // Children and adults, broad and slight: a crowd is not a row of clones.
      const h = rng() < 0.12 ? 0.72 + rng() * 0.12 : 0.93 + rng() * 0.14;
      const w = h * (0.9 + rng() * 0.2);
      sc.set(w, h, w);
      mesh.setMatrixAt(i, m.compose(st.p, q, sc));
    });
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    geo.setAttribute('aAlong', new THREE.InstancedBufferAttribute(along, 1));
    geo.setAttribute('aShirt', new THREE.InstancedBufferAttribute(shirt, 3));
    geo.setAttribute('aSkin', new THREE.InstancedBufferAttribute(skin, 3));
    geo.setAttribute('aHair', new THREE.InstancedBufferAttribute(hair, 3));
    // The club's scarf: the shirt's colour and the other, in bars.
    geo.setAttribute('aScarfA', new THREE.InstancedBufferAttribute(new Float32Array(n * 3).map((_, k) => primary.toArray()[k % 3] as number), 3));
    geo.setAttribute('aScarfB', new THREE.InstancedBufferAttribute(new Float32Array(n * 3).map((_, k) => secondary.toArray()[k % 3] as number), 3));
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.#disposables.push(geo, mesh);
  }

  #material(u: CrowdOptions['uniforms']): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.88, side: THREE.DoubleSide });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, { uTime: u.uTime, uExcite: u.uExcite, uWave: u.uWave });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime; uniform float uExcite; uniform float uWave;
          attribute float aPart; attribute float aSeed; attribute float aAlong;
          attribute vec3 aShirt; attribute vec3 aSkin; attribute vec3 aHair;
          attribute vec3 aScarfA; attribute vec3 aScarfB;
          varying vec3 vCol;
          vec2 tlRot(vec2 p, vec2 pivot, float a) {
            vec2 d = p - pivot; float c = cos(a), s = sin(a);
            return pivot + vec2(c * d.x - s * d.y, s * d.x + c * d.y);
          }`)
        .replace('#include <begin_vertex>', `
          vec3 transformed = position;
          float r1 = fract(aSeed * 17.31);
          float r2 = fract(aSeed * 91.7);
          float r3 = fract(aSeed * 213.9);
          // The wave, where it is passing this seat.
          float wave = uWave > -0.5 ? smoothstep(0.07, 0.0, abs(aAlong - uWave)) : 0.0;
          // On their feet: a few always are; the rest get up as a chance builds, each at
          // their own point, and everyone for a goal or the wave.
          float up = max(step(0.9, r1), smoothstep(0.35 + r1 * 0.5, 0.5 + r1 * 0.5, uExcite));
          up = max(up, wave);
          // Arms: most hang; up when it is loud (or the wave), and some clap.
          float arms = max(wave, smoothstep(0.7 + r2 * 0.25, 0.8 + r2 * 0.25, uExcite));
          float scarf = step(0.8, r3) * smoothstep(0.45, 0.6, uExcite);
          arms = max(arms, scarf);
          float side = aPart == 2.0 ? -1.0 : (aPart == 3.0 ? 1.0 : 0.0);
          if (side != 0.0) {
            // Hanging a little out, then up over the head, with a wave of the hands.
            float a = side * (0.08 + arms * (2.75 + 0.18 * sin(uTime * 5.0 + aSeed * 30.0)));
            transformed.xy = tlRot(transformed.xy, vec2(side * 0.2, 1.4), a);
            // Clapping: forearms forward and together, on and off the beat.
            float clap = (1.0 - arms) * step(0.55, r2) * smoothstep(0.3, 0.5, uExcite);
            float dz = clamp((1.4 - position.y) / 0.6, 0.0, 1.0);
            transformed.z += clap * dz * 0.35;
            transformed.x -= clap * dz * side * (0.12 + 0.05 * sin(uTime * 14.0 + aSeed * 50.0));
          }
          if (aPart == 7.0) {
            // The scarf, stretched between the hands over the head — only when held up.
            transformed *= scarf;
            transformed.y += scarf * 0.02 * sin(uTime * 3.0 + aSeed * 12.0);
          }
          // Sitting: the body drops onto the seat and the legs fold forward under it.
          float sit = 1.0 - up;
          if (aPart == 6.0) {
            // 0 at the hip, 1 at the foot. Seated, the thigh runs forward level with the
            // seat and the shin drops to the floor; the tube's own radius turns with it.
            float t = clamp((0.86 - position.y) / 0.86, 0.0, 1.0);
            vec3 seated = t < 0.5
              ? vec3(position.x, 0.44 + position.z, t * 0.86)
              : vec3(position.x, 0.44 - (t - 0.5) * 0.86, 0.43 + position.z);
            transformed = mix(position, seated, sit);
          } else {
            transformed.y -= sit * 0.42;
            transformed.z += sit * 0.04;
          }
          // A little life in everyone: a sway, a bounce on their feet when it is loud.
          transformed.x += sin(uTime * 0.9 + aSeed * 40.0) * 0.02;
          transformed.y += up * uExcite * 0.08 * max(0.0, sin(uTime * 7.0 + aSeed * 20.0));

          vCol = aShirt;
          if (aPart == 1.0) {
            // Hair on top and at the back, longer on some.
            float longHair = step(0.7, r3);
            bool isHair = position.y > 1.655 - longHair * 0.08 && position.z < 0.07 - longHair * 0.02
                       || (longHair > 0.5 && position.z < -0.02 && position.y > 1.5);
            vCol = isHair && r1 > 0.06 ? aHair : aSkin;
          } else if (aPart == 6.0) {
            vCol = mix(vec3(0.07, 0.08, 0.11), vec3(0.18, 0.22, 0.32), step(0.5, r2));
          } else if (side != 0.0) {
            // Short sleeves on most; the hand is always skin.
            float reach = length(position.xy - vec2(side * 0.2, 1.4));
            if (reach > 0.5 || (r3 > 0.45 && reach > 0.2)) vCol = aSkin;
          } else if (aPart == 7.0) {
            vCol = mod(floor((position.x + 0.4) * 10.0), 2.0) < 1.0 ? aScarfA : aScarfB;
          }`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vCol;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          diffuseColor.rgb = vCol;`);
    };
    this.#disposables.push(m);
    return m;
  }

  dispose(): void {
    for (const d of this.#disposables) d.dispose();
    this.group.clear();
  }
}

/**
 * One spectator, standing, facing +Z, feet on the floor: about seventy triangles. The part
 * each vertex belongs to rides in `aPart`, which the shader reads to colour and to move it.
 */
export function spectatorGeometry(): THREE.BufferGeometry {
  const parts: [THREE.BufferGeometry, number][] = [];
  const legs = new THREE.CylinderGeometry(0.155, 0.12, 0.86, 5, 1, true).translate(0, 0.43, 0);
  legs.scale(1, 1, 0.7);
  parts.push([legs, 6]);
  const torso = new THREE.CylinderGeometry(0.2, 0.155, 0.58, 6, 1, false).translate(0, 1.13, 0);
  torso.scale(1, 1, 0.62);
  parts.push([torso, 0]);
  const head = new THREE.IcosahedronGeometry(0.1, 1).scale(0.9, 1.12, 1).translate(0, 1.58, 0.005);
  parts.push([head, 1]);
  for (const side of [-1, 1]) {
    const arm = new THREE.CylinderGeometry(0.05, 0.04, 0.6, 4, 1, true).translate(0, -0.3, 0);
    arm.translate(side * 0.2, 1.4, 0);
    parts.push([arm, side < 0 ? 2 : 3]);
  }
  // The scarf, over the head between two raised hands.
  parts.push([new THREE.PlaneGeometry(0.7, 0.12).translate(0, 2.02, 0.02), 7]);

  const flat = parts.map(([g, part]) => {
    const f = g.index ? g.toNonIndexed() : g;
    if (f !== g) g.dispose();
    for (const name of Object.keys(f.attributes)) if (name !== 'position' && name !== 'normal') f.deleteAttribute(name);
    f.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(f.getAttribute('position').count).fill(part), 1));
    return f;
  });
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'aPart']) {
    const size = (flat[0] as THREE.BufferGeometry).getAttribute(name).itemSize;
    const total = flat.reduce((a, g) => a + g.getAttribute(name).count, 0);
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const g of flat) {
      arr.set(g.getAttribute(name).array as Float32Array, o);
      o += g.getAttribute(name).count * size;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  for (const g of flat) g.dispose();
  return out;
}
