// The obstacle catalogue. Each section has fixed sizes for the hand-made stages and a generator
// for random courses. Every generator range was checked with tools/sim.ts: CPUs of every
// difficulty can finish. The order of this object is part of course generation: do not reorder.
import { randInt, randNum } from '../random';
import type { Rand } from '../random';
import type { Pose, SectionParams, SectionType } from '../types';

export interface SectionSpec {
  label: string;
  /** What a CPU should switch to for this section (none: keep the wheel). */
  pose?: Pose;
  /** Sizes used by the fixed stages. */
  def: SectionParams;
  /** Sizes for generated courses; level (0..1) is the difficulty. */
  gen: (r: Rand, level: number) => SectionParams;
}

export const SECTIONS: Record<SectionType, SectionSpec> = {
  rolling: {
    label: 'Rolling Hills',
    def: { len: 760, amp: 1 },
    gen: (r, L) => ({ len: randInt(r, 500, 900), amp: randNum(r, 0.6, 0.9 + 0.4 * L) }),
  },
  bumps: {
    label: 'Bumpy Road',
    def: { len: 480, amp: 12, period: 40 },
    gen: (r, L) => ({
      len: randInt(r, 300, 600), amp: randNum(r, 8, 10 + 4 * L), period: randInt(r, 32, 48),
    }),
  },
  stairs: {
    label: 'Stairs',
    pose: 'stilts',
    def: { n: 3, h: 36, tread: 96 },
    gen: (r, L) => ({
      n: randInt(r, 2, 3 + Math.round(L)),
      h: randInt(r, 28, 32 + 8 * L),
      tread: randInt(r, 84, 110),
    }),
  },
  trenches: {
    label: 'Trenches',
    pose: 'stilts',
    def: {
      n: 2, w: 64, d: 34, gap: 110,
    },
    gen: (r, L) => ({
      n: randInt(r, 1, 2 + Math.round(L)),
      w: randInt(r, 50, 58 + 12 * L),
      d: randInt(r, 26, 30 + 8 * L),
      gap: randInt(r, 90, 130),
    }),
  },
  chasm: {
    label: 'Chasm',
    pose: 'stilts',
    def: { w: 92, d: 60 },
    gen: (r, L) => ({ w: randInt(r, 70, 80 + 14 * L), d: randInt(r, 45, 50 + 12 * L) }),
  },
  swell: {
    label: 'Big Wave',
    def: { len: 620, dh: 100 },
    gen: (r, L) => ({ len: randInt(r, 520, 700), dh: randInt(r, 70, 85 + 25 * L) }),
  },
  ramps: {
    label: 'Sawtooth',
    def: { n: 4, len: 100, h: 42 },
    gen: (r, L) => ({
      n: randInt(r, 3, 4 + Math.round(L)), len: randInt(r, 84, 110), h: randInt(r, 30, 34 + 10 * L),
    }),
  },
  tunnel: {
    label: 'Tunnel',
    pose: 'mini',
    def: { len: 380 },
    gen: (r, L) => ({ len: randInt(r, 240, 300 + 120 * L) }),
  },
  hurdles: {
    label: 'Hurdles',
    pose: 'stilts',
    def: { n: 3, h: 28, gap: 96 },
    gen: (r, L) => ({
      n: randInt(r, 2, 3 + Math.round(L)), h: randInt(r, 22, 24 + 6 * L), gap: randInt(r, 84, 110),
    }),
  },
  drop: {
    label: 'Drop',
    def: { dh: 140 },
    gen: (r) => ({ dh: randInt(r, 80, 150) }),
  },
  incline: {
    label: 'Steep Climb',
    def: { len: 230, rise: 115 },
    gen: (r, L) => {
      const len = randInt(r, 200, 260);
      return { len, rise: Math.round(len * randNum(r, 0.35, 0.4 + 0.1 * L)) };
    },
  },
  pool: {
    label: 'Pool',
    pose: 'stilts',
    def: { len: 700, d: 130 },
    gen: (r, L) => ({ len: randInt(r, 520, 620 + 140 * L), d: randInt(r, 100, 110 + 30 * L) }),
  },
  ledge: {
    label: 'Wall',
    pose: 'climber',
    def: { h: 88 },
    gen: (r, L) => ({ h: randInt(r, 60, 70 + 20 * L) }),
  },
  crawl: {
    label: 'Crawl & Climb',
    def: { tunnel: 260, h: 80 },
    gen: (r, L) => ({ tunnel: randInt(r, 200, 240 + 40 * L), h: randInt(r, 60, 66 + 16 * L) }),
  },
  conveyor: {
    label: 'Conveyor',
    def: { len: 440, belt: 120 },
    gen: (r, L) => ({ len: randInt(r, 300, 360 + 120 * L), belt: randInt(r, 90, 100 + 25 * L) }),
  },
  ice: {
    label: 'Ice Slope',
    def: { len: 520, rise: 100 },
    gen: (r, L) => {
      const len = randInt(r, 420, 560);
      return { len, rise: Math.round(len * randNum(r, 0.13, 0.15 + 0.04 * L)) };
    },
  },
  mud: {
    label: 'Mud Pit',
    pose: 'stilts',
    def: { len: 420, d: 60 },
    gen: (r, L) => ({ len: randInt(r, 300, 360 + 100 * L), d: randInt(r, 45, 50 + 12 * L) }),
  },
  // Spikes shatter whichever limb touches them. Long spokes vault the pit; a wheel falls in.
  spikepit: {
    label: 'Spike Pit',
    pose: 'stilts',
    def: { w: 84, d: 34 },
    gen: (r, L) => ({ w: randInt(r, 64, 72 + 18 * L), d: randInt(r, 28, 30 + 8 * L) }),
  },
  // Spikes on a low roof: tall limbs (long arms) shatter; a normal wheel fits underneath.
  spikeroof: {
    label: 'Spiked Ceiling',
    def: { len: 300, clear: 92 },
    gen: (r, L) => ({ len: randInt(r, 220, 260 + 120 * L), clear: randInt(r, 96 - 6 * L, 104) }),
  },
  wind: {
    label: 'Headwind',
    def: { len: 500, force: 320 },
    gen: (r, L) => ({ len: randInt(r, 380, 480 + 140 * L), force: randInt(r, 220, 280 + 140 * L) }),
  },
  // Floaty: one wide crater, so runners sail across it in long arcs.
  lowgrav: {
    label: 'Low Gravity',
    def: { len: 520, grav: 0.35, dh: 45 },
    gen: (r, L) => {
      const len = randInt(r, 440, 620);
      const grav = randNum(r, 0.3, 0.45);
      return { len, grav, dh: Math.round(len * randNum(r, 0.06, 0.08 + 0.03 * L)) };
    },
  },
  bounce: {
    label: 'Bounce Pads',
    def: { len: 420, amp: 10 },
    gen: (r, L) => ({ len: randInt(r, 300, 360 + 120 * L), amp: randInt(r, 6, 8 + 6 * L) }),
  },
  // Nothing special about the blocks: an arm long enough (or hooked) to reach them catches their
  // edges and hauls the runner along, block to block.
  blocks: {
    label: 'Hanging Blocks',
    pose: 'climber',
    def: {
      w: 300, d: 100, n: 4, bw: 36, gap: 40, h: 70, th: 18,
    },
    gen: (r) => ({
      w: randInt(r, 260, 320), d: 100, n: 4, bw: 36, gap: randInt(r, 34, 44), h: randInt(r, 64, 76), th: 18,
    }),
  },
};

export const SECTION_TYPES = Object.keys(SECTIONS) as SectionType[];

/**
 * Obstacles random courses pick from. Newer obstacles are left out until they are released, so
 * existing random, Endless and daily courses stay exactly as they were.
 */
export const GENERATED_TYPES = SECTION_TYPES.filter((t) => t !== 'blocks');

/** Sections where the right shape matters (marked on the progress bar). */
export function needsShapeChange(type: SectionType): boolean {
  return !!SECTIONS[type].pose || type === 'crawl';
}
