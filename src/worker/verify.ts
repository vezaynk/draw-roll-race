// Verifies a run by replaying its recorded inputs (what was drawn at which physics step) in a
// RunCheck Durable Object, a slice at a time, so no single invocation uses much CPU time. Used by
// the daily leaderboard and by rooms.
import { CFG } from '../shared/config';
import type { RunInput } from '../shared/replay';
import type { Env } from './env';
import type { ReplayProgress } from './runCheck';

export interface Verdict {
  /** The replay reached the finish. */
  finished: boolean;
  /** Race clock at the finish, by the replay (or where it stopped). */
  time: number;
  /** How long the check took (milliseconds). */
  ms: number;
}

/** Replays a run on stage `stage` for at most maxSeconds of race time. Throws if the check fails to run. */
export default async function verifyRun(
  env: Env,
  stage: number,
  inputs: RunInput[],
  maxSeconds: number,
): Promise<Verdict> {
  const started = Date.now();
  const check = env.RUN_CHECK.get(env.RUN_CHECK.newUniqueId());
  await check.begin(stage, inputs, Math.ceil(maxSeconds / CFG.DT));
  let progress: ReplayProgress | null;
  do {
    // Each slice waits on the one before it.
    progress = await check.advance();
    if (!progress) throw new Error('replay lost its state');
  } while (!progress.done);
  return { finished: progress.finished, time: progress.time, ms: Date.now() - started };
}
