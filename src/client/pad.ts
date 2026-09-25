// The drawing pad: a stick figure template; strokes that start near the shoulder become arms,
// near the hip become legs. A double tap (or double click) clears the limb nearest to it.
import { FIG } from '../shared/config';
import { rotateHalfTurn } from '../shared/geometry';
import { normalizeStroke } from '../shared/limbs';
import type {
  LimbKind, Point, Stroke,
} from '../shared/types';
import { COLORS } from './colors';
import { byId } from './dom';
import { showHint } from './hud';
import { polyline } from './render/draw';
import drawHead from './render/look';
import { state } from './state';

let pad: HTMLCanvasElement;
let pctx: CanvasRenderingContext2D;
let stroke: Stroke | null = null;
/** The last tap (a stroke too short to draw), for spotting double taps. */
let lastTap: { at: number; p: Point } | null = null;

/** Two taps this close in time (ms) and space (pad units) are a double tap. */
const DOUBLE_TAP_MS = 400;
const DOUBLE_TAP_DIST = 30;

/** The joint a stroke starting at p attaches to. */
function jointFor(p: Point): { kind: LimbKind; joint: Point } {
  const dShoulder = Math.hypot(p.x - FIG.shoulder.x, p.y - FIG.shoulder.y);
  const dHip = Math.hypot(p.x - FIG.hip.x, p.y - FIG.hip.y);
  return dShoulder < dHip ? { kind: 'arm', joint: FIG.shoulder } : { kind: 'leg', joint: FIG.hip };
}

/** Distance from p to the nearest point of a drawn limb (either half of it). */
function distanceTo(p: Point, strokes: Stroke[], joint: Point): number {
  const points = strokes.flatMap((s) => [...s, ...rotateHalfTurn(s, joint)]);
  return Math.min(...points.map((q) => Math.hypot(p.x - q.x, p.y - q.y)));
}

/** The drawn limb nearest to p, or null if there are none. */
function nearestLimb(p: Point): LimbKind | null {
  const arm = state.limbs.arm.length ? distanceTo(p, state.limbs.arm, FIG.shoulder) : Infinity;
  const leg = state.limbs.leg.length ? distanceTo(p, state.limbs.leg, FIG.hip) : Infinity;
  if (arm === Infinity && leg === Infinity) return null;
  return arm < leg ? 'arm' : 'leg';
}

export function renderPad(): void {
  if (!pctx) return;
  pctx.clearRect(0, 0, pad.width, pad.height);
  pctx.lineCap = 'round';
  pctx.lineJoin = 'round';
  // A faint copy of the mirrored half, so players see the symmetry.
  pctx.strokeStyle = 'rgba(239,90,60,0.18)';
  pctx.lineWidth = 5;
  state.limbs.arm.forEach((s) => polyline(pctx, rotateHalfTurn(s, FIG.shoulder)));
  state.limbs.leg.forEach((s) => polyline(pctx, rotateHalfTurn(s, FIG.hip)));
  // The figure.
  pctx.strokeStyle = COLORS.ink;
  pctx.lineWidth = 4;
  polyline(pctx, [FIG.neck, FIG.hip]);
  drawHead(pctx, FIG.head.x, FIG.head.y, FIG.head.r, state.look, 4);
  // Limbs, and the stroke being drawn.
  pctx.strokeStyle = COLORS.player;
  pctx.lineWidth = 5;
  [...state.limbs.arm, ...state.limbs.leg].forEach((s) => polyline(pctx, s));
  if (stroke && stroke.length > 1) {
    pctx.globalAlpha = 0.55;
    polyline(pctx, stroke);
    pctx.globalAlpha = 1;
  }
  // Joints; while drawing, a ring marks the one the stroke will attach to.
  const target = stroke ? jointFor(stroke[0]).joint : null;
  [FIG.shoulder, FIG.hip].forEach((j) => {
    if (j === target) {
      pctx.beginPath();
      pctx.arc(j.x, j.y, 12, 0, Math.PI * 2);
      pctx.strokeStyle = COLORS.player;
      pctx.lineWidth = 2.5;
      pctx.stroke();
    }
    pctx.beginPath();
    pctx.arc(j.x, j.y, 6, 0, Math.PI * 2);
    pctx.fillStyle = COLORS.player;
    pctx.fill();
  });
}

function padPoint(e: PointerEvent): Point {
  const r = pad.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) * pad.width) / r.width,
    y: ((e.clientY - r.top) * pad.height) / r.height,
  };
}

/**
 * Sets up the pad. onDrawn is called after a limb is drawn, onCleared after a double tap clears
 * one (state.limbs already updated).
 */
export function initPad(onDrawn: () => void, onCleared: () => void): void {
  pad = byId<HTMLCanvasElement>('pad');
  pctx = pad.getContext('2d') as CanvasRenderingContext2D;

  pad.addEventListener('pointerdown', (e) => {
    if (!byId('result').hidden) return;
    stroke = [padPoint(e)];
    pad.setPointerCapture(e.pointerId);
    renderPad();
  });

  pad.addEventListener('pointermove', (e) => {
    if (!stroke) return;
    const p = padPoint(e);
    // Outside the pad, points are skipped; coming back joins with a straight line.
    if (p.x < 0 || p.y < 0 || p.x > pad.width || p.y > pad.height) return;
    const last = stroke[stroke.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) > 4) {
      stroke.push(p);
      renderPad();
    }
  });

  const endStroke = () => {
    if (!stroke) return;
    const s = stroke;
    stroke = null;
    if (s.length >= 3) {
      // Attach to the nearer joint, shifting the stroke so it starts there.
      const { kind, joint } = jointFor(s[0]);
      const dx = joint.x - s[0].x;
      const dy = joint.y - s[0].y;
      state.limbs[kind] = [normalizeStroke(s.map((p) => ({ x: p.x + dx, y: p.y + dy })))];
      onDrawn();
    } else {
      tapped(s[0]);
    }
    renderPad();
  };

  /** A tap: the second of two quick taps in the same place clears the nearest limb. */
  const tapped = (p: Point) => {
    const now = performance.now();
    const double = lastTap && now - lastTap.at < DOUBLE_TAP_MS
      && Math.hypot(p.x - lastTap.p.x, p.y - lastTap.p.y) < DOUBLE_TAP_DIST;
    lastTap = double ? null : { at: now, p };
    const kind = double ? nearestLimb(p) : null;
    if (kind) {
      state.limbs[kind] = [];
      onCleared();
    } else if (!double) {
      showHint('Drag to draw a line. Double-tap a limb to clear it.');
    }
  };
  pad.addEventListener('pointerup', endStroke);
  pad.addEventListener('pointercancel', endStroke);
  renderPad();
}
