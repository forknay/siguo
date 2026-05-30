// Bot driver. Picks moves with a slight preference for capturing low-value targets;
// schedules them after a configurable delay so the game feels paced.

import { legalMovesForTurn, PIECE_DEFS, type BotSpeed, type GameState, type SeatId } from '@siguo/shared';
import type { Room } from './room.js';

function isSameTeam(state: GameState, a: SeatId, b: SeatId): boolean {
  if (a === b) return true;
  if (state.mode === 'ffa') return false;
  return state.teams[a] === state.teams[b];
}

const SPEED_DELAYS: Record<BotSpeed, [number, number]> = {
  slow:    [1200, 1800],
  normal:  [300, 700],
  fast:    [80, 180],
  instant: [0, 0],
};

/** If the seat whose turn it is is a bot, schedule its move. Returns true if scheduled. */
export function maybeScheduleBotTurn(
  room: Room,
  onMoveApplied: () => void,
): boolean {
  if (!room.state || room.state.phase !== 'PLAYING') return false;
  const seat = room.state.turn;
  const occupant = room.occupants[seat];
  if (occupant.kind !== 'bot') return false;

  const [min, max] = SPEED_DELAYS[room.botSpeed];
  const delay = min + Math.random() * (max - min);
  setTimeout(() => {
    runBotMove(room, seat);
    onMoveApplied();
  }, delay);
  return true;
}

function runBotMove(room: Room, seat: SeatId): void {
  if (!room.state || room.state.phase !== 'PLAYING' || room.state.turn !== seat) return;
  const moves = legalMovesForTurn(room.state);
  if (moves.length === 0) {
    room.resign(seat);
    return;
  }

  // v2 heuristic: prefer moves that attack a piece (any combat target) over
  // empty-cell moves, since attacking is generally how progress is made. Among
  // attacks prefer those against KNOWN low-rank pieces (only matters once the
  // engine has revealed something — currently rare). Falls back to uniform random.
  const state = room.state;
  const attacks: Array<{ from: string; to: string; weight: number }> = [];
  const empties: Array<{ from: string; to: string }> = [];
  for (const m of moves) {
    const targetPid = state.cellIndex[m.to];
    const target = targetPid ? state.pieces[targetPid] : null;
    // Treat the cell as empty if (a) genuinely empty, (b) the piece on it
    // belongs to an eliminated seat — dead pieces don't fight back, attacking
    // them gains nothing, and (c) the target somehow belongs to the same team
    // (shouldn't happen since legal moves filter teammates, but defensive).
    const isFrozenDeadEnemy = target ? state.seats[target.owner].eliminated : false;
    const isAlly = target ? isSameTeam(state, seat, target.owner) : false;
    if (!target || isFrozenDeadEnemy || isAlly) {
      empties.push({ from: m.from, to: m.to });
      continue;
    }
    // Lower rank = more attractive target; mines deter unless we're an engineer.
    let w = 5;
    if (target.kind === 'JUNQI') w = 100; // flag — always go for it
    else if (target.kind === 'DILEI') w = 1;
    else if (PIECE_DEFS[target.kind].rank !== null) {
      const myPid = state.cellIndex[m.from];
      const mine = myPid ? state.pieces[myPid] : null;
      const mineRank = mine ? PIECE_DEFS[mine.kind].rank ?? 0 : 0;
      const theirRank = PIECE_DEFS[target.kind].rank ?? 0;
      w = Math.max(1, 10 + mineRank - theirRank);
    }
    attacks.push({ ...m, weight: w });
  }

  let pick: { from: string; to: string };
  if (attacks.length > 0 && Math.random() < 0.7) {
    pick = weightedPick(attacks);
  } else if (empties.length > 0) {
    pick = empties[Math.floor(Math.random() * empties.length)]!;
  } else {
    pick = moves[Math.floor(Math.random() * moves.length)]!;
  }
  room.attemptMove(seat, pick.from, pick.to);
}

function weightedPick<T extends { weight: number }>(items: T[]): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const it of items) {
    r -= it.weight;
    if (r <= 0) return it;
  }
  return items[items.length - 1]!;
}
