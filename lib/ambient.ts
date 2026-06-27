// Browser-only: Web Audio API ambient fairy-tale music generator.
// No external file needed. Uses sine oscillators + bell chimes + light reverb.

// C major pentatonic bell frequencies (C5–C6)
const BELL_FREQS = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];

export class AmbientPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private running = false;
  private nextChime: ReturnType<typeof setTimeout> | null = null;

  // Lazily create AudioContext on first user interaction
  private setup(): { ctx: AudioContext; master: GainNode } {
    if (this.ctx && this.master) return { ctx: this.ctx, master: this.master };

    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    // Feedback delay → soft reverb
    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = 0.28;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const fbFilter = ctx.createBiquadFilter();
    fbFilter.type = "lowpass";
    fbFilter.frequency.value = 1200;
    delay.connect(fb);
    fb.connect(fbFilter);
    fbFilter.connect(delay);
    fbFilter.connect(master);

    // Drone: C2 + G2 very soft
    for (const [freq, gain] of [[65.4, 0.12], [98.0, 0.07]] as const) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;

      // Slow vibrato via LFO
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.18;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.4;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      lfo.start();

      const g = ctx.createGain();
      g.gain.value = gain;
      osc.connect(g);
      g.connect(master);
      osc.start();
    }

    this.ctx = ctx;
    this.master = master;
    return { ctx, master };
  }

  private scheduleChime(): void {
    if (!this.running) return;
    const delay = 1800 + Math.random() * 3200;
    this.nextChime = setTimeout(() => {
      this.playBell();
      this.scheduleChime();
    }, delay);
  }

  private playBell(): void {
    if (!this.ctx || !this.master) return;
    const { ctx, master } = this;

    // Occasionally play two bells close together
    const count = Math.random() < 0.3 ? 2 : 1;
    for (let n = 0; n < count; n++) {
      const t = ctx.currentTime + n * 0.22;
      const freq = BELL_FREQS[Math.floor(Math.random() * BELL_FREQS.length)];

      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;

      // Harmonic — add subtle octave above
      const osc2 = ctx.createOscillator();
      osc2.type = "sine";
      osc2.frequency.value = freq * 2;

      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + 3.2);

      const g2 = ctx.createGain();
      g2.gain.value = 0.35;

      osc.connect(g);
      osc2.connect(g2);
      g2.connect(g);
      g.connect(master);

      osc.start(t);
      osc2.start(t);
      osc.stop(t + 3.2);
      osc2.stop(t + 3.2);
    }
  }

  start(): void {
    const { ctx, master } = this.setup();
    ctx.resume();
    // Fade in
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(0.22, ctx.currentTime, 0.8);
    if (!this.running) {
      this.running = true;
      this.scheduleChime();
      this.playBell();
    }
  }

  stop(): void {
    this.running = false;
    if (this.nextChime) { clearTimeout(this.nextChime); this.nextChime = null; }
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.6);
      setTimeout(() => this.ctx?.suspend(), 2000);
    }
  }

  setVolume(v: number): void {
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.12);
    }
  }

  destroy(): void {
    this.running = false;
    if (this.nextChime) clearTimeout(this.nextChime);
    this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }
}
