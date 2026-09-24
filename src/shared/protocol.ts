// Messages between browsers and a room (worker/room.ts), and the data they carry.
import type { Difficulty } from './cpu/personality';
import type {
  EncodedLimbs, LimbKind, Pose,
} from './types';

/** People and CPUs in one room. */
export const MAX_RACERS = 8;

/** Room codes: 5 characters with no 0/O/1/I/L, so they are easy to read aloud. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_RE = /^[A-HJKMNP-Z2-9]{5}$/;

export interface PlayerInfo {
  id: string;
  name: string;
  color: string;
  joinedAt: number;
  limbs?: EncodedLimbs | null;
}

export interface RoomCpu {
  id: string;
  name: string;
  color: string;
  difficulty: Difficulty;
  seed: number;
}

export interface RaceResult {
  id: string;
  name: string;
  color: string;
  /** Seconds, or null for gave up / did not finish. */
  time: number | null;
  cpu: boolean;
  /** A CPU that did not finish in time. */
  dnf?: boolean;
}

export type RoomPhase = 'lobby' | 'racing';

export interface RoomInfo {
  code: string | null;
  name: string;
  isPublic: boolean;
  phase: RoomPhase;
  stage: number;
  raceId: number;
  hostId: string | null;
  participants: string[];
  results: RaceResult[];
  lastResults: RaceResult[];
  cpus: RoomCpu[];
}

/** An entry in the public room list. */
export interface ListedRoom {
  code: string;
  name: string;
  host: string;
  players: number;
  cpus: number;
  phase: RoomPhase;
}

/** [id, x, y, arm angle, leg angle] */
export type CpuState = [string, number, number, number, number];

export type ClientMessage =
  | { type: 'state'; r: number; x: number; y: number; a: number; b: number }
  | { type: 'limbs'; limbs: EncodedLimbs; lost?: LimbKind[] }
  | { type: 'name'; name: string }
  | { type: 'settings'; isPublic?: boolean; name?: string }
  | { type: 'addCpu'; difficulty: Difficulty }
  | { type: 'removeCpu'; id: string }
  | { type: 'start'; stage: number }
  | { type: 'finish'; r: number; time: number }
  | { type: 'giveup'; r: number };

export type ServerMessage =
  | {
    type: 'welcome'; you: string; resumed: boolean; room: RoomInfo; players: PlayerInfo[];
    cpuLimbs: Record<string, EncodedLimbs>;
  }
  | { type: 'join'; player: PlayerInfo; resumed: boolean }
  | { type: 'leave'; id: string; hostId: string | null }
  | { type: 'name'; id: string; name: string }
  | { type: 'settings'; isPublic: boolean; name: string }
  | { type: 'cpus'; cpus: RoomCpu[] }
  | { type: 'limbs'; id: string; limbs: EncodedLimbs; pose?: Pose; lost?: LimbKind[] }
  | {
    type: 'countdown'; raceId: number; stage: number; ms: number; participants: string[]; cpus: RoomCpu[];
  }
  | { type: 'state'; id: string; x: number; y: number; a: number; b: number }
  | { type: 'cpuStates'; s: CpuState[] }
  | { type: 'result'; raceId: number; result: RaceResult; place: number | null }
  | {
    type: 'raceEnd'; raceId: number; results: RaceResult[]; hostId: string | null; cpus: RoomCpu[];
  }
  | { type: 'notice'; message: string }
  | { type: 'error'; code: string; message: string };
