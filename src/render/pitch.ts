// The pitch: one textured plane and two goals.
//
// The markings are baked into the grass texture rather than drawn as geometry. A line
// painted on grass has no thickness in real life either, and doing it this way means the
// entire playing surface — stripes, lines, centre circle, penalty arcs — is a single
// draw call.
//
// Scene mapping: the simulation's pitch is x∈[0,105], y∈[0,68]; the scene puts the centre
// spot at the origin with X along the length and Z across the width, so
// sceneX = simX - 52.5 and sceneZ = simY - 34. `toScene` is the only place that knows.

import * as THREE from 'three';
import {
  CENTRE_CIRCLE_RADIUS,
  CORNER_ARC_RADIUS,
  GOAL_AREA_DEPTH,
  GOAL_AREA_WIDTH,
  GOAL_HEIGHT,
  GOAL_WIDTH,
  PENALTY_AREA_DEPTH,
  PENALTY_AREA_WIDTH,
  PENALTY_SPOT_DIST,
  PITCH_LENGTH,
  PITCH_WIDTH,
} from '../sim/match/pitch.js';
import { mulberry32 } from '../core/rng.js';

/** Metres of grass beyond the touchlines before the stands start. */
export const SURROUND = 7;

/** Corner flag height. The laws say at least 1.5m, and nobody uses more. */
const FLAG_HEIGHT = 1.5;

export function toSceneX(simX: number): number {
  return simX - PITCH_LENGTH / 2;
}
export function toSceneZ(simY: number): number {
  return simY - PITCH_WIDTH / 2;
}

/**
 * Draw the whole playing surface, markings included, into one canvas.
 *
 * `pixelsPerMetre` is the quality knob: 8 gives a 904×624 texture for the low tier, 20
 * gives 2260×1560 for the high one, and the lines stay crisp at both because they are
 * drawn at the texture's own scale rather than scaled up from a fixed size.
 */
export function pitchTexture(pixelsPerMetre: number): THREE.CanvasTexture {
  const totalW = PITCH_LENGTH + SURROUND * 2;
  const totalH = PITCH_WIDTH + SURROUND * 2;
  const w = Math.round(totalW * pixelsPerMetre);
  const h = Math.round(totalH * pixelsPerMetre);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('2d context unavailable');

  const m = (metres: number): number => metres * pixelsPerMetre;
  /** Pitch coordinates (0..105, 0..68) to canvas pixels. */
  const px = (x: number): number => m(x + SURROUND);
  const py = (y: number): number => m(y + SURROUND);

  // Base grass, including the surround, which is a shade darker so the pitch reads as
  // the lit thing in the middle.
  g.fillStyle = '#2f6b32';
  g.fillRect(0, 0, w, h);

  // The playing surface. No stripes here any more: they are view-dependent, and a baked
  // stripe is the same from every angle, which a mown stripe is not (see grassMaterial).
  // A trace is left in so the low-contrast angles still hint at the cut.
  const stripes = MOW_STRIPES;
  const stripeW = PITCH_LENGTH / stripes;
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 === 0 ? '#3c883c' : '#398439';
    g.fillRect(px(i * stripeW), py(0), m(stripeW) + 1, m(PITCH_WIDTH));
  }

  // Grass noise. Cheap, and the difference between a lawn and a green rectangle.
  const rng = mulberry32(0x51a4b);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * 16;
    d[i] = clampByte((d[i] as number) + n * 0.6);
    d[i + 1] = clampByte((d[i + 1] as number) + n);
    d[i + 2] = clampByte((d[i + 2] as number) + n * 0.6);
  }
  g.putImageData(img, 0, 0);

  // Markings.
  g.strokeStyle = 'rgba(255,255,255,0.92)';
  g.lineWidth = Math.max(1.5, m(0.12));
  g.lineCap = 'butt';

  // Touchlines and goal lines.
  g.strokeRect(px(0), py(0), m(PITCH_LENGTH), m(PITCH_WIDTH));

  // Halfway line and centre circle.
  line(g, px(PITCH_LENGTH / 2), py(0), px(PITCH_LENGTH / 2), py(PITCH_WIDTH));
  circle(g, px(PITCH_LENGTH / 2), py(PITCH_WIDTH / 2), m(CENTRE_CIRCLE_RADIUS));
  dot(g, px(PITCH_LENGTH / 2), py(PITCH_WIDTH / 2), m(0.16));

  for (const end of [0, 1]) {
    const goalX = end === 0 ? 0 : PITCH_LENGTH;
    const sign = end === 0 ? 1 : -1;

    // Penalty area, goal area, penalty spot.
    g.strokeRect(
      px(end === 0 ? 0 : PITCH_LENGTH - PENALTY_AREA_DEPTH),
      py((PITCH_WIDTH - PENALTY_AREA_WIDTH) / 2),
      m(PENALTY_AREA_DEPTH),
      m(PENALTY_AREA_WIDTH),
    );
    g.strokeRect(
      px(end === 0 ? 0 : PITCH_LENGTH - GOAL_AREA_DEPTH),
      py((PITCH_WIDTH - GOAL_AREA_WIDTH) / 2),
      m(GOAL_AREA_DEPTH),
      m(GOAL_AREA_WIDTH),
    );
    const spotX = goalX + sign * PENALTY_SPOT_DIST;
    dot(g, px(spotX), py(PITCH_WIDTH / 2), m(0.16));

    // The D: the arc of the centre circle radius around the penalty spot that falls
    // OUTSIDE the penalty area. Drawn by clipping to the region beyond the area line.
    g.save();
    g.beginPath();
    const edge = goalX + sign * PENALTY_AREA_DEPTH;
    if (end === 0) g.rect(px(edge), 0, w, h);
    else g.rect(0, 0, px(edge), h);
    g.clip();
    circle(g, px(spotX), py(PITCH_WIDTH / 2), m(CENTRE_CIRCLE_RADIUS));
    g.restore();

    // Corner arcs.
    for (const cornerY of [0, PITCH_WIDTH]) {
      g.beginPath();
      const start = end === 0 ? (cornerY === 0 ? 0 : -Math.PI / 2) : cornerY === 0 ? Math.PI / 2 : Math.PI;
      g.arc(px(goalX), py(cornerY), m(CORNER_ARC_RADIUS), start, start + Math.PI / 2);
      g.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
function line(g: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
}
function circle(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.stroke();
}
function dot(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.fill();
}

/** Net mesh: a grid drawn on transparent, so a goal has something in it to bulge. */
function netTexture(): THREE.CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  if (!g) throw new Error('2d context unavailable');
  g.clearRect(0, 0, size, size);
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 1.4;
  const cells = 10;
  for (let i = 0; i <= cells; i++) {
    const p = (i / cells) * size;
    line(g, p, 0, p, size);
    line(g, 0, p, size, p);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** The playing surface plus both goals, as one group. */
/** How many mown stripes cross the pitch. The texture and the shader must agree. */
const MOW_STRIPES = 16;

/**
 * The grass material: the baked texture, plus three things only a shader can do.
 *
 * MOW STRIPES THAT DEPEND ON WHERE YOU STAND. A groundsman's roller bends the blades one way
 * down one stripe and the other way down the next; a blade bent toward you shows its broad
 * lit face and reads light, one bent away shows its tip and reads dark. So the stripes swap
 * when the camera crosses to the other side, fade to nothing seen along the cut, and are
 * strongest from the main camera — which looks straight down the cut, and is why a pitch on
 * television is always so boldly striped. Every stripe baked into a texture is the same
 * from everywhere, which is the tell.
 *
 * CLUMPING IN WORLD SPACE. The baked texture is a few texels a metre; a replay camera two
 * metres from a boot magnifies that into a smear. Two octaves of noise in world
 * coordinates put tufts under it at every distance.
 *
 * WEAR. The goalmouths and the centre spot are where a pitch is played on, and they are
 * paler and browner — a cue that this is a pitch that gets used.
 */
function grassMaterial(tex: THREE.Texture): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vTlWorld;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vTlWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vTlWorld;
        float tlH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float tlN(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(tlH(i), tlH(i + vec2(1.0, 0.0)), u.x), mix(tlH(i + vec2(0.0, 1.0)), tlH(i + vec2(1.0, 1.0)), u.x), u.y);
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec2 w = vTlWorld.xz;
          float halfL = ${(PITCH_LENGTH / 2).toFixed(2)};
          float halfW = ${(PITCH_WIDTH / 2).toFixed(2)};
          float onPitch = step(abs(w.x), halfL) * step(abs(w.y), halfW);
          // Which way this stripe's blades lie: +Z or -Z, alternating across the length.
          float stripe = floor((w.x + halfL) / ${(PITCH_LENGTH / MOW_STRIPES).toFixed(4)});
          float dir = mod(stripe, 2.0) < 0.5 ? 1.0 : -1.0;
          vec3 toEye = normalize(cameraPosition - vTlWorld);
          // Toward the viewer = lit face = lighter. The horizontal part of the view only.
          float lean = dot(normalize(toEye.xz + vec2(1e-4)), vec2(0.0, dir)) * (1.0 - toEye.y * 0.45);
          diffuseColor.rgb *= 1.0 + lean * 0.12 * onPitch;
          // Clumps and tufts, at two scales.
          float n = tlN(w * 1.7) * 0.6 + tlN(w * 9.0) * 0.4;
          diffuseColor.rgb *= 0.9 + n * 0.2;
          // Wear: goalmouths, and a little round the centre spot.
          vec2 gm = vec2(halfL - abs(w.x), w.y);
          float mouth = (1.0 - smoothstep(2.0, 9.0, gm.x)) * (1.0 - smoothstep(4.0, 10.0, abs(gm.y)));
          float spot = 1.0 - smoothstep(0.5, 4.0, length(w));
          float wear = clamp((mouth * 0.75 + spot * 0.35) * (0.55 + tlN(w * 2.3) * 0.9), 0.0, 1.0) * onPitch;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.18, 1.02, 0.72), wear * 0.5);
        }`);
  };
  return mat;
}

export class PitchScene {
  readonly group = new THREE.Group();
  readonly #disposables: { dispose(): void }[] = [];
  readonly #ground: THREE.Mesh;

  constructor(pixelsPerMetre: number) {
    this.group.name = 'pitch';

    const tex = pitchTexture(pixelsPerMetre);
    const geo = new THREE.PlaneGeometry(PITCH_LENGTH + SURROUND * 2, PITCH_WIDTH + SURROUND * 2);
    geo.rotateX(-Math.PI / 2);
    const mat = grassMaterial(tex);
    const ground = new THREE.Mesh(geo, mat);
    ground.name = 'grass';
    ground.receiveShadow = true;
    this.#ground = ground;
    this.group.add(ground);
    this.#disposables.push(tex, geo, mat);

    const net = netTexture();
    net.repeat.set(6, 3);
    const netMat = new THREE.MeshStandardMaterial({
      map: net, transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 1,
    });
    const postMat = new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.6 });
    this.#disposables.push(net, netMat, postMat);

    for (const end of [0, 1]) {
      const goal = buildGoal(postMat, netMat, this.#disposables);
      goal.position.x = toSceneX(end === 0 ? 0 : PITCH_LENGTH);
      goal.rotation.y = end === 0 ? 0 : Math.PI;
      this.group.add(goal);
    }

    this.#addCornerFlags();
  }

  /**
   * The four corner flags.
   *
   * Small, and worth the eight draw calls: they are the only vertical objects between the
   * goals and the hoardings, so they are what gives the corners of the pitch a scale. The
   * texture already draws the arcs they stand in.
   */
  #addCornerFlags(): void {
    const poleGeo = new THREE.CylinderGeometry(0.022, 0.026, FLAG_HEIGHT, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.7 });
    const clothGeo = new THREE.PlaneGeometry(0.36, 0.26);
    const clothMat = new THREE.MeshStandardMaterial({
      color: 0xffd23f, roughness: 0.85, side: THREE.DoubleSide,
    });
    this.#disposables.push(poleGeo, poleMat, clothGeo, clothMat);

    for (const ex of [0, PITCH_LENGTH]) {
      for (const ey of [0, PITCH_WIDTH]) {
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.set(toSceneX(ex), FLAG_HEIGHT / 2, toSceneZ(ey));
        pole.castShadow = true;
        this.group.add(pole);

        const cloth = new THREE.Mesh(clothGeo, clothMat);
        // Hung off the pole and turned to face into the ground, so all four read as flags
        // from the broadcast side rather than as four edge-on slivers.
        const inX = ex === 0 ? 1 : -1;
        cloth.position.set(
          toSceneX(ex) + inX * 0.17,
          FLAG_HEIGHT - 0.17,
          toSceneZ(ey),
        );
        cloth.rotation.y = ey === 0 ? 0.35 : -0.35;
        this.group.add(cloth);
      }
    }
  }

  /**
   * How wet the grass looks.
   *
   * Roughness, not colour. A wet pitch is not a darker green rectangle — it is the same
   * green with a sheen on it, and the sheen is what a viewer reads as rain having fallen.
   * A little darkening on top, because saturated grass genuinely is darker.
   */
  setWet(wetness: number): void {
    const w = wetness < 0 ? 0 : wetness > 1 ? 1 : wetness;
    const mat = this.#ground.material as THREE.MeshStandardMaterial;
    mat.roughness = 0.95 - w * 0.45;
    mat.metalness = w * 0.12;
    const shade = 1 - w * 0.18;
    mat.color.setRGB(shade, shade, shade);
    mat.needsUpdate = true;
  }

  /** The grass is the only thing in the scene that takes a cast shadow. */
  setReceiveShadow(on: boolean): void {
    this.#ground.receiveShadow = on;
    (this.#ground.material as THREE.Material).needsUpdate = true;
  }

  dispose(): void {
    for (const d of this.#disposables) d.dispose();
    this.group.clear();
  }
}

/**
 * One goal, facing +X (i.e. the net is behind it at -X).
 *
 * Every geometry it makes goes into `owned` so the scene can free them. An earlier
 * version allocated eight of these inline and dropped the references: a quality-tier
 * change rebuilds the PitchScene, so switching graphics twice leaked sixteen buffers to
 * the GPU with nothing holding a handle to them.
 */
function buildGoal(
  postMat: THREE.Material,
  netMat: THREE.Material,
  owned: { dispose(): void }[],
): THREE.Group {
  const g = new THREE.Group();
  g.name = 'goal';
  const r = 0.06;
  const half = GOAL_WIDTH / 2;
  const depth = 1.9;
  const keep = <T extends { dispose(): void }>(x: T): T => {
    owned.push(x);
    return x;
  };

  const postGeo = keep(new THREE.CylinderGeometry(r, r, GOAL_HEIGHT, 10));
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(0, GOAL_HEIGHT / 2, side * half);
    post.castShadow = true;
    g.add(post);
  }
  const barGeo = keep(new THREE.CylinderGeometry(r, r, GOAL_WIDTH, 10));
  barGeo.rotateX(Math.PI / 2);
  const bar = new THREE.Mesh(barGeo, postMat);
  bar.position.set(0, GOAL_HEIGHT, 0);
  bar.castShadow = true;
  g.add(bar);

  // Net: back panel, two sides, and a roof. The back leans away from the goal line the
  // way a real net is pegged out, which is what makes a goal read as a volume rather
  // than a flat card standing behind two posts.
  const back = new THREE.Mesh(keep(new THREE.PlaneGeometry(GOAL_WIDTH, GOAL_HEIGHT * 1.12)), netMat);
  back.rotation.y = Math.PI / 2;
  back.rotation.x = -0.16;
  back.position.set(-depth, GOAL_HEIGHT * 0.5, 0);
  g.add(back);

  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(keep(new THREE.PlaneGeometry(depth, GOAL_HEIGHT)), netMat);
    panel.position.set(-depth / 2, GOAL_HEIGHT / 2, side * half);
    g.add(panel);
  }
  const roof = new THREE.Mesh(keep(new THREE.PlaneGeometry(depth, GOAL_WIDTH)), netMat);
  roof.rotation.x = -Math.PI / 2;
  roof.rotation.z = Math.PI / 2;
  roof.position.set(-depth / 2, GOAL_HEIGHT, 0);
  g.add(roof);

  // The stanchions the net hangs from at the back, which are most of a goal's silhouette
  // from behind it.
  const stanchionGeo = keep(new THREE.CylinderGeometry(0.045, 0.045, GOAL_HEIGHT * 0.62, 8));
  for (const side of [-1, 1]) {
    const s2 = new THREE.Mesh(stanchionGeo, postMat);
    s2.position.set(-depth, GOAL_HEIGHT * 0.31, side * half);
    g.add(s2);
  }

  return g;
}
