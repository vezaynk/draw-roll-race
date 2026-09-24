// Ready-made limb shapes (pad coordinates; every stroke starts at its joint).
import { FIG } from './config';
import { cos, sin } from './fmath';
import type {
  Limbs, Point, Pose, Stroke,
} from './types';

/** Half circle from the joint around the bottom: mirrored, it becomes a wheel of radius r. */
export function halfRing(joint: Point, r: number): Stroke {
  const pts: Stroke = [{ x: joint.x, y: joint.y }];
  for (let i = 0; i <= 12; i += 1) {
    const a = (i / 12) * Math.PI;
    pts.push({ x: joint.x + cos(a) * r, y: joint.y + sin(a) * r });
  }
  return pts;
}

/** Hip → tip → hip → tip: mirrored, it becomes a four-spoke cross of length len. */
export function cross(len: number, tilt: number): Stroke {
  const j = FIG.hip;
  const c = cos(tilt);
  const s = sin(tilt);
  return [j, { x: j.x - s * len, y: j.y + c * len }, j, { x: j.x + c * len, y: j.y + s * len }];
}

/** A straight line of length len from the joint, pointing right. */
export function bar(joint: Point, len: number): Stroke {
  return [joint, { x: joint.x + len, y: joint.y }];
}

export const POSES: Record<Pose, Limbs> = {
  wheel: { arm: [halfRing(FIG.shoulder, 27)], leg: [halfRing(FIG.hip, 40)] },
  mini: { arm: [halfRing(FIG.shoulder, 18)], leg: [halfRing(FIG.hip, 24)] },
  stilts: {
    arm: [],
    leg: [[
      FIG.hip, { x: FIG.hip.x, y: FIG.hip.y + 76 }, FIG.hip, { x: FIG.hip.x + 76, y: FIG.hip.y },
    ]],
  },
  climber: { arm: [bar(FIG.shoulder, 100)], leg: [halfRing(FIG.hip, 24)] },
};
