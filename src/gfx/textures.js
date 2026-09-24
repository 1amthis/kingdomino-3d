// Procedurally painted canvas textures: table wood, felt, tile backs, water normals, sprites.
import * as THREE from 'three';
import { perlin2, fbm2 } from './noise.js';
import { mulberry32 } from '../core/rng.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function toTexture(c, { srgb = true, repeat = false, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// Long varnished planks with warped growth rings, fibres, knots and joints.
export function makeTableTextures(w = 2048, h = 1024) {
  const cc = canvas(w, h), bc = canvas(w, h);
  const cx = cc.getContext('2d'), bx = bc.getContext('2d');
  const col = cx.createImageData(w, h), bump = bx.createImageData(w, h);
  const rng = mulberry32(99);
  const planks = 8, ph = h / planks;
  const P = Array.from({ length: planks }, () => ({
    tone: 0.82 + rng() * 0.32,
    warm: rng() * 0.12,
    off: rng() * 500,
    joint: w * (0.25 + rng() * 0.5),
    knots: Array.from({ length: 2 }, () => ({ x: rng() * w, y: rng(), r: 6 + rng() * 10 })),
  }));
  const dark = [46, 28, 17], light = [128, 84, 50];
  for (let y = 0; y < h; y++) {
    const pi = Math.min(planks - 1, Math.floor(y / ph));
    const p = P[pi];
    const v = (y - pi * ph) / ph;
    for (let x = 0; x < w; x++) {
      const seg = x < p.joint ? 0 : 1;
      const off = p.off + seg * 211;
      let yy = y;
      // knots pull the grain around them
      for (const k of p.knots) {
        const dx = (x - k.x) / (k.r * 3.5), dy = (y - (pi + k.y) * ph) / k.r;
        const d2 = dx * dx + dy * dy;
        if (d2 < 9) yy += (Math.exp(-d2) * 14) * Math.sign(dy || 1);
      }
      const warp = fbm2(x * 0.0012 + off, yy * 0.01, 3);
      const rings = yy * 0.11 + warp * 3.2 + perlin2(x * 0.004 + off, yy * 0.05) * 0.8;
      const band = rings - Math.floor(rings);
      const ring = smooth(0.55, 0.95, band) * (1 - smooth(0.95, 1, band));
      const fib = perlin2(x * 0.7 + off, yy * 0.08) * 0.5 + 0.5;
      let t = 0.55 + 0.25 * warp - 0.35 * ring + 0.12 * (fib - 0.5);
      let edge = 1;
      if (v < 0.012 || v > 0.988) edge = 0.35;
      else if (v < 0.03 || v > 0.97) edge = 0.75;
      if (Math.abs(x - p.joint) < 1.5) edge = Math.min(edge, 0.4);
      for (const k of p.knots) {
        const dx = (x - k.x) / k.r, dy = (y - (pi + k.y) * ph) / (k.r * 0.6);
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1.4) t -= (1.4 - d) * 0.35 * (0.6 + 0.4 * Math.sin(d * 14));
      }
      t = Math.min(1.1, Math.max(0, t)) * p.tone;
      const i = (y * w + x) * 4;
      col.data[i] = Math.min(255, lerp(dark[0], light[0], t) * edge * (1 + p.warm));
      col.data[i + 1] = Math.min(255, lerp(dark[1], light[1], t) * edge);
      col.data[i + 2] = Math.min(255, lerp(dark[2], light[2], t) * edge * (1 - p.warm));
      col.data[i + 3] = 255;
      const b = Math.max(0, Math.min(255, (0.6 - ring * 0.25 + (fib - 0.5) * 0.15) * 255 * (edge < 1 ? edge * 0.6 : 1)));
      bump.data[i] = bump.data[i + 1] = bump.data[i + 2] = b;
      bump.data[i + 3] = 255;
    }
  }
  cx.putImageData(col, 0, 0);
  bx.putImageData(bump, 0, 0);
  return { map: toTexture(cc, { aniso: 16 }), bump: toTexture(bc, { srgb: false, aniso: 16 }) };
}

// Fine fibrous noise that tiles; used for felt mats and cloth.
export function makeFeltTexture(size = 512) {
  const c = canvas(size, size);
  const x = c.getContext('2d');
  const img = x.createImageData(size, size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const n = Math.random() * 0.35 + 0.65;
      const k = (j * size + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = n * 255;
      img.data[k + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  x.globalAlpha = 0.08;
  for (let s = 0; s < 5000; s++) {
    const px = Math.random() * size, py = Math.random() * size, a = Math.random() * Math.PI, l = 3 + Math.random() * 8;
    x.strokeStyle = Math.random() < 0.5 ? '#000' : '#fff';
    x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke();
  }
  return toTexture(c, { repeat: true, srgb: false });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function goldGradient(ctx, y0, y1) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, '#fff2b0');
  g.addColorStop(0.45, '#e2b54a');
  g.addColorStop(0.55, '#b9832a');
  g.addColorStop(1, '#f6d77a');
  return g;
}

function drawCrownIcon(ctx, cx, cy, s, fill) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(-1, 0.6); ctx.lineTo(-1, -0.4); ctx.lineTo(-0.5, 0.05); ctx.lineTo(0, -0.7);
  ctx.lineTo(0.5, 0.05); ctx.lineTo(1, -0.4); ctx.lineTo(1, 0.6); ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  ctx.restore();
}

// Royal-blue tile back with a gilded frame and the tile number.
export function makeBackTexture(id) {
  const W = 512, H = 256;
  const c = canvas(W, H);
  const x = c.getContext('2d');
  const bg = x.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, W * 0.6);
  bg.addColorStop(0, '#2c4a8e');
  bg.addColorStop(1, '#0d1838');
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  // damask pattern
  x.globalAlpha = 0.09;
  x.fillStyle = '#9fb8ff';
  for (let j = 0; j < 6; j++) for (let i = 0; i < 12; i++) {
    const px = i * 46 + (j % 2) * 23, py = j * 46 + 10;
    x.beginPath(); x.moveTo(px, py - 9); x.lineTo(px + 7, py); x.lineTo(px, py + 9); x.lineTo(px - 7, py); x.closePath(); x.fill();
  }
  x.globalAlpha = 1;
  x.lineWidth = 7; x.strokeStyle = goldGradient(x, 0, H);
  roundRect(x, 14, 14, W - 28, H - 28, 18); x.stroke();
  x.lineWidth = 2;
  roundRect(x, 28, 28, W - 56, H - 56, 10); x.stroke();
  // corner studs
  for (const [px, py] of [[34, 34], [W - 34, 34], [34, H - 34], [W - 34, H - 34]]) {
    x.fillStyle = goldGradient(x, py - 8, py + 8);
    x.beginPath(); x.arc(px, py, 7, 0, Math.PI * 2); x.fill();
  }
  // number medallion
  x.fillStyle = 'rgba(0,0,0,0.25)';
  x.beginPath(); x.ellipse(W / 2, H / 2 + 4, 92, 86, 0, 0, Math.PI * 2); x.fill();
  x.lineWidth = 4; x.strokeStyle = goldGradient(x, H / 2 - 80, H / 2 + 80);
  x.beginPath(); x.ellipse(W / 2, H / 2, 88, 82, 0, 0, Math.PI * 2); x.stroke();
  drawCrownIcon(x, W / 2, H / 2 - 58, 20, goldGradient(x, H / 2 - 75, H / 2 - 45));
  x.font = '700 104px Cinzel, Georgia, serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = 'rgba(0,0,0,0.5)';
  x.fillText(String(id), W / 2 + 3, H / 2 + 22);
  x.fillStyle = goldGradient(x, H / 2 - 30, H / 2 + 60);
  x.fillText(String(id), W / 2, H / 2 + 18);
  // side laurels
  x.strokeStyle = goldGradient(x, 60, H - 60); x.lineWidth = 3;
  for (const side of [-1, 1]) {
    const bx = W / 2 + side * 165;
    x.beginPath(); x.moveTo(bx, H / 2 - 50); x.quadraticCurveTo(bx + side * 30, H / 2, bx, H / 2 + 50); x.stroke();
    for (let k = -2; k <= 2; k++) {
      const ly = H / 2 + k * 20;
      x.beginPath(); x.ellipse(bx + side * (12 - Math.abs(k) * 3), ly, 10, 4, side * 0.6, 0, Math.PI * 2);
      x.fillStyle = goldGradient(x, ly - 5, ly + 5); x.fill();
    }
  }
  return toTexture(c);
}

// Tileable normal map from a sum of integer-frequency waves.
export function makeWaterNormal(size = 256, seed = 3) {
  const rng = mulberry32(seed);
  const waves = Array.from({ length: 14 }, (_, i) => ({
    kx: Math.round((rng() * 2 - 1) * (2 + i)), ky: Math.round((rng() * 2 - 1) * (2 + i)),
    a: 1 / (1 + i * 0.6), ph: rng() * Math.PI * 2,
  })).filter((w) => w.kx || w.ky);
  const hgt = new Float32Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let s = 0;
    const u = i / size, v = j / size;
    for (const w of waves) s += w.a * Math.sin(2 * Math.PI * (w.kx * u + w.ky * v) + w.ph);
    hgt[j * size + i] = s;
  }
  const c = canvas(size, size);
  const x = c.getContext('2d');
  const img = x.createImageData(size, size);
  const at = (i, j) => hgt[((j + size) % size) * size + ((i + size) % size)];
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const dx = (at(i + 1, j) - at(i - 1, j)) * 0.6;
    const dy = (at(i, j + 1) - at(i, j - 1)) * 0.6;
    const l = Math.hypot(dx, dy, 1);
    const k = (j * size + i) * 4;
    img.data[k] = (-dx / l * 0.5 + 0.5) * 255;
    img.data[k + 1] = (-dy / l * 0.5 + 0.5) * 255;
    img.data[k + 2] = (1 / l * 0.5 + 0.5) * 255;
    img.data[k + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return toTexture(c, { srgb: false, repeat: true });
}

export function makeGlowSprite(size = 64, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = canvas(size, size);
  const x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, inner.replace(/[\d.]+\)$/, '0.45)'));
  g.addColorStop(1, outer);
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  return toTexture(c);
}

// Player kingdom mat: dyed felt, gilded double border with the house colour, corner crests.
export function makeMatTexture(colorHex, name, px = 1024) {
  const c = canvas(px, px);
  const x = c.getContext('2d');
  const SRGB = THREE.SRGBColorSpace;
  const base = new THREE.Color(colorHex);
  const hsl = {}; base.getHSL(hsl, SRGB);
  const felt = new THREE.Color().setHSL(hsl.h, Math.min(0.42, hsl.s * 0.5), 0.14, SRGB);
  const feltHi = new THREE.Color().setHSL(hsl.h, Math.min(0.42, hsl.s * 0.5), 0.2, SRGB);
  const g = x.createRadialGradient(px / 2, px / 2, px * 0.1, px / 2, px / 2, px * 0.75);
  g.addColorStop(0, '#' + feltHi.getHexString(SRGB));
  g.addColorStop(1, '#' + felt.getHexString(SRGB));
  x.fillStyle = g; x.fillRect(0, 0, px, px);
  // subtle brocade
  x.globalAlpha = 0.05; x.strokeStyle = '#ffe9b8'; x.lineWidth = 2;
  const step = px / 18;
  for (let j = 0; j < 19; j++) for (let i = 0; i < 19; i++) {
    const cx0 = i * step, cy0 = j * step;
    x.beginPath(); x.arc(cx0, cy0, step * 0.28, 0, Math.PI * 2); x.stroke();
    x.beginPath(); x.moveTo(cx0 - step * 0.5, cy0); x.lineTo(cx0, cy0 - step * 0.5); x.lineTo(cx0 + step * 0.5, cy0); x.lineTo(cx0, cy0 + step * 0.5); x.closePath(); x.stroke();
  }
  x.globalAlpha = 1;
  const m = px * 0.035;
  x.lineWidth = px * 0.012; x.strokeStyle = goldGradient(x, 0, px);
  roundRect(x, m, m, px - 2 * m, px - 2 * m, px * 0.04); x.stroke();
  x.lineWidth = px * 0.016; x.strokeStyle = colorHex;
  roundRect(x, m * 1.8, m * 1.8, px - 3.6 * m, px - 3.6 * m, px * 0.03); x.stroke();
  x.lineWidth = px * 0.004; x.strokeStyle = goldGradient(x, 0, px);
  roundRect(x, m * 2.45, m * 2.45, px - 4.9 * m, px - 4.9 * m, px * 0.025); x.stroke();
  // stitched dashes
  x.setLineDash([px * 0.012, px * 0.01]); x.lineWidth = px * 0.003; x.strokeStyle = 'rgba(255,235,180,0.55)';
  roundRect(x, m * 1.25, m * 1.25, px - 2.5 * m, px - 2.5 * m, px * 0.035); x.stroke();
  x.setLineDash([]);
  for (const [px0, py0] of [[m * 1.8, m * 1.8], [px - m * 1.8, m * 1.8], [m * 1.8, px - m * 1.8], [px - m * 1.8, px - m * 1.8]]) {
    x.fillStyle = goldGradient(x, py0 - 20, py0 + 20);
    x.beginPath(); x.arc(px0, py0, px * 0.022, 0, Math.PI * 2); x.fill();
    x.fillStyle = colorHex;
    x.beginPath(); x.arc(px0, py0, px * 0.013, 0, Math.PI * 2); x.fill();
  }
  // embroidered name along the bottom border
  if (name) {
    x.font = `700 ${Math.round(px * 0.03)}px Cinzel, Georgia, serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const tw = x.measureText(name.toUpperCase()).width + px * 0.05;
    x.fillStyle = '#' + felt.getHexString(SRGB);
    x.fillRect(px / 2 - tw / 2, px - m * 2.4, tw, m * 1.3);
    x.fillStyle = goldGradient(x, px - m * 2.2, px - m * 1.2);
    x.fillText(name.toUpperCase(), px / 2, px - m * 1.75);
  }
  return toTexture(c, { aniso: 16 });
}

// The central drafting board: crimson velvet runner with two columns of gilded slots.
export function makeDraftTexture(slots, W = 1024, H = 1024) {
  const c = canvas(W, H);
  const x = c.getContext('2d');
  const g = x.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, W * 0.7);
  g.addColorStop(0, '#7a1a22');
  g.addColorStop(1, '#3a080d');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.globalAlpha = 0.06;
  for (let i = 0; i < 9000; i++) {
    x.fillStyle = Math.random() < 0.5 ? '#000' : '#ff9a9a';
    x.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  x.globalAlpha = 1;
  const m = 26;
  x.lineWidth = 10; x.strokeStyle = goldGradient(x, 0, H);
  roundRect(x, m, m, W - 2 * m, H - 2 * m, 30); x.stroke();
  x.lineWidth = 3;
  roundRect(x, m + 18, m + 18, W - 2 * m - 36, H - 2 * m - 36, 20); x.stroke();
  // column headers
  x.font = '700 34px Cinzel, Georgia, serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = goldGradient(x, 70, 110);
  x.fillText('THIS ROUND', W * 0.28, 92);
  x.fillText('NEXT ROUND', W * 0.72, 92);
  // slot engravings (slots are given in UV space 0..1)
  x.setLineDash([14, 10]);
  x.lineWidth = 3; x.strokeStyle = 'rgba(240,200,120,0.55)';
  for (const s of slots) {
    roundRect(x, s.u0 * W, s.v0 * H, (s.u1 - s.u0) * W, (s.v1 - s.v0) * H, 12); x.stroke();
  }
  x.setLineDash([]);
  // arrow between columns
  x.fillStyle = goldGradient(x, H / 2 - 30, H / 2 + 30);
  x.beginPath(); x.moveTo(W / 2 - 22, H / 2 - 26); x.lineTo(W / 2 + 18, H / 2); x.lineTo(W / 2 - 22, H / 2 + 26); x.closePath(); x.fill();
  return toTexture(c, { aniso: 16 });
}

// Pale oak with fine grain for the domino bodies.
export function makeTileWoodTexture(w = 512, h = 256) {
  const c = canvas(w, h);
  const x = c.getContext('2d');
  const img = x.createImageData(w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const warp = fbm2(i * 0.004, j * 0.03, 3) * 4;
    const ring = Math.sin(j * 0.22 + warp * 3) * 0.5 + 0.5;
    const fib = perlin2(i * 0.35, j * 0.09) * 0.5 + 0.5;
    const t = 0.78 + ring * 0.12 + fib * 0.1;
    const k = (j * w + i) * 4;
    img.data[k] = 222 * t; img.data[k + 1] = 186 * t; img.data[k + 2] = 138 * t; img.data[k + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return toTexture(c);
}

// Cobblestone courtyard used on the castle tile.
export function makeCobbleTexture(size = 256) {
  const c = canvas(size, size);
  const x = c.getContext('2d');
  x.fillStyle = '#6d6a63'; x.fillRect(0, 0, size, size);
  const rng = mulberry32(5);
  for (let j = 0; j < 9; j++) for (let i = 0; i < 9; i++) {
    const cx0 = (i + 0.5 + (j % 2) * 0.5) * size / 9, cy0 = (j + 0.5) * size / 9;
    const l = 120 + rng() * 60;
    x.fillStyle = `rgb(${l},${l - 4},${l - 12})`;
    x.beginPath(); x.ellipse(cx0, cy0, size / 22, size / 26, rng() * 3, 0, Math.PI * 2); x.fill();
  }
  return toTexture(c);
}
