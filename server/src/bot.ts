// Random-move bot driver. Picks a uniformly random legal move and plays it after a
// short artificial delay so the game feels human-paced.

import { legalMovesForTurn, type SeatId } from '@siguo/shared';
import type { Room } from './room.js';

const BOT_DELAY_MIN_MS = 250;
const BOT_DELAY_MAX_MS = 750;

/** If the seat whose turn it is is a bot, schedule its move. Returns true if scheduled. */
export function maybeScheduleBotTurn(
  room: Room,
  onMoveApplied: () => void,
): boolean {
  if (!room.state || room.state.phase !== 'PLAYING') return false;
  const seat = room.state.turn;
  const occupant = room.occupants[seat];
  if (occupant.kind !== 'bot') return false;

  const delay = BOT_DELAY_MIN_MS + Math.random() * (BOT_DELAY_MAX_MS - BOT_DELAY_MIN_MS);
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
    // Self-resign — no legal moves.
    room.resign(seat);
    return;
  }
  const pick = moves[Math.floor(Math.random() * moves.length)]!;
  room.attemptMove(seat, pick.from, pick.to);
}
