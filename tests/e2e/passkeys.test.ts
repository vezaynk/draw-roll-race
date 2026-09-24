// Players and passkeys: the server only shows hashes of player IDs; saving a player with a
// passkey claims it; signing in with that passkey elsewhere brings the same player (and moves
// that device's own daily scores over); logging out forgets everything on the device.
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

test('passkeys: save a player, sign in on another device, log out', async () => {
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

  await openAccount(a.page);
  await a.page.click('#passkey-save');
  await waitForText(a.page, '#account-status', /saved with a passkey/i, 10000);
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

  // The passkey syncs to device B (as it would through a password manager); signing in there
  // brings Ana's player, and B's run from yesterday moves over to her.
  const { credentials } = await a.cdp.send('WebAuthn.getCredentials', { authenticatorId: a.authenticatorId });
  await b.cdp.send('WebAuthn.addCredential', { authenticatorId: b.authenticatorId, credential: credentials[0] });
  await openAccount(b.page);
  await b.page.click('#passkey-signin');
  await waitForText(b.page, '#account-status', /saved with a passkey/i, 10000);
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
