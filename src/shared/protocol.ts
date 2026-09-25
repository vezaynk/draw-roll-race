// Messages between browsers and a room (worker/room.ts), and the data they carry.
import type { Look } from './look';
import type { RunInput } from './replay';
import type {
  EncodedLimbs, LimbKind, Pose,
} from './types';

/** People in one room. */
export const MAX_RACERS = 8;

/** Room codes: 5 characters with no 0/O/1/I/L, so they are easy to read aloud. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_RE = /^[A-HJKMNP-Z2-9]{5}$/;

/** Quick reactions anyone in a room can send. */
export const EMOTES = ['👋', '😂', '😮', '🔥', '👏', '😭'] as const;

/** Course choices besides a stage number: a new random course, or the last course again. */
export const RANDOM_COURSE = -1;
export const SAME_COURSE = -2;

export interface PlayerInfo {
  id: string;
  name: string;
  color: string;
  joinedAt: number;
  limbs?: EncodedLimbs | null;
  look?: Look;
}

export interface RaceResult {
  id: string;
  name: string;
  color: string;
  /** Seconds, or null for gave up / did not finish. */
  time: number | null;
  /**
   * People's finishes are checked by replaying their run on the server: pending until the replay
   * is done, then ok or failed.
   */
  verify?: 'pending' | 'ok' | 'failed';
  /** How long the check took. */
  verifySeconds?: number;
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
  /** People who are ready for the next race; when everyone is, it starts. */
  ready: string[];
  /** The course the next race uses (a stage, RANDOM_COURSE or SAME_COURSE). */
  nextStage: number;
}

/** An entry in the public room list. */
export interface ListedRoom {
  code: string;
  name: string;
  host: string;
  players: number;
  phase: RoomPhase;
}

export type ClientMessage =
  | { type: 'state'; r: number; x: number; y: number; a: number; b: number }
  | { type: 'limbs'; limbs: EncodedLimbs; lost?: LimbKind[] }
  | { type: 'name'; name: string }
  | { type: 'settings'; isPublic?: boolean; name?: string; nextStage?: number }
  | { type: 'ready'; ready: boolean }
  | { type: 'look'; look: Look }
  | { type: 'emote'; e: number }
  | { type: 'start'; stage: number }
  | { type: 'finish'; r: number; time: number; inputs: RunInput[] }
  | { type: 'giveup'; r: number };

export type ServerMessage =
  | {
    type: 'welcome'; you: string; resumed: boolean; room: RoomInfo; players: PlayerInfo[];
  }
  | { type: 'join'; player: PlayerInfo; resumed: boolean }
  | { type: 'leave'; id: string; hostId: string | null }
  | { type: 'name'; id: string; name: string }
  | { type: 'settings'; isPublic: boolean; name: string; nextStage: number }
  | { type: 'ready'; ids: string[] }
  | { type: 'look'; id: string; look: Look }
  | { type: 'emote'; id: string; e: number }
  | { type: 'limbs'; id: string; limbs: EncodedLimbs; pose?: Pose; lost?: LimbKind[] }
  | {
    type: 'countdown'; raceId: number; stage: number; ms: number; participants: string[];
  }
  | { type: 'state'; id: string; x: number; y: number; a: number; b: number }
  | { type: 'result'; raceId: number; result: RaceResult; place: number | null }
  | {
    type: 'verified'; raceId: number; id: string; ok: boolean; time: number | null; seconds: number;
  }
  | {
    type: 'raceEnd'; raceId: number; results: RaceResult[]; hostId: string | null;
  }
  | { type: 'notice'; message: string }
  | { type: 'error'; code: string; message: string };
