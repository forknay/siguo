// Combat resolution. Pure function over piece kinds.
//
// Rules (v1):
//   - Ranked vs ranked: higher rank kills the lower; ties remove both.
//   - 工兵 (Engineer) vs 地雷 (Mine): engineer wins, mine removed.
//   - Any other piece vs 地雷: attacker removed, mine STAYS (v1 default).
//   - 炸弹 (Bomb) initiates or receives any combat: mutual destruction.
//   - Anything attacking 军旗 (Flag): attacker wins (flag captured → owner eliminated).
//   - Mines and flags never initiate attacks (they're immobile), so the attacker is
//     always a mobile piece.

import type { PieceKind } from './pieces.js';
import { PIECE_DEFS } from './pieces.js';

export type CombatOutcome =
  | { winner: 'attacker'; defenderRemoved: true; attackerMoves: true; flagCaptured: boolean }
  | { winner: 'defender'; attackerRemoved: true; defenderRemoved: false; attackerMoves: false }
  | { winner: 'tie'; attackerRemoved: true; defenderRemoved: true; attackerMoves: false };

export interface CombatResult {
  outcome: CombatOutcome;
  attackerKind: PieceKind;
  defenderKind: PieceKind;
}

export function resolveCombat(
  attackerKind: PieceKind,
  defenderKind: PieceKind,
): CombatResult {
  const outcome = resolveOutcome(attackerKind, defenderKind);
  return { outcome, attackerKind, defenderKind };
}

function resolveOutcome(attacker: PieceKind, defender: PieceKind): CombatOutcome {
  // Bomb: mutual destruction regardless of which side initiates.
  if (attacker === 'ZHADAN' || defender === 'ZHADAN') {
    return {
      winner: 'tie',
      attackerRemoved: true,
      defenderRemoved: true,
      attackerMoves: false,
    };
  }

  // Flag is always destroyed by any attacker.
  if (defender === 'JUNQI') {
    return {
      winner: 'attacker',
      defenderRemoved: true,
      attackerMoves: true,
      flagCaptured: true,
    };
  }

  // Mine: engineer wins, anyone else dies and the mine STAYS.
  if (defender === 'DILEI') {
    if (attacker === 'GONGBING') {
      return {
        winner: 'attacker',
        defenderRemoved: true,
        attackerMoves: true,
        flagCaptured: false,
      };
    }
    return {
      winner: 'defender',
      attackerRemoved: true,
      defenderRemoved: false,
      attackerMoves: false,
    };
  }

  // Both are ranked soldiers. Compare ranks.
  const a = PIECE_DEFS[attacker].rank;
  const d = PIECE_DEFS[defender].rank;
  if (a === null || d === null) {
    throw new Error(`Unexpected unranked combat ${attacker} vs ${defender}`);
  }
  if (a > d) {
    return {
      winner: 'attacker',
      defenderRemoved: true,
      attackerMoves: true,
      flagCaptured: false,
    };
  }
  if (a < d) {
    return {
      winner: 'defender',
      attackerRemoved: true,
      defenderRemoved: false,
      attackerMoves: false,
    };
  }
  return { winner: 'tie', attackerRemoved: true, defenderRemoved: true, attackerMoves: false };
}
