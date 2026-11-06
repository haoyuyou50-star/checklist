export class WindAudio {
  constructor() { this.ctx = null; this.on = true; }

  start() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const len = ctx.sampleRate * 4;
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let last = 0;
        for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.2; }
      }
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.7;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
      const g1 = ctx.createGain(), g2 = ctx.createGain(), master = ctx.createGain();
      g1.gain.value = 0; g2.gain.value = 0; master.gain.value = 1;
      src.connect(bp).connect(g1).connect(master);
      src.connect(lp).connect(g2).connect(master);
      master.connect(ctx.destination);
      src.start();
      Object.assign(this, { ctx, bp, g1, g2, master });
    } catch (e) { this.ctx = null; }
  }

  update(level) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, on = this.on ? 1 : 0;
    this.g1.gain.setTargetAtTime(on * (0.02 + level * 0.3), t, 0.35);
    this.g2.gain.setTargetAtTime(on * (0.05 + level * 0.18), t, 0.5);
    this.bp.frequency.setTargetAtTime(280 + level * 950, t, 0.45);
  }

  toggle() { this.on = !this.on; return this.on; }
}
