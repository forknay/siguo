// Bot v2 — strict-fog with mine confidence + bomb offense.
//
// Improvements over v1:
//   1. STRICT FOG. View kinds are stripped from non-involved combats by
//      projectView. Belief inference comes from outcomes + our own piece's
//      known rank. (See belief.ts and the F.A v2 plan in BOT.md.)
//   2. MINE FILTERING. Non-engineer moves into cells with mineConfidence > 0.4
//      are removed from the candidate list entirely. The bot won't walk a
//      heavyweight onto a probable mine even if it's tempted.
//   3. ENGINEER DISPATCH. Engineer moves into high-confidence-mine cells get
//      weight = 30 + 20 × confidence. Heavily preferred but not forced — the
//      engineer can still take a capture.
//   4. BOMB OFFENSE. ZHADAN attacks score = 30 + estimatedRank × 5, with
//      ×3 vs known 司令, ×2 vs known 军长, ×2 vs HQ cells. Bombs actively
//      hunt strong pieces.
//   5. BOMB PLACEMENT BIAS (small). In setup, bias one bomb toward the
//      column likely to be probed first.

import { PIECE_DEFS, type PieceKind } from '../pieces.js';
import { getCell } from '../board.js';
import { smartValidSetup } from '../setup.js';
import type { Bot, BotMoveContext, BotSetupContext, PickedMove } from './types.js';
import { legalMovesForBot, viewMoveContext } from './legal.js';
import { computeBeliefs, type PieceBelief } from './belief.js';

const MINE_FILTER_THRESHOLD = 0.4;
const ENGINEER_MINE_BASE = 30;

export const v2: Bot = {
  name: 'v2-fog',
  description: 'Strict fog of war. Belief tracking with mine confidence. Engineer dispatch; non-engineers refuse known/probable mines. Bombs hunt strong pieces.',

  pickSetup(ctx: BotSetupContext) {
    // For now reuse smartValidSetup. The "slight bomb column bias" (F.E) will
    // be folded in once the seat-vs-partner geometry is decided; placeholder
    // here uses the same algorithm.
    return smartValidSetup(ctx.seat, Math.floor(ctx.random() * 0xffffffff));
  },

  pickMove(ctx: BotMoveContext): PickedMove | null {
    const { view, seat, random } = ctx;
    const moves = legalMovesForBot(view, seat);
    if (moves.length === 0) return null;

    const beliefs = computeBeliefs(view, seat);
    const moveCtx = viewMoveContext(view);

    const attacks: Array<{ from: string; to: string; weight: number }> = [];
    const empties: Array<{ from: string; to: string }> = [];

    for (const m of moves) {
      const me = view.pieces.find((p) => p.cellId === m.from);
      const myKind = me?.kind ?? null;
      const target = moveCtx.pieceAt(m.to);
      const isFrozen = target ? view.seats[target.owner].eliminated : false;
      const isAlly = target ? isSameTeam(view, seat, target.owner) : false;
      const targetBelief = target ? beliefs.get(target.id) : undefined;

      // Mine filtering: non-engineers refuse cells with high mineConfidence.
      // Applies whether the target is a real piece or just an empty cell;
      // the belief lookup uses the destination cell.
      const cellMineConfidence = mineConfidenceForCell(beliefs, m.to);
      if (myKind !== 'GONGBING' && cellMineConfidence > MINE_FILTER_THRESHOLD) {
        // Skip this move entirely.
        continue;
      }

      if (!target || isFrozen || isAlly) {
        empties.push({ from: m.from, to: m.to });
        continue;
      }
      const w = scoreAttack(myKind, targetBelief, m.to, cellMineConfidence);
      attacks.push({ ...m, weight: w });
    }

    if (moves.length > 0 && attacks.length === 0 && empties.length === 0) {
      // All moves were filtered out (very rare). Fall back to any legal move.
      const fallback = moves[Math.floor(random() * moves.length)]!;
      return { from: fallback.from, to: fallback.to };
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

/** Lookup the mineConfidence on whichever (opponent) piece occupies a cell. */
function mineConfidenceForCell(beliefs: Map<string, PieceBelief>, cellId: string): number {
  for (const b of beliefs.values()) {
    if (b.cellId === cellId) return b.mineConfidence;
  }
  return 0;
}

function scoreAttack(
  myKind: PieceKind | null,
  target: PieceBelief | undefined,
  toCellId: string,
  cellMineConfidence: number,
): number {
  if (!target) return 5;

  // Engineer dispatch: high-mine-confidence cells become VERY attractive.
  if (myKind === 'GONGBING' && cellMineConfidence > 0.4) {
    return ENGINEER_MINE_BASE + 20 * cellMineConfidence;
  }

  // Bomb offense: hunt strong pieces.
  if (myKind === 'ZHADAN') {
    let w = 30 + target.estimatedRank * 5;
    if (target.knownKind === 'SILING') w *= 3;
    else if (target.knownKind === 'JUNZHANG') w *= 2;
    const cell = getCell(toCellId);
    if (cell.type === 'HQ') w *= 2;
    return w;
  }

  // Known special cases.
  if (target.knownKind === 'JUNQI') return 100;
  if (target.knownKind === 'DILEI') return myKind === 'GONGBING' ? 30 : 1;
  if (target.knownKind === 'ZHADAN') return 1;

  const myRank = myKind ? PIECE_DEFS[myKind].rank ?? 0 : 0;
  const theirRank = target.estimatedRank;
  let w = Math.max(1, 10 + myRank - theirRank);

  // Heavyweight reluctance on the front line (likely bombs in human play).
  const cell = getCell(toCellId);
  const onFrontline = cell.row === 6 || cell.zone === 'C';
  if (!target.knownKind && onFrontline) {
    if (myKind === 'SILING') w *= 0.2;
    else if (myKind === 'JUNZHANG') w *= 0.5;
  }

  // Mine suspicion for non-engineers (already filtered above for very high
  // confidence, so this handles the moderate range 0..0.4).
  if (myKind !== 'GONGBING' && cellMineConfidence > 0) {
    w *= 1 - cellMineConfidence;
  }

  return Math.max(1, w);
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
