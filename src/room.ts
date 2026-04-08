import { PlayerSession } from './session.js';
import { CMD, SUB, join, SEP } from './protocol.js';

export class Room {
  readonly id: string;
  mapId: number;
  private members: Map<number, PlayerSession> = new Map();
  private synchronizerId: number | null = null;
  private chamanId: number | null = null;
  private heartbeat?: NodeJS.Timeout;
  private worldTimer?: NodeJS.Timeout;

  constructor(id: string, mapId = 1) {
    this.id = id;
    this.mapId = mapId;
    this.startHeartbeat();
  }

  get size() {
    return this.members.size;
  }

  add(player: PlayerSession) {
    this.members.set(player.code, player);
    player.isDead = false;
    if (this.synchronizerId === null) {
      this.synchronizerId = player.code;
    }
    if (this.chamanId === null) {
      this.chamanId = player.code;
    }
    const connectMsg = join(CMD.PLAYER, SUB.CONNECT, [player.describe()]);
    this.broadcast(connectMsg, player);
    // also send to the joining player so it spawns itself immediately
    player.send(connectMsg);
    this.sendSyncFlags();
    this.sendChaman();
  }

  remove(player: PlayerSession) {
    this.members.delete(player.code);
    this.broadcast(join(CMD.PLAYER, SUB.DISCONNECT, [player.code, player.name]), player);
    if (this.synchronizerId === player.code) {
      const first = this.members.values().next();
      this.synchronizerId = first.done ? null : first.value.code;
      this.sendSyncFlags();
    }
    if (this.chamanId === player.code) {
      const first = this.members.values().next();
      this.chamanId = first.done ? null : first.value.code;
      this.sendChaman();
    }
  }

  broadcast(payload: string, except?: PlayerSession) {
    for (const p of this.members.values()) {
      if (p === except) continue;
      p.send(payload);
    }
  }

  getMember(code: number) {
    return this.members.get(code);
  }

  sendRoster(target: PlayerSession) {
    const parts = [...this.members.values()].map(p => p.describe());
    if (!target.socket.writable || target.socket.destroyed) return;
    target.send(join(CMD.PLAYER, SUB.LIST, parts));
  }

  sendSyncFlags() {
    if (this.synchronizerId == null) return;
    const code = this.synchronizerId;
    const msg = join(CMD.PLAYER, SUB.SET_MASTER, [code]);
    this.broadcast(msg);
  }

  sendChaman() {
    const code = this.chamanId ?? 'X';
    const payload = join(CMD.PLAYER, SUB.SET_SHAMAN, [code]);
    this.broadcast(payload);
  }

  setChaman(code: number | 'X') {
    this.chamanId = typeof code === 'number' ? code : null;
    this.sendChaman();
  }

  setSynchronizer(code: number) {
    this.synchronizerId = code;
    this.sendSyncFlags();
  }

  setMap(mapId: number) {
    this.mapId = mapId;
    // revive everyone for the new round
    for (const p of this.members.values()) {
      p.isDead = false;
    }
    // notify everyone about new map
    this.broadcast(join(CMD.GAME, SUB.NEW_ROUND, [mapId]));
    // re-send roster so clients respawn mice on fresh map
    for (const player of this.members.values()) {
      this.sendRoster(player);
    }
    this.sendSyncFlags();
    this.sendChaman();
    this.startWorldTimer();
  }

  private startHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      // light sync only (avoid chat spam)
      this.sendSyncFlags();
    }, 5000);
  }

  private startWorldTimer(durationSeconds = 120) {
    if (this.worldTimer) clearTimeout(this.worldTimer);
    this.worldTimer = setTimeout(() => {
      const next = this.mapId; // stay on same map if rotation is off
      this.setMap(next);
    }, durationSeconds * 1000);
  }

  private resetWorldTimer() {
    this.startWorldTimer();
  }

  joinAck(target: PlayerSession) {
    target.send(join(CMD.GAME, SUB.JOIN_ROOM_ACK, [this.id]));
  }

  handleMove(sender: PlayerSession, body: string[]) {
    sender.isDead = false;

    // body: [right, left, x, y, vx, vy, jump, frame]
    if (body.length >= 4) {
      const minX = -4;
      const maxX = 31;
      const minY = -15;
      const maxY = 20;
      let x = Number(body[2]);
      let y = Number(body[3]);
      let clamped = false;
      if (Number.isFinite(x)) {
        if (x < minX) {
          x = minX;
          clamped = true;
        } else if (x > maxX) {
          x = maxX;
          clamped = true;
        }
        body[2] = x.toFixed(3);
      }
      if (Number.isFinite(y)) {
        if (y < minY) {
          y = minY;
          clamped = true;
        } else if (y > maxY) {
          y = maxY;
          clamped = true;
        }
        body[3] = y.toFixed(3);
      }
      if (clamped) {
        // tell the player they hit the boundary
        sender.send(join(CMD.CHAT, SUB.SYS_CHAT, ['No cheese for you! ^_^']));
      }
    }

    // broadcast raw body to others
    const msg = CMD.STATE + SUB.MOVE + SEP + body.join(SEP);
    // echo back to sender so its local client updates immediately
    sender.send(msg);
    this.broadcast(msg, sender);
  }

  handleMobileSync(sender: PlayerSession, serialized: string) {
    // forward physics authoritative state
    this.broadcast(CMD.STATE + SUB.MOBILE_SYNC + SEP + serialized, sender);
  }

  handleFace(sender: PlayerSession, dir: string) {
    this.broadcast(join(CMD.STATE, SUB.FACE, [dir]), sender);
  }

  handleChat(sender: PlayerSession, text: string) {
    this.broadcast(join(CMD.CHAT, SUB.CHAT_MSG, [sender.code, sender.name, text]));
  }

  handleObjectSpawn(sender: PlayerSession, fields: string[]) {
    this.broadcast(CMD.GAME + SUB.SPAWN_OBJECT + SEP + fields.join(SEP), sender);
  }

  handleLinks(sender: PlayerSession, body: string) {
    this.broadcast(CMD.GAME + SUB.LINKS + SEP + body, sender);
  }

  handleInvocation(sender: PlayerSession, body: string[]) {
    this.broadcast(CMD.GAME + SUB.INVOCATION + SEP + body.join(SEP), sender);
  }

  handleInvocationEnd(sender: PlayerSession) {
    this.broadcast(join(CMD.GAME, SUB.INVOCATION_END, [sender.code]), sender);
  }

  handleExplosion(sender: PlayerSession, fields: string[]) {
    this.broadcast(CMD.GAME + SUB.EXPLOSION + SEP + fields.join(SEP), sender);
  }

  handleCheese(sender: PlayerSession, fields: string[]) {
    this.broadcast(CMD.GAME + SUB.CHEESE_MOVE + SEP + fields.join(SEP), sender);
  }

  handleBigMouse(sender: PlayerSession) {
    this.broadcast(join(CMD.GAME, SUB.BIG_MOUSE, [sender.code]), sender);
  }

  handleCheeseEat(sender: PlayerSession) {
    this.broadcast(join(CMD.GAME, SUB.CHEESE_EAT, [sender.code]), sender);
  }

  handleRoomBroadcast(sender: PlayerSession, text: string) {
    this.broadcast(join(CMD.GAME, SUB.ROOM_BROADCAST, [text]), sender);
  }

  handlePlayerDied(sender: PlayerSession, score: number) {
    sender.isDead = true;
    sender.score = Math.max(0, sender.score - 1);
    const msg = join(CMD.PLAYER, SUB.KILL, [sender.code, 0, sender.score]);
    this.broadcast(msg);
    const allDead = [...this.members.values()].every(p => p.isDead);
    if (allDead) {
      this.setMap(this.mapId); // restart same map
      return;
    }
    // If single player in room and they died, advance immediately.
    if (this.members.size === 1) {
      this.setMap(this.mapId); // reuse same map ID; change here if rotation desired
    }
  }
}
