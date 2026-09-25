// Fixed-step physics: gravity and zones, spinning limbs, water and mud, and impulse-based contacts
// with the ground and ceilings (friction, belts, bounce pads, spikes). A limb wedged between
// opposite surfaces with no room to turn shatters, like one that touches spikes.
import { CFG } from './config';
import {
  ceilAt, ceilingNearby, fluidAt, groundAt, surfAt, zoneAt,
} from './course/queries';
import { nearestOnHeights } from './geometry';
import { forEachPoint, unpressed } from './runner';
import type {
  Block, Course, Joint, Pressed, Runner, Surface,
} from './types';

interface Contact {
  px: number;
  py: number;
  nx: number;
  ny: number;
  pen: number;
}

/** Notes which way a contact pushes part of the runner. */
function press(pressed: Pressed, nx: number, ny: number): void {
  const p = pressed;
  if (ny < -0.5) p.up = true;
  if (ny > 0.5) p.down = true;
  if (nx > 0.5) p.right = true;
  if (nx < -0.5) p.left = true;
}

const reset = (pressed: Pressed) => Object.assign(pressed, unpressed());

/**
 * The limbs with no room left this step. The runner is squeezed when it is pushed from opposite
 * sides at once (floor and ceiling, or wall and wall). A limb squeezed on its own breaks.
 * Otherwise, when the runner as a whole is (say its arm is against a tunnel roof while its leg
 * stands on the floor), the limbs against the ceiling break, or, if only the torso is, the ones
 * holding it up; between walls, those against the wall ahead (or, failing that, behind).
 */
function crushedLimbs(body: Runner): Joint[] {
  const limbs = body.joints.filter((j) => j.active);
  const alone = limbs.filter(({ pressed: p }) => (p.up && p.down) || (p.left && p.right));
  if (alone.length) return alone;
  const parts = [body.pressed, ...limbs.map((j) => j.pressed)];
  const any = (side: keyof Pressed) => parts.some((p) => p[side]);
  const pushed = (side: keyof Pressed) => limbs.filter((j) => j.pressed[side]);
  const out = new Set<Joint>();
  const pick = (first: Joint[], second: Joint[]) => (first.length ? first : second).forEach((j) => out.add(j));
  if (any('up') && any('down')) pick(pushed('down'), pushed('up'));
  if (any('left') && any('right')) pick(pushed('left'), pushed('right'));
  return [...out];
}

/** Resolves one contact: normal impulse (with restitution), then friction, then separation. */
function applyImpulse(
  body: Runner,
  joint: Joint | null,
  c: Contact,
  surface: Surface | null,
): void {
  const {
    px, py, nx, ny, pen,
  } = c;
  if (pen >= CFG.CRUSH_PEN) press(joint ? joint.pressed : body.pressed, nx, ny);
  const rx = joint ? px - (body.x + joint.ox) : 0;
  const ry = joint ? py - (body.y + joint.oy) : 0;
  const invI = joint ? joint.invI : 0;
  let w = joint ? joint.w : 0;
  let ux = body.vx - w * ry;
  let uy = body.vy + w * rx;
  const vn = ux * nx + uy * ny;
  if (vn < 0) {
    const rn = rx * ny - ry * nx;
    const rest = surface && surface.bounce ? surface.bounce : CFG.REST;
    const jn = (-(1 + rest) * vn) / (body.invM + rn * rn * invI);
    body.vx += jn * nx * body.invM;
    body.vy += jn * ny * body.invM;
    if (joint) joint.w += rn * jn * invI;

    const tx = -ny;
    const ty = nx;
    w = joint ? joint.w : 0;
    ux = body.vx - w * ry;
    uy = body.vy + w * rx;
    const belt = surface && surface.belt ? surface.belt : 0;
    const vt = (ux - belt) * tx + uy * ty;
    const rt = rx * ty - ry * tx;
    const lim = CFG.MU * (surface && surface.mu ? surface.mu : 1) * jn;
    const jt = Math.max(-lim, Math.min(lim, -vt / (body.invM + rt * rt * invI)));
    body.vx += jt * tx * body.invM;
    body.vy += jt * ty * body.invM;
    if (joint) joint.w += rt * jt * invI;
  }
  const push = Math.min(pen, 6) * 0.4;
  body.x += nx * push;
  body.y += ny * push;
}

/** Contact of point (px, py) against the polyline h[], pushed out along normal (sign 1 or -1). */
function contactWith(
  h: number[],
  px: number,
  py: number,
  inside: boolean,
  defaultNy: number,
): Contact | null {
  const q = nearestOnHeights(h, CFG.STEP, px, py);
  const pen = inside ? q.d + CFG.R : CFG.R - q.d;
  if (pen <= 0) return null;
  let nx = 0;
  let ny = defaultNy;
  if (q.d > 1e-6) {
    const flip = inside ? -1 : 1;
    nx = ((px - q.x) / q.d) * flip;
    ny = ((py - q.y) / q.d) * flip;
  }
  return {
    px, py, nx, ny, pen,
  };
}

/**
 * Contact of a point with a floating block: pushed out of the nearest face, or away from the
 * nearest edge or corner. Nothing about blocks is special beyond this: whatever a limb's shape
 * catches on, it catches on.
 */
function contactWithBlock(b: Block, px: number, py: number): Contact | null {
  const { R } = CFG;
  const qx = Math.max(b.x0, Math.min(b.x1, px));
  const qy = Math.max(b.y0, Math.min(b.y1, py));
  const dx = px - qx;
  const dy = py - qy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= R * R) return null;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    return {
      px, py, nx: dx / d, ny: dy / d, pen: R - d,
    };
  }
  // The point's centre is inside: leave through the nearest face.
  const faces: [number, number, number][] = [
    [px - b.x0, -1, 0], [b.x1 - px, 1, 0], [py - b.y0, 0, -1], [b.y1 - py, 0, 1],
  ];
  const [depth, nx, ny] = faces.reduce((best, f) => (f[0] < best[0] ? f : best));
  return {
    px, py, nx, ny, pen: depth + R,
  };
}

function collideBlocks(course: Course, body: Runner, px: number, py: number, joint: Joint | null): void {
  const { R } = CFG;
  course.blocks.forEach((b) => {
    if (px + R <= b.x0 || px - R >= b.x1 || py + R <= b.y0 || py - R >= b.y1) return;
    const c = contactWithBlock(b, px, py);
    if (c) applyImpulse(body, joint, c, null);
  });
}

function collide(course: Course, body: Runner, px: number, py: number, joint: Joint | null): void {
  const { R, SPIKE_H } = CFG;
  // Ceilings (tunnels). The ceiling polyline jumps far up where there is none, which gives the
  // blocks solid side faces.
  const cy = ceilAt(course, px);
  if (py - R - 4 < cy || ceilingNearby(course, px)) {
    const c = contactWith(course.ceilLine, px, py, py < cy, 1);
    if (c) applyImpulse(body, joint, c, null);
    // Roof spikes hang SPIKE_H below the ceiling.
    if (joint && body.immune <= 0 && py - R < cy + SPIKE_H && zoneAt(course, px)?.roofSpikes) {
      body.hit[joint.kind] = true;
    }
  }
  if (course.blocks.length) collideBlocks(course, body, px, py, joint);
  const gy = groundAt(course, px);
  // Floor spikes stick up SPIKE_H above the ground: a limb point that low shatters.
  if (joint && body.immune <= 0 && py + R > gy - SPIKE_H && surfAt(course, px)?.spikes) {
    body.hit[joint.kind] = true;
  }
  if (py + R + 4 < gy) return;
  const c = contactWith(course.ground, px, py, py > gy, -1);
  if (c) applyImpulse(body, joint, c, surfAt(course, px));
}

/** Buoyancy and drag for every submerged point. Spinning limbs paddle through the fluid. */
function applyFluids(course: Course, body: Runner, dt: number): void {
  forEachPoint(body, (px, py, joint) => {
    const f = fluidAt(course, px);
    if (!f || py < f.level) return;
    const mud = f.kind === 'mud';
    const lift = mud ? CFG.MUD_LIFT : CFG.WATER_LIFT;
    body.vy -= ((CFG.G * lift) / body.nPts) * dt;
    const rx = joint ? px - (body.x + joint.ox) : 0;
    const ry = joint ? py - (body.y + joint.oy) : 0;
    const w = joint ? joint.w : 0;
    const k = (mud ? CFG.MUD_DRAG : CFG.WATER_DRAG) * dt;
    const fx = -k * (body.vx - w * ry);
    const fy = -k * (body.vy + w * rx);
    body.vx += fx * body.invM;
    body.vy += fy * body.invM;
    if (joint) joint.w += (rx * fy - ry * fx) * joint.invI;
  });
}

/** Advances a runner by dt seconds. Afterwards, body.hit says which limbs broke (spikes or crushed). */
export default function step(course: Course, body: Runner, dt: number): void {
  body.hit.arm = false;
  body.hit.leg = false;
  reset(body.pressed);
  if (body.immune > 0) body.immune -= dt;
  const zone = zoneAt(course, body.x);
  body.vy += CFG.G * (zone && zone.grav ? zone.grav : 1) * dt;
  if (zone && zone.wind) body.vx += zone.wind * dt;
  body.vx *= 1 - CFG.AIR * dt;

  const wmax = CFG.WMAX * body.speed;
  body.joints.forEach((joint) => {
    reset(joint.pressed);
    if (!joint.active) return;
    if (joint.w < wmax) {
      const accel = CFG.MOTOR * CFG.G * body.mass * joint.reach * joint.invI * dt;
      joint.w = Math.min(wmax, joint.w + accel);
    }
    joint.angle += joint.w * dt;
  });
  body.x += body.vx * dt;
  body.y += body.vy * dt;

  applyFluids(course, body, dt);
  forEachPoint(body, (px, py, joint) => collide(course, body, px, py, joint));

  // A limb wedged with no room to turn for long enough breaks: squeezed, and (almost) not
  // turning. Unlike spikes, a freshly drawn limb isn't spared: one that doesn't fit where it's
  // drawn can't turn at all.
  const crushed = crushedLimbs(body);
  body.joints.forEach((joint) => {
    const stuck = crushed.includes(joint) && Math.abs(joint.w) < CFG.CRUSH_SPIN * wmax;
    joint.crushed = stuck ? joint.crushed + dt : 0;
    if (joint.crushed >= CFG.CRUSH_TIME) body.hit[joint.kind] = true;
  });
}
