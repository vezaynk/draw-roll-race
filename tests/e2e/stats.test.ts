// Personal stats: every finished run (not the tutorial) is replayed by the server, which keeps your
// best on each course. After MIN_RUNS courses your percentile against everyone's bests shows on
// the results card and in Options, overall and by section type.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import buildCourse from '../../src/shared/course/build';
import { STAGES } from '../../src/shared/course/stages';
import { MIN_RUNS } from '../../src/shared/stats';
import botRun from '../support/bot';
import {
  BASE, launch, newPlayer, drawWheel, text,
} from './helpers';

const browser = await launch();
after(() => browser.close());

interface Posted { status: number; stats?: { courses: number; percentile: number | null; everyone: number } }

/** Posts a scripted run on each stage from inside the page, as the page's player. */
async function postRuns(page: Page, stages: number[]): Promise<Posted[]> {
  const runs = stages.map((stage) => ({ stage, inputs: botRun(buildCourse(stage)).inputs }));
  return page.evaluate(async (list) => {
    const player = JSON.parse(localStorage.getItem('draw-roll-race') ?? '{}').player as string;
    const out: { status: number; stats?: never }[] = [];
    for (const { stage, inputs } of list) {
      const res = await fetch('/api/runs', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ player, stage, inputs }),
      });
      out.push({ status: res.status, ...(await res.json()) });
    }
    return out;
  }, runs);
}

test('your best on each course counts; after enough courses you get a percentile', async () => {
  const p = await newPlayer(browser, 'Stat', { width: 1280, height: 800 });
  await p.goto(`${BASE}?stage=990`);
  await drawWheel(p);
  await p.waitForSelector('#result-stats', { state: 'visible', timeout: 60000 });
  const first = new RegExp(`^1 of ${MIN_RUNS} courses: finish ${MIN_RUNS - 1} more`);
  assert.match(await text(p, '#result-stats'), first);

  // The same course again is still one course.
  await p.click('#again-btn');
  await drawWheel(p);
  await p.waitForFunction(() => !document.getElementById('result')?.hidden);
  await p.waitForSelector('#result-stats', { state: 'visible', timeout: 60000 });
  assert.match(await text(p, '#result-stats'), first);

  // Runs on other courses: Endless stages with both a tunnel and an incline, so those section
  // types reach MIN_RUNS passes too. One short of the minimum there's no percentile, and running
  // a course again doesn't add one.
  const endless: number[] = [];
  for (let stage = STAGES.length; endless.length < MIN_RUNS; stage += 1) {
    const types = buildCourse(stage).sections.map((x) => x.type);
    if (types.includes('tunnel') && types.includes('incline')) endless.push(stage);
  }
  const most = await postRuns(p, endless.slice(0, MIN_RUNS - 2));
  assert.ok(most.every((r) => r.status === 200));
  assert.equal(most.at(-1)?.stats?.courses, MIN_RUNS - 1);
  assert.equal(most.at(-1)?.stats?.percentile, null, 'no percentile one course short');
  const again = await postRuns(p, [endless[0]]);
  assert.equal(again[0].stats?.courses, MIN_RUNS - 1, 'a course run again still counts once');
  assert.equal(again[0].stats?.everyone, most.at(-1)?.stats?.everyone, 'and adds nothing to everyone’s bests');
  const rest = await postRuns(p, endless.slice(MIN_RUNS - 2));
  assert.equal(rest[0].stats?.courses, MIN_RUNS);
  assert.notEqual(rest[0].stats?.percentile, null);

  // Someone else has been through the same section types at other sizes, so yours differ.
  const rival = await newPlayer(browser, 'Rival');
  await rival.goto(BASE);
  assert.ok((await postRuns(rival, [0, 1, 2])).every((r) => r.status === 200));
  await rival.context().close();

  // The next finish shows the percentile, and your strongest and weakest section types.
  await p.goto(`${BASE}?stage=990`);
  await drawWheel(p);
  await p.waitForSelector('#result-stats .sections-line', { timeout: 60000 });
  assert.match(await text(p, '#result-stats'), /^Your bests on your last 21 courses beat \d+% of all \d+ course bests\./);
  assert.match(await text(p, '#result-stats'), /Strongest: .+ \(\d+%\) · Weakest: .+ \(\d+%\)/);
  await p.click('#result-exit');
  await p.click('#menu-btn');
  assert.match(await text(p, '#account-stats'), /^Your bests on your last 21 courses beat \d+%/);
  const sections = await text(p, '#account-stats .section-stats');
  assert.match(sections, /Tunnel\W*\d+%/);
  assert.match(sections, /Steep Climb\W*\d+%/);
  assert.match(sections, /Bumpy Road\W*\d+ of 20/, 'fewer than 20 passes: a count, not a percentile');
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
