// Solo play: a full race to the results, spikes shattering limbs, double-tap to clear a limb, and
// a random course after the daily course or the tutorial.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { RANDOM_BASE, TUTORIAL } from '../../src/shared/course/stages';
import {
  BASE, launch, newPlayer, drawArm, drawWheel, drawSpokes, doubleTapPad, text, waitForText,
} from './helpers';

const browser = await launch();
after(() => browser.close());

test('a solo race reaches the results', async () => {
  const p = await newPlayer(browser, 'Solo', { width: 1280, height: 800 });
  await p.goto(`${BASE}?stage=990`);
  await drawWheel(p);
  await waitForText(p, '#result', /You win|You finished|Finished/, 60000);
  assert.match(await text(p, '#result-time'), /\d+\.\d\d s/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('spikes shatter legs, and spokes climb out of the pit', async () => {
  const p = await newPlayer(browser, 'Spiky', { width: 1280, height: 800 });
  await p.goto(`${BASE}?stage=991`);
  await drawWheel(p);
  await p.waitForFunction(() => {
    const { state } = window.drr;
    return state.limbs.leg.length === 0 && state.time > 0;
  }, null, { timeout: 20000 });
  assert.match((await p.textContent('#toast')) ?? '', /Legs shattered/);
  await drawSpokes(p);
  await p.waitForFunction(() => {
    const { state } = window.drr;
    return (state.player?.x ?? 0) > state.course.sections[0].to;
  }, null, { timeout: 20000 });
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('a double tap clears the nearest limb, mid-race too, and the run still replays exactly', async () => {
  const p = await newPlayer(browser, 'Tap', { width: 1280, height: 800 });
  await p.goto(`${BASE}?stage=990`);
  await drawWheel(p);
  await drawArm(p);
  await p.waitForFunction(() => window.drr.state.limbs.arm.length === 1);
  // Double-click near the end of the arm: the arm goes, the legs stay.
  await doubleTapPad(p, 230, 70);
  await p.waitForFunction(() => window.drr.state.limbs.arm.length === 0);
  assert.equal(await p.evaluate(() => window.drr.state.limbs.leg.length), 1, 'legs kept');
  await p.waitForFunction(() => window.drr.state.finished, undefined, { timeout: 30000 });
  const run = await p.evaluate(() => {
    const { state, buildCourse: build, RunReplay: Replay } = window.drr;
    const inputs = state.recording?.inputs ?? [];
    const replay = new Replay(build(990), inputs, 240 * 60);
    replay.advance();
    return { cleared: inputs.some(([, limbs]) => !limbs.arm.length && limbs.leg.length), time: state.time, replayed: replay.time };
  });
  assert.ok(run.cleared, 'the clear was recorded');
  assert.equal(run.replayed, run.time, 'the run replays to the same time');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('after the daily course or the tutorial, the results card offers a random course', async () => {
  const p = await newPlayer(browser, 'Rae', { width: 1280, height: 800 });
  /** Shows the results card as if the current course had just been finished. */
  const finish = () => p.evaluate(() => {
    window.drr.state.time = 30;
    window.drr.showResults();
  });

  // The daily course (what the game opens on).
  await p.goto(BASE);
  await finish();
  assert.equal(await p.isVisible('#random-btn'), true, 'after the daily course');
  await p.click('#random-btn');
  const picked = await p.evaluate(() => ({ stage: window.drr.state.stage, racing: window.drr.state.racing }));
  assert.ok(picked.stage >= RANDOM_BASE && picked.stage < RANDOM_BASE + 1000000, `stage ${picked.stage}`);
  assert.equal(picked.racing, true, 'the race starts at once');
  assert.equal(await p.isVisible('#result'), false);
  assert.match(await text(p, '#stage-label'), /Random course/);

  // The tutorial.
  await p.goto(`${BASE}?stage=${TUTORIAL}`);
  await finish();
  assert.equal(await p.isVisible('#random-btn'), true, 'after the tutorial');

  // Other courses keep their own next step.
  await p.goto(`${BASE}?stage=990`);
  await drawWheel(p);
  await p.waitForSelector('#result', { state: 'visible', timeout: 60000 });
  assert.equal(await p.isVisible('#random-btn'), false, 'not after other courses');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
