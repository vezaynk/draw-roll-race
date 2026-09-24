// Sound effects and vibration. Everything is synthesised with the Web Audio API, so there are
// no audio files. Browsers only allow sound after the player interacts, so audio starts on the
// first touch.
import { save } from './storage';

export type SoundName = 'count' | 'go' | 'swap' | 'shatter' | 'win' | 'lose';

let audioContext: AudioContext | null = null;

function audio(): AudioContext | null {
  if (!audioContext) {
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioContext = new Ctor();
  }
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  return audioContext;
}

interface ToneOptions {
  type?: OscillatorType;
  gain?: number;
  /** Pitch change over the tone (Hz). */
  slide?: number;
}

function tone(freq: number, start: number, dur: number, { type = 'sine', gain = 0.18, slide = 0 }: ToneOptions = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + start;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** A burst of filtered noise (the crunch of shattering limbs). */
function noise(start: number, dur: number, gain = 0.25) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + start;
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(3000, t);
  filter.frequency.exponentialRampToValueAtTime(600, t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(g).connect(a.destination);
  src.start(t);
}

const SOUNDS: Record<SoundName, () => void> = {
  count: () => tone(520, 0, 0.12, { type: 'square', gain: 0.08 }),
  go: () => tone(880, 0, 0.25, { type: 'square', gain: 0.1 }),
  swap: () => tone(340, 0, 0.07, { type: 'triangle', gain: 0.12, slide: 260 }),
  shatter: () => {
    noise(0, 0.35, 0.3);
    tone(220, 0, 0.2, { type: 'sawtooth', gain: 0.06, slide: -150 });
  },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.22, { type: 'triangle', gain: 0.14 })),
  lose: () => [440, 392, 330].forEach((f, i) => tone(f, i * 0.12, 0.25, { type: 'triangle', gain: 0.12 })),
};

const BUZZ: Partial<Record<SoundName, number | number[]>> = {
  swap: 12,
  shatter: [40, 30, 60],
  win: [30, 40, 30],
};

/** Plays a sound and/or vibrates, as the options allow. */
export function sfx(name: SoundName): void {
  if (save.sound) {
    try {
      SOUNDS[name]();
    } catch {
      // audio unavailable
    }
  }
  const pattern = BUZZ[name];
  if (save.vibrate && pattern !== undefined && navigator.vibrate) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // not allowed
    }
  }
}

/** Unlocks audio on the first touch or key press. */
export function initSound(): void {
  const unlock = () => {
    if (save.sound) audio();
  };
  window.addEventListener('pointerdown', unlock, { once: true, capture: true });
  window.addEventListener('keydown', unlock, { once: true, capture: true });
}
