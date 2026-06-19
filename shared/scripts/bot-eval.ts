// Bot evaluation harness — run N games of (teamA-bot × 2) vs (teamB-bot × 2)
// and report win rate, avg game length, average pieces remaining, and how
// games ended (flag capture / stalemate / no-moves resignation).
//
// Usage:
//   pnpm bot-eval --teamA v1-fog --teamB v1-fog --games 100 --mode 2v2 --seed 0
//
// Both --teamA and --teamB may be the same bot name (sanity check). All
// randomness routes through deterministic PRNGs seeded from --seed + game
// index so results are reproducible.

import {
  applyMove,
  applyResign,
  botByName,
  botRng,
  createGameState,
  projectView,
  submitSetup,
  TEAMS_2V2,
  type Bot,
  type GameMode,
  type GameResult,
  type GameState,
  type SeatId,
  type SeatInfo,
} from '../src/index.js';

interface Args {
  teamA: string;
  teamB: string;
  games: number;
  mode: GameMode;
  seed: number;
  verbose: boolean;
  /** Emit a single machine-readable JSON line instead of the human summary. */
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { teamA: 'v1-fog', teamB: 'v1-fog', games: 50, mode: '2v2', seed: 0, verbose: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i]!;
    if (a === '--teamA') args.teamA = next();
    else if (a === '--teamB') args.teamB = next();
    else if (a === '--games') args.games = parseInt(next(), 10);
    else if (a === '--mode') args.mode = next() as GameMode;
    else if (a === '--seed') args.seed = parseInt(next(), 10);
    else if (a === '--verbose' || a === '-v') args.verbose = true;
    else if (a === '--json') args.json = true;
  }
  return args;
}

interface GameOutcome {
  result: GameResult;
  turns: number;
  piecesRemainingByTeam: Record<'A' | 'B', number>;
  endReason: 'flag-capture' | 'stalemate' | 'all-resigned' | 'draw';
}

const SEATS: SeatId[] = ['N', 'E', 'S', 'W'];

function seatInfo(playerId: string, isBot: boolean): SeatInfo {
  return { playerId, displayName: playerId, isBot, eliminated: false, setupReady: false };
}

function runOneGame(
  mode: GameMode,
  teamABot: Bot,
  teamBBot: Bot,
  gameSeed: number,
): GameOutcome {
  // Seat → bot mapping. 2v2: N+S = team A, E+W = team B.
  const botBySeat: Record<SeatId, Bot> = mode === '2v2'
    ? { N: teamABot, S: teamABot, E: teamBBot, W: teamBBot }
    : { N: teamABot, E: teamBBot, S: teamABot, W: teamBBot };

  const seats: Record<SeatId, SeatInfo> = {
    N: seatInfo('botN', true),
    E: seatInfo('botE', true),
    S: seatInfo('botS', true),
    W: seatInfo('botW', true),
  };
  let state = createGameState(mode, seats);

  // Setup phase
  for (const s of SEATS) {
    const layout = botBySeat[s].pickSetup({
      seat: s,
      random: botRng(gameSeed * 131 + s.charCodeAt(0)),
    });
    const r = submitSetup(state, s, layout);
    if ('errors' in r) throw new Error(`Setup error for ${s}: ${r.errors.join(', ')}`);
    state = r.state;
  }

  // Play loop
  let safety = 1000;
  while (state.phase === 'PLAYING' && safety-- > 0) {
    const seat = state.turn;
    const bot = botBySeat[seat];
    const view = projectView(state, seat, { debug: false });
    const random = botRng(gameSeed * 7919 + state.turnIndex * 31 + seat.charCodeAt(0));
    const pick = bot.pickMove({ view, seat, history: state.moveHistory, random });
    if (!pick) {
      state = applyResign(state, seat);
      continue;
    }
    const r = applyMove(state, seat, pick.from, pick.to);
    if ('error' in r) {
      // Shouldn't happen — but if a bot returns an illegal move, resign it.
      state = applyResign(state, seat);
      continue;
    }
    state = r.state;
  }

  const piecesRemainingByTeam: Record<'A' | 'B', number> = { A: 0, B: 0 };
  for (const p of Object.values(state.pieces)) {
    const team = state.teams[p.owner];
    piecesRemainingByTeam[team] += 1;
  }

  let endReason: GameOutcome['endReason'] = 'draw';
  if (state.result?.kind === 'TEAM_WIN' || state.result?.kind === 'PLAYER_WIN') {
    endReason = 'flag-capture';
  } else if (state.result?.kind === 'DRAW') {
    endReason = state.result.reason === 'STALEMATE' ? 'stalemate' : 'all-resigned';
  }

  return {
    result: state.result ?? { kind: 'DRAW', reason: 'AGREEMENT' },
    turns: state.turnIndex,
    piecesRemainingByTeam,
    endReason,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const teamA = botByName(args.teamA);
  const teamB = botByName(args.teamB);

  if (!args.json) {
    // eslint-disable-next-line no-console
    console.log(`Running ${args.games} ${args.mode} game(s): teamA=${teamA.name} vs teamB=${teamB.name} (seed ${args.seed})`);
  }

  const results: GameOutcome[] = [];
  for (let i = 0; i < args.games; i++) {
    const gameSeed = (args.seed + i) >>> 0;
    const outcome = runOneGame(args.mode, teamA, teamB, gameSeed);
    results.push(outcome);
    if (args.verbose) {
      // eslint-disable-next-line no-console
      console.log(`  game ${i}: ${describeOutcome(outcome)}, turns=${outcome.turns}`);
    }
  }

  // Tally.
  let aWins = 0;
  let bWins = 0;
  let draws = 0;
  const endReasonCounts: Record<GameOutcome['endReason'], number> = { 'flag-capture': 0, 'stalemate': 0, 'all-resigned': 0, 'draw': 0 };
  let totalTurns = 0;
  let totalPiecesA = 0;
  let totalPiecesB = 0;
  for (const o of results) {
    totalTurns += o.turns;
    totalPiecesA += o.piecesRemainingByTeam.A;
    totalPiecesB += o.piecesRemainingByTeam.B;
    endReasonCounts[o.endReason] += 1;
    if (o.result.kind === 'TEAM_WIN') {
      if (o.result.team === 'A') aWins += 1; else bWins += 1;
    } else if (o.result.kind === 'PLAYER_WIN') {
      const seat = o.result.seat;
      const team = TEAMS_2V2[seat]; // approximation for FFA; works because FFA bots don't team
      if (team === 'A') aWins += 1; else bWins += 1;
    } else {
      draws += 1;
    }
  }

  const n = results.length;
  if (args.json) {
    // Single machine-readable line for the parallel aggregator.
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      teamA: teamA.name, teamB: teamB.name, games: n, seed: args.seed,
      aWins, bWins, draws,
      totalTurns, totalPiecesA, totalPiecesB,
      endReasons: endReasonCounts,
    }));
    return;
  }
  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log('--- Summary ---');
  // eslint-disable-next-line no-console
  console.log(`Team A (${teamA.name}) wins:  ${aWins} (${pct(aWins, n)})`);
  // eslint-disable-next-line no-console
  console.log(`Team B (${teamB.name}) wins:  ${bWins} (${pct(bWins, n)})`);
  // eslint-disable-next-line no-console
  console.log(`Draws:               ${draws} (${pct(draws, n)})`);
  // eslint-disable-next-line no-console
  console.log(`Avg game length:     ${(totalTurns / n).toFixed(1)} turns`);
  // eslint-disable-next-line no-console
  console.log(`Avg pieces left A:   ${(totalPiecesA / n).toFixed(1)}`);
  // eslint-disable-next-line no-console
  console.log(`Avg pieces left B:   ${(totalPiecesB / n).toFixed(1)}`);
  // eslint-disable-next-line no-console
  console.log(`End reasons: flag-capture=${endReasonCounts['flag-capture']}, stalemate=${endReasonCounts.stalemate}, all-resigned=${endReasonCounts['all-resigned']}, draw=${endReasonCounts.draw}`);
}

function pct(n: number, total: number): string {
  if (total === 0) return '0%';
  return `${(n / total * 100).toFixed(1)}%`;
}

function describeOutcome(o: GameOutcome): string {
  if (o.result.kind === 'TEAM_WIN') return `team ${o.result.team} wins (${o.endReason})`;
  if (o.result.kind === 'PLAYER_WIN') return `${o.result.seat} wins (${o.endReason})`;
  return `draw (${o.endReason})`;
}

main();
