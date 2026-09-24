// Boots the game.
import buildCourse from '../shared/course/build';
import { RunReplay } from '../shared/replay';
import initAccount from './account';
import initControls, { enterDaily } from './controls';
import { buildProgress, updateHud } from './hud';
import initOnline from './online';
import initOptions from './options';
import { initPad } from './pad';
import { onLimbsDrawn, resetStage } from './race';
import { initScene } from './render/scene';
import { initSound } from './sound';
import { state } from './state';
import { firstVisit } from './storage';

declare global {
  interface Window {
    /** For the browser tests and debugging in the console. */
    drr: { state: typeof state; buildCourse: typeof buildCourse; RunReplay: typeof RunReplay };
  }
}

function boot(): void {
  // ?stage=N opens a stage directly (handy for testing a course); otherwise the daily course is
  // ready to race.
  const asked = Number.parseInt(new URLSearchParams(window.location.search).get('stage') ?? '', 10);
  const direct = Number.isInteger(asked) && asked >= 0;
  if (direct) state.stage = asked;

  initScene();
  initPad(onLimbsDrawn);
  initControls();
  initOptions();
  initAccount();
  initSound();
  resetStage();
  buildProgress();
  updateHud();
  if (!direct) enterDaily(firstVisit ? 'Welcome! New here? Try the Tutorial first. ' : '');
  initOnline();
  window.drr = { state, buildCourse, RunReplay };
}

boot();
