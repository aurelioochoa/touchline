// The sculpted body, measured like a person.
//
// The first figure's proportions were never checked against anything and it showed: a
// skull a third too wide, hands half the length of a hand. These tests put a tape measure
// round the mesh the GPU actually draws, and compare it with published anthropometry of
// elite footballers (ISAK profiles of Serie A players: mid-thigh girth 54.8cm, calf 37.5cm)
// and the landmarks every figure-drawing course teaches (a relaxed hand reaches mid-thigh).

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { sculpt } from './sculpt.js';
import { BODY_MAX, BODY_MIN, BONE_COUNT, bindMatrices, bodyVolumes, bone, kitLines, poseBones } from './body.js';
import { RIG, emptyPose } from './gait.js';

const bind = bindMatrices();
const { geometry, triangles } = sculpt({ bind, volumes: bodyVolumes(bind), cell: 0.013, min: BODY_MIN, max: BODY_MAX });
const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
const idx = geometry.getAttribute('skinIndex') as THREE.BufferAttribute;
const wt = geometry.getAttribute('skinWeight') as THREE.BufferAttribute;

/** Skin every vertex into a pose on the CPU, exactly as the shader does. */
function skinned(pose = emptyPose()): THREE.Vector3[] {
  const bones = bind.map(() => new THREE.Matrix4());
  poseBones(pose, bones);
  const skin = bones.map((b, i) => b.clone().multiply((bind[i] as THREE.Matrix4).clone().invert()));
  const out: THREE.Vector3[] = [];
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  for (let v = 0; v < pos.count; v++) {
    p.fromBufferAttribute(pos, v);
    const acc = new THREE.Vector3();
    for (let k = 0; k < 4; k++) {
      const w = wt.getComponent(v, k);
      if (w === 0) continue;
      q.copy(p).applyMatrix4(skin[idx.getComponent(v, k)] as THREE.Matrix4).multiplyScalar(w);
      acc.add(q);
    }
    out.push(acc);
  }
  return out;
}

/** Perimeter of the convex hull of a slice's points, in the XZ plane: a tape round a limb. */
function girth(points: THREE.Vector3[]): number {
  const pts = points.map((p) => [p.x, p.z] as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return 0;
  const cross = (o: number[], a: number[], b: number[]) => (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  let len = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    len += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return len;
}

/** Bind-pose vertices on one leg (+X side) within a thin horizontal slice. */
function legSlice(y: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const p = new THREE.Vector3();
  for (let v = 0; v < pos.count; v++) {
    p.fromBufferAttribute(pos, v);
    if (Math.abs(p.y - y) < 0.007 && p.x > 0.015 && p.x < 0.3) out.push(p.clone());
  }
  return out;
}

const at = (b: number, y: number) => new THREE.Vector3(0, y, 0).applyMatrix4(bind[b] as THREE.Matrix4).y;

describe('the sculpted body', () => {
  it('is one mesh inside the frame budget, with sane skin weights', () => {
    expect(triangles).toBeGreaterThan(8000);
    expect(triangles).toBeLessThan(40000);
    for (let v = 0; v < pos.count; v++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        const w = wt.getComponent(v, k);
        expect(Number.isFinite(w)).toBe(true);
        expect(idx.getComponent(v, k)).toBeLessThan(BONE_COUNT);
        sum += w;
      }
      expect(Math.abs(sum - 1)).toBeLessThan(1e-4);
    }
  });

  it('stands about 1.8m from the sole of the boot to the crown', () => {
    const pts = skinned();
    const ys = pts.map((p) => p.y);
    const height = Math.max(...ys) - Math.min(...ys);
    expect(height).toBeGreaterThan(1.72);
    expect(height).toBeLessThan(1.84);
  });

  it('has a footballer\'s thigh: about 55cm round at mid-thigh', () => {
    const hip = at(bone('thigh1'), 0);
    const mid = girth(legSlice(hip - RIG.thigh * 0.5));
    expect(mid).toBeGreaterThan(0.48);
    expect(mid).toBeLessThan(0.6);
  });

  it('has a calf of about 37.5cm, sock included', () => {
    const knee = at(bone('shin1'), 0);
    let widest = 0;
    for (let d = 0.06; d <= 0.22; d += 0.01) widest = Math.max(widest, girth(legSlice(knee - d)));
    expect(widest).toBeGreaterThan(0.34);
    expect(widest).toBeLessThan(0.43);
  });

  it('has a head about 15.5cm across, not the 21cm the old figure had', () => {
    const skull = kitLines(bind).skull.y;
    let half = 0;
    const p = new THREE.Vector3();
    for (let v = 0; v < pos.count; v++) {
      p.fromBufferAttribute(pos, v);
      // Above the ears, where head breadth is measured.
      if (p.y > skull + 0.03 && p.y < skull + 0.06) half = Math.max(half, Math.abs(p.x));
    }
    expect(half * 2).toBeGreaterThan(0.14);
    expect(half * 2).toBeLessThan(0.17);
  });

  it('hangs its hands to mid-thigh at rest', () => {
    const pts = skinned();
    const forearms = [bone('forearm0'), bone('forearm1')];
    let lowest = Infinity;
    for (let v = 0; v < pos.count; v++) {
      if (forearms.includes(idx.getComponent(v, 0)) && wt.getComponent(v, 0) > 0.9) lowest = Math.min(lowest, (pts[v] as THREE.Vector3).y);
    }
    const hip = RIG.hipHeight - 0.02;
    expect(lowest).toBeGreaterThan(hip - RIG.thigh * 0.75);
    expect(lowest).toBeLessThan(hip - RIG.thigh * 0.25);
  });

  it('bends at the knee without tearing: a folded leg stays one closed surface', () => {
    const pose = emptyPose();
    pose.kneeBend = [1.6, 1.6];
    pose.hipPitch = [0.9, 0.9];
    const pts = skinned(pose);
    const index = geometry.getIndex() as THREE.BufferAttribute;
    // No edge stretches to more than a few cells: skinning that tears shows as long edges.
    let longest = 0;
    for (let t = 0; t < index.count; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = pts[index.getX(t + k)] as THREE.Vector3;
        const b = pts[index.getX(t + ((k + 1) % 3))] as THREE.Vector3;
        longest = Math.max(longest, a.distanceTo(b));
      }
    }
    expect(longest).toBeLessThan(0.08);
  });
});
