/**
 * Protocol constants reverse‑engineered from the Flash client in /scripts.
 * Messages are UTF-8 strings sent over a raw TCP socket (Flash XMLSocket)
 * and are implicitly terminated by a null byte (0x00).
 *
 * Format: [cmd1][cmd2][payload...]
 * - cmd1 and cmd2 are single characters with charCode < 32.
 * - Inside the payload, fields are separated by SEP (charCode = 1).
 */

export const SEP = String.fromCharCode(1);

// Primary command groups (charCode of first byte)
export const CMD = {
  GAME: String.fromCharCode(5),
  STATE: String.fromCharCode(4),
  CHAT: String.fromCharCode(6),
  PLAYER: String.fromCharCode(8),
  SYS: String.fromCharCode(26)
};

// Second byte command codes (charCode of second byte)
export const SUB = {
  // STATE (4)
  HEARTBEAT: String.fromCharCode(2),
  MOBILE_SYNC: String.fromCharCode(3),
  MOVE: String.fromCharCode(4),
  OUT_OF_BOUNDS: String.fromCharCode(5),
  FACE: String.fromCharCode(8),
  REQUEST_MASTER: String.fromCharCode(20),

  // GAME (5)
  NEW_ROUND: String.fromCharCode(5),
  LINKS: String.fromCharCode(7),
  INVOCATION: String.fromCharCode(8),
  INVOCATION_END: String.fromCharCode(9),
  CHEESE_EAT: String.fromCharCode(18),
  CHEESE_MOVE: String.fromCharCode(16),
  EXPLOSION: String.fromCharCode(17),
  BIG_MOUSE: String.fromCharCode(19),
  SPAWN_OBJECT: String.fromCharCode(20),
  JOIN_ROOM_ACK: String.fromCharCode(21),
  ROOM_BROADCAST: String.fromCharCode(22),

  // CHAT (6)
  CHAT_MSG: String.fromCharCode(6),
  SYS_CHAT: String.fromCharCode(20),
  SLASH: String.fromCharCode(26),

  // PLAYER (8)
  KILL: String.fromCharCode(5),
  DISCONNECT: String.fromCharCode(7),
  CONNECT: String.fromCharCode(8),
  LIST: String.fromCharCode(9),
  SET_SHAMAN: String.fromCharCode(20),
  SET_MASTER: String.fromCharCode(21),

  // SYS (26)
  SYS_MSG: String.fromCharCode(4),
  IDENT: String.fromCharCode(8),
  EXCEPTION: String.fromCharCode(25),
  VERSION_OK: String.fromCharCode(27),
  LOGIN: String.fromCharCode(4),
  REGISTER: String.fromCharCode(3)
};

export type RawMessage = string;

export function join(cmd1: string, cmd2: string, parts: (string | number | boolean)[] = []): string {
  const payload = parts.map(p => String(p)).join(SEP);
  return cmd1 + cmd2 + (payload ? SEP + payload : '');
}

export function decodeLabel(data: string): string {
  return data
    .split('')
    .map(c => c.charCodeAt(0))
    .join(',');
}

export function decodePacket(raw: string): string {
  if (!raw) return 'empty';
  const c0 = raw.charCodeAt(0);
  if (c0 >= 32) return `handshake/version "${raw}"`;
  const c1 = raw.charCodeAt(1);
  const cmd1 = raw.charAt(0);
  const cmd2 = raw.charAt(1);
  const parts = raw.split(SEP).slice(1);

  const label = (s: string) =>
    s
      .split('')
      .map(ch => {
        const code = ch.charCodeAt(0);
        return code < 32 ? `\\x${code.toString(16).padStart(2, '0')}` : ch;
      })
      .join('');

  // STATE
  if (cmd1 === CMD.STATE && cmd2 === SUB.MOVE) {
    const [right, left, x, y, vx, vy, jump, frame] = parts;
    return `state/move r=${right} l=${left} pos=(${x},${y}) vel=(${vx},${vy}) jump=${jump} frame=${frame}`;
  }
  if (cmd1 === CMD.STATE && cmd2 === SUB.MOBILE_SYNC) {
    return `state/mobile_sync (${parts.length} bodies)`;
  }
  if (cmd1 === CMD.STATE && cmd2 === SUB.OUT_OF_BOUNDS) {
    return `state/out_of_bounds target=${parts[0] ?? ''}`;
  }
  if (cmd1 === CMD.STATE && cmd2 === SUB.FACE) {
    return `state/face dir=${parts[0] ?? ''}`;
  }
  if (cmd1 === CMD.STATE && cmd2 === SUB.REQUEST_MASTER) {
    return `state/request_master`;
  }

  if (cmd1 === CMD.GAME && cmd2 === SUB.NEW_ROUND) return `game/new_round map=${parts[0] ?? ''}`;
  if (cmd1 === CMD.GAME && cmd2 === SUB.LINKS) return `game/links ${parts.join('|')}`;
  if (cmd1 === CMD.GAME && cmd2 === SUB.INVOCATION) return `game/invocation start ${parts.join(',')}`;
  if (cmd1 === CMD.GAME && cmd2 === SUB.INVOCATION_END) return `game/invocation end for ${parts[0] ?? ''}`;
  if (cmd1 === CMD.GAME && cmd2 === SUB.CHEESE_MOVE) return `game/cheese_move x=${parts[0]} y=${parts[1]}`;
  if (cmd1 === CMD.GAME && cmd2 === SUB.EXPLOSION) return `game/explosion ${parts.join(',')}`;
  if (cmd1 === CMD.GAME && cmd2 === SUB.BIG_MOUSE) return `game/big_mouse code=${parts[0] ?? ''}`;
  if (cmd1 === CMD.GAME && cmd2 === SUB.CHEESE_EAT) return `game/cheese_eat code=${parts[0] ?? ''}`;
  if (cmd1 === CMD.GAME && cmd2 === SUB.SPAWN_OBJECT) return `game/spawn_object ${parts.join(',')}`;
  if (cmd1 === CMD.GAME && cmd2 === SUB.JOIN_ROOM_ACK) return `game/join_room_ack room=${parts[0] ?? ''}`;
  if (cmd1 === CMD.GAME && cmd2 === SUB.ROOM_BROADCAST) return `game/room_broadcast ${parts.join(' ')}`;

  // CHAT
  if (cmd1 === CMD.CHAT && cmd2 === SUB.CHAT_MSG) return `chat msg="${parts[1] ?? ''}" from=${parts[0] ?? ''}`;
  if (cmd1 === CMD.CHAT && cmd2 === SUB.SLASH) return `chat slash "/${parts[0] ?? ''}"`;
  if (cmd1 === CMD.CHAT && cmd2 === SUB.SYS_CHAT) return `chat sys ${parts.join(' ')}`;

  // PLAYER
  if (cmd1 === CMD.PLAYER && cmd2 === SUB.CONNECT) return `player/connect ${parts.join(',')}`;
  if (cmd1 === CMD.PLAYER && cmd2 === SUB.DISCONNECT) return `player/disconnect code=${parts[0] ?? ''} name=${parts[1] ?? ''}`;
  if (cmd1 === CMD.PLAYER && cmd2 === SUB.LIST) return `player/list count=${parts.length}`;
  if (cmd1 === CMD.PLAYER && cmd2 === SUB.SET_SHAMAN) return `player/set_shaman code=${parts[0] ?? ''}`;
  if (cmd1 === CMD.PLAYER && cmd2 === SUB.SET_MASTER) return `player/set_master code=${parts[0] ?? ''}`;

  // SYS
  if (cmd1 === CMD.SYS && cmd2 === SUB.IDENT) return `sys/ident name=${parts[0] ?? ''} code=${parts[1] ?? ''}`;
  if (cmd1 === CMD.SYS && cmd2 === SUB.VERSION_OK) return `sys/version_ok players=${parts[0] ?? ''}`;
  if (cmd1 === CMD.SYS && cmd2 === SUB.SYS_MSG) return `sys/msg ${parts.join(' ')}`;

  return `unknown ${c0}:${c1} raw=${label(raw)}`;
}

/**
 * Split an incoming UTF-8 chunk into complete frames (Flash adds \0).
 */
export function splitFrames(buffer: Buffer, carry: Buffer = Buffer.alloc(0)): { frames: string[]; rest: Buffer } {
  const data = Buffer.concat([carry, buffer]);
  const frames: string[] = [];
  let start = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0) {
      frames.push(data.slice(start, i).toString('utf8'));
      start = i + 1;
    }
  }
  return { frames, rest: data.slice(start) };
}
