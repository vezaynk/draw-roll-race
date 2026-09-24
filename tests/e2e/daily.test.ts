// Tutorial for new players, solo options (opponents), best-run ghost, and the daily leaderboard.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
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

test('daily leaderboard accepts real runs and refuses impossible ones', async () => {
  const info = await (await fetch(`${BASE}api/daily`)).json() as { day: string; stage: number };
  assert.match(info.day, /^\d{4}-\d{2}-\d{2}$/);

  // Build a run that moves at a steady, possible speed from start to finish of today's course.
  const p = await newPlayer(browser, 'Hana');
  await p.goto(BASE);
  const course = await p.evaluate((stage) => {
    const c = window.drr.buildCourse(stage);
    return { startX: c.startX, finishX: c.finishX };
  }, info.stage);
  const speed = 250; const
    time = (course.finishX - course.startX) / speed;
  const trace: [number, number][] = [];
  for (let t = 0; t <= time; t += 0.2) {
    trace.push([Number(t.toFixed(2)), course.startX + speed * t]);
  }
  trace.push([Number(time.toFixed(2)), course.finishX]);
  const player = `e2e-player-${Date.now().toString(36).padStart(8, '0')}`;
  const post = (body: unknown) => fetch(`${BASE}api/daily`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  const ok = await post({
    day: info.day, player, name: 'Hana', time: Number(time.toFixed(2)), trace,
  });
  assert.equal(ok.status, 200, await ok.text());
  const board = await (await fetch(`${BASE}api/daily?player=${player}`)).json() as {
    top: { name: string; you: boolean }[];
    you: { rank: number } | null;
  };
  assert.ok(board.top.some((r) => r.you && r.name === 'Hana'));
  assert.ok(board.you && board.you.rank >= 1);

  // Too fast, and a recording that teleports to the line, are refused.
  const fast = await post({
    day: info.day, player, name: 'Hana', time: 0.2, trace,
  });
  assert.equal(fast.status, 422);
  const jump = await post({
    day: info.day, player, name: 'Hana', time: 5, trace: [[0, course.startX], [0.5, course.startX + 50], [5, course.finishX]],
  });
  assert.equal(jump.status, 422);
  assert.match(((await jump.json()) as { error: string }).error, /gaps/);
  const teleport: [number, number][] = [[0, course.startX]];
  for (let t = 0.5; t < 5; t += 0.5) teleport.push([t, course.startX + 20 * t]);
  teleport.push([5, course.finishX]);
  const zap = await post({
    day: info.day, player, name: 'Hana', time: 5, trace: teleport,
  });
  assert.equal(zap.status, 422);
  assert.match(((await zap.json()) as { error: string }).error, /faster than any runner/);

  // The daily course can be opened from Options.
  await p.click('#menu-btn');
  await p.click('#daily-btn');
  assert.match(await text(p, '#stage-label'), /Daily course/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
