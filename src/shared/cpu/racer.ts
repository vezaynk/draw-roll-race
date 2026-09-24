// A CPU racer: notices the next section a little before reaching it, changes shape after its
// reaction time (sometimes to the wrong one), redraws limbs that spikes broke, and tries other
// shapes when it gets stuck. It races with you in the tutorial.
import { planIndex } from '../course/queries';
import step from '../physics';
import { pick } from '../random';
import {
  createRunner, settle, shatter, swapLimbs,
} from '../runner';
import type {
  Course, LimbKind, Limbs, Pose, Runner,
} from '../types';
import personality from './personality';
import type { Personality } from './personality';

/** Seconds without progress before trying another shape. */
const STUCK_AFTER = 3;
const RECOVERY: readonly Pose[] = ['stilts', 'wheel', 'climber', 'mini'];

export interface CpuOptions {
  seed: number;
  color: string;
  /** Called when the CPU changes shape or loses limbs (`lost`), with its runner from before. */
  onSwap?: (limbs: Limbs, pose: Pose, lost: LimbKind[] | undefined, before: Runner) => void;
}

interface PendingChange {
  planStep: number;
  pose: Pose;
  at: number;
}

export default class CpuRacer {
  readonly name: string;

  pose: Pose = 'wheel';

  limbs: Limbs;

  runner: Runner;

  finishTime: number | null = null;

  private readonly traits: Personality;

  private planStep = 0;

  private pending: PendingChange | null = null;

  private redrawAt: number | null = null;

  private progressX: number;

  private progressT = 0;

  private recoveries = 0;

  constructor(private readonly course: Course, private readonly options: CpuOptions) {
    this.traits = personality(options.seed);
    this.name = this.traits.name;
    this.limbs = this.traits.shapes.wheel;
    this.runner = createRunner(this.limbs, options.color, this.traits.speed);
    settle(course, this.runner, course.startX);
    this.progressX = this.runner.x;
  }

  /** Advances the CPU by dt seconds; t is the race clock. */
  step(dt: number, t: number): void {
    if (this.finishTime !== null) return;
    step(this.course, this.runner, dt);
    this.recoverFromSpikes(t);
    const { x } = this.runner;
    this.planAhead(x, t);
    this.checkProgress(x, t);
    if (x >= this.course.finishX) this.finishTime = t;
  }

  private setPose(pose: Pose, force = false): void {
    if (pose === this.pose && !force) return;
    const before = this.runner;
    this.pose = pose;
    this.limbs = this.traits.shapes[pose];
    this.runner = swapLimbs(this.course, this.runner, this.limbs);
    this.options.onSwap?.(this.limbs, pose, undefined, before);
  }

  private reactionTime(): number {
    return pick(this.traits.rand, this.traits.react);
  }

  /** Spikes took a limb: carry on without it, then redraw the same shape after reacting. */
  private recoverFromSpikes(t: number): void {
    const broken = shatter(this.course, this.runner, this.limbs);
    if (broken) {
      const before = this.runner;
      this.limbs = broken.limbs;
      this.runner = broken.runner;
      this.options.onSwap?.(this.limbs, this.pose, broken.lost, before);
      this.redrawAt = t + this.reactionTime();
    }
    if (this.redrawAt !== null && t >= this.redrawAt) {
      this.redrawAt = null;
      this.setPose(this.pose, true);
    }
  }

  /** Notices the next section a little before reaching it, then reacts after a delay. */
  private planAhead(x: number, t: number): void {
    const r = this.traits.rand;
    const k = planIndex(this.course, x + this.traits.ahead);
    if (k !== this.planStep && (!this.pending || this.pending.planStep !== k)) {
      let { pose } = this.course.plan[k];
      if (pose !== 'wheel' && r() < this.traits.mistake) {
        pose = r() < 0.5 ? 'wheel' : RECOVERY[Math.floor(r() * RECOVERY.length)];
      }
      this.pending = { planStep: k, pose, at: t + this.reactionTime() };
    }
    if (this.pending && t >= this.pending.at) {
      this.planStep = this.pending.planStep;
      this.setPose(this.pending.pose);
      this.pending = null;
    }
  }

  /** Stuck? Try the right shape for here, then the others in turn. */
  private checkProgress(x: number, t: number): void {
    if (x > this.progressX + 25) {
      this.progressX = x;
      this.progressT = t;
      return;
    }
    if (t - this.progressT <= STUCK_AFTER || this.pending) return;
    const right = this.course.plan[planIndex(this.course, x + 40)].pose;
    let next = right;
    if (this.pose === right) {
      const others = RECOVERY.filter((p) => p !== this.pose);
      next = others[this.recoveries % others.length];
      this.recoveries += 1;
    }
    this.setPose(next);
    this.progressT = t;
  }
}
