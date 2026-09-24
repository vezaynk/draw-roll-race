// Players and passkeys: the server only shows hashes of player IDs. One button, "Save with a
// passkey": with no passkey yet it makes one (claiming the player); with an existing passkey it
// makes this device that passkey's player (remapping the device's own player into it). Logging
// out forgets everything on the device.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, CDPSession, Page } from 'playwright';
import buildCourse from '../../src/shared/course/build';
import { dailyStage } from '../../src/shared/course/stages';
import { playerHash } from '../../src/shared/identity';
import botRun from '../support/bot';
import { BASE, launch, waitForText } from './helpers';

// Passkeys need a domain name, not an IP address.
const SITE = BASE.replace('127.0.0.1', 'localhost');

const browser = await launch();
after(() => browser.close());

interface Device {
  page: Page;
  cdp: CDPSession;
  authenticatorId: string;
}

/** A browser with a simulated passkey authenticator (like a phone's or laptop's). */
async function device(b: Browser, name: string): Promise<Device> {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((n) => {
    if (!localStorage.getItem('draw-roll-race-name')) localStorage.setItem('draw-roll-race-name', n);
  }, name);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.goto(SITE);
  // The account block appears once the page has checked in with the server.
  await page.waitForFunction(() => !document.getElementById('account')?.hidden);
  return { page, cdp, authenticatorId };
}

const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('draw-roll-race') ?? '{}') as {
  player?: string; playerHash?: string; signedIn?: boolean;
});

/** Posts a real daily run from inside the page (with its cookies), as the page's player. */
async function postRun(page: Page, day: string): Promise<{ status: number; body: string }> {
  const run = botRun(buildCourse(dailyStage(day)));
  return page.evaluate(async ({ d, inputs, time }) => {
    const me = JSON.parse(localStorage.getItem('draw-roll-race') ?? '{}');
    const res = await fetch('/api/daily', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        day: d, player: me.player, name: localStorage.getItem('draw-roll-race-name'), time, inputs,
      }),
    });
    return { status: res.status, body: await res.text() };
  }, { d: day, inputs: run.inputs, time: run.time });
}

async function openAccount(page: Page): Promise<void> {
  await page.click('#menu-btn');
  await page.waitForSelector('#account', { state: 'visible' });
}

test('passkeys: one button saves a new player or brings back an existing one; log out', async () => {
  const { day } = await (await fetch(`${BASE}api/daily`)).json() as { day: string };
  const yesterday = new Date(Date.parse(`${day}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

  // Device A plays today's daily course, then saves its player with a passkey.
  const a = await device(browser, 'Ana');
  const ana = await saved(a.page);
  assert.match(ana.player ?? '', /^[0-9a-f-]{36}$/, 'new players get a UUID');
  const anaHash = await playerHash(ana.player ?? '');
  assert.equal((await postRun(a.page, day)).status, 200);

  // Leaderboards show hashes, never player IDs.
  const board = await (await fetch(`${BASE}api/daily?day=${day}&hash=${anaHash}`)).text();
  const leader = await (await fetch(`${BASE}api/daily/leader?day=${day}`)).text();
  assert.ok(!board.includes(ana.player ?? '-') && !leader.includes(ana.player ?? '-'), 'no raw player IDs');
  const parsed = JSON.parse(board) as { top: { hash: string }[]; you: unknown };
  assert.ok(parsed.top.every((r) => /^[0-9a-f]{32}$/.test(r.hash)), 'rows carry hashes');
  assert.ok(parsed.you, 'finds your own entry by hash');

  // No passkey exists yet, so the button makes one.
  await openAccount(a.page);
  await a.page.click('#passkey-save');
  await waitForText(a.page, '#account-status', /saved with a passkey/i, 15000);
  assert.match(await a.page.locator('#account-note').innerText(), /now has a passkey/i);
  assert.equal((await saved(a.page)).signedIn, true);

  // Now the ID alone is no longer enough to post as Ana.
  const run = botRun(buildCourse(dailyStage(day)));
  const sneaky = await fetch(`${BASE}api/daily`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      day, player: ana.player, name: 'Imposter', time: run.time, inputs: run.inputs,
    }),
  });
  assert.equal(sneaky.status, 401);
  // Signed in, Ana can still post.
  assert.equal((await postRun(a.page, day)).status, 200);

  // Device B has its own anonymous player with a run from yesterday.
  const b = await device(browser, 'Bo');
  const bo = await saved(b.page);
  assert.notEqual(bo.player, ana.player);
  const boRun = await postRun(b.page, yesterday);
  assert.equal(boRun.status, 200);
  const boTime = (JSON.parse(boRun.body) as { time: number }).time;

  // The passkey syncs to device B (as it would through a password manager). The same button
  // there uses it: B becomes Ana's player, and B's run from yesterday is remapped to her.
  const { credentials } = await a.cdp.send('WebAuthn.getCredentials', { authenticatorId: a.authenticatorId });
  await b.cdp.send('WebAuthn.addCredential', { authenticatorId: b.authenticatorId, credential: credentials[0] });
  await openAccount(b.page);
  assert.equal(await b.page.locator('#passkey-signin').count(), 0, 'no separate sign-in button');
  await b.page.click('#passkey-save');
  await waitForText(b.page, '#account-status', /saved with a passkey/i, 15000);
  assert.match(await b.page.locator('#account-note').innerText(), /playing as Ana again/i);
  const onB = await saved(b.page);
  assert.equal(onB.player, ana.player, 'same player on the second device');
  assert.equal(onB.playerHash, anaHash);
  const moved = await (await fetch(`${BASE}api/daily?day=${yesterday}&hash=${anaHash}`)).json() as {
    you: { time: number } | null;
  };
  assert.equal(moved.you?.time, boTime, 'the anonymous run moved to the signed-in player');

  // More passkeys can point at the same player: B adds its own with one tap while signed in.
  const bOwn = await b.cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2', transport: 'usb', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
    },
  });
  await b.cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: b.authenticatorId });
  await b.page.click('#passkey-add');
  await waitForText(b.page, '#account-note', /added another passkey/i, 10000);
  const { credentials: added } = await b.cdp.send('WebAuthn.getCredentials', { authenticatorId: bOwn.authenticatorId });
  assert.equal(added.length, 1, 'a second passkey was created');
  const meB = await b.page.evaluate(async () => (await fetch('/api/auth/me')).json()) as { passkeys: number; player: string };
  assert.equal(meB.passkeys, 2);
  assert.equal(meB.player, ana.player);

  // Logging out forgets everything on the device; it starts again as a new player.
  await Promise.all([b.page.waitForEvent('load'), b.page.click('#logout-btn')]);
  await b.page.waitForFunction(() => !!localStorage.getItem('draw-roll-race'));
  const after = await saved(b.page);
  assert.notEqual(after.player, ana.player);
  assert.ok(!after.signedIn);
  const me = await b.page.evaluate(async () => (await fetch('/api/auth/me')).json()) as { signedIn: boolean };
  assert.equal(me.signedIn, false);

  await a.page.context().close();
  await b.page.context().close();
});

test('after a daily run, "Save your score" saves the player with a passkey', async () => {
  const { day, stage } = await (await fetch(`${BASE}api/daily`)).json() as { day: string; stage: number };
  const c = await device(browser, 'Cy');
  const cy = await saved(c.page);
  const run = botRun(buildCourse(stage));
  // Show the results card for a daily run (as the game does when you cross the line).
  await c.page.evaluate(async ({ d, time, inputs }) => {
    document.getElementById('result')!.hidden = false;
    await window.drr.submitDaily(d, time, {
      samples: [], limbs: [], inputs, lastT: 0,
    });
  }, { d: day, time: run.time, inputs: run.inputs });
  await c.page.waitForSelector('#save-score', { state: 'visible' });
  await c.page.click('#save-score');
  await c.page.waitForSelector('#save-score', { state: 'hidden', timeout: 15000 });
  assert.match(await c.page.locator('#lb-note').innerText(), /now has a passkey/i);
  const after = await saved(c.page);
  assert.equal(after.signedIn, true);
  assert.equal(after.player, cy.player, 'a new passkey keeps this device’s player');
  await c.page.context().close();
});
