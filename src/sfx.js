// Efectos de sonido sintetizados con WebAudio (sin archivos de audio).
export class Sfx {
  constructor() {
    this.enabled = true;
    this.ctx = null;
    this.last = {};
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.3;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  tone(freq, dur, { type = 'sine', vol = 0.3, when = 0, to = null } = {}) {
    const c = this.ctx, t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  noise(dur, { vol = 0.3, when = 0, freq = 1000, to = null, q = 1, type = 'bandpass' } = {}) {
    const c = this.ctx, t = c.currentTime + when;
    if (!this.noiseBuf) {
      // un solo buffer de ruido (2 s) reutilizado por todos los sonidos
      this.noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * Math.max(0, 2 - dur));
    src.stop(t + dur + 0.05);
  }

  play(name) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    // Evitar saturar cuando el tiempo va acelerado
    const now = performance.now();
    if (now - (this.last[name] || 0) < 90) return;
    this.last[name] = now;
    switch (name) {
      case 'spin': for (let i = 0; i < 12; i++) this.tone(900 + (i % 3) * 120, 0.04, { type: 'square', vol: 0.06, when: i * 0.07 }); break;
      case 'win': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.18, { type: 'triangle', vol: 0.2, when: i * 0.09 })); break;
      case 'jackpot':
        for (let r = 0; r < 3; r++) [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.16, { type: 'square', vol: 0.1, when: r * 0.5 + i * 0.08 }));
        break;
      case 'near': this.tone(440, 0.25, { type: 'triangle', vol: 0.18 }); this.tone(415, 0.25, { type: 'triangle', vol: 0.18, when: 0.22 }); this.tone(392, 0.45, { type: 'triangle', vol: 0.18, when: 0.44, to: 330 }); break;
      case 'lose': this.tone(160, 0.18, { type: 'sine', vol: 0.15, to: 110 }); break;
      case 'gulp': this.tone(240, 0.12, { vol: 0.35, to: 90 }); this.tone(200, 0.1, { vol: 0.25, when: 0.14, to: 80 }); break;
      case 'munch': for (let i = 0; i < 3; i++) this.noise(0.06, { vol: 0.15, when: i * 0.1, freq: 2500, q: 2 }); break;
      case 'inhale': this.noise(0.9, { vol: 0.12, freq: 600, to: 1800, q: 0.7 }); break;
      case 'cough': this.noise(0.15, { vol: 0.35, freq: 500, q: 1.5 }); this.noise(0.12, { vol: 0.3, when: 0.2, freq: 450, q: 1.5 }); break;
      case 'snort': this.noise(0.35, { vol: 0.35, freq: 900, to: 4000, q: 1.2 }); break;
      case 'swipe': this.noise(0.14, { vol: 0.1, freq: 1500, to: 5000, type: 'highpass', q: 0.5 }); break;
      case 'zap': this.tone(1400, 0.35, { type: 'sawtooth', vol: 0.12, to: 120 }); this.noise(0.4, { vol: 0.15, freq: 300, q: 0.8 }); break;
      case 'death': this.tone(420, 1.6, { type: 'triangle', vol: 0.25, to: 50 }); break;
      case 'click': this.tone(1200, 0.03, { type: 'square', vol: 0.08 }); break;
    }
  }
}
