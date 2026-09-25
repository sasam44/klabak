/**
 * All sound is synthesised at runtime with the Web Audio API: no files, no
 * downloads, and the game still loads instantly (a jam eligibility gate).
 * The context is created lazily on the first user gesture, per browser policy.
 */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

export function initAudio(): void {
  if (ctx) return;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
}

export function setMuted(next: boolean): void {
  muted = next;
  if (master) master.gain.value = next ? 0 : 0.5;
}

export function isMuted(): boolean {
  return muted;
}

function env(node: AudioNode, attack: number, decay: number, peak: number): GainNode {
  const g = ctx!.createGain();
  const t = ctx!.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  node.connect(g);
  g.connect(master!);
  return g;
}

function osc(type: OscillatorType, from: number, to: number, attack: number, decay: number, peak = 0.3): void {
  if (!ctx) return;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, ctx.currentTime);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, to), ctx.currentTime + attack + decay);
  env(o, attack, decay, peak);
  o.start();
  o.stop(ctx.currentTime + attack + decay + 0.02);
}

function noise(duration: number, peak: number, filterHz: number): void {
  if (!ctx) return;
  const frames = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = filterHz;
  src.connect(filter);
  env(filter, 0.005, duration, peak);
  src.start();
}

/** Rail motor: the claw travelling to its drop position. */
export function sfxMotor(): void {
  if (!ctx) return;
  osc('sawtooth', 90, 150, 0.02, 0.5, 0.06);
  noise(0.5, 0.05, 700);
}

/** Claw descending on the cable. */
export function sfxDescend(): void {
  osc('triangle', 300, 130, 0.01, 0.45, 0.09);
  noise(0.45, 0.04, 1200);
}

/** Servo closing on a capsule. */
export function sfxGrip(): void {
  if (!ctx) return;
  for (let i = 0; i < 3; i++) {
    setTimeout(() => osc('square', 420 - i * 60, 300, 0.004, 0.05, 0.07), i * 55);
  }
}

/** The claw opens on the way up — the prize falls back into the pile. */
export function sfxSlip(): void {
  osc('square', 260, 90, 0.005, 0.14, 0.08);
  setTimeout(() => noise(0.28, 0.09, 500), 90);
}

/** The chute: prize in the tray, the sound the whole game is built around. */
export function sfxChute(): void {
  noise(0.22, 0.12, 400);
  setTimeout(() => osc('sine', 180, 90, 0.005, 0.2, 0.12), 60);
}

/** Win stinger, brighter with the tier. */
export function sfxWin(tier: number): void {
  const base = [523.25, 659.25, 783.99, 1046.5];
  const notes = base.slice(0, Math.max(2, tier + 1));
  notes.forEach((f, i) => {
    setTimeout(() => osc('triangle', f, f * 1.002, 0.01, 0.32, 0.16), i * 110);
  });
  if (tier >= 3) {
    setTimeout(() => osc('sine', 1567.98, 1567.98, 0.01, 0.6, 0.12), 420);
  }
}

/** Cabinet tab click / button press. */
export function sfxClick(): void {
  osc('square', 700, 520, 0.002, 0.03, 0.05);
}
