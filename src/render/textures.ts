// Procedural textures, drawn into a canvas once at boot (design §9 — zero asset files).
//
// Everything here is greyscale or near enough; colour arrives from the material tint, so a
// handful of textures serves every kit and every pitch.

import * as THREE from 'three';
import { ballPixels, type ClubColours } from './ballStyle.js';
import { mulberry32 } from '../core/rng.js';

function canvas(size: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  if (!g) throw new Error('2d context unavailable');
  return { c, g };
}

/**
 * The grass: mown stripes, plus enough noise that a 105-metre pitch does not read as a
 * flat green rectangle under a low camera.
 */
export function grassTexture(size = 512, stripes = 14): THREE.CanvasTexture {
  const { c, g } = canvas(size);
  const rng = mulberry32(0x6ea51);
  const bandHeight = size / stripes;
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 === 0 ? '#ffffff' : '#e2e2e2';
    g.fillRect(0, i * bandHeight, size, bandHeight);
  }
  // Blade noise. Fine and low-contrast: at a distance it should read as texture, not dirt.
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * 22;
    d[i] = Math.max(0, Math.min(255, (d[i] as number) + n));
    d[i + 1] = Math.max(0, Math.min(255, (d[i + 1] as number) + n));
    d[i + 2] = Math.max(0, Math.min(255, (d[i + 2] as number) + n));
  }
  g.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A soft round blob, reused for shadows under players and the ball. */
export function blobTexture(size = 128): THREE.CanvasTexture {
  const { c, g } = canvas(size);
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** How one crowd sheet is laid out. Every stand tier asks for its own. */
export interface CrowdSheet {
  /** Canvas size, pixels. Wider than tall: one tile is ~26 metres of a stand. */
  width: number;
  height: number;
  /** Rows of seats up the tier, and seats along one tile. */
  rows: number;
  cols: number;
  seed: number;
  primary: number;
  secondary: number;
  /**
   * How much of the roof's shadow falls across the back rows, 0..1. An upper tier is
   * mostly under the roof; a lower tier is mostly in the open.
   */
  shade: number;
}

/**
 * A crowd sheet: rows of spectators on a seat deck, used as the texture on the stands so a
 * stadium reads as full without a single person being modelled.
 *
 * Two things separate this from confetti, and the first version was confetti. One: the
 * crowd is mostly wearing the HOME club's colours, with neutrals scattered through it,
 * because a stand of uniformly random hues is a bag of Skittles and a stand that leans
 * one way is a home end. Two: the rows are drawn on a visible seat deck with a step
 * shadow under each row, so at distance the sheet still has horizontal structure when the
 * individual people have blurred into a wash.
 *
 * The second version added what a real stand has on top of that: the SEATS, in the club's
 * colour, showing wherever nobody is sitting; the stairways that cut the stand into
 * blocks; spectators drawn with shoulders, arms and hair rather than as two blobs; and the odd
 * flag. At broadcast distance these are what stop a stand being a
 * speckled carpet — the aisles especially, which are the vertical structure a stand has.
 */
export function crowdTexture(o: CrowdSheet): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = o.width;
  c.height = o.height;
  const g = c.getContext('2d');
  if (!g) throw new Error('2d context unavailable');
  const rng = mulberry32(o.seed);
  const { rows, cols } = o;
  const w = o.width;
  const h = o.height;
  const rowH = h / rows;
  const colW = w / cols;
  const home = hexToRgb(o.primary);
  const alt = hexToRgb(o.secondary);
  // Seats are the home colour darkened: a painted plastic seat, never the brightest thing.
  const seat = `rgb(${home.map((v) => Math.round(v * 0.45 + 18)).join(',')})`;
  const seatLit = `rgb(${home.map((v) => Math.round(v * 0.5 + 22)).join(',')})`;
  const skin = ['#e8bd93', '#c98f63', '#9a643c', '#f0d0ae', '#6f4526', '#d7a57a'];
  const hair = ['#1c1410', '#3a2618', '#5b3a1f', '#8c6a3c', '#b9a58a', '#2b2b2b', '#d8c7a0'];
  // Two stairways per tile, which on a 26m tile is a block every 13 metres.
  const aisle = (col: number): boolean => col === 0 || col === Math.floor(cols / 2);

  // The deck: a riser and a tread for every row.
  for (let r = 0; r < rows; r++) {
    const y = r * rowH;
    g.fillStyle = '#2b3139';
    g.fillRect(0, y, w, rowH);
    g.fillStyle = '#1b2026';
    g.fillRect(0, y, w, rowH * 0.28);
  }

  // The stairways: concrete steps, with a yellow nosing on each, running the full height.
  for (let col = 0; col < cols; col++) {
    if (!aisle(col)) continue;
    const x = col * colW;
    g.fillStyle = '#6c737b';
    g.fillRect(x, 0, colW, h);
    for (let r = 0; r < rows * 2; r++) {
      const y = (r * rowH) / 2;
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x, y, colW, rowH * 0.14);
      g.fillStyle = 'rgba(236,196,64,0.75)';
      g.fillRect(x, y + rowH * 0.14, colW, Math.max(1, rowH * 0.05));
    }
    // Handrail down the middle of the stair.
    g.fillStyle = '#c9ced4';
    g.fillRect(x + colW * 0.48, 0, Math.max(1, colW * 0.05), h);
  }

  const kit = (): string => {
    const roll = rng();
    if (roll < 0.55) return jitter(home, rng, 0.3);
    if (roll < 0.7) return jitter(alt, rng, 0.25);
    const hue = Math.floor(rng() * 360);
    return `hsl(${hue}, ${10 + rng() * 30}%, ${22 + rng() * 42}%)`;
  };

  // Rows from the back to the front, so each row's heads overlap the one behind it the
  // way they do from the pitch.
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      if (aisle(col)) continue;
      const x = (col + 0.5) * colW;
      const base = (r + 1) * rowH;
      // The seat itself: a back and a pan. Visible wherever it is empty, and as a sliver
      // either side of whoever is sitting in it.
      g.fillStyle = seat;
      g.fillRect(x - colW * 0.36, base - rowH * 0.62, colW * 0.72, rowH * 0.46);
      g.fillStyle = seatLit;
      g.fillRect(x - colW * 0.36, base - rowH * 0.62, colW * 0.72, rowH * 0.05);
      if (rng() < 0.07) continue; // empty seat

      const px = x + (rng() - 0.5) * colW * 0.18;
      const standing = rng() < 0.12;
      const lift = standing ? rowH * 0.22 : 0;
      const shirt = kit();
      const shoulderY = base - rowH * 0.66 - lift;
      const bodyW = colW * (0.3 + rng() * 0.08);

      // Arms up — a fist, a clap. Drawn before the body so the shoulders cover the joint.
      if (rng() < 0.07) {
        g.strokeStyle = shirt;
        g.lineWidth = Math.max(1.5, colW * 0.1);
        g.lineCap = 'round';
        for (const sgn of [-1, 1]) {
          g.beginPath();
          g.moveTo(px + sgn * bodyW * 0.8, shoulderY + rowH * 0.05);
          g.lineTo(px + sgn * bodyW * 0.95, shoulderY - rowH * 0.62);
          g.stroke();
        }
      }

      // Torso and shoulders: a rounded trapezoid, lit from above.
      const grad = g.createLinearGradient(0, shoulderY, 0, base);
      grad.addColorStop(0, shirt);
      grad.addColorStop(1, 'rgba(0,0,0,0.55)');
      g.fillStyle = shirt;
      roundedBody(g, px, shoulderY, bodyW, base - rowH * 0.2 - shoulderY);
      g.fillStyle = grad;
      g.globalAlpha = 0.45;
      roundedBody(g, px, shoulderY, bodyW, base - rowH * 0.2 - shoulderY);
      g.globalAlpha = 1;

      // Head, then hair or a cap over the top of it.
      const headR = Math.min(colW * 0.15, rowH * 0.17);
      const headY = shoulderY - headR * 0.95;
      g.fillStyle = skin[Math.floor(rng() * skin.length)] as string;
      g.beginPath();
      g.ellipse(px, headY, headR * 0.9, headR, 0, 0, Math.PI * 2);
      g.fill();
      const top = rng();
      g.fillStyle = top < 0.14 ? rgb(home) : top < 0.2 ? rgb(alt) : (hair[Math.floor(rng() * hair.length)] as string);
      g.beginPath();
      g.ellipse(px, headY - headR * 0.35, headR * 0.95, headR * (top < 0.2 ? 0.62 : 0.55), 0, Math.PI, Math.PI * 2);
      g.fill();
    }
  }

  // Now and then a flag draped over the front of a row: a block of the club's colours,
  // folded, and in the shade of the people round it — not a clean painted rectangle,
  // which from the far side reads as a hole in the texture.
  if (rng() < 0.6) {
    const fw = colW * (2.5 + Math.floor(rng() * 2));
    const fh = rowH * (1.1 + rng() * 0.5);
    const fx = colW * (1.5 + rng() * (cols / 2 - 6));
    const fy = rowH * Math.floor(1 + rng() * (rows - 3)) + rowH * 0.3;
    const bands = 3;
    for (let k = 0; k < bands; k++) {
      g.fillStyle = k % 2 === 0 ? jitter(home, rng, 0.15) : jitter(alt, rng, 0.4);
      g.fillRect(fx, fy + (k * fh) / bands, fw, fh / bands + 0.5);
    }
    const folds = g.createLinearGradient(fx, 0, fx + fw, 0);
    for (let k = 0; k <= 6; k++) folds.addColorStop(k / 6, k % 2 === 0 ? 'rgba(0,0,0,0.32)' : 'rgba(0,0,0,0.05)');
    g.fillStyle = folds;
    g.fillRect(fx, fy, fw, fh);
  }

  // The roof shade. The back rows of a covered stand are under a roof and the front rows
  // are in the sun, and without this the far stand is the brightest, highest-contrast
  // object in the frame — which puts the eye on the crowd instead of on the football.
  // Baked into the sheet rather than lit, because the stand is one unlit plane.
  //
  // This is why the crowd texture is NOT tiled vertically (see `crowdTexture`'s caller):
  // a gradient across v repeats with the tile, and two shade bands up one terrace reads
  // as a mistake rather than as a roof.
  const shade = g.createLinearGradient(0, 0, 0, h);
  shade.addColorStop(0, `rgba(10,16,26,${(0.62 * o.shade).toFixed(3)})`);
  shade.addColorStop(0.42, `rgba(10,16,26,${(0.24 * o.shade).toFixed(3)})`);
  shade.addColorStop(0.78, 'rgba(10,16,26,0.02)');
  shade.addColorStop(1, 'rgba(255,250,235,0.10)');
  g.fillStyle = shade;
  g.fillRect(0, 0, w, h);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A seated torso: square at the shoulders, rounded off, widening a little to the seat. */
function roundedBody(g: CanvasRenderingContext2D, x: number, top: number, halfW: number, height: number): void {
  const r = Math.min(halfW * 0.6, height * 0.45);
  g.beginPath();
  g.moveTo(x - halfW, top + r);
  g.quadraticCurveTo(x - halfW, top, x - halfW + r, top);
  g.lineTo(x + halfW - r, top);
  g.quadraticCurveTo(x + halfW, top, x + halfW, top + r);
  g.lineTo(x + halfW * 1.08, top + height);
  g.lineTo(x - halfW * 1.08, top + height);
  g.closePath();
  g.fill();
}

function rgb(v: [number, number, number]): string {
  return `rgb(${v[0]},${v[1]},${v[2]})`;
}

/**
 * Cast concrete: shuttering panels, their joints and tie holes, and rain streaks down
 * from every horizontal joint. Greyscale, tinted by the material, and tiled in WORLD
 * metres (see `boxUvInMetres` in stadium.ts) so a 120-metre wall and a 4-metre kerb
 * carry panels the same size.
 */
export function concreteTexture(size = 512): THREE.CanvasTexture {
  const { c, g } = canvas(size);
  const rng = mulberry32(0xc0c7e7e);
  g.fillStyle = '#d4d4d4';
  g.fillRect(0, 0, size, size);
  // Mottling: big soft blotches, then fine grain.
  for (let i = 0; i < 90; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 10 + rng() * 60;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const v = rng() < 0.5 ? '0,0,0' : '255,255,255';
    grad.addColorStop(0, `rgba(${v},${(0.03 + rng() * 0.05).toFixed(3)})`);
    grad.addColorStop(1, `rgba(${v},0)`);
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  grain(g, size, size, rng, 18);
  // Panels: two across, four up, per tile. A tile is eight metres, so a panel is 4m x 2m.
  const pw = size / 2;
  const ph = size / 4;
  for (let j = 0; j < 4; j++) {
    const y = j * ph;
    // Streaks: rain running off the joint above.
    for (let k = 0; k < 14; k++) {
      const x = rng() * size;
      const len = ph * (0.3 + rng() * 0.9);
      const grad = g.createLinearGradient(0, y, 0, y + len);
      grad.addColorStop(0, `rgba(40,38,34,${(0.1 + rng() * 0.12).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(40,38,34,0)');
      g.fillStyle = grad;
      g.fillRect(x, y, 2 + rng() * 6, len);
    }
    g.fillStyle = 'rgba(0,0,0,0.32)';
    g.fillRect(0, y, size, 2);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(0, y + 2, size, 1);
    for (let i = 0; i < 2; i++) {
      g.fillStyle = 'rgba(0,0,0,0.26)';
      g.fillRect(i * pw + (j % 2) * pw * 0.5, y, 2, ph);
      // Tie holes: the little grid every shuttered wall has.
      g.fillStyle = 'rgba(0,0,0,0.3)';
      for (let a = 1; a < 4; a++) {
        for (let b = 1; b < 3; b++) {
          g.beginPath();
          g.arc(i * pw + (a * pw) / 4, y + (b * ph) / 3, 2.2, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Profiled roof sheeting: the trapezoidal ribs of a steel roof, lit from one side, plus
 * weathering. Tiled along the ribs in world metres like the concrete.
 */
export function roofSheetTexture(size = 256): THREE.CanvasTexture {
  const { c, g } = canvas(size);
  const rng = mulberry32(0x5eee7);
  const ribs = 8;
  const rw = size / ribs;
  for (let i = 0; i < ribs; i++) {
    const x = i * rw;
    const grad = g.createLinearGradient(x, 0, x + rw, 0);
    grad.addColorStop(0, '#9a9a9a');
    grad.addColorStop(0.18, '#e6e6e6');
    grad.addColorStop(0.32, '#cfcfcf');
    grad.addColorStop(0.5, '#bdbdbd');
    grad.addColorStop(0.82, '#b4b4b4');
    grad.addColorStop(1, '#8a8a8a');
    g.fillStyle = grad;
    g.fillRect(x, 0, rw, size);
  }
  grain(g, size, size, rng, 14);
  // Weathering streaks running down the fall of the roof.
  for (let k = 0; k < 30; k++) {
    g.fillStyle = `rgba(30,28,24,${(0.04 + rng() * 0.07).toFixed(3)})`;
    g.fillRect(rng() * size, rng() * size, 1 + rng() * 3, 20 + rng() * size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * The glazed front of the hospitality boxes between two tiers: panes, mullions, and a
 * warm light on in some of the rooms. Returns the colour map and the emissive map, which
 * is the lit rooms alone, so at night the boxes glow and by day they are dark glass.
 */
export function glazingTextures(seed: number): { map: THREE.CanvasTexture; glow: THREE.CanvasTexture } {
  const w = 512;
  const h = 64;
  const mk = (): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return { c, g: c.getContext('2d') as CanvasRenderingContext2D };
  };
  const a = mk();
  const b = mk();
  const rng = mulberry32(seed);
  b.g.fillStyle = '#000';
  b.g.fillRect(0, 0, w, h);
  const panes = 16;
  const pw = w / panes;
  for (let i = 0; i < panes; i++) {
    const x = i * pw;
    const grad = a.g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#3b4a58');
    grad.addColorStop(0.45, '#1b242e');
    grad.addColorStop(1, '#10161c');
    a.g.fillStyle = grad;
    a.g.fillRect(x, 0, pw, h);
    // A diagonal sky reflection across the glass.
    a.g.fillStyle = 'rgba(200,220,240,0.08)';
    a.g.beginPath();
    a.g.moveTo(x + pw * 0.2, 0);
    a.g.lineTo(x + pw * 0.55, 0);
    a.g.lineTo(x + pw * 0.15, h);
    a.g.lineTo(x - pw * 0.2, h);
    a.g.fill();
    // Some rooms have the lights on.
    if (rng() < 0.45) {
      const warm = b.g.createLinearGradient(0, 0, 0, h);
      warm.addColorStop(0, 'rgba(255,214,160,0.75)');
      warm.addColorStop(1, 'rgba(255,190,120,0.25)');
      b.g.fillStyle = warm;
      b.g.fillRect(x + 2, 6, pw - 4, h - 10);
      // Silhouettes at the glass.
      b.g.fillStyle = '#000';
      for (let k = 0; k < 3; k++) {
        if (rng() < 0.5) continue;
        const sx = x + 4 + rng() * (pw - 8);
        b.g.fillRect(sx - 2, h * 0.45, 5, h * 0.5);
        b.g.beginPath();
        b.g.arc(sx + 0.5, h * 0.4, 3, 0, Math.PI * 2);
        b.g.fill();
      }
    }
  }
  // Mullions and transoms, on both, so the frame is dark whatever is behind it.
  for (const t of [a, b]) {
    t.g.fillStyle = t === a ? '#c3c9cf' : '#000';
    for (let i = 0; i <= panes; i++) t.g.fillRect(i * pw - 1, 0, 2, h);
    t.g.fillRect(0, 0, w, 4);
    t.g.fillRect(0, h - 5, w, 5);
  }
  const done = (c: HTMLCanvasElement): THREE.CanvasTexture => {
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  };
  return { map: done(a.c), glow: done(b.c) };
}

function grain(g: CanvasRenderingContext2D, w: number, h: number, rng: () => number, amount: number): void {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, (d[i] as number) + n));
    d[i + 1] = Math.max(0, Math.min(255, (d[i + 1] as number) + n));
    d[i + 2] = Math.max(0, Math.min(255, (d[i + 2] as number) + n));
  }
  g.putImageData(img, 0, 0);
}

function hexToRgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

/** A colour near the given one, so a stand of one kit is not a stand of one pixel. */
function jitter(rgb: [number, number, number], rng: () => number, amount: number): string {
  const k = 1 - amount / 2 + rng() * amount;
  const v = rgb.map((ch) => Math.max(0, Math.min(255, Math.round(ch * k + (rng() - 0.5) * 22))));
  return `rgb(${v[0]},${v[1]},${v[2]})`;
}

/** The ball: white with a few dark panels, so its spin is visible. */
export function ballTexture(style = 0, colours: ClubColours = { primary: 0xffffff, secondary: 0x20242c }): THREE.CanvasTexture {
  // Painted on the sphere by render/ballStyle.ts and unwrapped here, so every design is a
  // true pattern on a ball rather than a flat picture pinched at the poles.
  const w = 256;
  const h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) g.putImageData(new ImageData(ballPixels(style, colours, w, h), w, h), 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * The digits 0–9 in each NUMBER_STYLES setting, for the numbers on the back of the shirts.
 * Ten columns, four rows (classic, block, italic, outline), ink in the alpha channel so the
 * shader can paint it in any colour.
 *
 * Drawn with the browser's own sans-serif rather than a font file (design §9: zero asset
 * files). The row order is NUMBER_STYLES's order and must stay that way — it is what
 * `numberStyle` in a save indexes.
 */
export function digitAtlas(): THREE.Texture {
  // The unit tests build figures under Node, where there is no canvas; a blank texture is
  // the right answer there, since nothing is drawn.
  if (typeof document === 'undefined') return new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const cw = 64;
  const ch = 96;
  const c = document.createElement('canvas');
  c.width = cw * 10;
  c.height = ch * 4;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const fonts = [
    `bold ${ch * 0.86}px "Arial", "Helvetica", sans-serif`,
    `900 ${ch * 0.9}px "Arial Black", "Impact", sans-serif`,
    `italic bold ${ch * 0.86}px "Arial", "Helvetica", sans-serif`,
    `bold ${ch * 0.86}px "Arial", "Helvetica", sans-serif`,
  ];
  for (let row = 0; row < 4; row++) {
    g.font = fonts[row] as string;
    for (let d = 0; d < 10; d++) {
      const x = d * cw + cw / 2;
      const y = row * ch + ch / 2 + ch * 0.04;
      if (row === 3) {
        g.lineWidth = 7;
        g.strokeStyle = '#fff';
        g.strokeText(String(d), x, y);
      } else {
        g.fillStyle = '#fff';
        // Squeeze each glyph into its cell: a "1" and an "8" must sit on the same grid.
        g.save();
        g.translate(x, y);
        g.scale(0.82, 1);
        g.fillText(String(d), 0, 0);
        g.restore();
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}
