// One-off smoke check for the UCB root bandit (delete freely).
import { botByName } from '../src/bot/index.js';
import { createGameState, submitSetup, type SeatInfo } from '../src/engine.js';
import { projectView } from '../src/view.js';
import { randomValidSetup } from '../src/setup.js';
import { ZONES, type ZoneId } from '../src/board.js';
import { botRng } from '../src/bot/legal.js';

const seat = (s: string): SeatInfo =>
  ({ playerId: s, displayName: s, isBot: true, eliminated: false, setupReady: false });
let state = createGameState('2v2', { N: seat('N'), E: seat('E'), S: seat('S'), W: seat('W') });
for (const z of ZONES) {
  const r = submitSetup(state, z as ZoneId, randomValidSetup(z as ZoneId, 7));
  if ('errors' in r) throw new Error(r.errors.join(','));
  state = r.state;
}
const bot = botByName(process.argv[2] ?? 'v4-ucb');
const t0 = performance.now();
const mv = bot.pickMove({ view: projectView(state, 'N'), seat: 'N', random: botRng(123) });
// eslint-disable-next-line no-console
console.log('move:', mv, 'ms:', (performance.now() - t0).toFixed(0));
