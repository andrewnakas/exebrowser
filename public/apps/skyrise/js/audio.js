// Skyrise — all sound is synthesised here with WebAudio (oscillators, noise, envelopes).
export class Sound {
  constructor() {
    this.ac = null;
    this.on = { elevators: true, ambience: true, events: true };
    this.master = null;
    this.lastCar = 0; this.carCount = 0;
    this.rainNode = null;
  }
  ensure() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume().catch(() => {}); return true; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ac = new AC();
      this.master = this.ac.createGain(); this.master.gain.value = 0.5; this.master.connect(this.ac.destination);
      const len = this.ac.sampleRate * 1.5;
      this.noiseBuf = this.ac.createBuffer(1, len, this.ac.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return true;
    } catch (e) { return false; }
  }
  get ready() { return !!this.ac && this.ac.state === 'running'; }
  now() { return this.ac.currentTime; }

  tone(f, dur, { type = 'sine', gain = 0.2, at = 0, attack = 0.005, slide = null, dest = null } = {}) {
    const a = this.ac, t = a.currentTime + at;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  noise(dur, { freq = 1000, q = 1, type = 'bandpass', gain = 0.2, at = 0, attack = 0.01, slide = null } = {}) {
    const a = this.ac, t = a.currentTime + at;
    const s = a.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = a.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (slide) f.frequency.exponentialRampToValueAtTime(slide, t + dur);
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  play(name) {
    if (!this.ready || !this.on.events) return;
    const T = (f, d, o) => this.tone(f, d, o), N = (d, o) => this.noise(d, o);
    switch (name) {
      case 'build': N(0.08, { freq: 300, q: 2, gain: 0.35 }); T(140, 0.12, { type: 'triangle', gain: 0.25 }); N(0.06, { freq: 900, q: 3, gain: 0.2, at: 0.09 }); break;
      case 'buildFlex': N(0.05, { freq: 500, q: 2, gain: 0.25 }); T(220, 0.08, { type: 'triangle', gain: 0.18 }); break;
      case 'refuse': T(180, 0.12, { type: 'square', gain: 0.08 }); T(130, 0.16, { type: 'square', gain: 0.08, at: 0.1 }); break;
      case 'bulldoze': N(0.35, { freq: 160, q: 0.8, gain: 0.4, type: 'lowpass', slide: 60 }); T(70, 0.3, { type: 'sawtooth', gain: 0.08 }); break;
      case 'coins': if (this._coinT && this.now() - this._coinT < 0.25) return; this._coinT = this.now(); T(1318, 0.08, { type: 'square', gain: 0.05 }); T(1760, 0.14, { type: 'square', gain: 0.05, at: 0.06 }); break;
      case 'fanfare': [523, 659, 784, 1046].forEach((f, i) => T(f, i === 3 ? 0.7 : 0.18, { type: 'triangle', gain: 0.22, at: i * 0.14 })); T(392, 0.9, { type: 'sine', gain: 0.1, at: 0.42 }); break;
      case 'finalFanfare': [392, 523, 659, 784, 659, 784, 1046].forEach((f, i) => T(f, i === 6 ? 1.2 : 0.2, { type: 'triangle', gain: 0.22, at: i * 0.16 })); [262, 330, 392].forEach(f => T(f, 1.6, { gain: 0.08, at: 0.96 })); break;
      case 'applause': for (let i = 0; i < 40; i++) N(0.03, { freq: 2000 + Math.random() * 2000, q: 1.5, gain: 0.12, at: Math.random() * 1.4 }); break;
      case 'phone': for (let r = 0; r < 3; r++) for (let i = 0; i < 8; i++) T(i % 2 ? 640 : 800, 0.05, { type: 'square', gain: 0.06, at: r * 0.8 + i * 0.05 }); break;
      case 'fireAlarm': for (let i = 0; i < 6; i++) T(880, 0.25, { type: 'sawtooth', gain: 0.07, at: i * 0.32, slide: 600 }); break;
      case 'explosion': N(1.4, { freq: 400, type: 'lowpass', q: 0.5, gain: 0.8, slide: 40 }); T(50, 1.0, { type: 'sine', gain: 0.5, slide: 25 }); break;
      case 'helicopter': for (let i = 0; i < 20; i++) N(0.06, { freq: 180, q: 1, type: 'lowpass', gain: 0.3, at: i * 0.09 }); break;
      case 'treasure': [784, 988, 1175, 1568].forEach((f, i) => T(f, 0.3, { type: 'sine', gain: 0.18, at: i * 0.09 })); break;
      case 'jingle': [659, 659, 659, 0, 659, 659, 659, 0, 659, 784, 523, 587, 659].forEach((f, i) => { if (f) T(f, 0.16, { type: 'triangle', gain: 0.15, at: i * 0.13 }); }); for (let i = 0; i < 12; i++) T(2400 + (i % 3) * 300, 0.05, { gain: 0.03, at: i * 0.13 }); break;
      case 'notice': T(988, 0.09, { gain: 0.08 }); T(1318, 0.14, { gain: 0.07, at: 0.08 }); break;
      case 'thunder': if (!this.on.ambience) return; N(2.2, { freq: 120, type: 'lowpass', q: 0.6, gain: 0.5, attack: 0.15, slide: 50 }); break;
      case 'train': if (!this.on.ambience) return; N(2.5, { freq: 300, type: 'lowpass', q: 1, gain: 0.15, attack: 0.6 }); T(660, 0.4, { gain: 0.04, at: 0.3 }); T(550, 0.6, { gain: 0.04, at: 0.7 }); break;
    }
  }
  carEvent(kind) {
    if (!this.ready || !this.on.elevators) return;
    const n = this.now();
    if (n - this.lastCar < 0.18) return; // limit how many play at once
    this.lastCar = n;
    if (kind === 'arrive') { this.tone(1568, 0.5, { gain: 0.05 }); this.tone(1175, 0.6, { gain: 0.035, at: 0.12 }); }
    else this.noise(0.25, { freq: 500, q: 0.7, gain: 0.04, slide: 900 });
  }
  // background: one quiet cue per half-second picked from what is on screen
  ambient(kind) {
    if (!this.ready || !this.on.ambience) return;
    const T = (f, d, o) => this.tone(f, d, o), N = (d, o) => this.noise(d, o);
    switch (kind) {
      case 'office': for (let i = 0; i < 3; i++) T(180 + Math.random() * 120, 0.12, { type: 'triangle', gain: 0.012, at: i * 0.12 }); N(0.04, { freq: 3000, q: 4, gain: 0.02, at: 0.2 }); break; // murmur + keyboard tick
      case 'fastfood': N(0.03, { freq: 4000, q: 6, gain: 0.03 }); N(0.03, { freq: 3500, q: 6, gain: 0.025, at: 0.11 }); T(1200, 0.05, { gain: 0.01, at: 0.2 }); break;
      case 'restaurant': for (let i = 0; i < 4; i++) T(150 + Math.random() * 90, 0.2, { type: 'triangle', gain: 0.01, at: i * 0.1 }); T(2600, 0.15, { gain: 0.01, at: 0.3 }); break;
      case 'party': for (let i = 0; i < 4; i++) T([262, 330, 392, 330][i] * (Math.random() < 0.5 ? 1 : 2), 0.1, { type: 'square', gain: 0.012, at: i * 0.11 }); break;
      case 'cinema': T(110, 0.5, { type: 'sawtooth', gain: 0.015 }); T(165, 0.5, { gain: 0.015 }); break;
      case 'condo': T(500 + Math.random() * 200, 0.08, { type: 'triangle', gain: 0.012 }); break;
      case 'hotel': if (Math.random() < 0.5) { T(880, 0.15, { gain: 0.015 }); T(698, 0.2, { gain: 0.015, at: 0.15 }); } else N(0.4, { freq: 600, q: 2, gain: 0.02 }); break;
      case 'parking': N(0.6, { freq: 120, type: 'lowpass', q: 1, gain: 0.05, attack: 0.2 }); break;
      case 'birds': for (let i = 0; i < 3; i++) T(2800 + Math.random() * 800, 0.06, { gain: 0.02, at: i * 0.09, slide: 3600 }); break;
      case 'crickets': for (let i = 0; i < 4; i++) T(4200, 0.03, { type: 'square', gain: 0.006, at: i * 0.05 }); break;
      case 'traffic': N(0.8, { freq: 200, type: 'lowpass', q: 0.7, gain: 0.03, attack: 0.3 }); break;
      case 'wind': N(1.5, { freq: 400, q: 0.5, gain: 0.03, attack: 0.6, slide: 250 }); break;
    }
  }
  setRain(on) {
    if (!this.ac) return;
    const want = on && this.on.ambience;
    if (want && !this.rainNode) {
      const s = this.ac.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
      const f = this.ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1200;
      const g = this.ac.createGain(); g.gain.value = 0.05;
      s.connect(f); f.connect(g); g.connect(this.master); s.start();
      this.rainNode = { s, g };
    } else if (!want && this.rainNode) {
      try { this.rainNode.s.stop(); } catch (e) { }
      this.rainNode = null;
    }
  }
  suspend(paused) { if (this.ac) { if (paused) this.setRain(false); } }
}
