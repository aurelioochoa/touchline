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

/**
 * A crowd sheet: rows of little coloured smudges on a seat deck, used as the texture on
 * the stands so a stadium reads as full without a single person being modelled.
 *
 * Two things separate this from confetti, and the first version was confetti. One: the
 * crowd is mostly wearing the HOME club's colours, with neutrals scattered through it,
 * because a stand of uniformly random hues is a bag of Skittles and a stand that leans
 * one way is a home end. Two: the rows are drawn on a visible seat deck with a step
 * shadow under each row, so at distance the sheet still has horizontal structure when the
 * individual people have blurred into a wash.
 */
export function crowdTexture(
  size = 512,
  seed = 0x1d5a,
  primary = 0x2f8f43,
  secondary = 0xffffff,
): THREE.CanvasTexture {
  const { c, g } = canvas(size);
  const rng = mulberry32(seed);
  const rows = 30;
  const cols = 34;
  const rowH = size / rows;
  const colW = size / cols;

  // The seat deck, banded so each row of seats sits on its own step.
  for (let r = 0; r < rows; r++) {
    g.fillStyle = r % 2 === 0 ? '#2a323c' : '#232a33';
    g.fillRect(0, r * rowH, size, rowH);
    // The shadow the step above casts on the one below. This is the whole of the
    // structure that survives being minified to four pixels tall.
    g.fillStyle = 'rgba(0,0,0,0.34)';
    g.fillRect(0, r * rowH, size, rowH * 0.24);
  }

  const home = hexToRgb(primary);
  const alt = hexToRgb(secondary);
  const skin = ['#e8bd93', '#c98f63', '#9a643c', '#f0d0ae', '#6f4526'];

  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      if (rng() < 0.09) continue; // empty seats
      const roll = rng();
      let fill: string;
      if (roll < 0.52) fill = jitter(home, rng, 0.3);
      else if (roll < 0.68) fill = jitter(alt, rng, 0.25);
      else {
        const hue = Math.floor(rng() * 360);
        fill = `hsl(${hue}, ${12 + rng() * 34}%, ${26 + rng() * 42}%)`;
      }
      const x = (col + 0.5 + (rng() - 0.5) * 0.36) * colW;
      const y = (r + 0.62 + (rng() - 0.5) * 0.16) * rowH;
      // Body.
      g.fillStyle = fill;
      g.beginPath();
      g.ellipse(x, y, colW * 0.33, rowH * 0.3, 0, 0, Math.PI * 2);
      g.fill();
      // Head. Two pixels at render scale, and the reason a smudge reads as a person.
      g.fillStyle = skin[Math.floor(rng() * skin.length)] as string;
      g.beginPath();
      g.ellipse(x, y - rowH * 0.28, colW * 0.16, rowH * 0.15, 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  // The roof shade. The back rows of a covered stand are under a roof and the front rows
  // are in the sun, and without this the far stand is the brightest, highest-contrast
  // object in the frame — which puts the eye on the crowd instead of on the football.
  // Baked into the sheet rather than lit, because the stand is one unlit plane.
  //
  // This is why the crowd texture is NOT tiled vertically (see `crowdTexture`'s caller):
  // a gradient across v repeats with the tile, and two shade bands up one terrace reads
  // as a mistake rather than as a roof.
  const shade = g.createLinearGradient(0, 0, 0, size);
  shade.addColorStop(0, 'rgba(10,16,26,0.62)');
  shade.addColorStop(0.42, 'rgba(10,16,26,0.24)');
  shade.addColorStop(0.78, 'rgba(10,16,26,0.02)');
  shade.addColorStop(1, 'rgba(255,250,235,0.10)');
  g.fillStyle = shade;
  g.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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
