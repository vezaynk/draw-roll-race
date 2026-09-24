import { hypot } from './fmath';
import type { Point, Stroke } from './types';

/** Points along a stroke, `spacing` apart (the first point is kept). */
export function resample(stroke: Stroke, spacing: number): Point[] {
  const out: Point[] = [{ x: stroke[0].x, y: stroke[0].y }];
  let need = spacing;
  for (let i = 1; i < stroke.length; i += 1) {
    let ax = stroke[i - 1].x;
    let ay = stroke[i - 1].y;
    const bx = stroke[i].x;
    const by = stroke[i].y;
    let segLen = hypot(bx - ax, by - ay);
    while (segLen >= need) {
      const k = need / segLen;
      ax += (bx - ax) * k;
      ay += (by - ay) * k;
      out.push({ x: ax, y: ay });
      segLen -= need;
      need = spacing;
    }
    need -= segLen;
  }
  return out;
}

/** A stroke rotated 180° around a point. */
export function rotateHalfTurn(stroke: Stroke, around: Point): Stroke {
  return stroke.map((p) => ({ x: 2 * around.x - p.x, y: 2 * around.y - p.y }));
}

export interface Nearest extends Point {
  /** Distance from the query point. */
  d: number;
}

/**
 * Nearest point to (px, py) on the polyline through heights h[] (sample i is at x = i × step),
 * searching the ten samples either side of px.
 */
export function nearestOnHeights(h: number[], step: number, px: number, py: number): Nearest {
  const i0 = Math.max(0, Math.min(h.length - 2, Math.floor(px / step)));
  let best = Infinity;
  let bx = px;
  let by = py;
  const lo = Math.max(0, i0 - 10);
  const hi = Math.min(h.length - 2, i0 + 10);
  for (let i = lo; i <= hi; i += 1) {
    const ax = i * step;
    const ay = h[i];
    const dx = step;
    const dy = h[i + 1] - ay;
    let u = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
    u = Math.max(0, Math.min(1, u));
    const qx = ax + dx * u;
    const qy = ay + dy * u;
    const d2 = (px - qx) * (px - qx) + (py - qy) * (py - qy);
    if (d2 < best) {
      best = d2;
      bx = qx;
      by = qy;
    }
  }
  return { x: bx, y: by, d: Math.sqrt(best) };
}

export const round1 = (v: number): number => Math.round(v * 10) / 10;
