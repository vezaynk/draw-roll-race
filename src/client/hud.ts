// The heads-up display: progress bar, stage name, section name, timer, pop-up messages and the
// hint bubble above the drawing pad (which also shows obstacle tips).
import { needsShapeChange } from '../shared/course/sections';
import {
  RANDOM_BASE, STAGES, TUTORIAL, dailyStage, isTestStage,
} from '../shared/course/stages';
import TIPS from '../shared/course/tips';
import { byId, el } from './dom';
import { ghostAt } from './ghost';
import { hooks, state } from './state';
import { persist, save } from './storage';

export const DEFAULT_HINT = 'Draw from the shoulder or hip to give your runner arms or legs';

let toastTimer = 0;
let hintTimer = 0;

export function toast(text: string, ms: number): void {
  const box = byId('toast');
  box.textContent = text;
  box.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => box.classList.remove('show'), ms);
}

/** Shows the hint bubble for ms milliseconds (0: until replaced). */
export function showHint(text: string, ms = 2200): void {
  const hint = byId('pad-hint');
  hint.textContent = text;
  hint.classList.remove('hidden');
  window.clearTimeout(hintTimer);
  if (ms !== 0) hintTimer = window.setTimeout(() => hint.classList.add('hidden'), ms);
}

export function hideHint(): void {
  window.clearTimeout(hintTimer);
  byId('pad-hint').classList.add('hidden');
}

export function stageName(n: number): string {
  if (state.daily && n === dailyStage(state.daily.day)) return 'Daily course';
  if (n === TUTORIAL) return 'Tutorial';
  if (isTestStage(n)) return 'Test course';
  if (n >= RANDOM_BASE) return 'Random course';
  if (n < STAGES.length) return `Stage ${n + 1} / ${STAGES.length}`;
  return `Endless ${n - STAGES.length + 1}`;
}

/** The start screen: solo play with no race running and no results showing. */
export function atStart(): boolean {
  return state.mode === 'solo' && !state.racing && !state.finished;
}

/**
 * Buttons that follow the game's state. In solo play, when no race is running, tap the stage
 * name to switch stages. The start buttons show on the start screen, Exit everywhere else.
 */
export function updateControls(): void {
  const button = byId<HTMLButtonElement>('stage-label');
  const can = state.mode === 'solo' && !state.racing;
  button.disabled = !can;
  button.classList.toggle('switchable', can);
  byId('start-menu').hidden = !atStart();
  byId('exit-btn').hidden = atStart();
  // The course that's selected, until a race starts.
  byId('mode-title').hidden = !atStart();
  byId('mode-name').textContent = stageName(state.stage);
}

interface Dots {
  player: HTMLElement;
  ghosts: HTMLElement[];
  cpus: HTMLElement[];
}

let dots: Dots | null = null;

/** Rebuilds the progress bar for the current course. */
export function buildProgress(): void {
  const progress = byId('progress');
  progress.textContent = '';
  const c = state.course;
  const span = c.finishX - c.startX;
  c.sections.filter((s) => needsShapeChange(s.type)).forEach((s) => {
    const zone = el('div', 'zone');
    zone.style.left = `${((s.from - c.startX) / span) * 100}%`;
    zone.style.width = `${((s.to - s.from) / span) * 100}%`;
    progress.append(zone);
  });
  dots = { ghosts: [], player: el('div', 'dot player'), cpus: [] };
  progress.append(dots.player, el('span', 'flag', '🏁'));
  byId('stage-label').textContent = stageName(state.stage);
  updateControls();
}

function showTips(px: number): void {
  if (!state.racing || state.mode !== 'solo') return;
  const next = state.course.sections.find((s) => s.from > px - 20 && s.from - px < 260);
  if (!next || state.tipsShown[next.type]) return;
  const tutorial = state.stage === TUTORIAL;
  if (!tutorial && save.seenTips[next.type]) return;
  // Tips: always in the tutorial, otherwise the first time you meet each obstacle.
  state.tipsShown[next.type] = true;
  showHint(TIPS[next.type], tutorial ? 6000 : 4500);
  if (!tutorial) {
    save.seenTips[next.type] = true;
    persist();
  }
}

export function updateHud(): void {
  if (!dots) buildProgress();
  const d = dots as Dots;
  const progress = byId('progress');
  const c = state.course;
  const span = c.finishX - c.startX;
  const at = (x: number) => `${Math.max(0, Math.min(1, (x - c.startX) / span)) * 100}%`;

  d.player.hidden = !state.player;
  if (state.player) d.player.style.left = at(state.player.x);
  while (d.cpus.length < state.cpus.length) {
    const dot = el('div', 'dot cpu');
    progress.insertBefore(dot, d.player);
    d.cpus.push(dot);
  }
  d.cpus.forEach((dot, i) => {
    const cpu = state.cpus[i];
    dot.hidden = !cpu;
    if (cpu) {
      dot.style.background = cpu.runner.color;
      dot.style.left = at(cpu.runner.x);
    }
  });
  while (d.ghosts.length < state.ghosts.length) {
    const dot = el('div', 'dot ghost');
    progress.insertBefore(dot, d.player);
    d.ghosts.push(dot);
  }
  d.ghosts.forEach((dot, i) => {
    const ghost = state.ghosts[i];
    const pose = state.racing && ghost ? ghostAt(ghost, state.time) : null;
    dot.hidden = !pose;
    dot.classList.toggle('leader', !!ghost?.leader);
    if (pose) dot.style.left = at(pose.x);
  });
  hooks.onHud?.(progress, c.startX, span);

  byId('timer').textContent = `${state.time.toFixed(2)} s`;
  const px = state.player ? state.player.x : c.startX;
  showTips(px);
  const section = c.sections.find((s) => px >= s.from && px < s.to) ?? null;
  if (section !== state.section) {
    state.section = section;
    const idle = state.cpuTime !== null ? 'CPU finished' : '';
    byId('section-label').textContent = section ? section.label : idle;
    if (section && state.racing) toast(section.label, 1100);
  }
}
