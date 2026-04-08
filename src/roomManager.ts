import { Room } from './room.js';

export class RoomManager {
  private rooms = new Map<string, Room>();
  private rotation: number[];
  private lastRotate = new Map<string, number>();
  private rotateSeconds: number;

  constructor(mapRotation: number[] = [0], rotateSeconds = 0) {
    this.rotation = mapRotation;
    this.rotateSeconds = rotateSeconds;
    if (this.rotateSeconds > 0) {
      setInterval(() => this.tickRotation(), 1000);
    }
  }

  getOrCreate(id: string): Room {
    const key = id || '1';
    let room = this.rooms.get(key);
    if (!room) {
      room = new Room(key, this.rotation[0] ?? 1);
      this.rooms.set(key, room);
    }
    return room;
  }

  nextMap(room: Room): number {
    const idx = this.rotation.indexOf(room.mapId);
    const next = this.rotation[(idx + 1) % this.rotation.length] ?? room.mapId;
    room.setMap(next);
    this.lastRotate.set(room.id, Date.now());
    return next;
  }

  totalPlayers() {
    let sum = 0;
    for (const r of this.rooms.values()) sum += r.size;
    return sum;
  }

  private tickRotation() {
    const now = Date.now();
    if (this.rotateSeconds <= 0) return;
    for (const room of this.rooms.values()) {
      if (room.size === 0) continue;
      const last = this.lastRotate.get(room.id) ?? 0;
      if (now - last > this.rotateSeconds * 1000) {
        this.nextMap(room);
      }
    }
  }
}
