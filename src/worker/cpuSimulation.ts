// Runs a room's CPU racers on the room's clock, with the same code the browser uses.
import { CFG } from '../shared/config';
import CpuRacer from '../shared/cpu/racer';
import { encodeLimbs } from '../shared/limbs';
import type { CpuState, RoomCpu } from '../shared/protocol';
import type {
  Course, EncodedLimbs, LimbKind, Pose,
} from '../shared/types';
import { wireNumber } from './roomState';

/** How often the CPUs advance and their positions are sent. */
const TICK_MS = 66;
/** Most simulated time per tick when catching up. */
const MAX_CATCH_UP = 1;

export interface CpuEvents {
  /** A CPU changed shape or lost limbs. */
  limbs(id: string, limbs: EncodedLimbs, pose: Pose, lost?: LimbKind[]): void;
  /** Positions of every CPU, once per tick. */
  positions(states: CpuState[]): void;
  /** A CPU crossed the line (time on the race clock). */
  finished(id: string, time: number): void;
}

export default class CpuSimulation {
  private readonly racers = new Map<string, CpuRacer>();

  /** Current limbs of each CPU, for people who join mid-race. */
  readonly limbs = new Map<string, EncodedLimbs>();

  private simTime = 0;

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    course: Course,
    cpus: RoomCpu[],
    private readonly startsAt: number,
    private readonly events: CpuEvents,
  ) {
    cpus.forEach((c) => {
      const racer = new CpuRacer(course, {
        seed: c.seed,
        difficulty: c.difficulty,
        color: c.color,
        onSwap: (limbs, pose, lost) => {
          const encoded = encodeLimbs(limbs);
          this.limbs.set(c.id, encoded);
          this.events.limbs(c.id, encoded, pose, lost);
        },
      });
      this.limbs.set(c.id, encodeLimbs(racer.limbs));
      this.racers.set(c.id, racer);
    });
  }

  get running(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.racers.size) this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    const now = (Date.now() - this.startsAt) / 1000;
    if (now <= 0) return;
    const target = Math.min(now, this.simTime + MAX_CATCH_UP);
    const finished: [string, number][] = [];
    const racers = [...this.racers];
    while (this.simTime < target) {
      this.simTime += CFG.DT;
      racers.forEach(([id, racer]) => {
        if (racer.finishTime !== null) return;
        racer.step(CFG.DT, this.simTime);
        if (racer.finishTime !== null) finished.push([id, racer.finishTime]);
      });
    }
    this.events.positions(racers.map(([id, { runner }]) => [
      id, wireNumber(runner.x), wireNumber(runner.y),
      wireNumber(runner.joints[0].angle), wireNumber(runner.joints[1].angle),
    ]));
    finished.forEach(([id, time]) => this.events.finished(id, time));
    if (racers.every(([, racer]) => racer.finishTime !== null)) this.stop();
  }
}
