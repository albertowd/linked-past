// Runs the room in a dedicated worker so it keeps ticking while the host's tab is in the
// background (browsers throttle main-thread timers of hidden tabs, not worker timers).
import { type ChallengeTable, type ClientMessage, HostCore, NET } from '../shared/index.js';

export type ToWorker =
  | { k: 'start'; room: string; since: number }
  | { k: 'connect'; peer: string }
  | { k: 'msg'; peer: string; msg: ClientMessage }
  | { k: 'disconnect'; peer: string };

export type FromWorker =
  | { k: 'send'; peer: string; msg: import('../shared/index.js').ServerMessage }
  | { k: 'kick'; peer: string; code: string; message: string };

const post = (m: FromWorker) => postMessage(m);
let core: HostCore | undefined;
const queue: ToWorker[] = [];

async function start(room: string, since: number) {
  const table = (await import('../shared/data/rom-challenges.json')).default as unknown as ChallengeTable;
  core = new HostCore(
    room,
    {
      send: (peer, msg) => post({ k: 'send', peer, msg }),
      kick: (peer, code, message) => post({ k: 'kick', peer, code, message }),
    },
    { table, since },
  );
  setInterval(() => core?.tick(), 1000 / NET.stateHz);
  setInterval(() => core?.sendRoster(), NET.rosterIntervalMs);
  for (const m of queue.splice(0)) handle(m);
}

function handle(m: ToWorker) {
  if (!core) {
    queue.push(m); // messages that arrive while the challenge table is still loading
    return;
  }
  if (m.k === 'connect') core.connect(m.peer);
  else if (m.k === 'msg') core.message(m.peer, m.msg);
  else if (m.k === 'disconnect') core.disconnect(m.peer);
}

addEventListener('message', (e: MessageEvent<ToWorker>) => {
  if (e.data.k === 'start') void start(e.data.room, e.data.since);
  else handle(e.data);
});
