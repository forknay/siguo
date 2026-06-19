// Diagnose WHY team A loses games: rerun seed-deterministic eval games and
// print per-loss forensics (who died when, material trajectory, flag events).
//
// Usage: npx tsx scripts/bot-loss-analysis.ts --teamA v4-greedy --teamB v3.1-spatial \
//          --games 24 --seed 12400

import { botByName } from '../src/bot/index.js';
import { botRng } from '../src/bot/legal.js';
import {
  applyMove, applyResign, createGameState, submitSetup,
  type GameState, type SeatInfo,
} from '../src/engine.js';
import { projectView } from '../src/view.js';
import { ZONES, type SeatId, type ZoneId } from '../src/board.js';
import { PIECE_VALUE } from '../src/bot/values.js';

function parse(argv: string[]) {
  const a = { teamA: 'v4-greedy', teamB: 'v3.1-spatial', games: 24, seed: 12400 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--teamA') a.teamA = argv[++i]!;
    else if (argv[i] === '--teamB') a.teamB = argv[++i]!;
    else if (argv[i] === '--games') a.games = parseInt(argv[++i]!, 10);
    else if (argv[i] === '--seed') a.seed = parseInt(argv[++i]!, 10);
  }
  return a;
}

const seatInfo = (id: string): SeatInfo =>
  ({ playerId: id, displayName: id, isBot: true, eliminated: false, setupReady: false });

function teamMaterial(state: GameState, team: 'A' | 'B'): number {
  let m = 0;
  for (const p of Object.values(state.pieces)) {
    if (state.teams[p.owner] === team && p.kind !== 'JUNQI') m += PIECE_VALUE[p.kind];
  }
  return m;
}

function main() {
  const args = parse(process.argv.slice(2));
  const botA = botByName(args.teamA);
  const botB = botByName(args.teamB);
  // Team A = N+S, Team B = E+W (mirrors bot-eval).
  const botBySeat: Record<SeatId, typeof botA> = { N: botA, S: botA, E: botB, W: botB };

  let losses = 0;
  for (let g = 0; g < args.games; g++) {
    const gameSeed = (args.seed + g) >>> 0;
    let state = createGameState('2v2', {
      N: seatInfo('a1'), E: seatInfo('b1'), S: seatInfo('a2'), W: seatInfo('b2'),
    });
    for (const z of ZONES) {
      const layout = botBySeat[z as SeatId].pickSetup({
        seat: z as ZoneId, random: botRng(gameSeed * 31 + z.charCodeAt(0)),
      });
      const r = submitSetup(state, z as ZoneId, layout);
      if ('errors' in r) throw new Error(r.errors.join(','));
      state = r.state;
    }

    const events: string[] = [];
    const matAt: Array<[number, number, number]> = [];
    let safety = 1000;
    while (state.phase === 'PLAYING' && safety-- > 0) {
      const seat = state.turn;
      const view = projectView(state, seat, { debug: false });
      const random = botRng(gameSeed * 7919 + state.turnIndex * 31 + seat.charCodeAt(0));
      const pick = botBySeat[seat].pickMove({ view, seat, history: state.moveHistory, random });
      if (!pick) { state = applyResign(state, seat); continue; }
      const prevMarshal = { ...state.marshalDead };
      const prevElim = Object.fromEntries(ZONES.map((z) => [z, state.seats[z as SeatId].eliminated]));
      const r = applyMove(state, seat, pick.from, pick.to);
      if ('error' in r) { state = applyResign(state, seat); continue; }
      state = r.state;
      for (const z of ZONES) {
        const s = z as SeatId;
        if (!prevMarshal[s] && state.marshalDead[s]) {
          events.push(`t${state.turnIndex}: ${s} marshal dead (killed on ${seat}'s move) → flag revealed`);
        }
        if (!prevElim[s] && state.seats[s].eliminated) {
          events.push(`t${state.turnIndex}: ${s} ELIMINATED (flag taken on ${seat}'s move)`);
        }
      }
      if (state.turnIndex % 50 === 0) {
        matAt.push([state.turnIndex, teamMaterial(state, 'A'), teamMaterial(state, 'B')]);
      }
    }

    const aWon = state.result?.kind === 'TEAM_WIN' && state.result.team === 'A';
    if (!aWon) {
      losses += 1;
      // eslint-disable-next-line no-console
      console.log(`\n=== LOSS game ${g} (seed ${gameSeed}) — result: ${JSON.stringify(state.result)} turns=${state.turnIndex}`);
      // eslint-disable-next-line no-console
      console.log(`material A/B every 50 turns: ${matAt.map(([t, a, b]) => `t${t}:${a}/${b}`).join('  ')}`);
      // eslint-disable-next-line no-console
      console.log(`final material A/B: ${teamMaterial(state, 'A')}/${teamMaterial(state, 'B')}`);
      for (const e of events) console.log(`  ${e}`); // eslint-disable-line no-console
    }
  }
  // eslint-disable-next-line no-console
  console.log(`\n${losses}/${args.games} losses for ${args.teamA}`);
}

main();
