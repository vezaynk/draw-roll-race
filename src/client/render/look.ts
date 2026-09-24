// Drawing a runner's head with its look (hair, hat, eyes, glasses; see shared/look.ts). Heads
// are seen side-on, facing right; everything is sized from the head's radius, so the same code
// draws runners in the world, the figure on the pad and the preview in Options.
import { DEFAULT_LOOK } from '../../shared/look';
import type { Look } from '../../shared/look';
import { COLORS } from '../colors';

const HAIR_COLOR = '#4a3222';
const HAT_COLORS = {
  cap: '#3a7bd5', tophat: '#1f2430', band: '#e0508f', beanie: '#2fa36b', crown: '#f2c14e', party: '#e0508f',
};

interface Head {
  g: CanvasRenderingContext2D;
  x: number;
  y: number;
  r: number;
  /** Outline width. */
  lw: number;
}

/** Fills the current path and outlines it (accessories get thinner lines than the head). */
function outlined(h: Head, fill: string, width = h.lw * 0.55): void {
  h.g.fillStyle = fill;
  h.g.fill();
  h.g.strokeStyle = COLORS.ink;
  h.g.lineWidth = width;
  h.g.stroke();
}

/** A point at `angle` (radians, 0 = facing forward, negative = up) and `dist` × r from the centre. */
function around(h: Head, angle: number, dist: number): [number, number] {
  return [h.x + Math.cos(angle) * dist * h.r, h.y + Math.sin(angle) * dist * h.r];
}

const deg = (d: number) => (d * Math.PI) / 180;

// ---------------- hair ----------------

/** Hair that sits behind the head (drawn before it). */
function hairBehind(h: Head, hair: Look['hair']): void {
  const { g, x, y, r } = h;
  g.beginPath();
  if (hair === 'afro') {
    g.arc(x - 0.1 * r, y - 0.3 * r, 1.4 * r, 0, Math.PI * 2);
  } else if (hair === 'long') {
    g.ellipse(x - 0.35 * r, y + 0.25 * r, 0.9 * r, 1.3 * r, 0, 0, Math.PI * 2);
  } else if (hair === 'ponytail') {
    g.ellipse(x - 1.3 * r, y - 0.2 * r, 0.5 * r, 0.3 * r, deg(-25), 0, Math.PI * 2);
  } else {
    return;
  }
  outlined(h, HAIR_COLOR);
}

/** Hair over the top and back of the head, leaving the face clear. */
function hairCap(h: Head, depth: number): void {
  const { g, x, y, r } = h;
  g.save();
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.clip();
  g.beginPath();
  g.moveTo(x - 1.3 * r, y + depth * r);
  g.lineTo(x - 1.3 * r, y - 1.3 * r);
  g.lineTo(x + 1.3 * r, y - 1.3 * r);
  g.lineTo(x + 1.3 * r, y - 0.45 * r);
  g.lineTo(x + 0.15 * r, y - 0.5 * r);
  g.lineTo(x - 0.4 * r, y + depth * 0.4 * r);
  g.closePath();
  g.fillStyle = HAIR_COLOR;
  g.fill();
  g.restore();
}

/** Pointed tufts along the top of the head, from angle `from` to `to`. */
function tufts(h: Head, from: number, to: number, count: number, height: number, width: number): void {
  const { g } = h;
  for (let i = 0; i < count; i += 1) {
    const a = deg(from + ((to - from) * i) / (count - 1));
    g.beginPath();
    g.moveTo(...around(h, a - deg(width), 0.95));
    g.lineTo(...around(h, a, height));
    g.lineTo(...around(h, a + deg(width), 0.95));
    g.closePath();
    outlined(h, HAIR_COLOR, h.lw * 0.45);
  }
}

function hairFront(h: Head, hair: Look['hair']): void {
  if (hair === 'bob' || hair === 'long' || hair === 'ponytail') hairCap(h, 0.35);
  if (hair === 'afro') hairCap(h, -0.1);
  if (hair === 'spiky') {
    hairCap(h, -0.2);
    tufts(h, -160, -35, 5, 1.45, 14);
  }
  if (hair === 'mohawk') tufts(h, -140, -60, 5, 1.7, 9);
}

// ---------------- eyes and glasses ----------------

function eyes(h: Head, style: Look['eyes']): void {
  const { g, r } = h;
  const ex = h.x + 0.4 * r;
  const ey = h.y - 0.1 * r;
  g.fillStyle = COLORS.ink;
  g.strokeStyle = COLORS.ink;
  g.lineWidth = h.lw * 0.6;
  g.beginPath();
  if (style === 'big') {
    g.arc(ex, ey, 0.32 * r, 0, Math.PI * 2);
    outlined(h, '#fff', h.lw * 0.5);
    g.beginPath();
    g.arc(ex + 0.1 * r, ey, 0.15 * r, 0, Math.PI * 2);
    g.fillStyle = COLORS.ink;
    g.fill();
  } else if (style === 'sleepy') {
    g.arc(ex, ey, 0.2 * r, 0, Math.PI);
    g.fill();
    g.beginPath();
    g.moveTo(ex - 0.26 * r, ey);
    g.lineTo(ex + 0.26 * r, ey);
    g.stroke();
  } else if (style === 'happy') {
    g.arc(ex, ey + 0.12 * r, 0.22 * r, deg(200), deg(340));
    g.stroke();
  } else if (style === 'angry') {
    g.arc(ex, ey, 0.2 * r, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(ex - 0.3 * r, ey - 0.45 * r);
    g.lineTo(ex + 0.28 * r, ey - 0.22 * r);
    g.stroke();
  } else if (style === 'star') {
    for (let i = 0; i < 10; i += 1) {
      const a = deg(-90 + i * 36);
      const d = (i % 2 ? 0.14 : 0.34) * r;
      if (i) g.lineTo(ex + Math.cos(a) * d, ey + Math.sin(a) * d);
      else g.moveTo(ex + Math.cos(a) * d, ey + Math.sin(a) * d);
    }
    g.closePath();
    outlined(h, '#f2c14e', h.lw * 0.35);
  } else {
    g.arc(ex, ey, 0.2 * r, 0, Math.PI * 2);
    g.fill();
  }
}

function glasses(h: Head, style: Look['glasses']): void {
  if (style === 'none') return;
  const { g, r } = h;
  const ex = h.x + 0.4 * r;
  const ey = h.y - 0.1 * r;
  g.strokeStyle = COLORS.ink;
  g.lineWidth = h.lw * 0.55;
  // The arm back to the ear (goggles have a strap instead, monocles nothing).
  if (style !== 'monocle' && style !== 'goggles') {
    g.beginPath();
    g.moveTo(ex - 0.36 * r, ey);
    g.lineTo(h.x - 0.55 * r, ey - 0.05 * r);
    g.stroke();
  }
  g.beginPath();
  if (style === 'round') {
    g.arc(ex, ey, 0.36 * r, 0, Math.PI * 2);
    g.stroke();
  } else if (style === 'square') {
    g.roundRect(ex - 0.38 * r, ey - 0.3 * r, 0.76 * r, 0.6 * r, 0.08 * r);
    g.stroke();
  } else if (style === 'shades') {
    g.roundRect(ex - 0.42 * r, ey - 0.24 * r, 0.84 * r, 0.5 * r, 0.14 * r);
    outlined(h, '#1f2430', h.lw * 0.5);
  } else if (style === 'monocle') {
    g.arc(ex, ey, 0.34 * r, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(ex - 0.1 * r, ey + 0.34 * r);
    g.quadraticCurveTo(ex - 0.5 * r, ey + 0.8 * r, ex - 0.2 * r, ey + 1.1 * r);
    g.lineWidth = h.lw * 0.3;
    g.stroke();
  } else if (style === 'goggles') {
    g.moveTo(h.x - r, ey - 0.02 * r);
    g.lineTo(ex, ey);
    g.lineWidth = h.lw * 1.2;
    g.strokeStyle = '#9a5bd6';
    g.stroke();
    g.beginPath();
    g.arc(ex, ey, 0.4 * r, 0, Math.PI * 2);
    outlined(h, 'rgba(160,215,255,0.75)', h.lw * 0.8);
  }
}

// ---------------- hats ----------------

function hat(h: Head, style: Look['hat']): void {
  const { g, x, y, r } = h;
  g.beginPath();
  if (style === 'cap') {
    g.arc(x, y, 1.05 * r, deg(185), deg(355));
    g.closePath();
    outlined(h, HAT_COLORS.cap);
    g.beginPath();
    g.roundRect(x + 0.3 * r, y - 0.22 * r, 1.2 * r, 0.2 * r, 0.1 * r);
    outlined(h, HAT_COLORS.cap);
  } else if (style === 'tophat') {
    g.rect(x - 0.72 * r, y - 2.15 * r, 1.44 * r, 1.4 * r);
    outlined(h, HAT_COLORS.tophat);
    g.beginPath();
    g.rect(x - 0.72 * r, y - 1.18 * r, 1.44 * r, 0.3 * r);
    outlined(h, HAT_COLORS.band);
    g.beginPath();
    g.roundRect(x - 1.2 * r, y - 0.82 * r, 2.4 * r, 0.22 * r, 0.1 * r);
    outlined(h, HAT_COLORS.tophat);
  } else if (style === 'beanie') {
    g.arc(x, y - 0.1 * r, 1.05 * r, Math.PI, 0);
    g.closePath();
    outlined(h, HAT_COLORS.beanie);
    g.beginPath();
    g.roundRect(x - 1.1 * r, y - 0.32 * r, 2.2 * r, 0.3 * r, 0.1 * r);
    outlined(h, HAT_COLORS.beanie);
    g.beginPath();
    g.arc(x, y - 1.3 * r, 0.26 * r, 0, Math.PI * 2);
    outlined(h, '#fff', h.lw * 0.6);
  } else if (style === 'crown') {
    const base = y - 0.72 * r;
    g.moveTo(x - 0.8 * r, base);
    g.lineTo(x - 0.8 * r, base - 0.75 * r);
    g.lineTo(x - 0.4 * r, base - 0.35 * r);
    g.lineTo(x, base - 0.95 * r);
    g.lineTo(x + 0.4 * r, base - 0.35 * r);
    g.lineTo(x + 0.8 * r, base - 0.75 * r);
    g.lineTo(x + 0.8 * r, base);
    g.closePath();
    outlined(h, HAT_COLORS.crown, h.lw * 0.7);
  } else if (style === 'party') {
    g.moveTo(x - 0.6 * r, y - 0.78 * r);
    g.lineTo(x + 0.15 * r, y - 2.2 * r);
    g.lineTo(x + 0.7 * r, y - 0.72 * r);
    g.closePath();
    outlined(h, HAT_COLORS.party, h.lw * 0.7);
    g.beginPath();
    g.arc(x + 0.15 * r, y - 2.25 * r, 0.24 * r, 0, Math.PI * 2);
    outlined(h, '#f2c14e', h.lw * 0.5);
  }
}

/**
 * A head at (x, y) with radius r, with its look. lineWidth is the head's outline width (the
 * rest scales from it).
 */
export default function drawHead(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  look: Look = DEFAULT_LOOK,
  lineWidth = r * 0.3,
): void {
  const h: Head = {
    g, x, y, r, lw: lineWidth,
  };
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  hairBehind(h, look.hair);
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = '#fff';
  g.fill();
  hairFront(h, look.hair);
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.strokeStyle = COLORS.ink;
  g.lineWidth = lineWidth;
  g.stroke();
  eyes(h, look.eyes);
  glasses(h, look.glasses);
  hat(h, look.hat);
  g.restore();
}
