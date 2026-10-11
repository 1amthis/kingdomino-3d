// The Halloween skin's props: pumpkins and jack-o'-lanterns, graves, ghosts, bats, a witch's cauldron,
// candy, cobwebs and a spider. The dioramas (terrain.js), the castles (pieces.js) and the table
// (table.js) call on them when the table is dressed for Halloween (see skins/index.js). The terrains
// keep their own colours and shapes, so a kingdom reads the same in either skin.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GeoBuilder, P, composeMatrix, shade } from '../gfx/geo.js';
import { M } from '../gfx/materials.js';
import { Rng } from '../core/rng.js';

const ORANGES = ['#e8761c', '#f08a2a', '#d9661a', '#ef7f22'];

// A triangular prism, its point up and a face towards +z: carved eyes and noses.
const TRI = new THREE.CylinderGeometry(1, 1, 1, 3);
TRI.rotateX(Math.PI / 2);
TRI.rotateZ(Math.PI);

// Build in a frame of one's own (a unit pumpkin, a grave a tenth high…), then set it in the diorama.
function place(b, rng, build, pos, rot, scale) {
  const t = new GeoBuilder(rng);
  build(t);
  t.transform(composeMatrix(pos, rot, scale));
  b.absorb(t);
}

// ---------- pumpkins ----------

// A unit pumpkin: radius 1, its base at y = 0, eight grooves and a dimple for the stem.
let pumpkinGeo = null;
function pumpkinBody() {
  if (!pumpkinGeo) {
    const g = new THREE.SphereGeometry(1, 16, 8);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      // (a lobe, not a groove, faces +z, where the face is carved)
      const k = 1 - 0.09 * (0.5 + 0.5 * Math.cos(Math.atan2(z, x) * 8 + Math.PI));
      const r = Math.hypot(x, z);
      const dimple = Math.max(0, 1 - r / 0.45) * (y > 0 ? -0.14 : 0.06);
      p.setXYZ(i, x * k, y * 0.72 + dimple + 0.72, z * k);
    }
    pumpkinGeo = g;
  }
  return pumpkinGeo;
}

// Two triangle eyes, a nose and a jagged grin on the unit pumpkin's front, in `cat` (a glowing material).
function carveFace(t, cat) {
  const feature = (geo, x, y, sx, sy, rz = 0) => {
    const z = Math.sqrt(Math.max(0.05, 1 - x * x - ((y - 0.72) / 0.72) ** 2));
    t.add(cat, geo, '#ffffff', { pos: [x, y, z - 0.045], rot: [-(y - 0.72) * 0.9, Math.atan2(x, z), rz], scale: [sx, sy, 0.1], jitter: 0 });
  };
  feature(TRI, -0.3, 0.95, 0.15, 0.15);
  feature(TRI, 0.3, 0.95, 0.15, 0.15);
  feature(TRI, 0, 0.74, 0.07, 0.07);
  for (let k = -2; k <= 2; k++) feature(P.box, k * 0.13, 0.47 + 0.035 * k * k, 0.12, k % 2 ? 0.07 : 0.12, k * 0.25);
}

function pumpkinParts(t, rng, color, carved, faceCat = 'lantern') {
  t.add('solid', pumpkinBody(), color, { jitter: 0.05 });
  t.add('solid', P.cyl5, '#5b5a22', { pos: [0, 1.25, 0], rot: [rng.float(-0.3, 0.3), 0, rng.float(-0.3, 0.3)], scale: [0.11, 0.32, 0.11] });
  if (carved) carveFace(t, faceCat);
}

// A pumpkin of radius r sitting at (x, y, z); a carved one grins with a glowing face that brightens at night.
export function pumpkin(b, rng, x, y, z, r, { carved = false, rotY = rng.float(0, Math.PI * 2) } = {}) {
  const color = rng.pick(ORANGES);
  place(b, rng, (t) => pumpkinParts(t, rng, color, carved), [x, y - 0.1 * r, z], [0, rotY, 0], r);
}

// A few pumpkins on their vines, one of them carved.
export function pumpkinPatch(b, rng, x, y, z, groundH) {
  const n = rng.int(3, 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.float(-0.3, 0.3), d = i ? rng.float(0.065, 0.09) : 0;
    const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    pumpkin(b, rng, px, groundH(px, pz), pz, i ? rng.float(0.028, 0.036) : 0.046, { carved: i === 0 });
  }
  for (let i = 0; i < 4; i++) {
    const a = rng.float(0, Math.PI * 2);
    b.add('solid', P.box, '#3f6a24', { pos: [x + Math.cos(a) * 0.05, groundH(x, z) + 0.002, z + Math.sin(a) * 0.05], rot: [0, -a, 0], scale: [0.1, 0.004, 0.006] });
  }
}

// ---------- graves and bare trees ----------

export function grave(b, rng, x, y, z, s = 1, rotY = 0) {
  const stone = rng.pick(['#8e8b86', '#7f827a', '#9a958d']);
  const cross = rng.chance(0.3);
  place(b, rng, (t) => {
    if (cross) {
      t.add('solid', P.box, stone, { pos: [0, 0.45, 0], scale: [0.16, 0.9, 0.14] });
      t.add('solid', P.box, stone, { pos: [0, 0.64, 0], scale: [0.55, 0.15, 0.14] });
    } else {
      t.add('solid', P.box, stone, { pos: [0, 0.3, 0], scale: [0.6, 0.6, 0.16] });
      t.add('solid', P.cyl12, stone, { pos: [0, 0.6, -0.08], rot: [Math.PI / 2, 0, 0], scale: [0.3, 0.16, 0.3] });
      for (const ly of [0.62, 0.48, 0.38]) t.add('solid', P.box, shade(stone, 0.62), { pos: [0, ly, 0.081], scale: [ly > 0.5 ? 0.3 : 0.38, 0.045, 0.012], jitter: 0 });
    }
    // the mound in front
    t.add('ground', P.sphere, '#4f4030', { pos: [0, 0, 0.55], scale: [0.32, 0.07, 0.42] });
  }, [x, y - 0.004, z], [rng.float(-0.12, 0.12), rotY, rng.float(-0.15, 0.15)], 0.1 * s);
}

export function deadTree(b, rng, x, y, z, s = 1) {
  const bark = '#3a302a';
  const trunk = new THREE.CylinderGeometry(0.008, 0.02, 0.2, 5);
  trunk.translate(0, 0.1, 0);
  b.add('solid', trunk, bark, { pos: [x, y - 0.004, z], rot: [rng.float(-0.1, 0.1), 0, rng.float(-0.12, 0.12)], scale: s });
  trunk.dispose();
  for (const [a, h, l, tilt] of [[0.4, 0.12, 0.08, 0.9], [2.6, 0.15, 0.07, 1.0], [-1.5, 0.09, 0.06, 0.8], [1.6, 0.17, 0.05, 0.6]]) {
    b.add('solid', P.cyl5, bark, { pos: [x, y + h * s, z], rot: [0, a + rng.float(-0.4, 0.4), tilt], scale: [0.004 * s, l * s, 0.004 * s] });
  }
}

// A little graveyard along one side of a meadow, under a bare tree.
export function graveyard(b, rng, groundH, zRow) {
  const n = rng.int(2, 3);
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * 0.19 + rng.float(-0.02, 0.02), z = zRow + rng.float(-0.03, 0.03);
    grave(b, rng, x, groundH(x, z), z, rng.float(1.4, 1.7), rng.float(-0.25, 0.25));
  }
  const tx = rng.pick([-0.36, 0.36]), tz = zRow - 0.04;
  deadTree(b, rng, tx, groundH(tx, tz), tz, 1.1);
}

// ---------- ghosts ----------

let ghostGeo = null;
function ghostBody() {
  if (!ghostGeo) {
    const pts = [[0.44, 0], [0.46, 0.08], [0.4, 0.3], [0.36, 0.55], [0.36, 0.75], [0.3, 0.9], [0.18, 0.98], [0, 1]].map(([x, y]) => new THREE.Vector2(x, y));
    const g = new THREE.LatheGeometry(pts, 16);
    const p = g.attributes.position;
    // a ragged hem
    for (let i = 0; i < p.count; i++) if (p.getY(i) < 0.1) p.setY(i, p.getY(i) + Math.sin(Math.atan2(p.getZ(i), p.getX(i)) * 5) * 0.06);
    ghostGeo = g;
  }
  return ghostGeo;
}

// A sheet ghost drifting round in circles, glowing faintly (brighter at night).
export function ghost(rng, { cx = 0, cz = 0.05, radius = 0.16, y = 0.1, size = 0.13 } = {}) {
  const b = new GeoBuilder(rng);
  b.add('ghost', ghostBody(), '#ffffff', { jitter: 0 });
  for (const s of [-1, 1]) b.add('solid', P.sphere, '#151018', { pos: [s * 0.12, 0.74, 0.34], scale: [0.055, 0.08, 0.04], jitter: 0 });
  b.add('solid', P.sphere, '#151018', { pos: [0, 0.55, 0.36], scale: [0.05, 0.065, 0.03], jitter: 0 });
  const g = b.build({ ghost: M.ghost, solid: M.flat }, { castShadow: false });
  g.scale.setScalar(size);
  const ph = rng.float(0, Math.PI * 2), sp = rng.float(0.25, 0.4) * (rng.chance(0.5) ? 1 : -1);
  const update = (t) => {
    const a = ph + t * sp;
    g.position.set(cx + Math.cos(a) * radius, y + Math.sin(t * 1.6 + ph) * 0.02, cz + Math.sin(a) * radius * 0.8);
    g.rotation.y = -a + (sp > 0 ? 0 : Math.PI); // facing the way it drifts
    g.rotation.z = Math.sin(t * 1.1 + ph) * 0.12;
  };
  update(0);
  return { object: g, update };
}

// ---------- bats ----------

let wingGeo = null, batGeo = null;
function batParts() {
  if (!wingGeo) {
    // one wing, reaching along +x, its leading edge forwards (+z) and its trailing edge scalloped
    const pts = [[0, 0.16], [0.3, 0.3], [0.62, 0.34], [1, 0.16], [0.84, 0.02], [0.66, 0.06], [0.52, -0.08], [0.36, -0.02], [0.2, -0.14], [0, -0.1]];
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    wingGeo = new THREE.ShapeGeometry(shape);
    wingGeo.rotateX(Math.PI / 2);
    const body = new THREE.SphereGeometry(1, 8, 6);
    body.scale(0.11, 0.09, 0.2);
    const head = new THREE.SphereGeometry(0.075, 8, 6);
    head.translate(0, 0.02, 0.2);
    const ears = [-1, 1].map((s) => {
      const e = new THREE.ConeGeometry(0.03, 0.09, 4);
      e.translate(s * 0.04, 0.1, 0.2);
      return e;
    });
    batGeo = mergeGeometries([body, head, ...ears]);
    [body, head, ...ears].forEach((g) => g.dispose());
  }
  return { wing: wingGeo, body: batGeo };
}

// A bat with a wingspan of 2 (scale it), facing +z; flap(k) raises both wings by k radians.
export function makeBat() {
  const { wing, body } = batParts();
  const g = new THREE.Group();
  const right = new THREE.Mesh(wing, M.bat), left = new THREE.Mesh(wing, M.bat);
  left.scale.x = -1;
  g.add(new THREE.Mesh(body, M.bat), right, left);
  return { group: g, flap: (k) => { right.rotation.z = k; left.rotation.z = -k; } };
}

// A few bats wheeling round a point: over a mountain, round a castle's spire.
export function circlingBats(rng, n, { cx = 0, cy = 0.3, cz = 0, radius = 0.15, size = 0.03 } = {}) {
  const group = new THREE.Group();
  const dir = rng.chance(0.5) ? 1 : -1;
  const bats = Array.from({ length: n }, (_, i) => {
    const bat = makeBat();
    bat.group.scale.setScalar(size * rng.float(0.8, 1.15));
    group.add(bat.group);
    return {
      ...bat, ph: (i / n) * Math.PI * 2 + rng.float(-0.4, 0.4), r: radius * rng.float(0.75, 1.25),
      h: rng.float(-1, 1) * radius * 0.25, sp: rng.float(1.1, 1.6), beat: rng.float(13, 17),
    };
  });
  const update = (t) => {
    for (const b of bats) {
      const a = b.ph + t * b.sp * dir;
      b.group.position.set(cx + Math.cos(a) * b.r, cy + b.h + Math.sin(t * 2.3 + b.ph) * radius * 0.12, cz + Math.sin(a) * b.r);
      b.group.rotation.set(0, dir > 0 ? -a : Math.PI - a, dir * 0.35); // banking into the turn
      b.flap(Math.sin(t * b.beat + b.ph) * 0.75 + 0.15);
    }
  };
  update(0);
  return { object: group, update };
}

// A flock flying loops over the whole table: three instanced meshes (body and each wing) for all of it.
export function batFlock(stage, n = 9) {
  const rng = new Rng(31);
  const { wing, body } = batParts();
  const meshes = [body, wing, wing].map((g) => {
    const m = new THREE.InstancedMesh(g, M.bat, n);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    stage.scene.add(m);
    return m;
  });
  const bats = Array.from({ length: n }, () => ({
    ph: rng.float(0, Math.PI * 2), sp: rng.float(0.16, 0.24) * (rng.chance(0.75) ? 1 : -1), R: rng.float(9, 15),
    wob: rng.float(0.15, 0.3), h: rng.float(5, 9), size: rng.float(0.45, 0.6), beat: rng.float(9, 12),
  }));
  const at = (b, t, out) => {
    const a = b.ph + t * b.sp;
    return out.set(Math.cos(a) * b.R * (1 + b.wob * Math.sin(2 * a)), b.h + Math.sin(t * 0.9 + b.ph) * 1.2, Math.sin(a) * b.R * 0.85);
  };
  const pos = new THREE.Vector3(), ahead = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3();
  const base = new THREE.Matrix4(), rot = new THREE.Matrix4(), wingM = new THREE.Matrix4(), mirror = new THREE.Matrix4().makeScale(-1, 1, 1);
  stage.onFrame((t) => {
    bats.forEach((b, i) => {
      at(b, t, pos);
      at(b, t + 0.05, ahead).sub(pos);
      e.set(0, Math.atan2(ahead.x, ahead.z), -Math.sign(b.sp) * 0.3);
      base.compose(pos, q.setFromEuler(e), s.setScalar(b.size));
      meshes[0].setMatrixAt(i, base);
      const k = Math.sin(t * b.beat + b.ph) * 0.8 + 0.1;
      meshes[1].setMatrixAt(i, wingM.multiplyMatrices(base, rot.makeRotationZ(k)));
      // (as makeBat's left wing: mirrored first, then raised)
      meshes[2].setMatrixAt(i, wingM.multiplyMatrices(base, rot.makeRotationZ(-k)).multiply(mirror));
    });
    for (const m of meshes) m.instanceMatrix.needsUpdate = true;
  });
}

// ---------- a witch's cauldron ----------

let potGeo = null, bubbleGeo = null;
function potBody() {
  if (!potGeo) {
    const pts = [[0, 0.06], [0.5, 0.05], [0.8, 0.2], [0.95, 0.45], [0.92, 0.7], [0.78, 0.88], [0.8, 0.94], [0.86, 0.98], [0.8, 1], [0.72, 0.96]];
    potGeo = new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 14);
  }
  return potGeo;
}

// A unit cauldron (rim at 1.25) on three legs over a fire, brimming with a glowing green brew.
function cauldronParts(t, rng) {
  t.add('solid', potBody(), '#2b2828', { pos: [0, 0.25, 0], jitter: 0.04 });
  for (let i = 0; i < 3; i++) {
    const a = i * 2.094 + 0.5;
    t.add('solid', P.cyl5, '#232020', { pos: [Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55], scale: [0.08, 0.36, 0.08] });
  }
  t.add('potion', P.cyl12, '#ffffff', { pos: [0, 1.17, 0], scale: [0.79, 0.04, 0.79], jitter: 0 });
  for (const a of [0.3, 1.9]) t.add('solid', P.box, '#4a3020', { pos: [0, 0.05, 0], rot: [0, a, 0], scale: [0.9, 0.1, 0.12] });
  for (let i = 0; i < 4; i++) {
    const a = i * 1.57 + rng.float(-0.3, 0.3);
    t.add('lantern', P.cone5, '#ffffff', { pos: [Math.cos(a) * 0.14, 0.06, Math.sin(a) * 0.14], scale: [0.1, rng.float(0.2, 0.3), 0.1], jitter: 0 });
  }
}

// Bubbles welling up through the brew and bursting, in the cauldron's unit frame.
function bubbles(rng, n) {
  if (!bubbleGeo) bubbleGeo = new THREE.SphereGeometry(1, 8, 6);
  const group = new THREE.Group();
  const list = Array.from({ length: n }, (_, i) => {
    const m = new THREE.Mesh(bubbleGeo, M.potion);
    group.add(m);
    return { m, ph: i / n, sp: rng.float(0.45, 0.7), x: 0, z: 0, last: 1 };
  });
  const update = (t) => {
    for (const b of list) {
      const k = (t * b.sp + b.ph) % 1;
      if (k < b.last) { const a = rng.float(0, Math.PI * 2), r = rng.float(0, 0.55); b.x = Math.cos(a) * r; b.z = Math.sin(a) * r; }
      b.last = k;
      b.m.position.set(b.x, 1.18 + k * 0.08, b.z);
      b.m.scale.setScalar(0.04 + k * 0.1);
      b.m.visible = k < 0.9;
    }
  };
  update(0);
  return { object: group, update };
}

// The cauldron in a swamp, `s` high to its rim.
export function cauldron(b, rng, x, y, z, s, objects, animators) {
  const scale = s / 1.25;
  place(b, rng, (t) => cauldronParts(t, rng), [x, y - 0.004, z], [0, rng.float(0, 6), 0], scale);
  const bub = bubbles(rng, 3);
  bub.object.position.set(x, y - 0.004, z);
  bub.object.scale.setScalar(scale);
  objects.push(bub.object);
  animators.push(bub.update);
}

// ---------- the table ----------

// A big jack-o'-lantern standing in for a candle: the same flickering light, glowing through its face.
export function buildJackOLantern(r = 0.8, seed = 1) {
  const rng = new Rng(seed);
  const face = new THREE.MeshStandardMaterial({ color: 0xffc860, emissive: 0xff9a2a, emissiveIntensity: 2, roughness: 0.5 });
  const t = new GeoBuilder(rng);
  pumpkinParts(t, rng, '#e2701c', true, 'face');
  const group = new THREE.Group();
  const body = t.build({ solid: M.flat, face });
  body.scale.setScalar(r);
  group.add(body);
  const light = new THREE.PointLight(0xff9a3a, 6, 16, 1.6);
  light.position.set(0, r * 0.8, r * 0.3);
  group.add(light);
  const ph = rng.float(0, 10);
  let base = 6;
  const update = (time) => {
    const f = 0.85 + Math.sin(time * 9 + ph) * 0.05 + Math.sin(time * 23.3 + ph * 2) * 0.04 + Math.sin(time * 3.1) * 0.05;
    light.intensity = base * (0.8 + (f - 0.85) * 2.2);
    face.emissiveIntensity = (1.2 + base * 0.25) * (0.75 + (f - 0.85) * 2.5);
  };
  return { group, light, update, setBase: (v) => { base = v; } };
}

export function buildTableCauldron() {
  const rng = new Rng(13);
  const t = new GeoBuilder(rng);
  cauldronParts(t, rng);
  const g = new THREE.Group();
  g.add(t.build({ solid: M.flat, potion: M.potion, lantern: M.lantern }));
  const bub = bubbles(rng, 5);
  g.add(bub.object);
  g.userData.update = bub.update;
  return g;
}

// Candy corn and twist-wrapped sweets, spilt in a heap.
export function buildCandy(seed = 7, n = 16) {
  const rng = new Rng(seed);
  const b = new GeoBuilder(rng);
  const corn = new THREE.ConeGeometry(1, 1, 6, 3);
  corn.translate(0, 0.5, 0);
  const yellow = new THREE.Color('#ffc21a'), orange = new THREE.Color('#ff6f12'), white = new THREE.Color('#fff4e2');
  for (let i = 0; i < n; i++) {
    const a = rng.float(0, Math.PI * 2), d = Math.sqrt(rng.next()) * 0.7, x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (rng.chance(0.55)) {
      // tipped onto its side, then turned any way
      place(b, rng, (t) => t.add('solid', corn, (px, py) => (py < 0.36 ? yellow : py < 0.7 ? orange : white), { scale: [0.42, 1, 0.6], jitter: 0.02 }),
        [x, 0.085, z], [0, rng.float(0, Math.PI * 2), Math.PI / 2], 0.2);
    } else {
      const c = rng.pick(['#8a3cff', '#ff7a1a', '#3fc86a', '#e83a8a', '#2a2230']);
      place(b, rng, (t) => {
        t.add('solid', P.sphere, c, { scale: [1, 0.8, 0.8] });
        for (const s of [-1, 1]) t.add('solid', P.cone6, c, { pos: [s * 1.85, 0, 0], rot: [0, 0, s * Math.PI / 2], scale: [0.6, 0.9, 0.6] });
      }, [x, 0.07, z], [0, rng.float(0, Math.PI * 2), 0], 0.09);
    }
  }
  corn.dispose();
  const g = b.build({ solid: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.35, clearcoat: 0.6, flatShading: true }) });
  return g;
}

export function buildWitchHat() {
  const g = new THREE.Group();
  const felt = new THREE.MeshStandardMaterial({ color: 0x2a1f36, roughness: 0.85 });
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.78, 0.04, 32), felt);
  brim.position.y = 0.02;
  // the crown, its tip bent over
  const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.38, 0.75, 20), felt);
  lower.position.y = 0.4;
  const upper = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 20), felt);
  upper.position.set(0.12, 0.98, 0);
  upper.rotation.z = -0.55;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.39, 0.12, 24), new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.6 }));
  band.position.y = 0.11;
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.03), M.goldDull);
  buckle.position.set(0, 0.11, 0.385);
  g.add(brim, lower, upper, band, buckle);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// Cobwebs strung across the table's corners, painted on a transparent sheet laid on the wood.
export function buildCobwebs(corners) {
  const S = 6, px = 512;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const x = c.getContext('2d');
  const rng = new Rng(5);
  const spokes = 8, R = px * 0.96;
  const ang = Array.from({ length: spokes }, (_, i) => (i / (spokes - 1)) * Math.PI / 2 + (i && i < spokes - 1 ? rng.float(-0.05, 0.05) : 0));
  x.strokeStyle = 'rgba(255,255,255,0.8)';
  x.lineWidth = 2.2;
  for (const a of ang) { x.beginPath(); x.moveTo(0, 0); x.lineTo(Math.cos(a) * R, Math.sin(a) * R); x.stroke(); }
  x.lineWidth = 1.6;
  for (let r = 46; r < R * 0.92; r += 34 + r * 0.08) {
    x.beginPath();
    ang.forEach((a, i) => {
      const rr = r * rng.float(0.94, 1.04), p = [Math.cos(a) * rr, Math.sin(a) * rr];
      if (!i) { x.moveTo(...p); return; }
      // each thread sags towards the corner between two spokes
      const m = (a + ang[i - 1]) / 2, sag = rr * 0.86;
      x.quadraticCurveTo(Math.cos(m) * sag, Math.sin(m) * sag, ...p);
    });
    x.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, opacity: 0.55, depthWrite: false, roughness: 0.6 });
  const geo = new THREE.PlaneGeometry(S, S);
  geo.rotateX(-Math.PI / 2);
  const g = new THREE.Group();
  // the canvas's corner lies at the sheet's north-west corner; each table corner turns it into place
  for (const [x0, z0] of corners) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x0 - Math.sign(x0) * S / 2, 0.012, z0 - Math.sign(z0) * S / 2);
    m.rotation.y = { '-1,-1': 0, '1,-1': -Math.PI / 2, '1,1': Math.PI, '-1,1': Math.PI / 2 }[`${Math.sign(x0)},${Math.sign(z0)}`];
    m.receiveShadow = true;
    m.renderOrder = 1;
    g.add(m);
  }
  return g;
}

// A spider letting itself down on its thread and climbing back, over and over.
export function buildSpider(stage, x, z, top = 13) {
  const black = new THREE.MeshStandardMaterial({ color: 0x16111a, roughness: 0.5 });
  const spider = new THREE.Group();
  const abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), black);
  abdomen.position.y = 0.2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), black);
  head.position.y = -0.04;
  spider.add(abdomen, head);
  const legGeo = new THREE.CylinderGeometry(0.018, 0.012, 0.42, 4);
  legGeo.translate(0, -0.21, 0);
  const legs = [];
  for (let i = 0; i < 8; i++) {
    const side = i < 4 ? 1 : -1, k = i % 4;
    const leg = new THREE.Mesh(legGeo, black);
    leg.position.set(side * 0.08, -0.02, (k - 1.5) * 0.06);
    leg.rotation.set((k - 1.5) * 0.35, 0, side * (1.1 + k * 0.08));
    spider.add(leg);
    legs.push(leg);
  }
  const threadGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]);
  const thread = new THREE.Line(threadGeo, new THREE.LineBasicMaterial({ color: 0xd8d8e0, transparent: true, opacity: 0.45 }));
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.add(spider, thread);
  spider.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  stage.scene.add(g);
  stage.onFrame((t) => {
    // most of the time near the top, now and then down to just above the table
    const k = 0.5 - 0.5 * Math.cos(t * 0.21);
    const y = top - 1 - k * k * (top - 3.2);
    spider.position.y = y;
    spider.rotation.y = Math.sin(t * 0.4) * 0.8;
    thread.position.y = y + 0.4;
    thread.scale.y = Math.max(0.01, top - y - 0.4);
    legs.forEach((l, i) => { l.rotation.x = ((i % 4) - 1.5) * 0.35 + Math.sin(t * 6 + i) * 0.08; });
  });
}
