// Particle effects: dust puffs, golden sparkles, fireworks and tumbling confetti.
import * as THREE from 'three';

const vert = /* glsl */`
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uScale;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const frag = /* glsl */`
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uSoft;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p) * 2.0;
    float a = smoothstep(1.0, uSoft, d);
    if (a * vAlpha < 0.003) discard;
    gl_FragColor = vec4(vColor, a * vAlpha);
  }`;

class PointPool {
  constructor(scene, max, { additive = false, soft = 0.0 } = {}) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.p = Array.from({ length: max }, () => ({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, g: 0, drag: 0, s0: 1, s1: 1, a0: 1, twinkle: 0, r: 1, gg: 1, b: 1 }));
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 400 }, uSoft: { value: soft } },
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
    this.wasAlive = false;
  }

  emit(x, y, z, o) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const p = this.p[i];
    Object.assign(p, { life: o.life, max: o.life, vx: o.vx, vy: o.vy, vz: o.vz, g: o.g ?? 0, drag: o.drag ?? 0, s0: o.s0, s1: o.s1 ?? o.s0, a0: o.alpha ?? 1, twinkle: o.twinkle ?? 0 });
    p.r = o.color.r; p.gg = o.color.g; p.b = o.color.b;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
  }

  // Returns whether any particle is still flying.
  update(dt, t) {
    let alive = false;
    for (let i = 0; i < this.max; i++) {
      const p = this.p[i];
      if (p.life <= 0) { this.alpha[i] = 0; continue; }
      alive = true;
      p.life -= dt;
      const k = 1 - Math.max(0, p.life) / p.max;
      const drag = Math.exp(-p.drag * dt);
      p.vx *= drag; p.vy = p.vy * drag - p.g * dt; p.vz *= drag;
      this.pos[i * 3] += p.vx * dt;
      this.pos[i * 3 + 1] += p.vy * dt;
      this.pos[i * 3 + 2] += p.vz * dt;
      if (this.pos[i * 3 + 1] < 0.02) { this.pos[i * 3 + 1] = 0.02; p.vy *= -0.3; }
      this.size[i] = p.s0 + (p.s1 - p.s0) * k;
      let a = p.a0 * (1 - k) * Math.min(1, k * 12 + 0.2);
      if (p.twinkle) a *= 0.6 + 0.4 * Math.sin(t * p.twinkle + i);
      this.alpha[i] = Math.max(0, a);
      this.col[i * 3] = p.r; this.col[i * 3 + 1] = p.gg; this.col[i * 3 + 2] = p.b;
    }
    // an empty pool needs no upload, once its last particles have been hidden
    if (alive || this.wasAlive) {
      const g = this.points.geometry.attributes;
      g.position.needsUpdate = g.aColor.needsUpdate = g.aSize.needsUpdate = g.aAlpha.needsUpdate = true;
    }
    this.wasAlive = alive;
    return alive;
  }
}

export class Effects {
  constructor(stage) {
    this.stage = stage;
    const scene = stage.scene;
    this.dustPool = new PointPool(scene, 600, { soft: 0.0 });
    this.glowPool = new PointPool(scene, 2500, { additive: true, soft: 0.1 });
    this.setupConfetti(scene);
    stage.onFrame((t, dt) => {
      const dust = this.dustPool.update(dt, t), glow = this.glowPool.update(dt, t);
      stage.particles = this.updateConfetti(dt, t) || dust || glow; // flying particles want the full frame rate
    });
    this.onResize();
    window.addEventListener('resize', () => this.onResize());
  }

  onResize() {
    const h = this.stage.renderer.domElement.height;
    this.dustPool.mat.uniforms.uScale.value = h * 0.9;
    this.glowPool.mat.uniforms.uScale.value = h * 0.9;
  }

  dust(pos, { count = 26, spread = 1.1, color = 0xcbb89a } = {}) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * 1.6;
      const along = (Math.random() - 0.5) * spread;
      this.dustPool.emit(pos.x + Math.cos(a) * 0.3 + along, pos.y + 0.05, pos.z + Math.sin(a) * 0.3, {
        life: 0.9 + Math.random() * 0.8, vx: Math.cos(a) * sp, vy: 0.3 + Math.random() * 0.6, vz: Math.sin(a) * sp,
        drag: 3.2, g: 0.2, s0: 0.12, s1: 0.45 + Math.random() * 0.3, alpha: 0.35, color: c.clone().multiplyScalar(0.85 + Math.random() * 0.3),
      });
    }
  }

  sparkle(pos, { count = 30, color = 0xffd46a, spread = 0.5, up = 1.6, size = 0.12, life = 1.2 } = {}) {
    const c = new THREE.Color(color).multiplyScalar(3);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * spread;
      this.glowPool.emit(pos.x + Math.cos(a) * r, pos.y + Math.random() * 0.2, pos.z + Math.sin(a) * r, {
        life: life * (0.6 + Math.random() * 0.8), vx: Math.cos(a) * 0.4, vy: up * (0.4 + Math.random()), vz: Math.sin(a) * 0.4,
        drag: 1.5, g: -0.1, s0: size, s1: size * 0.2, alpha: 1, twinkle: 18 + Math.random() * 10, color: c,
      });
    }
  }

  ring(pos, { color = 0xffe08a, count = 60, radius = 1.2, y = 0.1 } = {}) {
    const c = new THREE.Color(color).multiplyScalar(2.5);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      this.glowPool.emit(pos.x, pos.y + y, pos.z, {
        life: 0.9, vx: Math.cos(a) * radius * 2.5, vy: 0.2, vz: Math.sin(a) * radius * 2.5, drag: 3, s0: 0.14, s1: 0.02, alpha: 1, color: c,
      });
    }
  }

  firework(pos, color) {
    const base = new THREE.Color(color);
    const c = base.clone().multiplyScalar(4);
    const white = new THREE.Color(4, 3.6, 3);
    const n = 140;
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const sp = 3.2 + Math.random() * 1.2;
      this.glowPool.emit(pos.x, pos.y, pos.z, {
        life: 1.4 + Math.random() * 0.9, vx: r * Math.cos(th) * sp, vy: u * sp + 0.8, vz: r * Math.sin(th) * sp,
        drag: 1.6, g: 2.2, s0: 0.2, s1: 0.03, alpha: 1, twinkle: Math.random() < 0.3 ? 30 : 0, color: Math.random() < 0.2 ? white : c,
      });
    }
  }

  // Rocket trail up to a burst.
  async launch(from, to, color) {
    const steps = 26;
    const c = new THREE.Color(1.8, 1.4, 0.8);
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t, z = from.z + (to.z - from.z) * t;
      this.glowPool.emit(x, y, z, { life: 0.5, vx: (Math.random() - 0.5) * 0.3, vy: -0.4, vz: (Math.random() - 0.5) * 0.3, s0: 0.14, s1: 0.02, alpha: 0.9, color: c });
      await this.stage.tweener.wait(18);
    }
    this.firework(to, color);
  }

  setupConfetti(scene) {
    const n = 500;
    const geo = new THREE.PlaneGeometry(0.1, 0.06);
    const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.4, metalness: 0.3 });
    this.confetti = new THREE.InstancedMesh(geo, mat, n);
    this.confetti.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.confetti.frustumCulled = false;
    this.confettiState = Array.from({ length: n }, () => ({ life: 0 }));
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < n; i++) { this.confetti.setMatrixAt(i, m); this.confetti.setColorAt(i, new THREE.Color(1, 1, 1)); }
    scene.add(this.confetti);
    this.confettiCursor = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
  }

  confettiBurst(pos, colors, count = 220) {
    const palette = colors.map((c) => new THREE.Color(c));
    palette.push(new THREE.Color(0xffd46a), new THREE.Color(0xffffff));
    for (let k = 0; k < count; k++) {
      const i = this.confettiCursor;
      this.confettiCursor = (i + 1) % this.confettiState.length;
      const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 3.5;
      this.confettiState[i] = {
        life: 5 + Math.random() * 3, x: pos.x, y: pos.y, z: pos.z,
        vx: Math.cos(a) * sp * 0.6, vy: 4 + Math.random() * 5, vz: Math.sin(a) * sp * 0.6,
        rx: Math.random() * 6, ry: Math.random() * 6, rz: Math.random() * 6,
        wx: (Math.random() - 0.5) * 14, wy: (Math.random() - 0.5) * 10, wz: (Math.random() - 0.5) * 14,
        ph: Math.random() * 10,
      };
      this.confetti.setColorAt(i, palette[Math.floor(Math.random() * palette.length)]);
    }
    this.confetti.instanceColor.needsUpdate = true;
  }

  updateConfetti(dt, t) {
    let any = false;
    for (let i = 0; i < this.confettiState.length; i++) {
      const s = this.confettiState[i];
      if (s.life <= 0) continue;
      any = true;
      s.life -= dt;
      const drag = Math.exp(-1.8 * dt);
      s.vx = s.vx * drag + Math.sin(t * 2 + s.ph) * 0.4 * dt;
      s.vz = s.vz * drag + Math.cos(t * 1.7 + s.ph) * 0.4 * dt;
      s.vy = Math.max(-1.1, s.vy * drag - 5 * dt);
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      if (s.y < 0.02) { s.y = 0.02; s.vx = s.vz = 0; s.wx *= 0.9; s.wy *= 0.9; s.wz *= 0.9; }
      s.rx += s.wx * dt; s.ry += s.wy * dt; s.rz += s.wz * dt;
      const sc = s.life < 0.6 ? s.life / 0.6 : 1;
      this._e.set(s.rx, s.ry, s.rz);
      this._q.setFromEuler(this._e);
      this._s.setScalar(sc);
      this._m.compose(this._v.set(s.x, s.y, s.z), this._q, this._s);
      this.confetti.setMatrixAt(i, this._m);
      if (s.life <= 0) this.confetti.setMatrixAt(i, this._m.makeScale(0, 0, 0));
    }
    if (any || this._confettiWasActive) this.confetti.instanceMatrix.needsUpdate = true;
    this._confettiWasActive = any;
    return any;
  }
}
