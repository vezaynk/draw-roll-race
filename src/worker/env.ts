import type { Directory } from './directory';
import type { RaceRoom } from './room';
import type { RunCheck } from './runCheck';

/** Workers Rate Limiting binding. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  ROOMS: DurableObjectNamespace<RaceRoom>;
  DIRECTORY: DurableObjectNamespace<Directory>;
  /** Replays daily runs (worker/runCheck.ts). */
  RUN_CHECK: DurableObjectNamespace<RunCheck>;
  /** Daily leaderboard (optional: without it, /api/daily answers 503). */
  DB?: D1Database;
  CREATE_LIMITER?: RateLimiter;
  SUBMIT_LIMITER?: RateLimiter;
  /** Workers Analytics Engine (optional). */
  STATS?: AnalyticsEngineDataset;
  /** "1" lets rooms start the short test courses (local test runs only). */
  ALLOW_TEST_STAGES?: string;
}
