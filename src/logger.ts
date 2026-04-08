const PREFIX = '[cmice]';
const LOG_PACKETS = (process.env.LOG_PACKETS || '').toLowerCase() === 'true';
export const PACKET_LOG_ENABLED = LOG_PACKETS;

const label = (msg: string) => `${PREFIX} ${msg}`;

export function info(message: string) {
  console.log(label(message));
}

export function warn(message: string) {
  console.warn(label(message));
}

export function error(message: string) {
  console.error(label(message));
}

export function packet(direction: 'in' | 'out', peer: string | null, pretty: string, desc: string) {
  if (!LOG_PACKETS) return;
  const peerLabel = peer || 'unknown';
  console.log(label(`packet ${direction} ${peerLabel} ${pretty} :: ${desc}`));
}
