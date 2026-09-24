// The game's shared state, and the hooks online play uses to join in without the solo game
// depending on it.
import buildCourse from '../shared/course/build';
import type CpuRacer from '../shared/cpu/racer';
import { emptyLimbs } from '../shared/limbs';
import { DEFAULT_LOOK, lookFromHash } from '../shared/look';
import type { Look } from '../shared/look';
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
  /** The look your runner wears this round (see appearance.ts). */
  look: Look;
  /** The CPU racing with you in the tutorial (the only place with a CPU). */
  cpu: CpuRacer | null;
  /** When the CPU finished (null until then). */
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
  // Until the hash is worked out on a first visit, a plain look (main.ts then puts on yours).
  look: save.look ?? (save.playerHash ? lookFromHash(save.playerHash) : DEFAULT_LOOK),
  cpu: null,
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
  /** The Exit button while online. */
  onExit?: () => void;
  /** The look you wear changed. */
  onLook?: () => void;
  /** "Return to lobby" on the results card after an online race. */
  onReturnToLobby?: () => void;
  /** Where the camera looks when you are not racing yourself. */
  focus?: () => Point | null;
  /** Draws other racers into the world. */
  drawWorld?: (ctx: CanvasRenderingContext2D) => void;
  /** Adds other racers to the progress bar. */
  onHud?: (progress: HTMLElement, startX: number, span: number) => void;
}

export const hooks: Hooks = {};
