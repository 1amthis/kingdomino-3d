// Promise-based tweening driven by the render loop, so game flow can simply `await` animations.
import * as THREE from 'three';

export const Ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => t * (2 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - (1 - t) ** 3,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; },
  outElastic: (t) => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1),
  outBounce: (t) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

export class Tweener {
  constructor() {
    this.items = [];
    this.speed = 1;
  }

  // update(easedT, rawT) is called every frame; resolves when finished.
  add({ duration = 500, delay = 0, ease = Ease.outCubic, update = () => {}, start, tag = 'game' } = {}) {
    return new Promise((resolve) => {
      this.items.push({ t: -delay, duration: Math.max(1, duration), ease, update, start, started: false, resolve, tag });
    });
  }

  wait(ms, tag = 'game') { return this.add({ duration: ms, tag }); }

  // Drop every pending tween with this tag (their promises are abandoned on purpose).
  clear(tag) { this.items = this.items.filter((it) => it.tag !== tag); }

  update(dtMs) {
    const dt = dtMs * this.speed;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      if (it.t < 0) continue;
      if (!it.started) { it.started = true; it.start && it.start(); }
      const raw = Math.min(1, it.t / it.duration);
      it.update(it.ease(raw), raw);
      if (raw >= 1) { this.items.splice(i, 1); it.resolve(); }
    }
  }

  // Move an object to a target transform, optionally hopping along an arc.
  move(obj, { position, quaternion, scale, duration = 600, delay = 0, ease = Ease.inOutCubic, arc = 0, spin, tag = 'game' } = {}) {
    let p0, q0, s0;
    const p1 = position ? position.clone() : null;
    const q1 = quaternion ? quaternion.clone() : null;
    const s1 = scale !== undefined ? (scale.isVector3 ? scale.clone() : new THREE.Vector3(scale, scale, scale)) : null;
    const tmpQ = new THREE.Quaternion();
    return this.add({
      duration, delay, ease: Ease.linear, tag,
      start: () => { p0 = obj.position.clone(); q0 = obj.quaternion.clone(); s0 = obj.scale.clone(); },
      update: (_, raw) => {
        const t = ease(raw);
        if (p1) {
          obj.position.lerpVectors(p0, p1, t);
          if (arc) obj.position.y += Math.sin(Math.PI * t) * arc;
        }
        if (q1) {
          tmpQ.slerpQuaternions(q0, q1, t);
          obj.quaternion.copy(tmpQ);
        }
        if (spin) spin(obj, t);
        if (s1) obj.scale.lerpVectors(s0, s1, t);
      },
    });
  }
}
