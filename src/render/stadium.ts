// The ground around the pitch: a closed bowl, a crowd, hoardings, floodlights and a sky.
//
// The crowd is a texture, not people. Twenty thousand modelled spectators would cost more
// than the football does, and at broadcast distance a sheet of coloured smudges that
// shimmers slightly is indistinguishable from the real thing — which is the whole argument
// for procedural art at this budget (VALUES.md).

import * as THREE from 'three';
import { PITCH_LENGTH, PITCH_WIDTH } from '../sim/match/pitch.js';
import { concreteTexture, crowdTexture, glazingTextures, roofSheetTexture } from './textures.js';
import { SURROUND } from './pitch.js';

/**
 * The bowl, in metres. These are not free numbers: `camera.ts` places every preset
 * against them, so a change here is a change there. The rake is
 * `atan(STAND_HEIGHT / STAND_DEPTH)` ≈ 29°, which is a real terrace angle.
 */
export const STAND_DEPTH = 22;
export const STAND_HEIGHT = 12;
export const WALL_HEIGHT = 1.5;
/** Underside of the roof. Every camera preset that looks over a stand must clear this. */
export const ROOF_HEIGHT = 16.5;
/** How far the roof reaches forward from the back wall. */
const ROOF_DEPTH = 10;
/**
 * The two tiers. The lower tier rises from the front wall to the hospitality boxes; the
 * boxes are a glazed step; the upper tier starts on top of them and finishes exactly where
 * the single rake used to, so the bowl's envelope — which the cameras are placed against —
 * is unchanged. The upper tier is steeper than the lower, as it is in every real ground.
 */
const LOWER_DEPTH = 12;
const LOWER_RISE = 4.8;
/** The glazed boxes, then the parapet above them that carries the second LED ribbon. */
const BOX_GLASS = 1.9;
const BOX_PARAPET = 0.8;
const UPPER_FRONT = WALL_HEIGHT + LOWER_RISE + BOX_GLASS + BOX_PARAPET;
/** Seats are about 0.8 metres a row. */
const ROW_PITCH = 0.8;
/** A crowd sheet's tile, metres along the stand, and the seats across one. */
const CROWD_TILE = 26;
const CROWD_COLS = 34;
/** Metres of LED board per repeat of its 2048px texture: 8 panels of 6m. */
const LED_TILE = 48;
/** Metres of glazing per repeat of its texture: 16 panes of 2m. */
const GLASS_TILE = 32;
/** Metres per repeat of the concrete and roof-sheet textures. */
const CONCRETE_TILE = 8;
const SHEET_TILE = 3;

/** Metres from the touchline to the advertising hoardings. */
const HOARDING_INSET = 3.4;
const HOARDING_HEIGHT = 0.95;

/** Half-extents of the grass rectangle — the stands start exactly here. */
export const BOWL_HALF_LENGTH = PITCH_LENGTH / 2 + SURROUND;
export const BOWL_HALF_WIDTH = PITCH_WIDTH / 2 + SURROUND;

export interface StadiumColors {
  /** The home club's kit, which is what most of the crowd is wearing. */
  primary: number;
  secondary: number;
  /** The top of the roof. Slate unless the club has painted it. */
  roof?: number;
  /** The home club's name, for the LED boards. */
  name?: string;
}

export class Stadium {
  readonly group = new THREE.Group();
  readonly #disposables: { dispose(): void }[] = [];
  readonly #crowdMats: THREE.MeshStandardMaterial[] = [];
  readonly #lampMats: THREE.MeshStandardMaterial[] = [];
  #skyMat: THREE.ShaderMaterial | null = null;
  #t = 0;
  /** The LED boards' texture (scrolled) and material (brighter under lights). */
  #ledTex: THREE.Texture | null = null;
  #ledMat: THREE.MeshStandardMaterial | null = null;
  /** The hospitality boxes' glass: lit rooms are brighter at night. */
  readonly #glassMats: THREE.MeshStandardMaterial[] = [];
  /** Crowd sheets by rows, shade and variant: see `#crowdMaterial`. */
  readonly #sheets = new Map<string, THREE.CanvasTexture>();
  /** Shared by every crowd sheet's shader: time, how excited, and whether it is night. */
  readonly #crowdUniforms = {
    uTime: { value: 0 },
    uExcite: { value: 0 },
    uNight: { value: 0 },
    /** Where a Mexican wave has got to along each stand, 0..1, or -1 for no wave. */
    uWave: { value: -1 },
  };
  /** A goal: decays from 1 over a few seconds, and lifts everything the crowd does. */
  #roar = 0;
  #danger = 0;
  /**
   * Everything short of a goal: an olé, a booked defender, a save. Decays over a couple of
   * seconds, faster than the roar, because a crowd sits back down after a near miss much
   * sooner than after a goal.
   */
  #buzz = 0;
  /** Seconds into the current wave, or -1. */
  #waveT = -1;
  #waveLen = 6;

  constructor(seed: number, colors: StadiumColors = { primary: 0x2f8f43, secondary: 0xffffff }) {
    this.group.name = 'stadium';

    const concreteTex = concreteTexture();
    const concrete = new THREE.MeshStandardMaterial({ color: 0xa3abb4, roughness: 0.94, map: concreteTex });
    const deck = new THREE.MeshStandardMaterial({ color: 0x78818c, roughness: 0.95, map: concreteTex });
    this.#disposables.push(concreteTex);
    // Two roof materials, because a roof is seen from both sides in the same match. The
    // FAR stand's roof is seen from underneath and has to be light enough not to read as
    // a black bar across the top of the frame; the NEAR stand's is seen from above by the
    // broadcast camera, in full sun, and at 0x59626d it came out near-white — a featureless
    // slab across the bottom ninth of every wide shot, and the brightest thing in it.
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x59626d, roughness: 0.85, side: THREE.DoubleSide,
    });
    // A painted roof is darkened a third toward the slate: the broadcast camera looks down
    // on the near one in full sun, and a pure club colour there is the brightest thing in
    // every wide shot (see the comment on roofMat above).
    const roofTop = new THREE.Color(colors.roof ?? 0x2f3944);
    if (colors.roof !== undefined) roofTop.lerp(new THREE.Color(0x2f3944), 0.33);
    // Profiled sheeting, so the near roof has ribs rather than being a flat slab.
    const sheetTex = roofSheetTexture();
    const roofTopMat = new THREE.MeshStandardMaterial({ color: roofTop, roughness: 0.62, metalness: 0.12, map: sheetTex });
    this.#disposables.push(roofTopMat, sheetTex);
    const steel = new THREE.MeshStandardMaterial({ color: 0xb9c1c9, roughness: 0.5, metalness: 0.3 });
    // The fascia along the front of the roof: the club colour, the band every ground is
    // recognised by from the far side.
    const fasciaCol = new THREE.Color(colors.primary).lerp(new THREE.Color(0x20262d), 0.3);
    const fascia = new THREE.MeshStandardMaterial({ color: fasciaCol, roughness: 0.55, metalness: 0.2 });
    // The ring of lights under the fascia. A modern ground lights the pitch from its roof,
    // and at night that ring is what the whole bowl is lit by.
    const ringTex = lampGridTexture();
    ringTex.wrapS = THREE.RepeatWrapping;
    const ring = new THREE.MeshStandardMaterial({
      color: 0x20242a, roughness: 0.3, metalness: 0.2, side: THREE.DoubleSide,
      emissive: 0xfff6e0, emissiveMap: ringTex, emissiveIntensity: 0.35,
    });
    this.#lampMats.push(ring);
    this.#disposables.push(concrete, deck, roofMat, steel, fascia, ringTex, ring);
    const led = this.#makeLed(colors);
    const parts: StandParts = { concrete, deck, soffit: roofMat, sheeting: roofTopMat, steel, fascia, ring, led };

    const halfL = BOWL_HALF_LENGTH;
    const halfW = BOWL_HALF_WIDTH;

    // Two side stands (long) and two end stands (short).
    //
    // The rotation is the whole trick and it was wrong for a long time. A stand's local +Z
    // is "away from the pitch"; three.js maps local +Z to world (sin θ, 0, cos θ). So the
    // stand at x = +halfL needs θ = +π/2 to point at +X, and the one at x = −halfL needs
    // −π/2. With those two swapped — which is the intuitive-looking assignment — both end
    // stands are built INWARDS, and a twenty-two metre concrete back wall stands across
    // the pitch at x = ±33. That is exactly how this looked, in every screenshot, for the
    // whole of the game's first version.
    const sideWidth = PITCH_LENGTH + SURROUND * 2;
    const endWidth = PITCH_WIDTH + SURROUND * 2;
    this.#addStand(parts, sideWidth, seed + 1, colors, 0, halfW, 0);
    this.#addStand(parts, sideWidth, seed + 2, colors, 0, -halfW, Math.PI);
    this.#addStand(parts, endWidth, seed + 3, colors, halfL, 0, Math.PI / 2);
    this.#addStand(parts, endWidth, seed + 4, colors, -halfL, 0, -Math.PI / 2);

    // The corners. Four rectangular stands leave four diagonal holes with sky behind them,
    // and a hole in a stadium reads as a mistake from every camera angle that catches one.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this.#addCorner(parts, seed + 10 + sx + sz * 2, colors, sx * halfL, sz * halfW);
      }
    }

    this.#addHoardings();
    this.#addDugouts(colors);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this.#addFloodlight(steel, sx * (halfL + 4), sz * (halfW + 4));
      }
    }

    // A sky dome. Cheap, and it stops the horizon being the void.
    const skyGeo = new THREE.SphereGeometry(420, 24, 14);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(0x3f8fd8) },
        mid: { value: new THREE.Color(0x9fcdec) },
        bottom: { value: new THREE.Color(0xe8f1f6) },
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vDir = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      // Clouds: a few octaves of value noise projected onto a flat layer overhead, so they
      // bunch up and flatten toward the horizon the way a real cloud deck does, drifting
      // slowly. Their colour comes from the sky's own gradient, so an overcast grey sky
      // gets grey cloud, a clear one gets white, and a night sky gets dark shapes against
      // the dark rather than lit ones.
      fragmentShader: `
        uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; uniform float uTime;
        varying vec3 vDir;
        float sh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float sn(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(sh(i), sh(i + vec2(1.0, 0.0)), u.x), mix(sh(i + vec2(0.0, 1.0)), sh(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        float fbm(vec2 p) {
          float a = 0.5; float s = 0.0;
          for (int i = 0; i < 5; i++) { s += a * sn(p); p = p * 2.03 + 17.0; a *= 0.5; }
          return s;
        }
        void main() {
          vec3 d = normalize(vDir);
          float vH = d.y;
          float h = clamp(vH * 1.25 + 0.18, 0.0, 1.0);
          vec3 c = h < 0.5 ? mix(bottom, mid, h * 2.0) : mix(mid, top, (h - 0.5) * 2.0);
          if (d.y > 0.0) {
            vec2 uv = d.xz / (d.y + 0.1) * 1.6 + vec2(uTime * 0.006, uTime * 0.0025);
            float n = fbm(uv);
            float cover = smoothstep(0.5, 0.78, n) * smoothstep(0.0, 0.22, d.y);
            float shadeN = fbm(uv * 2.3 + 5.0);
            vec3 cloud = max(mid, bottom) * (0.86 + shadeN * 0.3);
            c = mix(c, cloud, cover * 0.85);
          }
          gl_FragColor = vec4(c, 1.0);
          // Through the same tone curve and colour space as everything else, so the sky is
          // the same sky with and without the post chain (post.ts) — before these two lines
          // it was grey-blue on the low tiers and near-white on the high ones.
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.#skyMat = skyMat;
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.name = 'sky';
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    this.group.add(sky);
    this.#disposables.push(skyGeo, skyMat);
  }

  /** Repaint the sky gradient for the current weather and time of day. */
  setSky(top: number, mid: number, bottom: number): void {
    const u = this.#skyMat?.uniforms;
    if (!u) return;
    (u.top as { value: THREE.Color }).value.setHex(top);
    (u.mid as { value: THREE.Color }).value.setHex(mid);
    (u.bottom as { value: THREE.Color }).value.setHex(bottom);
  }

  /**
   * Switch the pylon heads on.
   *
   * Emissive only: the light in the scene is still the one directional key, because four
   * shadow-casting lamps is four extra shadow passes. What the emissive gives is the part
   * a viewer actually reads — four bright lamps against a dark sky.
   */
  setFloodlights(on: boolean): void {
    for (const m of this.#lampMats) {
      // Over the bloom threshold at night (post.ts), so a bank of lamps glows as one.
      m.emissiveIntensity = on ? 5.5 : 0.35;
    }
    if (this.#ledMat) this.#ledMat.emissiveIntensity = on ? 1.7 : 0.95;
    for (const m of this.#glassMats) m.emissiveIntensity = on ? 1.5 : 0.1;
    this.#crowdUniforms.uNight.value = on ? 1 : 0;
  }

  /**
   * How the crowd is feeling: `danger` is the renderer's 0..1 read of how close the play
   * is to a chance, and a goal is `roar()`. Both feed the crowd shader and the boards.
   */
  setDanger(danger: number): void {
    this.#danger = danger;
  }

  roar(): void {
    this.#roar = 1;
  }

  /** A reaction, 0..1: the stands come up by that much and settle. */
  react(lift: number): void {
    this.#buzz = Math.min(1, Math.max(this.#buzz, lift));
  }

  /** Start a Mexican wave round the ground, unless one is already going. */
  wave(seconds = 6): void {
    if (this.#waveT >= 0) return;
    this.#waveT = 0;
    this.#waveLen = seconds;
  }

  /**
   * The crowd shifts. One texture offset per frame, which costs nothing and is the
   * difference between a stadium and a photograph of one.
   */
  update(dt: number): void {
    this.#t += dt;
    this.#roar = Math.max(0, this.#roar - dt / 6);
    this.#buzz = Math.max(0, this.#buzz - dt / 2.2);
    if (this.#waveT >= 0) {
      this.#waveT += dt;
      if (this.#waveT > this.#waveLen) this.#waveT = -1;
    }
    // The band runs a little past both ends so it enters and leaves rather than appearing.
    this.#crowdUniforms.uWave.value = this.#waveT < 0 ? -1 : -0.1 + (this.#waveT / this.#waveLen) * 1.2;
    const x = Math.sin(this.#t * 0.7) * 0.0035;
    const y = Math.sin(this.#t * 1.13) * 0.0026;
    for (const m of this.#crowdMats) {
      if (!m.map) continue;
      m.map.offset.x = x;
      m.map.offset.y = y;
    }
    this.#crowdUniforms.uTime.value = this.#t;
    if (this.#skyMat) (this.#skyMat.uniforms.uTime as { value: number }).value = this.#t;
    this.#crowdUniforms.uExcite.value = Math.min(1, this.#danger * 0.45 + this.#roar + this.#buzz * 0.75);
    // The boards scroll, and scroll faster when something has happened.
    if (this.#ledTex) this.#ledTex.offset.x = (this.#ledTex.offset.x + dt * (0.018 + this.#roar * 0.12)) % 1;
  }

  dispose(): void {
    for (const d of this.#disposables) d.dispose();
    this.group.clear();
  }

  // ---- pieces -----------------------------------------------------------------

  #crowdMaterial(width: number, rake: number, seed: number, colors: StadiumColors, shade: number): THREE.MeshStandardMaterial {
    // Each stand gets its own sheet so the people come out the same size on a 119-metre
    // side stand and an 82-metre end. Sharing one un-repeated texture stretches thirty
    // spectators across the whole length of the pitch.
    const rows = Math.max(6, Math.round(rake / ROW_PITCH));
    // Three sheets per tier, shared round the ground: each material takes a clone, and a
    // clone shares its canvas and its GPU upload, so this is three textures a tier rather
    // than sixteen megabyte-sized ones.
    const key = `${rows}|${shade}|${seed % 3}`;
    let sheet = this.#sheets.get(key);
    if (!sheet) {
      sheet = crowdTexture({
        width: 1024,
        height: Math.min(1024, Math.max(256, rows * 36)),
        rows,
        cols: CROWD_COLS,
        seed,
        primary: colors.primary,
        secondary: colors.secondary,
        shade,
      });
      this.#sheets.set(key, sheet);
      this.#disposables.push(sheet);
    }
    const tex = sheet.clone();
    tex.wrapS = THREE.RepeatWrapping;
    // Vertically the sheet covers the whole rake exactly once: it carries a baked roof
    // shade from the back rows down to the front, and a repeat would band it.
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.repeat.set(Math.max(1, Math.round(width / CROWD_TILE)), 1);
    // A stand seen from the far side of the pitch is a few pixels tall, and an unfiltered
    // crowd at that size is television static. Mipmaps and anisotropy are what turn it
    // back into a crowd.
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 8;
    // DoubleSide is load-bearing, not laziness. The seating plane is rotated to lie along
    // the rake, which leaves its normal pointing up and AWAY from the pitch — so with
    // default front-face rendering every stand in the ground is an invisible plane in
    // front of a grey concrete back wall, which is exactly how this first looked.
    const mat = new THREE.MeshStandardMaterial({
      map: tex, roughness: 1, metalness: 0, side: THREE.DoubleSide,
    });
    this.#liveCrowd(mat, tex.repeat.x, rows);
    this.#crowdMats.push(mat);
    this.#disposables.push(tex, mat);
    return mat;
  }

  /**
   * Make a crowd sheet move like a crowd.
   *
   * Sections of it bob — columns of the texture jump in their own rhythm, the way a stand
   * moves in waves rather than as one plank — harder as the play gets dangerous and hardest
   * after a goal. And at night, phones and cameras flash: single spectators lighting up for
   * a frame, which the bloom turns into points of light, and which after a goal is the
   * whole stand at once.
   */
  #liveCrowd(mat: THREE.MeshStandardMaterial, repeat: number, rows: number): void {
    const u = this.#crowdUniforms;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = u.uTime;
      shader.uniforms.uExcite = u.uExcite;
      shader.uniforms.uNight = u.uNight;
      shader.uniforms.uWave = u.uWave;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uTime;
          uniform float uExcite;
          uniform float uNight;
          uniform float uWave;
          float tlCH(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.743); }`)
        .replace('#include <map_fragment>', `
          #ifdef USE_MAP
            vec2 tlUv = vMapUv;
            // Each column of seats bobs to its own rhythm.
            float tlCol = floor(tlUv.x * ${CROWD_COLS.toFixed(1)});
            float tlBob = sin(uTime * (7.0 + tlCH(vec2(tlCol, 1.0)) * 5.0) + tlCol * 0.7);
            tlUv.y += max(tlBob, 0.0) * (0.0015 + uExcite * 0.009) * ${(30 / rows).toFixed(3)};
            // The wave: a band of the stand on its feet, arms up, travelling along it.
            float tlWave = 0.0;
            if (uWave > -0.5) {
              float along = vMapUv.x / ${repeat.toFixed(1)};
              tlWave = smoothstep(0.07, 0.0, abs(along - uWave));
              tlUv.y += tlWave * ${(0.018 * 30 / rows).toFixed(4)};
            }
            vec4 sampledDiffuseColor = texture2D(map, tlUv);
            diffuseColor *= sampledDiffuseColor;
            // Standing people catch more light than seated ones under a roof.
            diffuseColor.rgb *= 1.0 + tlWave * 0.35;
          #endif`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          #ifdef USE_MAP
          {
            vec2 cell = floor(vMapUv * vec2(${(CROWD_COLS * repeat).toFixed(1)}, ${rows.toFixed(1)}));
            float slot = floor(uTime * 9.0);
            float h = tlCH(cell + slot * 0.137);
            float rate = mix(0.9993, 0.985, uExcite) - uNight * 0.0004;
            float flash = step(rate, h) * (0.35 + uNight * 0.65);
            totalEmissiveRadiance += vec3(4.5, 4.6, 5.0) * flash;
          }
          #endif`);
    };
  }

  /** The LED material, shared by the pitch-side boards and the ribbon between the tiers. */
  #makeLed(colors: StadiumColors): THREE.MeshStandardMaterial {
    const tex = this.#ledTexture(colors);
    const led = new THREE.MeshStandardMaterial({
      color: 0x000000, roughness: 0.35, metalness: 0, map: null, side: THREE.DoubleSide,
      emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.95,
    });
    this.#ledTex = tex;
    this.#ledMat = led;
    this.#disposables.push(tex, led);
    return led;
  }

  /** The glass of the hospitality boxes: dark by day, lit rooms glowing at night. */
  #glassMaterial(seed: number): THREE.MeshStandardMaterial {
    const { map, glow } = glazingTextures(seed);
    const mat = new THREE.MeshStandardMaterial({
      map, roughness: 0.18, metalness: 0.55, side: THREE.DoubleSide,
      emissive: 0xffffff, emissiveMap: glow, emissiveIntensity: 0.1,
    });
    this.#glassMats.push(mat);
    this.#disposables.push(map, glow, mat);
    return mat;
  }

  /** The LED strip's picture: the club's colours and name, in panels, drawn once. */
  #ledTexture(colors: StadiumColors): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 2048;
    c.height = 64;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
    const p = hex(colors.primary);
    const q = hex(colors.secondary);
    const name = (colors.name ?? 'Touchline').toUpperCase();
    const panel = 256;
    for (let i = 0; i < 8; i++) {
      const x0 = i * panel;
      switch (i % 4) {
        case 0: {
          g.fillStyle = p;
          g.fillRect(x0, 0, panel, 64);
          g.fillStyle = q;
          g.font = '900 38px "Arial Black", "Arial", sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(name.slice(0, 12), x0 + panel / 2, 34, panel - 20);
          break;
        }
        case 1: {
          g.fillStyle = '#10161d';
          g.fillRect(x0, 0, panel, 64);
          g.fillStyle = q;
          for (let k = -1; k < 9; k++) {
            g.beginPath();
            g.moveTo(x0 + k * 32, 0);
            g.lineTo(x0 + k * 32 + 16, 32);
            g.lineTo(x0 + k * 32, 64);
            g.lineTo(x0 + k * 32 + 12, 64);
            g.lineTo(x0 + k * 32 + 28, 32);
            g.lineTo(x0 + k * 32 + 12, 0);
            g.fill();
          }
          break;
        }
        case 2: {
          const grad = g.createLinearGradient(x0, 0, x0 + panel, 0);
          grad.addColorStop(0, p);
          grad.addColorStop(0.5, q);
          grad.addColorStop(1, p);
          g.fillStyle = grad;
          g.fillRect(x0, 0, panel, 64);
          break;
        }
        default: {
          g.fillStyle = q;
          g.fillRect(x0, 0, panel, 64);
          g.fillStyle = p;
          g.font = 'italic 900 34px "Arial Black", "Arial", sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText('\u2605 \u2605 \u2605', x0 + panel / 2, 34);
          break;
        }
      }
      // The pixel grid of an LED board, faintly: what separates a screen from a painting.
      g.fillStyle = 'rgba(0,0,0,0.18)';
      for (let y = 0; y < 64; y += 4) g.fillRect(x0, y, panel, 1);
      for (let x = 0; x < panel; x += 4) g.fillRect(x0 + x, 0, 1, 64);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    return tex;
  }

  /**
   * A flat raked surface from (z0, y0) to (z1, y1) in a stand's own frame, `width` wide.
   * Low at the front, high at the back — which is which is not obvious from the sign. The
   * other rotation rakes the stand BACKWARDS: twelve metres of seating at the touchline
   * dropping to one at the back, so every stand is a wall from the pitch and the crowd is
   * hidden behind its own front row. That is how this first looked.
   */
  #rake(parent: THREE.Object3D, mat: THREE.Material, width: number, z0: number, y0: number, z1: number, y1: number): void {
    const len = Math.hypot(z1 - z0, y1 - y0);
    const geo = new THREE.PlaneGeometry(width, len);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = Math.PI / 2 - Math.atan2(y1 - y0, z1 - z0);
    mesh.position.set(0, (y0 + y1) / 2, (z0 + z1) / 2);
    parent.add(mesh);
    this.#disposables.push(geo);
  }

  /**
   * A vertical strip from (x0, z0) to (x1, z1), `height` tall from `y`, its texture
   * repeating every `tile` metres along it. The boxes' glass, the LED ribbon, the concourse.
   */
  #strip(parent: THREE.Object3D, mat: THREE.Material, x0: number, z0: number, x1: number, z1: number, y: number, height: number, tile: number): void {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const geo = new THREE.PlaneGeometry(len, height);
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (len / tile));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((x0 + x1) / 2, y + height / 2, (z0 + z1) / 2);
    mesh.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    parent.add(mesh);
    this.#disposables.push(geo);
  }

  /** A box, textured in world metres rather than stretched once across each face. */
  #block(parent: THREE.Object3D, mat: THREE.Material | THREE.Material[], sx: number, sy: number, sz: number, x: number, y: number, z: number, tile = CONCRETE_TILE): THREE.Mesh {
    const geo = boxUvInMetres(new THREE.BoxGeometry(sx, sy, sz), tile);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    this.#disposables.push(geo);
    return mesh;
  }

  #addStand(
    p: StandParts,
    width: number,
    seed: number,
    colors: StadiumColors,
    x: number,
    z: number,
    rotY: number,
  ): void {
    const stand = new THREE.Group();

    // The pitch-side wall, at the front.
    this.#block(stand, p.deck, width, WALL_HEIGHT, 0.5, 0, WALL_HEIGHT / 2, 0.25);

    // The lower tier, the glazed boxes, the parapet with its LED ribbon, the upper tier.
    const lowTop = WALL_HEIGHT + LOWER_RISE;
    const lowRake = Math.hypot(LOWER_DEPTH, LOWER_RISE);
    this.#rake(stand, this.#crowdMaterial(width, lowRake, seed, colors, 0.25), width, 0, WALL_HEIGHT, LOWER_DEPTH, lowTop);
    this.#strip(stand, this.#glassMaterial(seed ^ 0x9e37), width / 2, LOWER_DEPTH, -width / 2, LOWER_DEPTH, lowTop, BOX_GLASS, GLASS_TILE);
    this.#strip(stand, p.led, width / 2, LOWER_DEPTH - 0.02, -width / 2, LOWER_DEPTH - 0.02, lowTop + BOX_GLASS, BOX_PARAPET, LED_TILE);
    const upTop = WALL_HEIGHT + STAND_HEIGHT;
    const upRake = Math.hypot(STAND_DEPTH - LOWER_DEPTH, upTop - UPPER_FRONT);
    this.#rake(stand, this.#crowdMaterial(width, upRake, seed + 101, colors, 1), width, LOWER_DEPTH, UPPER_FRONT, STAND_DEPTH, upTop);

    // A roof over the back, which is what gives a stadium its silhouette. Over the back
    // only: a roof that reaches further forward hides the crowd from any camera above it,
    // and the far stand becomes a plain dark band.
    //
    // [top, bottom, ...] is the BoxGeometry material order after +X and -X: the sheeting
    // on top is dark, the soffit underneath stays light.
    const roofZ = STAND_DEPTH - ROOF_DEPTH / 2 + 1;
    const roofFront = roofZ - ROOF_DEPTH / 2;
    this.#block(stand, [p.soffit, p.soffit, p.sheeting, p.soffit, p.soffit, p.soffit], width, 0.5, ROOF_DEPTH, 0, ROOF_HEIGHT, roofZ, SHEET_TILE);
    this.#roofEdge(stand, p, width / 2, roofFront, -width / 2, roofFront, 0, -1);

    // Standing seams along the roof, so it reads as sheeting rather than as a slab.
    const seamGeo = new THREE.BoxGeometry(0.22, 0.12, ROOF_DEPTH - 0.4);
    const seams = Math.max(4, Math.round(width / 7));
    for (let i = 0; i < seams; i++) {
      const seam = new THREE.Mesh(seamGeo, p.steel);
      seam.position.set(((i + 0.5) / seams - 0.5) * width, ROOF_HEIGHT + 0.3, roofZ);
      stand.add(seam);
    }
    this.#disposables.push(seamGeo);

    // The trusses that hold it up. Pure silhouette, and the cheapest thing in the scene
    // that says "built" rather than "extruded".
    const trussGeo = new THREE.BoxGeometry(0.4, ROOF_HEIGHT - STAND_HEIGHT, 0.4);
    const trussCount = Math.max(3, Math.round(width / 24));
    for (let i = 0; i < trussCount; i++) {
      const truss = new THREE.Mesh(trussGeo, p.steel);
      const u = trussCount === 1 ? 0.5 : i / (trussCount - 1);
      truss.position.set((u - 0.5) * (width - 6), (ROOF_HEIGHT + STAND_HEIGHT) / 2, STAND_DEPTH + 0.6);
      stand.add(truss);
    }
    this.#disposables.push(trussGeo);

    // The back wall, closing the bowl off against the sky, with the concourse glazing
    // along the strip of it that shows between the back row and the roof.
    const backH = ROOF_HEIGHT + 1.2;
    this.#block(stand, p.concrete, width, backH, 0.7, 0, backH / 2, STAND_DEPTH + 1.2);
    this.#strip(stand, this.#glassMaterial(seed ^ 0x51f1), width / 2, STAND_DEPTH + 0.84, -width / 2, STAND_DEPTH + 0.84, upTop + 0.2, ROOF_HEIGHT - upTop - 0.5, GLASS_TILE);

    stand.position.set(x, 0, z);
    stand.rotation.y = rotY;
    this.group.add(stand);
  }

  /**
   * The front edge of a roof, from (x0, z0) to (x1, z1): the fascia, and the lights under
   * it, tilted down toward the pitch, which lies along (`toX`, `toZ`) from the edge.
   */
  #roofEdge(parent: THREE.Object3D, p: StandParts, x0: number, z0: number, x1: number, z1: number, toX: number, toZ: number): void {
    // A plane turned by -atan2(dz, dx) faces (-dz, dx); run the edge the other way if
    // that is away from the pitch.
    if (-(z1 - z0) * toX + (x1 - x0) * toZ < 0) [x0, z0, x1, z1] = [x1, z1, x0, z0];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const fascia = this.#block(parent, p.fascia, len, 1.3, 0.25, 0, 0, 0);
    fascia.position.set((x0 + x1) / 2, ROOF_HEIGHT - 0.1, (z0 + z1) / 2);
    fascia.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    const geo = new THREE.PlaneGeometry(len, 0.7);
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    // One bank of lamps every six metres.
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (len / 6));
    const lamps = new THREE.Mesh(geo, p.ring);
    // Tilted to face down and in, toward the pitch.
    lamps.rotation.order = 'YXZ';
    lamps.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    lamps.rotation.x = 1.0;
    lamps.position.set((x0 + x1) / 2, ROOF_HEIGHT - 0.85, (z0 + z1) / 2);
    const inward = new THREE.Vector3(0, 0, -0.35).applyAxisAngle(new THREE.Vector3(0, 1, 0), fascia.rotation.y);
    lamps.position.add(inward);
    parent.add(lamps);
    this.#disposables.push(geo);
  }

  /**
   * A corner: the quarter of the bowl where two stands meet.
   *
   * The first version was a concrete block with a crowd wedge across its diagonal, and
   * from any camera inside the ground it presented two blank faces where a crowd should
   * be. This one is what a real square corner is: the seating of both neighbouring
   * stands carried on round until the two meet along the diagonal, so every row runs
   * unbroken from one stand into the next. A point `dx`, `dz` into the corner is at the
   * height the stand profile gives for max(dx, dz), which is exactly what makes it
   * continuous with both — the end stand along one edge and the side stand along the other.
   */
  #addCorner(p: StandParts, seed: number, colors: StadiumColors, x: number, z: number): void {
    const g = new THREE.Group();
    const sx = Math.sign(x);
    const sz = Math.sign(z);
    const D = STAND_DEPTH;
    const L = LOWER_DEPTH;
    const lowTop = WALL_HEIGHT + LOWER_RISE;
    const upTop = WALL_HEIGHT + STAND_HEIGHT;

    const lower = this.#crowdMaterial(D, Math.hypot(L, LOWER_RISE), seed, colors, 0.25);
    const upper = this.#crowdMaterial(D, Math.hypot(D - L, upTop - UPPER_FRONT), seed + 101, colors, 1);
    // Each tier is two quads, one either side of the diagonal. `a` is distance out along
    // the profile, `b` distance along the rows, from the diagonal (so the stairway at
    // u = 0 in the crowd sheet runs up the crease, which is where a real one is).
    const tier = (mat: THREE.Material, d0: number, y0: number, d1: number, y1: number): void => {
      const pos: number[] = [];
      const uvs: number[] = [];
      for (const swap of [false, true]) {
        const quad: [number, number][] = [[d0, 0], [d1, 0], [d1, d1], [d0, d0]];
        const pts = quad.map(([a, b]) => {
          const dx = swap ? b : a;
          const dz = swap ? a : b;
          const y = y0 + ((a - d0) / (d1 - d0)) * (y1 - y0);
          return { p: [sx * dx, y, sz * dz], uv: [(a - b) / D, (a - d0) / (d1 - d0)] };
        });
        for (const i of [0, 1, 2, 0, 2, 3]) {
          const v = pts[i] as { p: number[]; uv: number[] };
          pos.push(...v.p);
          uvs.push(...v.uv);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.computeVertexNormals();
      g.add(new THREE.Mesh(geo, mat));
      this.#disposables.push(geo);
    };
    tier(lower, 0, WALL_HEIGHT, L, lowTop);
    tier(upper, L, UPPER_FRONT, D, upTop);

    // The boxes and the ribbon, turning the corner along the same crease.
    const glass = this.#glassMaterial(seed ^ 0x9e37);
    this.#strip(g, glass, sx * L, 0, sx * L, sz * L, lowTop, BOX_GLASS, GLASS_TILE);
    this.#strip(g, glass, 0, sz * L, sx * L, sz * L, lowTop, BOX_GLASS, GLASS_TILE);
    this.#strip(g, p.led, sx * (L - 0.02), 0, sx * (L - 0.02), sz * L, lowTop + BOX_GLASS, BOX_PARAPET, LED_TILE);
    this.#strip(g, p.led, 0, sz * (L - 0.02), sx * L, sz * (L - 0.02), lowTop + BOX_GLASS, BOX_PARAPET, LED_TILE);

    // The back walls, an L round the outside, and the concourse glazing on them.
    const backH = ROOF_HEIGHT + 1.2;
    const outer = D + 1.2;
    const span = outer + 0.35;
    this.#block(g, p.concrete, 0.7, backH, span, sx * outer, backH / 2, sz * span / 2);
    this.#block(g, p.concrete, span, backH, 0.7, sx * span / 2, backH / 2, sz * outer);
    const cg = this.#glassMaterial(seed ^ 0x51f1);
    this.#strip(g, cg, sx * (outer - 0.36), 0, sx * (outer - 0.36), sz * span, upTop + 0.2, ROOF_HEIGHT - upTop - 0.5, GLASS_TILE);
    this.#strip(g, cg, 0, sz * (outer - 0.36), sx * span, sz * (outer - 0.36), upTop + 0.2, ROOF_HEIGHT - upTop - 0.5, GLASS_TILE);

    // The roof, also an L, over the back of both halves, and its front edge.
    const roofFront = D - ROOF_DEPTH + 1;
    const mats = [p.soffit, p.soffit, p.sheeting, p.soffit, p.soffit, p.soffit];
    this.#block(g, mats, ROOF_DEPTH, 0.5, span, sx * (roofFront + ROOF_DEPTH / 2), ROOF_HEIGHT, sz * span / 2, SHEET_TILE);
    this.#block(g, mats, roofFront, 0.5, ROOF_DEPTH, sx * roofFront / 2, ROOF_HEIGHT, sz * (roofFront + ROOF_DEPTH / 2), SHEET_TILE);
    this.#roofEdge(g, p, sx * roofFront, 0, sx * roofFront, sz * roofFront, -sx, -sz);
    this.#roofEdge(g, p, 0, sz * roofFront, sx * roofFront, sz * roofFront, -sx, -sz);

    g.position.set(x, 0, z);
    this.group.add(g);
  }

  /**
   * The ring of advertising boards. They carry no text and never will — this is a
   * child-directed product and a hoarding is the one surface in a stadium whose entire
   * purpose is advertising. They are here for the horizontal band of saturated colour at
   * the pitch edge, which is what stops the grass running straight into the concrete.
   */
  #addHoardings(): void {
    const lengthX = PITCH_LENGTH + HOARDING_INSET * 2;
    const lengthZ = PITCH_WIDTH + HOARDING_INSET * 2;
    const zEdge = PITCH_WIDTH / 2 + HOARDING_INSET;
    const xEdge = PITCH_LENGTH / 2 + HOARDING_INSET;

    // The cabinets: a dark casing, and on its face an LED strip — one continuous screen per
    // side, which is what a modern ground has rather than a row of painted boards. The
    // screen is emissive, so it holds its colour in shadow and glows under lights.
    const cabinet = new THREE.MeshStandardMaterial({ color: 0x1a2027, roughness: 0.5, metalness: 0.3 });
    const led = this.#ledMat as THREE.MeshStandardMaterial;
    this.#disposables.push(cabinet);

    const side = (length: number, x: number, z: number, rotY: number): void => {
      const box = new THREE.BoxGeometry(length, HOARDING_HEIGHT, 0.3);
      const screen = new THREE.PlaneGeometry(length, HOARDING_HEIGHT * 0.84);
      const uv = screen.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (length / LED_TILE));
      this.#disposables.push(box, screen);
      const g = new THREE.Group();
      const body = new THREE.Mesh(box, cabinet);
      body.position.y = HOARDING_HEIGHT / 2;
      const face = new THREE.Mesh(screen, led);
      face.position.set(0, HOARDING_HEIGHT / 2, 0.16);
      g.add(body, face);
      g.position.set(x, 0, z);
      g.rotation.y = rotY;
      this.group.add(g);
    };
    // Each screen's +Z (its face) turned toward the centre spot.
    side(lengthX, 0, zEdge, Math.PI);
    side(lengthX, 0, -zEdge, 0);
    side(lengthZ, xEdge, 0, -Math.PI / 2);
    side(lengthZ, -xEdge, 0, Math.PI / 2);
  }

  /**
   * The two dugouts, either side of halfway on the near touchline, behind the boards: a
   * back wall, a curved clear canopy and a row of padded seats in the home colour. Small,
   * but they are the thing that says "this is a real ground" in every low replay shot.
   */
  #addDugouts(colors: StadiumColors): void {
    const shell = new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.6, metalness: 0.2 });
    const canopy = new THREE.MeshStandardMaterial({
      color: 0xd8e8f4, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.32,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const seatMat = new THREE.MeshStandardMaterial({ color: colors.primary, roughness: 0.55 });
    const length = 8;
    const depth = 2.3;
    const back = -(BOWL_HALF_WIDTH - 0.25);
    const shellGeo = new THREE.BoxGeometry(length, 2.1, 0.12);
    const endGeo = new THREE.BoxGeometry(0.1, 2.1, depth);
    const floorGeo = new THREE.BoxGeometry(length, 0.12, depth);
    // Half a cylinder with its axis along the dugout, open side down.
    const canopyGeo = new THREE.CylinderGeometry(depth / 2, depth / 2, length, 20, 1, true, -Math.PI / 2, Math.PI);
    canopyGeo.rotateZ(Math.PI / 2);
    canopyGeo.scale(1, 0.55, 1);
    const seatGeo = new THREE.BoxGeometry(0.5, 0.9, 0.55);
    this.#disposables.push(shell, canopy, seatMat, shellGeo, endGeo, floorGeo, canopyGeo, seatGeo);
    for (const cx of [-9, 9]) {
      const g = new THREE.Group();
      const wall = new THREE.Mesh(shellGeo, shell);
      wall.position.set(0, 1.05, 0.06);
      const floor = new THREE.Mesh(floorGeo, shell);
      floor.position.set(0, 0.06, depth / 2);
      g.add(wall, floor);
      for (const ex of [-1, 1]) {
        const end = new THREE.Mesh(endGeo, canopy);
        end.position.set(ex * length / 2, 1.05, depth / 2);
        g.add(end);
      }
      const roof = new THREE.Mesh(canopyGeo, canopy);
      roof.position.set(0, 2.1, depth / 2);
      g.add(roof);
      for (let i = 0; i < 12; i++) {
        const seat = new THREE.Mesh(seatGeo, seatMat);
        seat.position.set(-length / 2 + 0.55 + i * ((length - 1.1) / 11), 0.55, 0.4);
        g.add(seat);
      }
      g.position.set(cx, 0, back);
      this.group.add(g);
    }
  }

  /** A corner pylon. Silhouette only — the lighting in the scene is the sun. */
  #addFloodlight(steel: THREE.Material, x: number, z: number): void {
    const g = new THREE.Group();
    const height = 34;
    const mastGeo = new THREE.CylinderGeometry(0.32, 0.55, height, 6);
    const mast = new THREE.Mesh(mastGeo, steel);
    mast.position.y = height / 2;
    g.add(mast);
    this.#disposables.push(mastGeo);

    // The head: a steel frame with a bank of lamps on its face. The lamps are a texture —
    // five rows of eight discs — on the emissive channel, so at night each one blooms into
    // its own point and the bank reads as a bank, not as a glowing slab.
    const headGeo = new THREE.BoxGeometry(7, 3.4, 0.9);
    const head = new THREE.Mesh(headGeo, steel);
    head.position.set(0, height + 1.2, 0);
    head.lookAt(0, 0, 0);
    g.add(head);
    const faceGeo = new THREE.PlaneGeometry(6.6, 3.0);
    const lamps = lampGridTexture();
    const faceMat = new THREE.MeshStandardMaterial({
      color: 0x20242a, roughness: 0.3, metalness: 0.2,
      emissive: 0xfff6e0, emissiveMap: lamps, emissiveIntensity: 0.35,
    });
    this.#lampMats.push(faceMat);
    const face = new THREE.Mesh(faceGeo, faceMat);
    face.position.set(0, 0, 0.46);
    head.add(face);
    this.#disposables.push(headGeo, faceGeo, faceMat, lamps);

    g.position.set(x, 0, z);
    this.group.add(g);
  }
}

/** Five rows of eight lamp discs, for a floodlight head's face. */
function lampGridTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 256, 128);
  for (let r = 0; r < 5; r++) {
    for (let k = 0; k < 8; k++) {
      const x = 16 + k * 32;
      const y = 13 + r * 25.5;
      const grad = g.createRadialGradient(x, y, 0, x, y, 12);
      grad.addColorStop(0, '#fff');
      grad.addColorStop(0.6, '#fff4dc');
      grad.addColorStop(1, 'rgba(255,240,210,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, 12, 0, Math.PI * 2);
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The materials every stand and corner is built from. */
interface StandParts {
  concrete: THREE.Material;
  deck: THREE.Material;
  /** The underside and the top of the roof are different greys. */
  soffit: THREE.Material;
  sheeting: THREE.Material;
  steel: THREE.Material;
  fascia: THREE.Material;
  ring: THREE.Material;
  led: THREE.Material;
}

/**
 * Re-map a BoxGeometry's UVs to world metres, one texture repeat every `tile` metres,
 * projected along each face's own axis. Without it a texture is stretched once across
 * every face, so a 120-metre wall and a 4-metre kerb carry the same number of panels.
 */
function boxUvInMetres(geo: THREE.BoxGeometry, tile: number): THREE.BoxGeometry {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nrm.getX(i));
    const ny = Math.abs(nrm.getY(i));
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (nx > 0.5) uv.setXY(i, z / tile, y / tile);
    else if (ny > 0.5) uv.setXY(i, x / tile, z / tile);
    else uv.setXY(i, x / tile, y / tile);
  }
  return geo;
}
