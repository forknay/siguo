// Bot v1 — fog-respecting with belief tracking.
//
// Improvements over v0:
//   1. Walks moveHistory to build per-piece beliefs (`computeBeliefs`).
//      Combat survivors get their kind locked in; pieces seen moving are
//      excluded from mine/flag; back-row unmoved pieces are biased toward
//      static defenders.
//   2. Move scoring uses `estimatedRank` from the belief instead of the
//      constant rank-4 prior.
//   3. Heavyweight reluctance: 司令 and 军长 carry a small attack penalty
//      against unknowns sitting on the front line (where bombs cluster).
//      This is the cheap version of the "司令 doesn't probe" rule.

import { PIECE_DEFS, type PieceKind } from '../pieces.js';
import { smartValidSetup } from '../setup.js';
import { getCell } from '../board.js';
import type { Bot, BotMoveContext, BotSetupContext, PickedMove } from './types.js';
import { legalMovesForBot, viewMoveContext } from './legal.js';
import { computeBeliefs, type PieceBelief } from './belief.js';

export const v1: Bot = {
  name: 'v1-belief',
  description: 'Fog-respecting + per-piece belief tracking from moveHistory. Avoids letting 司令/军长 probe unknown front-line pieces (likely bombs).',

  pickSetup(ctx: BotSetupContext) {
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
      const target = moveCtx.pieceAt(m.to);
      const isFrozen = target ? view.seats[target.owner].eliminated : false;
      const isAlly = target ? isSameTeam(view, seat, target.owner) : false;
      if (!target || isFrozen || isAlly) {
        empties.push({ from: m.from, to: m.to });
        continue;
      }
      const myView = view.pieces.find((p) => p.cellId === m.from);
      const myKind = myView?.kind ?? null;
      const targetBelief = beliefs.get(target.id);
      const w = scoreAttack(myKind, targetBelief, m.to);
      attacks.push({ ...m, weight: w });
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

function scoreAttack(myKind: PieceKind | null, target: PieceBelief | undefined, toCellId: string): number {
  if (!target) return 5;
  const myRank = myKind ? PIECE_DEFS[myKind].rank ?? 0 : 0;

  // Known kinds → exact handling.
  if (target.knownKind === 'JUNQI') return 100;
  if (target.knownKind === 'DILEI') return myKind === 'GONGBING' ? 5 : 1;
  if (target.knownKind === 'ZHADAN') return 1;

  // Estimated rank (covers known soldiers AND unknowns).
  const theirRank = target.estimatedRank;
  let w = Math.max(1, 10 + myRank - theirRank);

  // Heavyweight reluctance: 司令 and 军长 should not probe unknown pieces on
  // the FRONT LINE (row 6 of any zone or central cells). Bombs cluster there
  // in human play, and losing your 司令 reveals your flag.
  const cell = getCell(toCellId);
  const onFrontline = cell.row === 6 || cell.zone === 'C';
  if (!target.knownKind && onFrontline) {
    if (myKind === 'SILING') w *= 0.2;
    else if (myKind === 'JUNZHANG') w *= 0.5;
  }

  // Unknown back-row pieces (likely mines): doubled deterrence for non-engineers.
  if (!target.knownKind && target.inBackRow && !target.hasMoved && myKind !== 'GONGBING') {
    w *= 0.5;
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
