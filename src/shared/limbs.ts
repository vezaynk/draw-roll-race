import { resample } from './geometry';
import type {
  EncodedLimbs, LimbKind, Limbs, Stroke,
} from './types';

export const LIMB_KINDS: readonly LimbKind[] = ['arm', 'leg'];

/** Points kept per stroke on the wire. */
const MAX_POINTS = 120;

export function emptyLimbs(): Limbs {
  return { arm: [], leg: [] };
}

export function hasLimbs(limbs: Limbs | EncodedLimbs | null | undefined): boolean {
  return !!limbs && (limbs.arm.length > 0 || limbs.leg.length > 0);
}

function encodeStroke(stroke: Stroke): number[] {
  const pts = resample(stroke, 6);
  pts.push(stroke[stroke.length - 1]);
  return pts.slice(0, MAX_POINTS).flatMap((p) => [Math.round(p.x), Math.round(p.y)]);
}

function decodeStroke(flat: number[]): Stroke {
  const stroke: Stroke = [];
  for (let i = 0; i + 1 < flat.length; i += 2) stroke.push({ x: flat[i], y: flat[i + 1] });
  return stroke;
}

/** Limbs for the network: each stroke becomes a flat [x0, y0, x1, y1, ...] array. */
export function encodeLimbs(limbs: Limbs): EncodedLimbs {
  return { arm: limbs.arm.map(encodeStroke), leg: limbs.leg.map(encodeStroke) };
}

/**
 * A drawn stroke as the game plays it: points about 6 apart, whole numbers, inside the range the
 * server accepts. The pad stores strokes this way, so packLimbs() can describe them exactly.
 */
export function normalizeStroke(stroke: Stroke): Stroke {
  const clamp = (n: number) => Math.max(-199, Math.min(599, n));
  return decodeStroke(encodeStroke(stroke).map(clamp));
}

/** Limbs exactly as they are, for replays (no resampling, unlike encodeLimbs). */
export function packLimbs(limbs: Limbs): EncodedLimbs {
  const pack = (s: Stroke) => s.flatMap((p) => [p.x, p.y]);
  return { arm: limbs.arm.map(pack), leg: limbs.leg.map(pack) };
}

export function decodeLimbs(limbs: EncodedLimbs | null | undefined): Limbs {
  if (!limbs) return emptyLimbs();
  const decode = (strokes: number[][] = []) => strokes
    .map(decodeStroke)
    .filter((s) => s.length > 1);
  return { arm: decode(limbs.arm), leg: decode(limbs.leg) };
}

/**
 * Validates limbs received over the network: at most one stroke per joint, a sane number of
 * points, coordinates near the pad. Returns cleaned limbs, or null if they are not acceptable.
 */
export function sanitizeLimbs(value: unknown): EncodedLimbs | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const clean = (strokes: unknown): number[][] | null => {
    if (!Array.isArray(strokes) || strokes.length > 1) return null;
    const ok = strokes.every((flat) => Array.isArray(flat)
      && flat.length >= 4 && flat.length <= MAX_POINTS * 2 && flat.length % 2 === 0
      && flat.every((n) => Number.isFinite(n) && n > -200 && n < 600));
    return ok ? (strokes as number[][]).map((flat) => flat.map((n) => Math.round(n))) : null;
  };
  const arm = clean(input.arm);
  const leg = clean(input.leg);
  return arm && leg ? { arm, leg } : null;
}
