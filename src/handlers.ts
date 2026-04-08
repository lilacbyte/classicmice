import { CMD, SUB, SEP, join, decodeLabel } from './protocol.js';
import { PlayerSession } from './session.js';
import { RoomManager } from './roomManager.js';

export type SlashHandler = (session: PlayerSession, command: string, args: string[]) => Promise<void> | void;

export function routeMessage(session: PlayerSession, raw: string, roomManager: RoomManager, onSlash: SlashHandler) {
  if (!raw) return;
  session.logRecv(raw);
  const firstCode = raw.charCodeAt(0);
  if (firstCode >= 32) {
    return;
  }

  const cmd1 = raw.charAt(0);
  const cmd2 = raw.charAt(1);
  const body = raw.slice(2);
  const parts = body ? body.split(SEP).slice(1) : []; // body starts with SEP

  if (!session.room || !session.authed) return;

  if (cmd1 === CMD.STATE && cmd2 === SUB.MOVE) {
    session.room.handleMove(session, parts);
    return;
  }

  if (cmd1 === CMD.STATE && cmd2 === SUB.MOBILE_SYNC) {
    session.room.handleMobileSync(session, parts.join(SEP));
    return;
  }

  if (cmd1 === CMD.STATE && cmd2 === SUB.FACE) {
    const [dir] = parts;
    session.room.handleFace(session, dir ?? '0');
    return;
  }

  if (cmd1 === CMD.STATE && cmd2 === SUB.REQUEST_MASTER) {
    session.room.setSynchronizer(session.code);
    return;
  }

  if (cmd1 === CMD.CHAT && cmd2 === SUB.CHAT_MSG) {
    const [text] = parts.slice(-1); // last is text, part[1] is name from client
    session.room.handleChat(session, text ?? '');
    return;
  }

  if (cmd1 === CMD.CHAT && cmd2 === SUB.SLASH) {
    const [commandLine] = parts;
    if (commandLine) {
      const [cmd, ...rest] = commandLine.split(/\s+/);
      Promise.resolve(onSlash(session, cmd.toLowerCase(), rest)).catch(() => {});
    }
    return;
  }

  if (cmd1 === CMD.GAME && cmd2 === SUB.SPAWN_OBJECT) {
    session.room.handleObjectSpawn(session, parts);
    return;
  }

  if (cmd1 === CMD.GAME && cmd2 === SUB.JOIN_ROOM_ACK) {
    // Client may ping; respond with current room id to silence unknown spam.
    session.send(join(CMD.GAME, SUB.JOIN_ROOM_ACK, [session.room.id]));
    return;
  }

  if (cmd1 === CMD.GAME && cmd2 === SUB.INVOCATION) {
    session.room.handleInvocation(session, parts);
    return;
  }

  if (cmd1 === CMD.GAME && cmd2 === SUB.INVOCATION_END) {
    session.room.handleInvocationEnd(session);
    return;
  }

  if (cmd1 === CMD.GAME && cmd2 === SUB.LINKS) {
    session.room.handleLinks(session, parts.join(SEP));
    return;
  }

  if (cmd1 === CMD.GAME && cmd2 === SUB.EXPLOSION) {
    session.room.handleExplosion(session, parts);
    return;
  }

  if (cmd1 === CMD.GAME && cmd2 === SUB.CHEESE_MOVE) {
    session.room.handleCheese(session, parts);
    return;
  }

  if (cmd1 === CMD.GAME && cmd2 === SUB.CHEESE_EAT) {
    session.room.handleCheeseEat(session);
    return;
  }

  if (cmd1 === CMD.GAME && cmd2 === SUB.BIG_MOUSE) {
    session.room.handleBigMouse(session);
    return;
  }

  if (cmd1 === CMD.STATE && cmd2 === SUB.OUT_OF_BOUNDS) {
    session.room.handlePlayerDied(session, session.score);
    return;
  }

  if (cmd1 === CMD.GAME && cmd2 === SUB.ROOM_BROADCAST) {
    session.room.handleRoomBroadcast(session, parts.join(SEP));
    return;
  }

  if (cmd1 === CMD.STATE && cmd2 === SUB.HEARTBEAT) {
    // keep-alive, no-op
    return;
  }

  // Unknown -> send sys message
  session.send(join(CMD.SYS, SUB.SYS_MSG, [`Unknown ${cmd1.charCodeAt(0)}:${cmd2.charCodeAt(0)}`]));
}
