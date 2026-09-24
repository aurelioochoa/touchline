// Rain.
//
// A few thousand streaks in one draw call, moved entirely on the GPU: the vertex shader
// works out where a drop is from the clock, so the CPU never touches a particle. That
// matters because rain is the one effect that wants a lot of instances and the frame
// budget is already spoken for by twenty-five figures and a stadium.
//
// Streaks rather than points. A point sprite is screen-aligned and rotationally symmetric,
// so a field of them reads as snow or as static however fast they fall; a line segment has
// a direction, and rain is almost entirely direction.

import * as THREE from 'three';
import { clamp01, lerp } from '../core/math.js';
import type { Conditions } from '../sim/match/conditions.js';

/** The volume of air the rain lives in, centred on the camera. */
const BOX = new THREE.Vector3(90, 42, 90);

export class Rain {
  readonly group = new THREE.Group();
  readonly #mesh: THREE.LineSegments;
  readonly #material: THREE.ShaderMaterial;
  readonly #geometry: THREE.BufferGeometry;
  #time = 0;

  constructor(drops = 2600) {
    this.group.name = 'rain';
    this.group.visible = false;

    // Two vertices per drop: the base and the tip. Both are given the SAME base position
    // and separated in the shader, so a streak can never be torn in half by the wrap —
    // which is what happens if each vertex wraps on its own y.
    const base = new Float32Array(drops * 2 * 3);
    const tip = new Float32Array(drops * 2);
    const seed = new Float32Array(drops * 2);
    for (let i = 0; i < drops; i++) {
      const x = (Math.random() - 0.5) * BOX.x;
      const y = (Math.random() - 0.5) * BOX.y;
      const z = (Math.random() - 0.5) * BOX.z;
      const s = Math.random() * BOX.y;
      for (const v of [0, 1]) {
        const k = (i * 2 + v) * 3;
        base[k] = x;
        base[k + 1] = y;
        base[k + 2] = z;
        tip[i * 2 + v] = v;
        seed[i * 2 + v] = s;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(base, 3));
    geo.setAttribute('aTip', new THREE.BufferAttribute(tip, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    // The rain is always around the camera, so there is nothing to cull it against.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), BOX.length());
    this.#geometry = geo;

    this.#material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uFall: { value: 26 },
        uBoxY: { value: BOX.y },
        uStreak: { value: new THREE.Vector3(0, -0.75, 0) },
        uColor: { value: new THREE.Color(0xcfe3f2) },
        uOpacity: { value: 0 },
      },
      vertexShader: `
        attribute float aTip;
        attribute float aSeed;
        uniform float uTime;
        uniform float uFall;
        uniform float uBoxY;
        uniform vec3 uStreak;
        varying float vFade;
        void main() {
          // One wrap, computed from the drop's own base height, then the tip is added on
          // afterwards so both ends of a streak always agree about where they are.
          float y = position.y - mod(uTime * uFall + aSeed, uBoxY);
          y = mod(y + uBoxY * 0.5, uBoxY) - uBoxY * 0.5;
          vec3 q = vec3(position.x, y, position.z) + uStreak * aTip;
          vec4 mv = modelViewMatrix * vec4(q, 1.0);
          // Fade the far drops out rather than ending the rain at a hard wall.
          vFade = 1.0 - smoothstep(24.0, 52.0, length(mv.xyz));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vFade;
        void main() {
          gl_FragColor = vec4(uColor, uOpacity * vFade);
        }`,
    });

    this.#mesh = new THREE.LineSegments(geo, this.#material);
    this.#mesh.frustumCulled = false;
    this.#mesh.renderOrder = 3;
    this.group.add(this.#mesh);
  }

  /** How hard it is raining, and which way the wind is blowing it. */
  setConditions(c: Conditions): void {
    const heavy = c.sky === 'heavyRain';
    const raining = heavy || c.sky === 'rain';
    this.group.visible = raining;
    if (!raining) return;
    const u = this.#material.uniforms;
    (u.uOpacity as { value: number }).value = heavy ? 0.5 : 0.3;
    (u.uFall as { value: number }).value = heavy ? 32 : 24;
    // Wind blows the streak sideways, which is the only cue in the whole scene for which
    // way the wind the ball is being bent by is actually going.
    const drift = new THREE.Vector3(c.windX, 0, c.windY).multiplyScalar(0.34);
    const streak = new THREE.Vector3(drift.x, heavy ? -1.05 : -0.8, drift.z);
    (u.uStreak as { value: THREE.Vector3 }).value.copy(streak);
    (u.uColor as { value: THREE.Color } ).value.setHex(heavy ? 0xbcd4e8 : 0xd2e6f4);
  }

  /** Keep the volume around the camera and advance the clock. */
  update(dt: number, camera: THREE.Camera): void {
    if (!this.group.visible) return;
    this.#time += dt;
    (this.#material.uniforms.uTime as { value: number }).value = this.#time;
    this.group.position.set(camera.position.x, camera.position.y, camera.position.z);
  }

  dispose(): void {
    this.#geometry.dispose();
    this.#material.dispose();
    this.group.clear();
  }
}

/**
 * The palette one set of conditions puts the whole scene in.
 *
 * Kept as data rather than as branches inside the renderer so the four skies can be read
 * side by side — which is the only way to tell that "overcast" is not simply "clear with
 * the exposure down".
 */
export interface SkyPalette {
  top: number;
  mid: number;
  bottom: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  /** Sun colour and strength. */
  key: number;
  keyIntensity: number;
  ambient: number;
  ambientIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  exposure: number;
}

const CLEAR_DAY: SkyPalette = {
  top: 0x3f8fd8, mid: 0x9fcdec, bottom: 0xe8f1f6,
  fog: 0xb6d8ef, fogNear: 150, fogFar: 460,
  key: 0xfff4e0, keyIntensity: 3.6,
  ambient: 0xd8e6f2, ambientIntensity: 0.85,
  hemiSky: 0xbfe0ff, hemiGround: 0x4e7f45, hemiIntensity: 1.5,
  exposure: 1.12,
};

const GOLDEN: SkyPalette = {
  top: 0x2f6ea8, mid: 0xd79a63, bottom: 0xf6d7a8,
  fog: 0xd9a978, fogNear: 120, fogFar: 400,
  key: 0xffd9a0, keyIntensity: 3.1,
  ambient: 0xe6d2c0, ambientIntensity: 0.8,
  hemiSky: 0xd9b48a, hemiGround: 0x40663c, hemiIntensity: 1.2,
  exposure: 1.1,
};

const OVERCAST: SkyPalette = {
  top: 0x8c9aa6, mid: 0xa9b6c0, bottom: 0xc7d0d6,
  fog: 0xa9b6c0, fogNear: 90, fogFar: 330,
  key: 0xdfe7ee, keyIntensity: 1.5,
  // Flat light needs MORE ambient, not less: with the key down, ambient is all the
  // shaded side of a figure has, and a dark silhouette on grey grass is unreadable.
  ambient: 0xc6d2dc, ambientIntensity: 1.5,
  hemiSky: 0xb9c6d2, hemiGround: 0x4a6b46, hemiIntensity: 1.9,
  exposure: 1.06,
};

const WET: SkyPalette = {
  top: 0x5a6672, mid: 0x76828d, bottom: 0x99a4ad,
  fog: 0x76828d, fogNear: 70, fogFar: 260,
  key: 0xcdd8e2, keyIntensity: 1.1,
  ambient: 0xb3c0cc, ambientIntensity: 1.55,
  hemiSky: 0x9fadba, hemiGround: 0x3f5c3d, hemiIntensity: 1.9,
  exposure: 1.02,
};

const FLOODLIT: SkyPalette = {
  top: 0x060b16, mid: 0x0d1626, bottom: 0x1b2740,
  fog: 0x101a2b, fogNear: 80, fogFar: 300,
  // Floodlights are cold and come from four corners at once, which averages to a
  // near-vertical soft key. Four real shadow-casting lights would be four extra shadow
  // passes for a signature nobody asked for.
  key: 0xeaf2ff, keyIntensity: 3.3,
  // Less fill than daylight, on purpose. A floodlit pitch is bright but the CONTRAST is
  // what says "night": lit grass against a dark bowl. Matching daylight's ambient makes
  // an evening match render as an afternoon with a black sky behind it.
  ambient: 0x8fa4c4, ambientIntensity: 0.8,
  hemiSky: 0x6f86ad, hemiGround: 0x24382a, hemiIntensity: 0.7,
  exposure: 1.16,
};

function mixHex(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (
    (Math.round(lerp(ar, br, t)) << 16) |
    (Math.round(lerp(ag, bg, t)) << 8) |
    Math.round(lerp(ab, bb, t))
  );
}

function blend(a: SkyPalette, b: SkyPalette, t: number): SkyPalette {
  const m = (k: keyof SkyPalette): number =>
    k === 'top' || k === 'mid' || k === 'bottom' || k === 'fog' ||
    k === 'key' || k === 'ambient' || k === 'hemiSky' || k === 'hemiGround'
      ? mixHex(a[k], b[k], t)
      : lerp(a[k], b[k], t);
  return {
    top: m('top'), mid: m('mid'), bottom: m('bottom'),
    fog: m('fog'), fogNear: m('fogNear'), fogFar: m('fogFar'),
    key: m('key'), keyIntensity: m('keyIntensity'),
    ambient: m('ambient'), ambientIntensity: m('ambientIntensity'),
    hemiSky: m('hemiSky'), hemiGround: m('hemiGround'), hemiIntensity: m('hemiIntensity'),
    exposure: m('exposure'),
  };
}

/** The palette for a set of conditions, blended across time of day. */
export function paletteFor(c: Conditions): SkyPalette {
  const wet = c.sky === 'rain' || c.sky === 'heavyRain';
  const day = wet ? WET : c.sky === 'overcast' ? OVERCAST : CLEAR_DAY;
  if (c.floodlit) {
    // Dusk into night. The crossover has to COMPLETE inside the range real kick-offs
    // actually fall in: spread over 0.42..0.82 it left a winter evening match — which is
    // most floodlit football — sitting halfway between a golden afternoon and a night, and
    // rendering as an ordinary bright day with the lights on for no reason.
    const t = clamp01((c.timeOfDay - 0.36) / 0.24);
    return blend(blend(day, GOLDEN, 0.4), FLOODLIT, t);
  }
  const evening = clamp01((c.timeOfDay - 0.2) / 0.3);
  return blend(day, GOLDEN, evening * (wet ? 0.35 : 1));
}

/**
 * Where the sun is, as a unit direction.
 *
 * High and to one side at midday, dropping toward the horizon as the day goes. Under
 * floodlights it goes nearly vertical, because that is what four corner pylons average to.
 */
export function sunDirection(c: Conditions, out: THREE.Vector3): THREE.Vector3 {
  if (c.floodlit) {
    const t = clamp01((c.timeOfDay - 0.42) / 0.4);
    const elev = lerp(0.55, 1.35, t);
    return out.set(0.3 * (1 - t), Math.sin(elev), 0.24 * (1 - t)).normalize();
  }
  // 68 degrees at midday down to 12 at dusk.
  const elev = lerp(1.19, 0.21, clamp01(c.timeOfDay / 0.55));
  return out.set(0.42, Math.tan(elev) * 0.42, 0.3).normalize();
}
