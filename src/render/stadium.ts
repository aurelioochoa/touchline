// The ground around the pitch: a closed bowl, a crowd, hoardings, floodlights and a sky.
//
// The crowd is a texture, not people. Twenty thousand modelled spectators would cost more
// than the football does, and at broadcast distance a sheet of coloured smudges that
// shimmers slightly is indistinguishable from the real thing — which is the whole argument
// for procedural art at this budget (VALUES.md).

import * as THREE from 'three';
import { PITCH_LENGTH, PITCH_WIDTH } from '../sim/match/pitch.js';
import { crowdTexture } from './textures.js';
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

    const concrete = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.94 });
    const deck = new THREE.MeshStandardMaterial({ color: 0x6f7883, roughness: 0.95 });
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
    const roofTopMat = new THREE.MeshStandardMaterial({ color: roofTop, roughness: 0.62, metalness: 0.12 });
    this.#disposables.push(roofTopMat);
    const steel = new THREE.MeshStandardMaterial({ color: 0xb9c1c9, roughness: 0.5, metalness: 0.3 });
    this.#disposables.push(concrete, deck, roofMat, steel);

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
    const roofs: [THREE.Material, THREE.Material] = [roofMat, roofTopMat];
    this.#addStand(concrete, deck, roofs, steel, sideWidth, seed + 1, colors, 0, halfW, 0);
    this.#addStand(concrete, deck, roofs, steel, sideWidth, seed + 2, colors, 0, -halfW, Math.PI);
    this.#addStand(concrete, deck, roofs, steel, endWidth, seed + 3, colors, halfL, 0, Math.PI / 2);
    this.#addStand(concrete, deck, roofs, steel, endWidth, seed + 4, colors, -halfL, 0, -Math.PI / 2);

    // The corners. Four rectangular stands leave four diagonal holes with sky behind them,
    // and a hole in a stadium reads as a mistake from every camera angle that catches one.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this.#addCorner(concrete, deck, roofTopMat, seed + 10 + sx + sz * 2, colors, sx * halfL, sz * halfW);
      }
    }

    this.#addHoardings(colors);
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
      },
      vertexShader: `
        varying float vH;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vH = normalize(world.xyz).y;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying float vH;
        void main() {
          float h = clamp(vH * 1.25 + 0.18, 0.0, 1.0);
          vec3 c = h < 0.5 ? mix(bottom, mid, h * 2.0) : mix(mid, top, (h - 0.5) * 2.0);
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
    this.#crowdUniforms.uExcite.value = Math.min(1, this.#danger * 0.45 + this.#roar + this.#buzz * 0.75);
    // The boards scroll, and scroll faster when something has happened.
    if (this.#ledTex) this.#ledTex.offset.x = (this.#ledTex.offset.x + dt * (0.018 + this.#roar * 0.12)) % 1;
  }

  dispose(): void {
    for (const d of this.#disposables) d.dispose();
    this.group.clear();
  }

  // ---- pieces -----------------------------------------------------------------

  #crowdMaterial(width: number, rake: number, seed: number, colors: StadiumColors): THREE.MeshStandardMaterial {
    // Each stand gets its own sheet so the people come out the same size on a 119-metre
    // side stand and an 82-metre end. Sharing one un-repeated texture stretches thirty
    // spectators across the whole length of the pitch.
    const tex = crowdTexture(512, seed, colors.primary, colors.secondary);
    tex.wrapS = THREE.RepeatWrapping;
    // Vertically the sheet covers the whole rake exactly once: it carries a baked roof
    // shade from the back rows down to the front, and a repeat would band it.
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.repeat.set(Math.max(1, Math.round(width / 26)), 1);
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
    this.#liveCrowd(mat, tex.repeat.x);
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
  #liveCrowd(mat: THREE.MeshStandardMaterial, repeat: number): void {
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
            // A column of people is about a 64th of one tile of the sheet.
            float tlCol = floor(tlUv.x * 64.0);
            float tlBob = sin(uTime * (7.0 + tlCH(vec2(tlCol, 1.0)) * 5.0) + tlCol * 0.7);
            tlUv.y += max(tlBob, 0.0) * (0.0015 + uExcite * 0.009);
            // The wave: a band of the stand on its feet, arms up, travelling along it.
            float tlWave = 0.0;
            if (uWave > -0.5) {
              float along = vMapUv.x / ${repeat.toFixed(1)};
              tlWave = smoothstep(0.07, 0.0, abs(along - uWave));
              tlUv.y += tlWave * 0.018;
            }
            vec4 sampledDiffuseColor = texture2D(map, tlUv);
            diffuseColor *= sampledDiffuseColor;
            // Standing people catch more light than seated ones under a roof.
            diffuseColor.rgb *= 1.0 + tlWave * 0.35;
          #endif`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          #ifdef USE_MAP
          {
            vec2 cell = floor(vMapUv * vec2(${(64 * repeat).toFixed(1)}, 40.0));
            float slot = floor(uTime * 9.0);
            float h = tlCH(cell + slot * 0.137);
            float rate = mix(0.9993, 0.985, uExcite) - uNight * 0.0004;
            float flash = step(rate, h) * (0.35 + uNight * 0.65);
            totalEmissiveRadiance += vec3(4.5, 4.6, 5.0) * flash;
          }
          #endif`);
    };
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

  #addStand(
    concrete: THREE.Material,
    deck: THREE.Material,
    /** [soffit, sheeting] — the underside and the top of the roof are different greys. */
    roofs: [THREE.Material, THREE.Material],
    steel: THREE.Material,
    width: number,
    seed: number,
    colors: StadiumColors,
    x: number,
    z: number,
    rotY: number,
  ): void {
    const stand = new THREE.Group();

    // The pitch-side wall, at the front.
    const wallGeo = new THREE.BoxGeometry(width, WALL_HEIGHT, 0.5);
    const wall = new THREE.Mesh(wallGeo, deck);
    wall.position.set(0, WALL_HEIGHT / 2, 0.25);
    stand.add(wall);
    this.#disposables.push(wallGeo);

    // The seating: a raked plane going up and back.
    const rake = Math.hypot(STAND_DEPTH, STAND_HEIGHT);
    const seatGeo = new THREE.PlaneGeometry(width, rake);
    const seats = new THREE.Mesh(seatGeo, this.#crowdMaterial(width, rake, seed, colors));
    // Low at the front, high at the back — which is which is not obvious from the sign.
    // The other rotation rakes the stand BACKWARDS: twelve metres of seating at the
    // touchline dropping to one at the back, so every stand is a wall from the pitch and
    // the crowd is hidden behind its own front row. That is how this first looked.
    seats.rotation.x = Math.PI / 2 - Math.atan2(STAND_HEIGHT, STAND_DEPTH);
    seats.position.set(0, WALL_HEIGHT + STAND_HEIGHT / 2, STAND_DEPTH / 2);
    stand.add(seats);
    this.#disposables.push(seatGeo);

    // A roof over the back, which is what gives a stadium its silhouette. Over the back
    // only: a roof that reaches further forward hides the crowd from any camera above it,
    // and the far stand becomes a plain dark band.
    const roofGeo = new THREE.BoxGeometry(width, 0.5, ROOF_DEPTH);
    // [top, bottom, ...] is the BoxGeometry material order after +X and -X: the sheeting
    // on top is dark, the soffit underneath stays light.
    const [soffit, sheeting] = roofs;
    const roof = new THREE.Mesh(roofGeo, [soffit, soffit, sheeting, soffit, soffit, soffit]);
    roof.position.set(0, ROOF_HEIGHT, STAND_DEPTH - ROOF_DEPTH / 2 + 1);
    stand.add(roof);
    this.#disposables.push(roofGeo);

    // Standing seams along the roof, so it reads as sheeting rather than as a slab. Six
    // draw calls for the whole ground and they are what stops the near roof being the
    // flattest object on screen.
    const seamGeo = new THREE.BoxGeometry(0.22, 0.12, ROOF_DEPTH - 0.4);
    const seams = Math.max(4, Math.round(width / 7));
    for (let i = 0; i < seams; i++) {
      const seam = new THREE.Mesh(seamGeo, steel);
      seam.position.set(
        ((i + 0.5) / seams - 0.5) * width,
        ROOF_HEIGHT + 0.3,
        STAND_DEPTH - ROOF_DEPTH / 2 + 1,
      );
      stand.add(seam);
    }
    this.#disposables.push(seamGeo);

    // The trusses that hold it up. Pure silhouette, and the cheapest thing in the scene
    // that says "built" rather than "extruded".
    const trussGeo = new THREE.BoxGeometry(0.4, ROOF_HEIGHT - STAND_HEIGHT, 0.4);
    const trussCount = Math.max(3, Math.round(width / 24));
    for (let i = 0; i < trussCount; i++) {
      const truss = new THREE.Mesh(trussGeo, steel);
      const u = trussCount === 1 ? 0.5 : i / (trussCount - 1);
      truss.position.set((u - 0.5) * (width - 6), (ROOF_HEIGHT + STAND_HEIGHT) / 2, STAND_DEPTH + 0.6);
      stand.add(truss);
    }
    this.#disposables.push(trussGeo);

    // The back wall, closing the bowl off against the sky.
    const backH = ROOF_HEIGHT + 1.2;
    const backGeo = new THREE.BoxGeometry(width, backH, 0.7);
    const back = new THREE.Mesh(backGeo, concrete);
    back.position.set(0, backH / 2, STAND_DEPTH + 1.2);
    stand.add(back);
    this.#disposables.push(backGeo);

    stand.position.set(x, 0, z);
    stand.rotation.y = rotY;
    this.group.add(stand);
  }

  /**
   * A corner infill: the block that closes the diagonal gap where two stands meet.
   *
   * The block on its own was a mistake worth recording. From any camera inside the ground
   * it presents two blank concrete faces where a crowd should be, and because it is the
   * tallest thing between two stands it draws the eye straight to the one part of the
   * stadium with nobody in it. So the diagonal gets a raked crowd wedge across it, which
   * is what a real corner section looks like and costs one more plane.
   */
  #addCorner(
    concrete: THREE.Material,
    deck: THREE.Material,
    roofMat: THREE.Material,
    seed: number,
    colors: StadiumColors,
    x: number,
    z: number,
  ): void {
    const g = new THREE.Group();
    const size = STAND_DEPTH + 1.9;
    const sx = Math.sign(x);
    const sz = Math.sign(z);

    const boxGeo = new THREE.BoxGeometry(size, ROOF_HEIGHT + 1.2, size);
    const box = new THREE.Mesh(boxGeo, concrete);
    box.position.set(sx * size / 2, (ROOF_HEIGHT + 1.2) / 2, sz * size / 2);
    g.add(box);
    this.#disposables.push(boxGeo);

    // A cap, so the corner does not read as a bare cube against the sky.
    const capGeo = new THREE.BoxGeometry(size + 1.4, 0.5, size + 1.4);
    const cap = new THREE.Mesh(capGeo, roofMat);
    cap.position.set(sx * size / 2, ROOF_HEIGHT + 1.2, sz * size / 2);
    g.add(cap);
    this.#disposables.push(capGeo);

    // A low kerb tying it into the two stand fronts.
    const kerbGeo = new THREE.BoxGeometry(size, WALL_HEIGHT, size);
    const kerb = new THREE.Mesh(kerbGeo, deck);
    kerb.position.set(sx * size / 2, WALL_HEIGHT / 2, sz * size / 2);
    g.add(kerb);
    this.#disposables.push(kerbGeo);

    // The crowd across the diagonal. Its width is the hypotenuse of the corner and it is
    // raked at the same angle as the stands, so it lines up with both of its neighbours.
    const rake = Math.hypot(STAND_DEPTH, STAND_HEIGHT);
    const width = Math.SQRT2 * size * 0.94;
    const seatGeo = new THREE.PlaneGeometry(width, rake);
    const seats = new THREE.Mesh(seatGeo, this.#crowdMaterial(width, rake, seed, colors));
    seats.rotation.order = 'YXZ';
    // Facing the centre spot: 45 degrees round from the stand it sits between.
    seats.rotation.y = Math.atan2(sx, sz);
    seats.rotation.x = Math.PI / 2 - Math.atan2(STAND_HEIGHT, STAND_DEPTH);
    const mid = STAND_DEPTH / 2 / Math.SQRT2;
    seats.position.set(sx * mid, WALL_HEIGHT + STAND_HEIGHT / 2, sz * mid);
    g.add(seats);
    this.#disposables.push(seatGeo);

    g.position.set(x, 0, z);
    this.group.add(g);
  }

  /**
   * The ring of advertising boards. They carry no text and never will — this is a
   * child-directed product and a hoarding is the one surface in a stadium whose entire
   * purpose is advertising. They are here for the horizontal band of saturated colour at
   * the pitch edge, which is what stops the grass running straight into the concrete.
   */
  #addHoardings(colors: StadiumColors): void {
    const lengthX = PITCH_LENGTH + HOARDING_INSET * 2;
    const lengthZ = PITCH_WIDTH + HOARDING_INSET * 2;
    const zEdge = PITCH_WIDTH / 2 + HOARDING_INSET;
    const xEdge = PITCH_LENGTH / 2 + HOARDING_INSET;

    // The cabinets: a dark casing, and on its face an LED strip — one continuous screen per
    // side, which is what a modern ground has rather than a row of painted boards. The
    // screen is emissive, so it holds its colour in shadow and glows under lights.
    const cabinet = new THREE.MeshStandardMaterial({ color: 0x1a2027, roughness: 0.5, metalness: 0.3 });
    const tex = this.#ledTexture(colors);
    const led = new THREE.MeshStandardMaterial({
      color: 0x000000, roughness: 0.35, metalness: 0, map: null,
      emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.95,
    });
    this.#ledTex = tex;
    this.#ledMat = led;
    this.#disposables.push(cabinet, tex, led);
    /** Metres of board per repeat of the 2048px texture: 8 panels of 6m. */
    const metresPerTile = 48;

    const side = (length: number, x: number, z: number, rotY: number): void => {
      const box = new THREE.BoxGeometry(length, HOARDING_HEIGHT, 0.3);
      const screen = new THREE.PlaneGeometry(length, HOARDING_HEIGHT * 0.84);
      const uv = screen.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (length / metresPerTile));
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
