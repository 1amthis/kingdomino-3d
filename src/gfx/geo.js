// Geometry batching: primitives get baked vertex colours and are merged per material,
// so a whole diorama tile renders in a handful of draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const tmpColor = new THREE.Color();
const tmpV = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();

export const P = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cone5: new THREE.ConeGeometry(1, 1, 5, 1),
  cone6: new THREE.ConeGeometry(1, 1, 6, 1),
  cone4: new THREE.ConeGeometry(1, 1, 4, 1),
  cone8: new THREE.ConeGeometry(1, 1, 8, 1),
  cyl5: new THREE.CylinderGeometry(1, 1, 1, 5, 1),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6, 1),
  cyl8: new THREE.CylinderGeometry(1, 1, 1, 8, 1),
  cyl12: new THREE.CylinderGeometry(1, 1, 1, 12, 1),
  ico0: new THREE.IcosahedronGeometry(1, 0),
  ico1: new THREE.IcosahedronGeometry(1, 1),
  dodec: new THREE.DodecahedronGeometry(1, 0),
  octa: new THREE.OctahedronGeometry(1, 0),
  sphere: new THREE.SphereGeometry(1, 8, 6),
  torus: new THREE.TorusGeometry(1, 0.25, 5, 10),
};
// Put the base of cones/cylinders at y=0 so "scale.y" means height.
for (const k of ['cone5', 'cone6', 'cone4', 'cone8', 'cyl5', 'cyl6', 'cyl8', 'cyl12']) P[k].translate(0, 0.5, 0);

export function composeMatrix(pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  const s = typeof scale === 'number' ? [scale, scale, scale] : scale;
  tmpE.set(rot[0], rot[1], rot[2]);
  tmpQ.setFromEuler(tmpE);
  return new THREE.Matrix4().compose(tmpV.set(pos[0], pos[1], pos[2]).clone(), tmpQ.clone(), new THREE.Vector3(s[0], s[1], s[2]));
}

export class GeoBuilder {
  constructor(rng) {
    this.rng = rng;
    this.parts = new Map();
  }

  // color: hex | THREE.Color | (x, y, z) => THREE.Color  (evaluated in final local space)
  add(cat, geo, color, { pos, rot, scale, matrix, jitter = 0.06 } = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
    const m = matrix || composeMatrix(pos, rot, scale);
    g.applyMatrix4(m);
    const pos3 = g.attributes.position;
    const cols = new Float32Array(pos3.count * 3);
    const isFn = typeof color === 'function';
    if (!isFn) tmpColor.set(color);
    for (let i = 0; i < pos3.count; i += 3) {
      const j = jitter ? 1 + (this.rng.next() * 2 - 1) * jitter : 1;
      for (let v = 0; v < 3 && i + v < pos3.count; v++) {
        const idx = i + v;
        const c = isFn ? color(pos3.getX(idx), pos3.getY(idx), pos3.getZ(idx)) : tmpColor;
        cols[idx * 3] = Math.min(1, c.r * j);
        cols[idx * 3 + 1] = Math.min(1, c.g * j);
        cols[idx * 3 + 2] = Math.min(1, c.b * j);
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    if (!this.parts.has(cat)) this.parts.set(cat, []);
    this.parts.get(cat).push(g);
    return this;
  }

  // Transform every part of this builder (used to offset one square inside a domino).
  transform(matrix) {
    for (const list of this.parts.values()) for (const g of list) g.applyMatrix4(matrix);
    return this;
  }

  absorb(other) {
    for (const [cat, list] of other.parts) {
      if (!this.parts.has(cat)) this.parts.set(cat, []);
      this.parts.get(cat).push(...list);
    }
    other.parts.clear();
    return this;
  }

  build(materials, { castShadow = true, receiveShadow = true } = {}) {
    const group = new THREE.Group();
    for (const [cat, list] of this.parts) {
      if (!list.length) continue;
      const merged = mergeGeometries(list, false);
      merged.computeVertexNormals();
      merged.computeBoundingSphere();
      const mat = materials[cat];
      if (!mat) throw new Error('No material for category ' + cat);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = castShadow && cat !== 'ground';
      mesh.receiveShadow = receiveShadow;
      mesh.name = cat;
      group.add(mesh);
      list.forEach((g) => g.dispose());
    }
    this.parts.clear();
    return group;
  }
}

export function shade(hex, k) {
  return new THREE.Color(hex).multiplyScalar(k);
}

export function mixColor(a, b, t) {
  return new THREE.Color(a).lerp(new THREE.Color(b), t);
}
