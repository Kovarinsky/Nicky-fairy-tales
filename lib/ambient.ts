// Browser-only: procedural ambient music via Web Audio API.
// No external files. Each Soundscape has its own synthesis layer.
// Layers crossfade over ~1.5s when the scene changes.

import type { Soundscape } from "./types";
export type { Soundscape };

// ── Frequency tables ──────────────────────────────────────────────────────────
const BELLS_MAGIC  = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50]; // C5-C6 major pent
const BELLS_NIGHT  = [220.00, 261.63, 311.13, 369.99, 440.00];          // A3-A4 minor pent
const BELLS_ADVENT = [392.00, 493.88, 587.33, 698.46, 880.00];          // G4-A5 pentatonic
const BELLS_COZY   = [523.25, 659.25, 783.99];                          // C5 E5 G5 soft

// ── Types ─────────────────────────────────────────────────────────────────────
type Cleanup = () => void;

interface Layer {
  gain: GainNode;   // crossfade handle
  cleanup: Cleanup; // stop all timers + sources
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function randOf<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min: number, max: number) { return min + Math.random() * (max - min); }

function sine(ctx: AudioContext, freq: number, gain: number, dest: AudioNode): Cleanup {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = rand(0.08, 0.20);
  const lfoG = ctx.createGain();
  lfoG.gain.value = rand(0.2, 0.5);
  lfo.connect(lfoG);
  lfoG.connect(osc.frequency);
  lfo.start();
  const g = ctx.createGain();
  g.gain.value = gain;
  osc.connect(g);
  g.connect(dest);
  osc.start();
  return () => { try { osc.stop(); lfo.stop(); } catch { /* already stopped */ } };
}

function bell(ctx: AudioContext, freqs: number[], reverb: AudioNode, vol: number): void {
  const freq = randOf(freqs);
  const t = ctx.currentTime;
  for (const [f, g] of [[freq, vol], [freq * 2, vol * 0.3]] as const) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = f;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(g, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 3.0);
    osc.connect(gain);
    gain.connect(reverb);
    osc.start(t);
    osc.stop(t + 3.1);
  }
}

function birdChirp(ctx: AudioContext, dest: AudioNode): void {
  const count = 2 + Math.floor(rand(0, 3));
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const t = ctx.currentTime;
      const f0 = rand(1100, 2400);
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.linearRampToValueAtTime(f0 * rand(0.65, 1.1), t + 0.09);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.06, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      osc.connect(g);
      g.connect(dest);
      osc.start(t);
      osc.stop(t + 0.15);
    }, i * 110);
  }
}

function crackle(ctx: AudioContext, dest: AudioNode): void {
  const t = ctx.currentTime;
  const samples = Math.floor(ctx.sampleRate * 0.04);
  const buf = ctx.createBuffer(1, samples, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < samples; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / samples);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = rand(0.05, 0.12);
  src.connect(g);
  g.connect(dest);
  src.start(t);
}

function noiseSource(ctx: AudioContext, buf: AudioBuffer): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  return src;
}

function makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const sz = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(1, sz, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < sz; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// ── Soundscape builders ───────────────────────────────────────────────────────
// Each returns a cleanup fn. `dest` = layer gain node, `rev` = reverb send.

function buildMagic(ctx: AudioContext, dest: AudioNode, rev: AudioNode): Cleanup {
  const cleanups: Cleanup[] = [
    sine(ctx, 65.4, 0.12, dest),  // C2
    sine(ctx, 98.0, 0.07, dest),  // G2
  ];
  let t: ReturnType<typeof setTimeout>;
  const schedule = () => {
    t = setTimeout(() => {
      bell(ctx, BELLS_MAGIC, rev, 0.10);
      if (Math.random() < 0.3) setTimeout(() => bell(ctx, BELLS_MAGIC, rev, 0.07), 260);
      schedule();
    }, rand(2000, 4500));
  };
  schedule();
  return () => { clearTimeout(t); cleanups.forEach(c => c()); };
}

function buildForest(ctx: AudioContext, dest: AudioNode, rev: AudioNode, noiseBuf: AudioBuffer): Cleanup {
  const cleanups: Cleanup[] = [
    sine(ctx, 82.4, 0.04, dest), // E2 subtle
  ];

  // Wind: bandpass filtered noise with slow LFO on filter freq
  const wind = noiseSource(ctx, noiseBuf);
  const filt = ctx.createBiquadFilter();
  filt.type = "bandpass";
  filt.frequency.value = 700;
  filt.Q.value = 0.7;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.05;
  const lfoG = ctx.createGain();
  lfoG.gain.value = 280;
  lfo.connect(lfoG);
  lfoG.connect(filt.frequency);
  lfo.start();
  const windG = ctx.createGain();
  windG.gain.value = 0.07;
  wind.connect(filt);
  filt.connect(windG);
  windG.connect(dest);
  wind.start();
  cleanups.push(() => { try { wind.stop(); lfo.stop(); } catch { /**/ } });

  let t: ReturnType<typeof setTimeout>;
  const schedule = () => {
    t = setTimeout(() => { birdChirp(ctx, dest); schedule(); }, rand(3000, 7000));
  };
  schedule();
  return () => { clearTimeout(t); cleanups.forEach(c => c()); };
}

function buildNight(ctx: AudioContext, dest: AudioNode, rev: AudioNode): Cleanup {
  const cleanups: Cleanup[] = [
    sine(ctx, 55.0, 0.10, dest),  // A1
    sine(ctx, 82.4, 0.06, dest),  // E2
  ];

  // Crickets: rapid high-freq staccato
  const cricketIv = setInterval(() => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.frequency.value = rand(4100, 4400);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.035, t);
    g.gain.linearRampToValueAtTime(0, t + 0.03);
    osc.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(t + 0.04);
  }, rand(100, 140));

  let t: ReturnType<typeof setTimeout>;
  const schedule = () => {
    t = setTimeout(() => { bell(ctx, BELLS_NIGHT, rev, 0.07); schedule(); }, rand(4500, 8000));
  };
  schedule();
  return () => { clearTimeout(t); clearInterval(cricketIv); cleanups.forEach(c => c()); };
}

function buildAdventure(ctx: AudioContext, dest: AudioNode, rev: AudioNode): Cleanup {
  // Rhythmic bass pulse ~80 bpm
  const pulseIv = setInterval(() => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 58;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    osc.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(t + 0.35);
  }, 750);

  let t: ReturnType<typeof setTimeout>;
  const schedule = () => {
    t = setTimeout(() => {
      bell(ctx, BELLS_ADVENT, rev, 0.11);
      schedule();
    }, rand(1200, 2800));
  };
  schedule();
  return () => { clearTimeout(t); clearInterval(pulseIv); };
}

function buildCozy(ctx: AudioContext, dest: AudioNode, rev: AudioNode): Cleanup {
  const cleanups: Cleanup[] = [
    sine(ctx, 65.4, 0.08, dest),  // C2
    sine(ctx, 130.8, 0.04, dest), // C3
  ];

  let bellT: ReturnType<typeof setTimeout>;
  const scheduleBell = () => {
    bellT = setTimeout(() => { bell(ctx, BELLS_COZY, rev, 0.07); scheduleBell(); }, rand(6000, 10000));
  };
  scheduleBell();

  let crackleT: ReturnType<typeof setTimeout>;
  const scheduleCrackle = () => {
    crackleT = setTimeout(() => { crackle(ctx, dest); scheduleCrackle(); }, rand(700, 3000));
  };
  scheduleCrackle();

  return () => {
    clearTimeout(bellT);
    clearTimeout(crackleT);
    cleanups.forEach(c => c());
  };
}

// ── AmbientPlayer ─────────────────────────────────────────────────────────────
export class AmbientPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverbSend: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private layer: Layer | null = null;
  private currentScene: Soundscape = "magic";
  private running = false;
  private vol = 0.22;

  private setup(): { ctx: AudioContext; master: GainNode; rev: GainNode } {
    if (this.ctx && this.master && this.reverbSend) {
      return { ctx: this.ctx, master: this.master, rev: this.reverbSend };
    }
    const ctx = new AudioContext();

    // Master → output
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    // Feedback delay reverb → master
    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = 0.32;
    const fb = ctx.createGain();
    fb.gain.value = 0.34;
    const fbF = ctx.createBiquadFilter();
    fbF.type = "lowpass";
    fbF.frequency.value = 1300;
    delay.connect(fb);
    fb.connect(fbF);
    fbF.connect(delay);
    fbF.connect(master);

    const rev = ctx.createGain();
    rev.gain.value = 1;
    rev.connect(delay);

    // Resume on first user gesture (browser autoplay policy)
    const unlock = () => {
      ctx.resume();
      document.removeEventListener("click", unlock);
      document.removeEventListener("touchstart", unlock);
    };
    document.addEventListener("click", unlock);
    document.addEventListener("touchstart", unlock);

    this.ctx = ctx;
    this.master = master;
    this.reverbSend = rev;
    return { ctx, master, rev };
  }

  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noiseBuf) this.noiseBuf = makeNoiseBuffer(ctx);
    return this.noiseBuf;
  }

  private buildLayer(scene: Soundscape, ctx: AudioContext, rev: GainNode): Layer {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.master!);

    let cleanup: Cleanup;
    switch (scene) {
      case "forest":    cleanup = buildForest(ctx, gain, rev, this.getNoiseBuffer(ctx)); break;
      case "night":     cleanup = buildNight(ctx, gain, rev); break;
      case "adventure": cleanup = buildAdventure(ctx, gain, rev); break;
      case "cozy":      cleanup = buildCozy(ctx, gain, rev); break;
      default:          cleanup = buildMagic(ctx, gain, rev); break;
    }
    return { gain, cleanup };
  }

  private crossfade(next: Soundscape): void {
    const { ctx, rev } = this.setup();
    const t = ctx.currentTime;

    // Fade out + destroy old layer
    if (this.layer) {
      const old = this.layer;
      old.gain.gain.setTargetAtTime(0, t, 0.4);
      setTimeout(() => old.cleanup(), 2500);
    }

    // Build + fade in new layer
    const newLayer = this.buildLayer(next, ctx, rev);
    newLayer.gain.gain.setValueAtTime(0, t);
    newLayer.gain.gain.setTargetAtTime(1, t + 0.05, 0.5);
    this.layer = newLayer;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Ascending C major arpeggio — call once when the story begins */
  playIntro(): void {
    const { ctx, rev } = this.setup();
    ctx.resume();
    const notes = [261.63, 329.63, 392.00, 523.25]; // C4 E4 G4 C5
    notes.forEach((freq, i) => {
      const t = ctx.currentTime + i * 0.22 + 0.1;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
      osc.connect(g);
      g.connect(rev);
      osc.start(t);
      osc.stop(t + 2.5);
    });
  }

  /** Switch soundscape — smooth crossfade; ignored when muted */
  setScene(scene: Soundscape | undefined): void {
    const next = scene || "magic";
    if (next === this.currentScene && this.layer) return;
    this.currentScene = next;
    if (!this.running) return;
    this.crossfade(next);
  }

  /** Start / unmute */
  start(): void {
    const { ctx, master } = this.setup();
    ctx.resume();
    this.running = true;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(this.vol, ctx.currentTime, 0.8);
    if (!this.layer) this.crossfade(this.currentScene);
  }

  /** Stop / mute (keeps layers alive so unmute is instant) */
  stop(): void {
    this.running = false;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.5);
    }
  }

  /** Set target volume (respects ducking) */
  setVolume(v: number): void {
    this.vol = v;
    if (this.running && this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.ducked ? v * 0.3 : v, this.ctx.currentTime, 0.12);
    }
  }

  private ducked = false;

  /** Ducking: pod mluveným slovem se podkres ztiší (~30 %), mezi scénami
      a ve finále se plynule vrátí — hudba nikdy nepřehluší vyprávění */
  duck(active: boolean): void {
    this.ducked = active;
    if (this.running && this.master && this.ctx) {
      const target = active ? this.vol * 0.3 : this.vol;
      this.master.gain.setTargetAtTime(target, this.ctx.currentTime, active ? 0.35 : 0.9);
    }
  }

  destroy(): void {
    this.running = false;
    this.layer?.cleanup();
    this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.reverbSend = null;
    this.layer = null;
  }
}
