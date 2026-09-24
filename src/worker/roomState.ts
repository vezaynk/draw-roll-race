// What a room stores between messages (Durable Object storage), and small helpers about it.
import type { RaceResult, RoomCpu, RoomPhase } from '../shared/protocol';

/** A player who dropped: they can come back as themselves until `until`. */
export interface AwayPlayer {
  id: string;
  name: string;
  color: string;
  joinedAt: number;
  until: number;
}

export interface RoomState {
  code: string | null;
  name: string;
  isPublic: boolean;
  phase: RoomPhase;
  stage: number;
  raceId: number;
  startsAt: number;
  /** Once every person is done, when the CPUs' extra time runs out (0 when not in use). */
  graceUntil: number;
  hostId: string | null;
  joins: number;
  participants: string[];
  results: RaceResult[];
  lastResults: RaceResult[];
  cpus: RoomCpu[];
  cpuSerial: number;
  /** Reconnect token -> player who dropped. */
  away: Record<string, AwayPlayer>;
}

export function freshRoom(): RoomState {
  return {
    code: null,
    name: '',
    isPublic: false,
    phase: 'lobby',
    stage: 0,
    raceId: 0,
    startsAt: 0,
    graceUntil: 0,
    hostId: null,
    joins: 0,
    participants: [],
    results: [],
    lastResults: [],
    cpus: [],
    cpuSerial: 0,
    away: {},
  };
}

/** What each open connection carries (WebSocket attachment). */
export interface Player {
  id: string;
  name: string;
  color: string;
  joinedAt: number;
  token: string | null;
}

/** Connections replaced by a reconnect, or already leaving, carry no player. */
export type Attachment = Player | { replaced: true } | { left: true };

export function isPlayer(a: Attachment | null | undefined): a is Player {
  return !!a && 'id' in a;
}

export const hasFinished = (room: RoomState, id: string): boolean => room.results
  .some((r) => r.id === id);

export const isCpuId = (id: string): boolean => id.startsWith('cpu-');

/** Rounds a position or angle for the wire. */
export const wireNumber = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v)
  ? Math.round(v * 10) / 10
  : 0);
