// Pieces of shattered limbs, flying off and fading.
import { CFG } from '../../shared/config';
import type { LimbKind, Runner } from '../../shared/types';
import { COLORS } from '../colors';

interface Shard {
  x: number;
  y: number;
  len: number;
  ang: number;
  /** Spin (rad/s). */
  va: number;
  vx: number;
  vy: number;
  color: string;
  /** Seconds left. */
  life: number;
}

const MAX_SHARDS = 400;
const shards: Shard[] = [];
let lastTs = 0;

/** Breaks the given limbs of a runner into flying pieces. */
export function spawnShards(body: Runner, kinds: readonly LimbKind[]): void {
  body.joints.filter((j) => kinds.includes(j.kind)).forEach((j) => {
    const c = Math.cos(j.angle);
    const s = Math.sin(j.angle);
    const world = (p: { x: number; y: number }) => ({
      x: body.x + j.ox + p.x * c - p.y * s,
      y: body.y + j.oy + p.x * s + p.y * c,
    });
    j.lines.forEach((ln) => {
      for (let i = 1; i < ln.length; i += 2) {
        const a = world(ln[i - 1]);
        const b = world(ln[i]);
        shards.push({
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
          len: Math.hypot(b.x - a.x, b.y - a.y),
          ang: Math.atan2(b.y - a.y, b.x - a.x),
          va: (Math.random() - 0.5) * 16,
          vx: body.vx * 0.5 + (Math.random() - 0.5) * 260,
          vy: -120 - Math.random() * 220,
          color: body.color,
          life: 1.1,
        });
      }
    });
  });
  if (shards.length > MAX_SHARDS) shards.splice(0, shards.length - MAX_SHARDS);
}

function drawPiece(g: CanvasRenderingContext2D, shard: Shard): void {
  const dx = (Math.cos(shard.ang) * shard.len) / 2;
  const dy = (Math.sin(shard.ang) * shard.len) / 2;
  g.globalAlpha = Math.min(1, shard.life * 1.5);
  [[COLORS.ink, CFG.R * 2 + 3], [shard.color, CFG.R * 2]].forEach(([color, width]) => {
    g.strokeStyle = color as string;
    g.lineWidth = width as number;
    g.beginPath();
    g.moveTo(shard.x - dx, shard.y - dy);
    g.lineTo(shard.x + dx, shard.y + dy);
    g.stroke();
  });
}

/** Moves and draws the pieces (world coordinates). */
export function drawShards(g: CanvasRenderingContext2D): void {
  const now = performance.now();
  const dt = lastTs ? Math.min(0.05, (now - lastTs) / 1000) : 0;
  lastTs = now;
  g.lineCap = 'round';
  shards.forEach((shard) => {
    shard.life -= dt;
    shard.vy += CFG.G * 0.6 * dt;
    shard.x += shard.vx * dt;
    shard.y += shard.vy * dt;
    shard.ang += shard.va * dt;
  });
  const alive = shards.filter((shard) => shard.life > 0);
  shards.splice(0, shards.length, ...alive);
  shards.forEach((shard) => drawPiece(g, shard));
  g.globalAlpha = 1;
}
