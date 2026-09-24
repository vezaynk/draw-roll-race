// Recording runs, and replaying your best run on a course as a see-through "ghost". Only your
// own runs come back as ghosts; other players' runs are never shown.
import { round1 } from '../shared/geometry';
import { decodeLimbs, encodeLimbs, packLimbs } from '../shared/limbs';
import type { RunInput } from '../shared/replay';
import { createRunner } from '../shared/runner';
import type {
  EncodedLimbs, Limbs, Runner,
} from '../shared/types';
import { GHOST_COLOR } from './colors';
import { drawLabels, drawRunner, labelSpot } from './render/draw';
import { readJson, writeJson } from './storage';

const STORAGE_KEY = 'draw-roll-race-ghosts';
/** Courses kept, most recent first, so storage stays small. */
const MAX_GHOSTS = 12;
const SAMPLE_EVERY = 0.1;

/** [t, x, y, arm angle, leg angle] */
export type Sample = [number, number, number, number, number];

export interface Recording {
  samples: Sample[];
  /** [t, limbs from then on] */
  limbs: [number, EncodedLimbs][];
  /** What was drawn at which physics step, so the server can replay the run. */
  inputs: RunInput[];
  lastT: number;
}

interface StoredGhost {
  time: number;
  samples: Sample[];
  limbs: [number, EncodedLimbs][];
  savedAt: number;
}

export interface Ghost extends StoredGhost {
  /** Shown above it while racing. */
  label: string;
  runner: Runner | null;
  limbsAt: number;
  cursor: number;
}

export function startRecording(body: Runner, limbs: Limbs): Recording {
  return {
    samples: [[0, round1(body.x), round1(body.y), 0, 0]],
    limbs: [[0, encodeLimbs(limbs)]],
    inputs: [[0, packLimbs(limbs)]],
    lastT: 0,
  };
}

/** Keeps a sample every SAMPLE_EVERY seconds. */
export function recordSample(recording: Recording, t: number, body: Runner): void {
  if (t - recording.lastT < SAMPLE_EVERY) return;
  recording.lastT = t;
  recording.samples.push([round1(t), round1(body.x), round1(body.y),
    round1(body.joints[0].angle), round1(body.joints[1].angle)]);
}

export function recordLimbs(rec: Recording, t: number, limbs: Limbs): void {
  rec.limbs.push([round1(t), encodeLimbs(limbs)]);
}

export function recordInput(rec: Recording, step: number, limbs: Limbs): void {
  rec.inputs.push([step, packLimbs(limbs)]);
}

function loadAll(): Record<string, StoredGhost> {
  return readJson<Record<string, StoredGhost>>(STORAGE_KEY, {});
}

export function loadGhost(key: string): Ghost | null {
  const stored = loadAll()[key];
  if (!stored || !stored.samples || stored.samples.length < 2) return null;
  return {
    ...stored, label: 'Your best', runner: null, limbsAt: -1, cursor: 1,
  };
}

export function saveGhost(key: string, rec: Recording, time: number, body: Runner): void {
  const all = loadAll();
  const samples: Sample[] = [...rec.samples, [round1(time), round1(body.x), round1(body.y), 0, 0]];
  all[key] = {
    time, samples, limbs: rec.limbs, savedAt: Date.now(),
  };
  Object.keys(all)
    .sort((a, b) => all[b].savedAt - all[a].savedAt)
    .slice(MAX_GHOSTS)
    .forEach((k) => delete all[k]);
  writeJson(STORAGE_KEY, all);
}

export interface GhostPose {
  x: number;
  y: number;
  a: number;
  b: number;
}

/** The ghost's position at time t, blended between samples, or null once it has finished. */
export function ghostAt(ghost: Ghost, t: number): GhostPose | null {
  const s = ghost.samples;
  if (t > s[s.length - 1][0]) return null;
  let i = s[ghost.cursor - 1]?.[0] > t ? 1 : ghost.cursor;
  while (i < s.length - 1 && s[i][0] < t) i += 1;
  ghost.cursor = i;
  const [ta, xa, ya, aa, ba] = s[i - 1];
  const [tb, xb, yb, ab, bb] = s[i];
  const k = tb > ta ? Math.max(0, Math.min(1, (t - ta) / (tb - ta))) : 1;
  return {
    x: xa + (xb - xa) * k, y: ya + (yb - ya) * k, a: aa + (ab - aa) * k, b: ba + (bb - ba) * k,
  };
}

/** Draws the ghost at time t with the limbs it had then. */
export function drawGhost(g: CanvasRenderingContext2D, ghost: Ghost, t: number): void {
  const pose = ghostAt(ghost, t);
  if (!pose) return;
  let current = 0;
  ghost.limbs.forEach(([at], i) => {
    if (at <= t) current = i;
  });
  if (current !== ghost.limbsAt || !ghost.runner) {
    ghost.limbsAt = current;
    ghost.runner = createRunner(decodeLimbs(ghost.limbs[current][1]), GHOST_COLOR);
  }
  const { runner } = ghost;
  runner.x = pose.x;
  runner.y = pose.y;
  runner.joints[0].angle = pose.a;
  runner.joints[1].angle = pose.b;
  drawRunner(g, runner, 0.4);
  drawLabels(g, [{ text: ghost.label, color: 'rgba(60,66,80,0.75)', ...labelSpot(runner) }]);
}
