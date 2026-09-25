// Buttons around the race: the stage name, Exit, the results card, and the start buttons for the
// daily course and the tutorial.
import {
  RANDOM_BASE, TUTORIAL, dailyStage, today,
} from '../shared/course/stages';
import TIPS from '../shared/course/tips';
import { hasLimbs } from '../shared/limbs';
import { loadLeader } from './daily';
import { byId } from './dom';
import { DEFAULT_HINT, showHint } from './hud';
import { resetStage, startRace, stopRace } from './race';
import type { NextAction } from './results';
import { hooks, state } from './state';
import { persist, save } from './storage';

function hideResults(): void {
  byId('result').hidden = true;
}

/** The daily course, ready to race. `welcome` is added to the hint (for first-time players). */
export function enterDaily(welcome = ''): void {
  const day = today();
  state.daily = { day };
  state.stage = dailyStage(day);
  hideResults();
  resetStage();
  const intro = `${welcome}Today’s course is the same for everyone.`;
  showHint(intro, 0);
  loadLeader(day).then((line) => {
    if (line && state.daily?.day === day && !state.racing) showHint(`${intro} ${line}`, 0);
  });
}

export function enterTutorial(): void {
  state.daily = null;
  state.stage = TUTORIAL;
  hideResults();
  resetStage();
  showHint(TIPS.bumps, 0);
}

/** Exit: stops the race (or leaves the room) and goes back to the start screen. */
function exitToStart(): void {
  if (state.mode === 'online') {
    hooks.onExit?.();
    return;
  }
  stopRace();
  // The daily course and the tutorial start again with their own hints.
  if (state.daily) {
    enterDaily();
    return;
  }
  if (state.stage === TUTORIAL) {
    enterTutorial();
    return;
  }
  hideResults();
  resetStage();
  showHint(DEFAULT_HINT, 0);
}

/** How many generated courses "a random course" picks from (the daily courses come after). */
const RANDOM_COURSES = 1000000;

/** A generated course picked at random, raced at once (from the results card). */
function playRandomCourse(): void {
  state.daily = null;
  state.stage = RANDOM_BASE + Math.floor(Math.random() * RANDOM_COURSES);
  hideResults();
  resetStage();
  startRace();
}

/** The tutorial, then Stage 1 up to the furthest unlocked stage. */
function stageCycle(): number[] {
  return [TUTORIAL, ...Array.from({ length: save.unlocked + 1 }, (_, i) => i)];
}

function nextStage(): number {
  if (state.daily) {
    // Leaving the daily course goes back to your stage.
    state.daily = null;
    return Math.min(save.stage, save.unlocked);
  }
  const order = stageCycle();
  return order[(order.indexOf(state.stage) + 1) % order.length];
}

export default function initControls(): void {
  byId('stage-label').addEventListener('click', () => {
    if (state.racing) return;
    state.stage = nextStage();
    save.stage = state.stage;
    persist();
    hideResults();
    resetStage();
    if (!hasLimbs(state.limbs)) showHint(DEFAULT_HINT, 0);
  });

  byId('start-daily').addEventListener('click', () => enterDaily());
  byId('start-tutorial').addEventListener('click', enterTutorial);
  byId('exit-btn').addEventListener('click', exitToStart);
  byId('result-exit').addEventListener('click', exitToStart);

  byId('again-btn').addEventListener('click', () => {
    hideResults();
    resetStage();
    startRace();
  });

  byId('random-btn').addEventListener('click', playRandomCourse);

  byId('next-btn').addEventListener('click', () => {
    const action = byId('next-btn').dataset.action as NextAction;
    if (action === 'lobby') {
      hideResults();
      hooks.onReturnToLobby?.();
      return;
    }
    if (action === 'stage1') state.stage = 0;
    else if (action === 'next') state.stage += 1;
    hideResults();
    resetStage();
    startRace();
  });
}
