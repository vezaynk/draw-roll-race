// Shared helpers for the browser tests.
import { chromium } from 'playwright';

export const BASE = process.env.E2E_BASE || 'http://127.0.0.1:8799/';

export async function launch() {
  return chromium.launch();
}

// A browser context with its own storage (so each "player" is a different person).
export async function newPlayer(browser, name, viewport = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(n => { try { localStorage.setItem('draw-roll-race-name', n); } catch (e) {} }, name);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') page.errors.push(m.text()); });
  return page;
}

async function padPoint(page) {
  const box = await page.locator('#pad').boundingBox();
  return (x, y) => [box.x + x * box.width / 320, box.y + y * box.height / 200];
}

// A half circle from the hip: becomes a wheel.
export async function drawWheel(page, r = 40) {
  const P = await padPoint(page);
  await page.mouse.move(...P(160, 120)); await page.mouse.down();
  for (let i = 0; i <= 16; i++) {
    const a = i / 16 * Math.PI;
    await page.mouse.move(...P(160 + r * Math.cos(a), 120 + r * Math.sin(a)), { steps: 2 });
  }
  await page.mouse.up();
}

// Down and forward from the hip: becomes a four-spoke cross.
export async function drawSpokes(page, len = 76) {
  const P = await padPoint(page);
  await page.mouse.move(...P(160, 120)); await page.mouse.down();
  await page.mouse.move(...P(160, 120 + len), { steps: 8 });
  await page.mouse.move(...P(160, 120), { steps: 8 });
  await page.mouse.move(...P(160 + len, 120), { steps: 8 });
  await page.mouse.up();
}

// Visible text of an element (empty if it or a parent is hidden).
export function text(page, selector) {
  return page.evaluate(s => {
    const el = document.querySelector(s);
    return !el || el.closest('[hidden]') ? '' : el.innerText.replace(/\n+/g, ' | ');
  }, selector);
}

export function waitForText(page, selector, re, timeout = 60000) {
  return page.waitForFunction(([s, src, flags]) => {
    const el = document.querySelector(s);
    return el && !el.closest('[hidden]') && new RegExp(src, flags).test(el.innerText);
  }, [selector, re.source, re.flags], { timeout });
}

// Create a room through the Online menu. Returns its code.
export async function createRoom(page, { name = '', isPublic = true, testStage } = {}) {
  await page.goto(BASE + (testStage !== undefined ? '?teststage=' + testStage : ''));
  await page.waitForSelector('#online-btn:not([hidden])');
  await page.click('#online-btn');
  if (name) await page.fill('#new-room-name', name);
  await page.check(`input[name="visibility"][value="${isPublic ? 'public' : 'private'}"]`);
  await page.click('#create-btn');
  await page.waitForFunction(() => /room=/.test(location.search) && document.getElementById('racer-count').textContent);
  return page.evaluate(() => new URLSearchParams(location.search).get('room'));
}

export async function joinByLink(page, code, testStage) {
  await page.goto(BASE + '?room=' + code + (testStage !== undefined ? '&teststage=' + testStage : ''));
  await page.waitForFunction(() => /racers/.test(document.getElementById('racer-count').textContent));
}
