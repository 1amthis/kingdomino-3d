// Procedural miniature dioramas for each terrain square.
// Coordinates are square-local: x,z in [-0.5, 0.5], y up from the tile's top face.
import * as THREE from 'three';
import { GeoBuilder, P, shade, mixColor } from './geo.js';
import { fbm2, perlin2 } from './noise.js';
import { M } from './materials.js';

export const GROUND_TOP = 0.035;
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const C = (hex) => new THREE.Color(hex);

export const CATEGORY_MATERIALS = () => ({
  ground: M.flat, solid: M.flat, sway: M.sway, swaySoft: M.swaySoft,
  lantern: M.lantern, window: M.window, crystal: M.crystal, crystalPink: M.crystalPink,
  gold: M.goldDull, water: M.water, swampWater: M.swampWater,
});

// ---------- shared helpers ----------

export function crownSlots(n) {
  return Array.from({ length: n }, (_, i) => [-0.3 + i * 0.2, -0.3]);
}

function crownAvoid(n) {
  if (!n) return [];
  return [{ x0: -0.5, x1: -0.3 + 0.2 * (n - 1) + 0.13, z0: -0.5, z1: -0.15 }];
}

function inAvoid(x, z, avoid) {
  for (const a of avoid) {
    if (a.r !== undefined) { if ((x - a.x) ** 2 + (z - a.z) ** 2 < a.r * a.r) return true; }
    else if (x > a.x0 && x < a.x1 && z > a.z0 && z < a.z1) return true;
  }
  return false;
}

function scatter(rng, n, minDist, avoid = [], margin = 0.4) {
  const pts = [];
  for (let t = 0; t < n * 40 && pts.length < n; t++) {
    const x = rng.float(-margin, margin), z = rng.float(-margin, margin);
    if (inAvoid(x, z, avoid)) continue;
    if (pts.some((p) => (p[0] - x) ** 2 + (p[1] - z) ** 2 < minDist * minDist)) continue;
    pts.push([x, z]);
  }
  return pts;
}

// A thin slab whose top is displaced by noise (fading to flat at the edges so neighbours meet).
function makeGround(b, rng, { top, side, amp = 0.012, freq = 5, base = GROUND_TOP, extra }) {
  const ox = rng.float(0, 100), oz = rng.float(0, 100);
  const h = (x, z) => {
    const e = Math.max(Math.abs(x), Math.abs(z));
    const fall = 1 - smooth(0.3, 0.455, e);
    return base + (amp * fbm2(x * freq + ox, z * freq + oz, 3) + (extra ? extra(x, z) : 0)) * fall;
  };
  const geo = new THREE.BoxGeometry(0.92, 0.04, 0.92, 9, 1, 9);
  geo.translate(0, 0.015, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0.03) pos.setY(i, h(pos.getX(i), pos.getZ(i)));
  const sideC = C(side);
  b.add('ground', geo, (x, y, z) => (y < base - 0.015 ? sideC : top(x, z, y)), { jitter: 0.035 });
  geo.dispose();
  return h;
}

function noiseMix(a, b, freq, ox, sharp = 1) {
  const ca = C(a), cb = C(b), out = new THREE.Color();
  return (x, z) => {
    const n = Math.min(1, Math.max(0, (perlin2(x * freq + ox, z * freq - ox) * sharp) * 0.5 + 0.5));
    return out.copy(ca).lerp(cb, n);
  };
}

// ---------- reusable props ----------

function pine(b, rng, x, y, z, s, greens) {
  const trunkH = 0.055 * s;
  b.add('solid', P.cyl5, '#5b3a1f', { pos: [x, y - 0.005, z], scale: [0.013 * s, trunkH, 0.013 * s] });
  const g = C(rng.pick(greens));
  const layers = rng.chance(0.3) ? 4 : 3;
  for (let i = 0; i < layers; i++) {
    const r = (0.078 - i * (0.052 / layers)) * s;
    const hh = (0.105 - i * 0.01) * s;
    const yy = y + trunkH * 0.55 + i * (0.15 / layers) * s;
    b.add('sway', P.cone6, shade(g, 0.92 + i * 0.09), { pos: [x, yy, z], rot: [0, rng.float(0, 6.28), 0], scale: [r, hh, r] });
  }
}

function roundTree(b, rng, x, y, z, s, color) {
  b.add('solid', P.cyl5, '#6a4526', { pos: [x, y - 0.005, z], scale: [0.011 * s, 0.075 * s, 0.011 * s] });
  const c = C(color);
  b.add('sway', P.ico1, c, { pos: [x, y + 0.1 * s, z], rot: [rng.float(0, 3), rng.float(0, 3), 0], scale: [0.055 * s, 0.05 * s, 0.055 * s] });
  b.add('sway', P.ico0, shade(c, 1.12), { pos: [x + 0.025 * s, y + 0.125 * s, z - 0.01 * s], scale: 0.032 * s });
  b.add('sway', P.ico0, shade(c, 0.9), { pos: [x - 0.026 * s, y + 0.085 * s, z + 0.018 * s], scale: 0.03 * s });
}

function rock(b, rng, x, y, z, s, color = '#8a857c') {
  b.add('solid', rng.chance(0.5) ? P.dodec : P.ico0, shade(color, rng.float(0.85, 1.1)), {
    pos: [x, y + 0.004 * s, z], rot: [rng.float(0, 6), rng.float(0, 6), rng.float(0, 6)], scale: [0.03 * s, 0.022 * s, 0.026 * s],
  });
}

const roofCache = new Map();
function prismRoof() {
  if (!roofCache.has('p')) {
    const g = new THREE.CylinderGeometry(1, 1, 1, 3, 1, false, Math.PI / 2);
    g.rotateZ(Math.PI / 2);
    roofCache.set('p', g);
  }
  return roofCache.get('p');
}

let smokeGeo = null, smokeMat = null;
function chimneySmoke(x, y, z, rng, objects, animators) {
  if (!smokeGeo) {
    smokeGeo = new THREE.IcosahedronGeometry(1, 1);
    smokeMat = new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 1, transparent: true, opacity: 0.55, depthWrite: false });
  }
  const group = new THREE.Group();
  const puffs = Array.from({ length: 5 }, (_, i) => {
    const m = new THREE.Mesh(smokeGeo, smokeMat);
    group.add(m);
    return { m, ph: i / 5 };
  });
  const speed = rng.float(0.18, 0.28);
  objects.push(group);
  animators.push((t) => {
    for (const p of puffs) {
      const k = (t * speed + p.ph) % 1;
      p.m.position.set(x + k * 0.05 + Math.sin(t * 2 + p.ph * 6) * 0.006, y + k * 0.2, z + k * 0.02);
      p.m.scale.setScalar(0.004 + Math.sin(Math.PI * k) * 0.018 + k * 0.006);
    }
  });
}

function cottage(b, rng, x, y, z, rotY, s = 1, objects, animators) {
  const cos = Math.cos(rotY), sin = Math.sin(rotY);
  const at = (dx, dz) => [x + dx * cos + dz * sin, z - dx * sin + dz * cos];
  const w = 0.13 * s, d = 0.085 * s, h = 0.07 * s;
  b.add('solid', P.box, '#efe2c4', { pos: [x, y + h / 2 - 0.004, z], rot: [0, rotY, 0], scale: [w, h, d] });
  // timber frame
  for (const dx of [-w / 2, 0, w / 2]) {
    const [px, pz] = at(dx, d / 2 + 0.001);
    b.add('solid', P.box, '#5a3a22', { pos: [px, y + h / 2, pz], rot: [0, rotY, 0], scale: [0.008 * s, h, 0.004] });
  }
  const roofR = 0.062 * s;
  b.add('solid', prismRoof(), rng.pick(['#9a3b26', '#8a4a2a', '#6b5a3e']), {
    pos: [x, y + h + roofR * 0.5 - 0.004, z], rot: [0, rotY, 0], scale: [w * 1.25, roofR, roofR * 1.02],
  });
  const [cx, cz] = at(w * 0.28, -d * 0.2);
  b.add('solid', P.box, '#7a6a5a', { pos: [cx, y + h + 0.035 * s, cz], rot: [0, rotY, 0], scale: [0.018 * s, 0.05 * s, 0.018 * s] });
  if (objects) chimneySmoke(cx, y + h + 0.065 * s, cz, rng, objects, animators);
  const [dx0, dz0] = at(-w * 0.2, d / 2 + 0.002);
  b.add('solid', P.box, '#3b2616', { pos: [dx0, y + 0.02 * s, dz0], rot: [0, rotY, 0], scale: [0.022 * s, 0.04 * s, 0.004] });
  for (const wx of [w * 0.18]) {
    const [wx0, wz0] = at(wx, d / 2 + 0.003);
    b.add('window', P.box, '#ffc766', { pos: [wx0, y + 0.04 * s, wz0], rot: [0, rotY, 0], scale: [0.018 * s, 0.018 * s, 0.004] });
  }
}

// ---------- animated critters & machines ----------

function makeMesh(builderFn, rng, materials) {
  const b = new GeoBuilder(rng);
  builderFn(b);
  return b.build(materials);
}

function sheep(rng, avoid, groundH) {
  const mats = CATEGORY_MATERIALS();
  const white = rng.chance(0.15) ? '#3a3330' : '#f3f0e6';
  const g = makeMesh((b) => {
    const puffs = [[0, 0.035, 0, 0.026], [0.02, 0.04, 0.008, 0.02], [-0.02, 0.038, -0.006, 0.021], [0.004, 0.05, -0.008, 0.019], [-0.01, 0.045, 0.012, 0.018]];
    for (const [px, py, pz, r] of puffs) b.add('solid', P.ico0, white, { pos: [px, py, pz], rot: [rng.float(0, 3), rng.float(0, 3), 0], scale: r });
    b.add('solid', P.box, '#2a2320', { pos: [0.036, 0.046, 0], scale: [0.022, 0.02, 0.018] });
    b.add('solid', P.box, '#2a2320', { pos: [0.03, 0.055, 0.011], rot: [0.6, 0, 0], scale: [0.006, 0.004, 0.012] });
    b.add('solid', P.box, '#2a2320', { pos: [0.03, 0.055, -0.011], rot: [-0.6, 0, 0], scale: [0.006, 0.004, 0.012] });
    for (const [lx, lz] of [[0.016, 0.01], [0.016, -0.01], [-0.016, 0.01], [-0.016, -0.01]]) {
      b.add('solid', P.box, '#2a2320', { pos: [lx, 0.012, lz], scale: [0.006, 0.024, 0.006] });
    }
  }, rng, mats);
  const state = { x: rng.float(-0.3, 0.3), z: rng.float(-0.15, 0.35), tx: 0, tz: 0, heading: rng.float(0, 6.28), wait: rng.float(0, 3), graze: 0 };
  state.tx = state.x; state.tz = state.z;
  g.scale.setScalar(1.25);
  const place = () => { g.position.set(state.x, groundH(state.x, state.z) - 0.004, state.z); g.rotation.y = -state.heading; };
  place();
  const update = (t, dt) => {
    const dx = state.tx - state.x, dz = state.tz - state.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.01) {
      state.wait -= dt;
      state.graze = Math.min(1, state.graze + dt * 2);
      if (state.wait <= 0) {
        for (let k = 0; k < 10; k++) {
          const nx = THREE.MathUtils.clamp(state.x + rng.float(-0.18, 0.18), -0.36, 0.36);
          const nz = THREE.MathUtils.clamp(state.z + rng.float(-0.18, 0.18), -0.36, 0.36);
          if (!inAvoid(nx, nz, avoid)) { state.tx = nx; state.tz = nz; break; }
        }
        state.wait = rng.float(2, 6);
      }
    } else {
      state.graze = Math.max(0, state.graze - dt * 3);
      const want = Math.atan2(dz, dx);
      let diff = want - state.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      state.heading += Math.sign(diff) * Math.min(Math.abs(diff), dt * 3);
      if (Math.abs(diff) < 0.5) {
        const sp = 0.03 * dt;
        state.x += Math.cos(state.heading) * Math.min(sp, d);
        state.z += Math.sin(state.heading) * Math.min(sp, d);
      }
    }
    place();
    g.rotation.z = -state.graze * 0.18 + Math.sin(t * 9 + state.heading) * 0.02 * (1 - state.graze);
    g.position.y += Math.abs(Math.sin(t * 12)) * 0.003 * (d > 0.01 ? 1 : 0);
  };
  return { object: g, update };
}

function windmill(b, rng, x, y, z, objects, animators) {
  const tower = new THREE.CylinderGeometry(0.038, 0.058, 0.2, 8);
  tower.translate(0, 0.1, 0);
  b.add('solid', tower, '#efe6d2', { pos: [x, y - 0.004, z] });
  tower.dispose();
  b.add('solid', P.cone8, '#7b4a2b', { pos: [x, y + 0.195, z], scale: [0.05, 0.065, 0.05] });
  b.add('solid', P.box, '#3b2616', { pos: [x, y + 0.02, z + 0.055], scale: [0.022, 0.04, 0.006] });
  b.add('window', P.box, '#ffc766', { pos: [x, y + 0.11, z + 0.047], scale: [0.014, 0.018, 0.004] });
  const blades = makeMesh((bb) => {
    bb.add('solid', P.cyl8, '#5a3a22', { pos: [0, 0, -0.012], rot: [Math.PI / 2, 0, 0], scale: [0.011, 0.024, 0.011] });
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      bb.add('solid', P.box, '#6b4a2e', { pos: [ca * 0.055, sa * 0.055, 0], rot: [0, 0, a], scale: [0.11, 0.006, 0.004] });
      bb.add('solid', P.box, '#f4ecd8', { pos: [ca * 0.066 - sa * 0.014, sa * 0.066 + ca * 0.014, 0.002], rot: [0, 0, a], scale: [0.075, 0.024, 0.002] });
    }
  }, rng, CATEGORY_MATERIALS());
  blades.position.set(x, y + 0.165, z + 0.066);
  objects.push(blades);
  const speed = rng.float(0.8, 1.4);
  animators.push((t, dt) => { blades.rotation.z -= dt * speed; });
}

function boat(rng, groundH) {
  const g = makeMesh((b) => {
    b.add('solid', P.box, '#7a4b28', { pos: [0, 0.008, 0], scale: [0.09, 0.02, 0.042] });
    b.add('solid', P.cone4, '#7a4b28', { pos: [0.045, 0.008, 0], rot: [0, Math.PI / 4, -Math.PI / 2], scale: [0.03, 0.035, 0.03] });
    b.add('solid', P.box, '#5a361c', { pos: [0, 0.019, 0], scale: [0.086, 0.004, 0.044] });
    b.add('solid', P.box, '#c8a068', { pos: [-0.005, 0.02, 0], scale: [0.012, 0.004, 0.04] });
    b.add('solid', P.cyl5, '#4a2e18', { pos: [0.005, 0.018, 0], scale: [0.003, 0.11, 0.003] });
    const sail = new THREE.BufferGeometry();
    sail.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0.09, 0, 0.055, 0.005, 0, 0, 0, 0, 0.055, 0.005, 0, 0, 0.09, 0], 3));
    b.add('solid', sail, '#f5efe0', { pos: [0.008, 0.03, 0], jitter: 0 });
    b.add('solid', P.box, '#c83a3a', { pos: [0.008, 0.132, 0.004], scale: [0.02, 0.01, 0.002] });
  }, rng, CATEGORY_MATERIALS());
  const r = rng.float(0.12, 0.2), ph = rng.float(0, 6.28), sp = rng.float(0.08, 0.14) * (rng.chance(0.5) ? 1 : -1);
  const update = (t) => {
    const a = ph + t * sp;
    g.position.set(Math.cos(a) * r * 1.2, 0.024 + Math.sin(t * 2.2 + ph) * 0.002, Math.sin(a) * r * 0.9 + 0.05);
    g.rotation.y = -a - (sp > 0 ? Math.PI / 2 : -Math.PI / 2);
    g.rotation.z = Math.sin(t * 1.9 + ph) * 0.06;
    g.rotation.x = Math.sin(t * 1.4 + ph) * 0.04;
  };
  update(0);
  return { object: g, update };
}

function duck(rng) {
  const g = makeMesh((b) => {
    b.add('solid', P.ico1, '#f7f4ea', { pos: [0, 0.008, 0], scale: [0.02, 0.013, 0.014] });
    b.add('solid', P.ico0, '#2f6b3a', { pos: [0.016, 0.024, 0], scale: 0.009 });
    b.add('solid', P.cone4, '#f2a023', { pos: [0.026, 0.023, 0], rot: [0, 0, -Math.PI / 2], scale: [0.004, 0.01, 0.004] });
    b.add('solid', P.cone4, '#e8e2d0', { pos: [-0.02, 0.012, 0], rot: [0, 0, Math.PI / 2 + 0.5], scale: [0.006, 0.012, 0.006] });
  }, rng, CATEGORY_MATERIALS());
  const cx = rng.float(-0.15, 0.2), cz = rng.float(-0.05, 0.25), r = rng.float(0.04, 0.09), ph = rng.float(0, 6.28), sp = rng.float(0.25, 0.5);
  const update = (t) => {
    const a = ph + t * sp;
    g.position.set(cx + Math.cos(a) * r, 0.026 + Math.sin(t * 3 + ph) * 0.0015, cz + Math.sin(a) * r);
    g.rotation.y = -a - Math.PI / 2;
  };
  update(0);
  return { object: g, update };
}

function jumpingFish(rng) {
  const g = makeMesh((b) => {
    b.add('solid', P.ico1, '#f08a3a', { scale: [0.018, 0.008, 0.006] });
    b.add('solid', P.cone4, '#e0662a', { pos: [-0.02, 0, 0], rot: [0, 0, Math.PI / 2], scale: [0.008, 0.012, 0.003] });
  }, rng, CATEGORY_MATERIALS());
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 20), new THREE.MeshBasicMaterial({ color: 0xdff4ff, transparent: true, opacity: 0, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  const holder = new THREE.Group();
  holder.add(g, ring);
  let next = rng.float(2, 8), start = -10, x0 = 0, z0 = 0, dir = 0;
  const update = (t) => {
    if (t > next) {
      start = t; next = t + rng.float(5, 12);
      x0 = rng.float(-0.2, 0.25); z0 = rng.float(-0.1, 0.3); dir = rng.float(0, 6.28);
    }
    const k = (t - start) / 0.9;
    if (k >= 0 && k <= 1) {
      g.visible = true;
      const d = (k - 0.5) * 0.12;
      g.position.set(x0 + Math.cos(dir) * d, 0.025 + Math.sin(k * Math.PI) * 0.09, z0 + Math.sin(dir) * d);
      g.rotation.set(0, -dir, -(k - 0.5) * 2.6);
    } else g.visible = false;
    const rk = (t - start) / 1.4;
    if (rk >= 0 && rk <= 1) {
      const land = rk < 0.3 ? 0 : 1;
      ring.position.set(x0 + Math.cos(dir) * (land ? 0.06 : -0.06), 0.03, z0 + Math.sin(dir) * (land ? 0.06 : -0.06));
      const kk = rk < 0.3 ? rk / 0.3 : (rk - 0.3) / 0.7;
      ring.scale.setScalar(0.005 + kk * 0.035);
      ring.material.opacity = (1 - kk) * 0.7;
    } else ring.material.opacity = 0;
  };
  return { object: holder, update };
}

function fireflies(rng, count) {
  const group = new THREE.Group();
  const geo = new THREE.SphereGeometry(0.0055, 6, 4);
  const bugs = [];
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(geo, M.firefly);
    const s = { m, x: rng.float(-0.35, 0.35), z: rng.float(-0.35, 0.35), y: rng.float(0.06, 0.16), ph: rng.float(0, 10), sp: rng.float(0.4, 1) };
    bugs.push(s);
    group.add(m);
  }
  const update = (t) => {
    for (const b of bugs) {
      const tt = t * b.sp + b.ph;
      b.m.position.set(b.x + Math.sin(tt * 1.3) * 0.05, b.y + Math.sin(tt * 2.1) * 0.02, b.z + Math.cos(tt * 0.9) * 0.05);
      const pulse = 0.5 + 0.5 * Math.sin(tt * 3.7);
      b.m.scale.setScalar(0.4 + pulse * 0.9);
    }
  };
  return { object: group, update };
}

// ---------- terrain recipes ----------

function buildWheat(b, rng, crowns, objects, animators) {
  const rowSpacing = 0.085;
  const gold = C('#dcb443'), soil = C('#9a7430'), out = new THREE.Color();
  const ox = rng.float(0, 50);
  const groundH = makeGround(b, rng, {
    top: (x, z) => {
      const ridge = 0.5 + 0.5 * Math.cos((z / rowSpacing) * Math.PI * 2);
      return out.copy(soil).lerp(gold, 0.35 + ridge * 0.5 + perlin2(x * 6 + ox, z * 6) * 0.15);
    },
    side: '#6d5020', amp: 0.008, freq: 4,
    extra: (x, z) => Math.cos((z / rowSpacing) * Math.PI * 2) * 0.004,
  });
  const avoid = crownAvoid(crowns);
  const roll = rng.next();
  const spots = [[0.24, 0.22], [-0.24, 0.22], [0.24, -0.2]];
  const spot = rng.pick(spots.filter(([sx, sz]) => !inAvoid(sx, sz, avoid)));
  if (roll < 0.34) {
    windmill(b, rng, spot[0], groundH(spot[0], spot[1]), spot[1], objects, animators);
    avoid.push({ x: spot[0], z: spot[1], r: 0.12 });
  } else if (roll < 0.62) {
    cottage(b, rng, spot[0], groundH(spot[0], spot[1]), spot[1], rng.pick([0, Math.PI / 2, 0.3]), 1, objects, animators);
    avoid.push({ x: spot[0], z: spot[1], r: 0.13 });
  } else if (roll < 0.85) {
    const n = rng.int(2, 3);
    for (let i = 0; i < n; i++) {
      const hx = spot[0] + rng.float(-0.07, 0.07), hz = spot[1] + rng.float(-0.07, 0.07);
      const hy = groundH(hx, hz);
      b.add('solid', P.cyl8, '#d9b64c', { pos: [hx, hy - 0.004, hz], scale: [0.034, 0.026, 0.034] });
      b.add('solid', P.cone8, '#e6c65a', { pos: [hx, hy + 0.02, hz], scale: [0.039, 0.045, 0.039] });
    }
    avoid.push({ x: spot[0], z: spot[1], r: 0.13 });
  } else {
    // scarecrow
    const [sx, sz] = spot, sy = groundH(sx, sz);
    b.add('solid', P.cyl5, '#5a3a22', { pos: [sx, sy, sz], scale: [0.004, 0.11, 0.004] });
    b.add('solid', P.box, '#5a3a22', { pos: [sx, sy + 0.08, sz], scale: [0.07, 0.005, 0.005] });
    b.add('solid', P.box, '#8a3b2a', { pos: [sx, sy + 0.07, sz], scale: [0.028, 0.035, 0.016] });
    b.add('solid', P.ico0, '#e8d49a', { pos: [sx, sy + 0.1, sz], scale: 0.013 });
    b.add('solid', P.cone6, '#6a4a2a', { pos: [sx, sy + 0.106, sz], scale: [0.02, 0.022, 0.02] });
    avoid.push({ x: sx, z: sz, r: 0.06 });
  }
  const stalkColors = ['#f0cc55', '#e7bd45', '#f5d86b', '#dcae3a'];
  for (let zi = -5; zi <= 5; zi++) {
    const z = zi * rowSpacing;
    if (Math.abs(z) > 0.43) continue;
    for (let x = -0.42; x <= 0.42; x += 0.04) {
      const jx = x + rng.float(-0.008, 0.008), jz = z + rng.float(-0.01, 0.01);
      if (inAvoid(jx, jz, avoid)) continue;
      const hh = rng.float(0.055, 0.085);
      b.add('swaySoft', P.cone5, rng.pick(stalkColors), {
        pos: [jx, groundH(jx, jz) - 0.004, jz], rot: [rng.float(-0.12, 0.12), rng.float(0, 6), rng.float(-0.12, 0.12)], scale: [0.013, hh, 0.013],
      });
    }
  }
  return groundH;
}

function buildForest(b, rng, crowns, objects, animators) {
  const ox = rng.float(0, 40);
  const moss = C('#2c5a26'), needles = C('#4b3c22'), out = new THREE.Color();
  const groundH = makeGround(b, rng, {
    top: (x, z) => out.copy(moss).lerp(needles, Math.max(0, perlin2(x * 7 + ox, z * 7) * 0.8)),
    side: '#3b2c18', amp: 0.018, freq: 4,
  });
  const avoid = crownAvoid(crowns);
  if (rng.chance(0.3)) {
    const lx = rng.float(-0.2, 0.25), lz = 0.3;
    const ly = groundH(lx, lz);
    b.add('solid', P.cyl6, '#6a4526', { pos: [lx, ly + 0.012, lz], rot: [0, rng.float(0, 3), Math.PI / 2], scale: [0.014, 0.12, 0.014] });
    b.add('solid', P.cyl6, '#8a6a42', { pos: [lx + 0.09, ly - 0.004, lz - 0.06], scale: [0.02, 0.022, 0.02] });
    avoid.push({ x: lx, z: lz, r: 0.1 });
  }
  const pts = scatter(rng, rng.int(9, 12), 0.125, avoid, 0.4);
  const greens = ['#1d5a2a', '#276b31', '#1f4f2a', '#2f7a36', '#235f33'];
  for (const [x, z] of pts) {
    const s = rng.float(0.85, 1.35);
    if (rng.chance(0.72)) pine(b, rng, x, groundH(x, z), z, s, greens);
    else roundTree(b, rng, x, groundH(x, z), z, s * 0.9, rng.chance(0.15) ? rng.pick(['#c8742a', '#d49a2a']) : rng.pick(['#4f8a35', '#3f7a2e', '#5c9a3a']));
  }
  for (let i = 0; i < 4; i++) {
    const [x, z] = [rng.float(-0.4, 0.4), rng.float(-0.4, 0.4)];
    if (inAvoid(x, z, avoid)) continue;
    const y = groundH(x, z);
    b.add('solid', P.cyl5, '#efe6d4', { pos: [x, y - 0.002, z], scale: [0.004, 0.014, 0.004] });
    b.add('solid', P.sphere, rng.chance(0.5) ? '#c8352a' : '#b98a4a', { pos: [x, y + 0.014, z], scale: [0.01, 0.006, 0.01] });
  }
  return groundH;
}

function buildLake(b, rng, crowns, objects, animators) {
  const ox = rng.float(0, 40);
  const deep = C('#154a6a'), shallow = C('#3d8b8a'), out = new THREE.Color();
  const base = 0.012;
  const groundH = makeGround(b, rng, {
    top: (x, z) => out.copy(deep).lerp(shallow, Math.max(0, perlin2(x * 5 + ox, z * 5) * 0.9 + 0.1)),
    side: '#2a3f4a', amp: 0.01, freq: 5, base,
  });
  // water slab
  const water = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.016, 0.92), M.water);
  water.position.y = 0.021;
  water.receiveShadow = true;
  water.userData.isWater = true;
  objects.push(water);
  const avoid = crownAvoid(crowns);
  const W = 0.03;
  // rocks & shore bits
  const corners = [[-0.36, 0.36], [0.36, 0.36], [0.36, -0.36], [-0.36, -0.36]].filter(([x, z]) => !inAvoid(x, z, avoid));
  const reedCorner = rng.pick(corners);
  for (let i = 0; i < 7; i++) {
    const x = reedCorner[0] + rng.float(-0.06, 0.06), z = reedCorner[1] + rng.float(-0.06, 0.06);
    b.add('sway', P.cyl5, rng.pick(['#5d7a2e', '#6f8c35', '#4f6a28']), { pos: [x, base, z], rot: [rng.float(-0.15, 0.15), 0, rng.float(-0.15, 0.15)], scale: [0.0035, rng.float(0.06, 0.1), 0.0035] });
  }
  for (let i = 0; i < rng.int(1, 3); i++) {
    const [x, z] = [rng.float(-0.35, 0.35), rng.float(-0.35, 0.35)];
    if (inAvoid(x, z, avoid)) continue;
    rock(b, rng, x, W - 0.01, z, rng.float(0.8, 1.6), '#8b8a86');
  }
  for (const [cx, cz] of scatter(rng, rng.int(2, 3), 0.18, avoid.concat([{ x: reedCorner[0], z: reedCorner[1], r: 0.1 }]), 0.36)) {
    for (let i = 0; i < rng.int(2, 4); i++) {
      const x = cx + rng.float(-0.05, 0.05), z = cz + rng.float(-0.05, 0.05);
      b.add('solid', P.cyl8, rng.pick(['#3f8a3a', '#4f9a42', '#357a33']), { pos: [x, W, z], rot: [0, rng.float(0, 6), 0], scale: [rng.float(0.022, 0.032), 0.003, rng.float(0.022, 0.032)] });
      if (rng.chance(0.45)) {
        const pc = rng.pick(['#ff9ac8', '#fff4f8', '#ffd24a']);
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          b.add('solid', P.cone4, pc, { pos: [x + Math.cos(a) * 0.006, W + 0.004, z + Math.sin(a) * 0.006], rot: [Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7], scale: [0.005, 0.012, 0.005], jitter: 0 });
        }
      }
    }
  }
  const r = rng.next();
  if (r < 0.3) { const bo = boat(rng); objects.push(bo.object); animators.push(bo.update); }
  else if (r < 0.62) {
    for (let i = 0; i < rng.int(1, 3); i++) { const d = duck(rng); objects.push(d.object); animators.push(d.update); }
  } else if (r < 0.8) {
    // little jetty
    const side = rng.chance(0.5) ? 1 : -1;
    for (let i = 0; i < 4; i++) b.add('solid', P.box, '#8a6038', { pos: [side * 0.3, 0.034, 0.44 - i * 0.045], scale: [0.07, 0.006, 0.04] });
    for (const dx of [-0.03, 0.03]) b.add('solid', P.cyl5, '#5a3a22', { pos: [side * 0.3 + dx, 0, 0.29], scale: [0.006, 0.045, 0.006] });
  } else {
    // a tiny island with a tree or a ruined watchtower
    const [ix, iz] = [rng.float(-0.1, 0.15), rng.float(-0.02, 0.15)];
    b.add('solid', P.cyl8, '#d9c48c', { pos: [ix, 0.01, iz], rot: [0, rng.float(0, 3), 0], scale: [0.12, 0.028, 0.1] });
    b.add('solid', P.cyl8, '#6fae3c', { pos: [ix, 0.036, iz], rot: [0, rng.float(0, 3), 0], scale: [0.09, 0.008, 0.075] });
    if (rng.chance(0.5)) {
      b.add('solid', P.cyl8, '#a8a092', { pos: [ix + 0.02, 0.04, iz], scale: [0.03, 0.09, 0.03] });
      b.add('solid', P.cyl8, '#8f887c', { pos: [ix + 0.02, 0.13, iz], scale: [0.034, 0.012, 0.034] });
      b.add('window', P.box, '#ffc766', { pos: [ix + 0.02, 0.1, iz + 0.029], scale: [0.01, 0.016, 0.004] });
    } else pine(b, rng, ix + 0.02, 0.044, iz, 0.9, ['#1f5a2b', '#2a6e33']);
    rock(b, rng, ix - 0.07, 0.03, iz + 0.04, 0.7, '#8b8a86');
  }
  if (rng.chance(0.45)) { const f = jumpingFish(rng); objects.push(f.object); animators.push(f.update); }
  return () => 0.03;
}

function buildGrass(b, rng, crowns, objects, animators) {
  const ox = rng.float(0, 40);
  const g1 = C('#7fbf45'), g2 = C('#a6d95c'), g3 = C('#62a23a'), out = new THREE.Color();
  const groundH = makeGround(b, rng, {
    top: (x, z) => {
      const n = perlin2(x * 5 + ox, z * 5);
      return n > 0 ? out.copy(g1).lerp(g2, n) : out.copy(g1).lerp(g3, -n);
    },
    side: '#4f6a28', amp: 0.02, freq: 3,
  });
  const avoid = crownAvoid(crowns);
  const roll = rng.next();
  if (roll < 0.3) {
    // fence along a side
    const zf = 0.4;
    for (let i = 0; i < 6; i++) {
      const x = -0.35 + i * 0.14;
      b.add('solid', P.box, '#7a5232', { pos: [x, groundH(x, zf) + 0.018, zf], scale: [0.012, 0.045, 0.012] });
    }
    for (const yy of [0.02, 0.037]) b.add('solid', P.box, '#8a6240', { pos: [0, groundH(0, zf) + yy, zf], scale: [0.72, 0.008, 0.006] });
    avoid.push({ x0: -0.5, x1: 0.5, z0: 0.35, z1: 0.5 });
  } else if (roll < 0.55) {
    const [tx, tz] = rng.pick([[0.3, 0.28], [0.3, -0.25], [-0.3, 0.3]].filter(([x, z]) => !inAvoid(x, z, avoid)));
    roundTree(b, rng, tx, groundH(tx, tz), tz, 1.25, rng.pick(['#4f8a35', '#5c9a3a']));
    avoid.push({ x: tx, z: tz, r: 0.1 });
  } else if (roll < 0.7) {
    // shepherd's well
    const [wx, wz] = [0.28, 0.27];
    const wy = groundH(wx, wz);
    b.add('solid', P.cyl8, '#9a948a', { pos: [wx, wy - 0.004, wz], scale: [0.035, 0.03, 0.035] });
    b.add('solid', P.cyl8, '#1e3b52', { pos: [wx, wy + 0.022, wz], scale: [0.026, 0.004, 0.026] });
    for (const dx of [-0.03, 0.03]) b.add('solid', P.box, '#5a3a22', { pos: [wx + dx, wy + 0.045, wz], scale: [0.006, 0.05, 0.006] });
    b.add('solid', prismRoof(), '#8a3b26', { pos: [wx, wy + 0.08, wz], scale: [0.08, 0.03, 0.035] });
    avoid.push({ x: wx, z: wz, r: 0.08 });
  }
  const greens = ['#6fb23c', '#89c84a', '#5c9a32', '#9ad556', '#4f8f2c'];
  // tufts come in little clumps so the meadow reads as long grass
  for (const [cx, cz] of scatter(rng, 26, 0.07, [], 0.41)) {
    for (let i = 0; i < rng.int(3, 5); i++) {
      const x = cx + rng.float(-0.02, 0.02), z = cz + rng.float(-0.02, 0.02);
      if (inAvoid(x, z, avoid)) continue;
      b.add('swaySoft', P.cone4, rng.pick(greens), { pos: [x, groundH(x, z) - 0.003, z], rot: [rng.float(-0.35, 0.35), rng.float(0, 6), rng.float(-0.35, 0.35)], scale: [0.008, rng.float(0.035, 0.06), 0.008] });
    }
  }
  // bushes
  for (const [x, z] of scatter(rng, rng.int(1, 3), 0.15, avoid, 0.38)) {
    const y = groundH(x, z);
    b.add('sway', P.ico1, rng.pick(['#3f7f2a', '#4a8c30']), { pos: [x, y + 0.012, z], scale: [0.034, 0.026, 0.03] });
    b.add('sway', P.ico0, '#5a9c38', { pos: [x + 0.022, y + 0.01, z + 0.01], scale: 0.02 });
    if (rng.chance(0.5)) for (let k = 0; k < 3; k++) b.add('solid', P.ico0, '#e8364a', { pos: [x + rng.float(-0.025, 0.025), y + 0.03, z + rng.float(-0.02, 0.02)], scale: 0.006, jitter: 0 });
    avoid.push({ x, z, r: 0.05 });
  }
  const petals = ['#ffffff', '#ffe14a', '#ff8fc2', '#b58cff', '#7fb8ff', '#ff6a5a'];
  // flowers grow in patches of one colour
  for (const [cx, cz] of scatter(rng, rng.int(5, 8), 0.1, avoid, 0.4)) {
    const col = rng.pick(petals);
    for (let i = 0; i < rng.int(4, 7); i++) {
      const x = cx + rng.float(-0.035, 0.035), z = cz + rng.float(-0.035, 0.035);
      if (inAvoid(x, z, avoid)) continue;
      const y = groundH(x, z);
      b.add('swaySoft', P.cyl5, '#4f8f2c', { pos: [x, y - 0.002, z], scale: [0.0025, 0.022, 0.0025] });
      b.add('swaySoft', P.ico0, col, { pos: [x, y + 0.022, z], scale: 0.0085, jitter: 0 });
    }
  }
  if (rng.chance(0.5)) for (const [x, z] of scatter(rng, 2, 0.2, avoid, 0.38)) rock(b, rng, x, groundH(x, z), z, rng.float(0.6, 1), '#9a958c');
  const nSheep = rng.int(2, 4);
  for (let i = 0; i < nSheep; i++) { const s = sheep(rng, avoid, groundH); objects.push(s.object); animators.push(s.update); }
  if (rng.chance(0.25)) {
    // a butterfly flitting over the meadow
    const bf = makeMesh((bb) => {
      const wing = new THREE.CircleGeometry(0.012, 6);
      const c = rng.pick(['#ffd23a', '#ff7ab8', '#9ad0ff']);
      bb.add('solid', wing, c, { pos: [0, 0, 0.012], rot: [-Math.PI / 2, 0, 0], jitter: 0 });
      bb.add('solid', wing, c, { pos: [0, 0, -0.012], rot: [-Math.PI / 2, 0, 0], jitter: 0 });
    }, rng, CATEGORY_MATERIALS());
    bf.traverse((o) => { if (o.material) o.material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.6 }); });
    const ph = rng.float(0, 10);
    objects.push(bf);
    animators.push((t) => {
      const a = t * 0.6 + ph;
      bf.position.set(Math.sin(a) * 0.28, 0.12 + Math.sin(t * 2.3 + ph) * 0.03, Math.sin(a * 1.7) * 0.25);
      bf.rotation.y = -a;
      bf.scale.set(1, 1, 0.3 + Math.abs(Math.sin(t * 18)) * 0.7);
    });
  }
  return groundH;
}

function buildSwamp(b, rng, crowns, objects, animators) {
  const ox = rng.float(0, 40);
  const mud = C('#5e5a30'), moss = C('#7a7a3a'), dark = C('#3f3a22'), out = new THREE.Color();
  const groundH = makeGround(b, rng, {
    top: (x, z) => {
      const n = perlin2(x * 6 + ox, z * 6);
      return n > 0 ? out.copy(mud).lerp(moss, n * 1.2) : out.copy(mud).lerp(dark, -n * 1.2);
    },
    side: '#3a321c', amp: 0.012, freq: 5,
  });
  const avoid = crownAvoid(crowns);
  // murky pools
  const pools = [];
  for (const [x, z] of scatter(rng, rng.int(2, 3), 0.25, avoid, 0.25)) {
    const r = rng.float(0.1, 0.16);
    const g = new THREE.CircleGeometry(1, 14);
    const pos = g.attributes.position;
    for (let i = 1; i < pos.count; i++) {
      const k = 1 + perlin2(pos.getX(i) * 2 + x * 10, pos.getY(i) * 2 + z * 10) * 0.35;
      pos.setXY(i, pos.getX(i) * k * r * 1.2, pos.getY(i) * k * r);
    }
    g.rotateX(-Math.PI / 2);
    g.translate(x, groundH(x, z) + 0.006, z);
    pools.push(g);
    avoid.push({ x, z, r: r * 0.9 });
  }
  if (pools.length) {
    const centers = pools.map((g) => { g.computeBoundingSphere(); return g.boundingSphere.center.clone(); });
    const merged = pools.length > 1 ? mergeCircles(pools) : pools[0];
    const mesh = new THREE.Mesh(merged, M.swampWater);
    mesh.receiveShadow = true;
    objects.push(mesh);
    // duckweed, lily pads and the odd frog
    for (const c of centers) {
      for (let i = 0; i < rng.int(2, 4); i++) {
        const x = c.x + rng.float(-0.06, 0.06), z = c.z + rng.float(-0.05, 0.05);
        b.add('solid', P.cyl8, rng.pick(['#5d7a2e', '#6d8a34']), { pos: [x, c.y + 0.002, z], scale: [rng.float(0.014, 0.022), 0.002, rng.float(0.014, 0.022)] });
      }
      if (rng.chance(0.3)) {
        const fx = c.x + 0.02, fz = c.z;
        b.add('solid', P.cyl8, '#4f7a2a', { pos: [fx, c.y + 0.002, fz], scale: [0.026, 0.002, 0.026] });
        b.add('solid', P.ico1, '#5fa83a', { pos: [fx, c.y + 0.012, fz], scale: [0.012, 0.008, 0.01] });
        b.add('solid', P.ico0, '#f2e36a', { pos: [fx + 0.008, c.y + 0.019, fz + 0.005], scale: 0.0035, jitter: 0 });
        b.add('solid', P.ico0, '#f2e36a', { pos: [fx + 0.008, c.y + 0.019, fz - 0.005], scale: 0.0035, jitter: 0 });
      }
    }
  }
  // moss mounds
  for (const [x, z] of scatter(rng, rng.int(2, 4), 0.12, avoid, 0.4)) {
    b.add('solid', P.ico1, rng.pick(['#6a7a32', '#7a8a3a', '#56662a']), { pos: [x, groundH(x, z) - 0.004, z], rot: [0, rng.float(0, 3), 0], scale: [0.035, 0.018, 0.03] });
  }
  // reeds and cattails
  for (let c = 0; c < rng.int(5, 7); c++) {
    const [cx, cz] = [rng.float(-0.38, 0.38), rng.float(-0.38, 0.38)];
    if (inAvoid(cx, cz, crownAvoid(crowns))) continue;
    for (let i = 0; i < rng.int(4, 7); i++) {
      const x = cx + rng.float(-0.035, 0.035), z = cz + rng.float(-0.035, 0.035);
      const h = rng.float(0.06, 0.11);
      const tilt = [rng.float(-0.18, 0.18), 0, rng.float(-0.18, 0.18)];
      const y = groundH(x, z);
      b.add('sway', P.cyl5, rng.pick(['#6f7a2e', '#5d6a28', '#83883a']), { pos: [x, y - 0.004, z], rot: tilt, scale: [0.003, h, 0.003] });
      if (rng.chance(0.5)) {
        const tx = x + Math.sin(tilt[2]) * -h * 0.95, tz = z + Math.sin(tilt[0]) * h * 0.95;
        b.add('sway', P.cyl6, '#5a3a1e', { pos: [tx, y + h * 0.9, tz], rot: tilt, scale: [0.0075, 0.024, 0.0075] });
      }
    }
  }
  if (rng.chance(0.85)) {
    const [tx, tz] = rng.pick([[0.28, 0.2], [-0.25, 0.28], [0.25, -0.2]].filter(([x, z]) => !inAvoid(x, z, avoid))) || [0.3, 0.3];
    const ty = groundH(tx, tz);
    const bark = '#5d5446';
    const trunk = new THREE.CylinderGeometry(0.008, 0.018, 0.17, 5);
    trunk.translate(0, 0.085, 0);
    b.add('solid', trunk, bark, { pos: [tx, ty - 0.004, tz], rot: [0.08, 0, -0.1] });
    trunk.dispose();
    for (const [a, h, l] of [[0.9, 0.11, 0.07], [-1.1, 0.13, 0.06], [2.4, 0.08, 0.05], [0.2, 0.15, 0.045]]) {
      b.add('solid', P.cyl5, bark, { pos: [tx, ty + h, tz], rot: [0, a, 0.95], scale: [0.004, l, 0.004] });
    }
    // hanging moss
    for (let i = 0; i < 3; i++) b.add('sway', P.cone4, '#7d8a4a', { pos: [tx + rng.float(-0.04, 0.04), ty + 0.1, tz + rng.float(-0.03, 0.03)], rot: [Math.PI, 0, 0], scale: [0.006, 0.035, 0.006] });
  }
  for (let i = 0; i < rng.int(2, 5); i++) {
    const [x, z] = [rng.float(-0.4, 0.4), rng.float(-0.4, 0.4)];
    if (inAvoid(x, z, avoid)) continue;
    const y = groundH(x, z);
    b.add('solid', P.cyl5, '#f0e6d0', { pos: [x, y - 0.002, z], scale: [0.004, 0.016, 0.004] });
    b.add('solid', P.sphere, rng.chance(0.6) ? '#d0342a' : '#c9a24a', { pos: [x, y + 0.016, z], scale: [0.012, 0.007, 0.012] });
  }
  const ff = fireflies(rng, rng.int(5, 8));
  objects.push(ff.object); animators.push(ff.update);
  return groundH;
}

function mergeCircles(list) {
  // CircleGeometry is indexed with identical attributes, so a manual merge is simple
  const pos = [], nor = [], uv = [], idx = [];
  let off = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(p.getX(i) * 2, p.getZ(i) * 2);
    }
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i++) idx.push(ix[i] + off);
    off += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

function mountain(b, rng, x, y, z, r, h) {
  const g = new THREE.ConeGeometry(r, h, 8, 5);
  g.translate(0, h / 2, 0);
  const pos = g.attributes.position;
  const seed = rng.float(0, 100);
  // Displace radially with noise; the base ring and the apex stay put so the cone keeps its footprint.
  // Seam vertices share coordinates, so they receive identical offsets and no cracks appear.
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    const a = Math.atan2(pz, px);
    const n = perlin2(Math.cos(a) * 1.5 + seed, py * 9 + Math.sin(a) * 1.5);
    const k = py > 0.001 && py < h - 0.001 ? 1 + n * 0.2 : 1;
    pos.setXYZ(i, px * k, py * (1 + (py > 0.001 ? perlin2(seed, a) * 0.08 : 0)), pz * k);
  }
  const rockDark = C('#4d4744'), rockLight = C('#7d7570'), snow = C('#f5f6fa'), out = new THREE.Color();
  b.add('solid', g, (px, py) => {
    const t = (py - y) / h;
    if (t > 0.72 + perlin2(px * 30, seed) * 0.06) return snow;
    return out.copy(rockDark).lerp(rockLight, Math.min(1, t * 1.3));
  }, { pos: [x, y - 0.006, z], rot: [0, rng.float(0, 6), 0], jitter: 0.1 });
  g.dispose();
}

function buildMine(b, rng, crowns, objects, animators) {
  const ox = rng.float(0, 40);
  const g1 = C('#4a4541'), g2 = C('#5f5750'), out = new THREE.Color();
  const groundH = makeGround(b, rng, {
    top: (x, z) => out.copy(g1).lerp(g2, perlin2(x * 9 + ox, z * 9) * 0.5 + 0.5),
    side: '#2e2a27', amp: 0.02, freq: 5,
  });
  const avoid = crownAvoid(crowns);
  const mx = crowns ? 0.14 : rng.float(-0.12, 0.05), mz = crowns ? 0.0 : -0.1;
  const mr = rng.float(0.22, 0.26);
  mountain(b, rng, mx, groundH(mx, mz), mz, mr, rng.float(0.38, 0.46));
  const sx = mx > 0 ? -0.24 : 0.27, sz = crowns ? 0.1 : -0.22;
  mountain(b, rng, sx, groundH(sx, sz), sz, rng.float(0.12, 0.16), rng.float(0.2, 0.27));
  // a rocky outcrop in front of the peak houses the timbered mine portal
  const ex = mx, ez = mz + mr * 0.95, ey = groundH(ex, ez);
  b.add('solid', P.dodec, '#5b5450', { pos: [ex, ey + 0.02, ez - 0.045], rot: [0.3, 0.4, 0], scale: [0.09, 0.08, 0.065] });
  b.add('solid', P.box, '#070505', { pos: [ex, ey + 0.034, ez + 0.012], scale: [0.058, 0.066, 0.02] });
  b.add('solid', P.box, '#6b4526', { pos: [ex - 0.034, ey + 0.035, ez + 0.026], scale: [0.012, 0.072, 0.012] });
  b.add('solid', P.box, '#6b4526', { pos: [ex + 0.034, ey + 0.035, ez + 0.026], scale: [0.012, 0.072, 0.012] });
  b.add('solid', P.box, '#7a5030', { pos: [ex, ey + 0.074, ez + 0.026], scale: [0.09, 0.014, 0.016] });
  // rails
  for (let i = 0; i < 4; i++) b.add('solid', P.box, '#5a3e26', { pos: [ex, ey + 0.001, ez + 0.05 + i * 0.04], scale: [0.05, 0.005, 0.01] });
  for (const dx of [-0.015, 0.015]) b.add('solid', P.box, '#8a8a92', { pos: [ex + dx, ey + 0.006, ez + 0.11], scale: [0.004, 0.004, 0.15] });
  // cart with gold
  const cz = ez + 0.12, cy = ey + 0.012;
  b.add('solid', P.box, '#3a3432', { pos: [ex, cy + 0.018, cz], scale: [0.045, 0.028, 0.06] });
  for (const [dx, dz] of [[-0.024, 0.02], [0.024, 0.02], [-0.024, -0.02], [0.024, -0.02]]) {
    b.add('solid', P.cyl8, '#222', { pos: [ex + dx, cy + 0.006, cz + dz], rot: [0, 0, Math.PI / 2], scale: [0.009, 0.006, 0.009] });
  }
  for (let i = 0; i < 6; i++) b.add('gold', P.ico0, '#ffcc44', { pos: [ex + rng.float(-0.014, 0.014), cy + 0.036, cz + rng.float(-0.02, 0.02)], rot: [rng.float(0, 3), rng.float(0, 3), 0], scale: 0.01 });
  // lantern post
  const lx = ex + 0.065, lz = ez + 0.03, ly = groundH(lx, lz);
  b.add('solid', P.box, '#4a3020', { pos: [lx, ly + 0.035, lz], scale: [0.006, 0.075, 0.006] });
  b.add('solid', P.box, '#4a3020', { pos: [lx - 0.01, ly + 0.072, lz], scale: [0.022, 0.005, 0.005] });
  b.add('lantern', P.box, '#ffa53a', { pos: [lx - 0.018, ly + 0.058, lz], scale: [0.012, 0.016, 0.012] });
  // crystals
  for (const [x, z] of scatter(rng, rng.int(2, 3), 0.12, avoid.concat([{ x: mx, z: mz, r: 0.2 }, { x: ex, z: ez + 0.12, r: 0.1 }]), 0.4)) {
    const cat = rng.chance(0.7) ? 'crystal' : 'crystalPink';
    const y = groundH(x, z);
    for (let i = 0; i < rng.int(2, 4); i++) {
      b.add(cat, P.octa, '#ffffff', { pos: [x + rng.float(-0.015, 0.015), y + 0.012, z + rng.float(-0.015, 0.015)], rot: [rng.float(-0.4, 0.4), rng.float(0, 3), rng.float(-0.4, 0.4)], scale: [0.009, rng.float(0.025, 0.04), 0.009], jitter: 0 });
    }
  }
  for (let i = 0; i < 5; i++) {
    const [x, z] = [rng.float(-0.4, 0.4), rng.float(0.1, 0.42)];
    if (!inAvoid(x, z, avoid) && Math.abs(x - ex) > 0.06) rock(b, rng, x, groundH(x, z), z, rng.float(0.5, 1), '#6d6660');
  }
  return groundH;
}

const RECIPES = { wheat: buildWheat, forest: buildForest, lake: buildLake, grass: buildGrass, swamp: buildSwamp, mine: buildMine };

// Returns the geometry (in builder), extra objects and animation callbacks for one square.
export function buildSquare(terrain, crowns, rng) {
  const b = new GeoBuilder(rng);
  const objects = [], animators = [];
  const groundH = RECIPES[terrain](b, rng, crowns, objects, animators);
  return { builder: b, objects, animators, groundH };
}
