// Drawing the course: ground, grass, obstacles, start and finish posts, water and mud.
import { CFG } from '../../shared/config';
import {
  ceilAt, fluidAt, groundAt, sampleRun, surfAt, zoneAt,
} from '../../shared/course/queries';
import type { Course, CourseSection } from '../../shared/types';
import { COLORS } from '../colors';

/** The visible part of the world. */
export interface View {
  x0: number;
  x1: number;
  /** Top of the view. */
  top: number;
  /** Height of the view. */
  height: number;
  /** Race clock, for animations. */
  time: number;
}

const visible = (s: CourseSection, v: View): boolean => s.to >= v.x0 && s.from <= v.x1;

function sampleRange(course: Course, v: View): [number, number] {
  return [
    Math.max(0, Math.floor(v.x0 / CFG.STEP)),
    Math.min(course.ground.length - 1, Math.ceil(v.x1 / CFG.STEP) + 1),
  ];
}

/** Ground, with scrolling stripes so speed is readable, and a grass edge. */
export function drawGround(g: CanvasRenderingContext2D, course: Course, v: View): void {
  const [i0, i1] = sampleRange(course, v);
  const bottom = v.top + v.height + 20;
  g.beginPath();
  g.moveTo(i0 * CFG.STEP, bottom);
  for (let i = i0; i <= i1; i += 1) g.lineTo(i * CFG.STEP, course.ground[i]);
  g.lineTo(i1 * CFG.STEP, bottom);
  g.closePath();
  g.fillStyle = COLORS.ground;
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = 'rgba(255,255,255,0.05)';
  for (let sx = Math.floor(v.x0 / 80) * 80; sx < v.x1; sx += 80) {
    g.fillRect(sx, v.top - 20, 40, v.height + 40);
  }
  g.restore();

  // Grass, except on special surfaces, water and steep drops.
  g.strokeStyle = '#7cc46a';
  g.lineWidth = 3;
  g.lineCap = 'round';
  g.beginPath();
  let pen = false;
  for (let i = i0; i <= i1; i += 1) {
    const special = course.surf[i] || course.fluid[i];
    const steep = i > 0 && Math.abs(course.ground[i] - course.ground[i - 1]) > 6;
    if (special || steep) {
      pen = false;
    } else if (!pen) {
      g.moveTo(i * CFG.STEP, course.ground[i] + 1);
      pen = true;
    } else {
      g.lineTo(i * CFG.STEP, course.ground[i] + 1);
    }
  }
  g.stroke();
}

/** A row of spikes: dir -1 points up from baseY(x), dir 1 hangs down from it. */
function spikeRow(
  g: CanvasRenderingContext2D,
  from: number,
  to: number,
  baseY: (x: number) => number,
  dir: 1 | -1,
) {
  const w = 8;
  g.fillStyle = '#c9ced8';
  g.strokeStyle = COLORS.ink;
  g.lineWidth = 1.5;
  g.lineJoin = 'miter';
  for (let x = from; x + w <= to + 0.1; x += w) {
    const y0 = baseY(x);
    const y1 = baseY(x + w);
    g.beginPath();
    g.moveTo(x, y0);
    g.lineTo(x + w / 2, (y0 + y1) / 2 + dir * CFG.SPIKE_H);
    g.lineTo(x + w, y1);
    g.closePath();
    g.fill();
    g.stroke();
  }
  g.lineJoin = 'round';
}

type Ctx = CanvasRenderingContext2D;
type SectionPainter = (g: Ctx, course: Course, s: CourseSection, v: View) => void;

function paintCeiling(g: Ctx, course: Course, s: CourseSection, v: View): void {
  const [a, b] = sampleRun(course, s.from, (i) => course.ceil[i] !== -Infinity);
  const cy = ceilAt(course, a + 1);
  g.fillStyle = COLORS.ground;
  g.fillRect(a, v.top - 20, b - a, cy - v.top + 20);
  if (s.type === 'spikeroof') {
    spikeRow(g, a, b, () => cy, 1);
    return;
  }
  g.fillStyle = '#f2c14e';
  for (let x = a; x < b; x += 24) g.fillRect(x, cy - 5, 12, 5);
}

const PAINTERS: Partial<Record<CourseSection['type'], SectionPainter>> = {
  ice(g, course, s) {
    g.strokeStyle = '#cdeefe';
    g.lineWidth = 6;
    g.lineCap = 'butt';
    g.beginPath();
    for (let x = s.from; x <= s.to; x += CFG.STEP) g.lineTo(x, groundAt(course, x) + 2);
    g.stroke();
  },
  conveyor(g, course, s, v) {
    const gy = groundAt(course, s.from + 1);
    g.fillStyle = '#4a5160';
    g.fillRect(s.from, gy, s.to - s.from, 8);
    g.strokeStyle = '#f2c14e';
    g.lineWidth = 2;
    g.lineCap = 'round';
    const belt = surfAt(course, s.from + 1)?.belt ?? 0;
    const off = (((v.time * -belt) % 22) + 22) % 22;
    for (let x = s.from + 22 - off; x < s.to - 4; x += 22) {
      g.beginPath();
      g.moveTo(x + 4, gy + 1.5);
      g.lineTo(x, gy + 4);
      g.lineTo(x + 4, gy + 6.5);
      g.stroke();
    }
  },
  spikepit(g, course, s) {
    const [a, b] = sampleRun(course, s.from, (i) => !!course.surf[i]?.spikes);
    spikeRow(g, a, b, (x) => groundAt(course, x), -1);
  },
  wind(g, course, s, v) {
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(s.from, v.top - 20, s.to - s.from, v.height + 40);
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineWidth = 1.5;
    g.lineCap = 'round';
    const force = -(zoneAt(course, s.from + 1)?.wind ?? 0);
    const span = s.to - s.from;
    for (let k = 0; k < 18; k += 1) {
      const x = s.to - ((((k * 97 + v.time * force * 0.9) % span) + span) % span);
      const y = groundAt(course, x) - 16 - ((k * 37) % 90);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + 26, y);
      g.stroke();
    }
  },
  lowgrav(g, course, s, v) {
    g.fillStyle = 'rgba(150,110,230,0.12)';
    g.fillRect(s.from, v.top - 20, s.to - s.from, v.height + 40);
    g.fillStyle = 'rgba(255,255,255,0.8)';
    for (let k = 0; k < 20; k += 1) {
      const x = s.from + ((k * 131) % (s.to - s.from));
      const y = groundAt(course, x) - 20 - ((k * 53 + v.time * 12) % 140);
      g.fillRect(x, y, 2, 2);
    }
  },
  bounce(g, course, s) {
    g.lineWidth = 5;
    g.lineCap = 'butt';
    for (let x = s.from; x < s.to; x += 12) {
      const x2 = Math.min(s.to, x + 12);
      g.strokeStyle = Math.floor((x - s.from) / 12) % 2 ? '#f2c14e' : COLORS.ink;
      g.beginPath();
      g.moveTo(x, groundAt(course, x) + 2.5);
      g.lineTo(x2, groundAt(course, x2) + 2.5);
      g.stroke();
    }
  },
  tunnel: paintCeiling,
  crawl: paintCeiling,
  spikeroof: paintCeiling,
};

export function drawObstacles(g: CanvasRenderingContext2D, course: Course, v: View): void {
  course.sections.filter((s) => visible(s, v)).forEach((s) => PAINTERS[s.type]?.(g, course, s, v));
}

export function drawPosts(g: CanvasRenderingContext2D, course: Course): void {
  [[course.startX, 'START'], [course.finishX, 'FINISH']].forEach(([gx, label]) => {
    const x = gx as number;
    const gy = groundAt(course, x);
    g.strokeStyle = COLORS.ink;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x, gy);
    g.lineTo(x, gy - 120);
    g.stroke();
    for (let r = 0; r < 4; r += 1) {
      for (let k = 0; k < 4; k += 1) {
        g.fillStyle = (r + k) % 2 ? '#fff' : COLORS.ink;
        g.fillRect(x + k * 7, gy - 120 + r * 7, 7, 7);
      }
    }
    g.fillStyle = COLORS.ink;
    g.font = 'bold 11px system-ui, sans-serif';
    g.fillText(label as string, x + 34, gy - 106);
  });
}

/** Water and mud, drawn over the runners. */
export function drawFluids(g: CanvasRenderingContext2D, course: Course, v: View): void {
  course.sections
    .filter((s) => (s.type === 'pool' || s.type === 'mud') && visible(s, v))
    .forEach((s) => {
      const level = fluidAt(course, s.from + 1)?.level ?? 0;
      const mud = s.type === 'mud';
      g.beginPath();
      g.moveTo(s.from, level);
      for (let x = s.from; x <= s.to; x += CFG.STEP) {
        g.lineTo(x, Math.max(level, groundAt(course, x)));
      }
      g.lineTo(s.to, level);
      g.closePath();
      g.fillStyle = mud ? 'rgba(115,78,44,0.85)' : 'rgba(60,150,230,0.5)';
      g.fill();
      g.strokeStyle = mud ? 'rgba(160,120,80,0.9)' : 'rgba(255,255,255,0.85)';
      g.lineWidth = 2;
      g.beginPath();
      for (let x = s.from; x <= s.to; x += 6) {
        g.lineTo(x, level + Math.sin(x / 14 + v.time * 4) * 1.2);
      }
      g.stroke();
    });
}
