// The figure bench: one kit, four views, big enough to judge the model.
//
//   npm run dev, then open http://localhost:5179/scripts/figure.html
//   (?view=front|side|run|face picks one view full-frame; no parameter shows all four;
//   ?style=retro shows the low-poly figure with painted skins)
//
// The match is a poor place to judge a body — the broadcast camera is forty metres away
// and the players never stand still. This page stands one footballer in the light, the
// way a character artist's turntable does, so shape problems are visible before they are
// hidden by distance.

import * as THREE from 'three';
import { FigureField } from '../src/render/figure.js';
import { emptyPose, runPose, idlePose } from '../src/render/gait.js';

const params = new URLSearchParams(location.search);
const only = params.get('view');
const W = innerWidth;
const H = innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, H);
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdfe4e8);
scene.add(new THREE.HemisphereLight(0xdfeeff, 0x4a6b3a, 1.1));
const key = new THREE.DirectionalLight(0xfff4e2, 2.4);
key.position.set(3, 6, 4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -3;
key.shadow.camera.right = 3;
key.shadow.camera.top = 3;
key.shadow.camera.bottom = -3;
scene.add(key);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x5f8f48, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ?cell= picks the sculpting grid: 0.016 is the low tier, 0.009 ultra (tiers.ts).
const field = new FigureField(4, Number(params.get('cell') ?? '0.009'), params.get('style') === 'retro' ? 'retro' : 'realistic');
field.setCastShadow(true);
field.setReceiveShadow(true);
scene.add(field.group);
const kits = [
  { shirt: 0xd8262e, sleeve: 0xd8262e, shorts: 0xffffff, sock: 0xd8262e, skin: 0xc68a5f, hair: 0x1c1512, boot: 0xf24b1d, hairStyle: 1, beard: 0.6, eyes: 0x4a2f1c, number: 9, pattern: 2, patternColour: 0xffffff, chest: 0xf2c200 },
  { shirt: 0x2848a8, sleeve: 0x2848a8, shorts: 0x2848a8, sock: 0x2848a8, skin: 0x8a5a3c, hair: 0x100c0a, boot: 0xffffff, hairStyle: 3, eyes: 0x3b2414, number: 10, pattern: 1, patternColour: 0xb3163c, chest: 0xf2c200 },
  { shirt: 0xffffff, sleeve: 0xffffff, shorts: 0x14171c, sock: 0xffffff, skin: 0xe8b996, hair: 0x7a4a26, boot: 0x14171c, hairStyle: 2, eyes: 0x3f6f9a, number: 7 },
  { shirt: 0xd8262e, sleeve: 0xd8262e, shorts: 0xffffff, sock: 0xd8262e, skin: 0xa8704a, hair: 0x2a1d14, boot: 0xf24b1d, hairStyle: 0, number: 4, pattern: 2, patternColour: 0xffffff },
];
kits.forEach((k, i) => field.setColors(i, k));

const views = [
  { name: 'front', at: [-1.8, 0], facing: Math.PI / 2, cam: [0, 1.0, 3.4], look: [0, 0.92, 0], fov: 38 },
  { name: 'side', at: [0, 0], facing: 0, cam: [0, 1.0, 3.4], look: [0, 0.92, 0], fov: 38 },
  { name: 'run', at: [1.8, 0], facing: 0, cam: [0, 1.0, 3.4], look: [0, 0.92, 0], fov: 38 },
  { name: 'face', at: [-1.8, 0], facing: Math.PI / 2 + 0.5, cam: [0.25, 1.62, 0.85], look: [0, 1.58, 0], fov: 30 },
] as const;

const cams = views.map((v) => {
  const c = new THREE.PerspectiveCamera(v.fov, 1, 0.05, 50);
  return c;
});

const rest = params.get('pose') === 'rest';
function pose(t: number) {
  const stand = emptyPose();
  if (!rest) idlePose(stand, t, 0.2, 0);
  field.setPose(0, -1.8, 0, Math.PI / 2, stand);
  const side = emptyPose();
  if (!rest) idlePose(side, t, 0.2, 1);
  field.setPose(1, 0, 0, 0, side);
  const run = emptyPose();
  runPose(run, (t * 9) % (Math.PI * 2), 6.5, 0, 1);
  field.setPose(2, 1.8, 0, 0, run);
  field.setPose(3, 30, 30, 0, stand);
  field.flush();
}

function frame(t: number) {
  pose(t);
  renderer.setScissorTest(true);
  const list = only ? views.filter((v) => v.name === only) : views;
  const cols = list.length === 1 ? 1 : 2;
  const rows = Math.ceil(list.length / cols);
  list.forEach((v, i) => {
    const w = W / cols;
    const h = H / rows;
    const x = (i % cols) * w;
    const y = H - (Math.floor(i / cols) + 1) * h;
    const cam = cams[views.indexOf(v)] as THREE.PerspectiveCamera;
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    cam.position.set(v.at[0] + v.cam[0], v.cam[1], v.at[1] + v.cam[2]);
    cam.lookAt(v.at[0] + v.look[0], v.look[1], v.at[1] + v.look[2]);
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);
    renderer.render(scene, cam);
  });
}

const t0 = Number(params.get('t') ?? '0.3');
frame(t0);
(window as unknown as { bench: (t: number) => void }).bench = frame;
if (!params.has('still')) {
  const start = performance.now();
  const loop = () => { frame(t0 + (performance.now() - start) / 1000); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}
