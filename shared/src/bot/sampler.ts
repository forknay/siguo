// v3-mc belief sampler. Given the bot's fog-of-war view + belief map, produce
// a plausible perfect-info GameState by assigning a concrete PieceKind to every
// opponent / partner piece whose kind the bot doesn't know.
//
// See BOT.md § "Sampler — detailed algorithm" for the full design. Quick recap:
//   1. Per non-viewer seat, categorize (known-alive, unknown-alive, known-dead,
//      unknown-dead). Build pool = roster − knownKinds.
//   2. Sort unknown-alive by constraint tightness (ascending).
//   3. Greedy weighted assignment with position priors.
//   4. Consume remaining pool with unknown-dead.
//   5. Build the GameState.

import { getCell, ZONES, type SeatId } from '../board.js';
import {
  type GameState,
  type MoveRecord,
  type PieceState,
  isResignEntry,
} from '../engine.js';
import { PIECE_DEFS, PIECE_KINDS_ORDERED, type PieceKind } from '../pieces.js';
import type { PieceBelief } from './belief.js';
import type { PlayerView } from '../view.js';

/** Canonical roster — 25 pieces per seat. */
export const ROSTER: Record<PieceKind, number> = (() => {
  const out = {} as Record<PieceKind, number>;
  for (const k of PIECE_KINDS_ORDERED) out[k] = PIECE_DEFS[k].count;
  return out;
})();

export class SampleInfeasibleError extends Error {
  constructor(public seat: SeatId, public detail: string) {
    super(`Sample infeasible for ${seat}: ${detail}`);
  }
}

/** Build a plausible perfect-info GameState from the bot's view + beliefs. */
export function sampleConcreteWorld(
  view: PlayerView,
  beliefs: Map<string, PieceBelief>,
  viewerSeat: SeatId,
  rng: () => number,
): GameState {
  // Concrete kind assignments by piece id.
  const assignedKinds = new Map<string, PieceKind>();

  // Per-seat death counts from moveHistory.
  const deathsBySeat = countDeathsBySeat(view.moveHistory);

  for (const seat of ZONES) {
    if (seat === viewerSeat) continue; // viewer's own pieces are known from view
    assignSeat(view, beliefs, seat, deathsBySeat[seat] ?? 0, assignedKinds, rng);
  }

  return buildGameState(view, viewerSeat, assignedKinds);
}

function assignSeat(
  view: PlayerView,
  beliefs: Map<string, PieceBelief>,
  seat: SeatId,
  totalDeaths: number,
  assignedKinds: Map<string, PieceKind>,
  rng: () => number,
): void {
  const seatPieces = view.pieces.filter((p) => p.owner === seat);

  // Categorize alive pieces.
  const knownAliveKinds: PieceKind[] = [];
  const unknownAlive: typeof seatPieces = [];
  for (const p of seatPieces) {
    const belief = beliefs.get(p.id);
    const known = belief?.knownKind ?? p.kind ?? null;
    if (known) {
      knownAliveKinds.push(known);
      assignedKinds.set(p.id, known);
    } else {
      unknownAlive.push(p);
    }
  }

  // Known dead from public state: Marshal-dead implies SILING died once.
  const knownDeadKinds: PieceKind[] = [];
  if (view.marshalDead[seat]) knownDeadKinds.push('SILING');
  const unknownDeadCount = Math.max(0, totalDeaths - knownDeadKinds.length);

  // Build pool = ROSTER − knownAliveKinds − knownDeadKinds.
  const pool = { ...ROSTER };
  for (const k of knownAliveKinds) pool[k] = (pool[k] ?? 0) - 1;
  for (const k of knownDeadKinds) pool[k] = (pool[k] ?? 0) - 1;
  for (const k of PIECE_KINDS_ORDERED) {
    if (pool[k] < 0) throw new SampleInfeasibleError(seat, `negative pool for ${k}`);
  }

  // Sanity: pool sum should equal unknownAlive + unknownDeadCount.
  const poolSum = sum(Object.values(pool));
  if (poolSum !== unknownAlive.length + unknownDeadCount) {
    // The engine is the source of truth; if we mis-counted (e.g. tracked a death
    // that didn't really happen), abort the sample and let the caller retry.
    throw new SampleInfeasibleError(
      seat,
      `pool ${poolSum} ≠ unknownAlive ${unknownAlive.length} + unknownDead ${unknownDeadCount}`,
    );
  }

  // For each unknown-alive piece, compute its valid-kind set (under the hard
  // constraints), then sort by |validKinds| ascending — tightest first.
  type Candidate = {
    piece: (typeof seatPieces)[number];
    belief: PieceBelief | undefined;
    valid: PieceKind[];
  };
  const candidates: Candidate[] = unknownAlive.map((p) => {
    const belief = beliefs.get(p.id);
    return { piece: p, belief, valid: validKindsForBelief(p.cellId, belief, pool) };
  });
  candidates.sort((a, b) => a.valid.length - b.valid.length);

  for (const c of candidates) {
    // Re-compute valid kinds because the pool changed.
    const valid = validKindsForBelief(c.piece.cellId, c.belief, pool);
    if (valid.length === 0) {
      throw new SampleInfeasibleError(seat, `no valid kind for piece ${c.piece.id} at ${c.piece.cellId}`);
    }
    const kind = weightedKindDraw(valid, pool, c.belief, c.piece.cellId, rng);
    pool[kind] = pool[kind] - 1;
    assignedKinds.set(c.piece.id, kind);
  }

  // Consume the rest with unknown-dead. Uniform random.
  let remaining = unknownDeadCount;
  while (remaining > 0) {
    const available = PIECE_KINDS_ORDERED.filter((k) => pool[k] > 0);
    if (available.length === 0) {
      throw new SampleInfeasibleError(seat, `exhausted pool but ${remaining} unknown dead remain`);
    }
    const pick = available[Math.floor(rng() * available.length)]!;
    pool[pick] -= 1;
    remaining -= 1;
  }
}

/** Hard-constraint valid-kind filter for a piece at a given cell. */
function validKindsForBelief(
  cellId: string,
  belief: PieceBelief | undefined,
  pool: Record<PieceKind, number>,
): PieceKind[] {
  const cell = getCell(cellId);
  const minRank = belief?.minRank ?? null;
  const maxRank = belief?.maxRank ?? null;
  const out: PieceKind[] = [];
  for (const k of PIECE_KINDS_ORDERED) {
    if (pool[k] <= 0) continue;
    if (belief?.knownKind && k !== belief.knownKind) continue;
    // hasMoved → exclude immobile kinds.
    if (belief?.hasMoved && (k === 'DILEI' || k === 'JUNQI')) continue;
    // Setup-rule constraints by cell position.
    if (k === 'JUNQI' && cell.type !== 'HQ') continue;
    if (k === 'DILEI' && cell.row > 2) continue;
    if (k === 'ZHADAN' && cell.row === 6) continue;
    // Rank bounds (only meaningful for ranked soldiers).
    const r = PIECE_DEFS[k].rank;
    if (r !== null) {
      if (minRank !== null && r < minRank) continue;
      if (maxRank !== null && r > maxRank) continue;
    } else {
      // Rankless kind. minRank/maxRank don't apply.
    }
    out.push(k);
  }
  return out;
}

/** Position-prior weights × pool count, then weighted draw. */
function weightedKindDraw(
  valid: PieceKind[],
  pool: Record<PieceKind, number>,
  belief: PieceBelief | undefined,
  cellId: string,
  rng: () => number,
): PieceKind {
  const cell = getCell(cellId);
  const inBackRow = cell.row <= 2;
  const hasMoved = belief?.hasMoved ?? false;
  const weights: number[] = valid.map((k) => {
    let w = pool[k];
    if (!hasMoved && inBackRow && k === 'DILEI') w *= 3;
    if (!hasMoved && inBackRow && k === 'JUNQI') w *= 2;
    return w;
  });
  const total = sum(weights);
  if (total <= 0) {
    // Degenerate: all weights zero. Pick uniformly.
    return valid[Math.floor(rng() * valid.length)]!;
  }
  let r = rng() * total;
  for (let i = 0; i < valid.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return valid[i]!;
  }
  return valid[valid.length - 1]!;
}

function countDeathsBySeat(history: MoveRecord[]): Partial<Record<SeatId, number>> {
  const counts: Partial<Record<SeatId, number>> = {};
  for (const rec of history) {
    if (isResignEntry(rec)) continue;
    if (!rec.combat) continue;
    const w = rec.combat.winner;
    if (w === 'attacker' || w === 'tie') {
      // Defender died.
      counts[rec.combat.defenderSeat] = (counts[rec.combat.defenderSeat] ?? 0) + 1;
    }
    if (w === 'defender' || w === 'tie') {
      // Attacker died.
      counts[rec.seat] = (counts[rec.seat] ?? 0) + 1;
    }
  }
  return counts;
}

function buildGameState(
  view: PlayerView,
  viewerSeat: SeatId,
  assignedKinds: Map<string, PieceKind>,
): GameState {
  const pieces: Record<string, PieceState> = {};
  const cellIndex: Record<string, string> = {};
  for (const p of view.pieces) {
    const kind: PieceKind | null =
      p.kind ?? assignedKinds.get(p.id) ?? null;
    if (!kind) {
      throw new SampleInfeasibleError(
        p.owner,
        `piece ${p.id} at ${p.cellId} ended with no assigned kind`,
      );
    }
    pieces[p.id] = { id: p.id, kind, owner: p.owner, cellId: p.cellId };
    cellIndex[p.cellId] = p.id;
  }
  // knownToPlayers: give the viewer full visibility in this sampled world.
  // Other seats' visibility doesn't matter — the rollout uses debug-mode views
  // for them (perfect-info playing in the sampled world).
  const knownToPlayers: Record<string, SeatId[]> = {};
  for (const pid of Object.keys(pieces)) {
    knownToPlayers[pid] = [viewerSeat];
  }
  return {
    mode: view.mode,
    teams: view.teams,
    seats: view.seats,
    pieces,
    cellIndex,
    knownToPlayers,
    flagRevealed: view.flagRevealed,
    marshalDead: view.marshalDead,
    phase: 'PLAYING',
    turn: view.turn,
    turnIndex: view.turnIndex,
    movesSinceCapture: view.movesSinceCapture,
    lastCombat: view.lastCombat,
    lastMoveBySeat: view.lastMoveBySeat,
    moveHistory: view.moveHistory,
    result: null,
  };
}

function sum(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}
