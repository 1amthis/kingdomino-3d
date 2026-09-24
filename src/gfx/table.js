// The tabletop world: varnished table, candles, trinkets, the drafting board and the tile chest.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { makeTableTextures, makeMatTexture, makeDraftTexture, makeFeltTexture, makeBackTexture } from './textures.js';
import { M } from './materials.js';
import { buildCandle, buildGoblet, buildCoinStack, buildScroll, makeCrown, TILE_H } from './pieces.js';

export const TABLE = { w: 40, d: 38 };

export function buildTable(stage) {
  const scene = stage.scene;
  const group = new THREE.Group();
  const { map, bump } = makeTableTextures();
  const topMat = new THREE.MeshPhysicalMaterial({
    map, bumpMap: bump, bumpScale: 1.2, roughness: 0.5, clearcoat: 0.55, clearcoatRoughness: 0.28,
  });
  const top = new THREE.Mesh(new THREE.BoxGeometry(TABLE.w, 1.2, TABLE.d), [
    new THREE.MeshStandardMaterial({ color: 0x3a2213, roughness: 0.7 }),
    new THREE.MeshStandardMaterial({ color: 0x3a2213, roughness: 0.7 }),
    topMat,
    new THREE.MeshStandardMaterial({ color: 0x2a180c }),
    new THREE.MeshStandardMaterial({ color: 0x3a2213, roughness: 0.7 }),
    new THREE.MeshStandardMaterial({ color: 0x3a2213, roughness: 0.7 }),
  ]);
  top.position.y = -0.6;
  top.receiveShadow = true;
  group.add(top);
  // carved rim
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x4a2a16, roughness: 0.55 });
  for (const [x, z, w, d] of [[0, TABLE.d / 2, TABLE.w + 1, 0.8], [0, -TABLE.d / 2, TABLE.w + 1, 0.8], [TABLE.w / 2, 0, 0.8, TABLE.d], [-TABLE.w / 2, 0, 0.8, TABLE.d]]) {
    const rim = new THREE.Mesh(new RoundedBoxGeometry(w, 0.5, d, 2, 0.18), rimMat);
    rim.position.set(x, -0.05, z);
    rim.castShadow = rim.receiveShadow = true;
    group.add(rim);
  }
  // floor far below, just to catch light at glancing views
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x15100c, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -9;
  group.add(floor);
  scene.add(group);

  // Candles in the four corners.
  const candles = [];
  const cpos = [[-17, 0, -15.5, 1.9], [17, 0, -15.5, 1.3], [-17.5, 0, 15.5, 1.1], [17.5, 0, 15, 1.6]];
  cpos.forEach(([x, y, z, h], i) => {
    const c = buildCandle(h, i + 3);
    c.group.position.set(x, y, z);
    scene.add(c.group);
    candles.push(c);
    stage.onFrame((t) => c.update(t));
  });

  // Trinkets
  const goblet = buildGoblet();
  goblet.scale.setScalar(1.6);
  goblet.position.set(15.5, 0, -12);
  scene.add(goblet);
  const coins = [[14.3, -14.2, 7], [13.6, -13.1, 4], [15.0, -13.6, 10]];
  coins.forEach(([x, z, n], i) => { const s = buildCoinStack(n, i + 2); s.position.set(x, 0, z); scene.add(s); });
  const scroll = buildScroll();
  scroll.position.set(-15.2, 0, 13.2);
  scroll.rotation.y = 0.5;
  scroll.scale.setScalar(1.4);
  scene.add(scroll);
  const bigCrown = makeCrown(9);
  bigCrown.position.set(-15.5, 0.02, -12.4);
  bigCrown.rotation.set(0.0, 0.6, 0.0);
  scene.add(bigCrown);
  bigCrown.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  return { group, candles };
}

export function makeMat(colorHex, name, sizeCells) {
  const S = 2 * sizeCells - 1 + 0.9;
  const g = new THREE.Group();
  const edge = new THREE.Mesh(new RoundedBoxGeometry(S + 0.12, 0.05, S + 0.12, 2, 0.05), new THREE.MeshStandardMaterial({ color: 0x1c140e, roughness: 0.6 }));
  edge.position.y = 0.0;
  edge.receiveShadow = true;
  const felt = makeFeltTexture();
  felt.repeat.set(6, 6);
  const topMat = new THREE.MeshStandardMaterial({ map: makeMatTexture(colorHex, name), roughness: 0.95, bumpMap: felt, bumpScale: 0.6 });
  const top = new THREE.Mesh(new THREE.PlaneGeometry(S, S), topMat);
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.026;
  top.receiveShadow = true;
  g.add(edge, top);
  g.userData.size = S;
  return g;
}

// Draft board geometry helpers (world space; board is aligned with the south seat).
export function draftLayout(n) {
  const spacing = 1.28;
  const slotX = [-1.6, 1.6];
  const kingX = [-3.05, 3.05];
  const zs = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * spacing);
  const top = zs[0] - 0.5 - 1.05, bottom = zs[n - 1] + 0.5 + 0.45;
  const W = 7.4, D = bottom - top;
  const cz = (top + bottom) / 2;
  return { spacing, slotX, kingX, zs, W, D, cz, top, bottom };
}

export function makeDraftBoard(n) {
  const L = draftLayout(n);
  const slots = [];
  for (const sx of L.slotX) for (const z of L.zs) {
    const u0 = (sx - 1.03 + L.W / 2) / L.W, u1 = (sx + 1.03 + L.W / 2) / L.W;
    const v0 = (z - 0.53 - L.top) / L.D, v1 = (z + 0.53 - L.top) / L.D;
    slots.push({ u0, u1, v0, v1 });
  }
  const tex = makeDraftTexture(slots, 1024, Math.round(1024 * L.D / L.W));
  const g = new THREE.Group();
  const edge = new THREE.Mesh(new RoundedBoxGeometry(L.W + 0.14, 0.06, L.D + 0.14, 2, 0.05), new THREE.MeshStandardMaterial({ color: 0x2a0a0c, roughness: 0.5 }));
  edge.receiveShadow = true;
  const felt = makeFeltTexture();
  felt.repeat.set(5, 5);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(L.W, L.D), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, bumpMap: felt, bumpScale: 0.5, sheen: 1 }));
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.031;
  top.receiveShadow = true;
  g.add(edge, top);
  g.position.z = L.cz;
  return { group: g, layout: L };
}

// Iron-bound oak chest that holds the draw pile; tile edges inside show how many remain.
export function makeChest() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a3519, roughness: 0.65 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x3a3a40, metalness: 0.8, roughness: 0.45 });
  const velvet = new THREE.MeshStandardMaterial({ color: 0x6a0f1a, roughness: 1 });
  const W = 2.5, D = 1.35, H = 0.95, t = 0.09;
  const parts = [
    [W, t, D, 0, t / 2, 0], [W, H, t, 0, H / 2, D / 2 - t / 2], [W, H, t, 0, H / 2, -D / 2 + t / 2],
    [t, H, D, W / 2 - t / 2, H / 2, 0], [t, H, D, -W / 2 + t / 2, H / 2, 0],
  ];
  for (const [w, h, d, x, y, z] of parts) {
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, 0.025), wood);
    m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m);
  }
  const inside = new THREE.Mesh(new THREE.PlaneGeometry(W - 2 * t, D - 2 * t), velvet);
  inside.rotation.x = -Math.PI / 2; inside.position.y = t + 0.01; g.add(inside);
  // iron straps on the outer faces only, so the opening stays clear
  for (const x of [-W / 2 + 0.35, W / 2 - 0.35]) {
    for (const z of [D / 2 + 0.012, -D / 2 - 0.012]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.12, H + 0.02, 0.024), iron);
      strap.position.set(x, H / 2, z); strap.castShadow = true; g.add(strap);
    }
  }
  // a gilded rim along the top of the walls (a frame, not a cover)
  for (const [w, d, x, z] of [[W + 0.03, t + 0.03, 0, D / 2 - t / 2], [W + 0.03, t + 0.03, 0, -D / 2 + t / 2],
    [t + 0.03, D + 0.03, W / 2 - t / 2, 0], [t + 0.03, D + 0.03, -W / 2 + t / 2, 0]]) {
    const rim = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), M.goldDull);
    rim.position.set(x, H, z); g.add(rim);
  }
  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.26, 0.05), M.goldDull);
  lock.position.set(0, H - 0.2, D / 2 + 0.03); g.add(lock);
  // open lid hinged at the back
  const lid = new THREE.Group();
  const lidShape = new THREE.Mesh(new THREE.CylinderGeometry(D / 2, D / 2, W, 20, 1, false, 0, Math.PI), wood);
  lidShape.rotation.z = Math.PI / 2;
  lidShape.castShadow = true;
  // the underside: a wooden frame as thick as the walls, gilded like the chest's rim, lined with velvet
  const lidFrame = [[W, t, 0, D / 2 - t / 2], [W, t, 0, -D / 2 + t / 2], [t, D - 2 * t, W / 2 - t / 2, 0], [t, D - 2 * t, -W / 2 + t / 2, 0]];
  for (const [w, d, x, z] of lidFrame) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.07, d), wood);
    bar.position.set(x, -0.035, z); bar.castShadow = true; lid.add(bar);
    const gild = new THREE.Mesh(new THREE.BoxGeometry(w + 0.03, 0.03, d + 0.03), M.goldDull);
    gild.position.set(x, -0.07, z); lid.add(gild);
  }
  const lidIn = new THREE.Mesh(new THREE.PlaneGeometry(W - 2 * t, D - 2 * t), velvet);
  lidIn.rotation.x = Math.PI / 2; lidIn.position.y = -0.004;
  const lidBand = new THREE.Mesh(new THREE.CylinderGeometry(D / 2 + 0.02, D / 2 + 0.02, 0.12, 20, 1, false, 0, Math.PI), iron);
  lidBand.rotation.z = Math.PI / 2;
  const lidBand2 = lidBand.clone();
  lidBand.position.x = -W / 2 + 0.35; lidBand2.position.x = W / 2 - 0.35;
  lid.add(lidShape, lidIn, lidBand, lidBand2);
  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, H, -D / 2);
  lid.position.z = D / 2;
  lidPivot.add(lid);
  lidPivot.rotation.x = -1.95;
  g.add(lidPivot);
  // Tiles standing inside, leaning towards the back wall; how many stand shows how full the chest is.
  // As many as fit between the walls: each leaning tile reaches `reach` either side of its centre.
  const tileH = 0.8, lean = 0.12, gap = 0.012;
  const reach = TILE_H / 2 + (tileH / 2) * Math.sin(lean);
  const z0 = -D / 2 + t + reach + 0.01, step = TILE_H / Math.cos(lean) + gap;
  const SLOTS = Math.floor((D / 2 - t - reach - 0.01 - z0) / step) + 1;
  const tileGeo = new THREE.BoxGeometry(1.9, tileH, TILE_H);
  const backMat = new THREE.MeshStandardMaterial({ map: makeBackTexture(''), roughness: 0.5 });
  const edges = new THREE.InstancedMesh(tileGeo, [M.wood, M.wood, M.wood, M.wood, backMat, M.wood], SLOTS);
  edges.castShadow = true;
  const mtx = new THREE.Matrix4();
  for (let i = 0; i < SLOTS; i++) {
    mtx.makeRotationX(-lean);
    mtx.setPosition(0, t + 0.012 + (tileH / 2) * Math.cos(lean), z0 + i * step);
    edges.setMatrixAt(i, mtx);
  }
  g.add(edges);
  g.userData.setCount = (remaining, total) => {
    edges.count = total ? Math.min(SLOTS, Math.ceil((remaining / total) * SLOTS)) : 0;
  };
  g.userData.mouth = new THREE.Vector3(0, H + 0.6, 0);
  return g;
}
