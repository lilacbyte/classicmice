import { PlayerSession } from './session.js';
import { RoomManager } from './roomManager.js';

type CommandDef = {
  name: string;
  usage: string;
  admin?: boolean;
  aliases?: string[];
  run: (args: string[]) => Promise<void> | void;
};

export type CommandDeps = {
  defaultRoom: string;
  isAdmin: (name: string) => boolean;
  switchRoom: (session: PlayerSession, id: string) => Promise<void> | void;
  persistSession: (session: PlayerSession, id: string) => Promise<void> | void;
  sendSys: (session: PlayerSession, text: string) => void;
  manager: RoomManager;
};

export async function handleSlashCommand(
  deps: CommandDeps,
  s: PlayerSession,
  cmd: string,
  args: string[]
): Promise<void> {
  const { defaultRoom, isAdmin, switchRoom, persistSession, sendSys, manager } = deps;

  const commands: CommandDef[] = [
    {
      name: 'help',
      usage: '/help [command]',
      run: helpArgs => {
        const allowed = commands.filter(c => !c.admin || isAdmin(s.name));
        const findCmd = (name: string) =>
          allowed.find(c => c.name === name || c.aliases?.includes(name));
        if (helpArgs[0]) {
          const target = findCmd(helpArgs[0].toLowerCase());
          if (!target) {
            sendSys(s, `Unknown command: /${helpArgs[0]}`);
            return;
          }
          sendSys(s, `${target.usage}${target.admin ? ' (admin only)' : ''}`);
          return;
        }
        const list = allowed.map(c => `${c.usage}${c.admin ? '*' : ''}`).join(', ');
        const suffix = allowed.some(c => c.admin) ? ' (* admin only)' : '';
        sendSys(s, `Commands: ${list}${suffix}`);
      }
    },
    {
      name: 'ping',
      usage: '/ping',
      run: () => sendSys(s, 'Pong!')
    },
    {
      name: 'room',
      usage: '/room <id>',
      run: async roomArgs => {
        const id = roomArgs[0] || defaultRoom;
        switchRoom(s, id);
        sendSys(s, `Room changed to ${id}`);
        await persistSession(s, id);
      }
    },
    {
      name: 'map',
      usage: '/map <id>',
      admin: true,
      run: mapArgs => {
        const id = parseInt(mapArgs[0], 10);
        if (!Number.isFinite(id)) {
          sendSys(s, 'Usage: /map <id>');
          return;
        }
        s.room?.setMap(id);
        sendSys(s, `Map ${id}`);
      }
    },
    {
      name: 'nextmap',
      usage: '/nextmap',
      admin: true,
      run: () => {
        if (!s.room) {
          sendSys(s, 'No room assigned');
          return;
        }
        const next = manager.nextMap(s.room);
        sendSys(s, `Next map ${next}`);
      }
    },
    {
      name: 'guide',
      aliases: ['chaman'],
      usage: '/guide <code|X>',
      admin: true,
      run: guideArgs => {
        const arg = guideArgs[0];
        const code = arg === 'X' ? 'X' : parseInt(arg ?? '', 10);
        if (arg === 'X' || Number.isFinite(code)) {
          s.room?.setChaman(arg === 'X' ? 'X' : (code as number));
        } else {
          sendSys(s, 'Usage: /guide <code|X>');
        }
      }
    },
    {
      name: 'kick',
      usage: '/kick <code>',
      admin: true,
      run: kickArgs => {
        const code = parseInt(kickArgs[0] ?? '', 10);
        const target = Number.isFinite(code) ? s.room?.getMember(code) : undefined;
        if (!target) {
          sendSys(s, 'Player not found');
          return;
        }
        sendSys(s, `Kick ${target.name}`);
        target.close();
      }
    },
    {
      name: 'bc',
      usage: '/bc <message>',
      admin: true,
      run: bcArgs => {
        const msg = bcArgs.join(' ');
        s.room?.handleRoomBroadcast(s, msg);
      }
    }
  ];

  const match = commands.find(c => c.name === cmd || c.aliases?.includes(cmd));
  if (!match) {
    sendSys(s, `Unknown command: /${cmd}`);
    return;
  }
  if (match.admin && !isAdmin(s.name)) {
    sendSys(s, 'Admin command only');
    return;
  }
  await match.run(args);
}
