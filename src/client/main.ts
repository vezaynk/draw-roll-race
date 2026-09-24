// Boots the game.
import buildCourse from '../shared/course/build';
import { TUTORIAL } from '../shared/course/stages';
import TIPS from '../shared/course/tips';
import initControls from './controls';
import { buildProgress, showHint, updateHud } from './hud';
import initOnline from './online';
import initOptions from './options';
import { initPad } from './pad';
import { onLimbsDrawn, resetStage } from './race';
import { initScene } from './render/scene';
import { initSound } from './sound';
import { state } from './state';

declare global {
  interface Window {
    /** For the browser tests and debugging in the console. */
    drr: { state: typeof state; buildCourse: typeof buildCourse };
  }
}

function boot(): void {
  // ?stage=N opens a stage directly (handy for testing a course).
  const asked = Number.parseInt(new URLSearchParams(window.location.search).get('stage') ?? '', 10);
  if (Number.isInteger(asked) && asked >= 0) state.stage = asked;

  initScene();
  initPad(onLimbsDrawn);
  initControls();
  initOptions();
  initSound();
  resetStage();
  buildProgress();
  updateHud();
  if (state.stage === TUTORIAL) showHint(`Welcome! ${TIPS.bumps}`, 0);
  initOnline();
  window.drr = { state, buildCourse };
}

boot();
