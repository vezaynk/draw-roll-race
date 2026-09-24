// Draw Roll Race — sound effects and vibration.
// Everything is synthesised with the Web Audio API, so there are no audio files to load.
// Browsers only allow sound after the player interacts, so the audio starts on the first touch.
(function () {
  'use strict';
  const G = window.DRRGame;
  let ac = null;

  function audio() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  }
  // Unlock audio on the first touch or key press.
  const unlock = () => { if (G.save.sound) audio(); };
  addEventListener('pointerdown', unlock, { once: true, capture: true });
  addEventListener('keydown', unlock, { once: true, capture: true });

  function tone(freq, start, dur, { type = 'sine', gain = 0.18, slide = 0 } = {}) {
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

  function noise(start, dur, { gain = 0.25, from = 3000, to = 600 } = {}) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + start;
    const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = a.createBufferSource();
    src.buffer = buf;
    const filter = a.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = a.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(a.destination);
    src.start(t);
  }

  const SOUNDS = {
    count: () => tone(520, 0, 0.12, { type: 'square', gain: 0.08 }),
    go: () => tone(880, 0, 0.25, { type: 'square', gain: 0.1 }),
    swap: () => tone(340, 0, 0.07, { type: 'triangle', gain: 0.12, slide: 260 }),
    shatter: () => { noise(0, 0.35, { gain: 0.3 }); tone(220, 0, 0.2, { type: 'sawtooth', gain: 0.06, slide: -150 }); },
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.22, { type: 'triangle', gain: 0.14 })),
    lose: () => [440, 392, 330].forEach((f, i) => tone(f, i * 0.12, 0.25, { type: 'triangle', gain: 0.12 })),
  };
  const BUZZ = { swap: 12, shatter: [40, 30, 60], win: [30, 40, 30] };

  G.hooks.sfx = name => {
    if (G.save.sound && SOUNDS[name]) { try { SOUNDS[name](); } catch (e) { /* audio unavailable */ } }
    if (G.save.vibrate && BUZZ[name] && navigator.vibrate) { try { navigator.vibrate(BUZZ[name]); } catch (e) { /* not allowed */ } }
  };
})();
