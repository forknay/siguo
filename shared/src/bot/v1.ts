// Bot v1 — fog-respecting baseline. Same weighted-attack heuristic as the old
// omniscient bot, but with two differences:
//
//   1. Reads only the PlayerView (no peek at GameState). Opponent kinds are
//      null unless they've been revealed (Marshal-death flag-reveal or debug).
//   2. For an unknown enemy, weight uses the average remaining-roster rank
//      (~4) instead of the true rank. The bot trades some informed
//      decision-making for fairness; future versions narrow this with beliefs.
//
// Setup is the existing smartValidSetup. This bot is the new baseline against
// which v2+ versions are measured.

import { PIECE_DEFS, type PieceKind } from '../pieces.js';
import { smartValidSetup } from '../setup.js';
import type { Bot, BotMoveContext, BotSetupContext, PickedMove } from './types.js';
import { legalMovesForBot, viewMoveContext } from './legal.js';

/** Roster-wide average rank, used when an opponent piece is unknown. */
const UNKNOWN_RANK_PRIOR = 4;

export const v1: Bot = {
  name: 'v1-fog',
  description: 'Fog-respecting weighted-attack baseline. Same heuristic as the old omniscient bot but uses average-rank prior for unknowns.',

  pickSetup(ctx: BotSetupContext) {
    return smartValidSetup(ctx.seat, Math.floor(ctx.random() * 0xffffffff));
  },

  pickMove(ctx: BotMoveContext): PickedMove | null {
    const { view, seat, random } = ctx;
    const moves = legalMovesForBot(view, seat);
    if (moves.length === 0) return null;

    const moveCtx = viewMoveContext(view);

    const attacks: Array<{ from: string; to: string; weight: number }> = [];
    const empties: Array<{ from: string; to: string }> = [];

    for (const m of moves) {
      const target = moveCtx.pieceAt(m.to);
      // Treat as empty: truly empty, eliminated-owner (dead) piece, or a
      // teammate (shouldn't appear in legal moves but defensive).
      const isFrozen = target ? view.seats[target.owner].eliminated : false;
      const isAlly = target ? isSameTeam(view, seat, target.owner) : false;
      if (!target || isFrozen || isAlly) {
        empties.push({ from: m.from, to: m.to });
        continue;
      }

      // Find my piece's kind (we always know our own pieces).
      const me = view.pieces.find((p) => p.cellId === m.from);
      const myKind = me?.kind;
      const myRank = myKind ? PIECE_DEFS[myKind].rank ?? 0 : 0;

      // Find the target piece in view to read its (possibly null) kind.
      const targetView = view.pieces.find((p) => p.cellId === m.to);
      const targetKind = targetView?.kind ?? null;
      attacks.push({ ...m, weight: scoreAttack(myKind ?? null, myRank, targetKind) });
    }

    const r = random();
    let pick: { from: string; to: string };
    if (attacks.length > 0 && r < 0.7) {
      pick = weightedPick(attacks, random);
    } else if (empties.length > 0) {
      pick = empties[Math.floor(random() * empties.length)]!;
    } else if (attacks.length > 0) {
      pick = weightedPick(attacks, random);
    } else {
      pick = moves[Math.floor(random() * moves.length)]!;
    }
    return { from: pick.from, to: pick.to };
  },
};

function isSameTeam(view: BotMoveContext['view'], a: string, b: string): boolean {
  if (a === b) return true;
  if (view.mode === 'ffa') return false;
  return (view.teams as Record<string, string>)[a] === (view.teams as Record<string, string>)[b];
}

/** Same weights as the old bot, but for unknown enemies use the rank prior. */
function scoreAttack(myKind: PieceKind | null, myRank: number, theirKind: PieceKind | null): number {
  // Known flag: always pursue.
  if (theirKind === 'JUNQI') return 100;
  // Known mine: avoid (engineer might still attack but weight 1).
  if (theirKind === 'DILEI') return myKind === 'GONGBING' ? 5 : 1;
  // Known bomb: very deterring.
  if (theirKind === 'ZHADAN') return 1;
  // Known ranked soldier.
  if (theirKind && PIECE_DEFS[theirKind].rank !== null) {
    const theirRank = PIECE_DEFS[theirKind].rank ?? 0;
    return Math.max(1, 10 + myRank - theirRank);
  }
  // Unknown enemy: use rank prior.
  return Math.max(1, 10 + myRank - UNKNOWN_RANK_PRIOR);
}

function weightedPick<T extends { weight: number }>(items: T[], random: () => number): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = random() * total;
  for (const it of items) {
    r -= it.weight;
    if (r <= 0) return it;
  }
  return items[items.length - 1]!;
}
