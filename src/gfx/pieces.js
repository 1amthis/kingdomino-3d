// Hand-modelled (procedurally) game pieces: crowns, castles, king meeples, candles, table props.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GeoBuilder, P } from './geo.js';
import { M, playerMaterial, flatPlayerMaterial } from './materials.js';
import { Rng } from '../core/rng.js';

export const TILE_H = 0.16;

let crownGeo = null, crownGemGeo = null;
export function crownGeometries() {
  if (crownGeo) return { gold: crownGeo, gems: crownGemGeo };
  const parts = [];
  const band = new THREE.CylinderGeometry(0.058, 0.05, 0.045, 20, 1, true);
  band.translate(0, 0.0225, 0);
  parts.push(band);
  const rimB = new THREE.TorusGeometry(0.051, 0.007, 6, 24); rimB.rotateX(Math.PI / 2); parts.push(rimB);
  const rimT = new THREE.TorusGeometry(0.058, 0.0055, 6, 24); rimT.rotateX(Math.PI / 2); rimT.translate(0, 0.045, 0); parts.push(rimT);
  const gems = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const c = new THREE.ConeGeometry(0.019, 0.05, 6);
    c.translate(0, 0.025, 0);
    c.rotateX(-0.12);
    c.rotateY(-a + Math.PI / 2);
    c.translate(Math.cos(a) * 0.056, 0.045, Math.sin(a) * 0.056);
    parts.push(c);
    const s = new THREE.SphereGeometry(0.009, 8, 6);
    s.translate(Math.cos(a) * 0.06, 0.098, Math.sin(a) * 0.06);
    parts.push(s);
    const g = new THREE.OctahedronGeometry(0.011, 0);
    g.scale(1, 1.3, 0.6);
    const b = a + Math.PI / 5;
    g.rotateY(-b + Math.PI / 2);
    g.translate(Math.cos(b) * 0.056, 0.023, Math.sin(b) * 0.056);
    gems.push(g);
  }
  const inner = new THREE.SphereGeometry(0.048, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  inner.translate(0, 0.02, 0);
  parts.push(inner);
  crownGeo = mergeGeometries(parts.map((p) => { p.deleteAttribute('uv'); return p; }), false);
  crownGemGeo = mergeGeometries(gems.map((g) => { g.deleteAttribute('uv'); return g; }), false);
  return { gold: crownGeo, gems: crownGemGeo };
}

export function makeCrown(scale = 1) {
  const { gold, gems } = crownGeometries();
  const g = new THREE.Group();
  const m = new THREE.Mesh(gold, M.gold);
  m.castShadow = true;
  const inner = new THREE.Mesh(gems, M.ruby);
  g.add(m, inner);
  g.scale.setScalar(scale);
  return g;
}

let tileBaseGeo = null, castleBaseGeo = null;
export function dominoBaseGeometry() {
  if (!tileBaseGeo) {
    tileBaseGeo = new RoundedBoxGeometry(1.96, TILE_H, 0.96, 3, 0.035);
    tileBaseGeo.translate(0, -TILE_H / 2, 0);
  }
  return tileBaseGeo;
}

function castleBaseGeometry() {
  if (!castleBaseGeo) {
    castleBaseGeo = new RoundedBoxGeometry(0.96, TILE_H, 0.96, 3, 0.035);
    castleBaseGeo.translate(0, -TILE_H / 2, 0);
  }
  return castleBaseGeo;
}

// A little flag whose vertices ripple every frame.
function makeFlag(colorHex, w = 0.14, h = 0.085) {
  const geo = new THREE.PlaneGeometry(w, h, 10, 2);
  geo.translate(w / 2, 0, 0);
  const base = geo.attributes.position.array.slice();
  const mat = new THREE.MeshStandardMaterial({ color: colorHex, side: THREE.DoubleSide, roughness: 0.7 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  const ph = Math.random() * 10;
  const update = (t) => {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3], y = base[i * 3 + 1];
      const k = x / w;
      pos.setZ(i, Math.sin(x * 38 - t * 6 + ph) * 0.012 * k + Math.sin(x * 20 - t * 3.3) * 0.006 * k);
      pos.setY(i, y - k * k * 0.01 + Math.sin(x * 30 - t * 5 + ph) * 0.003 * k);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  };
  return { mesh, update };
}

export function buildCastle(colorHex, seed = 1) {
  const rng = new Rng(seed);
  const group = new THREE.Group();
  const base = new THREE.Mesh(castleBaseGeometry(), M.wood);
  base.castShadow = base.receiveShadow = true;
  group.add(base);
  const b = new GeoBuilder(rng);
  // grassy plinth with a cobbled court
  const plinth = new THREE.BoxGeometry(0.92, 0.035, 0.92, 4, 1, 4);
  plinth.translate(0, 0.0125, 0);
  b.add('ground', plinth, (x, y) => (y < 0.01 ? new THREE.Color('#4f6a28') : new THREE.Color('#7fbf45')), { jitter: 0.05 });
  b.add('ground', P.box, '#9c968a', { pos: [0, 0.031, 0.02], scale: [0.58, 0.006, 0.6], jitter: 0.08 });
  b.add('ground', P.box, '#a8a294', { pos: [0, 0.031, 0.4], scale: [0.12, 0.006, 0.16], jitter: 0.08 });
  const stone = '#c2b9a6', stoneDark = '#9d9483';
  const y0 = 0.03;
  // curtain walls with merlons
  const half = 0.3, wallH = 0.13, th = 0.05;
  const walls = [
    { cx: 0, cz: -half, sx: 2 * half, sz: th }, { cx: 0, cz: half, sx: 2 * half, sz: th, gate: true },
    { cx: -half, cz: 0, sx: th, sz: 2 * half }, { cx: half, cz: 0, sx: th, sz: 2 * half },
  ];
  for (const w of walls) {
    b.add('solid', P.box, stone, { pos: [w.cx, y0 + wallH / 2, w.cz], scale: [w.sx, wallH, w.sz], jitter: 0.04 });
    const along = w.sx > w.sz ? 'x' : 'z';
    const len = Math.max(w.sx, w.sz);
    const n = 7;
    for (let i = 0; i < n; i++) {
      const o = -len / 2 + (i + 0.5) * (len / n);
      const px = along === 'x' ? w.cx + o : w.cx, pz = along === 'z' ? w.cz + o : w.cz;
      b.add('solid', P.box, stoneDark, { pos: [px, y0 + wallH + 0.012, pz], scale: [along === 'x' ? 0.045 : th * 1.05, 0.024, along === 'z' ? 0.045 : th * 1.05] });
    }
  }
  // gatehouse
  b.add('solid', P.box, stone, { pos: [0, y0 + 0.09, half], scale: [0.16, 0.18, 0.08] });
  b.add('solid', P.box, '#241810', { pos: [0, y0 + 0.045, half + 0.041], scale: [0.07, 0.09, 0.004] });
  b.add('solid', P.cyl12, '#241810', { pos: [0, y0 + 0.09, half + 0.041], rot: [Math.PI / 2, 0, 0], scale: [0.035, 0.004, 0.035] });
  for (let i = -2; i <= 2; i++) b.add('solid', P.box, '#555', { pos: [i * 0.012, y0 + 0.06, half + 0.044], scale: [0.003, 0.08, 0.003] });
  for (const dx of [-0.06, 0, 0.06]) b.add('solid', P.box, stoneDark, { pos: [dx, y0 + 0.19, half], scale: [0.035, 0.024, 0.085] });
  // drawbridge path
  b.add('solid', P.box, '#7a5232', { pos: [0, y0 + 0.004, half + 0.1], scale: [0.08, 0.006, 0.12] });
  // corner towers
  const towerTops = [];
  for (const [tx, tz] of [[-half, -half], [half, -half], [-half, half], [half, half]]) {
    const th2 = 0.25;
    b.add('solid', P.cyl8, stone, { pos: [tx, y0, tz], scale: [0.068, th2, 0.068], jitter: 0.04 });
    b.add('solid', P.cyl8, stoneDark, { pos: [tx, y0 + th2, tz], scale: [0.078, 0.022, 0.078] });
    b.add('window', P.box, '#ffc766', { pos: [tx + (tx > 0 ? 0.001 : -0.001), y0 + 0.17, tz + (tz > 0 ? 0.066 : -0.066)], scale: [0.016, 0.028, 0.006] });
    b.add('roof', P.cone8, '#ffffff', { pos: [tx, y0 + th2 + 0.02, tz], scale: [0.088, 0.14, 0.088], jitter: 0.03 });
    towerTops.push([tx, y0 + th2 + 0.16, tz]);
  }
  // keep
  const kx = 0, kz = -0.05, kw = 0.3, kh = 0.34;
  b.add('solid', P.box, stone, { pos: [kx, y0 + kh / 2, kz], scale: [kw, kh, 0.26], jitter: 0.03 });
  for (let i = 0; i < 5; i++) {
    const o = -kw / 2 + (i + 0.5) * (kw / 5);
    b.add('solid', P.box, stoneDark, { pos: [kx + o, y0 + kh + 0.014, kz + 0.13], scale: [0.04, 0.028, 0.02] });
    b.add('solid', P.box, stoneDark, { pos: [kx + o, y0 + kh + 0.014, kz - 0.13], scale: [0.04, 0.028, 0.02] });
  }
  b.add('roof', P.cone4, '#ffffff', { pos: [kx, y0 + kh, kz], rot: [0, Math.PI / 4, 0], scale: [0.2, 0.17, 0.2] });
  for (const [wx, wy] of [[-0.08, 0.12], [0.08, 0.12], [-0.08, 0.24], [0.08, 0.24], [0, 0.24]]) {
    b.add('window', P.box, '#ffc766', { pos: [kx + wx, y0 + wy, kz + 0.131], scale: [0.026, 0.04, 0.004] });
  }
  b.add('solid', P.box, '#3b2616', { pos: [kx, y0 + 0.04, kz + 0.132], scale: [0.06, 0.08, 0.004] });
  // banners on the keep
  for (const bx of [-0.12, 0.12]) b.add('roof', P.box, '#ffffff', { pos: [kx + bx, y0 + 0.2, kz + 0.132], scale: [0.035, 0.1, 0.003], jitter: 0 });
  // tall spire tower
  const sx = 0.08, sz = -0.1, sh = 0.58;
  b.add('solid', P.cyl8, stone, { pos: [sx, y0, sz], scale: [0.062, sh, 0.062], jitter: 0.03 });
  b.add('solid', P.cyl8, stoneDark, { pos: [sx, y0 + sh, sz], scale: [0.074, 0.026, 0.074] });
  b.add('window', P.box, '#ffc766', { pos: [sx, y0 + 0.47, sz + 0.06], scale: [0.018, 0.034, 0.006] });
  b.add('roof', P.cone8, '#ffffff', { pos: [sx, y0 + sh + 0.024, sz], scale: [0.085, 0.2, 0.085] });
  b.add('solid', P.cyl5, '#3a2a1a', { pos: [sx, y0 + sh + 0.2, sz], scale: [0.004, 0.12, 0.004] });
  // hedges and trees around the walls
  for (const [hx, hz] of [[-0.41, 0.2], [0.41, -0.15], [-0.4, -0.38], [0.39, 0.36], [0.2, 0.42], [-0.22, 0.42]]) {
    b.add('sway', P.ico1, rng.pick(['#3f7a2e', '#4f8a35', '#2f6a2a']), { pos: [hx, y0 + 0.03, hz], scale: [0.04, 0.045, 0.04] });
  }
  const mats = {
    ground: M.flat, solid: M.flat, sway: M.sway, window: M.window,
    roof: flatPlayerMaterial(colorHex),
  };
  group.add(b.build(mats));
  const flag = makeFlag(colorHex);
  flag.mesh.position.set(sx + 0.004, y0 + sh + 0.28, sz);
  group.add(flag.mesh);
  const small = [];
  for (const [tx, ty, tz] of towerTops) {
    const f = makeFlag(colorHex, 0.06, 0.035);
    f.mesh.position.set(tx, ty + 0.03, tz);
    const pole = new THREE.Mesh(P.cyl5, M.woodDark);
    pole.scale.set(0.003, 0.06, 0.003);
    pole.position.set(tx, ty - 0.03, tz);
    group.add(f.mesh, pole);
    small.push(f);
  }
  const animators = [flag.update, ...small.map((f) => f.update)];
  return { group, update: (t) => animators.forEach((a) => a(t)) };
}

// King meeple: lacquered robe, golden belt and crown.
export function buildKing(colorHex) {
  const g = new THREE.Group();
  const profile = [
    [0, 0], [0.125, 0], [0.13, 0.012], [0.122, 0.03], [0.1, 0.07], [0.085, 0.13], [0.082, 0.17], [0.096, 0.2],
    [0.09, 0.225], [0.06, 0.24], [0.034, 0.25], [0, 0.252],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 28), playerMaterial(colorHex));
  body.castShadow = true; body.receiveShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.064, 24, 16), body.material);
  head.position.y = 0.3;
  head.castShadow = true;
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.087, 0.009, 8, 28), M.gold);
  belt.rotation.x = Math.PI / 2;
  belt.position.y = 0.135;
  const clasp = new THREE.Mesh(new THREE.OctahedronGeometry(0.016), M.ruby);
  clasp.position.set(0, 0.135, 0.093);
  const cape = new THREE.Mesh(new THREE.TorusGeometry(0.092, 0.014, 8, 28, Math.PI), M.gold);
  cape.rotation.x = Math.PI / 2;
  cape.position.y = 0.205;
  cape.rotation.z = Math.PI;
  const crown = makeCrown(0.95);
  crown.position.y = 0.345;
  g.add(body, head, belt, clasp, cape, crown);
  g.userData.parts = { body, crown };
  return g;
}

// Candle with a flickering flame, glow and a real light.
export function buildCandle(height = 1.2, seed = 1) {
  const rng = new Rng(seed);
  const g = new THREE.Group();
  const dishProfile = [[0, 0], [0.42, 0], [0.46, 0.03], [0.44, 0.06], [0.2, 0.07], [0.17, 0.12], [0.2, 0.14], [0, 0.14]].map(([x, y]) => new THREE.Vector2(x, y));
  const dish = new THREE.Mesh(new THREE.LatheGeometry(dishProfile, 32), M.goldDull);
  dish.castShadow = dish.receiveShadow = true;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.018, 8, 16), M.goldDull);
  ring.position.set(0.47, 0.05, 0); ring.rotation.y = Math.PI / 2;
  const waxMat = new THREE.MeshPhysicalMaterial({ color: 0xf3e7c9, roughness: 0.55, transmission: 0.0, sheen: 0.4, emissive: 0xffa040, emissiveIntensity: 0.05 });
  const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.14, height, 24), waxMat);
  wax.position.y = 0.14 + height / 2;
  wax.castShadow = true;
  g.add(dish, ring, wax);
  // drips
  for (let i = 0; i < 7; i++) {
    const a = rng.float(0, Math.PI * 2), l = rng.float(0.08, 0.35);
    const d = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, l, 4, 8), waxMat);
    d.position.set(Math.cos(a) * 0.132, 0.14 + height - l / 2 - 0.02, Math.sin(a) * 0.132);
    g.add(d);
  }
  const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 5), new THREE.MeshBasicMaterial({ color: 0x111111 }));
  wick.position.y = 0.14 + height + 0.03;
  g.add(wick);
  const flameProfile = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    flameProfile.push(new THREE.Vector2(Math.sin(t * Math.PI) ** 0.9 * 0.05 * (1 - t * 0.6), t * 0.2));
  }
  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.62, 0.22).multiplyScalar(6), transparent: true, opacity: 0.95, depthWrite: false });
  const flame = new THREE.Mesh(new THREE.LatheGeometry(flameProfile, 16), flameMat);
  const core = new THREE.Mesh(new THREE.LatheGeometry(flameProfile, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.9, 0.7).multiplyScalar(9), depthWrite: false, transparent: true }));
  core.scale.set(0.5, 0.55, 0.5);
  const flameGroup = new THREE.Group();
  flameGroup.add(flame, core);
  flameGroup.position.y = 0.14 + height + 0.02;
  g.add(flameGroup);
  const light = new THREE.PointLight(0xffa55a, 6, 16, 1.6);
  light.position.y = 0.14 + height + 0.25;
  g.add(light);
  const ph = rng.float(0, 10);
  let base = 6;
  const update = (t) => {
    const f = 0.85 + Math.sin(t * 9 + ph) * 0.05 + Math.sin(t * 23.3 + ph * 2) * 0.04 + Math.sin(t * 3.1) * 0.05;
    flameGroup.scale.set(1 + (f - 1) * 0.5, f * 1.05, 1 + (f - 1) * 0.5);
    flameGroup.rotation.z = Math.sin(t * 2.7 + ph) * 0.06;
    flameGroup.rotation.x = Math.sin(t * 3.3 + ph) * 0.05;
    light.intensity = base * (0.8 + (f - 0.85) * 2.2);
  };
  return { group: g, light, update, setBase: (v) => { base = v; }, tip: flameGroup };
}

export function buildGoblet() {
  const pts = [[0, 0], [0.3, 0], [0.32, 0.03], [0.1, 0.08], [0.06, 0.2], [0.05, 0.45], [0.09, 0.5], [0.28, 0.62], [0.33, 0.9], [0.31, 0.92], [0.26, 0.64], [0.0, 0.56]].map(([x, y]) => new THREE.Vector2(x, y));
  const mat = new THREE.MeshStandardMaterial({ color: 0xc9c2b8, metalness: 1, roughness: 0.28 });
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 32), mat);
  m.castShadow = true; m.receiveShadow = true;
  const g = new THREE.Group();
  g.add(m);
  const wine = new THREE.Mesh(new THREE.CircleGeometry(0.29, 24), new THREE.MeshPhysicalMaterial({ color: 0x4a0512, roughness: 0.05, clearcoat: 1 }));
  wine.rotation.x = -Math.PI / 2; wine.position.y = 0.82;
  g.add(wine);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.035), i % 2 ? M.sapphire : M.ruby);
    gem.position.set(Math.cos(a) * 0.3, 0.76, Math.sin(a) * 0.3);
    g.add(gem);
  }
  return g;
}

export function buildCoinStack(n, seed = 3) {
  const rng = new Rng(seed);
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(0.16, 0.16, 0.035, 24);
  for (let i = 0; i < n; i++) {
    const c = new THREE.Mesh(geo, M.goldDull);
    c.position.set(rng.float(-0.015, 0.015), 0.0175 + i * 0.036, rng.float(-0.015, 0.015));
    c.rotation.y = rng.float(0, 6);
    c.castShadow = c.receiveShadow = true;
    g.add(c);
  }
  return g;
}

export function buildScroll() {
  const g = new THREE.Group();
  const paper = new THREE.MeshStandardMaterial({ color: 0xe8d7ae, roughness: 0.85 });
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.5, 24), paper);
  roll.rotation.z = Math.PI / 2; roll.position.y = 0.16;
  roll.castShadow = true;
  const ribbon = new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.025, 8, 24), new THREE.MeshStandardMaterial({ color: 0x8a1020, roughness: 0.5 }));
  ribbon.rotation.y = Math.PI / 2; ribbon.position.y = 0.16;
  const seal = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 16), new THREE.MeshStandardMaterial({ color: 0xa01020, roughness: 0.3 }));
  seal.position.set(0, 0.16, 0.18); seal.rotation.x = Math.PI / 2;
  for (const s of [-1, 1]) {
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 12), M.woodDark);
    knob.rotation.z = Math.PI / 2; knob.position.set(s * 0.8, 0.16, 0);
    g.add(knob);
  }
  g.add(roll, ribbon, seal);
  return g;
}
