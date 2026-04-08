import { Socket } from 'net';
import { Room } from './room.js';
import { CMD, SUB, join, splitFrames, SEP, decodePacket } from './protocol.js';
import { PACKET_LOG_ENABLED, packet as logPacket } from './logger.js';

let nextCode = 1;

export class PlayerSession {
  readonly socket: Socket;
  private _name: string;
  readonly code: number;
  room?: Room;
  private carry: Buffer = Buffer.alloc(0);
  authed = false;
  isDead = false;
  score = 0;

  constructor(socket: Socket, name: string, room?: Room) {
    this.socket = socket;
    this._name = name;
    this.code = nextCode++;
    this.room = room;
  }

  get name() {
    return this._name;
  }

  rename(name: string) {
    this._name = name;
  }

  describe(): string {
    // name,code,mort,score,grosse
    return [this.name, this.code, 0, 0, 0].join(',');
  }

  private pretty(msg: string) {
    const printable = [...msg].map(ch => {
      const code = ch.charCodeAt(0);
      return code < 32 ? `\\x${code.toString(16).padStart(2, '0')}` : ch;
    }).join('');
    return printable;
  }

  logSend(msg: string) {
    if (!PACKET_LOG_ENABLED) return;
    logPacket('out', this.socket.remoteAddress ?? null, this.pretty(msg), decodePacket(msg));
  }

  logRecv(msg: string) {
    if (!PACKET_LOG_ENABLED) return;
    logPacket('in', this.socket.remoteAddress ?? null, this.pretty(msg), decodePacket(msg));
  }

  send(payload: string) {
    // Flash expects null-terminated UTF-8
    if (this.socket.destroyed || !this.socket.writable) return;
    try {
      this.socket.write(payload + '\0', 'utf8', () => {
        /* ignore write completion */
      });
      this.logSend(payload);
    } catch {
      /* swallow write errors (EPIPE/ECONNRESET) */
    }
  }

  feed(data: Buffer, onMessage: (frame: string) => void) {
    const { frames, rest } = splitFrames(data, this.carry);
    this.carry = rest;
    frames.forEach(onMessage);
  }

  handshake() {
    if (!this.room) return;
    // 26,8 => set name + code
    this.send(join(CMD.SYS, SUB.IDENT, [this.name, this.code]));
    // 5,5 => start round
    this.send(join(CMD.GAME, SUB.NEW_ROUND, [this.room.mapId]));
    // 8,9 => roster (includes self)
    this.room.sendRoster(this);
    // 8,21 => who is synchronizer
    this.room.sendSyncFlags();
    this.room.sendChaman();
    // 5,21 => acknowledge room join
    this.send(join(CMD.GAME, SUB.JOIN_ROOM_ACK, [this.room.id]));
  }

  goodbye() {
    try {
      this.socket.end();
    } catch {
      /* ignore */
    }
  }

  close() {
    this.socket.destroy();
  }
}
