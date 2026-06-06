# TODO

## Pending

- [x] **#48 v3-mc bot** ✓ shipped. Wins ~85% vs v2.1 across both orientations (80% / 90% in 10-game samples). Files: `sampler.ts`, `rollout.ts`, `evaluate.ts`, `v3_mc.ts`. 8 new tests in `sampler.test.ts`. Set as `LATEST_BOT`.
- [ ] **#49 In-game move history scrubbing** — Prev/Next/Start/End during live play; the moment a new move arrives, snap back to present. Reuses `applyMovesUpTo` + `projectView` for fog correctness. Server needs to push `setupSnapshot` once at SETUP→PLAYING; everything else is client-only.
- [x] **#50 Small bias toward moving strong pieces** ✓ shipped. `strongMoveBonus(kind) = rank × 1.5` added as a tie-break on v3-mc's root-move mean utility and in the rollout fast-policy empty-move weight. Frozen baselines untouched. No regression — v3-mc still ~100% vs v2.1 in spot-check.

<!-- Requested bot-behavior additions -->
- [ ] **Bot: avoid revealing engineers by default** — engineers-only moves (moves that can only be performed by an engineer, e.g. corner-turn on rail or mine-clear probes) reveal piece identity; bots should prefer non-revealing alternatives unless the information gained justifies the reveal.
- [ ] **Bot: use engineers to probe suspected mines** — engineers should be prioritized to probe cells with non-zero mine probability (probe when P(mine) > 0) to gather mine information, even if the probe is risky.
- [ ] **Bot: avoid attacking pieces already probed stronger (except bombs)** — do not initiate combat against an opponent piece that your belief model already estimates as higher rank than your attacker, unless the defender is believed to be a bomb (special-case allow attack).
- [ ] **Bot: slightly reduce strong-piece move bias** — lower the `strongMoveBonus` multiplier slightly (e.g. from ×1.5 to ×1.3) to reduce over-aggressive movement of top-rank pieces; add a test to verify no large regression.

## v3 backlog (sequenced after v3-mc unless it plateaus)

- [ ] **Flag-hypothesis advance scoring** — per opponent, ranked list of possible flag cells; each move gets `advanceValue` based on distance to the most likely candidate. HQ stays a candidate until a piece moves out of it (flags never move).
- [ ] **Safety scoring + 司令 protection** — count unknown enemies within K moves of own flag; pull pieces back if K drops below threshold.
- [ ] **2v2 partner coordination** — partner-aware target selection. If partner is pressuring E, this bot pressures W. If partner's 司令 dies (flag revealed), shift to defense of partner's HQ alongside own.
- [ ] **Bomb baiting** — explicitly probe high-density unknown clusters near suspected flag cells with mid-rank pieces.

## v3.1 / later

- [ ] **Sampler backtracking** — replace retry-on-infeasible with proper backtracking. Only if eval shows greedy failure rate matters.
- [ ] **Per-seat strict-fog projection inside rollouts** — currently the rollout policy assumes opponents play with full knowledge of the sampled world. Switching to per-ply projection is more correct but costlier. Only if eval shows the bias hurts.
- [ ] **UCB tree expansion (`v3.1-mcts`)** — natural escalation if flat MC plateaus.
- [ ] **ISMCTS** — only if flat MC + UCB both plateau.
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

## Test inventory (110 passing)

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

## Project task ledger

All **36 tracked tasks completed** so far. Pending: #49 in-game scrubbing, #50 strong-piece bias.

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
| 49 | ☐ | In-game move history scrubbing |
| 50 | ✓ | Small bias toward moving strong pieces (don't park 司令/军长) |
