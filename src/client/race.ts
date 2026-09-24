// A race on the current course: starting, the fixed-step loop, spikes, the tutorial's CPU and
// finishing.
import { CFG } from '../shared/config';
import buildCourse from '../shared/course/build';
import CpuRacer from '../shared/cpu/racer';
import { hasLimbs } from '../shared/limbs';
import { runnerAtStart, stepPlayer } from '../shared/replay';
import { swapLimbs } from '../shared/runner';
import type { Shattered } from '../shared/types';
import { lookForRound } from './appearance';
import { COLORS } from './colors';
import { byId } from './dom';
import {
  loadGhost, recordInput, recordLimbs, recordSample, startRecording,
} from './ghost';
import {
  buildProgress, hideHint, showHint, toast, updateControls, updateHud,
} from './hud';
import { renderPad } from './pad';
import { render } from './render/scene';
import { spawnShards } from './render/shards';
import showResults, { courseKey } from './results';
import { sfx } from './sound';
import { hooks, state } from './state';
import { save } from './storage';
import { TUTORIAL } from '../shared/course/stages';

const LIMB_NAMES = { arm: 'Arms', leg: 'Legs' } as const;

let rafId = 0;
let lastTs = 0;
let acc = 0;
let countdownShown: number | null = null;

/** A runner at the start line with the current drawing (or none). */
function playerAtStart() {
  return runnerAtStart(state.course, state.limbs, COLORS.player);
}

/** Back to the start of the current stage, not racing. */
export function resetStage(): void {
  state.course = buildCourse(state.stage);
  state.countdownEnd = 0;
  state.cpu = null;
  state.racing = false;
  state.finished = false;
  state.time = 0;
  state.steps = 0;
  state.cpuTime = null;
  state.section = null;
  buildProgress();
  // Show the current drawing at the start line.
  state.player = hasLimbs(state.limbs) ? playerAtStart() : null;
  updateHud();
  render();
}

export function stopRace(): void {
  state.racing = false;
  state.countdownEnd = 0;
  cancelAnimationFrame(rafId);
  updateControls();
}

/** Spikes broke one or both limbs: throw the pieces, clear them from the pad, ask for a redraw. */
function onShatter(broken: Shattered): void {
  if (state.player) spawnShards(state.player, broken.lost);
  state.limbs = broken.limbs;
  state.player = broken.runner;
  if (state.recording) recordLimbs(state.recording, state.time, state.limbs);
  renderPad();
  const what = broken.lost.map((k) => LIMB_NAMES[k]).join(' and ');
  toast(`${what} shattered!`, 1200);
  showHint(`Spikes broke your ${what.toLowerCase()}. Draw new ones.`, 2600);
  sfx('shatter');
  hooks.onLimbs?.(state.limbs, broken.lost);
}

function stepCpu(): void {
  const { cpu } = state;
  if (!cpu || cpu.finishTime !== null) return;
  cpu.step(CFG.DT, state.time);
  if (cpu.finishTime !== null && state.cpuTime === null) {
    state.cpuTime = cpu.finishTime;
    toast('The CPU finished!', 1600);
    showHint('The CPU finished first. Keep going, or tap Exit to stop.', 3500);
    byId('section-label').textContent = 'CPU finished';
  }
}

function finish(): void {
  state.racing = false;
  state.finished = true;
  updateControls();
  updateHud();
  render();
  if (state.mode === 'online') {
    hooks.onFinish?.(state.time);
    return;
  }
  showResults();
}

/** One physics step of the whole race. Returns false when the race is over. */
function tick(): boolean {
  const player = state.player as NonNullable<typeof state.player>;
  state.time += CFG.DT;
  state.steps += 1;
  const broken = stepPlayer(state.course, player, state.limbs);
  if (broken) onShatter(broken);
  stepCpu();
  const runner = state.player as NonNullable<typeof state.player>;
  if (state.recording) recordSample(state.recording, state.time, runner);
  if (runner.x >= state.course.finishX) {
    finish();
    return false;
  }
  return true;
}

/** Shows 3, 2, 1 while the countdown runs. Returns true while it is still counting. */
function countingDown(): boolean {
  if (!state.countdownEnd) return false;
  const left = state.countdownEnd - performance.now();
  if (left > 0) {
    const n = Math.min(3, Math.ceil(left / 1000));
    if (n !== countdownShown) {
      countdownShown = n;
      toast(String(n), 900);
      sfx('count');
    }
    return true;
  }
  state.countdownEnd = 0;
  toast('GO!', 700);
  sfx('go');
  if (!hasLimbs(state.limbs)) showHint('Draw legs to start moving', 3000);
  lastTs = 0;
  return false;
}

function frame(ts: number): void {
  if (!state.racing) return;
  if (countingDown()) {
    render();
    rafId = requestAnimationFrame(frame);
    return;
  }
  if (!lastTs) lastTs = ts;
  acc += Math.min((ts - lastTs) / 1000, 0.05);
  lastTs = ts;
  let running = true;
  while (running && acc >= CFG.DT) {
    acc -= CFG.DT;
    running = tick();
  }
  if (!running) return;
  hooks.onFrame?.();
  updateHud();
  render();
  rafId = requestAnimationFrame(frame);
}

/** The tutorial races one easy CPU (a new personality each time); nothing else has CPUs. */
function tutorialCpu(): CpuRacer | null {
  if (state.stage !== TUTORIAL || state.mode !== 'solo') return null;
  return new CpuRacer(state.course, {
    seed: Math.floor(Math.random() * 1e9),
    color: COLORS.cpu,
    onSwap: (_limbs, _pose, lost, before) => {
      if (lost) spawnShards(before, lost);
    },
  });
}

export interface RaceOptions {
  /** Hold everyone still for a 3-2-1 first. */
  countdownMs?: number;
}

export function startRace({ countdownMs = 0 }: RaceOptions = {}): void {
  // Players who haven't saved theirs get a new random look every round.
  if (!save.signedIn) lookForRound();
  const player = playerAtStart();
  state.player = player;
  state.cpu = tutorialCpu();
  state.cpuTime = null;
  state.tipsShown = {};
  // Only your own best run comes back as a ghost (never other players', not even on the daily).
  const own = state.mode === 'solo' && save.ghost ? loadGhost(courseKey()) : null;
  state.ghosts = own ? [own] : [];
  state.recording = startRecording(player, state.limbs);
  state.time = 0;
  state.steps = 0;
  state.racing = true;
  state.finished = false;
  state.countdownEnd = countdownMs ? performance.now() + countdownMs : 0;
  countdownShown = null;
  updateControls();
  if (!state.countdownEnd) {
    toast('GO!', 700);
    sfx('go');
  }
  lastTs = 0;
  acc = 0;
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(frame);
}

/** A new limb was drawn on the pad. */
/** Mid-race: puts the current limbs on the runner, and records the change for replays. */
function swapInLimbs(): void {
  if (!state.player) return;
  state.player = swapLimbs(state.course, state.player, state.limbs);
  if (state.recording) {
    recordLimbs(state.recording, state.time, state.limbs);
    recordInput(state.recording, state.steps, state.limbs);
  }
}

export function onLimbsDrawn(): void {
  hideHint();
  hooks.onLimbs?.(state.limbs);
  sfx('swap');
  if (state.racing && state.player) {
    swapInLimbs();
  } else if (state.mode === 'online') {
    // In a room the host starts races; just show the new drawing at the start line.
    state.player = playerAtStart();
    render();
  } else if (!state.finished) {
    startRace();
  }
}

/** A double tap cleared a limb: take it off the runner (a race keeps going without it). */
export function onLimbCleared(): void {
  hooks.onLimbs?.(state.limbs);
  sfx('swap');
  if (state.racing && state.player) {
    swapInLimbs();
  } else {
    state.player = hasLimbs(state.limbs) ? playerAtStart() : null;
    render();
  }
}
