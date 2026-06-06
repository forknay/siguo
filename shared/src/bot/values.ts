// Piece value table used by v2.1+ bots for expected-value combat scoring.
//
// Values are scaled so a rank-vs-rank+1 winning attack scores roughly the same
// as v2's old `10 + myRank - theirRank` formula at high weights — keeps
// magnitudes comparable across bot versions without retuning everything else.
//
// Engineer is bumped to 100 (= rank-6 旅长) because:
//   - With mineConfidence working, engineers are the only piece that can clear
//     known mines. Each surviving engineer dramatically increases the win rate.
//   - Roster has only 3 engineers; losing them is expensive in the late game.

import { PIECE_DEFS, type PieceKind } from '../pieces.js';

export const PIECE_VALUE: Record<PieceKind, number> = {
  SILING:    1000,  // 司令 — losing it auto-reveals flag
  JUNZHANG:  400,   // 军长
  SHIZHANG:  175,   // 师长
  LUZHANG:   100,   // 旅长
  TUANZHANG: 70,    // 团长
  YINGZHANG: 50,    // 营长
  LIANZHANG: 35,    // 连长
  PAIZHANG:  25,    // 排长
  GONGBING:  100,   // 工兵 — equivalent to 旅长 because mine-clearing utility
  ZHADAN:    200,   // 炸弹 — pricey but single-use
  DILEI:     50,    // 地雷 — defensive value, blocks one attacker
  JUNQI:     100000, // 军旗 — losing = game over
};

/**
 * Small tie-breaking bias toward activating stronger pieces, so the bot doesn't
 * leave its 司令 / 军长 parked in the back all game. Intentionally tiny relative
 * to combat-EV magnitudes — it only breaks ties between otherwise-similar moves.
 * Specials (bomb/mine/flag) have rank null → 0 bias.
 */
export const STRONG_MOVE_BIAS = 1.5;

export function strongMoveBonus(kind: PieceKind): number {
  return (PIECE_DEFS[kind].rank ?? 0) * STRONG_MOVE_BIAS;
}
