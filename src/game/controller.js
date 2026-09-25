// Orchestrates a game: rules state, 3D pieces, animations, camera work and player input.
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { DOMINOES, Kingdom, DIRS, footprint, kingsPerPlayer, lineSize, deckSize, rank, TERRAIN_INFO } from '../core/rules.js';
import { choosePlacement, chooseSlot } from '../core/ai.js';
import { Rng } from '../core/rng.js';
import { DominoView } from '../gfx/domino.js';
import { buildCastle, buildKing, TILE_H } from '../gfx/pieces.js';
import { makeMat, makeDraftBoard, makeChest } from '../gfx/table.js';
import { M } from '../gfx/materials.js';
import { Ease } from '../gfx/tween.js';
import { CROWN_SVG } from '../ui/hud.js';
import { LEFT } from '../net/online.js';

const SURFACE = 0.032;
const REST = SURFACE + TILE_H;
const HOVER = 0.55;
const UP = new THREE.Vector3(0, 1, 0);
const XAXIS = new THREE.Vector3(1, 0, 0);
export const CANCEL = Symbol('cancel');

const quatY = (a) => new THREE.Quaternion().setFromAxisAngle(UP, a);
const quatFaceDown = (a) => quatY(a).multiply(new THREE.Quaternion().setFromAxisAngle(XAXIS, Math.PI));

class Flow {
  constructor() { this.alive = true; }
  async w(p) { const r = await p; if (!this.alive) throw CANCEL; return r; }
}

function label(html, cls) {
  const div = document.createElement('div');
  div.className = cls;
  div.innerHTML = html;
  return new CSS2DObject(div);
}

export class Controller {
  constructor(stage, effects, sound, hud) {
    this.stage = stage; this.fx = effects; this.sound = sound; this.hud = hud;
    this.tw = stage.tweener;
    this.views = new Map();
    this.activeViews = new Set();
    this.world = new THREE.Group();
    stage.scene.add(this.world);
    this.settings = { speed: 1, camera: 'auto', hints: true };
    this.players = [];
    this.kings = [];
    this.mode = null;
    this.flow = null;
    this.demo = false;
    this.link = null; // online session: remote seats' moves come from it, ours go out through it
    this.pointerNdc = new THREE.Vector2(9, 9);
    this.pointerPx = { x: 0, y: 0 };
    this.touch = matchMedia('(pointer: coarse)').matches; // hints speak of taps rather than clicks and keys
    this.tipsShown = {}; // how often each turn tip has been shown since the page opened
    this.raycaster = new THREE.Raycaster();
    this.restPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -REST);
    // The camera is "held" once the player looks around on their own: the automatic camera then
    // leaves it alone while others play, until the player's next move or until they ask to follow again.
    this.camHeld = false;
    this.viewName = null; // the dock view the camera is showing ('table', 'draft', a seat index…)
    this.shot = null; // what the automatic camera wants to show right now
    this.makeMarkers();
    this.setupInput();
    stage.onFrame((t, dt) => this.frame(t, dt));
  }

  // ---------- assets ----------
  async buildViews(onProgress) {
    for (let i = 0; i < DOMINOES.length; i++) {
      const d = DOMINOES[i];
      this.views.set(d.id, new DominoView(d));
      if (i % 3 === 2) { onProgress && onProgress((i + 1) / DOMINOES.length); await new Promise((r) => setTimeout(r, 0)); }
    }
  }

  getView(domino) {
    const v = this.views.get(domino.id);
    if (!v.group.parent) this.world.add(v.group);
    this.activeViews.add(v);
    v.group.scale.setScalar(1);
    v.group.visible = true;
    v.visibleDetail = true;
    v.detail.visible = true;
    v.setGlow(null, 0);
    return v;
  }

  sfx(name, ...args) { if (!this.demo) this.sound[name](...args); }

  // A human sitting at this screen (not a friend playing online).
  isLocal(p) { return p.type === 'human' && !p.remote; }

  // ---------- scene furniture for a game ----------
  makeMarkers() {
    const geo = new THREE.PlaneGeometry(0.94, 0.94);
    geo.rotateX(-Math.PI / 2);
    this.footMarkers = [0, 1].map(() => {
      const m = new THREE.Mesh(geo, M.ghostOk);
      m.renderOrder = 3;
      m.visible = false;
      return m;
    });
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    for (let i = 0; i < 14; i++) {
      x.strokeStyle = `rgba(255,255,255,${0.08 + i * 0.05})`;
      x.lineWidth = 2;
      x.beginPath(); x.roundRect(8 + i, 8 + i, 112 - 2 * i, 112 - 2 * i, 18); x.stroke();
    }
    x.fillStyle = 'rgba(255,255,255,0.18)';
    x.beginPath(); x.roundRect(22, 22, 84, 84, 10); x.fill();
    const tex = new THREE.CanvasTexture(c);
    const hintMat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.4, 1.15, 0.6), transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending });
    this.hintMat = hintMat;
    const hintGeo = new THREE.PlaneGeometry(0.9, 0.9);
    hintGeo.rotateX(-Math.PI / 2);
    this.hintMesh = new THREE.InstancedMesh(hintGeo, hintMat, 200);
    this.hintMesh.count = 0;
    this.hintMesh.renderOrder = 2;
    this.hintMesh.frustumCulled = false;
  }

  computeSeats(n, size) {
    const Ms = 2 * size - 1 + 0.9;
    const keys = n === 2 ? ['S', 'N'] : n === 3 ? ['S', 'W', 'E'] : ['S', 'W', 'N', 'E'];
    const D = n === 2 ? 3.7 + Ms / 2 : Math.max(Ms + 0.45, 3.7 + Ms / 2);
    const defs = { S: [0, 1, 0], N: [0, -1, Math.PI], W: [-1, 0, -Math.PI / 2], E: [1, 0, Math.PI / 2] };
    return keys.map((k) => {
      const [dx, dz, rotY] = defs[k];
      return { key: k, pos: new THREE.Vector3(dx * D, 0, dz * D), dir: new THREE.Vector3(dx, 0, dz), rotY, matSize: Ms };
    });
  }

  clearGame() {
    if (this.flow) this.flow.alive = false;
    if (this.mode && this.mode.reject) this.mode.reject(CANCEL);
    this.mode = null;
    this.tw.clear('game');
    this.hud.setActions(null);
    this.hud.tooltip(null);
    for (const v of this.activeViews) { v.group.removeFromParent(); v.setGlow(null, 0); v.glow.material.opacity = 0; }
    this.activeViews.clear();
    // CSS2D elements only detach themselves when removed directly, so sweep nested ones too
    this.world.traverse((o) => { if (o.isCSS2DObject && o.element.parentNode) o.element.remove(); });
    while (this.world.children.length) this.world.children[0].removeFromParent();
    this.players = [];
    this.kings = [];
    this.current = [];
    this.next = [];
    this.footMarkers.forEach((m) => { m.visible = false; });
    this.hintMesh.count = 0;
    this.camHeld = false;
    this.viewName = null;
    this.shot = null;
  }

  async startGame(config, { demo = false, link = null } = {}) {
    this.clearGame();
    const flow = this.flow = new Flow();
    this.demo = demo;
    this.link = demo ? null : link;
    this.config = config;
    this.finished = false; // true from the reckoning on: leaving then loses nothing
    this.tw.speed = demo ? 2.4 : this.settings.speed;
    const n = config.seats.length;
    const size = config.mightyDuel ? 7 : 5;
    this.opts = { middleKingdom: config.middleKingdom, harmony: config.harmony, size };
    this.rng = new Rng();
    // Dealing has its own seeded stream so every table in an online game draws the same tiles.
    const deal = new Rng(config.seed ?? this.rng.int(0, 2 ** 32 - 1));
    this.lineN = lineSize(n);
    const seats = this.computeSeats(n, size);
    this.players = config.seats.map((s, i) => ({ ...s, index: i, kingdom: new Kingdom(size), seat: seats[i], kings: [], views: [] }));
    this.humans = this.players.filter((p) => this.isLocal(p));
    this.lastHuman = null;
    this.camKey = null;

    // table furniture
    const board = makeDraftBoard(this.lineN);
    this.board = board;
    this.L = board.layout;
    this.world.add(board.group);
    this.chest = makeChest();
    if (n === 2) { this.chest.position.set(6.3, 0, -0.2); this.chest.rotation.y = -Math.PI / 2; this.discardBase = new THREE.Vector3(6.3, 0, 2.6); }
    else { this.chest.position.set(0, 0, this.L.top - 1.25); this.discardBase = new THREE.Vector3(3.6, 0, this.L.top - 1.2); }
    this.world.add(this.chest);
    this.chestLabel = label('', 'chest-count');
    this.chestLabel.position.set(0, 1.9, 0);
    this.chest.add(this.chestLabel);
    this.discards = 0;

    this.deck = deal.shuffle(DOMINOES.slice()).slice(0, deckSize(n, config.mightyDuel));
    this.deckTotal = this.deck.length;
    this.updateChest();
    this.totalRounds = this.deckTotal / this.lineN;

    for (const p of this.players) this.setupPlayer(p);
    this.kings = this.players.flatMap((p) => p.kings);
    // In a duel the opening picks snake (A, B, B, A) so neither lord gets the first two choices.
    if (n === 2) {
      const [a, b] = deal.shuffle(this.players.slice());
      this.openingOrder = [a.kings[0], b.kings[0], b.kings[1], a.kings[1]];
    } else this.openingOrder = deal.shuffle(this.kings.slice());

    if (!demo) {
      this.hud.setPlayers(this.players, this.humans);
      this.syncCamera();
      this.hud.showHud();
      this.hud.setRound(`Round 1 of ${this.totalRounds}`);
      this.hud.prompt('Setting up…');
      this.stage.controls.autoRotate = false;
    }
    try {
      await this.introAnimation(flow);
      await this.runGame(flow);
      return flow.alive;
    } catch (e) {
      if (e !== CANCEL) throw e;
      return false;
    }
  }

  setupPlayer(p) {
    const s = p.seat;
    const root = new THREE.Group();
    root.position.copy(s.pos);
    root.rotation.y = s.rotY;
    this.world.add(root);
    root.updateMatrixWorld(true);
    p.root = root;
    const mat = makeMat(p.color, p.name, this.opts.size);
    root.add(mat);
    p.mat = mat;
    const castle = buildCastle(p.color, 17 + p.index);
    castle.group.position.set(0, REST, 0);
    castle.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    root.add(castle.group);
    p.castle = castle;
    // an inner body, so the plate can swell at the reckoning without disturbing the CSS2D placement
    const plate = label(`<div class="plate"><span style="color:${p.color}">&#9670;</span> ${p.name.replace(/</g, '&lt;')} <span class="pts">0</span></div>`, 'plate-anchor');
    plate.element.style.setProperty('--pc', p.color);
    plate.position.set(0, REST + 1.35, 0);
    root.add(plate);
    p.plate = plate;
    p.plateBody = plate.element.firstElementChild;
    this.makeGuides(p);
    const nk = kingsPerPlayer(this.players.length);
    for (let i = 0; i < nk; i++) {
      const g = new THREE.Group();
      const model = buildKing(p.color);
      model.scale.setScalar(1.15);
      g.add(model);
      const home = root.localToWorld(new THREE.Vector3(nk === 1 ? 0 : (i ? 0.5 : -0.5), SURFACE, s.matSize / 2 + 0.55));
      g.position.copy(home);
      g.rotation.y = Math.atan2(s.dir.x, s.dir.z);
      this.world.add(g);
      p.kings.push({ player: p, group: g, model, home, id: `${p.index}-${i}` });
    }
  }

  makeGuides(p) {
    const g = new THREE.Group();
    const col = new THREE.Color(p.color).multiplyScalar(1.8);
    const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
    const box = new THREE.BoxGeometry(1, 1, 1);
    const bars = [0, 1, 2, 3].map(() => { const m = new THREE.Mesh(box, mat); m.renderOrder = 2; g.add(m); return m; });
    const grid = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: 0.1, depthWrite: false }));
    g.add(grid);
    p.root.add(g);
    const r = p.kingdom.allowedRect();
    p.guides = { group: g, bars, grid, mat, rect: { ...r } };
    this.setGuideRect(p, r);
    this.rebuildGrid(p, r);
  }

  setGuideRect(p, r) {
    const x0 = r.x0 - 0.5, x1 = r.x1 + 0.5, z0 = r.y0 - 0.5, z1 = r.y1 + 0.5;
    const y = SURFACE + 0.004, t = 0.05, h = 0.01;
    const [a, b, c, d] = p.guides.bars;
    a.position.set((x0 + x1) / 2, y, z0); a.scale.set(x1 - x0 + t, h, t);
    b.position.set((x0 + x1) / 2, y, z1); b.scale.set(x1 - x0 + t, h, t);
    c.position.set(x0, y, (z0 + z1) / 2); c.scale.set(t, h, z1 - z0 + t);
    d.position.set(x1, y, (z0 + z1) / 2); d.scale.set(t, h, z1 - z0 + t);
  }

  rebuildGrid(p, r) {
    const pts = [];
    const y = SURFACE + 0.003;
    for (let x = r.x0 - 0.5; x <= r.x1 + 0.51; x++) pts.push(x, y, r.y0 - 0.5, x, y, r.y1 + 0.5);
    for (let z = r.y0 - 0.5; z <= r.y1 + 0.51; z++) pts.push(r.x0 - 0.5, y, z, r.x1 + 0.5, y, z);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    p.guides.grid.geometry.dispose();
    p.guides.grid.geometry = geo;
  }

  updateGuides(p) {
    const from = { ...p.guides.rect };
    const to = p.kingdom.allowedRect();
    p.guides.rect = { ...to };
    this.rebuildGrid(p, to);
    return this.tw.add({
      duration: 600, ease: Ease.outBack,
      update: (t) => {
        const r = {};
        for (const k of ['x0', 'x1', 'y0', 'y1']) r[k] = from[k] + (to[k] - from[k]) * t;
        this.setGuideRect(p, r);
      },
    });
  }

  updateChest() {
    this.chest.userData.setCount(this.deck.length, this.deckTotal);
    this.chestLabel.element.textContent = this.deck.length ? `${this.deck.length} dominoes left` : 'No dominoes left';
  }

  // ---------- positions ----------
  slotPos(col, i) { return new THREE.Vector3(this.L.slotX[col], REST, this.L.zs[i]); }
  kingSpot(col, i) { return new THREE.Vector3(this.L.kingX[col], SURFACE + 0.001, this.L.zs[i]); }

  placementTransform(p, { x, y, rot }, lift = 0) {
    const [dx, dy] = DIRS[rot];
    const local = new THREE.Vector3(x + dx / 2, REST + lift, y + dy / 2);
    return { pos: p.root.localToWorld(local), quat: quatY(p.seat.rotY - rot * Math.PI / 2) };
  }

  cellWorld(p, x, y, h = REST) { return p.root.localToWorld(new THREE.Vector3(x, h, y)); }

  get far() { return Math.max(1, 1.5 / this.stage.camera.aspect); }
  get boardCenter() { return new THREE.Vector3(0, 0, this.L.cz); }

  // Wide shot from a player's chair: their kingdom in front, the board beyond.
  seatView(p) {
    const s = p.seat;
    const big = this.opts.size === 7 ? 1.32 : 1;
    const target = s.pos.clone().multiplyScalar(0.52);
    const pos = s.pos.clone().add(s.dir.clone().multiplyScalar(8.2 * big * this.far)).add(new THREE.Vector3(0, 15.5 * big * this.far, 0));
    return { pos, target };
  }

  // Looking down on one's own kingdom while building.
  placeView(p) {
    const K = p.seat.pos, d = p.seat.dir, f = this.far;
    const big = this.opts.size === 7 ? 1.3 : 1;
    const r = p.kingdom.allowedRect();
    const [cx, cy] = [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2];
    const c = p.root.localToWorld(new THREE.Vector3(cx * 0.5, 0, cy * 0.5));
    return { pos: c.clone().add(d.clone().multiplyScalar(6.2 * f * big)).add(new THREE.Vector3(0, 11.5 * f * big, 0)), target: c.clone().sub(d.clone().multiplyScalar(0.9)) };
  }

  overview() {
    const far = Math.max(1, 1.5 / this.stage.camera.aspect);
    const n = this.players.length;
    const k = (n === 2 ? (this.opts.size === 7 ? 1.25 : 1.0) : 1.2) * far;
    return { pos: new THREE.Vector3(0, 33 * k, 21 * k), target: new THREE.Vector3(0, 0, 1.5) };
  }

  // Over a lord's shoulder, framed on what they have built so far.
  realmView(p) {
    const k = p.kingdom;
    const span = Math.max(k.maxX - k.minX, k.maxY - k.minY) + 1;
    const c = p.root.localToWorld(new THREE.Vector3((k.minX + k.maxX) / 2, 0, (k.minY + k.maxY) / 2));
    const r = (6.5 + span * 1.1) * Math.max(1, 1.3 / this.stage.camera.aspect);
    return { pos: c.clone().add(p.seat.dir.clone().multiplyScalar(r * 0.42)).add(new THREE.Vector3(0, r * 0.9, 0)), target: c };
  }

  // Nearly straight down on the drafting board, from a local lord's side of the table.
  draftView(p = this.viewer) {
    const B = this.boardCenter, f = this.far;
    const d = p ? p.seat.dir : new THREE.Vector3(0, 0, 1);
    return { pos: B.clone().add(d.clone().multiplyScalar(3.6 * f)).add(new THREE.Vector3(0, 11 * f, 0)), target: B.clone().add(d.clone().multiplyScalar(0.2)) };
  }

  // The local lord whose eyes the camera borrows.
  get viewer() {
    const p = this.mode && this.mode.player;
    return (p && this.isLocal(p) ? p : null) || this.lastHuman || this.humans[0] || null;
  }

  async focus(flow, key, view, duration = 1300, own = false) {
    if (this.demo) return;
    this.shot = { key, view };
    if (this.settings.camera !== 'auto' || (this.camHeld && !own)) return;
    this.holdCamera(false);
    if (this.camKey === key) return;
    this.camKey = key;
    const v = view();
    const cam = this.stage.camera.position, tgt = this.stage.controls.target;
    if (cam.distanceTo(v.pos) < 0.6 && tgt.distanceTo(v.target) < 0.6) return;
    await flow.w(this.stage.flyTo(v.pos, v.target, duration));
  }

  // ---------- camera views the player picks ----------
  holdCamera(on) {
    if (on && !this.camHeld && !this.holdHinted && this.settings.camera === 'auto' && !this.demo) {
      this.holdHinted = true;
      this.hud.toast(this.touch ? 'Free camera &middot; tap the crosshair to follow the game again'
        : 'Free camera &middot; press <kbd>F</kbd> to follow the game again', 3.2);
    }
    this.camHeld = on;
    if (!on) this.viewName = null;
    this.syncCamera();
  }

  syncCamera() {
    const auto = this.settings.camera === 'auto';
    if (!this.demo) this.hud.setCamera({ follow: auto && !this.camHeld, held: auto && this.camHeld, view: this.viewName });
  }

  // 'table', 'draft', 'seat' (the viewer's chair) or a seat index for that lord's realm.
  showView(name) {
    if (this.demo || !this.players.length) return;
    const p = typeof name === 'number' ? this.players[name] : null;
    if (typeof name === 'number' && !p) return;
    const v = p ? this.realmView(p) : name === 'table' ? this.overview() : name === 'draft' ? this.draftView()
      : this.seatView(this.viewer || this.players[0]);
    this.holdCamera(true);
    this.viewName = name;
    this.camKey = 'view:' + name;
    this.syncCamera();
    this.stage.flyTo(v.pos, v.target, 1000);
  }

  toggleOverview() { this.showView(this.viewName === 'table' || this.camKey === 'overview' ? 'seat' : 'table'); }

  // Back to the automatic camera, straight to whatever it would be showing now.
  followPlay() {
    if (this.demo || !this.players.length) return;
    this.holdCamera(false);
    const s = this.shot || { key: 'overview', view: () => this.overview() };
    this.camKey = s.key;
    const v = s.view();
    this.stage.flyTo(v.pos, v.target, 1000);
  }

  // The player dragged or zoomed the camera themselves.
  takeCamera() {
    if (this.demo) return;
    this.stage.cancelFlight();
    this.camKey = 'user';
    this.viewName = null;
    this.holdCamera(true);
  }

  // The drafting board as the viewer sees it; the key changes with the side of the table.
  draftShot(p = this.viewer) { return { key: 'draft' + (p ? p.index : ''), view: () => this.draftView(p) }; }

  // Following play frames the action the way the camera dock does: every pick on the drafting board
  // (from the local lord's side), an opponent's placement on their own realm, and our own placement
  // on the whole space we have left to build in.
  async focusPlayer(flow, p, phase) {
    let key, view;
    const local = this.isLocal(p);
    const n = p.kingdom.placements.length;
    if (phase === 'select') ({ key, view } = this.draftShot(local ? p : this.viewer));
    else if (local) { key = 'place' + p.index + ':' + n; view = () => this.placeView(p); }
    else { key = 'realm' + p.index + ':' + n; view = () => this.realmView(p); }
    const fly = this.focus(flow, key, view, 1150, local);
    if (this.isLocal(p) && this.humans.length > 1 && this.lastHuman !== p && !this.demo) {
      this.lastHuman = p;
      await Promise.all([fly, flow.w(this.hud.passDevice(p))]);
    } else await fly;
    if (this.isLocal(p)) this.lastHuman = p;
  }

  // ---------- game flow ----------
  async introAnimation(flow) {
    if (!this.demo) {
      const o = this.overview();
      this.camKey = 'overview';
      this.shot = { key: 'overview', view: () => this.overview() };
      this.stage.flyTo(o.pos, o.target, 2200);
    }
    // castles drop in, mats unfurl
    const jobs = this.players.map(async (p, i) => {
      const cg = p.castle.group;
      const target = cg.position.clone();
      cg.position.y += 7;
      p.mat.scale.set(0.01, 1, 0.01);
      await flow.w(this.tw.wait(250 + i * 260));
      this.tw.move(p.mat, { scale: new THREE.Vector3(1, 1, 1), duration: 650, ease: Ease.outBack });
      await flow.w(this.tw.move(cg, { position: target, duration: 650, ease: Ease.inCubic }));
      this.sfx('thud', 1.2);
      this.fx.dust(this.cellWorld(p, 0, 0, SURFACE), { count: 34, spread: 0.8 });
      await flow.w(this.tw.move(cg, { scale: new THREE.Vector3(1.08, 0.9, 1.08), duration: 90, ease: Ease.outQuad }));
      await flow.w(this.tw.move(cg, { scale: new THREE.Vector3(1, 1, 1), duration: 280, ease: Ease.outElastic }));
    });
    await flow.w(Promise.all(jobs));
  }

  async runGame(flow) {
    if (!this.demo) this.hud.setRound('The opening draft');
    await this.drawLine(flow);
    for (const king of this.openingOrder) await this.selectPhase(flow, king);
    let round = 0;
    for (;;) {
      await this.advanceLine(flow);
      round++;
      this.setRoundLabel(round);
      if (this.deck.length) await this.drawLine(flow);
      for (const slot of this.current) {
        const king = slot.king;
        await this.placePhase(flow, king.player, slot);
        if (this.next.length) await this.selectPhase(flow, king, true);
        else await this.sendKingHome(flow, king);
      }
      this.current = [];
      if (!this.next.length) break;
    }
    await this.finalScoring(flow);
  }

  setRoundLabel(r) {
    if (this.demo) return;
    this.hud.setRound(r >= this.totalRounds ? `Final round · ${this.totalRounds} of ${this.totalRounds}` : `Round ${r} of ${this.totalRounds}`);
  }

  async drawLine(flow) {
    const drawn = this.deck.splice(0, this.lineN).sort((a, b) => a.id - b.id);
    this.updateChest();
    this.next = drawn.map((domino, index) => ({ domino, index, king: null, view: this.getView(domino) }));
    const mouth = this.chest.localToWorld(this.chest.userData.mouth.clone());
    if (!this.demo) this.hud.prompt('Drawing new dominoes');
    // the camera heads for the board while the first tiles leave the chest
    const { key, view } = this.draftShot();
    const framing = this.focus(flow, key, view, 1150);
    const flights = this.next.map(async (slot, i) => {
      const g = slot.view.group;
      g.position.copy(mouth);
      g.quaternion.copy(quatFaceDown(0));
      g.scale.setScalar(0.3);
      g.visible = false;
      await flow.w(this.tw.wait(i * 170));
      g.visible = true;
      this.sfx('whoosh', 0.4);
      const dest = this.slotPos(1, i).add(new THREE.Vector3(0, 0.75, 0));
      await flow.w(this.tw.move(g, { position: dest, scale: 1, duration: 750, arc: 1.6, ease: Ease.inOutCubic }));
    });
    await flow.w(Promise.all([...flights, framing]));
    await flow.w(this.tw.wait(200));
    const flips = this.next.map(async (slot, i) => {
      await flow.w(this.tw.wait(i * 190));
      this.sfx('flip');
      const g = slot.view.group;
      await flow.w(this.tw.move(g, { position: this.slotPos(1, i), quaternion: quatY(0), duration: 560, arc: 0.55, ease: Ease.inOutQuad }));
      if (slot.domino.squares.some((s) => s.crowns)) this.fx.sparkle(g.position, { count: 10 * slot.domino.squares.reduce((a, s) => a + s.crowns, 0), spread: 0.8, up: 1.2 });
    });
    await flow.w(Promise.all(flips));
  }

  async advanceLine(flow) {
    const moves = this.next.map(async (slot, i) => {
      await flow.w(this.tw.wait(i * 90));
      const kp = slot.king ? this.tw.move(slot.king.group, { position: this.kingSpot(0, i), duration: 700, arc: 0.4, ease: Ease.inOutCubic }) : null;
      await flow.w(this.tw.move(slot.view.group, { position: this.slotPos(0, i), duration: 700, arc: 0.35, ease: Ease.inOutCubic }));
      if (kp) await flow.w(kp);
    });
    if (this.next.length) this.sfx('whoosh', 0.5, 0.6);
    await flow.w(Promise.all(moves));
    this.current = this.next;
    this.next = [];
  }

  async moveKing(flow, king, dest, { arc = 1.3, duration = 750 } = {}) {
    const g = king.group;
    const face = Math.atan2(dest.x - g.position.x, dest.z - g.position.z);
    const q0 = g.quaternion.clone();
    const qMid = quatY(face);
    const qEnd = quatY(Math.atan2(king.player.seat.dir.x, king.player.seat.dir.z));
    this.tw.add({ duration: duration * 0.3, update: (t) => g.quaternion.slerpQuaternions(q0, qMid, t) });
    await flow.w(this.tw.move(g, { position: dest, duration, arc, ease: Ease.inOutQuad }));
    this.sfx('thud', 0.6);
    this.fx.dust(dest, { count: 8, spread: 0.1, color: 0xd8c8a8 });
    const m = king.model;
    this.tw.add({ duration: 360, ease: Ease.outElastic, update: (t) => { const s = 1.15 * (0.82 + 0.18 * t); m.scale.set(1.15 * (1.1 - 0.1 * t), s, 1.15 * (1.1 - 0.1 * t)); } });
    const qa = g.quaternion.clone();
    await flow.w(this.tw.add({ duration: 300, update: (t) => g.quaternion.slerpQuaternions(qa, qEnd, t) }));
  }

  async sendKingHome(flow, king) {
    await this.moveKing(flow, king, king.home, { arc: 2, duration: 900 });
  }

  // The move a remote seat made on another screen, or undefined when the AI should decide
  // (an AI seat on the host, or a friend who has left the table).
  async remoteMove(flow, p, kind) {
    if (!p.remote || !this.link) return undefined;
    const v = await flow.w(this.link.choose(p, kind));
    return v === LEFT ? undefined : v;
  }

  remoteNote(p) { return p.remote && p.type === 'human' ? 'Playing online' : ''; }

  // The one player at this screen reads "Your turn"; players sharing a screen are called by name.
  yourTurn(p) {
    return this.humans.length === 1 ? `<span class="who" style="color:${p.color}">Your turn</span> &middot; ` : `${this.hud.who(p)}, `;
  }

  // A tip under the prompt helps the first turns along, then steps aside.
  tip(kind, text) { return (this.tipsShown[kind] = (this.tipsShown[kind] || 0) + 1) <= 2 ? text : ''; }

  // placed: the king has just placed a domino this turn, so the pick follows on from it
  async selectPhase(flow, king, placed = false) {
    const p = king.player;
    const options = this.next.filter((s) => !s.king);
    if (!options.length) return;
    const local = this.isLocal(p);
    if (!this.demo) {
      this.hud.setActive(p);
      if (local) {
        this.hud.prompt(placed ? 'Now pick your next domino' : `${this.yourTurn(p)}pick a domino`,
          this.tip('select', 'Low numbers pick first next round · high numbers have more crowns'));
      } else this.hud.prompt(`${this.hud.who(p)} is picking a domino…`, this.remoteNote(p));
    }
    const framing = this.focusPlayer(flow, p, 'select');
    let slot;
    if (local) {
      await framing;
      this.sfx('turnChime');
      slot = await flow.w(this.humanSelect(p, options));
      // looking around during one's own turn does not outlast it
      if (this.camHeld) this.holdCamera(false);
    } else {
      // an opponent makes up their mind while the camera finds the board
      const decide = async () => {
        const pick = await this.remoteMove(flow, p, 'select');
        const remote = options.find((s) => s.index === pick);
        if (remote) return remote;
        await flow.w(this.tw.wait(420 + this.rng.float(0, 380)));
        const others = this.players.filter((o) => o !== p);
        return chooseSlot(p, others, options, this.lineN, this.opts, p.type, this.rng);
      };
      [slot] = await Promise.all([decide(), framing]);
    }
    if (this.link) this.link.tell(p, 'select', slot.index);
    if (!local) {
      slot.view.setGlow(p.color, 0.9);
      await flow.w(this.tw.wait(260));
    }
    slot.king = king;
    this.sfx('select');
    await this.moveKing(flow, king, this.kingSpot(1, slot.index));
    slot.view.setGlow(null, 0);
  }

  humanSelect(p, options) {
    return new Promise((resolve, reject) => {
      options.forEach((s) => s.view.setGlow(0xffd36a, 0.35));
      this.mode = { type: 'select', player: p, options, hovered: null, resolve, reject };
    }).finally(() => {
      options.forEach((s) => { s.view.setGlow(null, 0); s.view.group.position.y = REST; });
      this.mode = null;
      this.hud.tooltip(null);
      this.stage.renderer.domElement.style.cursor = '';
    });
  }

  async placePhase(flow, p, slot) {
    const domino = slot.domino;
    const view = slot.view;
    const local = this.isLocal(p);
    if (!this.demo) {
      this.hud.setActive(p);
      if (local) {
        this.hud.prompt(`${this.yourTurn(p)}place your domino`,
          this.tip('place', this.touch ? 'Tap a spot, then tap it again to place' : 'Click to place · R or right-click to rotate'));
      } else this.hud.prompt(`${this.hud.who(p)} is placing a domino…`, this.remoteNote(p));
    }
    const framing = this.focusPlayer(flow, p, 'place');
    const valid = p.kingdom.validPlacements(domino);
    let choice;
    if (local) {
      await framing;
      this.sfx('turnChime');
      choice = await flow.w(this.humanPlace(flow, p, slot, valid));
      if (this.camHeld) this.holdCamera(false);
      if (this.link) this.link.tell(p, 'place', choice);
    } else {
      // (deciding while the camera flies to their realm)
      const decide = async () => {
        const move = await this.remoteMove(flow, p, 'place');
        // A remote move must be legal here too: one of our valid spots, or a discard when nothing fits.
        const legal = move === null ? !valid.length : !!move && valid.some((v) => v.x === move.x && v.y === move.y && v.rot === move.rot);
        if (legal) return move && { x: move.x, y: move.y, rot: move.rot };
        await flow.w(this.tw.wait(380 + this.rng.float(0, 300)));
        return choosePlacement(p.kingdom, domino, this.opts, p.type, this.rng);
      };
      [choice] = await Promise.all([decide(), framing]);
      if (this.link) this.link.tell(p, 'place', choice);
      if (choice) {
        const hover = this.placementTransform(p, choice, HOVER);
        this.sfx('whoosh', 0.5);
        await flow.w(this.tw.move(view.group, { position: view.group.position.clone().setY(REST + 0.5), duration: 220, ease: Ease.outQuad }));
        await flow.w(this.tw.move(view.group, { position: hover.pos, quaternion: hover.quat, duration: 950, arc: 1.4, ease: Ease.inOutCubic }));
      }
    }
    if (choice) {
      const before = p.kingdom.score(this.opts);
      p.kingdom.place(domino, choice.x, choice.y, choice.rot);
      const final = this.placementTransform(p, choice, 0);
      view.setGlow(null, 0);
      await flow.w(this.tw.move(view.group, { position: final.pos, quaternion: final.quat, duration: 200, ease: Ease.inQuad }));
      this.sfx('clack', 1);
      this.fx.dust(final.pos.clone().setY(SURFACE), { count: 30, spread: 1.4 });
      this.tw.move(view.group, { position: final.pos.clone().add(new THREE.Vector3(0, 0.035, 0)), duration: 80, ease: Ease.outQuad })
        .then(() => this.tw.move(view.group, { position: final.pos, duration: 110, ease: Ease.inQuad }));
      p.views.push(view);
      const after = p.kingdom.score(this.opts);
      this.refreshScore(p, after);
      this.updateGuides(p);
      const gain = after.total - before.total;
      if (gain > 0) {
        this.popup(final.pos.clone().add(new THREE.Vector3(0, 0.9, 0)), `+${gain}`);
        this.sfx('coin');
        for (const c of view.crowns) this.fx.sparkle(c.getWorldPosition(new THREE.Vector3()), { count: 14, spread: 0.15, up: 1.4, size: 0.1 });
      }
      // points read before the camera moves on to the board
      await flow.w(this.tw.wait(gain > 0 ? 650 : 250));
    } else {
      p.kingdom.discard(domino);
      if (!this.demo) this.hud.toast(`${this.hud.who(p)} cannot place domino ${domino.id} &mdash; it is discarded.`);
      await this.discardView(flow, view);
    }
  }

  async discardView(flow, view) {
    this.sfx('whoosh', 0.5);
    view.setGlow(0xff5a4a, 0.8);
    // A face-down tile rests on its top face, so its origin sits on the table surface.
    const dest = this.discardBase.clone().setY(SURFACE + this.discards * (TILE_H + 0.004));
    this.discards++;
    const above = dest.clone().add(new THREE.Vector3(0, 0.7, 0));
    await flow.w(this.tw.move(view.group, { position: above, quaternion: quatFaceDown(0.2 * (this.discards % 3 - 1)), duration: 850, arc: 1.6 }));
    // hide the diorama before it would poke through the table
    view.visibleDetail = false;
    view.detail.visible = false;
    await flow.w(this.tw.move(view.group, { position: dest, duration: 180, ease: Ease.inQuad }));
    view.setGlow(null, 0);
    this.sfx('clack', 0.7);
    this.fx.dust(dest.clone().setY(SURFACE), { count: 14, spread: 1 });
  }

  refreshScore(p, s = p.kingdom.score(this.opts)) {
    if (this.demo) return;
    this.hud.updatePlayer(p, s.total, s.crowns);
    p.plate.element.querySelector('.pts').textContent = s.total;
  }

  popup(worldPos, html, cls = 'popup', life = 1900) {
    if (this.demo) return;
    // The CSS2D renderer places the outer element through its transform, so the (transform-based)
    // pop animation must run on an inner one or it would pin the label to the top-left corner.
    const l = label(`<div class="${cls}">${html}</div>`, 'popup-anchor');
    l.position.copy(worldPos);
    this.world.add(l);
    setTimeout(() => l.removeFromParent(), life);
  }

  explainInvalid(p, domino, x, y, rot) {
    const k = p.kingdom;
    const fp = footprint(x, y, rot);
    if (fp.some(([cx, cy]) => k.has(cx, cy))) return 'Those squares are already taken.';
    if (!k.fits(fp)) return `Your kingdom must fit within ${k.size}&times;${k.size} squares.`;
    return 'It must touch your castle or a matching terrain.';
  }

  humanPlace(flow, p, slot, valid) {
    const view = slot.view;
    const promise = new Promise((resolve, reject) => {
      const first = valid.find((v) => v.rot === 0) || valid[0];
      this.mode = {
        type: 'place', player: p, slot, view, domino: slot.domino, valid, rot: first ? first.rot : 0,
        cell: first ? { x: first.x, y: first.y } : { x: 1, y: 0 }, local: null, ok: false, following: false, resolve, reject,
      };
    });
    const m = this.mode;
    this.footMarkers.forEach((mk) => p.root.add(mk));
    p.root.add(this.hintMesh);
    this.hud.setActions({ rotate: true, hint: true, hintOn: this.settings.hints, discard: valid.length === 0 });
    if (!valid.length) {
      this.hud.prompt('This domino fits nowhere', 'Discard it to carry on');
      this.sfx('error');
    }
    p.guides.mat.opacity = 0.95;
    // the name plate floats over the castle, right where the first dominoes go
    p.plate.element.classList.add('faded');
    this.updateHints();
    this.sfx('whoosh', 0.4);
    this.tw.move(view.group, { position: view.group.position.clone().setY(REST + 0.6), duration: 260, ease: Ease.outQuad }).then(() => { if (this.mode === m) m.following = true; });
    return promise.finally(() => {
      this.mode = null;
      if (m.preview) m.preview.removeFromParent();
      this.footMarkers.forEach((mk) => { mk.visible = false; mk.removeFromParent(); });
      this.hintMesh.removeFromParent();
      this.hintMesh.count = 0;
      this.hud.setActions(null);
      p.guides.mat.opacity = 0.5;
      p.plate.element.classList.remove('faded');
      view.setGlow(null, 0);
    });
  }

  // Floating "+N" over the ghost domino: what this exact spot would score right now.
  updatePreview(m, ok) {
    const key = `${m.cell.x},${m.cell.y},${m.rot}`;
    if (m.previewKey === key) return;
    m.previewKey = key;
    if (!m.preview) {
      m.preview = label('', 'popup small preview');
      m.preview.position.set(0, 0.75, 0);
      m.view.group.add(m.preview);
    }
    if (!ok) { m.preview.element.style.opacity = 0; return; }
    const k = m.player.kingdom;
    const before = k.score(this.opts).total;
    const trial = k.clone();
    trial.place(m.domino, m.cell.x, m.cell.y, m.rot);
    const gain = trial.score(this.opts).total - before;
    m.preview.element.style.opacity = 1;
    m.preview.element.innerHTML = gain > 0 ? `+${gain}` : '+0';
    m.preview.element.classList.toggle('zero', gain <= 0);
  }

  updateHints() {
    const m = this.mode;
    if (!m || m.type !== 'place') return;
    if (!this.settings.hints) { this.hintMesh.count = 0; return; }
    const cells = new Set();
    for (const v of m.valid) if (v.rot === m.rot) footprint(v.x, v.y, v.rot).forEach(([x, y]) => cells.add(`${x},${y}`));
    const mtx = new THREE.Matrix4();
    let i = 0;
    for (const c of cells) {
      const [x, y] = c.split(',').map(Number);
      mtx.makeTranslation(x, SURFACE + 0.006, y);
      this.hintMesh.setMatrixAt(i++, mtx);
    }
    this.hintMesh.count = i;
    this.hintMesh.instanceMatrix.needsUpdate = true;
  }

  rotate(dir = 1) {
    const m = this.mode;
    if (!m || m.type !== 'place') return;
    m.rot = (m.rot + dir + 4) % 4;
    this.sfx('rotate');
    this.retarget();
    this.updateHints();
  }

  // Map the pointer to a cell for the current rotation, snapping to a nearby legal spot.
  retarget() {
    const m = this.mode;
    if (!m || m.type !== 'place' || !m.local) return;
    const [dx, dy] = DIRS[m.rot];
    const r = m.player.kingdom.allowedRect();
    let ax = Math.round(m.local.x - dx / 2), ay = Math.round(m.local.z - dy / 2);
    ax = THREE.MathUtils.clamp(ax, r.x0 - 1, r.x1 + 1);
    ay = THREE.MathUtils.clamp(ay, r.y0 - 1, r.y1 + 1);
    let best = null, bd = 0.72;
    for (const v of m.valid) {
      if (v.rot !== m.rot) continue;
      const d = Math.hypot(v.x + dx / 2 - m.local.x, v.y + dy / 2 - m.local.z);
      if (d < bd) { bd = d; best = v; }
    }
    m.cell = best ? { x: best.x, y: best.y } : { x: ax, y: ay };
  }

  tryPlace() {
    const m = this.mode;
    if (!m || m.type !== 'place' || !m.following) return;
    const ok = m.valid.some((v) => v.x === m.cell.x && v.y === m.cell.y && v.rot === m.rot);
    if (ok) { m.resolve({ x: m.cell.x, y: m.cell.y, rot: m.rot }); return; }
    this.sfx('error');
    if (!m.valid.length) { this.hud.toast('This domino cannot be placed anywhere &mdash; discard it.'); return; }
    this.hud.toast(this.explainInvalid(m.player, m.domino, m.cell.x, m.cell.y, m.rot));
    const g = m.view.group;
    const x0 = g.position.x;
    this.tw.add({ duration: 300, ease: Ease.linear, update: (t) => { g.position.x = x0 + Math.sin(t * Math.PI * 6) * 0.06 * (1 - t); } });
  }

  // ---------- final scoring ----------
  highlightRegion(p, region) {
    const group = new THREE.Group();
    const info = TERRAIN_INFO[region.terrain];
    const col = new THREE.Color(info.color);
    const edgeMat = new THREE.MeshBasicMaterial({ color: col.clone().lerp(new THREE.Color(1, 0.9, 0.6), 0.4).multiplyScalar(3), transparent: true, opacity: 0, depthWrite: false });
    const fillMat = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(0.9), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const cells = new Set(region.cells.map(([x, y]) => `${x},${y}`));
    const box = new THREE.BoxGeometry(1, 1, 1);
    const fillGeo = new THREE.PlaneGeometry(0.98, 0.98);
    fillGeo.rotateX(-Math.PI / 2);
    const h = REST + 0.07;
    for (const [x, y] of region.cells) {
      const f = new THREE.Mesh(fillGeo, fillMat);
      f.position.set(x, REST + 0.06, y);
      f.renderOrder = 4;
      group.add(f);
      for (const [dx, dy] of DIRS) {
        if (cells.has(`${x + dx},${y + dy}`)) continue;
        const e = new THREE.Mesh(box, edgeMat);
        e.renderOrder = 4;
        if (dx) { e.position.set(x + dx * 0.5, h, y); e.scale.set(0.085, 0.05, 1.085); }
        else { e.position.set(x, h, y + dy * 0.5); e.scale.set(1.085, 0.05, 0.085); }
        group.add(e);
      }
    }
    p.root.add(group);
    const fade = (edge, fill, duration = 400) => {
      const e0 = edgeMat.opacity, f0 = fillMat.opacity;
      return this.tw.add({ duration, update: (t) => { edgeMat.opacity = e0 + (edge - e0) * t; fillMat.opacity = f0 + (fill - f0) * t; } });
    };
    fade(1, 0.5);
    return {
      dim: () => fade(0.3, 0),
      glow: () => fade(1, 0.3, 300),
      remove: () => fade(0, 0, 500).then(() => group.removeFromParent()),
    };
  }

  async finalScoring(flow) {
    if (this.demo) {
      await flow.w(this.tw.wait(3000));
      return;
    }
    this.finished = true;
    this.hud.setActions(null);
    this.hud.prompt('Final scoring', 'Each crowned property scores squares &times; crowns');
    this.hud.setRound('Game over');
    // The reckoning keeps its own stately pace whatever the game speed, so every count can be read.
    this.tw.speed = 1;
    const autoCam = this.settings.camera === 'auto';
    this.shot = { key: 'overview', view: () => this.overview() };
    if (this.camHeld) this.holdCamera(false);
    const setPts = (p, v) => { p.plate.element.querySelector('.pts').textContent = v; };
    // everyone starts again from nothing, and the realms are counted up one by one
    for (const p of this.players) { setPts(p, 0); this.hud.updatePlayer(p, 0, p.kingdom.score(this.opts).crowns); }
    await flow.w(this.tw.wait(900));
    for (const p of this.players) {
      const s = p.kingdom.score(this.opts);
      const regions = s.regions.filter((r) => r.crowns > 0).sort((a, b) => a.score - b.score);
      this.hud.setActive(p);
      this.hud.prompt(`Scoring ${this.hud.whose(p)} kingdom`, 'Each crowned property scores squares &times; crowns');
      if (autoCam && !this.camHeld) { const v = this.realmView(p); this.camKey = 'realm' + p.index; await flow.w(this.stage.flyTo(v.pos, v.target, 1500)); }
      await flow.w(this.tw.wait(350));
      // bonuses float one row beyond the castle (up the screen), clear of its name plate
      const aboveCastle = (row) => this.cellWorld(p, 0, -row, REST + 1);
      let running = 0;
      const highlights = [];
      if (!regions.length) {
        this.popup(aboveCastle(1.2), 'No crowned property', 'popup small', 2200);
        await flow.w(this.tw.wait(1300));
      }
      for (let i = 0; i < regions.length; i++) {
        const r = regions[i];
        const hl = this.highlightRegion(p, r);
        highlights.push(hl);
        running += r.score;
        const cx = r.cells.reduce((a, c) => a + c[0], 0) / r.size, cy = r.cells.reduce((a, c) => a + c[1], 0) / r.size;
        this.popup(this.cellWorld(p, cx, cy, REST + 0.9), `${r.size} <span class="mul">&times;</span> ${r.crowns}${CROWN_SVG} <span class="mul">=</span> ${r.score}`, 'popup region', 2300);
        this.sound.chime(i);
        for (const [x, y] of r.cells) {
          const c = p.kingdom.get(x, y);
          if (c.crowns) this.fx.sparkle(this.cellWorld(p, x - 0.2, y - 0.3, REST + 0.2), { count: 12 * c.crowns, spread: 0.2, up: 1.5 });
        }
        this.hud.updatePlayer(p, running, s.crowns);
        setPts(p, running);
        // the richest property comes last and gets a longer look
        await flow.w(this.tw.wait(i === regions.length - 1 ? 1600 : 1250));
        hl.dim();
      }
      if (s.middle) {
        running += s.middle;
        this.popup(aboveCastle(1.2), '+10 Middle Kingdom', 'popup bonus', 2400);
        this.fx.ring(this.cellWorld(p, 0, 0, REST), { color: p.color, radius: 1.4 });
        this.sound.bell(84, 0.2);
        this.hud.updatePlayer(p, running, s.crowns);
        setPts(p, running);
        await flow.w(this.tw.wait(1300));
      }
      if (s.harmony) {
        running += s.harmony;
        this.popup(aboveCastle(s.middle ? 2.2 : 1.2), '+5 Harmony', 'popup bonus', 2400);
        this.fx.ring(this.cellWorld(p, 0, 0, REST), { color: 0xffe08a, radius: 3, count: 90 });
        this.sound.bell(88, 0.2);
        this.hud.updatePlayer(p, running, s.crowns);
        setPts(p, running);
        await flow.w(this.tw.wait(1300));
      }
      // the realm's total: every counted property glows once more and the name plate swells
      this.hud.updatePlayer(p, s.total, s.crowns);
      setPts(p, s.total);
      highlights.forEach((h) => h.glow());
      p.plateBody.classList.add('tally');
      this.sound.tally();
      const n = regions.length;
      const parts = [n ? `${n} crowned propert${n === 1 ? 'y' : 'ies'}` : 'No crowned property'];
      if (s.middle) parts.push('Middle Kingdom +10');
      if (s.harmony) parts.push('Harmony +5');
      this.hud.prompt(`${this.hud.who(p)} &middot; ${s.total} point${s.total === 1 ? '' : 's'}`, parts.join(' &middot; '));
      await flow.w(this.tw.wait(1800));
      p.plateBody.classList.remove('tally');
      highlights.forEach((h) => h.remove());
    }
    const rows = rank(this.players, this.opts);
    this.hud.setActive(null);
    const o = this.overview();
    if (autoCam && !this.camHeld) { this.camKey = 'overview'; await flow.w(this.stage.flyTo(o.pos, o.target, 1800)); }
    const winners = rows.filter((r) => r.place === 1).map((r) => r.player);
    this.hud.prompt(winners.length > 1 ? 'It’s a tie!' : `${this.hud.wins(winners[0])}!`,
      winners.length > 1 ? `${winners.map((w) => this.hud.who(w)).join(' and ')} &middot; ${rows[0].s.total} points each` : `${rows[0].s.total} points`);
    this.sound.fanfare();
    for (const w of winners) { this.fx.confettiBurst(w.seat.pos.clone().setY(0.5), [w.color]); w.plateBody.classList.add('tally'); }
    // Let the fireworks play out before the results cover the table; the floating button opens them sooner.
    const party = this.celebrate(flow, winners).then(() => this.tw.wait(1500));
    await flow.w(Promise.race([party, this.hud.offerResults()]));
    for (const w of winners) w.plateBody.classList.remove('tally');
    this.hud.showResults(rows, this.opts, {
      hostDeals: !!this.link && this.link.role === 'guest',
      onAgain: () => this.onPlayAgain && this.onPlayAgain(),
      onMenu: () => this.onMenu && this.onMenu(),
    });
  }

  async celebrate(flow, winners) {
    try {
      for (let i = 0; i < 9; i++) {
        const w = winners[i % winners.length];
        const from = w.seat.pos.clone().add(new THREE.Vector3(this.rng.float(-4, 4), 0.2, this.rng.float(-4, 4)));
        const to = from.clone().add(new THREE.Vector3(this.rng.float(-1, 1), this.rng.float(6, 9), this.rng.float(-1, 1)));
        this.fx.launch(from, to, i % 2 ? w.color : 0xffd46a);
        setTimeout(() => this.sound.ok && this.sound.noiseBurst({ t: this.sound.ctx.currentTime, type: 'lowpass', freq: 600, gain: 0.25, dur: 0.5 }), 520);
        await flow.w(this.tw.wait(450 + this.rng.float(0, 400)));
      }
    } catch (e) { if (e !== CANCEL) throw e; }
  }

  // ---------- input ----------
  setupInput() {
    const el = this.stage.renderer.domElement;
    let down = null;
    el.addEventListener('pointermove', (e) => {
      // a real drag (not a wobbly click) means the player is steering the camera
      if (down && !down.dragged && Math.hypot(e.clientX - down.x, e.clientY - down.y) >= 7) { down.dragged = true; this.takeCamera(); }
      this.onPointerMove(e);
    });
    el.addEventListener('pointerdown', (e) => {
      this.touch = e.pointerType === 'touch';
      down = { x: e.clientX, y: e.clientY, b: e.button, dragged: false };
      this.onPointerMove(e);
    });
    el.addEventListener('pointerup', (e) => {
      if (!down) return;
      // a right click rotates the domino; a right drag pans the camera
      if (!down.dragged && down.b === 0) this.onClick(e);
      else if (!down.dragged && down.b === 2) this.rotate(1);
      down = null;
    });
    el.addEventListener('pointercancel', () => { down = null; });
    el.addEventListener('wheel', () => this.takeCamera(), { passive: true });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === 'r' || k === 'e') this.rotate(1);
      else if (k === 'q') this.rotate(-1);
      else if (k === 'g') this.toggleHints();
      else if ((k === 'enter' || k === ' ') && this.mode?.type === 'place') { e.preventDefault(); this.tryPlace(); }
      else if (k.startsWith('arrow') && this.mode?.type === 'place') { e.preventDefault(); this.nudge(k); }
      else if (this.onKey) this.onKey(k, e);
    });
  }

  toggleHints() {
    this.settings.hints = !this.settings.hints;
    this.hud.setSeg('hints', this.settings.hints ? 'on' : 'off');
    if (this.mode?.type === 'place') this.hud.setActions({ rotate: true, hint: true, hintOn: this.settings.hints, discard: this.mode.valid.length === 0 });
    this.updateHints();
  }

  nudge(key) {
    const m = this.mode;
    // translate screen-ish arrows into kingdom axes for this seat
    const d = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[key];
    const [dx, dy] = DIRS[m.rot];
    const base = m.local ? { x: m.local.x, z: m.local.z } : { x: m.cell.x + dx / 2, z: m.cell.y + dy / 2 };
    m.local = new THREE.Vector3(base.x + d[0], 0, base.z + d[1]);
    this.retarget();
  }

  onPointerMove(e) {
    this.pointerPx = { x: e.clientX, y: e.clientY };
    this.pointerNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    const m = this.mode;
    if (!m) return;
    this.raycaster.setFromCamera(this.pointerNdc, this.stage.camera);
    if (m.type === 'place') {
      const hit = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(this.restPlane, hit)) {
        m.local = m.player.root.worldToLocal(hit);
        this.retarget();
      }
    } else if (m.type === 'select') {
      const hits = this.raycaster.intersectObjects(m.options.map((s) => s.view.base), false);
      const slot = hits.length ? m.options.find((s) => s.view.base === hits[0].object) : null;
      if (slot !== m.hovered) {
        if (m.hovered) m.hovered.view.setGlow(0xffd36a, 0.35);
        m.hovered = slot;
        if (slot) { slot.view.setGlow(0xfff0b0, 1); this.sfx('hover'); }
        this.stage.renderer.domElement.style.cursor = slot ? 'pointer' : '';
      }
      if (slot) {
        const turn = `<div class="tt-row" style="margin-top:6px;font-style:italic;color:#cbbd9c">Slot ${slot.index + 1} of ${this.lineN} &middot; ${slot.index === 0 ? 'you pick first next round' : slot.index === this.lineN - 1 ? 'you pick last next round' : 'middle of the turn order'}</div>`;
        this.hud.tooltip(this.hud.dominoTooltip(slot.domino, turn), e.clientX, e.clientY);
      } else this.hud.tooltip(null);
    }
  }

  onClick(e) {
    const m = this.mode;
    if (!m) return;
    if (m.type === 'select' && m.hovered) m.resolve(m.hovered);
    else if (m.type === 'place') {
      // Without hover, the first tap previews the spot and a second tap on it confirms.
      if (e && e.pointerType === 'touch') {
        const key = `${m.cell.x},${m.cell.y},${m.rot}`;
        if (m.touchKey !== key) {
          m.touchKey = key;
          if (!this.touchHinted) { this.touchHinted = true; this.hud.toast('Tap the same spot again to place it'); }
          return;
        }
      }
      this.tryPlace();
    }
  }

  // ---------- per frame ----------
  frame(t, dt) {
    for (const v of this.activeViews) v.update(t, dt);
    for (const p of this.players) p.castle.update(t);
    const m = this.mode;
    for (const k of this.kings) {
      const active = m && m.player === k.player;
      const target = active ? 0.06 + Math.sin(t * 4) * 0.04 : 0;
      k.model.position.y += (target - k.model.position.y) * Math.min(1, dt * 8);
    }
    this.hintMat.opacity = 0.22 + Math.sin(t * 3) * 0.08;
    if (m && m.type === 'place' && m.following) {
      const target = this.placementTransform(m.player, { x: m.cell.x, y: m.cell.y, rot: m.rot }, HOVER);
      const g = m.view.group;
      g.position.lerp(target.pos, 1 - Math.exp(-dt * 14));
      g.position.y = target.pos.y + Math.sin(t * 3) * 0.04;
      g.quaternion.slerp(target.quat, 1 - Math.exp(-dt * 12));
      const ok = m.valid.some((v) => v.x === m.cell.x && v.y === m.cell.y && v.rot === m.rot);
      m.ok = ok;
      m.view.setGlow(ok ? 0x7dff9a : 0xff5a4a, 0.9);
      this.updatePreview(m, ok);
      footprint(m.cell.x, m.cell.y, m.rot).forEach(([x, y], i) => {
        const mk = this.footMarkers[i];
        mk.visible = true;
        mk.material = ok ? M.ghostOk : M.ghostBad;
        mk.position.set(x, SURFACE + 0.008, y);
      });
    }
    if (m && m.type === 'select') {
      for (const s of m.options) {
        const want = REST + (s === m.hovered ? 0.14 : 0);
        s.view.group.position.y += (want - s.view.group.position.y) * Math.min(1, dt * 12);
      }
    }
  }
}
