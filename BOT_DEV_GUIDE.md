# Bot development guide — read this first

This is the **onboarding + how-to-improve** document for the Si Guo Jun Qi bot.
It is written so you can pick up the bot and make it stronger **with no prior
context other than this file**. It is deliberately step-by-step and deeply
nested.

How this relates to the other docs:

- **`BOT_DEV_GUIDE.md` (this file)** — the tutorial + recipe + roadmap. Start here.
- **`BOT.md`** — the chronological design log + research notes + the full
  experiment table (the "lab notebook"). Cite it for *why* a decision was made.
- **`IDEAS.md`** — the brainstorm backlog, deep-dive designs, and the
  parked/rejected list (so we don't re-litigate dead ends).
- **`TODO.md`** — the task ledger and test inventory.

If this guide and the others ever disagree, the **code wins**, then this guide,
then BOT.md. Update this file when you change the architecture.

---

## Table of contents

1. [Prerequisites & 60-second game model](#1-prerequisites--60-second-game-model)
2. [Architecture map (every file)](#2-architecture-map-every-file)
3. [Core concepts you MUST understand](#3-core-concepts-you-must-understand)
4. [The version lineage (v0 → v4.2)](#4-the-version-lineage-v0--v42)
5. [The current champion v4.2 — full pipeline walkthrough](#5-the-current-champion-v42--full-pipeline-walkthrough)
6. [How to run experiments (the methodology)](#6-how-to-run-experiments-the-methodology)
7. [Recipe: add a new bot version](#7-recipe-add-a-new-bot-version)
8. [Hard-won lessons (what worked, what failed, why)](#8-hard-won-lessons-what-worked-what-failed-why)
9. [The forward roadmap (what to try next)](#9-the-forward-roadmap-what-to-try-next)
10. [Invariants & pitfalls (things that will bite you)](#10-invariants--pitfalls-things-that-will-bite-you)

---

## 1. Prerequisites & 60-second game model

### 1.1 Tooling

- Node 20+, `pnpm` via corepack. From the repo root: `pnpm install`.
- Everything bot-related lives in the `shared/` workspace (`@siguo/shared`).
- Commands you'll use constantly:
  - `pnpm -C shared test` — run the 144-test Vitest suite.
  - `pnpm -C shared typecheck` — strict TS check (catches most mistakes).
  - `pnpm -C shared bot-eval-par -- …` — the parallel bot-vs-bot evaluator (§6).
  - `pnpm -C shared bot-bench` — per-move latency benchmark.

### 1.2 Just enough of the game

Si Guo Jun Qi is 4-player (N/E/S/W) fog-of-war Stratego on a cross-shaped board.
Default mode is **2v2**: N+S vs E+W, partners opposite each other.

- Each player has **25 pieces**: ranked soldiers 司令(9) 军长(8) 师长(7)×2
  旅长(6)×2 团长(5)×2 营长(4)×2 连长(3)×3 排长(2)×3 工兵(1, engineer)×3, plus
  炸弹(bomb)×2, 地雷(mine)×3, 军旗(flag)×1.
- **Combat**: higher rank wins; equal = both die; **bomb** = mutual destruction
  with anything; **mine** kills any attacker *except* an engineer (who defuses
  it); attacking the **flag** wins the game against that player.
- **Movement**: one road step, or a multi-cell rail slide. Non-engineers can't
  turn rail corners *except* the four curved central-corner cells. The central
  3×3 (九宫) is reachable from front-line cols 1/3/5; its center `C-2-2` is
  transit-only.
- **Win**: 2v2 → both opposing flags captured. 70 moves with no capture → draw.
- **Fog**: you see only your own pieces' kinds. Combat reveals identities **only
  to the two combatants**, and the bot must respect this.

Full rules: `README.md` § "Rule-spec quick reference". Engine: `shared/src/`
(`board.ts`, `pieces.ts`, `moves.ts`, `combat.ts`, `engine.ts`).

### 1.3 The bot's prime directive

> **The bot plays under the same fog a human gets.** It consumes a `PlayerView`
> (its own kinds + what it has deduced), **never** the god-mode `GameState`.

The one exception is *inside* a rollout, where the bot is playing out a
**concrete sampled world** it invented — there, all kinds are known because the
bot is the one who assigned them (see §3.3).

---

## 2. Architecture map (every file)

All paths under `shared/src/`. The bot is `bot/`; the rest is the rules engine.

### 2.1 Engine (don't change casually — bots depend on exact semantics)

| File | Role |
|---|---|
| `board.ts` | The 129-cell graph: cells, road edges, rail edges, curve corners, `getCell`, `getRoadNeighbors`. |
| `pieces.ts` | The 12 `PieceKind`s, ranks, counts (`PIECE_DEFS`). |
| `moves.ts` | `legalMovesFromCell(ctx, cell)` — the move generator (road + rail + corner rules). Used everywhere. |
| `combat.ts` | The combat resolution table. |
| `engine.ts` | `GameState`, `applyMove` (full, validated, records history), **`applyMoveForRollout`** (fast, unchecked — the rollout hot path), `applyResign`, `legalMovesForTurn`, `submitSetup`, `createGameState`, `MoveRecord` (move \| resign), `TEAMS_2V2`, `STALEMATE_LIMIT`. |
| `view.ts` | `projectView(state, seat, {debug})` → `PlayerView`. **This is the fog gate** — it strips opponent kinds and combat-kind leaks. |
| `setup.ts` | `smartValidSetup(seat, seed)` (the shared opening), `validateLayout`, `hqCellIds`. |
| `replay.ts` | Game-text encoding (used by the UI replay + loss analysis). |

### 2.2 Bot core (`shared/src/bot/`)

| File | Role |
|---|---|
| `types.ts` | The `Bot` interface: `{ name, description, pickSetup(ctx), pickMove(ctx) }`. |
| `index.ts` | **The registry.** `BOTS` array, `botByName`, `LATEST_BOT` (= last entry). All experiment variants are wired here. |
| `legal.ts` | `viewMoveContext(view)` (builds a `MoveContext` from a `PlayerView`, skipping `frozen` dead pieces), `legalMovesForBot(view, seat)`, `botRng(seed)`. |
| `belief.ts` | `computeBeliefs(view, seat)` → `Map<pieceId, PieceBelief>`. Per-piece inference: `knownKind`, `minRank`/`maxRank`, `mineConfidence`, `hasMoved`. Roster-aware (C1). The bot's "deduction". |
| `sampler.ts` | `sampleConcreteWorld(view, beliefs, seat, rng)` → a concrete `GameState` (a **determinization** — every unknown gets a plausible kind). `SampleInfeasibleError`, `ROSTER`. |
| `rollout.ts` | `playOutFromSampled(state, depth, rng, info?, policy?)` — the playout. `fastPickMove`/`scoreMoves` (the fast policy), `fastTopKMoves` (for reply-min), `PlayoutPolicy` (greedy-ε, avoid-hanging, advance-bias). |
| `evaluate.ts` | `evaluateRollout(state, seat, spatial?)` — the static eval at a rollout's end. `SpatialWeights`, `V31_SPATIAL`, `V4_SPATIAL`. Material + marshal + flag offense/defense + clock + trade + camp. |
| `mc.ts` | **`runMonteCarlo(ctx, opts)`** — the search. Racing, reply-min (B4), CRN (B2), info-value plumbing (H1), and `runUcbRoot` (B1, rejected). `MonteCarloOptions`, `RACING_MC`, `seededRng`. |
| `ismcts.ts` | `runIsmcts(ctx, opts)` — the v5 tree search (implemented, **rejected**, kept for reference). |
| `distances.ts` | `moveDistance(a, b)` — precomputed all-pairs board move-distances (D7). Replaces Manhattan. |
| `flaghypothesis.ts` | `flagHypothesisFor` / `likelyFlagCell` — rank an opponent's flag-HQ candidates. |
| `infovalue.ts` | H1 information-value model (emergent bomb-baiting). Prices unknown enemies; credits rollout combats. |
| `values.ts` | `PIECE_VALUE` table (engineer = 100 = 旅长), `strongMoveBonus`, `STRONG_MOVE_BIAS`. |
| `v0.ts … v4.ts` | The bot versions. `v3_1.ts` exports reusable helpers (`engineerBias`, `observedLosingAttackPenalty`, `biasBombTowardFlag`, `makeV31Bot`). `v4.ts` exports `makeV4Bot`/`makeV5Bot` factories and the shipped `v4`, `v4_1`, `v4_2`. |

### 2.3 Scripts (`shared/scripts/`)

| Script | Command | Purpose |
|---|---|---|
| `bot-eval.ts` | `pnpm -C shared bot-eval -- …` | Single-process bot-vs-bot games. `--json` for machine output. |
| `bot-eval-par.ts` | `pnpm -C shared bot-eval-par -- …` | **Use this.** Shards games across worker processes; same seeds = same results. |
| `bot-bench.ts` | `pnpm -C shared bot-bench` | Per-move latency (so you keep `normal`-speed live play playable). |
| `bot-loss-analysis.ts` | `tsx shared/scripts/bot-loss-analysis.ts` | Replays losses and prints where the game was lost (material-by-turn, flag-fall timing). The data-driven path to the next gain. |

### 2.4 Server wiring (how the bot reaches live play)

`server/src/bot.ts` is a thin driver: on a bot's turn it builds
`projectView(state, seat, {debug:false})` and calls `LATEST_BOT.pickMove`. It is
**speed-gated**: `fast`/`instant` lobby speeds fall back to the cheap `v2_1`
heuristic; `normal`/`slow` use `LATEST_BOT` (the expensive planner). To ship a
new champion: make it the last entry in `BOTS` (so `LATEST_BOT` points at it).

---

## 3. Core concepts you MUST understand

The bot is **belief-sampled flat Monte Carlo**. Read this section before
touching any code; every later section assumes it.

### 3.1 The one-sentence summary

> For the current turn, the bot imagines ~44 complete versions of the hidden
> board ("worlds"), and in each world it plays every legal move forward a few
> plies with a fast policy, scores the result, and finally plays the move with
> the best average score.

### 3.2 PlayerView and beliefs (what the bot knows)

1. **`PlayerView`** (`view.ts`): the fog-filtered state. Own pieces have `kind`;
   opponents have `kind = null` until revealed. `moveHistory` has combat
   *outcomes* but the kinds are stripped for combats you weren't in.
2. **`computeBeliefs(view, seat)`** (`belief.ts`): walks `moveHistory` and the
   board to produce, per opponent piece, a `PieceBelief`:
   - `knownKind` — set only if revealed to *us*.
   - `minRank`/`maxRank` — bounds from combats we were in (e.g. "this piece beat
     my 师长, so rank ≥ 8"). A bomb never carries a `minRank` (it never survives).
   - `mineConfidence` 0..1 — accumulated from failed attacks on a cell + position
     priors (back-row unmoved pieces look mine-ish).
   - `hasMoved` — has the cell ever been a move source.
   - Roster-aware (C1): `estimateRank` averages over the *remaining* pool of
     unrevealed kinds, so as strong pieces die the estimate for the rest drops.

### 3.3 Determinization: sampling a concrete world

`sampleConcreteWorld(view, beliefs, seat, rng)` (`sampler.ts`) turns the foggy
view into a **concrete `GameState`** by assigning every unknown opponent piece a
plausible kind, respecting:

- Hard constraints: per-seat roster counts (25 pieces, right multiplicities),
  `knownKind`, `minRank`/`maxRank`, `excludedKinds` (a moved piece isn't a
  mine/flag), and setup rules (flag in HQ, mines in back two rows, bombs not in
  row 6).
- Soft priors: back-row-unmoved pieces are weighted toward mine, etc.

It throws `SampleInfeasibleError` if constraints can't be met; callers retry with
a new seed up to 4 times, then fall back to `v2_1`. **One sample = one
hypothesis** of the hidden board. Averaging across samples is how the bot
reasons under uncertainty.

### 3.4 The rollout (playing a world forward)

`playOutFromSampled(state, depth, rng, info?, policy?)` (`rollout.ts`) plays
`depth` plies with the **fast policy** (`fastPickMove`):

- It scores each legal move: attacks by a fast EV table (`fastScoreAttack`, all
  kinds known in the sampled world), quiet moves by `1 + strongMoveBonus`.
- **Playout policy** (`PlayoutPolicy`), the single most important lever found:
  - `greedyEps` (e.g. 0.7): with prob 0.7 play the **argmax** move instead of a
    weighted random draw. **Capture-first**: take the best clearly-winning attack
    (weight > 4) if one exists, else the best quiet move — because attack weights
    (EV/5) and quiet weights (1+bonus) are on different scales and a naive argmax
    would shuffle heavyweights instead of taking free material.
  - `avoidHanging`: ×0.2 weight for quiet moves onto a square a stronger
    road-adjacent enemy (or bomb) could take next ply. Fixes systematic
    "hanging pieces" rollout error.
  - `advanceBias`: nudge quiet moves toward the nearest enemy flag (needs a
    direction so greedy quiet play isn't arbitrary).
- **Why short rollouts?** The depth experiment (§8) found d3 > d9 > d12: the fast
  policy is noisy, so long playouts dilute the root signal. v4 uses **depth 4**
  and spends the saved compute on more *samples* and an *exact* opponent ply.

### 3.5 The evaluation (scoring a rollout's end)

`evaluateRollout(state, seat, spatial?)` (`evaluate.ts`), from the team's view:

- Terminal: ±100,000 win/loss sentinel; 0 for draw.
- Else: `material/10` + marshal-alive bonus + (with `spatial`):
  - **Flag offense** — reward our nearest piece being close to each enemy flag.
  - **Flag safety** — penalty for the nearest enemy being close to our flag.
  - **D5 clock** — leading + stale 70-move clock = bad; trailing = good.
  - **I2 trade policy** — a material lead is worth more in sparser positions
    (so the bot simplifies when ahead, avoids trades when behind).
  - **D6 camp refuge** — small bonus for high-value pieces parked in attack-proof
    camps.
  - **I3 down-player urgency** — when 1v2 (partner dead), the trade sign flips
    and flag-advance ×1.5.
  - **D7** distances are true board `moveDistance`, not Manhattan.
- `V31_SPATIAL` = the v3.1 weights (flagAdvance 300, flagSafety 400, Manhattan).
  `V4_SPATIAL` = v4 weights (graph distances + clock 250 + trade 0.6 + camp 40).

### 3.6 The search (choosing the move)

`runMonteCarlo(ctx, opts)` (`mc.ts`):

1. `legalMovesForBot` → candidate root moves. (Optional hard `pruneRootMove`,
   but **never prune by static score** — that kills setup/clearance moves.)
2. Precompute per-move `biases` (strong-piece bonus + `rootBias`, e.g. partner
   coordination, engineer reveal/probe, observed-losing-attack penalty).
3. **Racing** (successive halving): play `screenSamples` (6, or `wideAt`/wide
   in the opening) samples on every move, then keep the top `keepFraction`
   (≥ `keepAtLeast`) and spend the rest of the `samples` only on survivors.
4. For each (sample, surviving move): sample a world, apply the root move with
   `applyMoveForRollout`, optionally **reply-min**, roll out, evaluate.
5. **Reply-min (B4)** — after the screen, assume the opponent finds their best
   reply among their top-`k` (`fastTopKMoves`); score the root move as
   `blend·worst + (1−blend)·mean`. `k2` extends this to the *second* opponent
   after the partner's policy ply. This catches the "one crushing refutation
   hides in the average" blind spot. Costs ×k rollouts per (sample, move);
   racing pays for it by only doing it on survivors.
6. Pick the argmax of `mean + bias` over surviving moves.

Rejected alternatives kept behind options: **`ucb`** (B1 root bandit) and the
separate `ismcts.ts` tree — both broke because they share statistics across
*different* sampled worlds (see §8).

---

## 4. The version lineage (v0 → v4.2)

Each version is a file; old versions are **frozen** (kept in the registry as
measurement baselines — do not edit their behavior). Strength numbers are net
win rate vs the *previous* champion across both team orientations.

| Ver | File | One-line idea | Strength |
|---|---|---|---|
| v0 | `v0.ts` | Fog-respecting weighted-attack baseline; rank-4 prior for unknowns. | reference |
| v1 | `v1.ts` | + belief-aware scoring (`estimatedRank` from combats). | ~55% vs v0 |
| v2 | `v2.ts` | + strict fog, mine-confidence cell filtering, bomb-as-attacker. | ~68% vs v1 |
| v2.1 | `v2_1.ts` | + anti-shuffle, EV combat scoring, engineer valued at 100. Also the **rollout fast policy's ancestor** and the speed/instant fallback bot. | ~68% vs v2 |
| v3-mc | `v3_mc.ts` | **First Monte Carlo bot.** ~20 sampled worlds × 6-ply rollouts, material eval. | ~85% vs v2.1 |
| v3.1 | `v3_1.ts` | + spatial eval (`V31_SPATIAL`: flag offense/defense), partner coordination, flag-column bomb placement, racing (`RACING_MC`), engineer reveal/probe biases, observed-losing-attack penalty. | ~75% vs v3-mc |
| v4 | `v4.ts` (`v4-replymin`) | + reply-min (B4), graph distances (D7), clock (D5), trade (I2), camp (D6), roster beliefs (C1). | 68.8% vs v3.1 |
| v4.1 | `v4_1` | v4 + info-value (H1, bomb-baiting) + dead-partner urgency (I3). **Costs strength in self-play** (62.5%); kept for human play. | — |
| **v4.2** | `v4_2` (`v4.2-greedy`) | **CHAMPION / `LATEST_BOT`.** v4 + capture-first greedy-ε playouts (ε=0.7) at S=44. | **80.2% vs v3.1** (96 games) |

`v3_1.ts` and `v4.ts` expose **factories** (`makeV31Bot`, `makeV4Bot`,
`makeV5Bot`, `makeV4BotWithLayout`) so config variants can be laddered in the
eval harness without copy-pasting a bot.

---

## 5. The current champion v4.2 — full pipeline walkthrough

`v4_2 = makeV4Bot('v4.2-greedy', { samples: 44, playoutPolicy: { greedyEps: 0.7 } })`.

Here is exactly what happens on one `pickMove(ctx)` call. (`ctx = { view, seat,
random }`.)

### 5.1 Setup (once per game, `pickSetup`)

1. `smartValidSetup(seat, seed)` — flag in a random HQ, mines in back rows
   clustered near the flag, 排长/连长 sacrificed in the non-flag HQ, heavyweights
   (司令/军长/师长) in interior rows 3–5, bombs in rows 3–4.
2. `biasBombTowardFlag(seat, layout)` — nudge one bomb into the flag's column so
   an attacker breaking toward the flag is likelier to hit it.

### 5.2 Move selection (every turn, `runMonteCarlo`)

```
opts = {
  samples: 44, depth: 4,
  racing: RACING_MC,                    // screen 6 samples, keep top 25% (≥8)
  replyMin: { k: 3, blend: 0.7 },       // exact opponent ply on survivors
  spatial: V4_SPATIAL,                  // graph dist + clock + trade + camp
  playoutPolicy: { greedyEps: 0.7 },    // capture-first low-noise playouts
  rootBias: partnerCoord(graph) + engineerBias + observedLosingAttackPenalty,
}
```

Step by step:

1. **Candidate moves** — `legalMovesForBot(view, seat)`.
2. **Beliefs** — `computeBeliefs(view, seat)` once.
3. **Per-move biases** — strong-piece bonus + the three `rootBias` terms,
   computed once (constant across samples).
4. **Sample loop** (44 iterations):
   1. `sampleConcreteWorld` → a concrete world (retry ≤4 on infeasible).
   2. **First 6 samples** (the screen): evaluate every still-active move with a
      plain rollout (reply-min is OFF during the screen for cost).
   3. **Racing cut at sample 6**: rank by `mean + bias`, keep top 25% (≥8),
      deactivate the rest.
   4. **Samples 7–44**: only survivors, now **with reply-min** — apply root move,
      enumerate opponent top-3 replies (`fastTopKMoves`), roll each out at
      `depth−2`, score `0.7·worst + 0.3·mean`.
   5. Each rollout: `playOutFromSampled(…, depth, rng, undefined, {greedyEps:0.7})`
      then `evaluateRollout(terminal, seat, V4_SPATIAL)`.
5. **Pick** — argmax of `mean + bias` over surviving moves. (If zero samples
   succeeded, fall back to `v2_1.pickMove`.)

Cost: ~310 ms/move (vs v3.1's ~368 ms) — v4's depth-4 search is cheaper per
rollout, which is what funds S=44 + reply-min.

---

## 6. How to run experiments (the methodology)

**This section is the most important for "ameliorating bot performance."** Bots
are improved by measuring, not by intuition.

### 6.1 The command

```sh
pnpm -C shared bot-eval-par -- \
  --teamA v4.2-greedy --teamB v3.1-spatial \
  --games 24 --seed 9000 --mode 2v2 --workers 8
```

- `teamA`/`teamB` are `name` fields from the registry (`botByName`). Team A =
  N+S, Team B = E+W.
- `--games N` plays N games at seeds `seed … seed+N-1`. Games are
  seed-deterministic and independent, so `bot-eval-par` shards them across
  `--workers` processes and aggregates — **same seeds give identical results.**
- Output: per-team win counts, draws, avg game length, avg pieces remaining,
  end-reason breakdown.

### 6.2 Always measure BOTH orientations

Team A (N+S) moves first in the N→E→S→W rotation, which is a real edge. A bot
that looks great as team A may be average as team B. **Run it both ways** (swap
`teamA`/`teamB`, use a different `--seed` block) and report the *net* (average).
Single-orientation numbers are misleading.

### 6.3 Statistical reality (read this or you will fool yourself)

- A 48-game eval has a **±13-point** confidence interval. A 24-game half is
  worse.
- The greedy v4 family all sits in a **62–88% band**; single-batch "wins" (e.g.
  the original 85.4% for v4-greedy) **did not replicate**.
- **Only quote ≥96-game pooled numbers as real** in an acceptance decision.
  v4.2's headline 80.2% is 96 pooled games (72.9% + 87.5% halves).
- When two configs are within ~10 points at N=48, you cannot distinguish them.
  Either run more games or treat them as tied and prefer the simpler/cheaper one.

### 6.4 Compute parity

When comparing configs, equalize *wall-clock per move*, not sample count. v4's
d4 search is ~½ of v3.1's d9 cost, so v4 can run S=44 at the same budget v3.1
spends on S=20. Use `pnpm -C shared bot-bench` to check per-move latency before
declaring a config "free".

### 6.5 The config-ladder pattern

To test an idea cheaply: add a `makeV4Bot('v4-myidea', { …override… })` entry to
the `v4Variants` array in `index.ts` (these are experiment-only, not
`LATEST_BOT`), then eval it vs `v4.2-greedy`. Keep the winner, delete the rest or
leave them as documented dead-ends. The current `index.ts` `v4Variants` list is a
museum of ~25 such experiments — read their inline comments before re-trying
something.

### 6.6 Loss forensics (the data-driven path)

When you can't find a lever by intuition, run
`tsx shared/scripts/bot-loss-analysis.ts` on a seed block of losses. It prints
*where* games were lost. The two findings so far (BOT.md §P4):
- (a) Our flag falls 2–10 turns after our marshal dies and reveals it (defense
  doesn't escalate on reveal). **Empirically closed for the spatial-weight
  approach**: the naive ×3 urgency fix (`v4-flagurgent`) regressed to 62.5%, and
  the softer defense-only ×2 retry (`v4.3-defurgent`) also failed (~44% net,
  didn't replicate). A different mechanism (not a static-eval multiplier) would
  be needed to revisit this.
- (b) 4/6 losses were already 300–400 material **down by turn 50** — *opening
  bleed*. **This is the single most promising unsolved target.**

---

## 7. Recipe: add a new bot version

### 7.1 A config variant of v4 (most common)

1. In `index.ts`, add to `v4Variants`:
   `makeV4Bot('v4-myidea', { …overrides… }, 'what it does')`.
2. Eval it (§6) vs `v4.2-greedy`, both orientations, ≥48 games.
3. If it wins net ≥ ~55% and replicates on a second seed block, promote it:
   give it a stable export in `v4.ts`, add it to the **end** of the `BOTS` array
   in `index.ts` so `LATEST_BOT` points at it, and update BOT.md §P4 + this
   guide's lineage table.

### 7.2 A new evaluation term

1. Add a field to `SpatialWeights` in `evaluate.ts`, implement it inside
   `evaluateRollout` (guarded so it's off unless the weight is set).
2. Add it to `V4_SPATIAL` (or a new `V5_SPATIAL`) and to a `makeV4Bot` variant.
3. **Magnitude matters**: spatial terms are `weight × 1/(1+distance)`, so a
   weight of 350 contributes ~tens of points; material is `Δ/10` (~hundreds).
   Keep new terms from dominating material unless that's the intent.

### 7.3 A new playout-policy term

1. Add a field to `PlayoutPolicy` in `rollout.ts`, implement it in `scoreMoves`.
2. Remember greedy playouts **argmax**, so a new quiet-move term only matters if
   it changes the argmax — give it enough weight to matter but not so much it
   makes playouts deterministic/blind.

### 7.4 A new belief signal

Edit `computeBeliefs` in `belief.ts`. Add a unit test in `belief.test.ts`
asserting the inference (e.g. "after combat X, piece Y has minRank ≥ Z"). Beliefs
feed the sampler, the root biases, and info-value — a wrong belief poisons all
three.

### 7.5 Always

- Keep RNG seeded (`seededRng`, `botRng`) — never `Math.random` in bot code, or
  the eval harness becomes non-deterministic.
- Run `pnpm -C shared test` and `typecheck`.
- Freeze the previous champion (don't edit it).

---

## 8. Hard-won lessons (what worked, what failed, why)

These are the expensive findings. **Do not re-litigate without new evidence.**

### 8.1 What WORKED

1. **Reduce playout noise > add search features.** The single biggest gain
   (+12.5 pts) was **greedy-ε playouts (B7)** — making rollouts argmax 70% of
   plies instead of weighted-random. The depth experiment had pointed straight
   at this: playout noise, not depth, was the bottleneck.
2. **Capture-first argmax.** Greedy argmax must take winning captures (attack
   weight > 4) before quiet moves — attack and quiet weights are on different
   scales, so a naive argmax shuffles heavyweights past free material. This fix
   alone took a greedy variant from middling to 80.2%.
3. **Samples at compute parity** (S=24→44 at d4) — worth ~+4. Returns flatten
   past ~44; S=60 and S=88 were *not* better.
4. **Short rollouts + exact opponent ply.** Depth 4 (not 6/9/12) + reply-min
   (B4) beat deep noisy rollouts. Reply-min is worth ~+11 (ablation `v4-noreply`).
5. **Eval-term stacking** (D5 clock + I2 trade + D6 camp + C1 roster + D7
   graph distances) — worth ~+11 combined (ablation `v4-lite-eval`).

### 8.2 What FAILED (and the structural reason)

1. **UCB root bandit (B1) — 18.8%. REJECTED.** It evaluates different moves on
   *different* sampled worlds, destroying the paired-comparison property that
   uniform/racing sampling gets for free. Move ranking then chases world-luck.
2. **Full ISMCTS (v5) — 22.9%. REJECTED.** Same disease one level deeper: a
   shared tree aliases nodes across determinizations, and combat against an
   *unknown* piece leads to incomparable states across worlds, so shared node
   stats mix worlds exactly like the bandit did. **Lesson: in fog combat where a
   move's outcome swings on the sampled defender identity, any statistic shared
   across worlds below the root is poison. Paired-world flat MC with exact
   near-root enumeration is structurally superior here.**
3. **Info-value / bomb-baiting (H1) — −6 pts in self-play.** It's correct play
   vs *humans*, but v3-mc/v3.1 don't punish info-ignorance, so probes just spend
   material in the eval. Kept in `v4.1` for human play, **off the strength line.**
4. **Too much pessimism** (reply-min k=4 / blend 0.85) and **too much greed**
   (ε=0.85) both *hurt* — diversity matters.
5. **Depth still doesn't pay even with low-noise playouts** (`v4-greedy-d6`,
   70.8%). Shallow + exact reply remains best.
6. **Stacking ≠ adding.** greedy+avoidHanging+CRN combined (62.5%) was worse
   than greedy alone. Re-measure every combination; gains are not additive.
7. **Reveal-urgency defense (loss-pattern a) — both strengths failed.** ×3
   symmetric (`v4-flagurgent`, 62.5%) over-weighted the race at material's
   expense; the softer defense-only ×2 (`v4.3-defurgent`, ~44% net) didn't
   replicate either. A static-eval multiplier is the wrong tool for "defend the
   just-revealed flag"; pattern (a) is closed pending a different mechanism.
8. **More compute doesn't break the ceiling.** S=88 at 2× budget = 77.1%. The
   residual ~20% loss rate is largely world/setup variance under near-mirror
   play, **not** search error — which is why the next gain must come from
   *decision quality* (loss forensics), not more samples.

### 8.3 The standing conclusion

> Flat-MC knob space is **exhausted** at ~80% vs v3.1. The two sanctioned ways
> forward are (a) **loss-forensics-driven fixes** (the opening-bleed pattern is
> the prime target), and (b) a *correctly-shared* tree search — but ISMCTS as
> tried does not qualify, so that path needs a different determinization-aliasing
> remedy before it's worth re-attempting.

---

## 9. The forward roadmap (what to try next)

In priority order. Each item says where it plugs in and its acceptance bar.
Cross-references are to IDEAS.md sections.

### 9.1 Tier 1 — most promising (decision quality, not compute)

1. **Solve opening bleed (loss-forensics pattern b).**
   - *Where*: setup (`smartValidSetup` / `biasBombTowardFlag` / E1 layout
     curation in `makeV4BotWithLayout`) and/or early-game eval.
   - *Why*: 4/6 analyzed losses were 300–400 material down by turn 50. This is
     the biggest unexplained gap and pure compute doesn't touch it.
   - *Approach*: run `bot-loss-analysis.ts` on a larger loss corpus; classify the
     opening mistakes (bad trades? mis-defended flag lane? engineer mismanaged?);
     target the dominant class.
   - *Accept*: ≥96 pooled games, net ≥ 55% vs v4.2, replicated.

2. **Imperative flag defense (IDEAS.md D8).** User-requested (2026-07-14): when
   an enemy piece gets within a couple of moves of our flag — or has a clear
   defender-free path to it — the bot must commit to capturing or body-blocking
   it, *no matter the material cost elsewhere*.
   - *Where*: a **threat-gated** `flagSafety` escalation in `evaluate.ts` (near-
     terminal magnitude, ~hundreds, only while a live threat exists) + a new
     `rootBias` in `v4.ts` that prefers capturing/blocking the threat. Reuse
     `likelyFlagCell(view, mySeat)` + `moveDistance` (D7) for detection.
   - *Why*: losing the flag = losing the game, so its utility is genuinely
     discontinuous. Today it's a soft weight the material delta can outweigh —
     the bot trades elsewhere while an attacker walks in. Directly targets
     loss-pattern (a).
   - *Critical distinction*: the earlier `revealedFlagUrgency`/
     `revealedDefenseUrgency` multipliers regressed **because they were
     always-on** and distorted offense. D8 must be **conditional on a detected
     threat** — that's the whole point.
   - *Accept*: ≥96 pooled games, net ≥ 55% vs v4.2, both orientations, replicated.

3. **Imperative flag assault (IDEAS.md D10).** User-requested (2026-07-14): if an
   opponent's flag is open, charge it — or at minimum stage moves toward it. The
   offensive mirror of D8, with two parts:
   - *Charge*: when a flag is revealed (`view.flagRevealed`) or its
     `likelyFlagCell` has a defender-free approach, treat capturing it as
     near-terminal preference — again **opportunity-gated**, not a global
     flag-advance weight increase.
   - *Stage* — **this is a structural gap, not a weight.** v4.2 searches
     `depth: 4`, so a 6-ply march to the flag has *no* payoff inside the horizon
     and every step scores as a neutral quiet move. `flagAdvance` at
     `350 × 1/(1+d)` is worth only ~50 at d=6 — outbid by any small trade. **The
     bot cannot currently plan a multi-turn assault**; it only lunges when the
     flag is already near. Fixes, cheapest first: a convex distance curve (pay
     for long-range progress); a **persistent assault commitment** (designated
     attacker + target flag cached across turns, root-biased along the
     `moveDistance` path); a *targeted* rollout advance bias (the untargeted
     `advanceBias` already failed at 64.6% — retry only the targeted form);
     selective depth extension for assault lines.
   - *Reuse*: `partnerCoordinationBiasGraph` already assigns each partner a
     different opposing flag — take the target from there, don't invent a second
     assignment. Pair with D4 (flag-lane blockage) so we don't march a lone piece
     into a mined lane with no engineer.
   - *Accept*: ≥96 pooled games, net ≥ 55% vs v4.2, both orientations, replicated.

4. **E1 setup curation.** `makeV4BotWithLayout` + the 24 `layoutCandidates` in
   `index.ts` already ladder fixed openings against the SOTA. Run that ladder; if
   a layout seed beats v4.2's random-opening meta, bake it into a curated opening
   book.

5. **Stronger strong-piece bias (IDEAS.md D9).** User-requested (2026-07-14):
   play stronger pieces more. Knobs: raise `STRONG_MOVE_BIAS` (1.3 → 1.5–2.0 in
   `values.ts`; note it was *lowered* 1.5→1.3 in v3.1 to curb over-commitment)
   and/or add a `PlayoutPolicy.strongBias` so rollouts also favor advancing
   heavies. **Caveat**: moving 司令/军长 early reveals and exposes them, so this
   may cost self-play strength even while matching the desired style — sweep it,
   and if it regresses, ship behind the difficulty/"aggressive" flag (Tier 2),
   not as the champion. Trivial to implement, **must be measured** before shipping.

### 9.2 Tier 2 — vs-human value (off the self-play strength line)

These make the bot better against *people* even though self-play eval can't
score them. Ship them behind a difficulty/"human-style" flag, not as the
strength champion.

3. **F2 reveal exploitation** — when our combat reveals an opponent piece, press
   it. Cheap, big vs humans. (IDEAS.md F2.)
4. **H4 cycle detection** — avoid > 2-move repetition loops vs a stalling human.
5. **Promote v4.1's info-value (H1)** as the "plays-like-a-human" bot for the
   difficulty selector (G5) — it bomb-baits and probes.

### 9.3 Tier 3 — infrastructure / only if Tier 1 stalls

6. **G5 difficulty selector in the lobby** — zero bot work, best UX return for
   the actual audience (dad + friends). Expose `v2_1` (easy), `v3.1` (medium),
   `v4.2` (hard).
7. **K3 decision-snapshot tests** — pin a few `(view → chosen move)` fixtures so
   perf refactors can't silently change decisions. Guard rail before any engine
   speed surgery.
8. **A "correctly-shared" tree search** — the only sanctioned escalation beyond
   flat MC, but **only** with a fix for determinization aliasing (e.g.
   world-stratified node statistics, or restricting shared nodes to pre-combat
   positions). Until that design exists, ISMCTS stays rejected (§8.2).

### 9.4 Explicitly parked (don't do without new reason)

Neural nets (user: no ML), allied-visible 2v2 (user: won't happen), hard
static-score root pruning (kills the clearance moves MC exists for), mutable
engine rewrite (perf isn't the bottleneck; decision quality is). See IDEAS.md
"Parked / rejected".

---

## 10. Invariants & pitfalls (things that will bite you)

1. **Fog is sacred.** `pickMove` must only read `ctx.view` (a `PlayerView`),
   never a `GameState`. The only place full kinds are legitimate is *inside* a
   sampled world during a rollout. If you ever pass `GameState` into a bot's
   move decision, you've made a cheating bot and every eval number is invalid.
2. **Frozen baselines.** v0–v3.1 (and v4, v4.1, v4.2) are measurement anchors.
   Don't change a shipped bot's behavior — make a new variant. Changing a
   baseline silently invalidates every historical number in BOT.md.
3. **Determinism.** All bot randomness goes through `seededRng`/`botRng`. A stray
   `Math.random` makes evals non-reproducible and breaks `bot-eval-par`'s
   seed-sharding guarantee.
4. **`LATEST_BOT` = last in `BOTS`.** Experiment variants live in the middle of
   the array; the shipped champion must be last. The server uses `LATEST_BOT` for
   `normal`/`slow` and `v2_1` for `fast`/`instant`.
5. **`applyMoveForRollout` vs `applyMove`.** Rollouts use the fast, unchecked
   `applyMoveForRollout` (no history/knowledge bookkeeping). Only use it where the
   move is already known-legal (it came from `legalMovesForTurn`/`fastTopKMoves`).
   Real game application uses `applyMove`.
6. **Never prune root moves by static score.** MC exists to find low-static-value
   setup/clearance moves (move a piece out of the way so the engineer can pass
   next turn). Top-K static filtering deletes exactly those. (Hard
   `pruneRootMove` is only for provably-dominated moves like attacking a
   *known* stronger piece.)
7. **Statistics over swagger.** Re-read §6.3 before claiming a win. The graveyard
   of variants in `index.ts` exists because single-batch results lie.
8. **Spatial/material magnitudes.** Material is `Δ/10` (hundreds); spatial terms
   are `weight × 1/(1+dist)` (tens at weight ~350). A new term that accidentally
   rivals material will warp play — check the scale.
9. **Two opponents, modeled asymmetrically.** Turn order N→E→S→W means plain
   reply-min only models the *next* opponent; the other moves after your partner.
   `replyMin.k2` models the second one but costs ×(1+k2). Know which refutations
   your config can and can't see.

---

*Last updated: 2026-07-14. Champion: `v4.2-greedy` (`LATEST_BOT`), 80.2% vs
v3.1-spatial over 96 games. Always-on reveal-urgency closed as a dead end
(`v4.3-defurgent` failed). Next targets (§9.1): opening-bleed loss pattern,
threat-gated imperative flag defense (D8), opportunity-gated flag assault +
multi-turn staging (D10), and stronger strong-piece bias (D9) — the last
three are user-requested (2026-07-14). D8/D10 are a matched pair: make
flag loss and flag capture behave as the near-terminal events they are,
gated on a detected threat/opportunity rather than always-on weights.*
