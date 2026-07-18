// Browser-only: procedural ambient music via Web Audio API.
// No external files. Each Soundscape has its own synthesis layer.
// Layers crossfade over ~1.5s when the scene changes.

import type { Soundscape, SoundEffect } from "./types";
export type { Soundscape, SoundEffect };

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

// ── 🔊 Jednorázové zvukové efekty podle děje (na rozdíl od Soundscape výše,
// což je jen nálada hrající na pozadí celé scény) ───────────────────────────

function playWaves(ctx: AudioContext, dest: AudioNode, noiseBuf: AudioBuffer): void {
  // Dvě překrývající se "vlny": filtrovaný šum s pomalou obálkou (nádech-výdech)
  for (const delay of [0, 0.9]) {
    setTimeout(() => {
      const t = ctx.currentTime;
      const src = noiseSource(ctx, noiseBuf);
      const filt = ctx.createBiquadFilter();
      filt.type = "lowpass";
      filt.frequency.setValueAtTime(300, t);
      filt.frequency.linearRampToValueAtTime(900, t + 1.1);
      filt.frequency.linearRampToValueAtTime(200, t + 2.6);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16, t + 1.0);
      g.gain.linearRampToValueAtTime(0, t + 2.6);
      src.connect(filt);
      filt.connect(g);
      g.connect(dest);
      src.start(t);
      src.stop(t + 2.7);
    }, delay * 1000);
  }
}

function playThunder(ctx: AudioContext, dest: AudioNode, noiseBuf: AudioBuffer): void {
  const t = ctx.currentTime;
  // Ostrý úder (krátký širokopásmový šum)
  const crack = noiseSource(ctx, noiseBuf);
  const crackF = ctx.createBiquadFilter();
  crackF.type = "highpass";
  crackF.frequency.value = 900;
  const crackG = ctx.createGain();
  crackG.gain.setValueAtTime(0.22, t);
  crackG.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  crack.connect(crackF);
  crackF.connect(crackG);
  crackG.connect(dest);
  crack.start(t);
  crack.stop(t + 0.25);
  // Dlouhé dunivé dozvíjení (nízkofrekvenční šum s pomalým doznětem)
  const rumble = noiseSource(ctx, noiseBuf);
  const rumbleF = ctx.createBiquadFilter();
  rumbleF.type = "lowpass";
  rumbleF.frequency.value = 140;
  const rumbleG = ctx.createGain();
  rumbleG.gain.setValueAtTime(0, t);
  rumbleG.gain.linearRampToValueAtTime(0.28, t + 0.08);
  rumbleG.gain.exponentialRampToValueAtTime(0.001, t + 3.2);
  rumble.connect(rumbleF);
  rumbleF.connect(rumbleG);
  rumbleG.connect(dest);
  rumble.start(t);
  rumble.stop(t + 3.3);
}

function playSnore(ctx: AudioContext, dest: AudioNode): void {
  // 2 nádech-výdech cykly: nízký tón s bzučivým vibratem, hlasitěji na nádechu
  for (let i = 0; i < 2; i++) {
    setTimeout(() => {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(70, t);
      osc.frequency.linearRampToValueAtTime(95, t + 0.35);
      osc.frequency.linearRampToValueAtTime(55, t + 0.75);
      const filt = ctx.createBiquadFilter();
      filt.type = "lowpass";
      filt.frequency.value = 320;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.14, t + 0.2);
      g.gain.linearRampToValueAtTime(0.03, t + 0.45);
      g.gain.linearRampToValueAtTime(0, t + 0.8);
      osc.connect(filt);
      filt.connect(g);
      g.connect(dest);
      osc.start(t);
      osc.stop(t + 0.85);
    }, i * 950);
  }
}

// ── Generic one-shot helpers (used by the expanded sfx taxonomy below) ────────

function voiceTone(ctx: AudioContext, dest: AudioNode, o: {
  freqStart: number; freqEnd?: number; dur: number; gain: number;
  type?: OscillatorType; filterFreq?: number; filterQ?: number; delay?: number;
}): void {
  const t = ctx.currentTime + (o.delay || 0);
  const osc = ctx.createOscillator();
  osc.type = o.type || "sawtooth";
  osc.frequency.setValueAtTime(o.freqStart, t);
  osc.frequency.linearRampToValueAtTime(o.freqEnd ?? o.freqStart, t + o.dur * 0.75);
  let node: AudioNode = osc;
  if (o.filterFreq) {
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = o.filterFreq;
    filt.Q.value = o.filterQ ?? 1;
    osc.connect(filt);
    node = filt;
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.gain, t + Math.min(0.03, o.dur * 0.2));
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  node.connect(g);
  g.connect(dest);
  osc.start(t);
  osc.stop(t + o.dur + 0.05);
}

function noiseBurst(ctx: AudioContext, dest: AudioNode, buf: AudioBuffer, o: {
  filterType?: BiquadFilterType; freq?: number; freqEnd?: number; Q?: number; dur: number; gain: number; delay?: number;
}): void {
  const t = ctx.currentTime + (o.delay || 0);
  const src = noiseSource(ctx, buf);
  const filt = ctx.createBiquadFilter();
  filt.type = o.filterType || "bandpass";
  filt.frequency.setValueAtTime(o.freq ?? 1000, t);
  if (o.freqEnd) filt.frequency.linearRampToValueAtTime(o.freqEnd, t + o.dur * 0.8);
  filt.Q.value = o.Q ?? 1;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.gain, t + Math.min(0.02, o.dur * 0.15));
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(filt);
  filt.connect(g);
  g.connect(dest);
  src.start(t);
  src.stop(t + o.dur + 0.05);
}

function pingTone(ctx: AudioContext, dest: AudioNode, freqs: number[], dur: number, gain: number, delay = 0): void {
  const t = ctx.currentTime + delay;
  for (const f of freqs) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
}

// ── 🌦️ Počasí ──────────────────────────────────────────────────────────────

function playWindGust(ctx: AudioContext, dest: AudioNode, noiseBuf: AudioBuffer): void {
  noiseBurst(ctx, dest, noiseBuf, { filterType: "bandpass", freq: 250, freqEnd: 950, Q: 0.6, dur: 1.3, gain: 0.18 });
  noiseBurst(ctx, dest, noiseBuf, { filterType: "bandpass", freq: 900, freqEnd: 300, Q: 0.6, dur: 1.0, gain: 0.10, delay: 0.5 });
}

function playRain(ctx: AudioContext, dest: AudioNode, noiseBuf: AudioBuffer): void {
  noiseBurst(ctx, dest, noiseBuf, { filterType: "highpass", freq: 1800, dur: 2.4, gain: 0.10 });
  for (let i = 0; i < 6; i++) {
    setTimeout(() => noiseBurst(ctx, dest, noiseBuf, { filterType: "bandpass", freq: rand(2500, 5000), Q: 4, dur: 0.06, gain: 0.05 }), rand(0, 2000));
  }
}

function playSnowCrunch(ctx: AudioContext, dest: AudioNode): void {
  for (let i = 0; i < 3; i++) setTimeout(() => crackle(ctx, dest), i * 260 + rand(0, 60));
}

// ── 🐾 Zvířata ─────────────────────────────────────────────────────────────

function playCow(ctx: AudioContext, dest: AudioNode): void {
  voiceTone(ctx, dest, { freqStart: 95, freqEnd: 72, dur: 0.9, gain: 0.22, type: "sawtooth", filterFreq: 500 });
}

function playPig(ctx: AudioContext, dest: AudioNode): void {
  [0, 0.22].forEach(d => voiceTone(ctx, dest, { freqStart: 320, freqEnd: 190, dur: 0.16, gain: 0.2, type: "square", filterFreq: 900, delay: d }));
}

function playChicken(ctx: AudioContext, dest: AudioNode): void {
  [0, 0.16, 0.34].forEach(d => voiceTone(ctx, dest, { freqStart: 520, freqEnd: 340, dur: 0.12, gain: 0.16, type: "square", filterFreq: 1400, delay: d }));
}

function playSheep(ctx: AudioContext, dest: AudioNode): void {
  voiceTone(ctx, dest, { freqStart: 300, freqEnd: 400, dur: 0.6, gain: 0.2, type: "sawtooth", filterFreq: 700 });
}

function playHorse(ctx: AudioContext, dest: AudioNode): void {
  voiceTone(ctx, dest, { freqStart: 160, freqEnd: 650, dur: 0.18, gain: 0.2, type: "sawtooth", filterFreq: 1300 });
  voiceTone(ctx, dest, { freqStart: 650, freqEnd: 200, dur: 0.6, gain: 0.18, type: "sawtooth", filterFreq: 1300, delay: 0.18 });
}

function playDuck(ctx: AudioContext, dest: AudioNode): void {
  [0, 0.2].forEach(d => voiceTone(ctx, dest, { freqStart: 260, freqEnd: 170, dur: 0.18, gain: 0.2, type: "square", filterFreq: 1000, delay: d }));
}

function playDog(ctx: AudioContext, dest: AudioNode): void {
  [0, 0.26].forEach(d => voiceTone(ctx, dest, { freqStart: 380, freqEnd: 170, dur: 0.15, gain: 0.24, type: "sawtooth", filterFreq: 1500, delay: d }));
}

function playCat(ctx: AudioContext, dest: AudioNode): void {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(400, t);
  osc.frequency.linearRampToValueAtTime(750, t + 0.14);
  osc.frequency.linearRampToValueAtTime(350, t + 0.4);
  const filt = ctx.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.value = 1600;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.18, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
  osc.connect(filt);
  filt.connect(g);
  g.connect(dest);
  osc.start(t);
  osc.stop(t + 0.45);
}

function playFrog(ctx: AudioContext, dest: AudioNode): void {
  [0, 0.24].forEach(d => voiceTone(ctx, dest, { freqStart: 150, freqEnd: 95, dur: 0.13, gain: 0.2, type: "square", filterFreq: 600, delay: d }));
}

function playOwl(ctx: AudioContext, dest: AudioNode): void {
  [0, 0.65].forEach(d => voiceTone(ctx, dest, { freqStart: 480, freqEnd: 360, dur: 0.5, gain: 0.15, type: "sine", delay: d }));
}

function playRooster(ctx: AudioContext, dest: AudioNode): void {
  [[500, 0], [700, 0.16], [850, 0.32], [600, 0.52]].forEach(([f, d]) =>
    voiceTone(ctx, dest, { freqStart: f, freqEnd: f * 0.9, dur: 0.18, gain: 0.18, type: "sawtooth", filterFreq: 1300, delay: d }));
}

function playBee(ctx: AudioContext, dest: AudioNode): void {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.value = 180;
  const trem = ctx.createOscillator();
  trem.frequency.value = 32;
  const tremG = ctx.createGain();
  tremG.gain.value = 0.06;
  trem.connect(tremG);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.09, t + 0.1);
  tremG.connect(g.gain);
  g.gain.setTargetAtTime(0.0001, t + 1.2, 0.15);
  osc.connect(g);
  g.connect(dest);
  osc.start(t);
  trem.start(t);
  osc.stop(t + 1.5);
  trem.stop(t + 1.5);
}

// ── ⚙️ Stroje / doprava ────────────────────────────────────────────────────

function playCarEngine(ctx: AudioContext, dest: AudioNode, noiseBuf: AudioBuffer): void {
  noiseBurst(ctx, dest, noiseBuf, { filterType: "lowpass", freq: 500, dur: 0.3, gain: 0.15 });
  voiceTone(ctx, dest, { freqStart: 55, freqEnd: 95, dur: 1.0, gain: 0.2, type: "sawtooth", filterFreq: 300, delay: 0.1 });
}

function playTrain(ctx: AudioContext, dest: AudioNode, noiseBuf: AudioBuffer): void {
  for (let i = 0; i < 4; i++) {
    setTimeout(() => noiseBurst(ctx, dest, noiseBuf, { filterType: "lowpass", freq: 260, dur: 0.16, gain: 0.16 }), i * (280 - i * 20));
  }
  voiceTone(ctx, dest, { freqStart: 330, freqEnd: 330, dur: 1.0, gain: 0.14, type: "sawtooth", filterFreq: 900, delay: 1.3 });
  voiceTone(ctx, dest, { freqStart: 440, freqEnd: 440, dur: 1.0, gain: 0.1, type: "sawtooth", filterFreq: 900, delay: 1.3 });
}

function playBoatHorn(ctx: AudioContext, dest: AudioNode): void {
  voiceTone(ctx, dest, { freqStart: 110, freqEnd: 110, dur: 1.8, gain: 0.22, type: "sawtooth", filterFreq: 320 });
  voiceTone(ctx, dest, { freqStart: 165, freqEnd: 165, dur: 1.8, gain: 0.1, type: "sawtooth", filterFreq: 320 });
}

function playClockTick(ctx: AudioContext, dest: AudioNode, noiseBuf: AudioBuffer): void {
  [0, 0.5, 1.0, 1.5].forEach(d => noiseBurst(ctx, dest, noiseBuf, { filterType: "highpass", freq: 2500, dur: 0.03, gain: 0.12, delay: d }));
}

function playDoorbell(ctx: AudioContext, dest: AudioNode): void {
  pingTone(ctx, dest, [880], 0.6, 0.15);
  pingTone(ctx, dest, [660], 0.7, 0.15, 0.35);
}

function playPhoneRing(ctx: AudioContext, dest: AudioNode): void {
  [0, 0.45].forEach(d => { pingTone(ctx, dest, [950, 1400], 0.35, 0.12, d); });
}

// ── 🙋 Lidé / akce ─────────────────────────────────────────────────────────

function playFootsteps(ctx: AudioContext, dest: AudioNode, noiseBuf: AudioBuffer): void {
  [0, 0.32, 0.64, 0.96].forEach(d => noiseBurst(ctx, dest, noiseBuf, { filterType: "lowpass", freq: 160, dur: 0.09, gain: 0.15, delay: d }));
}

function playApplause(ctx: AudioContext, dest: AudioNode, noiseBuf: AudioBuffer): void {
  const count = 14 + Math.floor(rand(0, 6));
  for (let i = 0; i < count; i++) {
    setTimeout(() => noiseBurst(ctx, dest, noiseBuf, { filterType: "bandpass", freq: rand(2200, 4200), Q: 2, dur: 0.05, gain: 0.06 }), rand(0, 1200));
  }
}

function playLaugh(ctx: AudioContext, dest: AudioNode): void {
  [0, 0.18, 0.36, 0.54].forEach((d, i) => voiceTone(ctx, dest, { freqStart: 260 + i * 20, freqEnd: 220 + i * 20, dur: 0.16, gain: 0.14, type: "triangle", filterFreq: 1200, delay: d }));
}

function playSplash(ctx: AudioContext, dest: AudioNode, noiseBuf: AudioBuffer): void {
  noiseBurst(ctx, dest, noiseBuf, { filterType: "lowpass", freq: 2200, freqEnd: 250, dur: 0.5, gain: 0.24 });
  for (let i = 0; i < 4; i++) setTimeout(() => noiseBurst(ctx, dest, noiseBuf, { filterType: "bandpass", freq: rand(1500, 3000), Q: 3, dur: 0.05, gain: 0.05 }), 150 + i * 90);
}

function playGlassClink(ctx: AudioContext, dest: AudioNode): void {
  pingTone(ctx, dest, [2100, 3150], 0.4, 0.1);
}

// ── ✨ Náladové akcenty ─────────────────────────────────────────────────────

function playMagicChime(ctx: AudioContext, dest: AudioNode): void {
  [880, 1046.5, 1318.5, 1568].forEach((f, i) => pingTone(ctx, dest, [f], 0.8, 0.09, i * 0.09));
}

function playTriumphant(ctx: AudioContext, dest: AudioNode): void {
  [523.25, 659.25, 783.99, 1046.5].forEach(f => voiceTone(ctx, dest, { freqStart: f, freqEnd: f, dur: 0.9, gain: 0.13, type: "sawtooth", filterFreq: 2200 }));
}

function playTenseSting(ctx: AudioContext, dest: AudioNode): void {
  [440, 466.16].forEach(f => voiceTone(ctx, dest, { freqStart: f, freqEnd: f, dur: 0.35, gain: 0.2, type: "sawtooth", filterFreq: 1800 }));
}

function playSadTone(ctx: AudioContext, dest: AudioNode): void {
  voiceTone(ctx, dest, { freqStart: 392, freqEnd: 293.66, dur: 1.8, gain: 0.14, type: "sine" });
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

  /** 🔊 Jednorázový zvukový efekt podle děje scény —
   *  hraje JEDNOU navrch aktuálního soundscape, ignorováno když appka mlčí */
  playEffect(effect: SoundEffect | undefined): void {
    if (!effect || !this.running) return;
    const { ctx, rev } = this.setup();
    const nb = () => this.getNoiseBuffer(ctx);
    switch (effect) {
      // 🌦️ počasí
      case "waves":       playWaves(ctx, rev, nb()); break;
      case "thunder":     playThunder(ctx, rev, nb()); break;
      case "wind_gust":   playWindGust(ctx, rev, nb()); break;
      case "rain":        playRain(ctx, rev, nb()); break;
      case "snow_crunch": playSnowCrunch(ctx, rev); break;
      // 🐾 zvířata
      case "cow":     playCow(ctx, rev); break;
      case "pig":     playPig(ctx, rev); break;
      case "chicken": playChicken(ctx, rev); break;
      case "sheep":   playSheep(ctx, rev); break;
      case "horse":   playHorse(ctx, rev); break;
      case "duck":    playDuck(ctx, rev); break;
      case "dog":     playDog(ctx, rev); break;
      case "cat":     playCat(ctx, rev); break;
      case "frog":    playFrog(ctx, rev); break;
      case "owl":     playOwl(ctx, rev); break;
      case "rooster": playRooster(ctx, rev); break;
      case "bee":     playBee(ctx, rev); break;
      // ⚙️ stroje/doprava
      case "car_engine": playCarEngine(ctx, rev, nb()); break;
      case "train":      playTrain(ctx, rev, nb()); break;
      case "boat_horn":  playBoatHorn(ctx, rev); break;
      case "clock_tick": playClockTick(ctx, rev, nb()); break;
      case "doorbell":   playDoorbell(ctx, rev); break;
      case "phone_ring": playPhoneRing(ctx, rev); break;
      // 🙋 lidé/akce
      case "footsteps":  playFootsteps(ctx, rev, nb()); break;
      case "applause":   playApplause(ctx, rev, nb()); break;
      case "laugh":      playLaugh(ctx, rev); break;
      case "splash":     playSplash(ctx, rev, nb()); break;
      case "glass_clink": playGlassClink(ctx, rev); break;
      // ✨ náladové akcenty
      case "magic_chime": playMagicChime(ctx, rev); break;
      case "triumphant":  playTriumphant(ctx, rev); break;
      case "tense_sting": playTenseSting(ctx, rev); break;
      case "sad_tone":    playSadTone(ctx, rev); break;
      // 😴 ostatní
      case "snore": playSnore(ctx, rev); break;
    }
  }

  /** Klesající, usínající melodie — zavolat jednou na úplně poslední stránce */
  playOutro(): void {
    if (!this.running) return;
    const { ctx, rev } = this.setup();
    const notes = [523.25, 392.00, 329.63, 261.63]; // C5 G4 E4 C4 (sestupně)
    notes.forEach((freq, i) => {
      const t = ctx.currentTime + i * 0.42 + 0.1;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (i === notes.length - 1 ? 3.5 : 1.6));
      osc.connect(g);
      g.connect(rev);
      osc.start(t);
      osc.stop(t + (i === notes.length - 1 ? 3.6 : 1.8));
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
