// The ball, the shadow under it, and its trail.
//
// The shadow matters more than it looks: without it a lofted ball has no readable height
// at all, and a cross becomes a white dot drifting across the screen at an unknowable
// altitude. It is a blob sprite on the grass, scaled and faded by how high the ball is.
//
// The trail (ballTrail.ts) is design §7a's "a struck shot leaves a short motion smear" —
// the only cue that separates a shot from a pass at broadcast distance — and, for the
// fantasy balls, the whole of what the studio promised when it sold one.

import * as THREE from 'three';
import { ballTexture, blobTexture } from './textures.js';
import { ballStyle, type ClubColours } from './ballStyle.js';
import { BallTrail, trailFor } from './ballTrail.js';
import { toSceneX, toSceneZ } from './pitch.js';

export const BALL_RADIUS = 0.11;

export class BallView {
  readonly group = new THREE.Group();
  readonly #mesh: THREE.Mesh;
  readonly #mat: THREE.MeshStandardMaterial;
  #tex: THREE.CanvasTexture;
  readonly #shadow: THREE.Mesh;
  /** A pool of the ball's own light on the grass, for the balls that glow. */
  readonly #pool: THREE.Mesh;
  readonly #poolMat: THREE.MeshBasicMaterial;
  #poolStrength = 0;
  readonly #trail = new BallTrail();
  readonly #disposables: { dispose(): void }[] = [];
  readonly #spin = new THREE.Quaternion();
  readonly #axis = new THREE.Vector3();
  /** Where the ball was drawn this frame, and how fast it was going, for the trail. */
  #x = 0;
  #y = BALL_RADIUS;
  #z = 0;
  #speed = 0;

  constructor() {
    this.group.name = 'ball';
    const tex = ballTexture();
    this.#tex = tex;
    const geo = new THREE.SphereGeometry(BALL_RADIUS, 32, 24);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0 });
    this.#mat = mat;
    this.#mesh = new THREE.Mesh(geo, mat);
    this.#mesh.castShadow = true;
    this.group.add(this.#mesh);

    const blob = blobTexture(64);
    const shadowGeo = new THREE.PlaneGeometry(1, 1);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: blob, transparent: true, opacity: 0.34, color: 0x000000, depthWrite: false,
    });
    this.#shadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.#shadow.renderOrder = 1;
    this.group.add(this.#shadow);

    this.#poolMat = new THREE.MeshBasicMaterial({
      map: blob, transparent: true, opacity: 0, color: 0xffffff, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.#pool = new THREE.Mesh(shadowGeo, this.#poolMat);
    this.#pool.renderOrder = 1;
    this.#pool.visible = false;
    this.group.add(this.#pool);
    this.group.add(this.#trail.group);

    this.#disposables.push(geo, mat, blob, shadowGeo, shadowMat, this.#poolMat, this.#trail);
  }

  /**
   * Dress the ball in one of the club studio's designs. Once per match: the texture is
   * painted on the CPU (see ballStyle.ts), which is a few milliseconds, never per frame.
   * A glowing design lights itself with its own texture, and gets its trail.
   */
  setStyle(style: number, colours: ClubColours): void {
    const next = ballTexture(style, colours);
    const s = ballStyle(style);
    this.#mat.map = next;
    this.#mat.roughness = s.rough ?? 0.45;
    this.#mat.metalness = s.metal ?? 0;
    this.#mat.emissiveMap = s.glow ? next : null;
    this.#mat.emissive.setHex(s.glow ? 0xffffff : 0x000000);
    this.#mat.emissiveIntensity = (s.glow ?? 0) * 2.2;
    this.#mat.needsUpdate = true;
    this.#tex.dispose();
    this.#tex = next;
    this.#trail.setStyle(style);
    const fx = trailFor(style);
    this.#poolStrength = fx.additive ? fx.haloStrength * 0.55 : 0;
    this.#poolMat.color.setHex(fx.halo);
    this.#pool.visible = this.#poolStrength > 0;
  }

  setCastShadow(on: boolean): void {
    this.#mesh.castShadow = on;
  }

  /** Place the ball from simulation coordinates. `dt` drives the roll. */
  update(simX: number, simY: number, simZ: number, vx: number, vy: number, dt: number, vz = 0): void {
    const x = toSceneX(simX);
    const z = toSceneZ(simY);
    this.#mesh.position.set(x, simZ + BALL_RADIUS, z);
    this.#x = x;
    this.#y = simZ + BALL_RADIUS;
    this.#z = z;
    this.#speed = Math.hypot(vx, vy, vz);

    // Roll about the axis perpendicular to travel, at the rate a ball of this radius
    // would actually turn. Free, and it is what stops the ball looking like it is sliding.
    const speed = Math.hypot(vx, vy);
    if (speed > 0.05 && dt > 0) {
      this.#axis.set(vy, 0, -vx).normalize();
      this.#spin.setFromAxisAngle(this.#axis, (speed / BALL_RADIUS) * dt);
      this.#mesh.quaternion.premultiply(this.#spin);
    }

    // The shadow grows and fades with height — the only cue for how high a cross is.
    const h = Math.max(0, simZ);
    const scale = 0.42 + h * 0.12;
    this.#shadow.position.set(x, 0.012, z);
    this.#shadow.scale.set(scale, 1, scale);
    (this.#shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.05, 0.34 - h * 0.028);

    if (this.#pool.visible) {
      // The light a glowing ball throws on the grass: wide and faint when it is high.
      const ps = 1.6 + h * 0.5;
      this.#pool.position.set(x, 0.014, z);
      this.#pool.scale.set(ps, 1, ps);
      this.#poolMat.opacity = this.#poolStrength / (1 + h * 0.6);
    }
  }

  /**
   * Advance the trail. Separate from `update` because the ribbon faces the camera, and the
   * camera is placed after the ball — so this runs last, with this frame's camera.
   */
  updateTrail(dt: number, camera: THREE.PerspectiveCamera, viewportHeight: number): void {
    this.#trail.setViewport(viewportHeight, camera.fov);
    this.#trail.update(this.#x, this.#y, this.#z, this.#speed, dt, camera, 1);
  }

  dispose(): void {
    this.#tex.dispose();
    for (const d of this.#disposables) d.dispose();
    this.group.clear();
  }
}
