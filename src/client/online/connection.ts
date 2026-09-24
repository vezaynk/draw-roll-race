// The WebSocket to a room, with reconnects. Each tab keeps a token per room, so a dropped
// connection or a reload rejoins as the same racer.
import type { ClientMessage, ServerMessage } from '../../shared/protocol';
import { randomId } from '../dom';

const MAX_RETRIES = 5;

/** Only the creator sends these: they set up the room. */
export interface RoomSetup {
  isPublic: boolean;
  roomName: string;
}

export interface ConnectionEvents {
  message(msg: ServerMessage): void;
  /** Connection lost; `retrying` is false once it gives up. */
  lost(retrying: boolean): void;
}

function roomToken(code: string): string {
  const key = `draw-roll-race-token-${code}`;
  try {
    let token = sessionStorage.getItem(key);
    if (!token) {
      token = randomId();
      sessionStorage.setItem(key, token);
    }
    return token;
  } catch {
    return '';
  }
}

export default class RoomConnection {
  private ws: WebSocket | null = null;

  private retries = 0;

  private closed = false;

  constructor(
    readonly code: string,
    private readonly name: () => string,
    private readonly events: ConnectionEvents,
  ) {}

  open(setup?: RoomSetup): void {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const query = new URLSearchParams({ name: this.name() });
    const token = roomToken(this.code);
    if (token) query.set('token', token);
    if (setup) {
      query.set('public', setup.isPublic ? '1' : '0');
      if (setup.roomName) query.set('room_name', setup.roomName);
    }
    const ws = new WebSocket(`${proto}//${window.location.host}/api/rooms/${this.code}/ws?${query}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retries = 0;
    };
    ws.onmessage = (e) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === 'error') this.closed = true;
      this.events.message(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws || this.closed) return;
      this.ws = null;
      const retrying = this.retries < MAX_RETRIES;
      this.events.lost(retrying);
      if (!retrying) return;
      const wait = 500 * 2 ** this.retries;
      this.retries += 1;
      window.setTimeout(() => {
        if (!this.closed) this.open();
      }, wait);
    };
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.closed = true;
    this.ws?.close(1000, 'leave');
    this.ws = null;
  }
}
