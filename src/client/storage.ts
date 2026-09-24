// Progress and options saved in the browser. Storage can be missing or blocked (private
// windows), so every access is wrapped and the game works without it.
import { TUTORIAL } from '../shared/course/stages';
import { playerHash } from '../shared/identity';
import { DEFAULT_LOOK, sanitizeLook } from '../shared/look';
import type { Look } from '../shared/look';
import type { SectionType } from '../shared/types';
import { randomId } from './dom';

const SAVE_KEY = 'draw-roll-race';
const NAME_KEY = 'draw-roll-race-name';

export type PadSize = 'small' | 'normal' | 'large';

export interface SaveData {
  stage: number;
  /** The furthest fixed/endless stage unlocked. */
  unlocked: number;
  /** Best times by course key (stage number, or "daily:<day>"). */
  best: Record<string, number>;
  sound: boolean;
  vibrate: boolean;
  ghost: boolean;
  pad: PadSize;
  seenTips: Partial<Record<SectionType, boolean>>;
  tutorialDone: boolean;
  /**
   * This player's secret ID. The server never shows it to anyone; leaderboards show its hash.
   * Once saved with a passkey, signing in with the passkey on another device brings it there.
   */
  player: string;
  /** The public hash of `player` (cached; see shared/identity.ts). */
  playerHash: string;
  /** Signed in with a passkey on this device. */
  signedIn: boolean;
  /** How your runner looks (hair, hat, eyes, glasses). */
  look: Look;
}

const DEFAULTS: SaveData = {
  stage: 0,
  unlocked: 0,
  best: {},
  sound: true,
  vibrate: true,
  ghost: true,
  pad: 'normal',
  seenTips: {},
  tutorialDone: false,
  player: '',
  playerHash: '',
  signedIn: false,
  look: DEFAULT_LOOK,
};

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked
  }
}

function load(): { data: SaveData; firstVisit: boolean } {
  const stored = readJson<Partial<SaveData> | null>(SAVE_KEY, null);
  const data: SaveData = { ...DEFAULTS, ...stored };
  data.look = sanitizeLook(data.look);
  const newId = !data.player;
  if (newId) data.player = crypto.randomUUID?.() ?? randomId();
  // For new players, the tutorial comes first in the stage list (the game opens on the daily
  // course; see main.ts).
  if (!stored) data.stage = TUTORIAL;
  // A new ID is kept at once, so a reload before anything else is saved keeps the same player.
  if (newId) writeJson(SAVE_KEY, data);
  return { data, firstVisit: !stored };
}

const loaded = load();

export const save = loaded.data;
export const { firstVisit } = loaded;

export function persist(): void {
  writeJson(SAVE_KEY, save);
}

export function playerName(): string {
  try {
    return localStorage.getItem(NAME_KEY) || '';
  } catch {
    return '';
  }
}

export function setPlayerName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // storage blocked
  }
}

/** The public hash of this player's ID (computed once, then kept with the save). */
export async function myHash(): Promise<string> {
  if (!save.playerHash) {
    save.playerHash = await playerHash(save.player);
    persist();
  }
  return save.playerHash;
}

/** Becomes another player (after signing in with a passkey). */
export function becomePlayer(id: string, hash: string, name: string): void {
  save.player = id;
  save.playerHash = hash;
  save.signedIn = true;
  persist();
  if (name) setPlayerName(name);
}

/** Forgets everything this game saved in the browser (logging out). */
export function forgetEverything(): void {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(SAVE_KEY)).forEach((k) => localStorage.removeItem(k));
    Object.keys(sessionStorage).filter((k) => k.startsWith(SAVE_KEY)).forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // storage blocked
  }
}
