// Trophies: some achievements (core/achievements.js) stand on the table as small objects beside the mat
// of the person who earned them. Each builder makes one, standing on y = 0 within about 0.9 × 0.9;
// update(t), when there is one, keeps it alive (a banner in the wind, a gem turning).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { M, playerMaterial } from './materials.js';
import { makeCrown, buildCastle, buildGoblet, buildCoinStack } from './pieces.js';
import { TERRAIN_INFO } from '../core/rules.js';
import { halloween } from '../skins/index.js';

let mats = null;
function materials() {
  if (mats) return mats;
  mats = {
    velvet: new THREE.MeshStandardMaterial({ color: halloween ? 0x3a1458 : 0x7a0f1e, roughness: 1 }),
    stone: new THREE.MeshStandardMaterial({ color: 0x7d776c, roughness: 0.95, flatShading: true }),
    steel: new THREE.MeshStandardMaterial({ color: 0xdfe4ea, metalness: 1, roughness: 0.22 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x4a2a14, roughness: 0.8 }),
    marble: new THREE.MeshStandardMaterial({ color: 0xcfc9bd, roughness: 0.4, flatShading: true }),
    // the table's gold glows in the candlelight; up close, beside the mat, a softer one keeps its shape
    gold: new THREE.MeshStandardMaterial({ color: 0xe0ac3c, metalness: 1, roughness: 0.34, envMapIntensity: 1.1 }),
    pages: new THREE.MeshStandardMaterial({ color: 0xeee0bd, roughness: 0.9 }),
    pewter: new THREE.MeshStandardMaterial({ color: 0x9a9890, metalness: 0.85, roughness: 0.4 }),
    foam: new THREE.MeshStandardMaterial({ color: 0xd9ceb4, roughness: 1 }),
    oak: new THREE.MeshStandardMaterial({ color: 0x6b3d1d, roughness: 0.7 }),
    gem: new THREE.MeshPhysicalMaterial({ color: 0xd4103a, roughness: 0.04, clearcoat: 1, emissive: 0x500014, emissiveIntensity: 0.7, flatShading: true }),
    lens: new THREE.MeshPhysicalMaterial({ color: 0x9fd8ff, roughness: 0.02, clearcoat: 1, emissive: 0x103050, emissiveIntensity: 0.4 }),
  };
  return mats;
}

const mesh = (geo, mat, [x, y, z] = [0, 0, 0]) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
};
const lathe = (pts, segments = 32) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), segments);

// A sword along +y, its point at y = 0.
function sword(blade = 0.8) {
  const m = materials(), g = new THREE.Group();
  const tip = new THREE.ConeGeometry(0.035, 0.12, 4);
  tip.rotateX(Math.PI); tip.rotateY(Math.PI / 4); tip.scale(1, 1, 0.3);
  g.add(mesh(tip, m.steel, [0, 0.06, 0]));
  g.add(mesh(new THREE.BoxGeometry(0.07, blade, 0.016), m.steel, [0, 0.12 + blade / 2, 0]));
  const y = 0.12 + blade;
  g.add(mesh(new THREE.BoxGeometry(0.34, 0.04, 0.05), M.gold, [0, y + 0.02, 0]));
  g.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 10), m.leather, [0, y + 0.14, 0]));
  g.add(mesh(new THREE.SphereGeometry(0.042, 12, 8), M.gold, [0, y + 0.27, 0]));
  return g;
}

// Giant Slayer: a sword driven into a rock.
function swordInStone() {
  const g = new THREE.Group();
  const rock = mesh(new THREE.DodecahedronGeometry(0.3, 0), materials().stone, [0, 0.14, 0]);
  rock.scale.set(1.25, 0.65, 1);
  rock.rotation.y = 0.4;
  const s = sword(0.85);
  s.position.y = 0.12;
  s.rotation.set(0.08, 0.5, -0.06);
  g.add(rock, s);
  return g;
}

// Mighty Duellist: a shield in the player's colours, two swords crossed behind it.
function shieldAndSwords(color) {
  const g = new THREE.Group();
  const outline = (k) => {
    const s = new THREE.Shape();
    s.moveTo(-0.28 * k, 0.3 * k); s.lineTo(0.28 * k, 0.3 * k); s.lineTo(0.28 * k, 0);
    s.quadraticCurveTo(0.28 * k, -0.3 * k, 0, -0.44 * k); s.quadraticCurveTo(-0.28 * k, -0.3 * k, -0.28 * k, 0);
    return s;
  };
  const face = new THREE.ExtrudeGeometry(outline(1), { depth: 0.04, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2 });
  const rim = new THREE.ExtrudeGeometry(outline(1.1), { depth: 0.03, bevelEnabled: false });
  const shield = new THREE.Group();
  shield.add(mesh(face, playerMaterial(color), [0, 0, 0.02]), mesh(rim, M.goldDull));
  const boss = mesh(new THREE.SphereGeometry(0.07, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.gold, [0, 0.02, 0.07]);
  boss.rotation.x = Math.PI / 2;
  shield.add(boss);
  shield.position.set(0, 0.5, 0.08);
  shield.rotation.x = -0.2;
  for (const side of [-1, 1]) {
    const s = sword(0.7);
    s.position.set(side * 0.36, 0, -0.06);
    s.rotation.set(-0.2, 0, side * 0.62);
    g.add(s);
  }
  g.add(shield);
  return g;
}

// Founder of a Dynasty: a banner in the player's colour, stirring in the air.
function banner(color) {
  const m = materials(), g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.08, 20), m.oak, [0, 0.04, 0]));
  g.add(mesh(new THREE.CylinderGeometry(0.022, 0.026, 1.75, 10), M.woodDark, [0, 0.95, 0]));
  g.add(mesh(new THREE.SphereGeometry(0.05, 12, 8), M.gold, [0, 1.86, 0]));
  const bar = mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.62, 8), M.goldDull, [0, 1.74, 0.02]);
  bar.rotation.z = Math.PI / 2;
  g.add(bar);
  const W = 0.54, H = 0.8;
  const geo = new THREE.PlaneGeometry(W, H, 6, 10);
  // a swallowtail: the bottom edge's middle drawn up
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    if (y < -H / 2 + 0.01) pos.setY(i, y + 0.16 * (1 - Math.abs(x) / (W / 2)));
  }
  const base = pos.array.slice();
  const cloth = mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.75, side: THREE.DoubleSide }), [0, 1.74 - H / 2, 0.03]);
  const trim = mesh(new THREE.BoxGeometry(W, 0.035, 0.012), M.goldDull, [0, 1.71, 0.03]);
  g.add(cloth, trim);
  const ph = Math.random() * 10;
  g.userData.update = (t) => {
    for (let i = 0; i < pos.count; i++) {
      const y = base[i * 3 + 1], x = base[i * 3], k = (H / 2 - y) / H; // 0 at the bar, 1 at the foot
      pos.setZ(i, Math.sin(t * 1.8 + ph + y * 5) * 0.03 * k + Math.sin(t * 3.1 + x * 7) * 0.008 * k);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  };
  return g;
}

// Conqueror: a two-handled golden cup.
function cup() {
  const g = new THREE.Group();
  g.add(mesh(lathe([[0, 0], [0.2, 0], [0.21, 0.04], [0.12, 0.07], [0.05, 0.11], [0.04, 0.28], [0.08, 0.32], [0.13, 0.34],
    [0.24, 0.46], [0.27, 0.68], [0.29, 0.7], [0.26, 0.71], [0.23, 0.5], [0, 0.42]]), M.gold));
  for (const side of [-1, 1]) {
    const h = mesh(new THREE.TorusGeometry(0.1, 0.018, 8, 18, Math.PI), M.gold, [side * 0.24, 0.56, 0]);
    h.rotation.z = -side * Math.PI / 2;
    g.add(h);
  }
  g.add(mesh(new THREE.OctahedronGeometry(0.035), M.sapphire, [0, 0.55, 0.245]));
  return g;
}

// Crown Jewel: a great cut ruby turning on a golden stand.
function jewel() {
  const g = new THREE.Group();
  g.add(mesh(lathe([[0, 0], [0.18, 0], [0.18, 0.04], [0.08, 0.08], [0.05, 0.16], [0.11, 0.2], [0, 0.2]]), M.goldDull));
  const stone = mesh(lathe([[0, 0], [0.19, 0.19], [0.21, 0.23], [0.13, 0.31], [0, 0.31]], 8), materials().gem, [0, 0.13, 0]);
  g.add(stone);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const prong = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.18, 6), M.goldDull, [Math.cos(a) * 0.12, 0.26, Math.sin(a) * 0.12]);
    prong.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
    g.add(prong);
  }
  g.userData.update = (t) => { stone.rotation.y = t * 0.6; };
  return g;
}

// Crown Collector: a chest spilling gold.
function treasure() {
  const m = materials(), g = new THREE.Group();
  g.add(mesh(new RoundedBoxGeometry(0.6, 0.3, 0.4, 2, 0.03), m.oak, [0, 0.15, 0]));
  for (const x of [-0.2, 0.2]) g.add(mesh(new THREE.BoxGeometry(0.05, 0.31, 0.41), M.goldDull, [x, 0.155, 0]));
  const heap = mesh(new THREE.SphereGeometry(0.27, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.gold, [0, 0.27, 0]);
  heap.scale.set(1.05, 0.45, 0.68);
  g.add(heap);
  const lid = new THREE.Group();
  const shell = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.6, 16, 1, false, 0, Math.PI), m.oak, [0, 0, 0.2]);
  shell.rotation.z = Math.PI / 2;
  lid.add(shell);
  lid.position.set(0, 0.3, -0.2);
  lid.rotation.x = -2.3;
  g.add(lid);
  g.add(makeCrown(2.4).translateY(0.3).translateZ(0.02));
  const coin = new THREE.CylinderGeometry(0.055, 0.055, 0.014, 14);
  for (const [x, z, rx] of [[0.32, 0.26, 0.2], [0.18, 0.33, 0], [-0.26, 0.3, 0.6], [0.4, 0.05, 0]]) {
    const c = mesh(coin, M.goldDull, [x, 0.008 + rx * 0.05, z]);
    c.rotation.x = rx;
    g.add(c);
  }
  return g;
}

// Flawless Realm: a golden castle on a marble plinth.
function goldenCastle() {
  const g = new THREE.Group();
  g.add(mesh(new RoundedBoxGeometry(0.78, 0.16, 0.78, 2, 0.03), materials().marble, [0, 0.08, 0]));
  const castle = buildCastle('#f0c75e', 5);
  castle.group.traverse((o) => { if (o.isMesh) { o.material = M.gold; o.castShadow = true; } });
  castle.group.scale.setScalar(0.72);
  castle.group.position.y = 0.16;
  g.add(castle.group);
  g.userData.update = (t) => castle.update(t);
  return g;
}

// First Crown: a crown on a velvet cushion.
function crownOnCushion() {
  const m = materials(), g = new THREE.Group();
  g.add(mesh(new RoundedBoxGeometry(0.6, 0.15, 0.6, 3, 0.07), m.velvet, [0, 0.075, 0]));
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.add(mesh(new THREE.SphereGeometry(0.03, 8, 6), M.goldDull, [x * 0.29, 0.11, z * 0.29]));
    g.add(mesh(new THREE.ConeGeometry(0.03, 0.09, 8), M.goldDull, [x * 0.31, 0.05, z * 0.31]));
  }
  const crown = makeCrown(4.4);
  crown.position.y = 0.14;
  crown.rotation.y = 0.3;
  g.add(crown);
  return g;
}

// Hat Trick: a golden laurel wreath on a little stand.
function wreath() {
  const leaves = [];
  for (let i = 0; i < 26; i++) {
    const side = i < 13 ? -1 : 1, k = (i % 13) / 12; // up each side from the bottom
    const a = -Math.PI / 2 + side * (0.25 + k * 2.55);
    for (const r of [0.2, 0.26]) {
      const leaf = new THREE.SphereGeometry(1, 8, 6);
      leaf.scale(0.055, 0.022, 0.012);
      leaf.rotateZ(a + side * (r > 0.22 ? 0.9 : 1.6) + Math.PI / 2);
      leaf.translate(Math.cos(a) * r, Math.sin(a) * r, 0);
      leaf.deleteAttribute('uv');
      leaves.push(leaf);
    }
  }
  const g = new THREE.Group();
  const w = mesh(mergeGeometries(leaves), M.gold, [0, 0.5, 0]);
  g.add(w);
  g.add(mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.04, 20), M.goldDull, [0, 0.02, 0]));
  g.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.24, 8), M.goldDull, [0, 0.14, 0]));
  const ribbon = new THREE.MeshStandardMaterial({ color: 0xa01828, roughness: 0.6, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const r = mesh(new THREE.PlaneGeometry(0.05, 0.2), ribbon, [side * 0.05, 0.2, 0.02]);
    r.rotation.z = side * 0.35;
    g.add(r);
  }
  return g;
}

// The Expert's Eye: a brass spyglass on a tripod, looking up.
function spyglass() {
  const m = materials(), g = new THREE.Group();
  const top = new THREE.Vector3(0, 0.46, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.3, foot = new THREE.Vector3(Math.cos(a) * 0.26, 0, Math.sin(a) * 0.26);
    const len = foot.distanceTo(top);
    const leg = mesh(new THREE.CylinderGeometry(0.012, 0.016, len, 6), M.woodDark);
    leg.position.copy(foot).add(top).multiplyScalar(0.5);
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(foot).normalize());
    g.add(leg);
  }
  const scope = new THREE.Group();
  let x = -0.22;
  for (const [r, l] of [[0.05, 0.26], [0.042, 0.2], [0.034, 0.16]]) {
    const tube = mesh(new THREE.CylinderGeometry(r, r, l, 16), M.goldDull, [x + l / 2, 0, 0]);
    tube.rotation.z = Math.PI / 2;
    const ring = mesh(new THREE.TorusGeometry(r + 0.004, 0.008, 6, 16), M.gold, [x + l, 0, 0]);
    ring.rotation.y = Math.PI / 2;
    scope.add(tube, ring);
    x += l - 0.02;
  }
  const lens = mesh(new THREE.CircleGeometry(0.048, 16), m.lens, [-0.222, 0, 0]);
  lens.rotation.y = -Math.PI / 2;
  scope.add(lens);
  scope.position.copy(top).add(new THREE.Vector3(0, 0.04, 0));
  scope.rotation.z = -0.4;
  g.add(scope);
  return g;
}

// Eager Student: a stack of books.
function books() {
  const m = materials(), g = new THREE.Group();
  let y = 0;
  for (const [w, h, d, color, turn] of [[0.52, 0.1, 0.38, 0x6e1a1a, 0.1], [0.46, 0.085, 0.34, 0x1f3f6b, -0.18], [0.42, 0.11, 0.3, 0x2f5a2a, 0.3]]) {
    const book = new THREE.Group();
    book.add(mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.7 })));
    book.add(mesh(new THREE.BoxGeometry(w - 0.03, h - 0.025, d - 0.01), m.pages, [0.02, 0, 0]));
    book.add(mesh(new THREE.BoxGeometry(0.02, h + 0.004, d + 0.004), M.goldDull, [-w / 2 + 0.05, 0, 0]));
    book.position.y = y + h / 2;
    book.rotation.y = turn;
    g.add(book);
    y += h;
  }
  return g;
}

// Pillar of the Court: a marble column with a crown on top.
function column() {
  const m = materials(), g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.42, 0.06, 0.42), m.marble, [0, 0.03, 0]));
  g.add(mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.06, 16), m.marble, [0, 0.09, 0]));
  g.add(mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.86, 16), m.marble, [0, 0.55, 0]));
  g.add(mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.06, 16), m.marble, [0, 1.01, 0]));
  g.add(mesh(new THREE.BoxGeometry(0.38, 0.05, 0.38), m.marble, [0, 1.065, 0]));
  const crown = makeCrown(2.2);
  crown.position.y = 1.09;
  g.add(crown);
  return g;
}

// Courtier: a jewelled goblet.
function goblet() {
  const g = buildGoblet();
  g.scale.setScalar(0.85);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return new THREE.Group().add(g);
}

// Golden Age: stacks of gold coins.
function coins() {
  const g = new THREE.Group();
  for (const [x, z, n, s] of [[-0.14, 0.05, 11, 2], [0.15, -0.08, 7, 3], [0.06, 0.2, 14, 4], [-0.08, -0.22, 4, 5]]) {
    const st = buildCoinStack(n, s);
    st.position.set(x, 0, z);
    g.add(st);
  }
  return g;
}

// Six Realms: a hexagon of the six terrains in a golden frame.
function sixRealms() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.36, 0.38, 0.06, 6), M.goldDull, [0, 0.03, 0]));
  ['wheat', 'forest', 'lake', 'grass', 'swamp', 'mine'].forEach((terrain, i) => {
    const wedge = new THREE.CylinderGeometry(0.31, 0.31, 0.05, 1, 1, false, (i * Math.PI) / 3, Math.PI / 3);
    g.add(mesh(wedge, new THREE.MeshStandardMaterial({ color: TERRAIN_INFO[terrain].color, roughness: 0.7 }), [0, 0.07, 0]));
  });
  const crown = makeCrown(1.6);
  crown.position.y = 0.095;
  g.add(crown);
  return g;
}

// Among Friends: two tankards side by side.
function tankards() {
  const m = materials(), g = new THREE.Group();
  for (const [x, z, turn] of [[-0.15, 0.03, 0.4], [0.16, -0.04, 2.6]]) {
    const t = new THREE.Group();
    t.add(mesh(new THREE.CylinderGeometry(0.1, 0.115, 0.28, 18), m.pewter, [0, 0.14, 0]));
    t.add(mesh(new THREE.CylinderGeometry(0.098, 0.098, 0.02, 18), m.foam, [0, 0.285, 0]));
    const head = mesh(new THREE.SphereGeometry(0.1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), m.foam, [0, 0.29, 0]);
    head.scale.set(1, 0.35, 1);
    t.add(head);
    for (const y of [0.04, 0.24]) t.add(mesh(new THREE.TorusGeometry(0.108, 0.01, 6, 20), M.goldDull, [0, y, 0]).rotateX(Math.PI / 2));
    const handle = mesh(new THREE.TorusGeometry(0.07, 0.016, 6, 14, Math.PI), m.pewter, [0.11, 0.15, 0]);
    handle.rotation.z = -Math.PI / 2;
    t.add(handle);
    t.position.set(x, 0, z);
    t.rotation.y = turn;
    g.add(t);
  }
  return g;
}

// The achievements that stand on the table, by id: how to make each, and how tall it stands (the
// short ones go nearest the player, so the tall ones never hide them).
export const TROPHIES = {
  'first-win': { build: crownOnCushion, h: 0.6 },
  'beat-expert': { build: swordInStone, h: 1.4 },
  duel: { build: shieldAndSwords, h: 1.0 },
  dynasty: { build: banner, h: 1.9 },
  'hat-trick': { build: wreath, h: 0.8 },
  'among-friends': { build: tankards, h: 0.35 },
  'score-80': { build: coins, h: 0.5 },
  jewel: { build: jewel, h: 0.5 },
  'crowns-13': { build: treasure, h: 0.5 },
  'six-terrains': { build: sixRealms, h: 0.2 },
  flawless: { build: goldenCastle, h: 1.0 },
  sharp: { build: spyglass, h: 0.7 },
  student: { build: books, h: 0.3 },
  'games-50': { build: goblet, h: 0.8 },
  'games-100': { build: column, h: 1.3 },
  'wins-25': { build: cup, h: 0.72 },
};

export const hasTrophy = (id) => id in TROPHIES;

// One trophy, made for a player of this colour.
export function buildTrophy(id, color) {
  const g = TROPHIES[id].build(color);
  const gold = materials().gold;
  g.traverse((o) => { if (o.isMesh && o.material === M.gold) o.material = gold; });
  g.userData.trophy = id;
  return g;
}

// Where the trophies stand, in the seat's own frame (the mat centred on the origin, the player at +z):
// rows of four beside the mat on the player's right, from the player's edge of the mat back, the
// shortest first. ids: the trophies to place, in any order; matSize: the mat's width.
export const PER_ROW = 4;
export function trophyLayout(ids, matSize) {
  const sorted = ids.slice().sort((a, b) => TROPHIES[a].h - TROPHIES[b].h);
  return new Map(sorted.map((id, i) => {
    const row = Math.floor(i / PER_ROW), col = i % PER_ROW;
    return [id, new THREE.Vector3(matSize / 2 + 0.85 + col * 1.1, 0, matSize / 2 - 0.45 - row * 1.15)];
  }));
}
