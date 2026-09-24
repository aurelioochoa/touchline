// The barra bench: the home end, from the pitch, without playing a match to get there.
//
//   npm run dev, then open http://localhost:5179/scripts/barra.html
//   ?goal=3     — a home goal three seconds ago (flares, paper, flashes)
//   ?night      — under floodlights
//   ?cam=wide|close|side  — where to stand
//   ?t=12       — seconds into the match (the walk-out flares burn for the first ~25)
//   ?crowd=0.7  — the share of seats with a modelled spectator (0: the painted crowd)
//   ?nofx       — no flares, smoke, paper or flashes

import * as THREE from 'three';
import { Stadium, BOWL_HALF_LENGTH } from '../src/render/stadium.js';

const q = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const night = q.has('night');
scene.add(new THREE.HemisphereLight(0xdfeeff, 0x4a6b3a, night ? 0.5 : 1.1));
const key = new THREE.DirectionalLight(0xfff4e2, night ? 1.2 : 2.4);
key.position.set(30, 60, 20);
scene.add(key);
const grass = new THREE.Mesh(new THREE.PlaneGeometry(130, 90), new THREE.MeshStandardMaterial({ color: 0x3f7f35, roughness: 0.95 }));
grass.rotation.x = -Math.PI / 2;
scene.add(grass);

const stadium = new Stadium(
  0x1d5a,
  { primary: 0xc8102e, secondary: 0xffffff, name: 'Granada Nueva' },
  { crowd: Number(q.get('crowd') ?? '1'), fx: !q.has('nofx') },
);
scene.add(stadium.group);
stadium.setFloodlights(night);
if (night) stadium.setSky(0x05080f, 0x0d1522, 0x1a2332);

const cams: Record<string, [number[], number[], number]> = {
  wide: [[-BOWL_HALF_LENGTH + 30, 6, 12], [-BOWL_HALF_LENGTH - 6, 5, 0], 55],
  close: [[-BOWL_HALF_LENGTH + 9, 3.2, 4], [-BOWL_HALF_LENGTH - 4, 4.2, 0], 50],
  side: [[-BOWL_HALF_LENGTH + 12, 4, 22], [-BOWL_HALF_LENGTH - 4, 4, 2], 45],
  stand: [[-10, 2.2, 20], [-2, 5, 50], 55],
  pitch: [[10, 9, -10], [-20, 5, 45], 60],
  seats: [[8, 3.5, 36], [2, 3.5, 48], 50],
};
const [pos, look, fov] = cams[q.get('cam') ?? 'wide'] ?? cams.wide!;
const cam = new THREE.PerspectiveCamera(fov, innerWidth / innerHeight, 0.1, 900);
cam.position.set(pos[0]!, pos[1]!, pos[2]!);
cam.lookAt(look[0]!, look[1]!, look[2]!);

// Run the clock forward to the requested moment in fixed steps, as a match would.
const t = Number(q.get('t') ?? '40');
const goal = q.has('goal') ? Number(q.get('goal')) : -1;
const dt = 1 / 30;
for (let s = 0; s < t; s += dt) {
  if (goal >= 0 && Math.abs(s - (t - goal)) < dt / 2) {
    stadium.roar();
    stadium.homeGoal();
  }
  stadium.setDanger(q.has('loud') ? 0.9 : 0.3);
  stadium.update(dt);
}
renderer.render(scene, cam);
if (!q.has('still')) {
  let last = performance.now();
  const loop = () => {
    const now = performance.now();
    stadium.update((now - last) / 1000);
    last = now;
    renderer.render(scene, cam);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
