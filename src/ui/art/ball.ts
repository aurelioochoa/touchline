// A ball, drawn in 2D from the same function the 3D match paints its texture with.
//
// A lit disc: every pixel inside the circle is a point on the front of a sphere, turned by
// a yaw and a tilt and asked of `paintBall` what colour it is there — so a preview of the
// Carnival ball is the Carnival ball, seams and all, rather than a drawing of one. The
// fantasy balls add their own light on top, which is what makes the fire one read as fire.
//
// Two ways to draw. A still ball evaluates the pattern directly, once per pixel. A SPINNING
// ball paints the equirectangular map once (the same one the match uses) and samples it per
// frame, so a frame costs a lookup per pixel rather than five octaves of noise.

import { ballPixels, ballStyle, paintBall, type ClubColours } from '../../render/ballStyle.js';

const LIGHT = (() => {
  const l = [-0.45, 0.55, 0.7];
  const n = Math.hypot(l[0] as number, l[1] as number, l[2] as number);
  return l.map((v) => v / n) as [number, number, number];
})();
const TILT = 0.32;

interface Options {
  size: number;
  label?: string;
  /** Turn slowly. Stops by itself once the canvas leaves the page. */
  spin?: boolean;
  /** The starting yaw, so a grid of balls does not show every one from the same side. */
  yaw?: number;
}

export function ballCanvas(style: number, colours: ClubColours, opts: Options): HTMLCanvasElement {
  const dpr = Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
  const px = Math.max(8, Math.round(opts.size * dpr));
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  canvas.className = 'tl-ball-canvas';
  canvas.style.width = `${opts.size}px`;
  canvas.style.height = `${opts.size}px`;
  if (opts.label) {
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', opts.label);
  } else {
    canvas.setAttribute('aria-hidden', 'true');
  }
  const g = canvas.getContext('2d');
  if (!g) return canvas;

  const glow = ballStyle(style).glow ?? 0;
  const metal = ballStyle(style).metal ?? 0;
  const image = g.createImageData(px, px);
  const data = image.data;

  /** Colour at a direction, either straight from the pattern or from the pre-painted map. */
  let sample: (x: number, y: number, z: number) => number = (x, y, z) => paintBall(style, [x, y, z], colours);
  if (opts.spin) {
    const W = 256;
    const H = 128;
    const map = ballPixels(style, colours, W, H);
    sample = (x, y, z) => {
      const theta = Math.acos(Math.max(-1, Math.min(1, y)));
      let phi = Math.atan2(z, -x);
      if (phi < 0) phi += Math.PI * 2;
      const row = Math.min(H - 1, Math.floor((theta / Math.PI) * H));
      const col = Math.min(W - 1, Math.floor((phi / (Math.PI * 2)) * W));
      const o = (row * W + col) * 4;
      return ((map[o] as number) << 16) | ((map[o + 1] as number) << 8) | (map[o + 2] as number);
    };
  }

  const draw = (yaw: number): void => {
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const ct = Math.cos(TILT);
    const st = Math.sin(TILT);
    const r = px / 2;
    for (let j = 0; j < px; j++) {
      const ny = -((j + 0.5) / r - 1);
      for (let i = 0; i < px; i++) {
        const nx = (i + 0.5) / r - 1;
        const rr = nx * nx + ny * ny;
        const o = (j * px + i) * 4;
        // One pixel of anti-aliasing at the rim, so the disc is round rather than stepped.
        const edge = (1 - Math.sqrt(rr)) * r;
        if (edge <= -0.5) {
          data[o + 3] = 0;
          continue;
        }
        const nz = Math.sqrt(Math.max(0, 1 - rr));
        // Screen normal to ball space: undo the tilt about x, then the yaw about y.
        const y1 = ny * ct - nz * st;
        const z1 = ny * st + nz * ct;
        const x2 = nx * cy + z1 * sy;
        const z2 = -nx * sy + z1 * cy;
        const rgb = sample(x2, y1, z2);

        const lambert = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
        // Reflection of the light about the normal, against a viewer straight ahead.
        const rz = 2 * lambert * nz - LIGHT[2];
        const spec = Math.pow(Math.max(0, rz), metal > 0 ? 18 : 40) * (metal > 0 ? 0.9 : 0.45);
        const shade = (0.42 + 0.66 * lambert) * (1 - glow) + glow * (0.9 + 0.2 * nz);
        const rim = Math.pow(1 - nz, 3) * 0.35;
        for (let k = 0; k < 3; k++) {
          const ch = (rgb >> (16 - k * 8)) & 255;
          let v = ch * shade + 255 * spec - ch * rim * (1 - glow);
          if (metal > 0) v = v * (0.75 + 0.35 * lambert);
          data[o + k] = v;
        }
        data[o + 3] = Math.max(0, Math.min(1, edge + 0.5)) * 255;
      }
    }
    g.putImageData(image, 0, 0);
  };

  let yaw = opts.yaw ?? 0.6;
  draw(yaw);
  if (!opts.spin) return canvas;

  // A slow turn, about one revolution in fourteen seconds. Frames are capped at 24 a second:
  // the ball is a preview, not the match, and it shares the thread with everything else.
  const reduced = document.documentElement.dataset.motion === 'reduced'
    || (document.documentElement.dataset.motion !== 'full' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (reduced) return canvas;
  let last = 0;
  let seen = false;
  let idle = 0;
  const tick = (now: number): void => {
    if (canvas.isConnected) seen = true;
    else if (seen || ++idle > 120) return;
    if (now - last > 41) {
      yaw += ((now - (last || now)) / 1000) * 0.45;
      last = now;
      draw(yaw);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return canvas;
}
