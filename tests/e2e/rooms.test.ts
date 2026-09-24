// Rooms: public listing, joining, CPUs run by the room, host handover, private rooms, bad codes.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE, launch, newPlayer, drawWheel, text, waitForText, createRoom, joinByLink,
} from './helpers';

const browser = await launch();
after(() => browser.close());

test('public room with CPUs: listing, race, results, host handover, private join by code', async () => {
  const step = (m: string) => console.log(`# step: ${m}`);
  const ana = await newPlayer(browser, 'Ana');
  const code = await createRoom(ana, { name: 'Sunday Sprint', isPublic: true, testStage: 990 });
  await drawWheel(ana);
  step('room created');

  // Ben finds the room in the public list.
  const ben = await newPlayer(browser, 'Ben', { width: 1280, height: 800 });
  await ben.goto(`${BASE}?teststage=990`);
  await ben.click('#online-btn');
  await ben.waitForSelector('#public-rooms li button');
  assert.match(await text(ben, '#public-rooms'), /Sunday Sprint/);
  await ben.click('#public-rooms li button');
  await waitForText(ben, '#room-name', /Sunday Sprint/);
  await drawWheel(ben);
  step('ben joined');

  // The host fills slots with CPUs.
  await ['easy', 'normal', 'hard'].reduce((done, difficulty) => done.then(async () => {
    await ana.selectOption('#cpu-difficulty', difficulty);
    await ana.click('#add-cpu');
    await ana.waitForTimeout(150);
  }), Promise.resolve());
  await waitForText(ben, '#racer-count', /5 \/ 8 racers/);
  step('cpus added');

  // Race: Ben sees the CPUs move even though nobody's browser runs them.
  await ana.click('#start-btn');
  await ben.waitForTimeout(4500);
  const dots = await ben.evaluate(() => document.querySelectorAll('#progress .dot.remote').length);
  assert.equal(dots, 4, 'Ben should see Ana and three CPUs');
  step('race seen');

  // The host leaves mid-race; the CPUs keep racing and finish.
  await ana.click('#leave-btn');
  await waitForText(ben, '#results-box', /Last race/i, 60000);
  step('race ended');
  const results = await text(ben, '#results-list');
  assert.match(results, /You/);
  // Ben's finish was replayed by the room: a tick with how long the check took.
  const tick = await ben.getAttribute('#results-list .verify.ok', 'title');
  assert.match(tick ?? '', /^Server-validated in \d+\.\d\d seconds$/);
  assert.equal((results.match(/CPU/g) || []).length, 3, `all three CPUs appear in the results: ${results}`);
  assert.match(await text(ben, '#player-list'), /HOST/i);

  // Private rooms leave the public list but can be joined by code.
  await ben.click('#visibility-btn');
  await ben.waitForTimeout(400);
  const listed = await (await fetch(`${BASE}api/rooms`)).json() as { rooms: { code: string }[] };
  assert.ok(!listed.rooms.some((r) => r.code === code), 'private room is not listed');
  const cy = await newPlayer(browser, 'Cy');
  await cy.goto(BASE);
  await cy.click('#online-btn');
  await cy.fill('#join-code', code);
  await cy.click('#join-form button');
  await waitForText(cy, '#room-visibility', /private/i);

  [ana, ben, cy].forEach((p) => assert.deepEqual(p.errors, []));
  await ben.context().close(); await cy.context().close(); await ana.context().close();
});

test('joining a code with no room shows a clear error', async () => {
  const p = await newPlayer(browser, 'Dee');
  await p.goto(BASE);
  await p.click('#online-btn');
  await p.fill('#join-code', 'K7Q2M');
  await p.click('#join-form button');
  await waitForText(p, '#join-error', /No room is open with code K7Q2M/);
  await p.fill('#join-code', 'hi');
  await p.click('#join-form button');
  await waitForText(p, '#join-error', /5 letters or digits/);
  await p.context().close();
});

test('new room codes are unique and names are moderated', async () => {
  const codes = new Set<string>();
  const made = await Promise.all(Array.from({ length: 5 }, async () => {
    const res = await fetch(`${BASE}api/rooms`, { method: 'POST' });
    return ((await res.json()) as { code: string }).code;
  }));
  made.forEach((c) => codes.add(c));
  assert.equal(codes.size, 5);

  const p = await newPlayer(browser, 'sh1t head');
  await createRoom(p, { name: 'fuuuck room', isPublic: false });
  assert.doesNotMatch(await text(p, '#room-name'), /fu+ck/i);
  assert.match(await text(p, '#room-name'), /room/i);
  assert.doesNotMatch(await text(p, '#player-list'), /sh1t/i);
  await p.context().close();
});

test('everyone ready starts the race; latecomers can pick whom to watch; emotes', async () => {
  const eve = await newPlayer(browser, 'Eve');
  const code = await createRoom(eve, { isPublic: false, testStage: 990 });
  await drawWheel(eve);
  const fay = await newPlayer(browser, 'Fay');
  await joinByLink(fay, code, 990);
  await drawWheel(fay);

  // One of two ready: nothing starts yet.
  await eve.click('#ready-btn');
  await waitForText(fay, '#lobby-status', /1 of 2 ready/);
  assert.match(await text(fay, '#player-list'), /ready/i);

  // Both ready: the race starts by itself.
  await fay.click('#ready-btn');
  await fay.waitForFunction(() => window.drr.state.racing, undefined, { timeout: 5000 });

  // Gus joins mid-race and watches; he can switch whom the camera follows.
  const gus = await newPlayer(browser, 'Gus');
  await joinByLink(gus, code, 990);
  await waitForText(gus, '#follow-btn', /Watching the leader/i, 10000);
  await gus.click('#follow-btn');
  await waitForText(gus, '#follow-btn', /Watching (Eve|Fay)/i);

  // Back in the lobby, an emote reaches the others.
  await waitForText(eve, '#results-box', /Last race/i, 60000);
  await gus.click('#emote-bar button:first-child');
  await eve.waitForFunction(() => /Gus 👋/.test(document.getElementById('toast')?.textContent ?? ''), undefined, { timeout: 5000 });

  [eve, fay, gus].forEach((p) => assert.deepEqual(p.errors, []));
  await Promise.all([eve, fay, gus].map((p) => p.context().close()));
});
