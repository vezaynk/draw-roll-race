// The start screen: the Daily course, Tutorial and Play with friends buttons, and Exit.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import {
  BASE, launch, newPlayer, drawWheel, text, createRoom,
} from './helpers';

const browser = await launch();
after(() => browser.close());

const shown = (p: Page, selector: string) => p.locator(selector).isVisible();

async function assertAtStart(p: Page): Promise<void> {
  await p.waitForSelector('#start-menu', { state: 'visible' });
  assert.equal(await shown(p, '#exit-btn'), false, 'no Exit on the start screen');
  assert.equal(await p.evaluate(() => window.drr.state.racing), false);
}

test('the start buttons open the tutorial, the daily course and the online menu', async () => {
  const p = await newPlayer(browser, 'Ada');
  await p.goto(BASE);
  await assertAtStart(p);
  await p.waitForSelector('#start-online', { state: 'visible' });
  // They moved out of Options and the top bar.
  assert.equal(await p.locator('#daily-btn, #tutorial-btn, #online-btn, #restart-btn').count(), 0);

  await p.click('#start-tutorial');
  assert.match(await text(p, '#stage-label'), /Tutorial/);
  await p.click('#start-daily');
  assert.match(await text(p, '#stage-label'), /Daily course/);

  await p.click('#start-online');
  await p.waitForSelector('#online-menu', { state: 'visible' });
  assert.equal(await shown(p, '#start-menu'), false, 'start buttons hide under the online menu');
  await p.click('#menu-close');
  await assertAtStart(p);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('drawing starts a race, and Exit goes back to the start screen', async () => {
  const p = await newPlayer(browser, 'Bea', { width: 1280, height: 800 });
  await p.goto(`${BASE}?stage=990`);
  await assertAtStart(p);
  await drawWheel(p);
  await p.waitForFunction(() => window.drr.state.racing && window.drr.state.time > 0.5);
  assert.equal(await shown(p, '#start-menu'), false);
  await p.click('#exit-btn');
  await assertAtStart(p);
  assert.equal(await p.evaluate(() => window.drr.state.time), 0);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('Exit in a room gives up the race, leaves the room and goes back to the start screen', async () => {
  const p = await newPlayer(browser, 'Cal');
  await createRoom(p, { testStage: 990 });
  assert.equal(await shown(p, '#start-menu'), false);
  await drawWheel(p);
  await p.click('#start-btn');
  await p.waitForFunction(() => window.drr.state.racing, null, { timeout: 10000 });
  await p.click('#exit-btn');
  await assertAtStart(p);
  assert.equal(await shown(p, '#lobby'), false);
  assert.equal(await p.evaluate(() => window.location.search), '');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
