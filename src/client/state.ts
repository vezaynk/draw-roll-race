// The game's shared state, and the hooks online play uses to join in without the solo game
// depending on it.
import buildCourse from '../shared/course/build';
import type CpuRacer from '../shared/cpu/racer';
import { emptyLimbs } from '../shared/limbs';
import type {
  Course, CourseSection, LimbKind, Limbs, Point, Runner, SectionType,
} from '../shared/types';
import type { Ghost, Recording } from './ghost';
import { save } from './storage';

export interface GameState {
  stage: number;
  course: Course;
  limbs: Limbs;
  player: Runner | null;
  /** Solo CPU racers. */
  cpus: CpuRacer[];
  /** When the first CPU finished (null until then). */
  cpuTime: number | null;
  /** Your best run on this course (and the daily leader's), replayed while racing. */
  ghosts: Ghost[];
  /** The run being recorded. */
  recording: Recording | null;
  /** Set while playing the daily course. */
  daily: { day: string } | null;
  tipsShown: Partial<Record<SectionType, boolean>>;
  racing: boolean;
  finished: boolean;
  time: number;
  /** Physics steps taken this race (daily runs are replayed step by step on the server). */
  steps: number;
  section: CourseSection | null;
  mode: 'solo' | 'online';
  /** performance.now() when the countdown reaches GO, 0 when there is no countdown. */
  countdownEnd: number;
}

export const state: GameState = {
  stage: save.stage,
  course: buildCourse(save.stage),
  limbs: emptyLimbs(),
  player: null,
  cpus: [],
  cpuTime: null,
  ghosts: [],
  recording: null,
  daily: null,
  tipsShown: {},
  racing: false,
  finished: false,
  time: 0,
  steps: 0,
  section: null,
  mode: 'solo',
  countdownEnd: 0,
};

/** Online play fills these in; the solo game only calls them. */
export interface Hooks {
  onLimbs?: (limbs: Limbs, lost?: LimbKind[]) => void;
  /** After each rendered frame of your own race. */
  onFrame?: () => void;
  onFinish?: (time: number) => void;
  /** The ↻/✕ button while online. */
  onRestart?: () => void;
  /** Where the camera looks when you are not racing yourself. */
  focus?: () => Point | null;
  /** Draws other racers into the world. */
  drawWorld?: (ctx: CanvasRenderingContext2D) => void;
  /** Adds other racers to the progress bar. */
  onHud?: (progress: HTMLElement, startX: number, span: number) => void;
}

export const hooks: Hooks = {};
