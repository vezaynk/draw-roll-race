// Personal stats: every finished run (not the tutorial) is replayed and kept by the server, and
// after MIN_RUNS runs your percentile against all runs shows on the results card and in Options.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import buildCourse from '../../src/shared/course/build';
import { MIN_RUNS } from '../../src/shared/stats';
import botRun from '../support/bot';
import {
  BASE, launch, newPlayer, drawWheel, text,
} from './helpers';

const browser = await launch();
after(() => browser.close());

test('runs count towards your stats; after enough of them you get a percentile', async () => {
  const p = await newPlayer(browser, 'Stat', { width: 1280, height: 800 });
  await p.goto(`${BASE}?stage=990`);
  await drawWheel(p);
  await p.waitForSelector('#result-stats', { state: 'visible', timeout: 60000 });
  assert.match(await text(p, '#result-stats'), new RegExp(`^1 of ${MIN_RUNS} runs: finish ${MIN_RUNS - 1} more`));

  // More runs: send the same recording again (the server replays each one).
  const sent = await p.evaluate(async (more) => {
    const { state } = window.drr;
    const player = JSON.parse(localStorage.getItem('draw-roll-race') ?? '{}').player as string;
    let last: unknown = null;
    for (let i = 0; i < more; i += 1) {
      const res = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ player, stage: state.stage, inputs: state.recording?.inputs }),
      });
      last = await res.json();
    }
    return last as { stats: { runs: number; percentile: number | null } };
  }, MIN_RUNS - 2);
  assert.equal(sent.stats.runs, MIN_RUNS - 1);
  assert.equal(sent.stats.percentile, null, 'no percentile one run short');

  // The next finish gets one.
  await p.click('#again-btn');
  await drawWheel(p);
  await p.waitForSelector('#result-stats', { state: 'visible', timeout: 60000 });
  assert.match(await text(p, '#result-stats'), /^Your last 20 runs beat \d+% of all \d+ runs\.$/);
  await p.click('#result-exit');
  await p.click('#menu-btn');
  assert.match(await text(p, '#account-stats'), /^Your last 20 runs beat \d+%/);
  // Stage 990 is all bumps: that section type now has a percentile too.
  assert.match(await text(p, '#account-stats .section-stats'), /Bumpy Road\W*\d+%/);
  await p.click('#options-close');

  // Twenty runs on a course with five other section types: the results card then names your
  // strongest and weakest types.
  const other = botRun(buildCourse(991));
  assert.ok(other.finished);
  await p.evaluate(async ({ inputs, times }) => {
    const player = JSON.parse(localStorage.getItem('draw-roll-race') ?? '{}').player as string;
    for (let i = 0; i < times; i += 1) {
      await fetch('/api/runs', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ player, stage: 991, inputs }),
      });
    }
  }, { inputs: other.inputs, times: MIN_RUNS });
  // Someone else gets through bumps at another speed, so your types don't all tie at 50%.
  const rival = await newPlayer(browser, 'Rival');
  await rival.goto(BASE);
  const stage0 = botRun(buildCourse(0));
  await rival.evaluate(async ({ inputs, times }) => {
    const player = JSON.parse(localStorage.getItem('draw-roll-race') ?? '{}').player as string;
    for (let i = 0; i < times; i += 1) {
      await fetch('/api/runs', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ player, stage: 0, inputs }),
      });
    }
  }, { inputs: stage0.inputs, times: MIN_RUNS });
  await rival.context().close();
  await p.goto(`${BASE}?stage=990`);
  await drawWheel(p);
  await p.waitForSelector('#result-stats .sections-line', { timeout: 60000 });
  assert.match(await text(p, '#result-stats'), /Strongest: .+ \(\d+%\) · Weakest: .+ \(\d+%\)/);
  await p.click('#result-exit');
  await p.click('#menu-btn');
  const types = await p.locator('#account-stats .section-stats li').count();
  assert.equal(types, 6, 'bumps and the five types of stage 991');

  assert.deepEqual(p.errors, []);

  // The tutorial doesn't count, and the server refuses a run that doesn't finish.
  const refused = await p.evaluate(async () => {
    const player = JSON.parse(localStorage.getItem('draw-roll-race') ?? '{}').player as string;
    const bodies = [
      { player, stage: 900, inputs: window.drr.state.recording?.inputs },
      { player, stage: 990, inputs: [] },
    ];
    const statuses: number[] = [];
    for (const body of bodies) {
      const res = await fetch('/api/runs', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      statuses.push(res.status);
    }
    return statuses;
  });
  assert.deepEqual(refused, [400, 422]);
  await p.context().close();
});
