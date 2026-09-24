// Draws the whole scene: sky, parallax hills and clouds, the course, the runners and effects.
import { groundAt } from '../../shared/course/queries';
import { byId } from '../dom';
import { drawGhost } from '../ghost';
import { hooks, state } from '../state';
import { drawRunner } from './draw';
import {
  drawFluids, drawGround, drawObstacles, drawPosts,
} from './obstacles';
import type { View } from './obstacles';
import { drawShards } from './shards';

/** World units visible across the screen (at most). */
const VIEW_W = 560;

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
const camera = { x: 0, y: 0 };

function drawSky(width: number, height: number): void {
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#5aa9e6');
  sky.addColorStop(0.6, '#bfe3f5');
  sky.addColorStop(1, '#fbe8d3');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);
}

/** Clouds and hills that move slower than the course (screen space, already scaled). */
function drawParallax(viewW: number, viewH: number): void {
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  const period = viewW + 260;
  for (let k = 0; k < 7; k += 1) {
    const cx = ((((k * 211 - camera.x * 0.15) % period) + period) % period) - 130;
    const cy = 50 + ((k * 53) % 90);
    ctx.beginPath();
    ctx.ellipse(cx, cy, 34, 11, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + 20, cy - 7, 20, 11, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(80,140,120,0.35)';
  ctx.beginPath();
  ctx.moveTo(0, viewH);
  for (let sx = 0; sx <= viewW + 10; sx += 10) {
    const wx = sx + camera.x * 0.35;
    ctx.lineTo(sx, viewH * 0.62 - 26 * Math.sin(wx / 130) - 14 * Math.sin(wx / 57 + 1));
  }
  ctx.lineTo(viewW, viewH);
  ctx.closePath();
  ctx.fill();
}

/** Follows the player, kept high enough that the drawing pad does not hide them. */
function moveCamera(viewW: number, viewH: number): void {
  const c = state.course;
  const focus = state.player ?? hooks.focus?.() ?? { x: c.startX, y: groundAt(c, c.startX) - 40 };
  const tx = Math.max(0, focus.x - viewW * 0.3);
  const ty = focus.y - viewH * 0.36;
  if (state.racing) {
    camera.x += (tx - camera.x) * 0.2;
    camera.y += (ty - camera.y) * 0.12;
  } else {
    camera.x = tx;
    camera.y = ty;
  }
}

export function render(): void {
  if (!ctx) return;
  const { width, height } = canvas;
  const zoom = Math.min(width / VIEW_W, height / 480);
  const viewW = width / zoom;
  const viewH = height / zoom;
  moveCamera(viewW, viewH);

  drawSky(width, height);
  ctx.save();
  ctx.scale(zoom, zoom);
  drawParallax(viewW, viewH);
  ctx.restore();

  ctx.save();
  ctx.scale(zoom, zoom);
  ctx.translate(-camera.x, -camera.y);
  const view: View = {
    x0: camera.x - 10, x1: camera.x + viewW + 10, top: camera.y, height: viewH, time: state.time,
  };
  const c = state.course;
  drawGround(ctx, c, view);
  drawObstacles(ctx, c, view);
  drawPosts(ctx, c);
  if (state.racing) state.ghosts.forEach((ghost) => drawGhost(ctx, ghost, state.time));
  if (state.cpu) drawRunner(ctx, state.cpu.runner, 0.85);
  hooks.drawWorld?.(ctx);
  if (state.player) drawRunner(ctx, state.player, 1);
  drawShards(ctx);
  drawFluids(ctx, c, view);
  ctx.restore();
}

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  render();
}

export function initScene(): void {
  canvas = byId<HTMLCanvasElement>('world');
  ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  window.addEventListener('resize', resize);
  resize();
}

export { resize };
