// Buttons around the race: the stage name, restart, the results card, and entering the daily
// course or tutorial.
import { TUTORIAL, dailyStage, today } from '../shared/course/stages';
import TIPS from '../shared/course/tips';
import { hasLimbs } from '../shared/limbs';
import { loadLeader } from './daily';
import { byId } from './dom';
import { DEFAULT_HINT, showHint, toast } from './hud';
import { resetStage, startRace } from './race';
import type { NextAction } from './results';
import { hooks, state } from './state';
import { persist, save } from './storage';

function hideResults(): void {
  byId('result').hidden = true;
}

export function enterDaily(): void {
  const day = today();
  state.daily = { day };
  state.stage = dailyStage(day);
  hideResults();
  resetStage();
  toast('Daily course', 1200);
  const intro = 'Today’s course is the same for everyone. Draw to start.';
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

  byId('restart-btn').addEventListener('click', () => {
    if (state.mode === 'online') {
      hooks.onRestart?.();
      return;
    }
    hideResults();
    resetStage();
    if (hasLimbs(state.limbs)) startRace();
    else showHint(DEFAULT_HINT, 0);
  });

  byId('again-btn').addEventListener('click', () => {
    hideResults();
    resetStage();
    startRace();
  });

  byId('next-btn').addEventListener('click', () => {
    const action = byId('next-btn').dataset.action as NextAction;
    if (action === 'stage1') state.stage = 0;
    else if (action === 'next') state.stage += 1;
    hideResults();
    resetStage();
    startRace();
  });
}
