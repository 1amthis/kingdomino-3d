// Renderer, camera, lights, ambience presets and the post-processing chain.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Tweener, Ease } from './tween.js';
import { updateMaterials } from './materials.js';

const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uVignette: { value: 0.9 },
    uGrain: { value: 0.035 },
    uTilt: { value: 1.0 },
    uFocus: { value: 0.55 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uTime, uVignette, uGrain, uTilt, uFocus;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      vec3 col = texture2D(tDiffuse, uv).rgb;
      // Tilt-shift: blur grows away from a horizontal focus band => miniature look.
      float d = abs(uv.y - uFocus);
      float blur = smoothstep(0.22, 0.62, d) * uTilt;
      if (blur > 0.01) {
        vec3 acc = col; float w = 1.0;
        for (int i = 0; i < 16; i++) {
          float fi = float(i);
          float a = fi * 2.39996;
          float r = sqrt((fi + 0.5) / 16.0);
          vec2 o = vec2(cos(a), sin(a)) * r * blur * 7.0 / uResolution * (uResolution.y / 900.0);
          acc += texture2D(tDiffuse, uv + o).rgb; w += 1.0;
        }
        col = acc / w;
      }
      vec2 p = (uv - 0.5) * vec2(1.0, 1.15);
      float v = 1.0 - dot(p, p) * uVignette;
      col *= clamp(v, 0.0, 1.0);
      col = mix(col, col * vec3(1.04, 1.0, 0.94), 0.6);
      float n = fract(sin(dot(uv * uResolution + fract(uTime) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
      col += (n - 0.5) * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export const AMBIENCE = {
  day: {
    label: 'Day', sunColor: 0xfff0d8, sun: 3.4, hemiSky: 0xd8e6ff, hemiGround: 0x6a4a32, hemi: 1.0, env: 0.5,
    bg: 0x2b2019, candle: 1.4, night: 0, exposure: 1.0, sunPos: [-16, 28, 14], shaft: 0.35, lamp: 0,
  },
  dusk: {
    label: 'Golden hour', sunColor: 0xffa35a, sun: 3.0, hemiSky: 0xffb58a, hemiGround: 0x3a2418, hemi: 0.55, env: 0.3,
    bg: 0x1c120c, candle: 4, night: 0.4, exposure: 1.05, sunPos: [-28, 12, 8], shaft: 0.55, lamp: 40,
  },
  night: {
    label: 'Night', sunColor: 0x8aa0ff, sun: 0.9, hemiSky: 0x33407a, hemiGround: 0x120c0a, hemi: 0.45, env: 0.14,
    bg: 0x05060c, candle: 10, night: 1, exposure: 1.2, sunPos: [12, 26, -14], shaft: 0.0, lamp: 420,
  },
};

export class Stage {
  constructor(container) {
    this.container = container;
    this.tweener = new Tweener();
    this.frameCallbacks = new Set();
    this.time = 0;
    this.quality = 'high';
    this.calm = false; // the menu: its demo game plays at the idle frame rate
    this.touchedAt = -Infinity;
    this.shadowAt = -Infinity;
    this.particles = false;

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.setSize(window.innerWidth, window.innerHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.autoUpdate = false; // see render()
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(r.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.setSize(window.innerWidth, window.innerHeight);
    this.labels.domElement.className = 'labels-layer';
    container.appendChild(this.labels.domElement);

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(AMBIENCE.day.bg);
    scene.fog = new THREE.Fog(AMBIENCE.day.bg, 38, 90);

    const pmrem = new THREE.PMREMGenerator(r);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.5;

    this.camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 200);
    this.camera.position.set(0, 26, 34);

    const c = this.controls = new OrbitControls(this.camera, r.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.minDistance = 4;
    c.maxDistance = 60;
    c.maxPolarAngle = Math.PI * 0.46;
    c.target.set(0, 0, 0);
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    c.screenSpacePanning = false;
    c.zoomToCursor = true;
    // how far the orbit centre may wander (half the table, minus a margin)
    this.panLimit = { x: 17, z: 16 };

    this.setupLights();
    this.setupPost();
    this.setupMotes();

    window.addEventListener('resize', () => this.resize());
    // the player's hand keeps the full frame rate for a moment (hover, drags, taps on the buttons)
    const touched = () => { this.touchedAt = performance.now(); };
    for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown']) window.addEventListener(ev, touched, { passive: true });
    this.timer = new THREE.Timer();
    this.ambience = { ...AMBIENCE.day };
    this.ambienceName = 'day';
    this.applyAmbience(this.ambience);
  }

  setupLights() {
    const s = this.scene;
    this.hemi = new THREE.HemisphereLight(0xd8e6ff, 0x6a4a32, 1.0);
    s.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xfff0d8, 3.4);
    sun.position.set(-16, 28, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const sc = sun.shadow.camera;
    sc.left = -24; sc.right = 24; sc.top = 24; sc.bottom = -24; sc.near = 1; sc.far = 90;
    sun.shadow.bias = -0.00025;
    sun.shadow.normalBias = 0.015;
    sun.shadow.radius = 2.5;
    s.add(sun, sun.target);
    // fill light from the opposite side
    this.fill = new THREE.DirectionalLight(0xffe2c4, 0.35);
    this.fill.position.set(18, 14, -10);
    s.add(this.fill);
    // an unseen iron chandelier above the table carries the scene after dark
    this.lamp = new THREE.PointLight(0xffb870, 0, 0, 2);
    this.lamp.position.set(0, 17, 3);
    s.add(this.lamp);

    // Faux volumetric sunbeam.
    const shaftMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(0xffd9a0) }, uI: { value: 0.3 }, uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uI; uniform float uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){ float edge = pow(abs(dot(vN, vV)), 2.0); float len = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.6, vUv.y);
          float streak = 0.75 + 0.25 * sin(vUv.x * 40.0 + uTime * 0.2) * sin(vUv.x * 17.0 - uTime * 0.13);
          gl_FragColor = vec4(uColor * edge * len * uI * streak * 0.12, 1.0); }`,
    });
    const shaft = this.shaft = new THREE.Mesh(new THREE.CylinderGeometry(4, 7, 44, 48, 1, true), shaftMat);
    shaft.renderOrder = 5;
    s.add(shaft);
    this.orientShaft();
  }

  orientShaft() {
    const dir = this.sun.position.clone().normalize();
    this.shaft.position.copy(dir.clone().multiplyScalar(18)).add(new THREE.Vector3(-2, 0, 1));
    this.shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  }

  setupPost() {
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.composer.setPixelRatio(r.getPixelRatio());
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.42, 0.5, 0.92);
    this.output = new OutputPass();
    this.finish = new ShaderPass(FinishShader);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
    this.composer.addPass(this.finish);
    this.finish.uniforms.uResolution.value.set(size.x, size.y);
  }

  setupMotes() {
    const n = 420;
    const pos = new Float32Array(n * 3);
    this.moteSeeds = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      this.moteSeeds.set([(Math.random() - 0.5) * 36, 0.6 + Math.random() * 12, (Math.random() - 0.5) * 32, Math.random() * 100], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const seeds = new Float32Array(n);
    for (let i = 0; i < n; i++) seeds[i] = Math.random();
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    // Soft motes that twinkle and fade out as they approach the lens.
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uScale: { value: 800 }, uOpacity: { value: 0.5 }, uColor: { value: new THREE.Color(0xffe2b0) } },
      vertexShader: `attribute float aSeed; uniform float uTime, uScale, uOpacity; varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float d = -mv.z;
          gl_PointSize = clamp(uScale * 0.05 / d, 1.0, 5.0);
          vA = uOpacity * smoothstep(4.0, 12.0, d) * (0.45 + 0.55 * sin(uTime * (0.8 + aSeed) + aSeed * 40.0));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform vec3 uColor; varying float vA;
        void main() { float r = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, r); gl_FragColor = vec4(uColor * a * max(vA, 0.0), 1.0); }`,
    });
    this.motes = new THREE.Points(g, m);
    this.motes.frustumCulled = false;
    this.scene.add(this.motes);
  }

  updateMotes(t) {
    const p = this.motes.geometry.attributes.position;
    const s = this.moteSeeds;
    for (let i = 0; i < p.count; i++) {
      const x = s[i * 4], y = s[i * 4 + 1], z = s[i * 4 + 2], ph = s[i * 4 + 3];
      const yy = ((y + t * 0.08 + ph) % 12.5) + 0.4;
      p.setXYZ(i, x + Math.sin(t * 0.13 + ph) * 1.2, yy, z + Math.cos(t * 0.11 + ph * 1.3) * 1.2);
    }
    p.needsUpdate = true;
  }

  setQuality(q) {
    this.quality = q;
    const r = this.renderer;
    const pr = q === 'low' ? 1 : Math.min(window.devicePixelRatio, q === 'high' ? 2 : 1.5);
    r.setPixelRatio(pr);
    this.sun.shadow.mapSize.setScalar(q === 'low' ? 1024 : q === 'medium' ? 2048 : 4096);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.shadowAt = -Infinity;
    this.bloom.enabled = q !== 'low';
    this.finish.uniforms.uTilt.value = q === 'low' ? 0 : this.tiltShift ? 1 : 0;
    this.resize();
  }

  setTiltShift(on) {
    this.tiltShift = on;
    this.finish.uniforms.uTilt.value = on && this.quality !== 'low' ? 1 : 0;
  }

  // Slide the rendered image sideways (fraction of the width) without moving the camera.
  setViewShift(target, duration = 1200) {
    const from = this.viewShift || 0;
    this.tweener.clear('camera-shift');
    return this.tweener.add({
      duration, ease: Ease.inOutCubic, tag: 'camera-shift',
      update: (t) => { this.viewShift = from + (target - from) * t; this.applyViewShift(); },
    });
  }

  applyViewShift() {
    const w = window.innerWidth, h = window.innerHeight, s = this.viewShift || 0;
    if (Math.abs(s) < 1e-4) this.camera.clearViewOffset();
    else this.camera.setViewOffset(w, h, -s * w, 0, w, h);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.applyViewShift();
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.labels.setSize(w, h);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.finish.uniforms.uResolution.value.set(size.x, size.y);
  }

  applyAmbience(a) {
    this.sun.color.set(a.sunColor);
    this.sun.intensity = a.sun;
    this.sun.position.set(...a.sunPos);
    this.hemi.color.set(a.hemiSky);
    this.hemi.groundColor.set(a.hemiGround);
    this.hemi.intensity = a.hemi;
    this.scene.environmentIntensity = a.env;
    this.scene.background.set(a.bg);
    this.scene.fog.color.set(a.bg);
    this.renderer.toneMappingExposure = a.exposure;
    this.shaft.material.uniforms.uI.value = a.shaft;
    this.shaft.material.uniforms.uColor.value.set(a.sunColor);
    this.motes.material.uniforms.uOpacity.value = 0.25 + a.shaft * 0.9 + a.night * 0.15;
    this.orientShaft();
    this.fill.intensity = 0.35 * (1 - a.night * 0.7);
    this.lamp.intensity = a.lamp;
    if (this.onAmbience) this.onAmbience(a);
  }

  setAmbience(name, duration = 1800) {
    const from = { ...this.ambience };
    const to = AMBIENCE[name];
    this.tweener.clear('ambience');
    this.ambienceName = name;
    const ca = new THREE.Color(), cb = new THREE.Color();
    const lerpHex = (a, b, t) => ca.set(a).lerp(cb.set(b), t).getHex();
    return this.tweener.add({
      duration, ease: Ease.inOutCubic, tag: 'ambience',
      update: (t) => {
        const cur = {};
        for (const k of Object.keys(to)) {
          if (k === 'label') continue;
          const a = from[k], b = to[k];
          if (Array.isArray(b)) cur[k] = b.map((v, i) => a[i] + (v - a[i]) * t);
          else if (/color|Sky|Ground|bg/i.test(k)) cur[k] = lerpHex(a, b, t);
          else cur[k] = a + (b - a) * t;
        }
        this.ambience = cur;
        this.applyAmbience(cur);
      },
    });
  }

  // Smooth camera flight; controls stay usable once the flight ends.
  // The target glides straight while the camera swings round it (distance, height and bearing each
  // eased, the short way round). A straight line to the far side of the table would pass over the
  // target and flip the view half a turn in one frame.
  flyTo(position, target, duration = 1400, ease = Ease.inOutCubic) {
    const t0 = this.controls.target.clone(), t1 = target.clone();
    const s0 = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(t0));
    const s1 = new THREE.Spherical().setFromVector3(position.clone().sub(t1));
    const turn = THREE.MathUtils.euclideanModulo(s1.theta - s0.theta + Math.PI, Math.PI * 2) - Math.PI;
    const rise = Math.min(4, this.camera.position.distanceTo(position) * 0.12);
    const s = new THREE.Spherical();
    this.flying = true;
    const id = (this.flightId = (this.flightId || 0) + 1);
    return this.tweener.add({
      duration, ease, tag: 'camera',
      update: (t) => {
        if (id !== this.flightId) return;
        this.controls.target.lerpVectors(t0, t1, t);
        s.set(s0.radius + (s1.radius - s0.radius) * t, s0.phi + (s1.phi - s0.phi) * t, s0.theta + turn * t);
        this.camera.position.setFromSpherical(s).add(this.controls.target);
        // a gentle rise in the middle of long moves keeps the table in view
        this.camera.position.y += Math.sin(Math.PI * t) * rise;
      },
    }).then(() => { if (id === this.flightId) this.flying = false; });
  }

  // Stop steering the camera (the player grabbed it); a pending flight still resolves on time.
  cancelFlight() {
    this.flightId = (this.flightId || 0) + 1;
    this.flying = false;
  }

  // Keep the orbit centre over the table so panning can never lose the game.
  clampTarget() {
    const t = this.controls.target, L = this.panLimit;
    const x = THREE.MathUtils.clamp(t.x, -L.x, L.x), z = THREE.MathUtils.clamp(t.z, -L.z, L.z);
    if (x === t.x && z === t.z) return;
    this.camera.position.x += x - t.x;
    this.camera.position.z += z - t.z;
    t.x = x; t.z = z;
  }

  onFrame(fn) { this.frameCallbacks.add(fn); return () => this.frameCallbacks.delete(fn); }

  tick(dt) {
    this.time += dt;
    const t = this.time;
    this.tweener.update(dt * 1000);
    for (const fn of this.frameCallbacks) fn(t, dt);
    updateMaterials(t, this.ambience.night);
    this.shaft.material.uniforms.uTime.value = t;
    this.cameraMoved = this.controls.update(dt); // dt keeps the auto-rotation speed at any frame rate
    this.clampTarget();
  }

  touched() { return performance.now() - this.touchedAt < 1000; }

  // The game is moving pieces (a paused game keeps its tweens without playing them).
  animating() { return this.tweener.speed > 0 && this.tweener.items.length > 0; }

  // Something the eye follows is moving, so the next frame runs at the display's full rate.
  // Candles, grazing sheep and drifting motes look fine at the idle rate.
  busy() {
    if (this.touched()) return true;
    if (this.calm) return false;
    return this.animating() || this.cameraMoved || this.particles;
  }

  render() {
    // The sun's shadow camera never moves, so the map follows the pieces rather than the view.
    // Sheep, windmills and spinning crowns never stop, but 15 redraws a second is plenty for them.
    const now = performance.now();
    if (this.animating() || this.touched() || now - this.shadowAt > 60) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowAt = now;
    }
    this.updateMotes(this.time);
    this.motes.material.uniforms.uTime.value = this.time;
    this.motes.material.uniforms.uScale.value = this.renderer.domElement.height;
    this.finish.uniforms.uTime.value = this.time;
    this.composer.render();
    this.labels.render(this.scene, this.camera);
  }

  // Debug helper: simulate `seconds` of game time without waiting for frames.
  async fastForward(seconds, step = 1 / 30) {
    for (let s = 0; s < seconds; s += step) {
      this.tick(step);
      for (let i = 0; i < 12; i++) await null; // let awaiting game flows continue
    }
    this.render();
  }

  // Lower the render resolution a notch if the GPU cannot keep ~40fps.
  adaptResolution(raw) {
    const p = this.perf ||= { acc: 0, n: 0, cooldown: 4 };
    if (raw > 0.25 || document.hidden) return;
    p.acc += raw; p.n++; p.cooldown -= raw;
    if (p.acc < 2) return;
    const avg = p.acc / p.n;
    p.acc = 0; p.n = 0;
    const pr = this.renderer.getPixelRatio();
    if (p.cooldown <= 0 && avg > 1 / 40 && pr > 1) {
      this.renderer.setPixelRatio(Math.max(1, pr - 0.25));
      this.resize();
      p.cooldown = 3;
    }
  }

  start() {
    let last = -Infinity, wasBusy = false;
    const loop = (ts) => {
      requestAnimationFrame(loop);
      // idle: about 30fps (every other frame on a 60Hz screen), which halves the GPU's work
      const busy = this.busy();
      if (!busy && ts - last < 26) return;
      last = ts;
      this.timer.update(ts);
      const raw = this.timer.getDelta();
      // the gap after an idle frame would read as a slow GPU
      if (busy && wasBusy) this.adaptResolution(raw);
      wasBusy = busy;
      this.tick(Math.min(0.05, raw));
      this.render();
    };
    requestAnimationFrame(loop);
  }
}
