// A CPU's personality comes from its seed: how fast its limbs spin, how quickly it reacts, how
// far ahead it looks, how often it picks the wrong shape, and its own versions of each shape.
// The order of random draws here is part of the seed's meaning: do not reorder.
import { FIG } from '../config';
import { bar, cross, halfRing } from '../poses';
import {
  hashSeed, pick, rng,
} from '../random';
import type { Rand } from '../random';
import type { Limbs, Pose } from '../types';

export type Difficulty = 'easy' | 'normal' | 'hard';

type Range = readonly [number, number];

interface DifficultySpec {
  /** Limb speed multiplier. */
  speed: Range;
  /** Seconds between noticing a section and changing shape. */
  react: Range;
  /** Chance of picking the wrong shape. */
  mistake: number;
  /** How far ahead (world units) it notices the next section. */
  ahead: Range;
}

const DIFFICULTY: Record<Difficulty, DifficultySpec> = {
  easy: {
    speed: [0.50, 0.58], react: [2.6, 4.2], mistake: 0.30, ahead: [20, 70],
  },
  normal: {
    speed: [0.60, 0.70], react: [1.4, 3.0], mistake: 0.12, ahead: [50, 110],
  },
  hard: {
    speed: [0.74, 0.84], react: [0.4, 1.2], mistake: 0.04, ahead: [80, 140],
  },
};

export const DIFFICULTIES = Object.keys(DIFFICULTY) as Difficulty[];

export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === 'string' && value in DIFFICULTY;
}

const NAMES = ['Bolt', 'Wobble', 'Spoke', 'Zippy', 'Noodle', 'Gizmo', 'Pogo', 'Rusty', 'Dash',
  'Sprocket', 'Doodle', 'Tumble', 'Whirl', 'Clank', 'Scoot', 'Pip'];

export interface Personality {
  difficulty: Difficulty;
  name: string;
  speed: number;
  react: Range;
  mistake: number;
  ahead: number;
  shapes: Record<Pose, Limbs>;
  rand: Rand;
}

/** Randomised shapes, kept within the sizes that work (the small wheel must fit tunnels). */
function randomShapes(r: Rand): Record<Pose, Limbs> {
  const armless = r() < 0.2;
  const wheelArm = armless ? [] : [halfRing(FIG.shoulder, Math.round(pick(r, [20, 30])))];
  const wheel = { arm: wheelArm, leg: [halfRing(FIG.hip, Math.round(pick(r, [34, 44])))] };
  const miniArm = [halfRing(FIG.shoulder, Math.round(pick(r, [14, 19])))];
  const mini = { arm: miniArm, leg: [halfRing(FIG.hip, Math.round(pick(r, [20, 25])))] };
  const spokeLen = Math.round(pick(r, [70, 84]));
  const stilts = { arm: [], leg: [cross(spokeLen, pick(r, [-0.3, 0.3]))] };
  const climberArm = [bar(FIG.shoulder, Math.round(pick(r, [92, 110])))];
  const climber = { arm: climberArm, leg: [halfRing(FIG.hip, Math.round(pick(r, [20, 25])))] };
  return {
    wheel, mini, stilts, climber,
  };
}

export default function personality(seed: number, difficulty: Difficulty): Personality {
  const d = DIFFICULTY[difficulty];
  const r = rng(hashSeed(`cpu${seed}`));
  const name = NAMES[Math.floor(r() * NAMES.length)];
  const speed = pick(r, d.speed);
  const ahead = pick(r, d.ahead);
  return {
    difficulty,
    name,
    speed,
    react: d.react,
    mistake: d.mistake,
    ahead,
    shapes: randomShapes(r),
    rand: r,
  };
}
