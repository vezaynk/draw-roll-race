// Progress and options saved in the browser. Storage can be missing or blocked (private
// windows), so every access is wrapped and the game works without it.
import { TUTORIAL } from '../shared/course/stages';
import type { Difficulty } from '../shared/cpu/personality';
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
  cpuCount: number;
  cpuDifficulty: Difficulty | 'mixed';
  sound: boolean;
  vibrate: boolean;
  ghost: boolean;
  pad: PadSize;
  seenTips: Partial<Record<SectionType, boolean>>;
  tutorialDone: boolean;
  /** Anonymous id for the daily leaderboard. */
  player: string;
}

const DEFAULTS: SaveData = {
  stage: 0,
  unlocked: 0,
  best: {},
  cpuCount: 1,
  cpuDifficulty: 'normal',
  sound: true,
  vibrate: true,
  ghost: true,
  pad: 'normal',
  seenTips: {},
  tutorialDone: false,
  player: '',
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
  if (!data.player) data.player = randomId();
  // For new players, the tutorial comes first in the stage list (the game opens on the daily
  // course; see main.ts).
  if (!stored) data.stage = TUTORIAL;
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
