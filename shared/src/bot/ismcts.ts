// ISMCTS — Information-Set Monte Carlo Tree Search (v5 escalation).
//
// Why this and not the root UCB bandit (B1, rejected): the bandit evaluated
// different moves on different sampled worlds, so move ranking chased
// world-luck. ISMCTS fixes that structurally: ONE tree is shared across all
// determinizations; each iteration samples a fresh concrete world and walks
// the same tree, so every node's statistics average over worlds by
// construction. Selection uses UCB1 restricted to the moves legal in the
// CURRENT determinization (the "subset-armed bandit" of Cowling, Powley &
// Whitehouse 2012).
//
// Team handling: 2v2 zero-sum from the root team's perspective. At nodes
// where a root-team seat moves, selection maximizes value; at opponent
// nodes it maximizes the NEGATED value (paranoid both-opponents-minimize).
//
// Tree keying: a node's children are keyed by "from>to" move strings. The
// same key can mean slightly different positions across determinizations —
// that aliasing is inherent to ISMCTS and is what shares statistics across
// worlds.

import { applyMoveForRollout, legalMovesForTurn, type GameState, type SeatId } from '../engine.js';
import { TEAMS_2V2 } from '../engine.js';
import type { BotMoveContext, PickedMove } from './types.js';
import { legalMovesForBot } from './legal.js';
import { computeBeliefs } from './belief.js';
import { sampleConcreteWorld, SampleInfeasibleError } from './sampler.js';
import { playOutFromSampled, type PlayoutPolicy } from './rollout.js';
import { evaluateRollout, type SpatialWeights } from './evaluate.js';
import { seededRng } from './mc.js';
import { v2_1 } from './v2_1.js';

export interface IsmctsOptions {
  /** Tree iterations (one determinization + descent + rollout each). */
  iterations: number;
  /** UCB exploration constant, on the clipped-utility scale. */
  c: number;
  /** Rollout depth from the expanded leaf. */
  rolloutDepth: number;
  /** Maximum tree depth before forced rollout (plies from root). */
  maxTreeDepth: number;
  /** Clip rollout values to ±clip for tree statistics (win sentinels otherwise kill UCB). */
  clip: number;
  /** Resample a fresh determinization every `worldEvery` iterations. */
  worldEvery: number;
  spatial?: SpatialWeights;
  playoutPolicy?: PlayoutPolicy;
}

interface Node {
  /** Sum of clipped values (from the root team's perspective). */
  sum: number;
  visits: number;
  /** Visits in which this node's move was LEGAL/available (for subset-UCB). */
  available: number;
  children: Map<string, Node>;
}

const newNode = (): Node => ({ sum: 0, visits: 0, available: 0, children: new Map() });

export function runIsmcts(ctx: BotMoveContext, opts: IsmctsOptions): PickedMove | null {
  const { view, seat, random } = ctx;
  const rootMoves = legalMovesForBot(view, seat);
  if (rootMoves.length === 0) return null;
  if (rootMoves.length === 1) return rootMoves[0]!;

  const beliefs = computeBeliefs(view, seat);
  const myTeam = view.mode === '2v2' ? view.teams[seat] : null;
  const isMyTeamSeat = (s: SeatId) =>
    view.mode === '2v2' ? TEAMS_2V2[s] === myTeam : s === seat;

  const root = newNode();
  // Pre-create root children so the final pick can't miss a root move.
  for (const m of rootMoves) root.children.set(`${m.from}>${m.to}`, newNode());

  let sampled: GameState | null = null;
  let worldAge = 0;
  let completed = 0;

  for (let it = 0; it < opts.iterations; it++) {
    if (!sampled || worldAge >= opts.worldEvery) {
      sampled = sampleWorld(view, beliefs, seat, random);
      worldAge = 0;
      if (!sampled) continue;
    }
    worldAge += 1;

    const rng = seededRng((it * 0x9e3779b1) ^ Math.floor(random() * 0xffffffff));
    let state: GameState = sampled;
    let node = root;
    const path: Node[] = [root];

    // 1. Selection + expansion (single pass; expansion = first unvisited child).
    let depth = 0;
    while (state.phase === 'PLAYING' && depth < opts.maxTreeDepth) {
      const mover = state.turn;
      const legal = legalMovesForTurn(state);
      if (legal.length === 0) break;

      // Mark availability + find selection among legal moves only.
      let chosenKey: string | null = null;
      let chosenMove: { from: string; to: string } | null = null;
      let bestScore = -Infinity;
      const maximizing = isMyTeamSeat(mover);
      const logA = Math.log(Math.max(2, node.visits + 1));
      for (const m of legal) {
        const key = `${m.from}>${m.to}`;
        let child = node.children.get(key);
        if (!child) {
          child = newNode();
          node.children.set(key, child);
        }
        child.available += 1;
        let score: number;
        if (child.visits === 0) {
          // Unvisited: expand immediately (first-play urgency), with a dash
          // of randomness so expansion order varies across iterations.
          score = 1e9 + rng();
        } else {
          const mean = child.sum / child.visits;
          const dir = maximizing ? mean : -mean;
          score = dir + opts.c * Math.sqrt(Math.log(Math.max(2, child.available)) / child.visits);
        }
        if (score > bestScore) {
          bestScore = score;
          chosenKey = key;
          chosenMove = m;
        }
      }
      if (!chosenKey || !chosenMove) break;

      const child = node.children.get(chosenKey)!;
      state = applyMoveForRollout(state, mover, chosenMove.from, chosenMove.to);
      node = child;
      path.push(child);
      depth += 1;
      if (child.visits === 0) break; // freshly expanded — stop descending
      void logA;
    }

    // 2. Rollout + evaluation from the leaf.
    const terminal = state.phase === 'PLAYING'
      ? playOutFromSampled(state, opts.rolloutDepth, rng, undefined, opts.playoutPolicy)
      : state;
    const raw = evaluateRollout(terminal, seat, opts.spatial);
    const value = Math.max(-opts.clip, Math.min(opts.clip, raw));

    // 3. Backpropagation.
    for (const n of path) {
      n.sum += value;
      n.visits += 1;
    }
    completed += 1;
  }

  if (completed === 0) return v2_1.pickMove(ctx);

  // Final pick: most-visited root child (standard robust-child rule).
  let best: PickedMove | null = null;
  let bestVisits = -1;
  for (const m of rootMoves) {
    const child = root.children.get(`${m.from}>${m.to}`)!;
    if (child.visits > bestVisits) {
      bestVisits = child.visits;
      best = { from: m.from, to: m.to };
    }
  }
  return best;
}

function sampleWorld(
  view: BotMoveContext['view'],
  beliefs: ReturnType<typeof computeBeliefs>,
  seat: SeatId,
  random: () => number,
): GameState | null {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return sampleConcreteWorld(view, beliefs, seat, seededRng(Math.floor(random() * 0xffffffff)));
    } catch (e) {
      if (!(e instanceof SampleInfeasibleError)) throw e;
    }
  }
  return null;
}
