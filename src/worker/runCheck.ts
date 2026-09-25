// Replays one daily run to time it (one Durable Object per submission). The Worker drives it in
// slices: every call is its own invocation with its own CPU allowance, so a long run never hits
// the per-request CPU limit. The replay lives in memory only; if the object restarts halfway,
// advance() returns null and the submission fails with a "try again".
import { DurableObject } from 'cloudflare:workers';
import buildCourse from '../shared/course/build';
import { RunReplay } from '../shared/replay';
import type { RunInput, SectionSplit } from '../shared/replay';
import type { Course } from '../shared/types';
import type { Env } from './env';

/** Physics steps per call (about 10 ms of CPU at worst). */
export const STEPS_PER_CALL = 500;

export interface ReplayProgress {
  done: boolean;
  finished: boolean;
  time: number;
  /** Time through each section, once the replay is done. */
  splits?: SectionSplit[];
}

const courses = new Map<number, Course>();
function courseFor(stage: number): Course {
  let course = courses.get(stage);
  if (!course) {
    if (courses.size > 4) courses.clear();
    course = buildCourse(stage);
    courses.set(stage, course);
  }
  return course;
}

export class RunCheck extends DurableObject<Env> {
  private replay: RunReplay | null = null;

  /** Sets up the replay (building the course takes a call of its own). */
  async begin(stage: number, inputs: RunInput[], maxSteps: number): Promise<void> {
    this.replay = new RunReplay(courseFor(stage), inputs, maxSteps);
  }

  async advance(): Promise<ReplayProgress | null> {
    const { replay } = this;
    if (!replay) return null;
    const done = replay.advance(STEPS_PER_CALL);
    if (done) this.replay = null;
    return {
      done, finished: replay.finished, time: replay.time, splits: done ? replay.splits : undefined,
    };
  }
}

export default RunCheck;
