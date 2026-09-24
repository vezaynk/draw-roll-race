// Solo play: a full race to the results, spikes shattering limbs, and double-tap to clear a limb.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
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
