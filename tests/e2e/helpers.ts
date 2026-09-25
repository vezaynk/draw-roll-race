// Shared helpers for the browser tests.
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import type buildCourse from '../../src/shared/course/build';
import type { RunInput, RunReplay } from '../../src/shared/replay';
import type { Limbs, Runner, Course } from '../../src/shared/types';

/** What the game exposes on window for tests (see src/client/main.ts). */
declare global {
  interface Window {
    drr: {
      state: {
        limbs: Limbs;
        time: number;
        steps: number;
        finished: boolean;
        racing: boolean;
        ghosts: unknown[];
        cpu: unknown;
        look: Record<string, string>;
        stage: number;
        player: Runner | null;
        course: Course;
        recording: { inputs: RunInput[] } | null;
      };
      buildCourse: typeof buildCourse;
      RunReplay: typeof RunReplay;
      submitDaily: (day: string, time: number, rec: { samples: unknown[]; limbs: unknown[]; inputs: RunInput[]; lastT: number }) => Promise<void>;
      showResults: () => void;
    };
  }
}

export const BASE = process.env.E2E_BASE || 'http://127.0.0.1:8799/';

export type TestPage = Page & { errors: string[] };

let networks = 0;

/**
 * The browser for a test file. Each context it makes comes from its own network (the Worker's
 * per-network rate limits key on CF-Connecting-IP, which Cloudflare sets in production but a
 * local server takes from the request), so a whole suite of players doesn't share one limit.
 */
export async function launch(): Promise<Browser> {
  const browser = await chromium.launch();
  const newContext = browser.newContext.bind(browser);
  browser.newContext = (options = {}) => {
    networks += 1;
    const ip = `10.${process.pid % 250}.${Math.floor(networks / 250) % 250}.${networks % 250}`;
    return newContext({ ...options, extraHTTPHeaders: { 'CF-Connecting-IP': ip, ...options.extraHTTPHeaders } });
  };
  return browser;
}

/** A browser context with its own storage (so each "player" is a different person). */
export async function newPlayer(
  browser: Browser,
  name: string,
  viewport = { width: 390, height: 844 },
): Promise<TestPage> {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript((n) => {
    try {
      localStorage.setItem('draw-roll-race-name', n);
    } catch {
      // storage blocked
    }
  }, name);
  const page = await ctx.newPage() as TestPage;
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') page.errors.push(m.text());
  });
  return page;
}

async function padPoint(page: Page) {
  const box = await page.locator('#pad').boundingBox();
  if (!box) throw new Error('drawing pad not visible');
  return (x: number, y: number): [number, number] => [
    box.x + (x * box.width) / 320,
    box.y + (y * box.height) / 200,
  ];
}

/** A half circle from the hip: becomes a wheel. */
export async function drawWheel(page: Page, r = 40): Promise<void> {
  const at = await padPoint(page);
  await page.mouse.move(...at(160, 120));
  await page.mouse.down();
  for (let i = 0; i <= 16; i += 1) {
    const a = (i / 16) * Math.PI;
    // Sequential moves: each drag step depends on the last.
    await page.mouse.move(...at(160 + r * Math.cos(a), 120 + r * Math.sin(a)), { steps: 2 });
  }
  await page.mouse.up();
}

/** Down and forward from the hip: becomes a four-spoke cross. */
export async function drawSpokes(page: Page, len = 76): Promise<void> {
  const at = await padPoint(page);
  await page.mouse.move(...at(160, 120));
  await page.mouse.down();
  await page.mouse.move(...at(160, 120 + len), { steps: 8 });
  await page.mouse.move(...at(160, 120), { steps: 8 });
  await page.mouse.move(...at(160 + len, 120), { steps: 8 });
  await page.mouse.up();
}

/** A straight arm from the shoulder, pointing right. */
export async function drawArm(page: Page, len = 80): Promise<void> {
  const at = await padPoint(page);
  await page.mouse.move(...at(160, 68));
  await page.mouse.down();
  await page.mouse.move(...at(160 + len, 68), { steps: 10 });
  await page.mouse.up();
}

/** A double click on the pad at pad coordinates (x, y). */
export async function doubleTapPad(page: Page, x: number, y: number): Promise<void> {
  const at = await padPoint(page);
  await page.mouse.dblclick(...at(x, y));
}

/** Visible text of an element (empty if it or a parent is hidden). */
export function text(page: Page, selector: string): Promise<string> {
  return page.evaluate((s) => {
    const node = document.querySelector<HTMLElement>(s);
    return !node || node.closest('[hidden]') ? '' : node.innerText.replace(/\n+/g, ' | ');
  }, selector);
}

export async function waitForText(
  page: Page,
  selector: string,
  re: RegExp,
  timeout = 60000,
): Promise<void> {
  await page.waitForFunction(([s, source, flags]) => {
    const node = document.querySelector<HTMLElement>(s);
    return !!node && !node.closest('[hidden]') && new RegExp(source, flags).test(node.innerText);
  }, [selector, re.source, re.flags] as const, { timeout });
}

export interface RoomOptions {
  name?: string;
  isPublic?: boolean;
  testStage?: number;
}

/** Creates a room through the Online menu. Returns its code. */
export async function createRoom(page: Page, { name = '', isPublic = true, testStage }: RoomOptions = {}): Promise<string> {
  await page.goto(BASE + (testStage !== undefined ? `?teststage=${testStage}` : ''));
  await page.waitForSelector('#start-online:not([hidden])');
  await page.click('#start-online');
  if (name) await page.fill('#new-room-name', name);
  await page.check(`input[name="visibility"][value="${isPublic ? 'public' : 'private'}"]`);
  await page.click('#create-btn');
  await page.waitForFunction(() => /room=/.test(window.location.search)
    && !!document.getElementById('racer-count')?.textContent);
  return page.evaluate(() => new URLSearchParams(window.location.search).get('room') ?? '');
}

export async function joinByLink(page: Page, code: string, testStage?: number): Promise<void> {
  const stage = testStage !== undefined ? `&teststage=${testStage}` : '';
  await page.goto(`${BASE}?room=${code}${stage}`);
  await page.waitForFunction(() => /racers/.test(document.getElementById('racer-count')?.textContent ?? ''));
}

export const pause = (ms: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms);
});
