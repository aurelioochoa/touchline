// A body sculpted as one surface, not assembled from parts.
//
// The first figure was sixteen rigid primitives per player — a lathe for a thigh, a sphere
// for a knee, an ellipsoid for a jaw — and however well each was shaped it read as what it
// was: a kit of parts. Every joint showed as a ball, every garment as a separate tube, and
// the face as beads stuck to an egg. A real body is one skin that flows from the neck into
// the trapezius into the deltoid, and that flow is most of what the eye reads as "person".
//
// So the body is described as a signed distance field — anatomical volumes (round cones
// for limbs, ellipsoids for muscle masses) merged with a SMOOTH union, which is exactly the
// operation that turns a sphere and a cylinder into a shoulder — and then polygonised
// once, with marching cubes, into a single closed mesh. It is built at load, from numbers:
// still no asset file (design §9).
//
// The mesh is then skinned. Every vertex carries up to four bone weights, taken from how
// close it is to the volumes each bone owns, so a knee bends as a knee rather than as two
// sticks meeting at a ball. figure.ts does the skinning on the GPU, per instance.

import * as THREE from 'three';
import { edgeTable, triTable } from 'three/examples/jsm/objects/MarchingCubes.js';

export type Vec3 = readonly [number, number, number];

/** A volume, in its bone's local frame. */
export type Shape =
  | {
      /** A cone with rounded ends between two points — the limb primitive. */
      kind: 'cone';
      a: Vec3;
      b: Vec3;
      ra: number;
      rb: number;
    }
  | {
      kind: 'ellipsoid';
      c: Vec3;
      r: Vec3;
      /** Euler XYZ, applied about the centre. */
      rot?: Vec3;
    };

export interface Volume {
  shape: Shape;
  /** Index into the bone list whose frame `shape` is written in, and which it moves with. */
  bone: number;
  /** Smooth-union radius, metres. Anatomy blends wide; a garment's hem blends hardly at all. */
  blend: number;
  /**
   * A half-space the volume is clipped to, in bone-local space: points with
   * `dot(n, p) > d` are cut away. It is how a hem is a hem and not a rounded end.
   */
  clip?: { n: Vec3; d: number };
  /**
   * Weight this volume between its own bone and a second one by height in the bind pose:
   * all `bone` at bind `y0`, all `to` at `y1`. A spine, a neck — the places where the body
   * bends along a length rather than at a point.
   */
  spread?: { to: number; y0: number; y1: number };
  /** Marks the arm's volumes, so the shader can tell a hand from the shorts beside it. */
  arm?: boolean;
}

export interface SculptOptions {
  /** The bind-pose world matrix of every bone. */
  bind: readonly THREE.Matrix4[];
  volumes: readonly Volume[];
  /** Grid spacing, metres. */
  cell: number;
  /** Bind-space bounds to polygonise. */
  min: Vec3;
  max: Vec3;
  /** How soft the weight falloff between neighbouring bones is, metres. */
  falloff?: number;
}

interface Prepared {
  v: Volume;
  /** Bind space → shape space. */
  inv: THREE.Matrix4;
  e: Float32Array;
  /** The clip plane in the shape's own frame: (nx, ny, nz, d). */
  clip: [number, number, number, number] | null;
  lo: THREE.Vector3;
  hi: THREE.Vector3;
}

const tmp = new THREE.Vector3();

function localBounds(s: Shape): [THREE.Vector3, THREE.Vector3] {
  if (s.kind === 'cone') {
    const r = Math.max(s.ra, s.rb);
    return [
      new THREE.Vector3(Math.min(s.a[0], s.b[0]) - r, Math.min(s.a[1], s.b[1]) - r, Math.min(s.a[2], s.b[2]) - r),
      new THREE.Vector3(Math.max(s.a[0], s.b[0]) + r, Math.max(s.a[1], s.b[1]) + r, Math.max(s.a[2], s.b[2]) + r),
    ];
  }
  const r = Math.max(s.r[0], s.r[1], s.r[2]);
  return [new THREE.Vector3(s.c[0] - r, s.c[1] - r, s.c[2] - r), new THREE.Vector3(s.c[0] + r, s.c[1] + r, s.c[2] + r)];
}

function prepare(v: Volume, bind: readonly THREE.Matrix4[]): Prepared {
  const bone = bind[v.bone] as THREE.Matrix4;
  // An ellipsoid's own rotation is folded in, so it is evaluated axis-aligned.
  const shapeToBind = bone.clone();
  if (v.shape.kind === 'ellipsoid') {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...v.shape.c),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(v.shape.rot ?? [0, 0, 0]))),
      new THREE.Vector3(1, 1, 1),
    );
    shapeToBind.multiply(m);
  }
  const inv = shapeToBind.clone().invert();
  const [l0, l1] = localBounds(v.shape.kind === 'ellipsoid' ? { ...v.shape, c: [0, 0, 0] } : v.shape);
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
  const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < 8; i++) {
    tmp.set(i & 1 ? l1.x : l0.x, i & 2 ? l1.y : l0.y, i & 4 ? l1.z : l0.z).applyMatrix4(shapeToBind);
    lo.min(tmp);
    hi.max(tmp);
  }
  // The clip plane is written in the bone frame; move it into the shape's frame once here.
  // For an ellipsoid, bone = R·local + c, so n·bone − d = (Rᵀn)·local − (d − n·c).
  let clip: Prepared['clip'] = null;
  if (v.clip) {
    const n = new THREE.Vector3(...v.clip.n);
    let d = v.clip.d;
    if (v.shape.kind === 'ellipsoid') {
      d -= n.dot(new THREE.Vector3(...v.shape.c));
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(v.shape.rot ?? [0, 0, 0])));
      n.applyQuaternion(q.invert());
    }
    clip = [n.x, n.y, n.z, d];
  }
  return { v, inv, e: new Float32Array(inv.elements), clip, lo, hi };
}

/** Distance from a bind-space point to one volume. Negative inside. */
function distance(p: Prepared, x: number, y: number, z: number): number {
  const e = p.e;
  // Into the shape's frame: the bone's for a cone, the ellipsoid's own for an ellipsoid.
  const lx = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
  const ly = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
  const lz = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
  const s = p.v.shape;
  let d: number;
  if (s.kind === 'cone') d = roundCone(lx, ly, lz, s.a, s.b, s.ra, s.rb);
  else d = ellipsoidDist(lx, ly, lz, s.r);
  const c = p.clip;
  if (c) d = Math.max(d, c[0] * lx + c[1] * ly + c[2] * lz - c[3]);
  return d;
}

/** Inigo Quilez's round cone between arbitrary points. */
function roundCone(px: number, py: number, pz: number, a: Vec3, b: Vec3, r1: number, r2: number): number {
  const bax = b[0] - a[0];
  const bay = b[1] - a[1];
  const baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pax = px - a[0];
  const pay = py - a[1];
  const paz = pz - a[2];
  const yv = pax * bax + pay * bay + paz * baz;
  const zv = yv - l2;
  const qx = pax * l2 - bax * yv;
  const qy = pay * l2 - bay * yv;
  const qz = paz * l2 - baz * yv;
  const x2 = qx * qx + qy * qy + qz * qz;
  const y2 = yv * yv * l2;
  const z2 = zv * zv * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(zv) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(yv) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + yv * rr) * il2 - r1;
}

/** The bounded approximation of an ellipsoid's distance: good near the surface, which is all we need. */
function ellipsoidDist(x: number, y: number, z: number, r: Vec3): number {
  const k0 = Math.hypot(x / r[0], y / r[1], z / r[2]);
  const k1 = Math.hypot(x / (r[0] * r[0]), y / (r[1] * r[1]), z / (r[2] * r[2]));
  if (k1 < 1e-9) return -Math.min(r[0], r[1], r[2]);
  return (k0 * (k0 - 1)) / k1;
}

/** Polynomial smooth minimum: commutative, and near enough associative for a body. */
function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export interface SculptResult {
  geometry: THREE.BufferGeometry;
  /** Triangles in the mesh, for budgets and tests. */
  triangles: number;
}

/**
 * Build the mesh. Attributes: position and normal (bind space), `skinIndex` and
 * `skinWeight` (four bones each), and `aArm` (1 on the arms, 0 elsewhere).
 */
export function sculpt(o: SculptOptions): SculptResult {
  const h = o.cell;
  const nx = Math.ceil((o.max[0] - o.min[0]) / h) + 1;
  const ny = Math.ceil((o.max[1] - o.min[1]) / h) + 1;
  const nz = Math.ceil((o.max[2] - o.min[2]) / h) + 1;
  const sx = 1;
  const sy = nx;
  const sz = nx * ny;
  const field = new Float32Array(nx * ny * nz).fill(1);
  const prepared = o.volumes.map((v) => prepare(v, o.bind));

  // Accumulate each volume only inside its own box (plus the blend and a margin for the
  // gradient). Far from every surface the field stays at 1, which is wrong as a distance
  // and irrelevant to a surface.
  for (const p of prepared) {
    const m = p.v.blend + h * 3;
    const x0 = Math.max(0, Math.floor((p.lo.x - m - o.min[0]) / h));
    const x1 = Math.min(nx - 1, Math.ceil((p.hi.x + m - o.min[0]) / h));
    const y0 = Math.max(0, Math.floor((p.lo.y - m - o.min[1]) / h));
    const y1 = Math.min(ny - 1, Math.ceil((p.hi.y + m - o.min[1]) / h));
    const z0 = Math.max(0, Math.floor((p.lo.z - m - o.min[2]) / h));
    const z1 = Math.min(nz - 1, Math.ceil((p.hi.z + m - o.min[2]) / h));
    for (let k = z0; k <= z1; k++) {
      const z = o.min[2] + k * h;
      for (let j = y0; j <= y1; j++) {
        const y = o.min[1] + j * h;
        let idx = x0 + j * sy + k * sz;
        for (let i = x0; i <= x1; i++, idx++) {
          const d = distance(p, o.min[0] + i * h, y, z);
          field[idx] = smin(field[idx]!, d, p.v.blend);
        }
      }
    }
  }

  // --- marching cubes, sharing each edge's vertex between the cubes that meet on it ---
  const edgeVert = new Int32Array(nx * ny * nz * 3).fill(-1);
  const pos: number[] = [];
  const nrm: number[] = [];
  const index: number[] = [];

  const grad = (i: number, j: number, k: number, out: number[]) => {
    const c = i + j * sy + k * sz;
    const fxp = i < nx - 1 ? field[c + sx]! : field[c]!;
    const fxm = i > 0 ? field[c - sx]! : field[c]!;
    const fyp = j < ny - 1 ? field[c + sy]! : field[c]!;
    const fym = j > 0 ? field[c - sy]! : field[c]!;
    const fzp = k < nz - 1 ? field[c + sz]! : field[c]!;
    const fzm = k > 0 ? field[c - sz]! : field[c]!;
    out[0] = fxp - fxm;
    out[1] = fyp - fym;
    out[2] = fzp - fzm;
  };
  const ga = [0, 0, 0];
  const gb = [0, 0, 0];
  const vertexOn = (i: number, j: number, k: number, axis: 0 | 1 | 2): number => {
    const c = i + j * sy + k * sz;
    const key = c * 3 + axis;
    const known = edgeVert[key]!;
    if (known >= 0) return known;
    const i2 = i + (axis === 0 ? 1 : 0);
    const j2 = j + (axis === 1 ? 1 : 0);
    const k2 = k + (axis === 2 ? 1 : 0);
    const fa = field[c]!;
    const fb = field[i2 + j2 * sy + k2 * sz]!;
    const t = fa === fb ? 0.5 : fa / (fa - fb);
    pos.push(
      o.min[0] + (i + (axis === 0 ? t : 0)) * h,
      o.min[1] + (j + (axis === 1 ? t : 0)) * h,
      o.min[2] + (k + (axis === 2 ? t : 0)) * h,
    );
    grad(i, j, k, ga);
    grad(i2, j2, k2, gb);
    const gx = ga[0]! + (gb[0]! - ga[0]!) * t;
    const gy = ga[1]! + (gb[1]! - ga[1]!) * t;
    const gz = ga[2]! + (gb[2]! - ga[2]!) * t;
    const l = Math.hypot(gx, gy, gz) || 1;
    nrm.push(gx / l, gy / l, gz / l);
    const id = pos.length / 3 - 1;
    edgeVert[key] = id;
    return id;
  };
  // The twelve cube edges as (corner offset, axis), in marching-cubes table order.
  const EDGES: [number, number, number, 0 | 1 | 2][] = [
    [0, 0, 0, 0], [1, 0, 0, 1], [0, 1, 0, 0], [0, 0, 0, 1],
    [0, 0, 1, 0], [1, 0, 1, 1], [0, 1, 1, 0], [0, 0, 1, 1],
    [0, 0, 0, 2], [1, 0, 0, 2], [1, 1, 0, 2], [0, 1, 0, 2],
  ];
  const CORNERS: [number, number, number][] = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ];
  const ev = new Int32Array(12);
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let cube = 0;
        for (let c = 0; c < 8; c++) {
          const q = CORNERS[c]!;
          if (field[i + q[0] + (j + q[1]) * sy + (k + q[2]) * sz]! < 0) cube |= 1 << c;
        }
        const bits = edgeTable[cube]!;
        if (bits === 0) continue;
        for (let e = 0; e < 12; e++) {
          if (bits & (1 << e)) {
            const d = EDGES[e]!;
            ev[e] = vertexOn(i + d[0], j + d[1], k + d[2], d[3]);
          }
        }
        const base = cube * 16;
        for (let t = 0; triTable[base + t]! !== -1; t += 3) {
          index.push(ev[triTable[base + t]!]!, ev[triTable[base + t + 1]!]!, ev[triTable[base + t + 2]!]!);
        }
      }
    }
  }

  // The tables wind one way for "inside is low"; make the faces agree with the normals.
  let agree = 0;
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t]! * 3;
    const b = index[t + 1]! * 3;
    const c = index[t + 2]! * 3;
    const ux = pos[b]! - pos[a]!, uy = pos[b + 1]! - pos[a + 1]!, uz = pos[b + 2]! - pos[a + 2]!;
    const vx = pos[c]! - pos[a]!, vy = pos[c + 1]! - pos[a + 1]!, vz = pos[c + 2]! - pos[a + 2]!;
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    agree += Math.sign(fx * nrm[a]! + fy * nrm[a + 1]! + fz * nrm[a + 2]!);
  }
  if (agree < 0) {
    for (let t = 0; t < index.length; t += 3) {
      const s = index[t + 1]!;
      index[t + 1] = index[t + 2]!;
      index[t + 2] = s;
    }
  }

  // --- skin weights ---
  const count = pos.length / 3;
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  const arm = new Float32Array(count);
  const fall = o.falloff ?? 0.018;
  const boneCount = o.bind.length;
  const acc = new Float32Array(boneCount);
  const dist = new Float32Array(prepared.length);
  for (let v = 0; v < count; v++) {
    const x = pos[v * 3]!, y = pos[v * 3 + 1]!, z = pos[v * 3 + 2]!;
    let best = Infinity;
    let bestArm = false;
    for (let p = 0; p < prepared.length; p++) {
      const pr = prepared[p]!;
      // Cheap reject on the box first: the body has fifty-odd volumes and most are far.
      const m = 0.12;
      if (x < pr.lo.x - m || x > pr.hi.x + m || y < pr.lo.y - m || y > pr.hi.y + m || z < pr.lo.z - m || z > pr.hi.z + m) {
        dist[p] = Infinity;
        continue;
      }
      const d = distance(pr, x, y, z);
      dist[p] = d;
      if (d < best) {
        best = d;
        bestArm = pr.v.arm === true;
      }
    }
    acc.fill(0);
    for (let p = 0; p < prepared.length; p++) {
      const d = dist[p]!;
      if (d > best + fall * 5) continue;
      const w = Math.exp(-(d - best) / fall);
      const pv = prepared[p]!.v;
      if (pv.spread) {
        // y0 may sit above y1 (a neck hands over downward), so no smoothstep(min, max).
        const u = Math.min(1, Math.max(0, (y - pv.spread.y0) / (pv.spread.y1 - pv.spread.y0)));
        const s = u * u * (3 - 2 * u);
        acc[pv.bone]! += w * (1 - s);
        acc[pv.spread.to]! += w * s;
      } else {
        acc[pv.bone]! += w;
      }
    }
    // The four heaviest bones, renormalised.
    let total = 0;
    for (let slot = 0; slot < 4; slot++) {
      let bi = 0;
      let bw = -1;
      for (let b = 0; b < boneCount; b++) {
        if (acc[b]! > bw) {
          bw = acc[b]!;
          bi = b;
        }
      }
      if (bw <= 1e-4 * (total || 1)) bw = 0;
      skinIndex[v * 4 + slot] = bi;
      skinWeight[v * 4 + slot] = bw;
      total += bw;
      acc[bi] = -1;
    }
    for (let slot = 0; slot < 4; slot++) skinWeight[v * 4 + slot]! /= total || 1;
    arm[v] = bestArm ? 1 : 0;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  geometry.setAttribute('aArm', new THREE.Float32BufferAttribute(arm, 1));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return { geometry, triangles: index.length / 3 };
}
