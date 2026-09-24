// Which way the joints bend.
//
// This file exists because of a bug that lived through every screenshot the project ever
// took: the elbow was given the same rotation sign as the knee, so every figure ran with
// its forearms folded out BEHIND it. A knee does that. An elbow does the opposite, and
// nothing in the codebase said so — `gait.test.ts` asserts joint ANGLES, and an angle has
// no direction until the limb chain turns it into one.
//
// So these assertions are made in world space, on the matrices the GPU is actually given.
// No WebGL is needed for that: an InstancedMesh's matrices are plain maths.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FigureField, LIMBS } from './figure.js';
import { RIG, emptyPose, runPose, type Pose } from './gait.js';

/** A facing that maps the figure's own +Z (forward) onto world +Z, so signs read directly. */
const FORWARD = Math.PI / 2;

function meshFor(field: FigureField, limb: string): THREE.InstancedMesh {
  const mesh = field.group.children.find((c) => c.name === `limb:${limb}`);
  if (!mesh) throw new Error(`no mesh for ${limb}`);
  return mesh as THREE.InstancedMesh;
}

/**
 * Where a point in a limb's own frame ends up in the world.
 *
 * `which` indexes the instance directly: for a paired limb on figure 0 that is just the
 * side, which is all these tests need.
 */
function pointOn(field: FigureField, limb: string, which: number, local: THREE.Vector3): THREE.Vector3 {
  const m = new THREE.Matrix4();
  meshFor(field, limb).getMatrixAt(which, m);
  return local.clone().applyMatrix4(m);
}

/** The joint itself — every limb geometry has its joint at its own origin. */
function jointOf(field: FigureField, limb: string, which: number): THREE.Vector3 {
  return pointOn(field, limb, which, new THREE.Vector3(0, 0, 0));
}

describe('the limb chain', () => {
  it('gives every limb group a mesh', () => {
    const field = new FigureField(1);
    for (const limb of LIMBS) expect(meshFor(field, limb)).toBeTruthy();
    field.dispose();
  });

  it('folds the elbow forward and the knee backward', () => {
    const field = new FigureField(1);
    const pose: Pose = emptyPose();
    // Arms hanging, legs straight, then one joint bent on each.
    pose.elbowBend = [1.2, 1.2];
    pose.kneeBend = [1.2, 1.2];
    field.setPose(0, 0, 0, FORWARD, pose);

    for (const arm of [0, 1]) {
      const elbow = jointOf(field, 'forearm', arm);
      const hand = pointOn(field, 'forearm', arm, new THREE.Vector3(0, -RIG.forearm, 0));
      // You cannot bend your elbow backwards. The hand comes up in FRONT of the elbow.
      expect(hand.z - elbow.z, `arm ${arm}`).toBeGreaterThan(0.05);
    }
    for (const leg of [0, 1]) {
      const knee = jointOf(field, 'shin', leg);
      const ankle = pointOn(field, 'shin', leg, new THREE.Vector3(0, -RIG.shin, 0));
      // A knee folds the other way: the heel goes back toward the buttock.
      expect(ankle.z - knee.z, `leg ${leg}`).toBeLessThan(-0.05);
    }
    field.dispose();
  });

  it('swings each arm opposite the leg on the same side, in world space', () => {
    const field = new FigureField(1);
    const pose = emptyPose();
    // A phase where the legs are genuinely split rather than passing each other.
    runPose(pose, Math.PI * 0.75, 6.5, 0, 1);
    field.setPose(0, 0, 0, FORWARD, pose);

    const hips = new THREE.Vector3(0, 0, 0);
    for (const side of [0, 1]) {
      const foot = jointOf(field, 'foot', side);
      const hand = pointOn(field, 'forearm', side, new THREE.Vector3(0, -RIG.forearm, 0));
      const shoulder = jointOf(field, 'upperArm', side);
      const footAhead = foot.z - hips.z;
      // From the shoulder, not the hips: a runner leans forward, so his whole upper body is
      // ahead of his hips and a hand measured from there is "ahead" whichever way it swings.
      const handAhead = hand.z - shoulder.z;
      // Left leg forward means left arm back. If both go the same way the figure is
      // skipping, which is the other classic procedural-gait tell.
      expect(Math.sign(footAhead), `side ${side}`).toBe(-Math.sign(handAhead));
    }
    field.dispose();
  });

  it('leans FORWARD for a positive lean, and nods DOWN for a positive head pitch', () => {
    // Both were applied with the opposite sign for months: every sprinter leaned back like
    // somebody braking, and the header's "arch back, then snap through" played inverted.
    const field = new FigureField(1);
    const pose = emptyPose();
    pose.lean = 0.35;
    field.setPose(0, 0, 0, FORWARD, pose);
    expect(jointOf(field, 'head', 0).z).toBeGreaterThan(0.1);

    const nod = emptyPose();
    nod.headPitch = 0.4;
    field.setPose(0, 0, 0, FORWARD, nod);
    const nose = pointOn(field, 'head', 0, new THREE.Vector3(0, 0.2, 0.1));
    const back = pointOn(field, 'head', 0, new THREE.Vector3(0, 0.2, -0.1));
    expect(nose.y).toBeLessThan(back.y);
    field.dispose();
  });

  it('swings an arm forward for a positive shoulder pitch, and out for a positive roll', () => {
    const field = new FigureField(1);
    const pose = emptyPose();
    pose.shoulderPitch = [0.9, 0.9];
    field.setPose(0, 0, 0, FORWARD, pose);
    for (const arm of [0, 1]) {
      const shoulder = jointOf(field, 'upperArm', arm);
      const elbow = pointOn(field, 'upperArm', arm, new THREE.Vector3(0, -RIG.upperArm, 0));
      expect(elbow.z - shoulder.z, `arm ${arm}`).toBeGreaterThan(0.15);
    }
    const out = emptyPose();
    out.shoulderRoll = [1.2, 1.2];
    field.setPose(0, 0, 0, FORWARD, out);
    for (const arm of [0, 1]) {
      const shoulder = jointOf(field, 'upperArm', arm);
      const elbow = pointOn(field, 'upperArm', arm, new THREE.Vector3(0, -RIG.upperArm, 0));
      // Further from the centre line than the shoulder it hangs from.
      expect(Math.abs(elbow.x) - Math.abs(shoulder.x), `arm ${arm}`).toBeGreaterThan(0.15);
    }
    field.dispose();
  });

  it('runs the legs along legYaw while the chest keeps its facing', () => {
    const field = new FigureField(1);
    const pose = emptyPose();
    pose.legYaw = Math.PI / 2;
    pose.hipPitch = [0.6, 0.6];
    field.setPose(0, 0, 0, FORWARD, pose);
    // Legs swung "forward" now go sideways; the shoulders still square to +Z.
    const foot = jointOf(field, 'foot', 0);
    expect(Math.abs(foot.x)).toBeGreaterThan(Math.abs(foot.z));
    const l = jointOf(field, 'upperArm', 0);
    const r = jointOf(field, 'upperArm', 1);
    expect(Math.abs(l.z - r.z)).toBeLessThan(0.01);
    field.dispose();
  });

  it('shows exactly one haircut per figure', () => {
    const field = new FigureField(1);
    field.setColors(0, {
      shirt: 0xff0000, sleeve: 0xff0000, shorts: 0xffffff, sock: 0xff0000,
      skin: 0xc98f63, hair: 0x1c1512, boot: 0x14171c, hairStyle: 3,
    });
    field.setPose(0, 0, 0, FORWARD, emptyPose());
    const shown = ['hairCrop', 'hairShort', 'hairQuiff', 'hairCurly', 'hairBun'].filter((h) => {
      const m = new THREE.Matrix4();
      meshFor(field, h).getMatrixAt(0, m);
      return Math.abs(m.determinant()) > 1e-9;
    });
    expect(shown).toEqual(['hairCurly']);
    field.dispose();
  });

  it('stands about 1.8m tall, which is what the rig claims', () => {
    // The head used to be built entirely BELOW its joint, so the crown landed 126mm above
    // the shoulder line and the whole figure was 1.57m — a head shorter than a footballer.
    const field = new FigureField(1);
    const pose = emptyPose();
    field.setPose(0, 0, 0, FORWARD, pose);
    const crown = pointOn(field, 'head', 0, new THREE.Vector3(0, RIG.headRadius * 2.9, 0));
    expect(crown.y).toBeGreaterThan(1.7);
    expect(crown.y).toBeLessThan(1.9);
    field.dispose();
  });

  it('scales a figure about its own feet, so a taller player still stands on the grass', () => {
    const field = new FigureField(2);
    const pose = emptyPose();
    field.setBuild(0, 1);
    field.setBuild(1, 1.06);
    field.setPose(0, 0, 0, FORWARD, pose);
    field.setPose(1, 0, 0, FORWARD, pose);
    const short = jointOf(field, 'foot', 0);
    const tallMesh = meshFor(field, 'foot');
    const m = new THREE.Matrix4();
    tallMesh.getMatrixAt(2, m); // figure 1, foot 0
    const tall = new THREE.Vector3(0, 0, 0).applyMatrix4(m);
    // Both ankles are within a few centimetres of the ground — nobody floats or sinks.
    expect(Math.abs(short.y - tall.y)).toBeLessThan(0.06);
    field.dispose();
  });
});
