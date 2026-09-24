// A physical domino: wooden base, two diorama squares, hovering crowns and a numbered back.
import * as THREE from 'three';
import { GeoBuilder } from './geo.js';
import { buildSquare, crownSlots, CATEGORY_MATERIALS } from './terrain.js';
import { M } from './materials.js';
import { makeBackTexture } from './textures.js';
import { dominoBaseGeometry, makeCrown, TILE_H } from './pieces.js';
import { Rng, hashSeed } from '../core/rng.js';

const backGeo = new THREE.PlaneGeometry(1.86, 0.86);
backGeo.rotateX(Math.PI / 2);
let glowGeo = null, glowTex = null;

function glowPlate() {
  if (!glowGeo) {
    glowGeo = new THREE.PlaneGeometry(2.5, 1.5);
    glowGeo.rotateX(-Math.PI / 2);
    const c = document.createElement('canvas');
    c.width = 256; c.height = 154;
    const x = c.getContext('2d');
    // soft rounded-rectangle halo
    for (let i = 0; i < 24; i++) {
      const k = i / 24;
      x.strokeStyle = `rgba(255,255,255,${0.09 * (1 - k)})`;
      x.lineWidth = 3;
      const m = 26 - k * 22;
      x.beginPath();
      x.roundRect(m, m, 256 - 2 * m, 154 - 2 * m, 16);
      x.stroke();
    }
    x.fillStyle = 'rgba(255,255,255,0.18)';
    x.beginPath(); x.roundRect(26, 26, 204, 102, 10); x.fill();
    glowTex = new THREE.CanvasTexture(c);
    glowTex.colorSpace = THREE.SRGBColorSpace;
  }
  const mat = new THREE.MeshBasicMaterial({ map: glowTex, color: 0xffd36a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const m = new THREE.Mesh(glowGeo, mat);
  m.renderOrder = 2;
  return m;
}

export class DominoView {
  constructor(domino) {
    this.domino = domino;
    this.group = new THREE.Group();
    this.group.name = 'domino-' + domino.id;
    this.group.userData.dominoView = this;
    this.animators = [];
    this.crowns = [];
    this.visibleDetail = true;

    const base = new THREE.Mesh(dominoBaseGeometry(), M.wood);
    base.castShadow = true; base.receiveShadow = true;
    this.group.add(base);
    this.base = base;

    const backMat = new THREE.MeshStandardMaterial({ map: makeBackTexture(domino.id), roughness: 0.5, metalness: 0.1 });
    const back = new THREE.Mesh(backGeo, backMat);
    back.position.y = -TILE_H - 0.002;
    this.group.add(back);

    const combined = new GeoBuilder(new Rng(domino.id));
    this.detail = new THREE.Group();
    domino.squares.forEach((sq, i) => {
      const ox = i === 0 ? -0.5 : 0.5;
      const rng = new Rng(hashSeed('square', domino.id, i));
      const { builder, objects, animators, groundH } = buildSquare(sq.terrain, sq.crowns, rng);
      builder.transform(new THREE.Matrix4().makeTranslation(ox, 0, 0));
      combined.absorb(builder);
      const holder = new THREE.Group();
      holder.position.x = ox;
      for (const o of objects) {
        // transparent bits (water, smoke, fireflies, splash rings) should not darken the tile
        o.traverse((c) => { if (c.isMesh) { c.castShadow = !c.material.transparent; c.receiveShadow = true; } });
        holder.add(o);
      }
      this.detail.add(holder);
      this.animators.push(...animators);
      crownSlots(sq.crowns).forEach(([cx, cz], k) => {
        const crown = makeCrown(1.65);
        const gy = Math.max(groundH(cx, cz), 0.04);
        crown.position.set(ox + cx, gy + 0.13, cz);
        crown.userData.baseY = crown.position.y;
        crown.userData.phase = domino.id * 1.3 + i * 2 + k * 0.7;
        this.detail.add(crown);
        this.crowns.push(crown);
      });
    });
    this.detail.add(combined.build(CATEGORY_MATERIALS()));
    this.group.add(this.detail);

    this.glow = glowPlate();
    this.glow.position.y = -TILE_H + 0.012;
    this.group.add(this.glow);
    this.glowTarget = 0;
    this.lift = 0; this.liftTarget = 0;
  }

  setGlow(color, strength = 1) {
    if (color !== null && color !== undefined) this.glow.material.color.set(color);
    this.glowTarget = strength;
  }

  update(t, dt) {
    const g = this.glow.material;
    g.opacity += (this.glowTarget * (0.75 + 0.25 * Math.sin(t * 5)) - g.opacity) * Math.min(1, dt * 10);
    this.glow.visible = g.opacity > 0.01;
    if (!this.visibleDetail) return;
    for (const a of this.animators) a(t, dt);
    for (const c of this.crowns) {
      const ph = c.userData.phase;
      c.position.y = c.userData.baseY + Math.sin(t * 1.8 + ph) * 0.015;
      c.rotation.y = t * 0.7 + ph;
    }
  }
}
