// All audio is synthesised at runtime: wooden clacks, whooshes, bells, brass fanfares and
// a generative lute-and-drone soundtrack built from Karplus-Strong plucked strings.

const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

export class Sound {
  constructor() {
    this.ctx = null;
    this.sfxOn = true;
    this.musicOn = true;
    this.musicVolume = 0.32;
    this.pluckCache = new Map();
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.8, 2.6);
    const rvGain = ctx.createGain(); rvGain.gain.value = 0.35;
    this.reverb.connect(rvGain).connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.gain.value = this.sfxOn ? 1 : 0;
    this.sfx.connect(this.master);
    this.sfxSend = ctx.createGain(); this.sfxSend.gain.value = 0.25;
    this.sfx.connect(this.sfxSend).connect(this.reverb);
    this.music = ctx.createGain(); this.music.gain.value = this.musicOn ? this.musicVolume : 0;
    this.music.connect(this.master);
    const mSend = ctx.createGain(); mSend.gain.value = 0.6;
    this.music.connect(mSend).connect(this.reverb);
    this.noise = this.makeNoise(2);
    this.startMusic();
  }

  impulse(sec, decay) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
    }
    return buf;
  }

  makeNoise(sec) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  setSfx(on) { this.sfxOn = on; if (this.sfx) this.sfx.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05); }
  setMusic(on) { this.musicOn = on; if (this.music) this.music.gain.setTargetAtTime(on ? this.musicVolume : 0, this.ctx.currentTime, 0.4); }

  get ok() { return this.ctx && this.ctx.state === 'running'; }

  env(gainNode, t, a, peak, d) {
    gainNode.gain.setValueAtTime(0.0001, t);
    gainNode.gain.exponentialRampToValueAtTime(peak, t + a);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  noiseBurst({ t, dur = 0.08, type = 'bandpass', freq = 2000, q = 1, gain = 0.3, attack = 0.002, dest = this.sfx, sweepTo }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    this.env(g, t, attack, gain, dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5, attack + dur + 0.05);
  }

  tone({ t, freq, dur = 0.2, type = 'sine', gain = 0.2, attack = 0.005, dest = this.sfx, slideTo, detune = 0 }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t); o.detune.value = detune;
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    this.env(g, t, attack, gain, dur);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + attack + dur + 0.05);
  }

  // Wooden tile knocking on the table.
  clack(power = 1) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + 0.005;
    const p = 0.9 + Math.random() * 0.2;
    this.tone({ t, freq: 190 * p, slideTo: 70, dur: 0.12, gain: 0.45 * power });
    this.tone({ t, freq: 620 * p, dur: 0.05, type: 'triangle', gain: 0.18 * power });
    this.noiseBurst({ t, freq: 2600 * p, q: 1.4, gain: 0.35 * power, dur: 0.045 });
    this.noiseBurst({ t: t + 0.05, freq: 3200 * p, q: 2, gain: 0.08 * power, dur: 0.03 });
  }

  thud(power = 1) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + 0.005;
    this.tone({ t, freq: 130, slideTo: 55, dur: 0.14, gain: 0.4 * power });
    this.noiseBurst({ t, type: 'lowpass', freq: 900, gain: 0.25 * power, dur: 0.06 });
  }

  whoosh(dur = 0.35, power = 1) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + 0.005;
    this.noiseBurst({ t, freq: 350, sweepTo: 1800, q: 0.9, gain: 0.12 * power, attack: dur * 0.45, dur: dur * 0.55 });
  }

  flip() {
    if (!this.ok) return;
    this.whoosh(0.22, 0.8);
    setTimeout(() => this.clack(0.55), 230);
  }

  pluck(midi, { t = this.ctx.currentTime + 0.01, gain = 0.5, dest = this.sfx, bright = 0.5, dur = 2.4 } = {}) {
    if (!this.ctx) return;
    const key = midi + ':' + bright;
    let buf = this.pluckCache.get(key);
    if (!buf) {
      const sr = this.ctx.sampleRate, freq = midiHz(midi);
      const N = Math.max(2, Math.round(sr / freq));
      const len = Math.floor(sr * dur);
      buf = this.ctx.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      const ring = new Float32Array(N);
      let last = 0;
      for (let i = 0; i < N; i++) { const r = Math.random() * 2 - 1; last = last + (r - last) * (0.25 + bright * 0.7); ring[i] = last; }
      const decay = 0.9975 - (midi > 72 ? 0.002 : 0);
      let idx = 0;
      for (let i = 0; i < len; i++) {
        const cur = ring[idx], nxt = ring[(idx + 1) % N];
        d[i] = cur;
        ring[idx] = (cur + nxt) * 0.5 * decay;
        idx = (idx + 1) % N;
      }
      // gentle fade in to soften the pick attack
      for (let i = 0; i < 64 && i < len; i++) d[i] *= i / 64;
      this.pluckCache.set(key, buf);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 3200 + bright * 3000;
    src.connect(f).connect(g).connect(dest);
    src.start(t);
  }

  select() {
    if (!this.ok) return;
    const t = this.ctx.currentTime + 0.01;
    this.pluck(74, { t, gain: 0.55, bright: 0.8 });
    this.pluck(81, { t: t + 0.07, gain: 0.45, bright: 0.8 });
  }

  hover() {
    if (!this.ok) return;
    this.tone({ t: this.ctx.currentTime + 0.005, freq: 1400, dur: 0.04, gain: 0.03, type: 'sine' });
  }

  rotate() {
    if (!this.ok) return;
    const t = this.ctx.currentTime + 0.005;
    this.noiseBurst({ t, freq: 1600, q: 2, gain: 0.08, dur: 0.05 });
    this.tone({ t, freq: 880, dur: 0.04, gain: 0.05, type: 'triangle' });
  }

  bell(midi, gain = 0.25, t = this.ctx.currentTime + 0.01) {
    const f = midiHz(midi);
    for (const [ratio, g, d] of [[1, 1, 1.4], [2.01, 0.5, 0.9], [2.76, 0.35, 0.6], [5.4, 0.18, 0.3], [8.9, 0.08, 0.15]]) {
      this.tone({ t, freq: f * ratio, dur: d, gain: gain * g, attack: 0.002 });
    }
  }

  chime(step = 0) {
    if (!this.ok) return;
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
    this.bell(76 + scale[Math.min(step, scale.length - 1)], 0.16);
  }

  // A realm's final total: two bells a fifth apart.
  tally() {
    if (!this.ok) return;
    const t = this.ctx.currentTime + 0.01;
    this.bell(72, 0.2, t);
    this.bell(79, 0.18, t + 0.16);
  }

  coin() {
    if (!this.ok) return;
    const t = this.ctx.currentTime + 0.01;
    this.tone({ t, freq: 1976, dur: 0.12, gain: 0.08 });
    this.tone({ t: t + 0.08, freq: 2637, dur: 0.3, gain: 0.08 });
  }

  error() {
    if (!this.ok) return;
    const t = this.ctx.currentTime + 0.01;
    this.tone({ t, freq: 150, dur: 0.18, type: 'square', gain: 0.05 });
    this.tone({ t: t + 0.12, freq: 120, dur: 0.2, type: 'square', gain: 0.05 });
  }

  brass(midi, t, dur, gain = 0.12) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(2800, t + 0.06);
    f.frequency.exponentialRampToValueAtTime(1400, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.04);
    g.gain.setValueAtTime(gain, t + dur - 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
    f.connect(g).connect(this.sfx);
    for (const det of [-7, 0, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = midiHz(midi); o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + dur + 0.3);
    }
  }

  fanfare() {
    if (!this.ok) return;
    const t = this.ctx.currentTime + 0.05;
    const seq = [[60, 0, 0.18], [60, 0.2, 0.12], [60, 0.34, 0.12], [67, 0.5, 0.45], [64, 1.0, 0.2], [67, 1.22, 0.2], [72, 1.45, 1.1]];
    for (const [m, dt, d] of seq) { this.brass(m, t + dt, d); this.brass(m - 12, t + dt, d, 0.07); }
    this.brass(76, t + 1.45, 1.1, 0.07);
    this.brass(79, t + 1.45, 1.1, 0.06);
    this.noiseBurst({ t: t + 1.45, type: 'highpass', freq: 5000, gain: 0.12, dur: 1.4 });
  }

  turnChime() {
    if (!this.ok) return;
    const t = this.ctx.currentTime + 0.01;
    this.bell(79, 0.1, t);
    this.bell(86, 0.08, t + 0.12);
  }

  // ---------- generative soundtrack ----------
  startMusic() {
    const ctx = this.ctx;
    this.beat = 0.46;           // seconds per beat, 3/4 time
    this.nextTime = ctx.currentTime + 0.4;
    this.step = 0;
    // D dorian progression (i VII i v III VII IV i)
    this.chords = [[50, 53, 57], [48, 52, 55], [50, 53, 57], [45, 48, 52], [53, 57, 60], [48, 52, 55], [55, 59, 62], [50, 53, 57]];
    this.scale = [62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79];
    this.melodyIdx = 4;
    this.drone();
    this.timer = setInterval(() => this.schedule(), 60);
  }

  drone() {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0.035;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    g.connect(f).connect(this.music);
    for (const [m, det] of [[38, -4], [45, 3], [50, 0]]) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = midiHz(m); o.detune.value = det;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07 + Math.random() * 0.05;
      const lg = ctx.createGain(); lg.gain.value = 4;
      lfo.connect(lg).connect(o.detune); lfo.start();
      o.connect(g); o.start();
    }
  }

  schedule() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    while (this.nextTime < ctx.currentTime + 0.3) {
      const s = this.step;
      const bar = Math.floor(s / 6) % this.chords.length;   // 6 eighths per 3/4 bar
      const eighth = s % 6;
      const chord = this.chords[bar];
      const t = this.nextTime;
      const phrase = Math.floor(s / 48) % 4;
      if (eighth === 0) {
        this.pluck(chord[0] - 12, { t, gain: 0.5, dest: this.music, bright: 0.3, dur: 3 });
        if (phrase > 0) this.noiseBurst({ t, type: 'lowpass', freq: 180, gain: 0.12, dur: 0.18, dest: this.music });
      }
      // lute arpeggio
      const pattern = [0, 1, 2, 1, 2, 1];
      const note = chord[pattern[eighth]] + 12;
      if (!(eighth === 5 && Math.random() < 0.4)) this.pluck(note, { t: t + (Math.random() - 0.5) * 0.012, gain: eighth === 0 ? 0.3 : 0.2, dest: this.music, bright: 0.45 });
      if (eighth === 3 && phrase > 1) this.noiseBurst({ t, type: 'bandpass', freq: 3500, q: 3, gain: 0.02, dur: 0.05, dest: this.music });
      // melody: a wandering line that prefers chord tones on strong beats
      if (phrase !== 0 && (eighth % 2 === 0) && Math.random() < 0.72) {
        let idx = this.melodyIdx + [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)];
        idx = Math.max(0, Math.min(this.scale.length - 1, idx));
        if (eighth === 0) {
          const tones = chord.map((c) => ((c % 12) + 12) % 12);
          for (let k = 0; k < 3 && !tones.includes(this.scale[idx] % 12); k++) idx = Math.max(0, Math.min(this.scale.length - 1, idx + (Math.random() < 0.5 ? 1 : -1)));
        }
        this.melodyIdx = idx;
        const long = eighth === 4 ? 2 : 1;
        this.pluck(this.scale[idx], { t, gain: 0.28 * long, dest: this.music, bright: 0.7, dur: 2.2 });
      }
      this.nextTime += this.beat / 2;
      this.step++;
    }
  }
}
