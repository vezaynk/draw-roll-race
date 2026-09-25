// The results card after a solo race: placing, time, best time, and what to do next.
import { RANDOM_BASE, STAGES, TUTORIAL } from '../shared/course/stages';
import submitDaily from './daily';
import { byId, ordinal } from './dom';
import { saveGhost } from './ghost';
import { stageName } from './hud';
import { sfx } from './sound';
import { loadStats, sendRun, showResultStats } from './stats';
import { state } from './state';
import { persist, save } from './storage';

/** What the main button on the results card does ('lobby': back to the room, online). */
export type NextAction = 'next' | 'again' | 'stage1' | 'lobby';

/** Key for best times and ghosts: the stage, or the daily course's day. */
export function courseKey(): string {
  return state.daily ? `daily:${state.daily.day}` : String(state.stage);
}

function placeText(place: number, win: boolean): string {
  if (state.stage === TUTORIAL) return 'Tutorial complete!';
  if (!win) return `You finished ${ordinal(place)}`;
  return 'Finished!';
}

/** The tutorial CPU's race, if there was one. */
function cpuText(win: boolean): string {
  const { cpu } = state;
  if (!cpu) return '';
  if (win) return 'The CPU was still racing';
  return `The CPU finished in ${(cpu.finishTime ?? 0).toFixed(2)} s`;
}

function nextStep(win: boolean): { action: NextAction; label: string } {
  if (state.stage === TUTORIAL) return { action: 'stage1', label: 'Start Stage 1' };
  if (state.daily) return { action: 'again', label: 'Race again' };
  if (!win) return { action: 'again', label: 'Try again' };
  if (state.stage + 1 < STAGES.length) return { action: 'next', label: 'Next stage' };
  return { action: 'next', label: state.stage + 1 === STAGES.length ? 'Endless mode' : 'Next course' };
}

/** Records the best time and ghost, and returns the text for the best-time line. */
function recordBest(): { text: string; isNew: boolean } {
  const key = courseKey();
  const prev = save.best[key];
  if (prev !== undefined && state.time >= prev) return { text: `Best: ${prev.toFixed(2)} s`, isNew: false };
  save.best[key] = Number(state.time.toFixed(2));
  if (state.recording && state.player) saveGhost(key, state.recording, state.time, state.player);
  const text = prev === undefined ? 'First finish on this course!' : `New best! (was ${prev.toFixed(2)} s)`;
  return { text, isNew: true };
}

export default function showResults(): void {
  const cpuAhead = !!state.cpu && state.cpu.finishTime !== null && state.cpu.finishTime <= state.time;
  const place = cpuAhead ? 2 : 1;
  const win = place === 1;
  const title = byId('result-title');
  title.textContent = placeText(place, win);
  title.className = win ? 'win' : 'lose';
  byId('result-stage').textContent = stageName(state.stage);
  byId('result-time').textContent = `${state.time.toFixed(2)} s`;
  byId('result-detail').textContent = cpuText(win);

  const best = recordBest();
  byId('result-best').textContent = best.text;
  byId('result-best').className = best.isNew ? 'new' : '';

  const next = nextStep(win);
  const nextButton = byId('next-btn');
  nextButton.textContent = next.label;
  nextButton.dataset.action = next.action;
  // A second button replays the same course when the main one moves on.
  byId('again-btn').hidden = next.action === 'again';
  // After the daily course or the tutorial, a quick way into something new.
  byId('random-btn').hidden = !state.daily && state.stage !== TUTORIAL;

  if (state.stage === TUTORIAL) save.tutorialDone = true;
  if (next.action === 'next' && state.stage < RANDOM_BASE) {
    save.stage = state.stage + 1;
    save.unlocked = Math.max(save.unlocked, save.stage);
  }
  persist();

  byId('leaderboard').hidden = true;
  byId('save-score').hidden = true;
  // Every run but the tutorial counts towards your stats (daily runs via the leaderboard).
  if (state.daily && state.recording) {
    showResultStats(submitDaily(state.daily.day, state.time, state.recording).then(loadStats));
  } else if (state.stage !== TUTORIAL && state.recording) {
    showResultStats(sendRun(state.stage, state.recording));
  } else {
    byId('result-stats').hidden = true;
  }
  byId('result').hidden = false;
  sfx(win ? 'win' : 'lose');
  nextButton.focus();
}
