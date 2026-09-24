// Procedural-model kit: primitive composites merged into few draw calls, with paint baked
// as vertex colors so one material serves a whole model (design §9 — every model is a
// Three.js primitive composite, and the game ships zero asset files).
//
// Taken from games/starhaven/src/render/kit.ts unchanged. It is the house modelling
// toolchain and there is no reason for a second dialect of it.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** A colored primitive placed in the model's local frame. */
export interface Part {
  geo: THREE.BufferGeometry;
  color: number;
  pos?: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number];
}

/**
 * Merges parts into one geometry with vertex colors baked. All part geometries
 * are consumed (disposed after merge) — build fresh primitives per call.
 */
export function mergeParts(parts: Part[]): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const col = new THREE.Color();
  for (const part of parts) {
    const geo = part.geo;
    e.set(part.rot?.[0] ?? 0, part.rot?.[1] ?? 0, part.rot?.[2] ?? 0);
    q.setFromEuler(e);
    p.set(part.pos?.[0] ?? 0, part.pos?.[1] ?? 0, part.pos?.[2] ?? 0);
    s.set(part.scale?.[0] ?? 1, part.scale?.[1] ?? 1, part.scale?.[2] ?? 1);
    m.compose(p, q, s);
    geo.applyMatrix4(m);
    col.setHex(part.color);
    bakeVertexColor(geo, col);
    // Merge needs consistent attributes across parts.
    stripExtras(geo);
    geos.push(geo);
  }
  const merged = mergeGeometries(geos, false);
  if (!merged) throw new Error('mergeParts: merge failed');
  for (const g of geos) g.dispose();
  return merged;
}

const ALLOWED = new Set(['position', 'normal', 'uv', 'color']);

function stripExtras(geo: THREE.BufferGeometry): void {
  for (const name of Object.keys(geo.attributes)) {
    if (!ALLOWED.has(name)) geo.deleteAttribute(name);
  }
}

function bakeVertexColor(geo: THREE.BufferGeometry, color: THREE.Color): void {
  const count = geo.getAttribute('position').count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

/** Flat-shaded lit material reading vertex colors — the toy-hull look. */
export function vertexPaintMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.75,
    metalness: 0.05,
  });
}

// ---- shared primitive shortcuts ------------------------------------------------

export function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d, 1, 1, 1);
}

export function capsule(r: number, len: number): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(r, len, 3, 8);
}

export function cone(r: number, h: number, seg = 10): THREE.BufferGeometry {
  return new THREE.ConeGeometry(r, h, seg);
}

export function cylinder(rt: number, rb: number, h: number, seg = 12): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(rt, rb, h, seg);
}

export function sphere(r: number, seg = 12): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, seg, Math.max(6, seg >> 1));
}

export function torus(r: number, tube: number, seg = 24): THREE.BufferGeometry {
  return new THREE.TorusGeometry(r, tube, 8, seg);
}

/**
 * A solid of revolution about Y from a profile of [radius, y] pairs, top to bottom.
 *
 * The anatomy primitive. A limb is not a cylinder: a thigh is widest just below the hip and
 * narrows to the knee, a calf bulges and runs out into the ankle, and those two curves are
 * most of what makes a leg read as a leg rather than a stick. A capsule has neither. The
 * ends are closed by pinching the profile to the axis, so the solid has no holes to see
 * through when a limb swings end-on to the camera.
 */
export function lathe(profile: readonly (readonly [number, number])[], seg = 12): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const first = profile[0] as readonly [number, number];
  const last = profile[profile.length - 1] as readonly [number, number];
  // LatheGeometry sweeps bottom-up in the order given; feed it from the bottom so the
  // normals face outward.
  pts.push(new THREE.Vector2(0, last[1]));
  for (let i = profile.length - 1; i >= 0; i--) {
    const p = profile[i] as readonly [number, number];
    pts.push(new THREE.Vector2(p[0], p[1]));
  }
  pts.push(new THREE.Vector2(0, first[1]));
  // LatheGeometry's own normals, not computeVertexNormals: the lathe duplicates its seam
  // vertices, and recomputing would put a visible crease down the back of every limb.
  return new THREE.LatheGeometry(pts, seg);
}

/** An ellipsoid: a unit sphere scaled by the three radii. */
export function ellipsoid(rx: number, ry: number, rz: number, seg = 12): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, seg, Math.max(6, seg >> 1));
  // scale() carries the normals through the inverse-transpose, so they stay correct.
  geo.scale(rx, ry, rz);
  return geo;
}

/** Smooth-shaded counterpart of vertexPaintMaterial: for bodies, which are not hulls. */
export function smoothPaintMaterial(roughness = 0.72): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: false, roughness, metalness: 0 });
}
