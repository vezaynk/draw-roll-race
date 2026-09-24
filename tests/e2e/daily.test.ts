// Tutorial for new players, solo options (opponents), best-run ghost, and the daily leaderboard.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import buildCourse from '../../src/shared/course/build';
import { RunReplay } from '../../src/shared/replay';
import botRun from '../support/bot';
import {
  BASE, launch, newPlayer, drawWheel, text, waitForText,
} from './helpers';

const browser = await launch();
after(() => browser.close());

test('new players start in the tutorial', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  await p.goto(BASE);
  assert.match(await text(p, '#stage-label'), /Tutorial/);
  assert.match(await text(p, '#pad-hint'), /half circle/i);
  await ctx.close();
});

test('opponents from Options race, and your best run comes back as a ghost', async () => {
  const p = await newPlayer(browser, 'Gus', { width: 1280, height: 800 });
  await p.goto(`${BASE}?stage=990`);
  await p.click('#menu-btn');
  await p.selectOption('#opt-cpus', '3');
  await p.selectOption('#opt-difficulty', 'mixed');
  await p.click('#options-close');

  await drawWheel(p);
  await p.waitForTimeout(500);
  assert.equal(await p.evaluate(() => document.querySelectorAll('#progress .dot.cpu:not([hidden])').length), 3);
  await waitForText(p, '#result', /You win|You finished|Finished/, 60000);
  assert.match(await text(p, '#result-best'), /First finish|New best|Best/);

  // Race the same course again: the ghost of the first run appears.
  await p.click('#again-btn');
  await p.waitForTimeout(600);
  const ghostShown = await p.evaluate(() => document.querySelector<HTMLElement>('#progress .dot.ghost')?.hidden === false);
  assert.equal(ghostShown, true, 'ghost dot visible');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('the game records runs that replay to the same time, here and in the browser', async () => {
  const p = await newPlayer(browser, 'Ivo', { width: 1280, height: 800 });
  await p.goto(`${BASE}?stage=990`);
  await drawWheel(p);
  // Redraw mid-race, so the recording has more than the starting limbs.
  await p.waitForTimeout(1200);
  await drawWheel(p, 34);
  await p.waitForFunction(() => window.drr.state.finished, undefined, { timeout: 30000 });
  const run = await p.evaluate(() => {
    const { state, buildCourse: build, RunReplay: Replay } = window.drr;
    const inputs = state.recording?.inputs ?? [];
    const replay = new Replay(build(990), inputs, 240 * 60);
    replay.advance();
    return {
      inputs, time: state.time, replayed: replay.time, finished: replay.finished,
    };
  });
  assert.ok(run.inputs.length >= 2, 'the redraw was recorded');
  assert.equal(run.finished, true);
  assert.equal(run.replayed, run.time, 'the browser replays its own run exactly');
  const here = new RunReplay(buildCourse(990), run.inputs, 240 * 60);
  here.advance();
  assert.equal(here.time, run.time, 'Node replays the browser run exactly');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('daily runs are timed by the server replaying them', async () => {
  const info = await (await fetch(`${BASE}api/daily`)).json() as { day: string; stage: number };
  assert.match(info.day, /^\d{4}-\d{2}-\d{2}$/);
  const bot = botRun(buildCourse(info.stage));
  assert.ok(bot.finished, 'the test player finishes today\'s course');
  const player = `e2e-player-${Date.now().toString(36).padStart(8, '0')}`;
  const post = (body: unknown) => fetch(`${BASE}api/daily`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const expected = Math.round(bot.time * 100) / 100;

  // The claimed time is ignored: the server records the replay's time.
  const ok = await post({
    day: info.day, player, name: 'Hana', time: 1.5, inputs: bot.inputs,
  });
  const out = await ok.json() as { time: number };
  assert.equal(ok.status, 200, JSON.stringify(out));
  assert.equal(out.time, expected);
  const board = await (await fetch(`${BASE}api/daily?player=${player}`)).json() as {
    top: { name: string; you: boolean }[];
    you: { rank: number; time: number } | null;
  };
  assert.equal(board.you?.time, expected);

  // The fastest run of the day comes back with its inputs, for the leader ghost.
  const { leader } = await (await fetch(`${BASE}api/daily/leader?day=${info.day}`)).json() as {
    leader: { time: number; inputs: unknown[] } | null;
  };
  assert.ok(leader && leader.time <= expected && leader.inputs.length >= 1);

  // A run that never reaches the finish, and one without a recording, are refused.
  const stuck = await post({
    day: info.day, player, name: 'Hana', time: 5, inputs: [[0, { arm: [], leg: [[160, 120, 162, 121]] }]],
  });
  assert.equal(stuck.status, 422);
  assert.match(((await stuck.json()) as { error: string }).error, /did not reach the finish/);
  const empty = await post({
    day: info.day, player, name: 'Hana', time: 5, inputs: [],
  });
  assert.equal(empty.status, 422);
});

test('the daily course shows the leader as a ghost', async () => {
  const p = await newPlayer(browser, 'Jo', { width: 1280, height: 800 });
  await p.goto(BASE);
  await p.click('#menu-btn');
  await p.click('#daily-btn');
  assert.match(await text(p, '#stage-label'), /Daily course/);
  await waitForText(p, '#pad-hint', /leader/i, 10000);
  await drawWheel(p);
  await p.waitForTimeout(600);
  const leaderDot = await p.evaluate(() => document.querySelector<HTMLElement>('#progress .dot.ghost.leader')?.hidden === false);
  assert.equal(leaderDot, true, 'leader ghost dot visible');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
