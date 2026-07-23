# TODO

> Bot onboarding + roadmap: [`BOT_DEV_GUIDE.md`](BOT_DEV_GUIDE.md). Lab
> notebook: [`BOT.md`](BOT.md). Idea backlog: [`IDEAS.md`](IDEAS.md).

## Concluded — #54 v4 strength campaign (goal was >90% vs v3.1-spatial; reached ~80%)

- [x] **Depth-scaling experiment** — answer: NO linear gains, deeper is WORSE
  (d3 > d9 > d12; see BOT.md). Compute now buys samples + near-root precision.
- [x] **v4-replymin** — B4 reply-min, D7 graph distances, D5 clock, I2 trade
  policy, D6 camp refuge, C1 roster-aware beliefs. 68.8% vs v3.1 (48 games).
- [x] **v4.1-info** — H1 information-value (the deferred bomb-baiting model,
  `infovalue.ts`) + I3 dead-partner urgency. Self-play 62.5%: info COSTS
  strength vs bots that don't punish info-ignorance; keep for human play.
- [x] **Sample scaling at compute parity** — v4-s44: 72.9% (v4 d4 ≈ ½ of
  v3.1's per-move cost, so S=24→44 is free).
- [x] **B7 greedy-ε playouts** — v4-greedy (S=44, ε=0.7): **85.4%**. The
  noise-reduction lever the depth experiment pointed at.
- [x] **B8 avoid-hanging playout term** — v4-safe; first orientation 83.3%.
- [x] **B1 UCB root bandit** — implemented and REJECTED (18.8% — breaks
  paired-world comparisons; see IDEAS.md B1 post-mortem).
- [x] **Capture-first greedy argmax fix** — attack weights (EV/5) and quiet
  weights (1+strongBonus) were on different scales, so greedy playouts
  preferred shuffling 司令 to taking free material.
- [x] **Ablations** — no-reply-min 68.8%, no-eval-extras 68.8%: both confirm
  the full config; also CRN 75.0%, k4 66.7%, setup-MC 66.7%, stack 62.5%,
  advance-bias 64.6% — every other lever measured worse.
- [x] **Final pick: `v4.2-greedy` shipped as LATEST_BOT** — 80.2% net vs
  v3.1-spatial over 96 pooled games at lower per-move cost. The >90% target
  was NOT reached; flat-MC knob space is exhausted (next step would be a true
  tree search / ISMCTS, or data-driven fixes from loss forensics:
  `scripts/bot-loss-analysis.ts`).
- [x] **Full ISMCTS (`v5-ismcts`)** — implemented (`ismcts.ts`) and REJECTED
  (22.9% vs v3.1): shared-tree node aliasing across determinizations, same
  failure mode as the B1 root bandit. See BOT_DEV_GUIDE §8.2.
- [x] **Loss forensics** — `scripts/bot-loss-analysis.ts` found two loss
  patterns: (a) flag falls 2–10 turns after the marshal dies and reveals it;
  (b) 4/6 losses already 300–400 material down by turn 50 (opening bleed).
- [x] **Reveal-urgency defense (loss-pattern a)** — REJECTED both ways:
  `v4-flagurgent` (×3 symmetric, 62.5%) and `v4.3-defurgent` (×2 defense-only,
  ~44% net, 2026-06-23). A static-eval multiplier is the wrong tool; pattern
  (a) is closed pending a different mechanism.

### Next target (post-campaign)

- [ ] **Opening bleed (loss-pattern b)** — the prime unsolved target. Classify
  the opening mistakes on a larger loss corpus (`bot-loss-analysis.ts`) and fix
  the dominant class via setup (`smartValidSetup` / E1 layout curation) or
  early-game eval. Accept: ≥96 pooled games, net ≥55% vs v4.2, replicated.
  See BOT_DEV_GUIDE §9.1.
- [ ] **Imperative flag defense (IDEAS.md D8)** — user note 2026-07-14: when an
  enemy gets within ~2 moves of our flag, or has a clear defender-free path to
  it, commit to capturing/blocking it no matter the material cost. Implement as
  a **threat-gated** near-terminal `flagSafety` escalation + a capture/block
  `rootBias` (NOT an always-on multiplier — that's why the earlier reveal-urgency
  variants failed). Targets loss-pattern (a). See BOT_DEV_GUIDE §9.1.
- [ ] **Imperative flag assault (IDEAS.md D10)** — user note 2026-07-14: if an
  opponent flag is open, charge it, or at least stage moves toward it. Two parts:
  (1) opportunity-gated near-terminal preference for capturing a revealed /
  undefended flag; (2) **the staging problem is structural** — at `depth: 4` a
  6-ply march has no payoff inside the search horizon, so the bot never starts
  one. Fix via a convex distance curve, a persistent assault commitment
  (designated attacker + target flag cached across turns), and/or a *targeted*
  rollout advance bias (untargeted already failed at 64.6%). Reuse the target
  assignment from `partnerCoordinationBiasGraph`. See BOT_DEV_GUIDE §9.1.
- [ ] **Stronger strong-piece bias (IDEAS.md D9)** — user note 2026-07-14: play
  stronger pieces more. Raise `STRONG_MOVE_BIAS` (1.3→1.5–2.0) and/or add a
  `PlayoutPolicy.strongBias`. Must be measured (may cost self-play strength by
  exposing heavies early; ship behind the aggressive/difficulty flag if it
  regresses). See BOT_DEV_GUIDE §9.1.

## Pending

- [x] **#48 v3-mc bot** ✓ shipped. Wins ~85% vs v2.1 across both orientations (80% / 90% in 10-game samples). Files: `sampler.ts`, `rollout.ts`, `evaluate.ts`, `v3_mc.ts`. 8 new tests in `sampler.test.ts`. Set as `LATEST_BOT`.
- [x] **#49 In-game move history scrubbing** ✓ shipped. Simpler than the original sketch: the client caches every fog-projected `PlayerView` it receives (one per move) in `viewHistory`, and scrubbing just shows a cached past view — no reconstruction, no server changes, fog automatically correct. Prev/Next/Start/Now + scrub bar in the Play side panel; board dims + goes read-only while scrubbed; auto-snaps to present on each new move (dedup by move count). Limitation: scrub history resets on reconnect (client only has views received since connecting).
- [x] **#50 Small bias toward moving strong pieces** ✓ shipped. `strongMoveBonus(kind) = rank × 1.5` added as a tie-break on v3-mc's root-move mean utility and in the rollout fast-policy empty-move weight. Frozen baselines untouched. No regression — v3-mc still ~100% vs v2.1 in spot-check.

<!-- Requested bot-behavior additions — all shipped in v3.1 (#51) -->
- [x] **Bot: avoid revealing engineers by default** — v3.1 `engineerBias` penalizes engineer-only moves (rail corner-turns a non-engineer couldn't make, detected via `isEngineerOnlyMove`) unless the move probes a suspected mine.
- [x] **Bot: use engineers to probe suspected mines** — v3.1 `engineerBias` gives a bonus for an engineer moving onto a cell with `mineConfidence > 0`.
- [x] **Bot: avoid attacking pieces already probed stronger (except bombs)** — v3.1 `observedLosingAttackPenalty`: soft penalty for attacking a piece whose observed `minRank > my rank`. Bombs are excluded automatically (a bomb never survives combat, so never carries a minRank). Made a soft penalty (not a hard prune) so the rollout keeps the option when the simulated payoff justifies it.
- [x] **Bot: slightly reduce strong-piece move bias** — `STRONG_MOVE_BIAS` lowered ×1.5 → ×1.3; regression test in `bot_v3_1.test.ts`.

## v3 backlog — shipped in v3.1 (#51)

- [x] **Flag-hypothesis advance scoring** — `flaghypothesis.ts` ranks flag candidates; `evaluateRollout` flag-proximity reward.
- [x] **Safety scoring + 司令 protection** — `evaluateRollout` own-flag safety penalty; Marshal-alive bonus carried from v3-mc.
- [x] **2v2 partner coordination** — `partnerCoordinationBias` root bias to press the un-pressured opponent.
- [ ] **Bomb baiting** — DEFERRED (user: "wait, it's more advanced"). Needs information-value modeling the material eval doesn't capture.

## v3.1 / later

- [ ] **Sampler backtracking** — replace retry-on-infeasible with proper backtracking. Only if eval shows greedy failure rate matters.
- [ ] **Per-seat strict-fog projection inside rollouts** — currently the rollout policy assumes opponents play with full knowledge of the sampled world. Switching to per-ply projection is more correct but costlier. Only if eval shows the bias hurts.
- [x] **UCB tree expansion / B1 root bandit** — implemented and REJECTED
  (18.8% vs v3.1; breaks paired-world comparisons). See IDEAS.md B1.
- [x] **ISMCTS** — implemented (`ismcts.ts`, `v5-ismcts`) and REJECTED (22.9%;
  determinization node aliasing). Revisit only with an aliasing remedy.
- [ ] **Bomb placement bias (small)** — slight column-preference for one of the two bombs at setup. Currently uniform within rows 3–4. Low priority; move-time heuristics dominate current win-rate gap.

## Done

All previously tracked TODO items completed. Promotions to v2 / v2.1 / strict-fog / dead-piece transparency / replay encoding / etc. are in the task ledger and BOT.md change history.

- [x] A piece on a corner of a center should not impede on the curved highway (they are two different roads)
- [x] Dead pieces should not interfere with movement (engine + bot + client all filter on `p.frozen`)
- [x] Saved setup layouts — designer screen + encoding + paste at match start (#39)
- [x] "Back to lobby" button after a game ends, with server-side room reset (#40)
- [x] Engineer animation follows multi-leg rail BFS path, not straight A→B (#41)
- [x] Smarter bot piece placement — 排长/连长 in non-flag HQ + heavyweights in interior rows + mines clustered near flag (#42)
- [x] Bot v1 with belief tracking + resignations in game log (#43)
- [x] v2 bot — strict fog + mine confidence + bomb offense + captures panel rebuild (#44)
- [x] v2.1 bot — anti-shuffle filter + EV-based scoring + engineer valued at 100 (#45)
- [x] Dead pieces no longer hinder movement (legal-move generation) (#46)
- [x] Update README to reflect current state (#47)

## Test inventory (144 passing, 16 files)

All tests live under `shared/tests/` and run with `pnpm test`.

| File | Tests | Coverage |
|---|---:|---|
| `board.test.ts` | 19 | geometry: zones × cells, HQ / camp / station / center placement, rail-on/off classification, 8-dir camp adjacency, `C-2-2` transit-only, rail edges, road edges, no inter-zone roads, front-line→center connections, `setupCellsForZone` |
| `setup.test.ts` | 11 | placement validation (flag in HQ, mines back two rows, bombs not row 6), random + deterministic seed, `smartValidSetup` constraints |
| `moves.test.ts` | 31 | road steps, camp diagonals, teammate blocking, HQ immobility, mine/flag immobility, rail slides (engineer + non-engineer), corner curves, curve bypasses corner cell, `pathOfMove` (3), dead-piece transparency in `viewMoveContext` |
| `combat.test.ts` | 9 | rank table, engineer vs mine, bomb mutual destruction, flag capture |
| `engine.test.ts` | 14 | createGameState → submitSetup transition, applyMove + turn flow, combat outcomes, flag capture eliminates owner, Marshal-reveal, 2v2 + FFA win conditions, dead-piece transparency |
| `view.test.ts` | 4 | strict-fog projection: own kinds visible, opponents hidden, teammates hidden, Marshal-reveal flips flag |
| `replay.test.ts` | 6 | setup round-trip, full-game replay determinism, resign encoding, applyMovesUpTo with explicit resigns |
| `belief.test.ts` | 11 | `estimateRank` value table, kind revelation, strict-fog inference (rank bounds from combat outcome), mine-confidence accumulation, HQ flag-candidate prior, resign skipping |
| `bot_v2_1.test.ts` | 5 | `PIECE_VALUE` table (engineer = 旅长 = 100), v2.1 anti-shuffle, EV scoring sanity, deterministic |
| `sampler.test.ts` | 8 | v3-mc belief sampler: determinism, roster bounds (≤count, sum 25), setup-rule + rank-bound respect, own-kind preservation, infeasible path |
| `flaghypothesis.test.ts` | 3 | v3.1 flag-candidate ranking: both HQs initial, empty HQ ruled out, `likelyFlagCell` |
| `bot_v3_1.test.ts` | 5 | reduced 1.3 strong-move bias, rank-less zero bias, v3.1 valid setup + move smoke |
| `bot_v4.test.ts` | 6 | `fastTopKMoves` reply-min probe (≤k, deterministic), V4_SPATIAL clock term (leading-stale worse, flips for trailing side), v4 valid setup + legal move, greedy/safe + UCB playout determinism |
| `distances.test.ts` | 7 | D7 `moveDistance`: adjacent road = 1, straight rail slide = 1, central curve = 1, ring corner = 2 (non-engineer), HQ exit-impossible/enterable, tighter-than-Manhattan across zones, symmetric |
| `infovalue.test.ts` | 4 | H1 info-value: unknown-piece pricing, flag-relevance weighting, once-per-piece rollout credit |
| `rollout_fastpath.test.ts` | 1 | `applyMoveForRollout` ≡ `applyMove` equivalence (the perf-refactor guard rail) |

## Project task ledger

All tracked tasks #15–#51 completed, plus the #54 v4 strength campaign (concluded: `v4.2-greedy` ships at ~80% vs v3.1). The flat-MC approach has now plateaued: the UCB tree (B1) and ISMCTS escalations were implemented and REJECTED (determinization aliasing), and bomb-baiting shipped as v4.1's info-value model (off the self-play strength line). The live backlog is loss-forensics-driven decision-quality work — primarily the opening-bleed pattern (see the "Next target" section above and BOT_DEV_GUIDE §9).

| # | Status | Title |
|---|---|---|
| 15 | ✓ | v1 shipped — engine, server, client, LAN multiplayer, bots |
| 16 | ✓ | 3×3 stoppable central area + hidden combat + debug mode + bigger board |
| 17 | ✓ | Smaller piece glyphs + top-left zoom inspector + bottom-left rank guide |
| 18 | ✓ | Document dev/share workflow so friends see latest code |
| 19 | ✓ | Bot v2: at least beat random |
| 20 | ✓ | Board rotation per viewer so own zone sits at the bottom |
| 21 | ✓ | Chat panel in Lobby and Play screens |
| 22 | ✓ | Variants UI: expose engine toggles in the lobby |
| 23 | ✓ | Draw offers + voluntary tie |
| 24 | ✓ | Move-history / replay log on the side panel |
| 25 | ✓ | Captured-pieces tray per seat |
| 26 | ✓ | Central-corner curves passable by all pieces (non-engineer curve rule) |
| 27 | ✓ | UI centering: shift board right so RankGuide doesn't cover it |
| 28 | ✓ | Render the central-corner curves visually on the board |
| 29 | ✓ | Setup: place all of one piece kind without re-picking each time |
| 30 | ✓ | Animate piece moves A→B + highlight last move per player |
| 31 | ✓ | Bot move-speed setting (slow / normal / fast / instant) |
| 32 | ✓ | Animate moves along the actual rail/road path |
| 33 | ✓ | Camps: 8-directional adjacency |
| 34 | ✓ | Central area: middle cell C(2,2) is transit-only |
| 35 | ✓ | Minimize/collapse button on the RankGuide |
| 36 | ✓ | Turn-indicator arrow pointing into the current player's zone |
| 37 | ✓ | Replay system: encoding scheme + step-through replay mode |
| 38 | ✓ | Curve bypasses corner cell + dead pieces don't interfere |
| 39 | ✓ | Saved setup layouts — designer screen + encoding + paste at match start |
| 40 | ✓ | Back-to-lobby button after game end |
| 41 | ✓ | Engineer animation follows multi-leg rail BFS path |
| 42 | ✓ | Smarter bot piece placement |
| 43 | ✓ | Bot v1 with belief tracking + resignations in game log |
| 44 | ✓ | v2 bot: strict fog, mine confidence, bomb offense + captures panel rebuild |
| 45 | ✓ | v2.1 bot: anti-shuffle filter, EV-based scoring, engineer valued at 100 |
| 46 | ✓ | Dead pieces no longer hinder movement (legal-move generation) |
| 47 | ✓ | Update README to reflect current state |
| 48 | ✓ | v3-mc bot: belief sampler + Monte Carlo rollouts |
| 49 | ✓ | In-game move history scrubbing |
| 50 | ✓ | Small bias toward moving strong pieces (don't park 司令/军长) |
| 51 | ✓ | v3.1 bot: flag-hypothesis + safety + partner coord + bomb bias + engineer/attack refinements |
