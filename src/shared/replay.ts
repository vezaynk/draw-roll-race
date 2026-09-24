// A player's run, stepped the same way in the browser and on the server. The browser records
// which limbs were drawn at which physics step; the server plays those drawings back on the same
// course to time the run itself (see worker/daily.ts). Everything here must stay deterministic.
import { CFG } from './config';
import { groundAt } from './course/queries';
import { decodeLimbs, sanitizeLimbs } from './limbs';
import step from './physics';
import {
  createRunner, settle, shatter, swapLimbs,
} from './runner';
import type {
  Course, EncodedLimbs, Limbs, Runner, Shattered,
} from './types';

/** [physics step, limbs drawn just before that step (packLimbs)] */
export type RunInput = [number, EncodedLimbs];

/** Most drawings a run may contain. */
export const MAX_INPUTS = 400;

/** The player at the start line, as a race begins. */
export function runnerAtStart(course: Course, limbs: Limbs, color = ''): Runner {
  const runner = createRunner(limbs, color);
  settle(course, runner, course.startX);
  return runner;
}

/**
 * One physics step of a player's runner: moves it, breaks limbs that touched spikes, and puts it
 * back on the ground if it fell out of the world. Returns what broke, or null.
 */
export function stepPlayer(course: Course, runner: Runner, limbs: Limbs): Shattered | null {
  step(course, runner, CFG.DT);
  const broken = shatter(course, runner, limbs);
  const body = broken ? broken.runner : runner;
  if (body.y > groundAt(course, body.x) + 400) {
    settle(course, body, body.x);
    body.vx = 0;
    body.vy = 0;
  }
  return broken;
}

/** Checks the shape of recorded inputs. Returns them cleaned, or null. */
export function cleanInputs(value: unknown): RunInput[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_INPUTS) return null;
  const out: RunInput[] = [];
  const ok = value.every((item, i) => {
    if (!Array.isArray(item) || item.length !== 2) return false;
    const [at, raw] = item as [unknown, unknown];
    const limbs = sanitizeLimbs(raw);
    const prev = i ? out[i - 1][0] : 0;
    if (!Number.isInteger(at) || (at as number) < prev || !limbs) return false;
    if (i === 0 && at !== 0) return false;
    out.push([at as number, limbs]);
    return true;
  });
  return ok ? out : null;
}

/** Called after every step, for drawing a replay as a ghost. */
export type ReplayWatcher = (time: number, runner: Runner, limbs: Limbs) => void;

/**
 * Plays recorded inputs back on the course, for at most maxSteps physics steps. It can run in
 * slices (advance), so the server can spread a long run over several short requests.
 */
export class RunReplay {
  finished = false;

  /** Race clock at the finish (or where the replay has got to). */
  time = 0;

  steps = 0;

  private limbs: Limbs;

  private runner: Runner;

  private next = 1;

  constructor(
    private readonly course: Course,
    private readonly inputs: RunInput[],
    private readonly maxSteps: number,
    private readonly watch?: ReplayWatcher,
  ) {
    this.limbs = decodeLimbs(inputs[0][1]);
    this.runner = runnerAtStart(course, this.limbs);
  }

  get done(): boolean {
    return this.finished || this.steps >= this.maxSteps;
  }

  /** Runs up to `budget` more steps. Returns true once the replay is over. */
  advance(budget = Infinity): boolean {
    const { course, inputs } = this;
    const stop = Math.min(this.maxSteps, this.steps + budget);
    while (!this.finished && this.steps < stop) {
      while (this.next < inputs.length && inputs[this.next][0] === this.steps) {
        this.limbs = decodeLimbs(inputs[this.next][1]);
        this.runner = swapLimbs(course, this.runner, this.limbs);
        this.next += 1;
      }
      this.time += CFG.DT;
      this.steps += 1;
      const broken = stepPlayer(course, this.runner, this.limbs);
      if (broken) ({ runner: this.runner, limbs: this.limbs } = broken);
      this.watch?.(this.time, this.runner, this.limbs);
      if (this.runner.x >= course.finishX) this.finished = true;
    }
    return this.done;
  }
}
