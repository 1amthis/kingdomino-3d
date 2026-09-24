// Compact 2D/3D value + gradient noise helpers used by textures and terrain.
import { mulberry32 } from '../core/rng.js';

const perm = new Uint8Array(512);
{
  const r = mulberry32(1337);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}

const grad2 = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

// Classic 2D Perlin noise in [-1, 1].
export function perlin2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const X = xi & 255, Y = yi & 255;
  const g = (ix, iy, dx, dy) => {
    const h = grad2[perm[ix + perm[iy]] & 7];
    return h[0] * dx + h[1] * dy;
  };
  const u = fade(xf), v = fade(yf);
  const n00 = g(X, Y, xf, yf), n10 = g(X + 1, Y, xf - 1, yf);
  const n01 = g(X, Y + 1, xf, yf - 1), n11 = g(X + 1, Y + 1, xf - 1, yf - 1);
  const a = n00 + u * (n10 - n00), b = n01 + u * (n11 - n01);
  return (a + v * (b - a)) * 1.4;
}

export function fbm2(x, y, oct = 4, lac = 2, gain = 0.5) {
  let amp = 1, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * perlin2(x * f, y * f);
    norm += amp; amp *= gain; f *= lac;
  }
  return sum / norm;
}
