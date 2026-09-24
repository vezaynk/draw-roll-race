// Other racers in a room (people and CPUs): their positions arrive ~15 times a second and are
// drawn RENDER_DELAY_MS in the past, blended between the two updates around that moment.
import { decodeLimbs } from '../../shared/limbs';
import { POSES } from '../../shared/poses';
import type { EncodedLimbs, Point, Runner } from '../../shared/types';
import { createRunner } from '../../shared/runner';
import { el } from '../dom';
import {
  drawBubble, drawLabels, drawRunner, labelSpot,
} from '../render/draw';

const RENDER_DELAY_MS = 120;
const MAX_SAMPLES = 40;

export interface Pose2D extends Point {
  a: number;
  b: number;
}

interface Sample extends Pose2D {
  t: number;
}

export interface RemoteRacer {
  id: string;
  name: string;
  color: string;
  limbs: EncodedLimbs | null;
  runner: Runner | null;
  samples: Sample[];
  /** CPUs only. */
  difficulty?: string;
}

interface RacerInfo {
  id: string;
  name: string;
  color: string;
  limbs?: EncodedLimbs | null;
}

export function newRacer(info: RacerInfo): RemoteRacer {
  return {
    id: info.id,
    name: info.name,
    color: info.color,
    limbs: info.limbs ?? null,
    runner: null,
    samples: [],
  };
}

export function pushSample(racer: RemoteRacer, x: number, y: number, a: number, b: number): void {
  racer.samples.push({
    t: performance.now(), x, y, a, b,
  });
  const extra = racer.samples.length - MAX_SAMPLES;
  if (extra > 0) racer.samples.splice(0, extra);
}

/** Where the racer was RENDER_DELAY_MS ago, or null if nothing has arrived. */
export function sample(racer: RemoteRacer): Pose2D | null {
  const s = racer.samples;
  if (!s.length) return null;
  const t = performance.now() - RENDER_DELAY_MS;
  if (t <= s[0].t) return s[0];
  const i = s.findIndex((b, k) => k > 0 && t >= s[k - 1].t && t <= b.t);
  if (i < 0) return s[s.length - 1];
  const a = s[i - 1];
  const b = s[i];
  const k = (t - a.t) / (b.t - a.t || 1);
  return {
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k,
    a: a.a + (b.a - a.a) * k,
    b: a.b + (b.b - a.b) * k,
  };
}

/** The racer's runner with its current limbs, posed at p. */
export function posedRunner(racer: RemoteRacer, p: Pose2D): Runner {
  if (!racer.runner) {
    racer.runner = createRunner(racer.limbs ? decodeLimbs(racer.limbs) : POSES.wheel, racer.color);
  }
  const { runner } = racer;
  runner.x = p.x;
  runner.y = p.y;
  runner.joints[0].angle = p.a;
  runner.joints[1].angle = p.b;
  return runner;
}

export interface Visible {
  racer: RemoteRacer;
  pose: Pose2D;
}

/** Racers that have sent positions. */
export function visibleRacers(racers: Iterable<RemoteRacer>): Visible[] {
  return [...racers]
    .map((racer) => ({ racer, pose: sample(racer) }))
    .filter((v): v is Visible => v.pose !== null);
}

/** Draws racers with their names, and a bubble over anyone who just sent an emote. */
export function drawRacers(
  g: CanvasRenderingContext2D,
  visible: Visible[],
  emoteOf: (id: string) => string | null,
): void {
  const labels = visible.map(({ racer, pose }) => {
    const runner = posedRunner(racer, pose);
    drawRunner(g, runner, 0.8);
    return { text: racer.name, color: racer.color, ...labelSpot(runner) };
  });
  drawLabels(g, labels);
  visible.forEach(({ racer }, i) => {
    const emote = emoteOf(racer.id);
    if (emote) drawBubble(g, labels[i], emote);
  });
}

const dots = new Map<string, HTMLElement>();

/** A dot per racer on the progress bar. */
export function updateDots(
  progress: HTMLElement,
  visible: Visible[],
  at: (x: number) => string,
): void {
  const seen = new Set<string>();
  visible.forEach(({ racer, pose }) => {
    seen.add(racer.id);
    let dot = dots.get(racer.id);
    if (!dot || !dot.isConnected) {
      dot = el('div', 'dot remote');
      progress.append(dot);
      dots.set(racer.id, dot);
    }
    dot.style.background = racer.color;
    dot.style.left = at(pose.x);
  });
  [...dots].filter(([id]) => !seen.has(id)).forEach(([id, dot]) => {
    dot.remove();
    dots.delete(id);
  });
}
