# Ideas — bot & engine improvement brainstorm

> Orientation lives in [`BOT_DEV_GUIDE.md`](BOT_DEV_GUIDE.md) (architecture,
> how-to-experiment, lessons, roadmap). This file is the raw idea backlog +
> deep-dive designs + the parked/rejected list it draws from.

Living document. Each idea has a rough **impact / effort / risk** guess and
enough detail to implement cold. Shipped ideas move to BOT.md's change history.

Related docs: [BOT.md](BOT.md) (design + results), [TODO.md](TODO.md) (backlog).

---

> **2026-06-11 depth experiment**: deeper rollouts turned out to be WORSE,
> not better (d3 beats d9 68.8%, d12 loses 31.3% — see BOT.md). The A-row's
> framing of "performance enables depth" is therefore obsolete: performance
> now enables **more samples and exact near-root plies** instead. Kept for
> reference; the wins here still buy compute, just spent differently.

## A. Search performance (~~enables depth~~ → enables samples + reply-min)

### A1. Rollout fast path — SHIPPED (task #52)
`applyMoveForRollout` skips legality re-validation, `knownToPlayers` copies,
and the per-ply `moveHistory` array spread. ~9% alone.

### A2. Racing / successive halving — SHIPPED (task #52)
Screen every root move with 6 samples, keep the top 25% (min 8) for the
remaining 14. Pays for depth 6 → 9 at *lower* wall time (481→372 ms avg,
754→417 ms worst case). Key correctness detail: the racing cut ranks by
`mean + rootBias` so a bias-rescued move (engineer probe, partner coord)
can't be pruned by raw material mean alone.

### A3. Multi-stage racing (3+ stages)
Generalize A2: e.g. 4 samples → keep 50% → 4 more → keep 25% → rest.
More aggressive early pruning frees budget for depth 12+ on the last 4–6
contenders. Impact: medium. Effort: low (the `active[]` scaffold exists).
Risk: pruning a sleeper move whose value only shows at depth; mitigate by
keeping `keepAtLeast` ≥ 6.

### A4. Time-budgeted search instead of fixed samples
`pickMove` accepts a `budgetMs`; loop samples until the budget is spent.
Slow machines degrade gracefully, fast machines search more. The server
already knows `botSpeed` — map it to budget (slow=900ms, normal=350ms).
Impact: medium (consistent UX). Effort: low. Risk: nondeterminism in tests —
keep the fixed-sample mode for eval/bench, budget mode only live.

### A5. Per-ply legal-move generation is the hot loop — micro-optimize
Profiling shows the remaining cost is `legalMovesForTurn` per rollout ply
(~25 pieces × road/rail expansion, Sets/arrays allocated per piece).
Options, in increasing invasiveness:
  - Reuse one scratch `Set`/array across calls (module-level, cleared).
  - Generate moves lazily per piece and stop early once the rollout policy
    has enough candidates (risky: changes policy distribution).
  - Precompute static per-cell road-neighbor arrays (already in BOARD) and
    avoid the closure-based MoveContext in favor of direct state lookups.
Impact: medium (maybe 30–40% of ply cost). Effort: medium. Risk: low if
behavior-identical; verify with the seeded bench + tests.

### A6. Incremental rollout state (mutate + undo)
Replace per-ply `{...pieces}` spreads with a single mutable simulation state
per (sample, root-move) and an undo stack — or just mutate freely since each
rollout owns its copy after the root clone. The spread costs are O(pieces)
per ply; mutation is O(1). Impact: medium. Effort: medium-high (parallel
mutable engine must mirror combat/elimination semantics — duplication risk).
Only do this if A5 + A3 don't reach the depth target.

### A7. Web Worker / worker_threads for live play
Run `pickMove` off the main server event loop so a 400 ms search never
stalls socket handling with 4 concurrent bots. Impact: UX-only. Effort:
medium (serialize view across the boundary). Risk: low.

---

## B. Search quality (better decisions at same budget)

### B1. UCB1 sampling at the root (bandit instead of uniform)
Instead of racing's hard cut, allocate each next rollout to the move with
max `mean + c·sqrt(ln N / n)`. Smoothly concentrates on contenders and
never fully abandons a move. This is the canonical fix for racing's
sleeper-pruning risk. Impact: medium-high. Effort: low-medium (drop-in
replacement for the sample loop). Risk: needs tuning of `c` against utility
scale (~material/10 units).

### B2. Paired samples / common random numbers
When comparing moves, evaluate all moves on the SAME sampled world with the
SAME rollout seeds (already true per-sample) — variance of the *difference*
is what matters. Already mostly true; formalize by reusing one rollout seed
stream per sample index so move comparisons are paired. Cheap variance
reduction. Impact: small-medium. Effort: trivial audit.

### B3. Depth-adaptive rollouts
End rollouts early when the position is quiet (no captures in last K plies)
and apply the static eval — most plies in quiet positions are noise. Spend
the saved plies extending rollouts that are mid-combat ("quiescence" idea
from chess). Impact: medium. Effort: medium. Risk: defining "quiet" cheaply.

### B4. Opponent-reply minimization at ply 1
The single biggest blind spot of mean-rollout MC: it averages over opponent
replies instead of assuming the opponent picks their BEST reply. For the
first opponent ply only, take min over their top-K replies (K=3 by fast
policy score), then continue with rollouts. Catches "my move walks into an
obvious refutation" without full minimax cost. Impact: HIGH. Effort: medium.
Risk: triples ply-1 cost; racing absorbs it.

### B5. Reuse search between consecutive turns
The opponent's actual move usually matches one of our simulated branches.
Carry the previous turn's per-move statistics as priors for the new root
(decayed by 0.5). Impact: medium. Effort: medium (cache keyed by moveCount).
Risk: stale beliefs after surprising reveals; decay handles it.

---

## C. Belief modeling

### C1. Roster-count-aware estimateRank
`estimateRank` uses fixed priors; it should condition on what's LEFT in the
opponent's roster (subtract known dead + revealed). E.g. if both enemy
工兵 are confirmed dead, `mineConfidence` cells can never be cleared by
them — and unknown movers skew stronger if all 排长 are dead. The sampler
already does this bookkeeping; extract its pool computation and share.
Impact: medium. Effort: low-medium. Risk: low.

### C2. Trajectory-based mobility inference
A piece that has slid ≥3 cells on rail at once is mobile (already excluded
from mine/flag) — but ALSO unlikely to be a bomb in human play (bombs are
usually held back). Add a soft `bombUnlikely` flag from long-slide history
feeding the sampler's position priors. Impact: small-medium vs bots, larger
vs humans. Effort: low.

### C3. First-mover heat maps as priors
Humans deploy 司令/军长 along predictable lanes early. Track per-cell move
frequency from the move history and bias `estimateRank` upward for pieces
that advanced early and aggressively. Pure heuristic, no ML — just a counter
per piece of "plies before first move". Impact: medium vs humans. Effort: low.

### C4. Bayesian piece-type vector (the deferred "full" belief)
Replace min/max rank bounds with a proper 12-dim probability vector per
piece, updated multiplicatively on each observation and renormalized against
roster counts (iterative proportional fitting, no linear solve needed).
The sampler then draws from exact marginals. This was deliberately deferred;
revisit once heuristic ceilings are hit. Impact: high. Effort: high.

---

## D. Evaluation function

### D1. Mobility term
Count legal moves per side in the terminal rollout state (cheap: reuse the
last ply's generation). Cornered/blocked positions are bad even at equal
material. Impact: medium. Effort: low.

### D2. Engineer-mine tension term
Reward (my alive engineers × unknown enemy back-row cells) — engineers gain
value while clearable mines remain; penalize losing the last engineer while
mines block the flag lane. Complements the static engineer value. Effort: low.

### D3. Rail control term
Reward pieces sitting on rail cells (especially the central 8) — rail
mobility is tempo. Small weight to avoid overvaluing exposure. Effort: low.

### D4. Flag-lane blockage awareness
If the likely enemy flag is behind unknown back-row pieces (probable mines)
and we have 0 engineers, devalue the advance reward toward that flag — we
literally cannot break in; redirect pressure to the other opponent.
Impact: medium. Effort: low-medium.

---

### D5. Stalemate-clock awareness (currently ignored!)
`movesSinceCapture` / the 70-move draw is a strategic resource the bot
doesn't model at all. Add to evaluation: when AHEAD on material, penalize
high counter values (a draw robs us of a won game → manufacture captures);
when BEHIND or down a player (see I3), reward running the clock (a draw is
a save). Sign flips on the material delta; weight ramps as counter > 40.
Effort: trivial. Impact: medium — directly converts more won positions.

### D6. Camp (行营) safety utilization
Camps are attack-proof cells and the evaluation doesn't know it. Terms:
(a) small bonus for own high-value piece sitting in a camp while enemies
are within striking range (refuge), (b) penalty when an ENEMY camps next
to our flag lane (entrenched attacker we can't dislodge). Effort: low.

### D7. True graph distances instead of Manhattan
`evaluateRollout` and the flag-advance/partner-coord biases all use
Manhattan distance — which cuts through the cross's empty corners and
ignores rail topology entirely. The board is STATIC: precompute the
129×129 all-pairs shortest-path table once at module load (BFS from each
cell over road+rail edges, ignoring occupancy = admissible lower bound;
~17k entries). Then every distance lookup is O(1) and actually means
"moves to get there". Also fixes the engineer-vs-mine dispatch distances.
Effort: low-medium. Impact: medium — all spatial terms get more honest.

### D8. Imperative flag defense (hard override, not a soft weight) — HIGH PRIORITY
User note (2026-07-14): *"when opposing pieces get close to your flag, you
should no matter what try to defeat them (or if you see a clear path to your
defeat)."* Today own-flag safety is only a soft `flagSafety` term in
`evaluateRollout` that the material delta can outweigh — so the bot will
sometimes take a good-looking trade elsewhere while an attacker walks the last
two cells into our flag. This is likely a contributor to loss-pattern (a)
(flag falls shortly after the marshal reveals it) AND loss-pattern (b).

Design — treat imminent flag loss as near-terminal, not as a tunable:
  - **Threat detection** (in belief/eval space, fog-respecting): an enemy piece
    is a *flag threat* if it is within `T` moves (`moveDistance`, D7) of our
    likely flag cell (`likelyFlagCell(view, mySeat)` / `flagHypothesisFor`) AND
    no known-stronger defender of ours sits on the only approach path. Start
    `T = 2`; a "clear path to defeat" = an unobstructed rail/road run to the
    flag with no defender that beats the attacker's *estimated* rank.
  - **Response**, in order of preference: (1) a `rootBias`/hard-preference for
    any move that captures the threat with a piece that beats its estimated
    rank; (2) failing that, a body-block move onto the single approach cell;
    (3) escalate `flagSafety` to a **near-terminal magnitude** (comparable to
    `MARSHAL_ALIVE_BONUS`, i.e. hundreds, so it dominates ordinary material
    trades) only while a live threat exists — a *conditional* multiplier, which
    is why the earlier blanket `revealedFlagUrgency`/`revealedDefenseUrgency`
    multipliers failed (they were always-on, not threat-gated).
  - **Why an override, not a weight**: losing the flag is losing the game, so
    the correct utility really is discontinuous. The reason the ×2/×3 urgency
    experiments regressed is they raised the weight *everywhere*, distorting
    offense; gating on an actual detected threat avoids that.
Where: `evaluate.ts` (threat-conditional `flagSafety`), a new `rootBias` term
in `v4.ts` (capture/block the threat), reusing `likelyFlagCell` + `moveDistance`.
Cross-refs: subsumes/strengthens I1 (partner-emergency defense) for our own
flag; directly targets loss-pattern (a). Impact: HIGH. Effort: medium.
Risk: false-positive threats making the bot turtle — tune `T` and require the
path actually be defender-free. **Measure vs v4.2, both orientations, ≥96 games.**

### D9. Stronger strong-piece move bias
User note (2026-07-14): *"add some bias so that stronger pieces are played
more."* Today `strongMoveBonus(kind) = rank × STRONG_MOVE_BIAS` with
`STRONG_MOVE_BIAS = 1.3` (`values.ts`) — it was actually *lowered* 1.5→1.3 in
v3.1 (#51) to stop the bot over-committing heavies. The user now wants the
opposite lean. Two independent knobs to sweep:
  - **Root-move bias** (which piece to move this turn): raise `STRONG_MOVE_BIAS`
    back toward 1.5–2.0. Applies in `runMonteCarlo`'s per-move `biases`.
  - **Playout policy** (which piece the fast rollout policy moves): the quiet-move
    weight is `1 + strongMoveBonus`; a `PlayoutPolicy.strongBias` multiplier
    would make rollouts also favor advancing heavies, which propagates through
    the eval rather than only breaking root ties.
Caution: this trades against information hygiene — moving 司令/军长 early reveals
and exposes them (exactly why it was lowered before). So it may *cost* self-play
strength even if it matches the desired play style; treat like H1/info-value —
sweep it, and if it regresses in eval, ship it behind the difficulty/"aggressive"
flag rather than as the strength champion. Effort: trivial (one constant + one
optional policy field). Impact: uncertain — **must measure**, don't just set it.

### D10. Imperative flag assault — charge an open flag, or stage toward it — HIGH PRIORITY
User note (2026-07-14): *"if opponent flag is open, you should charge it or at
least prepare moves to move towards it."* The offensive mirror of D8. Two
distinct failures to fix, and the second is the harder one:

  1. **Charge (the flag is reachable now).** When an enemy flag is *open* —
     revealed (`view.flagRevealed[seat]`, which flips when their marshal dies)
     or its `likelyFlagCell` has a defender-free approach — any move that
     captures it wins that opponent outright. This should be a near-terminal
     preference, not something the material eval can trade away. Symmetric with
     D8: gate on a detected *opportunity* rather than raising flag-advance
     weight globally (the always-on `revealedFlagUrgency` multiplier already
     failed, see BOT.md §P4).

  2. **Stage / prepare (the flag is 5+ moves away) — the horizon problem.**
     This is the real gap and it is **structural, not a weight**. v4.2 searches
     `depth: 4`. A march that needs 6 plies to reach the flag produces *zero*
     material or terminal payoff inside the horizon, so every step of it scores
     as a neutral quiet move and the bot never commits to starting one. The
     `flagAdvance` spatial term (`350 × 1/(1+d)`) is the only thing rewarding
     progress, and at `d = 6` it's worth ~50 — routinely outbid by any small
     trade elsewhere. **The bot is structurally incapable of planning a
     multi-turn assault**; it only lunges when the flag is already close.

     Candidate remedies, cheapest first:
     - **Convex distance reward.** Replace `1/(1+d)` with a curve that pays more
       for each step of progress at long range (e.g. `(maxD − d)²` normalized),
       so closing 6→5 is worth about as much as 2→1. Cheapest fix; test first.
     - **Persistent assault commitment (root bias with memory).** Choose a
       target flag + designated attacker, persist that choice across turns
       (keyed by `moveCount` in a small per-seat cache, like B5's search reuse),
       and root-bias moves that advance the designated attacker along the
       precomputed `moveDistance` path. Gives multi-turn coherence the depth-4
       search cannot represent. Needs care: must abandon the plan when the
       attacker dies or a better target appears, or the bot tunnel-visions.
     - **Goal-conditioned rollout policy.** `PlayoutPolicy.advanceBias` already
       exists but measured *worse* (`v4-greedy-adv`, 64.6%) — because it pushed
       *everything* forward indiscriminately. A targeted version (bias only the
       designated attacker toward the designated flag) is the version worth
       retrying.
     - **Deeper search only for assault lines** — selective extension when a
       rollout is already advancing on a flag. Most expensive; try last.

Where: `evaluate.ts` (opportunity-gated flag offense + the distance curve),
`v4.ts` (assault `rootBias`, target selection reusing `likelyFlagCell` /
`flagHypothesisFor` / `moveDistance`), optionally `rollout.ts` (targeted
advance bias). Interacts with the existing `partnerCoordinationBiasGraph`,
which already assigns each partner a different opposing flag — reuse that
target assignment rather than inventing a second one.
Impact: HIGH (converts won positions the bot currently lets drift to the
70-move draw; note D5 clock awareness makes drawn-but-winning positions
*visible* to the eval but gives the bot no *plan* to convert them).
Effort: medium. Risk: over-committing a lone attacker into a mine/bomb wall —
pair with the flag-lane blockage check (D4) so we don't march into a
mined lane with no engineer. **Measure vs v4.2, both orientations, ≥96 games.**

## B-extra. Rollout policy robustness

### B6. Policy mixing in rollouts
All four simulated seats use the same deterministic-ish fast policy, so
rollout outcomes are correlated and can systematically misjudge lines the
policy itself misplays. Alternate between two policies across samples
(greedy EV vs softmax-temperature EV) so move evaluations average over a
*distribution* of opponent styles. Effort: low (policy already takes rng).

### B7. Greedy-ε playouts — SHIPPED (2026-06-12), THE breakthrough lever
The weighted-random draw in `fastPickMove` was the dominant noise source the
depth experiment pointed at. Playing the argmax-weight move with prob ε=0.7
(weighted draw otherwise) took v4 from 72.9% → **85.4%** vs v3.1 at the same
budget — more than every other v4 feature combined. Opt-in via
`PlayoutPolicy.greedyEps` so frozen baselines are untouched.

### B8. Don't-hang-pieces playout term — SHIPPED with B7
`PlayoutPolicy.avoidHanging`: quiet moves onto squares road-adjacent to a
stronger enemy (or bomb) get ×0.2 weight (camps exempt — attack-proof).
Fixes SYSTEMATIC playout error (hung pieces), not just variance.

## E. Setup strategy

### E1. Setup diversity via eval-tested layout pool
Generate 50 random smart layouts offline, run each against the standard
pool via bot-eval, keep the top 10 as a curated opening book the bot picks
from randomly. No ML, just offline selection. Impact: medium. Effort: low
(script + JSON). Risk: overfits to bot-vs-bot meta.

### E2. Anti-bait flag placement
Mirror-aware: place the flag on the side AWAY from the opponent's likely
first rail probes (col 1/5 lanes), with the 排长/连长 sacrifice in the more
exposed HQ. Currently flag HQ choice is a coin flip. Effort: low.

### E3. Layered defense scoring for setups
Score a candidate layout by simulating 20 random enemy probe sequences and
counting expected material loss in the first 10 plies; pick the best of N
random layouts at setup time ("setup-time MC"). Impact: medium-high.
Effort: medium. Risk: setup time grows (~seconds); acceptable once per game.

---

## F. Opponent modeling (vs humans)

### F1. Aggression profile
Track opponent's attack rate (attacks per move). Aggressive humans get
baited (leave a guarded mid-rank as cheese); passive ones get pressured.
Single scalar, adjusts attackShare and advance weights. Effort: low.

### F2. Reveal exploitation
When a human reveals an engineer (corner-turn), immediately re-weight their
OTHER unmoved back pieces toward mine/bomb (roster conditioning, C1) and
dispatch our nearest mid-rank to hunt the revealed engineer (engineers die
to everything). Effort: low, big practical payoff.

---

## G. Tooling / infrastructure

### G1. Eval harness parallelism — SHIPPED (task #53)
`bot-eval-par` shards seed ranges across child `tsx` processes (`--workers`,
default cpus−1) and aggregates `--json` shard outputs. 16 cheap-bot games in
2 s; 8 MC-vs-MC games/min. Made the depth-scaling experiment (112 games)
and the v4 acceptance runs routine. First use immediately exposed how noisy
our historical N=6 results were (v2.1 lost a 16-game batch to v2 at 37.5%).

### G2. Elo ladder script
Round-robin all registry bots × both orientations × N seeds, output an Elo
table in BOT.md automatically. Makes regressions visible at a glance.
Effort: low once G1 lands.

### G3. Decision inspector (debug UI)
In debug mode, clicking a bot's piece shows the MC stats for its last
decision (top-5 moves, mean utility, visit counts). Invaluable for tuning
weights by eye. Effort: medium (serialize stats over the wire).

### G4. Bench in CI
Run `bot-bench --turns 4` in CI and fail if avg decision time regresses
>30% — keeps the perf budget honest as heuristics accrete. Effort: trivial.
(Bench now supports `--warmup N` to measure midgame positions too — cover
both: opening is the latency worst case, midgame the volume case.)

### G5. Difficulty selector in the lobby
The registry already keeps every bot version alive. Surface it: lobby
"Bot difficulty" picker mapping easy=v1-belief, medium=v2.1-fixes,
hard=v3.1-spatial. Zero bot work, pure UI + a per-seat bot name in Room.
Good for the actual target audience (family games). Effort: low.

### G6. Opt-in replay corpus from real games
Server appends finished games' replay encodings to a local JSONL. Feeds:
K3 fixture positions, C3 human-prior tuning, and E1's layout pool with
*human* opponents instead of bot-meta. Effort: low. (Local file only —
no telemetry leaves the machine.)

---

## H. Fog-of-war game theory (Si Guo–specific)

### H1. Information-value term in evaluation (formalizes bomb baiting)
MC values material only; under fog, *learning* has real value. Credit each
rollout combat that would reveal information TO US (a probe resolving a
back-row unknown, an engineer confirming a mine) with a small bonus scaled
by relevance — distance of the revealed cell to the likely enemy flag.
This makes the deferred "bomb baiting" emerge from search instead of being
hand-coded: sacrificing a 排长 into a suspected bomb cluster scores well
when the flag is behind it. Impact: HIGH (unlocks a whole play style).
Effort: medium — needs the rollout to track which combats are "new info".

### H2. Mixed-strategy noise to avoid being read
A deterministic max-EV bot leaks information: humans learn that "bot attacks
here ⇒ it has a stronger piece". Pick among moves within ε of the best score
uniformly (ε ≈ 5% of utility range). Standard game-theoretic mixing, also
helps avoid deterministic exploitation loops in bot-vs-bot. Effort: trivial.
Risk: tiny strength cost in exchange for unpredictability.

### H3. Endgame switch: exact search when pieces are few
MC rollouts are weakest in long forced endgame sequences (engineer slowly
walking to a mine, flag race). When total mobile pieces ≤ 6, branching is
tiny — switch to a depth-16+ expectimax over sampled worlds (or full
minimax per sample). Impact: medium-high (endgames decide close games).
Effort: medium-high.

### H4. Cycle detection beyond 2-cycles
Anti-shuffle catches A→B→A; humans exploit 3-cycles (A→B→C→A). Keep the
last 6 own moves and penalize any move that closes a length-≤3 cycle with
no intervening capture. Effort: low.

## I. 2v2 team play, deeper

### I1. Partner-emergency defense
Current coordination only splits offense. Add: if any enemy piece stands
within 2 moves of a partner flag candidate, strongly bias moves that attack
or body-block that attacker. Symmetric with own-flag safety, which already
exists. Effort: low (reuse `flagHypothesisFor(partner)`).

### I2. Trade policy by material ratio
Classic endgame principle: the side ahead in material WANTS trades. In
`evaluateRollout`, scale the material delta by `1 + k / totalRemaining` so
the same +200 lead scores higher in a sparser position — rollouts then
prefer simplifying lines when ahead and avoid trades when behind (notably
when down 2v1 after losing the partner). Effort: trivial. Impact: medium.

### I3. Dead-partner urgency mode
When the partner is eliminated it's 1v2: avoid even trades (we lose the
material race by attrition), play for flag snipes and stalemate-clock
pressure (70-move draw is a SAVE when down). Add a "down a player" flag in
evaluation flipping the trade-policy sign and boosting flag-advance weight.
Effort: low.

## J. Sampler refinements

### J1. Antithetic / stratified sampling
Variance reduction without more samples: force the sample set to cover
complementary hypotheses — e.g. in half the samples place the enemy 司令 in
the most-likely lane, in the other half elsewhere; or stratify on "flag in
HQ-A vs HQ-B" exactly 50/50 (matching the prior) instead of letting RNG
cluster. Cheap and principled. Impact: medium (smoother move rankings).
Effort: low-medium.

### J2. Belief-delta resampling across turns
Beliefs change only slightly per turn; most sampled worlds stay plausible.
Cache last turn's samples and only re-draw pieces whose beliefs changed
(moved, fought, or excluded kinds shifted). Sampling is ~5% of budget today,
so this matters only after A5/A6 shrink rollout cost. Effort: medium.

### J3. Importance-weighting research note
Position priors make the proposal distribution differ from the true
posterior; in principle rollout results should be importance-weighted by
the inverse proposal probability. In practice the priors are mild and the
bias is shared across moves (rankings mostly unaffected). Revisit only if
C4 (full Bayesian vectors) lands. Effort: research.

## K. Engine-level speed (only if A-row runs out)

### K1. Integer cell indices + typed-array occupancy
Map cellIds to ints once; occupancy becomes a `Int16Array(129)`; `pieceAt`
becomes an array read. Rail slides walk precomputed int rays (K2). Probably
5–10× on move generation, which is the measured hot loop. Effort: HIGH
(parallel fast path must mirror engine semantics — see A6 caveat).

### K2. Precomputed rail rays
For every rail cell × direction, the ordered run of cells (with curve forks
expanded) is static — only occupancy changes. Precompute at module load;
a slide becomes "walk ray until occupied". Pairs with K1. Effort: medium.

### K3. Decision snapshot tests
Tooling guard for all of the above: capture ~20 midgame positions as
fixtures; assert the bot's chosen move stays in the historical top-3 set
under refactors. Catches silent behavior drift from "perf-only" changes.
Effort: low. (Complements G4's latency guard.)

## Deep dives — implementable-cold designs for the top picks

### DD-B4. Opponent-reply minimization at ply 1

The flaw today: mean-rollout MC scores my move by *averaging* over opponent
replies drawn from the fast policy. If 9 of 10 replies are harmless but one
reply refutes my move outright (takes my 司令 with their bomb), the mean
barely notices. A human always finds the refutation.

Design (drop-in change inside `runMonteCarlo`'s inner loop):

```
afterRoot = applyMoveForRollout(sampled, mySeat, m)
// NEW: opponent's turn — enumerate their top-K replies by fast score
replies = topK(fastScoreAll(afterRoot), K=3)
worst = +Infinity
for reply in replies:
  afterReply = applyMoveForRollout(afterRoot, opp, reply)
  v = evaluate(playOutFromSampled(afterReply, depth-2, rng))
  worst = min(worst, v)
scoreSums[m] += worst        // pessimistic: assume best opponent reply
```

Cost: ×3 rollouts at ply 1 — racing absorbs it (only survivors pay).
Needs `fastScoreAll` exported from rollout.ts (it exists privately as the
candidate-scoring step inside `fastPickMove`; refactor to return the scored
list). Apply the same trick at MY ply 2 (max) only if budget allows.
Expected effect: stops the bot walking strong pieces into known-bad squares
and overvaluing attacks with obvious counters. Tune K and the min/mean blend
(`0.7·worst + 0.3·mean` is a softer alternative that keeps some of the
averaging robustness).

### DD-B1. UCB1 root sampling (replaces the racing hard cut)

```
// per pickMove
for each move i: n[i]=0, sum[i]=0
warmup: 2 samples for every move (avoid div-by-zero, seed estimates)
while budget remains:
  pick i maximizing  sum[i]/n[i] + bias[i] + C * sqrt(ln(N) / n[i])
  run ONE (sample, rollout) for that move; update sum, n, N
return argmax(sum[i]/n[i] + bias[i])
```

Key adaptations for our setting:
- **C must match the utility scale.** Our utilities are ~material/10 with
  ±100k win sentinels; clip rollout values into [-2000, 2000] before the
  bandit (sentinels destroy exploration otherwise), or normalize by a
  running stddev. Start with C ≈ 300 and grid-search via the ladder (G2).
- **Sampled worlds rotate**: draw a fresh sampled world every M=8 pulls and
  share it across the next pulls (sampling cost stays amortized).
- Determinism: pull order is deterministic given the seeded RNG — fine.
- Keep racing as a fallback flag; A/B them with bot-eval.

### DD-G1. Parallel eval harness (worker_threads)

```
// bot-eval-parallel.ts
const W = os.cpus().length - 1
chunk game indices [0..games) into W slices
each worker: new Worker('./eval-worker.js', { workerData: { botA, botB, seeds }})
worker runs runOneGame per seed (pure, no shared state), posts outcomes
main thread aggregates, prints the same summary
```

Games are already seed-deterministic and side-effect-free — embarrassingly
parallel. Only subtlety: workers must import the TS via tsx loader or we
precompile shared to JS first (`pnpm -C shared build` then point workers at
dist). Target: 100-game evals in ~the time 12 take today. This converts all
our "N=4–6, within noise" caveats into real measurements.

### DD-H1. Information-value bookkeeping in rollouts

Definition of "information gained" must reference BELIEFS (pre-search), not
the sampled world (where everything is known):

```
// before sampling: infoValue[pieceId] for each opponent piece =
//   w_unknown(=1.0 if knownKind null && minRank null, 0.4 if bounds exist)
//   × relevance(cellId)   // 1/(1+dist to their likely flag), so back-row
//                          // unknowns near the flag are the juicy ones
// during rollout: when a combat involves MY piece vs opponent piece P and
// either side dies → credit infoBonus += INFO_W × infoValue[P.id] (once per P)
// evaluate(): utility += infoBonus
```

INFO_W start point: ~60 (≈ a 排长's value ÷ 2 — we'd happily spend half a
lieutenant to learn a flag-adjacent unknown). This makes probe-and-bait
*emergent*: rollouts where a cheap piece dies revealing a flag-guard score
better than passive shuffling. Directly subsumes the deferred bomb-baiting
TODO once relevance weighting is in.

### DD-K3. Decision snapshot fixtures

```
// fixtures/decisions/*.json: { name, replayEncoding, atMove, seat,
//                              acceptable: [ "from>to", ... ] }
// test: rebuild state via decodeGame+applyMovesUpTo, run bot.pickMove with
// 3 fixed seeds, assert each pick ∈ acceptable.
```

Populate `acceptable` from the current bot's top-3 by visit count (one-off
generator script). On any future refactor (esp. K1/K2 bitboards or A6
mutable sim), these catch silent behavior drift that latency benches and
unit tests can't see. Refresh fixtures deliberately when behavior change is
*intended*, with the diff visible in review.

---

## Parked / rejected (with reasons, so we don't re-litigate)

- **Neural eval / policy nets** — user decision: no ML. All of the above is
  heuristics + search.
- **Full ISMCTS** — IMPLEMENTED (`ismcts.ts`, `v5-ismcts`) and REJECTED
  (2026-06-12, 22.9% vs v3.1). A shared tree aliases nodes across
  determinizations: combat vs an *unknown* piece leads to incomparable states
  across sampled worlds, so shared node stats mix worlds exactly like the B1
  bandit did. Kept for reference. Only revisit with a determinization-aliasing
  remedy (world-stratified node stats, or shared nodes only at pre-combat
  positions) — see BOT_DEV_GUIDE §8.2/§9.3.
- **Mutable engine rewrite (A6/K1) now** — measured midgame cost is already
  ~94 ms; the opening peak (~400 ms) is acceptable for `normal` speed. Perf
  surgery is not the bottleneck; decision quality is. Revisit if B4's ×3
  ply-1 cost pushes the opening past ~800 ms.
- **Hard root pruning by static score** — permanently rejected; kills the
  clearance/setup moves that motivated MC in the first place (see BOT.md
  "Why top-K filtering breaks all of these").
- **Allied-visible 2v2 variant** — user decision: won't happen.

## Prioritized shortlist (as of 2026-06-11; status updated 2026-06-12)

1. ~~**G1 parallel eval**~~ SHIPPED (task #53).
2. ~~**B4 opponent-reply minimization**~~ SHIPPED in v4.
3. ~~**D7 true graph distances**~~ SHIPPED in v4 (`distances.ts`).
4. ~~**D5 stalemate-clock awareness**~~ SHIPPED in v4.
5. ~~**B1 UCB root sampling**~~ IMPLEMENTED and REJECTED (measured 2026-06-12:
   ~17% vs v3.1 — catastrophically worse than racing). Root cause: the bandit
   evaluates different moves on DIFFERENT sampled worlds, destroying the
   paired-comparison property (B2) that uniform/racing sampling gets for free;
   move ranking then chases world-luck. A fix would need per-world full sweeps
   (= racing) or world-stratified pulls. Kept behind `MonteCarloOptions.ucb`
   for reference; not on the strength line.
6. ~~**H1 information-value term**~~ IMPLEMENTED (`infovalue.ts`, v4.1).
   Measured: COSTS ~6 pts in self-play (62.5–66.7% vs v4's 68.8–72.9%) —
   v3.1 doesn't punish probing the way humans do. Same trade-off class as
   v3.1's human-strategic refinements: keep for human play, off the
   self-play strength line.
7. ~~**C1 roster-aware estimateRank**~~ SHIPPED in v4 (belief.ts pool averages).
8. ~~**I2 + D6**~~ SHIPPED in v4; ~~**I3**~~ in v4.1 (`downPlayerUrgency`).
9. ~~**Reveal-urgency defense (loss-pattern a)**~~ IMPLEMENTED and REJECTED.
   `evaluate.ts` `revealedFlagUrgency` (×3 symmetric, `v4-flagurgent`, 62.5%)
   and `revealedDefenseUrgency` (×2 defense-only, `v4.3-defurgent`, ~44% net,
   2026-06-23) both failed. A static-eval multiplier is the wrong tool for
   "defend the just-revealed flag"; pattern (a) is closed pending a different
   mechanism. **Opening bleed (loss-pattern b) is now the prime target.**
**Top of the live queue (user-requested 2026-07-14, ahead of everything below):**
**D8 imperative flag defense**, **D10 imperative flag assault + multi-turn
staging**, **D9 stronger strong-piece bias**. D8/D10 are a matched pair — make
flag loss/capture behave as the near-terminal events they are, **gated on a
detected threat/opportunity** (always-on urgency multipliers already failed,
item 9). D10 also exposes the one structural limit found so far: at `depth: 4`
the bot cannot plan a multi-turn flag march at all.

10. **F2 reveal exploitation + H4 cycle detection** — cheap, big vs humans.
11. **K3 decision snapshot tests** — guard rails before deeper perf surgery
    (the `rollout_fastpath` equivalence test is the first instance).
12. **G5 difficulty selector** — zero bot work, best UX return for the
    actual audience.

**2026-06-12 lesson:** the single biggest strength gain (B7, +12.5 pts) came
from REDUCING PLAYOUT NOISE, exactly where the depth experiment pointed —
not from more search features. Sample count at compute parity (S=24→44 at
d4, still cheaper than v3.1's d9) was worth ~+4. Eval-term stacking (D5, D6,
I2, C1) and reply-min were worth ~+19 combined over v3.1.
