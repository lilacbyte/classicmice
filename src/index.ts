import { createServer, Socket } from 'net';
import http from 'http';
import dotenv from 'dotenv';
import { routeMessage } from './handlers.js';
import { PlayerSession } from './session.js';
import { getDb } from './db.js';
import { RoomManager } from './roomManager.js';
import { CMD, SUB, SEP, join } from './protocol.js';
import { CommandDeps, handleSlashCommand } from './commands.js';
import crypto from 'crypto';
import { info, warn } from './logger.js';

dotenv.config();

const PORT = Number(process.env.PORT || 1000);
const DEFAULT_ROOM = process.env.DEFAULT_ROOM || '1';
let MAP_ROTATION = (process.env.MAP_ROTATION || '0')
  .split(',')
  .map(n => parseInt(n, 10))
  .filter(n => Number.isFinite(n));
if (MAP_ROTATION.length === 0) MAP_ROTATION = [0];
const MAP_ROTATE_SECONDS = Number(process.env.MAP_ROTATE_SECONDS || 0); // 0 = disable rotation
const ADMIN_NAMES = new Set(
  (process.env.ADMIN_NAMES || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
);
const API_PORT = Number(process.env.API_PORT || 3000);
const AUTO_REGISTER = (process.env.AUTO_REGISTER || 'true').toLowerCase() === 'true';

const manager = new RoomManager(MAP_ROTATION, MAP_ROTATE_SECONDS);
const db = getDb();
const POLICY = `<cross-domain-policy><allow-access-from domain="*" to-ports="${PORT}" /></cross-domain-policy>`;

function extractId(result: any): number | null {
  if (result == null) return null;
  if (Array.isArray(result)) return extractId(result[0]);
  if (typeof result === 'number') return result;
  if (typeof result === 'bigint') return Number(result);
  if (typeof result === 'object') {
    if ('id' in result && result.id != null) return Number((result as any).id);
    if ('insertId' in result && result.insertId != null) return Number((result as any).insertId);
  }
  return null;
}

const NAME_REGEX = /^[A-Za-z0-9_]{3,16}$/;

function cleanName(name?: string) {
  if (!name) return null;
  const trimmed = name.trim();
  if (!NAME_REGEX.test(trimmed)) return null;
  return trimmed;
}

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function makeRawToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function isAdmin(name: string) {
  return ADMIN_NAMES.has(name.toLowerCase());
}

createServer(socket => {
  const session = new PlayerSession(socket, 'Unknown');
  let added = false;
  let playerId: number | null = null;
  let sessionId: number | null = null;
  let handshakeDone = false;

  const ip = socket.remoteAddress || null;
  const peerLabel = () => session.name || `player#${session.code}`;
  info(`[${peerLabel()}] peer (${ip ?? 'unknown'}) connected`);

  async function persistSession(_session: PlayerSession, roomId: string) {
    try {
      if (!playerId) return;
      const numericRoom = Number.isNaN(Number(roomId)) ? null : Number(roomId);
      if (numericRoom && !(await db('rooms').where({ id: numericRoom }).first('id'))) {
        const mapId = session.room?.mapId ?? 0;
        await db('rooms').insert({ id: numericRoom, name: `Room ${roomId}`, map_id: mapId });
      }
      const sidRes: any = await db('sessions').insert({
        player_id: playerId,
        room_id: numericRoom || null,
        last_ip: ip
      });
      sessionId = extractId(sidRes);
    } catch (err) {
      warn(`db write failed: ${(err as any)?.message ?? err}`);
    }
  }

  function switchRoom(targetSession: PlayerSession, targetId: string) {
    const nextRoom = manager.getOrCreate(targetId || DEFAULT_ROOM);
    if (added && targetSession.room) {
      targetSession.room.remove(targetSession);
    }
    targetSession.room = nextRoom;
    nextRoom.add(targetSession);
    added = true;
    targetSession.handshake();
  }

  function sendSys(session: PlayerSession, text: string) {
    session.send(join(CMD.SYS, SUB.SYS_MSG, [text]));
  }

  const slashDeps: CommandDeps = {
    defaultRoom: DEFAULT_ROOM,
    isAdmin,
    switchRoom,
    persistSession,
    sendSys,
    manager
  };

  const slashHandler = (s: PlayerSession, cmd: string, args: string[]) =>
    handleSlashCommand(slashDeps, s, cmd, args);

  socket.on('data', chunk => {
    session.feed(chunk, async frame => {
      if (!frame) return;
      if (frame.indexOf('policy-file-request') !== -1) {
        try {
          socket.write(POLICY + '\0', 'utf8');
        } catch {
          /* ignore */
        }
        return;
      }
      const firstCode = frame.charCodeAt(0);
      if (!handshakeDone && firstCode >= 32) {
        // version string only
        handshakeDone = true;
        session.send(CMD.SYS + SUB.VERSION_OK + SEP + manager.totalPlayers());
        return;
      }

      if (frame.charAt(0) === CMD.SYS && frame.charAt(1) === SUB.REGISTER) {
        const [, ...rest] = frame.split(SEP);
        const username = cleanName(rest[0]);
        const password = rest[1];
        const startRoom = rest[2] || DEFAULT_ROOM;
        if (!username || !password) {
          sendSys(session, 'Login required (name + token)');
          session.close();
          return;
        }
        const hash = hashToken(password);
        const existing = await db('players').where({ name: username }).first('id');
        if (existing) {
          sendSys(session, 'Nickname already taken');
          session.close();
          return;
        }
        const idRes: any = await db('players').insert({ name: username, auth_token: hash });
        playerId = extractId(idRes);
        session.rename(username);
        session.authed = true;
        const room = manager.getOrCreate(startRoom);
        session.room = room;
        room.add(session);
        added = true;
        session.handshake();
        await persistSession(session, startRoom);
        return;
      }

      if (frame.charAt(0) === CMD.SYS && frame.charAt(1) === SUB.LOGIN) {
        const [, ...rest] = frame.split(SEP);
        const username = cleanName(rest[0]);
        const password = rest[1];
        const startRoom = rest[2] || DEFAULT_ROOM;
        if (!username || !password) {
          sendSys(session, 'Login required (name + token)');
          session.close();
          return;
        }
        let existing = await db('players').where({ name: username }).first(['id', 'auth_token']);
        if (!existing && AUTO_REGISTER) {
          const idRes: any = await db('players').insert({ name: username, auth_token: hashToken(password) });
          existing = { id: extractId(idRes), auth_token: hashToken(password) };
        }
        if (!existing) {
          sendSys(session, 'Unknown account. Register via /auth/register API.');
          session.close();
          return;
        }
        const hashed = hashToken(password);
        const hashedSha512 = crypto.createHash('sha512').update(password).digest('hex');
        if (existing.auth_token !== hashed && existing.auth_token !== hashedSha512) {
          sendSys(session, 'Invalid token');
          session.close();
          return;
        }
        playerId = existing.id;
        await db('players').where({ id: playerId }).update({ last_seen: db.fn.now() });
        session.rename(username);
        session.authed = true;
        const room = manager.getOrCreate(startRoom);
        session.room = room;
        room.add(session);
        added = true;
        session.handshake();
        await persistSession(session, startRoom);
        return;
      }

      if (!added) return;
      routeMessage(session, frame, manager, slashHandler);
    });
  });

  socket.on('close', () => {
    if (added && session.room) {
      session.room.remove(session);
    }
    if (sessionId) {
      db('sessions').where({ id: sessionId }).update({ disconnected_at: db.fn.now() }).catch(() => {});
    }
    info(`[${peerLabel()}] peer (${ip ?? 'unknown'}) disconnected`);
  });

  socket.on('error', err => {
    if (err && ((err as any).code === 'ECONNRESET' || (err as any).code === 'EPIPE')) {
      session.close();
      return;
    }
    warn(`socket error: ${(err as any)?.message ?? err}`);
    session.close();
  });
}).listen(PORT, () => {
  info(`server started on port ${PORT}`);
});

async function getOrCreatePlayer(name: string, password: string) {
  const tokenHash = hashToken(password);
  const existing = await db('players').where({ name }).first(['id', 'auth_token']);
  if (existing) {
    if (existing.auth_token && existing.auth_token !== tokenHash) {
      throw new Error('Invalid password');
    }
    await db('players').where({ id: existing.id }).update({ auth_token: tokenHash, last_seen: db.fn.now() });
    return { playerId: existing.id, token: password };
  }
  const idRes: any = await db('players').insert({ name, auth_token: tokenHash });
  const playerId = extractId(idRes);
  return { playerId, token: password };
}

const api = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  if (req.method !== 'POST' || (url.pathname !== '/auth/register' && url.pathname !== '/auth/token')) {
    res.writeHead(404).end();
    return;
  }
  let body = '';
  req.on('data', chunk => (body += chunk));
  req.on('end', async () => {
    try {
      const data = JSON.parse(body || '{}');
      const name = cleanName(data.name);
      const password = typeof data.password === 'string' ? data.password : null;
      if (!name || !password) {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'name/password required' }));
        return;
      }
      const { token } = await getOrCreatePlayer(name, password);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ token }));
    } catch (err: any) {
      const msg = err?.message || 'server error';
      res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: msg }));
    }
  });
});

api.listen(API_PORT, () => {
  info(`API listening on port ${API_PORT}`);
});
