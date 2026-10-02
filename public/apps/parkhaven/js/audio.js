// Parkhaven - all sound is synthesised with WebAudio at runtime (no audio files).
export class Audio {
  constructor() {
    this.ctx = null; this.sfx = 0.6; this.music = 0.35; this.rainGain = null; this.musicOn = false;
    this.last = {};
  }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = 1; this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain(); this.sfxBus.gain.value = this.sfx; this.sfxBus.connect(this.master);
      this.musBus = this.ctx.createGain(); this.musBus.gain.value = this.music; this.musBus.connect(this.master);
      this.noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { this.ctx = null; }
  }
  setVolumes(sfx, music) {
    this.sfx = sfx; this.music = music;
    if (this.sfxBus) this.sfxBus.gain.value = sfx;
    if (this.musBus) this.musBus.gain.value = music;
  }
  throttle(key, ms) {
    const now = performance.now();
    if (this.last[key] && now - this.last[key] < ms) return false;
    this.last[key] = now; return true;
  }
  tone(freq, dur, type = 'sine', vol = 0.3, when = 0, slide = 0, bus = null) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus || this.sfxBus);
    o.start(t); o.stop(t + dur + 0.02);
  }
  noise(dur, vol, freq = 1200, q = 1, when = 0, type = 'bandpass', sweep = 0) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + when;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfxBus);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  play(name) {
    if (!this.ctx) return;
    switch (name) {
      case 'click': if (this.throttle('click', 40)) this.tone(880, 0.05, 'triangle', 0.12); break;
      case 'place': if (this.throttle('place', 60)) { this.tone(180, 0.09, 'triangle', 0.25, 0, -60); this.noise(0.06, 0.15, 400, 1); } break;
      case 'money': if (this.throttle('money', 120)) { this.tone(1320, 0.07, 'square', 0.05); this.tone(1760, 0.12, 'square', 0.05, 0.06); } break;
      case 'error': this.tone(140, 0.18, 'sawtooth', 0.12, 0, -40); break;
      case 'notice': if (this.throttle('notice', 500)) { this.tone(660, 0.12, 'sine', 0.15); this.tone(990, 0.2, 'sine', 0.12, 0.1); } break;
      case 'bad': if (this.throttle('bad', 800)) { this.tone(440, 0.15, 'triangle', 0.15); this.tone(330, 0.3, 'triangle', 0.15, 0.13); } break;
      case 'thunder': this.noise(2.2, 0.6, 180, 0.7, 0, 'lowpass', -120); this.noise(0.4, 0.3, 900, 0.8); break;
      case 'flush': if (this.throttle('flush', 700)) this.noise(0.8, 0.12, 1800, 2, 0, 'bandpass', -1400); break;
      case 'vomit': if (this.throttle('vomit', 900)) { this.tone(120, 0.3, 'sawtooth', 0.08, 0, -50); this.noise(0.35, 0.1, 500, 3); } break;
      case 'laugh': if (this.throttle('laugh', 1200)) for (let k = 0; k < 4; k++) this.tone(520 + (k & 1) * 70, 0.08, 'triangle', 0.07, k * 0.11, -60); break;
      case 'fanfare': [523, 659, 784, 1046].forEach((f, k) => this.tone(f, 0.35, 'triangle', 0.18, k * 0.16)); break;
      case 'splash': if (this.throttle('splash', 600)) this.noise(0.6, 0.25, 2500, 0.6, 0, 'highpass', -1800); break;
      case 'scream': if (this.throttle('scream', 2500)) for (let k = 0; k < 3; k++) this.tone(900 + k * 120, 0.5, 'sawtooth', 0.025, k * 0.05, 300); break;
      case 'fix': if (this.throttle('fix', 900)) for (let k = 0; k < 3; k++) this.noise(0.05, 0.2, 3000, 4, k * 0.12); break;
      default: break;
    }
  }
  /** rain bed: level 0..2 */
  setRain(level) {
    if (!this.ctx) return;
    if (!this.rainGain) {
      const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
      const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 900;
      this.rainGain = this.ctx.createGain(); this.rainGain.gain.value = 0;
      s.connect(f); f.connect(this.rainGain); this.rainGain.connect(this.sfxBus); s.start();
    }
    const v = level === 0 ? 0 : level === 1 ? 0.05 : 0.12;
    this.rainGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.8);
  }
  /** a gentle generative music-box tune while a carousel is nearby. volume 0..1 */
  setMusic(vol) {
    if (!this.ctx) return;
    if (!this.mus) {
      this.mus = this.ctx.createGain(); this.mus.gain.value = 0; this.mus.connect(this.musBus);
      this.step = 0; this.nextT = this.ctx.currentTime + 0.2;
    }
    this.mus.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.5);
    this.musicVol = vol;
  }
  tick() {
    if (!this.ctx || !this.mus || this.musicVol < 0.01) return;
    const scale = [0, 2, 4, 5, 7, 9, 11, 12];
    const prog = [[0, 4, 7], [5, 9, 12], [7, 11, 14], [0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14], [0, 7, 12]];
    while (this.nextT < this.ctx.currentTime + 0.3) {
      const bar = Math.floor(this.step / 6) % prog.length;
      const beat = this.step % 6;
      const chord = prog[bar];
      const base = 392; // G4
      const semis = beat === 0 ? chord[0] - 12 : beat === 3 ? chord[1] : chord[(this.step * 7) % 3] + (beat % 2 ? 12 : 0);
      const melody = scale[(this.step * 5 + bar) % scale.length];
      const f = base * Math.pow(2, semis / 12);
      this.tone(f, 0.35, 'triangle', beat === 0 ? 0.16 : 0.09, this.nextT - this.ctx.currentTime, 0, this.mus);
      if (beat === 1 || beat === 4) this.tone(base * 2 * Math.pow(2, melody / 12), 0.25, 'sine', 0.06, this.nextT - this.ctx.currentTime, 0, this.mus);
      this.nextT += 0.19;
      this.step++;
    }
  }
}
