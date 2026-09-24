import { CFG } from '../../shared/config';
import type { Point, Runner } from '../../shared/types';
import { COLORS } from '../colors';

export function polyline(g: CanvasRenderingContext2D, pts: readonly Point[]): void {
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].y);
  pts.slice(1).forEach((p) => g.lineTo(p.x, p.y));
  g.stroke();
}

/** A limb-thick line with an ink outline. */
export function limbLine(g: CanvasRenderingContext2D, pts: readonly Point[], color: string): void {
  g.strokeStyle = COLORS.ink;
  g.lineWidth = CFG.R * 2 + 3;
  polyline(g, pts);
  g.strokeStyle = color;
  g.lineWidth = CFG.R * 2;
  polyline(g, pts);
}

export function drawRunner(g: CanvasRenderingContext2D, body: Runner, alpha: number): void {
  g.save();
  g.globalAlpha = alpha;
  g.translate(body.x, body.y);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  limbLine(g, body.spine, body.color);
  const { head } = body;
  g.beginPath();
  g.arc(head.x, head.y, head.r, 0, Math.PI * 2);
  g.fillStyle = '#fff';
  g.fill();
  g.strokeStyle = COLORS.ink;
  g.lineWidth = 2.5;
  g.stroke();
  g.beginPath();
  g.arc(head.x + head.r * 0.4, head.y - head.r * 0.1, 1.7, 0, Math.PI * 2);
  g.fillStyle = COLORS.ink;
  g.fill();
  body.joints.forEach((j) => {
    g.save();
    g.translate(j.ox, j.oy);
    g.rotate(j.angle);
    j.lines.filter((ln) => ln.length > 1).forEach((ln) => limbLine(g, ln, body.color));
    g.restore();
  });
  g.restore();
}

export interface Label {
  text: string;
  color: string;
  x: number;
  y: number;
}

/** The point just above a runner's head, where its name goes. */
export function labelSpot(body: Runner): Point {
  return { x: body.x + body.head.x, y: body.y + body.head.y - body.head.r - 7 };
}

/** Name labels above runners; when racers bunch up, labels stack instead of overlapping. */
export function drawLabels(g: CanvasRenderingContext2D, labels: Label[]): void {
  g.save();
  g.font = 'bold 11px system-ui, sans-serif';
  g.textAlign = 'center';
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  const placed: { x: number; y: number; w: number }[] = [];
  [...labels].sort((a, b) => a.x - b.x).forEach((label) => {
    const w = g.measureText(label.text).width + 6;
    let { y } = label;
    const overlaps = () => placed.some((q) => Math.abs(q.x - label.x) < (q.w + w) / 2
      && Math.abs(q.y - y) < 12);
    for (let tries = 0; tries < 8 && overlaps(); tries += 1) y -= 12;
    placed.push({ x: label.x, y, w });
    g.strokeText(label.text, label.x, y);
    g.fillStyle = label.color;
    g.fillText(label.text, label.x, y);
  });
  g.restore();
}
