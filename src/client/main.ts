// Boots the game.
import buildCourse from '../shared/course/build';
import { RunReplay } from '../shared/replay';
import initAccount from './account';
import { wearMyLook } from './appearance';
import initLookPicker from './lookPicker';
import initControls, { enterDaily } from './controls';
import submitDaily, { initSaveScore } from './daily';
import { buildProgress, updateHud } from './hud';
import initOnline from './online';
import initOptions from './options';
import { initPad } from './pad';
import { onLimbCleared, onLimbsDrawn, resetStage } from './race';
import showResults from './results';
import { initScene } from './render/scene';
import { initSound } from './sound';
import { state } from './state';
import { firstVisit, myHash } from './storage';

declare global {
  interface Window {
    /** For the browser tests and debugging in the console. */
    drr: {
      state: typeof state; buildCourse: typeof buildCourse; RunReplay: typeof RunReplay;
      submitDaily: typeof submitDaily; showResults: typeof showResults;
    };
  }
}

function boot(): void {
  // ?stage=N opens a stage directly (handy for testing a course); otherwise the daily course is
  // ready to race.
  const asked = Number.parseInt(new URLSearchParams(window.location.search).get('stage') ?? '', 10);
  const direct = Number.isInteger(asked) && asked >= 0;
  if (direct) state.stage = asked;

  initScene();
  initPad(onLimbsDrawn, onLimbCleared);
  initControls();
  initOptions();
  initAccount();
  initLookPicker();
  initSaveScore();
  initSound();
  resetStage();
  buildProgress();
  updateHud();
  if (!direct) enterDaily(firstVisit ? 'Welcome! New here? Try the Tutorial first. ' : '');
  initOnline();
  // A first visit works out the player hash, which picks the default look.
  myHash().then(wearMyLook).catch(() => {});
  window.drr = {
    state, buildCourse, RunReplay, submitDaily, showResults,
  };
}

boot();
