// Micro-benchmark for MC bot pickMove cost. Measures wall time per decision on
// a fresh game and a midgame position so we can compare optimizations.
//
// Usage: pnpm -C shared bot-bench [-- --bot v3.1-spatial --turns 8]

import {
  applyMove,
  applyResign,
  botByName,
  botRng,
  createGameState,
  projectView,
  submitSetup,
  type GameState,
  type SeatId,
  type SeatInfo,
} from '../src/index.js';
import { ZONES } from '../src/board.js';

function parse(argv: string[]) {
  const out = { bot: 'v3.1-spatial', turns: 8, seed: 1, warmup: 0 };
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i]!;
    if (argv[i] === '--bot') out.bot = next();
    else if (argv[i] === '--turns') out.turns = parseInt(next(), 10);
    else if (argv[i] === '--seed') out.seed = parseInt(next(), 10);
    else if (argv[i] === '--warmup') out.warmup = parseInt(next(), 10);
  }
  return out;
}

function seatInfo(id: string): SeatInfo {
  return { playerId: id, displayName: id, isBot: true, eliminated: false, setupReady: false };
}

function freshGame(bot: ReturnType<typeof botByName>, seed: number): GameState {
  let state = createGameState('2v2', {
    N: seatInfo('n'), E: seatInfo('e'), S: seatInfo('s'), W: seatInfo('w'),
  });
  for (const z of ZONES) {
    const layout = bot.pickSetup({ seat: z, random: botRng(seed * 31 + z.charCodeAt(0)) });
    const r = submitSetup(state, z, layout);
    if ('errors' in r) throw new Error(r.errors.join(','));
    state = r.state;
  }
  return state;
}

function main() {
  const args = parse(process.argv.slice(2));
  const bot = botByName(args.bot);
  let state = freshGame(bot, args.seed);

  // Warmup: fast-forward into the midgame with the cheap v2.1 policy so the
  // measured turns reflect realistic mid-game branching, not just the opening.
  const cheap = botByName('v2.1-fixes');
  for (let t = 0; t < args.warmup && state.phase === 'PLAYING'; t++) {
    const seat: SeatId = state.turn;
    const view = projectView(state, seat, { debug: false });
    const pick = cheap.pickMove({
      view, seat, history: state.moveHistory, random: botRng(args.seed * 131 + t),
    });
    if (!pick) { state = applyResign(state, seat); continue; }
    const r = applyMove(state, seat, pick.from, pick.to);
    if ('error' in r) { state = applyResign(state, seat); continue; }
    state = r.state;
  }

  const times: number[] = [];
  for (let t = 0; t < args.turns && state.phase === 'PLAYING'; t++) {
    const seat: SeatId = state.turn;
    const view = projectView(state, seat, { debug: false });
    const t0 = performance.now();
    const pick = bot.pickMove({
      view, seat, history: state.moveHistory, random: botRng(args.seed * 7919 + t),
    });
    const dt = performance.now() - t0;
    times.push(dt);
    if (!pick) { state = applyResign(state, seat); continue; }
    const r = applyMove(state, seat, pick.from, pick.to);
    if ('error' in r) { state = applyResign(state, seat); continue; }
    state = r.state;
  }

  const total = times.reduce((a, b) => a + b, 0);
  const avg = total / times.length;
  const max = Math.max(...times);
  // eslint-disable-next-line no-console
  console.log(`bot=${args.bot} turns=${times.length}`);
  // eslint-disable-next-line no-console
  console.log(`avg=${avg.toFixed(1)}ms max=${max.toFixed(1)}ms total=${total.toFixed(0)}ms`);
  // eslint-disable-next-line no-console
  console.log(`per-turn: [${times.map((t) => t.toFixed(0)).join(', ')}]`);
}

main();
