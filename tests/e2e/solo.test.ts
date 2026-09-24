// Solo play: a full race to the results, and spikes shattering limbs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE, launch, newPlayer, drawWheel, drawSpokes, text, waitForText,
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
