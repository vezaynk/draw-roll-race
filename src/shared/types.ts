// Types shared by the browser, the server and the simulation.

export interface Point {
  x: number;
  y: number;
}

/** A drawn line, in drawing-pad coordinates. */
export type Stroke = Point[];

export type LimbKind = 'arm' | 'leg';

/** One stroke (or none) per joint, in pad coordinates. */
export interface Limbs {
  arm: Stroke[];
  leg: Stroke[];
}

/** Limbs as sent over the network: each stroke is a flat [x0, y0, x1, y1, ...] array. */
export interface EncodedLimbs {
  arm: number[][];
  leg: number[][];
}

export type Pose = 'wheel' | 'mini' | 'stilts' | 'climber';

export type SectionType =
  | 'rolling' | 'bumps' | 'stairs' | 'trenches' | 'chasm' | 'swell' | 'ramps' | 'tunnel'
  | 'hurdles' | 'drop' | 'incline' | 'pool' | 'ledge' | 'crawl' | 'conveyor' | 'ice' | 'mud'
  | 'spikepit' | 'spikeroof' | 'wind' | 'lowgrav' | 'bounce';

/** Sizes of one section (lengths, heights, counts...). */
export type SectionParams = Record<string, number>;

export interface Surface {
  /** Conveyor belt speed (negative pushes backwards). */
  belt?: number;
  /** Friction multiplier. */
  mu?: number;
  /** Limbs touching this floor shatter. */
  spikes?: boolean;
  /** Restitution override. */
  bounce?: number;
}

export interface Fluid {
  level: number;
  kind: 'water' | 'mud';
}

export interface Zone {
  /** Horizontal acceleration. */
  wind?: number;
  /** Gravity multiplier. */
  grav?: number;
  /** The ceiling above is spiked. */
  roofSpikes?: boolean;
}

export interface CourseSection {
  type: SectionType;
  label: string;
  from: number;
  to: number;
  /** Where the wall of a crawl section starts. */
  wallX?: number;
}

export interface PlanStep {
  x: number;
  pose: Pose;
}

/** Terrain sampled every CFG.STEP world units, plus what a CPU should do where. */
export interface Course {
  ground: number[];
  ceil: number[];
  /** Ceiling heights with "no ceiling" replaced by a point far above, for collisions. */
  ceilLine: number[];
  fluid: (Fluid | null)[];
  surf: (Surface | null)[];
  zone: (Zone | null)[];
  sections: CourseSection[];
  plan: PlanStep[];
  finishX: number;
  startX: number;
  length: number;
}

export interface Joint {
  kind: LimbKind;
  /** Joint position relative to the body centre. */
  ox: number;
  oy: number;
  /** Collision points relative to the joint (before rotation). */
  pts: Point[];
  /** Drawn lines relative to the joint (before rotation). */
  lines: Stroke[];
  angle: number;
  w: number;
  invI: number;
  reach: number;
  active: boolean;
}

export interface Runner {
  color: string;
  /** Limb speed multiplier (CPUs are slower). */
  speed: number;
  torso: Point[];
  spine: Point[];
  head: Point & { r: number };
  joints: [Joint, Joint];
  mass: number;
  invM: number;
  nPts: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Limbs that touched spikes during the last step. */
  hit: Record<LimbKind, boolean>;
  /** Seconds left before spikes can shatter limbs. */
  immune: number;
}

/** A limb or two broke on spikes. */
export interface Shattered {
  limbs: Limbs;
  runner: Runner;
  lost: LimbKind[];
}
