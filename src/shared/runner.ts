// The runner: a stick figure whose drawn limbs spin around the shoulder and hip.
import { CFG, FIG } from './config';
import { groundAt } from './course/queries';
import { cos, sin } from './fmath';
import { resample, rotateHalfTurn } from './geometry';
import type {
  Course, Joint, LimbKind, Limbs, Point, Pressed, Runner, Shattered, Stroke,
} from './types';

/** Each stroke plus a copy rotated 180° about its joint, so a half circle becomes a wheel. */
function withMirror(strokes: Stroke[], joint: Point): Stroke[] {
  return strokes.concat(strokes.map((s) => rotateHalfTurn(s, joint)));
}

function torsoOutline(): Point[] {
  const pts = resample([FIG.neck, FIG.hip], CFG.SPACING);
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2;
    pts.push({
      x: FIG.head.x + cos(a) * FIG.head.r,
      y: FIG.head.y + sin(a) * FIG.head.r,
    });
  }
  return pts;
}

export const unpressed = (): Pressed => ({
  up: false, down: false, left: false, right: false,
});

function makeJoint(kind: LimbKind, strokes: Stroke[], pivot: Point, offset: Point): Joint {
  const all = withMirror(strokes, pivot);
  const rel = (p: Point): Point => ({
    x: (p.x - pivot.x) * CFG.SCALE,
    y: (p.y - pivot.y) * CFG.SCALE,
  });
  const pts = all.flatMap((s) => resample(s, CFG.SPACING).map(rel));
  let inertia = 0;
  let reach = 0;
  pts.forEach((p) => {
    const r2 = p.x * p.x + p.y * p.y;
    inertia += r2;
    reach = Math.max(reach, Math.sqrt(r2));
  });
  inertia += pts.length * CFG.R * CFG.R * 0.5;
  return {
    kind,
    ox: offset.x,
    oy: offset.y,
    pts,
    lines: all.map((s) => s.map(rel)),
    angle: 0,
    w: 0,
    invI: pts.length ? 1 / inertia : 0,
    reach: reach + CFG.R,
    active: pts.length > 0,
    pressed: unpressed(),
    crushed: 0,
  };
}

export function createRunner(limbs: Limbs, color: string, speed = 1): Runner {
  const torsoPad = torsoOutline();
  const cx = torsoPad.reduce((sum, p) => sum + p.x, 0) / torsoPad.length;
  const cy = torsoPad.reduce((sum, p) => sum + p.y, 0) / torsoPad.length;
  const toBody = (p: Point): Point => ({ x: (p.x - cx) * CFG.SCALE, y: (p.y - cy) * CFG.SCALE });

  const torso = torsoPad.map(toBody);
  const joints: [Joint, Joint] = [
    makeJoint('arm', limbs.arm, FIG.shoulder, toBody(FIG.shoulder)),
    makeJoint('leg', limbs.leg, FIG.hip, toBody(FIG.hip)),
  ];
  const mass = torso.length + joints[0].pts.length + joints[1].pts.length;
  return {
    color,
    speed,
    torso,
    spine: [FIG.neck, FIG.shoulder, FIG.hip].map(toBody),
    head: { ...toBody(FIG.head), r: FIG.head.r * CFG.SCALE },
    joints,
    mass,
    invM: 1 / mass,
    nPts: mass,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    hit: { arm: false, leg: false },
    immune: 0,
    pressed: unpressed(),
  };
}

export type PointVisitor = (px: number, py: number, joint: Joint | null) => void;

/** Calls visit(worldX, worldY, joint or null for the torso) for every collision point. */
export function forEachPoint(body: Runner, visit: PointVisitor): void {
  body.torso.forEach((p) => visit(body.x + p.x, body.y + p.y, null));
  body.joints.forEach((j) => {
    if (!j.active) return;
    const c = cos(j.angle);
    const s = sin(j.angle);
    const ox = body.x + j.ox;
    const oy = body.y + j.oy;
    j.pts.forEach((p) => visit(ox + p.x * c - p.y * s, oy + p.x * s + p.y * c, j));
  });
}

/** Puts the runner at x, resting on the ground (never lower than maxY, if given). */
export function settle(course: Course, runner: Runner, x: number, maxY?: number): void {
  const saved = runner.y;
  runner.x = x;
  runner.y = 0;
  let y = Infinity;
  forEachPoint(runner, (px, py) => {
    y = Math.min(y, groundAt(course, px) - CFG.R - py - 1);
  });
  runner.y = maxY === undefined ? y : Math.min(maxY, y);
  if (!Number.isFinite(runner.y)) runner.y = saved;
}

/** The same runner with new limbs, keeping its motion. New limbs are briefly safe from spikes. */
export function swapLimbs(course: Course, old: Runner, limbs: Limbs): Runner {
  const b = createRunner(limbs, old.color, old.speed);
  b.vx = old.vx;
  b.vy = old.vy;
  b.joints.forEach((joint, i) => {
    joint.angle = old.joints[i].angle;
    joint.w = old.joints[i].w;
  });
  b.immune = CFG.IMMUNE;
  settle(course, b, old.x, old.y);
  return b;
}

/** Removes the limbs that broke (spikes, or crushed) during the last step, or returns null if none did. */
export function shatter(course: Course, runner: Runner, limbs: Limbs): Shattered | null {
  const lost = (['arm', 'leg'] as const).filter((k) => runner.hit[k] && limbs[k].length > 0);
  if (!lost.length) return null;
  const next: Limbs = {
    arm: runner.hit.arm ? [] : limbs.arm,
    leg: runner.hit.leg ? [] : limbs.leg,
  };
  const crushed = runner.joints.some((j) => lost.includes(j.kind) && j.crushed >= CFG.CRUSH_TIME);
  return {
    limbs: next, runner: swapLimbs(course, runner, next), lost, crushed,
  };
}
