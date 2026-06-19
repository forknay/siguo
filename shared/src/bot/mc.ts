// Shared belief-sampled Monte Carlo core, parameterized so multiple bot
// versions can reuse it. v3-mc uses the defaults (behavior-frozen); v3.1
// passes a spatial evaluator + a partner-coordination root bias.

import { applyMoveForRollout, type GameState, type SeatId } from '../engine.js';
import type { PieceKind } from '../pieces.js';
import type { BotMoveContext, PickedMove } from './types.js';
import { legalMovesForBot } from './legal.js';
import { computeBeliefs, type PieceBelief } from './belief.js';
import { sampleConcreteWorld, SampleInfeasibleError } from './sampler.js';
import { playOutFromSampled, fastTopKMoves, type PlayoutPolicy } from './rollout.js';
import {
  computeInfoValues,
  creditCombatInfo,
  forkInfoTracker,
  makeInfoTracker,
  type InfoTracker,
} from './infovalue.js';
import { evaluateRollout, type SpatialWeights } from './evaluate.js';
import { strongMoveBonus } from './values.js';
import { v2_1 } from './v2_1.js';

const MAX_RESAMPLE_ATTEMPTS = 4;

export type Beliefs = Map<string, PieceBelief>;
type Move = { from: string; to: string };

export interface MonteCarloOptions {
  samples: number;
  depth: number;
  /** Spatial weights for evaluation. Omit for the base material-only eval. */
  spatial?: SpatialWeights;
  /** Extra additive root-move bias, evaluated once per candidate. Default: none. */
  rootBias?: (move: Move, view: BotMoveContext['view'], beliefs: Beliefs) => number;
  /** Return true to DROP a root move before search (hard prune). Default: keep all. */
  pruneRootMove?: (move: Move, view: BotMoveContext['view'], beliefs: Beliefs) => boolean;
  /**
   * Successive-halving racing. After `screenSamples` samples on EVERY move,
   * keep only the top `keepFraction` (min `keepAtLeast`) for the remaining
   * samples. Most root moves are obviously bad after a few samples; pruning
   * them early redirects the budget to contenders, which is what pays for the
   * deeper rollouts. Omit to evaluate all moves with all samples (v3-mc).
   */
  racing?: {
    screenSamples: number;
    keepFraction: number;
    keepAtLeast: number;
    /**
     * Loss-forensics: most lost games were already 300–400 material down by
     * turn 50, and the opening is where the screen is least reliable (max
     * branching, 6-sample means). When more than `wideAt` root moves exist,
     * screen with `screenSamplesWide` samples instead.
     */
    wideAt?: number;
    screenSamplesWide?: number;
  };
  /**
   * B4 — opponent-reply minimization. Mean rollouts average over opponent
   * replies, so a move with ONE crushing refutation still looks fine if the
   * other nine replies are harmless; a human always plays the refutation.
   * With this on, after our root move we enumerate the opponent's top-`k`
   * replies (by the fast policy's own scoring), roll each out, and score the
   * root move as `blend·worst + (1−blend)·mean` of those continuations.
   * Costs ×k rollouts per (sample, move) — racing absorbs it for survivors.
   */
  replyMin?: {
    k: number;
    blend: number;
    /**
     * Also minimize over the SECOND opponent's top-`k2` replies (after the
     * partner's policy move). Turn order N→E→S→W means a root move by N gets
     * E's refutation modeled by plain reply-min while W's goes unmodeled —
     * half the refutations are invisible. Costs ×(1+k2) rollouts per reply.
     */
    k2?: number;
  } | null;
  /**
   * H1 — information-value weight. Prices every unknown enemy piece by what
   * we'd learn from fighting it (scaled by proximity to their likely flag) and
   * credits rollout combats involving our pieces accordingly. Makes probing
   * and bomb-baiting emergent. ~60 ≈ half a 排长 per flag-adjacent unknown.
   */
  infoWeight?: number;
  /** Playout policy tuning (greedy-ε rollouts). Omit for the frozen weighted-draw policy. */
  playoutPolicy?: PlayoutPolicy;
  /**
   * B2 — common random numbers. Per sample, every root move's rollout uses the
   * SAME seed stream (instead of a per-move stream), so the moves' values
   * differ only where their lines genuinely diverge. Reduces the variance of
   * the *difference* between moves, which is what move selection ranks on.
   */
  commonRandomNumbers?: boolean;
  /**
   * B1 — UCB1 root bandit, replacing racing's hard cut (`racing` is ignored
   * when set). Each pull runs one rollout for the move maximizing
   * `mean + bias + c·sqrt(ln N / n)`; sampled worlds rotate every
   * `worldEvery` pulls. Rollout values are clipped to ±`clip` for the bandit
   * statistics so the ±100k win sentinels don't destroy exploration.
   * `samples` is reinterpreted as the total pull budget ≈ samples × moveCount
   * is NOT used; set `pullBudget` explicitly.
   */
  ucb?: { c: number; pullBudget: number; warmupPulls: number; worldEvery: number; clip: number };
}

export const DEFAULT_MC: MonteCarloOptions = { samples: 20, depth: 6 };

/** Racing config used by v3.1+: screen wide, then go deep on the top quarter. */
export const RACING_MC: Required<Pick<MonteCarloOptions, 'racing'>>['racing'] = {
  screenSamples: 6,
  keepFraction: 0.25,
  keepAtLeast: 8,
};

export function runMonteCarlo(ctx: BotMoveContext, opts: MonteCarloOptions): PickedMove | null {
  const { view, seat, random } = ctx;
  const allMoves = legalMovesForBot(view, seat);
  if (allMoves.length === 0) return null;

  const beliefs = computeBeliefs(view, seat);

  // Hard prune (e.g. don't attack a piece we've observed to be stronger). Keep
  // at least one move so we never return null when legal moves exist.
  const moves = opts.pruneRootMove
    ? (() => {
        const kept = allMoves.filter((m) => !opts.pruneRootMove!(m, view, beliefs));
        return kept.length > 0 ? kept : allMoves;
      })()
    : allMoves;
  if (moves.length === 1) return moves[0]!;

  const scoreSums = new Array<number>(moves.length).fill(0);
  const visits = new Array<number>(moves.length).fill(0);
  // Racing: which moves are still in contention. All start active.
  const active = new Array<boolean>(moves.length).fill(true);

  // Per-move biases are constant across samples — compute once. They're used
  // both at the racing cut (so a bias-rescued move isn't pruned) and at the end.
  const kindByCell = new Map<string, PieceKind>();
  for (const p of view.pieces) {
    if (p.owner === seat && p.kind) kindByCell.set(p.cellId, p.kind);
  }
  const biases = moves.map((m) => {
    const movingKind = kindByCell.get(m.from);
    const strongBias = movingKind ? strongMoveBonus(movingKind) : 0;
    const extra = opts.rootBias ? opts.rootBias(m, view, beliefs) : 0;
    return strongBias + extra;
  });

  const screenAt = opts.racing && moves.length > opts.racing.keepAtLeast
    ? (opts.racing.wideAt && opts.racing.screenSamplesWide && moves.length > opts.racing.wideAt
        ? opts.racing.screenSamplesWide
        : opts.racing.screenSamples)
    : Infinity;

  // H1: price the unknown enemy pieces once; rollout combats credit them.
  const infoValues = opts.infoWeight ? computeInfoValues(view, beliefs, seat) : null;

  // B1: UCB1 bandit at the root replaces the uniform/racing sample loop.
  if (opts.ucb) {
    return runUcbRoot(ctx, opts, beliefs, moves, biases, infoValues);
  }

  let successfulSamples = 0;
  for (let s = 0; s < opts.samples; s++) {
    const sampleSeed = Math.floor(random() * 0xffffffff);
    let sampled: GameState | undefined;
    let attempt = 0;
    while (attempt < MAX_RESAMPLE_ATTEMPTS) {
      try {
        sampled = sampleConcreteWorld(view, beliefs, seat, seededRng(sampleSeed + attempt));
        break;
      } catch (e) {
        if (e instanceof SampleInfeasibleError) {
          attempt += 1;
          continue;
        }
        throw e;
      }
    }
    if (!sampled) continue;

    successfulSamples += 1;
    // Reply-min is expensive (×k rollouts), so during racing it only kicks in
    // AFTER the screening cut — survivors get the pessimistic evaluation, the
    // wide screen stays cheap. Without racing it applies to every sample.
    const racingActive = screenAt !== Infinity;
    const applyReplyMin = !!opts.replyMin && (!racingActive || successfulSamples > screenAt);

    for (let i = 0; i < moves.length; i++) {
      if (!active[i]) continue;
      const m = moves[i]!;
      const value = evalMoveOnWorld(
        sampled, m, opts, seat,
        opts.commonRandomNumbers ? sampleSeed : sampleSeed ^ (i * 0x9e3779b1),
        infoValues, applyReplyMin,
      );

      scoreSums[i] = scoreSums[i]! + value;
      visits[i] = visits[i]! + 1;
    }

    // Racing cut: after the screening stage, keep only the top contenders.
    if (successfulSamples === screenAt && opts.racing) {
      const ranked = moves
        .map((_, i) => ({ i, score: visits[i]! > 0 ? scoreSums[i]! / visits[i]! + biases[i]! : -Infinity }))
        .sort((a, b) => b.score - a.score);
      const keep = Math.max(opts.racing.keepAtLeast, Math.ceil(moves.length * opts.racing.keepFraction));
      for (let r = 0; r < ranked.length; r++) {
        if (r >= keep) active[ranked[r]!.i] = false;
      }
    }
  }

  if (successfulSamples === 0) return v2_1.pickMove(ctx);

  let bestIdx = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < moves.length; i++) {
    if (!active[i] || visits[i]! === 0) continue;
    const score = scoreSums[i]! / visits[i]! + biases[i]!;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  const pick = moves[bestIdx]!;
  return { from: pick.from, to: pick.to };
}

/** B1 — UCB1 root bandit. Pulls go to the move maximizing
 *  `mean + bias + c·sqrt(ln N / n)`; sampled worlds rotate every `worldEvery`
 *  pulls so estimates average over hidden-information hypotheses. Reply-min
 *  (when configured) applies to EVERY pull — the bandit, not a screening
 *  stage, decides who gets the expensive treatment. */
function runUcbRoot(
  ctx: BotMoveContext,
  opts: MonteCarloOptions,
  beliefs: Beliefs,
  moves: Move[],
  biases: number[],
  infoValues: Map<string, number> | null,
): PickedMove | null {
  const { view, seat, random } = ctx;
  const u = opts.ucb!;
  const n = moves.length;
  const sums = new Float64Array(n);
  const counts = new Float64Array(n);

  let sampled: GameState | null = null;
  let worldSeed = 0;
  let worldAge = 0;
  let totalPulls = 0;

  const refreshWorld = (): boolean => {
    worldSeed = Math.floor(random() * 0xffffffff);
    for (let attempt = 0; attempt < MAX_RESAMPLE_ATTEMPTS; attempt++) {
      try {
        sampled = sampleConcreteWorld(view, beliefs, seat, seededRng(worldSeed + attempt));
        worldAge = 0;
        return true;
      } catch (e) {
        if (!(e instanceof SampleInfeasibleError)) throw e;
      }
    }
    sampled = null;
    return false;
  };

  const pull = (i: number): boolean => {
    if (!sampled || worldAge >= u.worldEvery) {
      if (!refreshWorld()) return false;
    }
    const pullSeed = (worldSeed ^ (i * 0x9e3779b1) ^ (counts[i]! * 0x7feb352d)) | 0;
    const raw = evalMoveOnWorld(sampled!, moves[i]!, opts, seat, pullSeed, infoValues, !!opts.replyMin);
    // Clip win/loss sentinels so one lucky terminal doesn't end exploration.
    const value = Math.max(-u.clip, Math.min(u.clip, raw));
    sums[i] = sums[i]! + value;
    counts[i] = counts[i]! + 1;
    worldAge += 1;
    totalPulls += 1;
    return true;
  };

  // Warmup: every move gets a baseline estimate.
  for (let w = 0; w < u.warmupPulls; w++) {
    for (let i = 0; i < n; i++) {
      if (!pull(i)) break;
    }
  }
  if (totalPulls === 0) return v2_1.pickMove(ctx);

  while (totalPulls < u.pullBudget) {
    let bestI = 0;
    let bestU = -Infinity;
    const logN = Math.log(Math.max(2, totalPulls));
    for (let i = 0; i < n; i++) {
      const c = counts[i]!;
      const score = c === 0
        ? Infinity
        : sums[i]! / c + biases[i]! + u.c * Math.sqrt(logN / c);
      if (score > bestU) {
        bestU = score;
        bestI = i;
      }
    }
    if (!pull(bestI)) break;
  }

  let bestIdx = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < n; i++) {
    if (counts[i]! === 0) continue;
    const score = sums[i]! / counts[i]! + biases[i]!;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  const pick = moves[bestIdx]!;
  return { from: pick.from, to: pick.to };
}

/** One evaluation of root move `m` on a concrete sampled world: root combat
 *  credit, optional reply-min over the opponent's top-k exact replies, rollout,
 *  evaluation. Deterministic given `pullSeed`. */
function evalMoveOnWorld(
  sampled: GameState,
  m: Move,
  opts: MonteCarloOptions,
  seat: SeatId,
  pullSeed: number,
  infoValues: Map<string, number> | null,
  applyReplyMin: boolean,
): number {
  // H1: per-(sample, move) tracker; the root move itself may be a probe.
  const rootInfo = infoValues
    ? makeInfoTracker(seat, opts.infoWeight!, infoValues)
    : undefined;
  if (rootInfo) creditCombatInfo(rootInfo, sampled, m.from, m.to);
  // Root moves come from legalMovesForBot, and legality depends only on
  // our own piece's kind + board occupancy — identical in the sampled
  // world — so the unchecked fast path is safe here too.
  const afterRoot = applyMoveForRollout(sampled, seat, m.from, m.to);

  if (applyReplyMin && opts.replyMin && afterRoot.phase === 'PLAYING') {
    // B4: assume the opponent finds their best reply among their top-k.
    const replies = fastTopKMoves(afterRoot, opts.replyMin.k);
    if (replies.length > 0) {
      let worst = Infinity;
      let sum = 0;
      for (let ri = 0; ri < replies.length; ri++) {
        const rep = replies[ri]!;
        const branchInfo = rootInfo ? forkInfoTracker(rootInfo) : undefined;
        if (branchInfo) creditCombatInfo(branchInfo, afterRoot, rep.from, rep.to);
        const afterReply = applyMoveForRollout(afterRoot, afterRoot.turn, rep.from, rep.to);
        let v: number;
        if (opts.replyMin.k2 && afterReply.phase === 'PLAYING') {
          // Second-opponent min: partner plays one policy ply, then the other
          // opponent gets their best refutation among top-k2.
          const afterPartner = playOutFromSampled(
            afterReply, 1,
            seededRng(pullSeed ^ ((ri + 1) * 0x85ebca6b) ^ 0x5bd1e995),
            branchInfo, opts.playoutPolicy,
          );
          if (afterPartner.phase !== 'PLAYING') {
            v = evaluateRollout(afterPartner, seat, opts.spatial) + (branchInfo?.bonus ?? 0);
          } else {
            const replies2 = fastTopKMoves(afterPartner, opts.replyMin.k2);
            if (replies2.length === 0) {
              v = rolloutValue(
                afterPartner, opts, seat,
                seededRng(pullSeed ^ ((ri + 1) * 0x85ebca6b)),
                branchInfo, Math.max(0, opts.depth - 3),
              );
            } else {
              let worst2 = Infinity;
              for (let rj = 0; rj < replies2.length; rj++) {
                const rep2 = replies2[rj]!;
                const info2 = branchInfo ? forkInfoTracker(branchInfo) : undefined;
                if (info2) creditCombatInfo(info2, afterPartner, rep2.from, rep2.to);
                const after2 = applyMoveForRollout(afterPartner, afterPartner.turn, rep2.from, rep2.to);
                const vv = rolloutValue(
                  after2, opts, seat,
                  seededRng(pullSeed ^ ((ri + 1) * 0x85ebca6b) ^ ((rj + 1) * 0xc2b2ae35)),
                  info2, Math.max(0, opts.depth - 4),
                );
                if (vv < worst2) worst2 = vv;
              }
              v = worst2;
            }
          }
        } else {
          v = rolloutValue(
            afterReply, opts, seat,
            seededRng(pullSeed ^ ((ri + 1) * 0x85ebca6b)),
            branchInfo,
            Math.max(0, opts.depth - 2),
          );
        }
        if (v < worst) worst = v;
        sum += v;
      }
      const { blend } = opts.replyMin;
      return blend * worst + (1 - blend) * (sum / replies.length);
    }
  }
  return rolloutValue(afterRoot, opts, seat, seededRng(pullSeed), rootInfo);
}

/** Roll out, evaluate, and add any information-value credit (H1). */
function rolloutValue(
  state: GameState,
  opts: MonteCarloOptions,
  seat: SeatId,
  rng: () => number,
  info?: InfoTracker,
  depth: number = opts.depth,
): number {
  const terminal = playOutFromSampled(state, depth, rng, info, opts.playoutPolicy);
  return evaluateRollout(terminal, seat, opts.spatial) + (info?.bonus ?? 0);
}

/** Mulberry32 sub-RNG. */
export function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type { SeatId };
