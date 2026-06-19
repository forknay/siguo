# Bot strategy + implementation plan

## Design decisions log

Explicit choices the user has made through this work that constrain future
versions. Listed so we don't accidentally re-litigate them.

- **Path (b) — fog-respecting "player" bot, not an omniscient assistant.**
  Every bot version after v0 must consume `PlayerView`, never `GameState`.
- **No ML.** Heuristics + sampling only. Stratego ISMCTS / neural rollouts are deliberately out of scope unless flat MC + UCB tree plateau.
- **Engineer valued at 100 (= 旅长, rank 6)** in `PIECE_VALUE`. Reflects mine-clearing utility scarcity.
- **Strict fog of war everywhere.** `projectView` strips `attackerKind`/`defenderKind` from `moveHistory` for non-involved viewers (P2 / v2). Bots get the same fog humans do.
- **2v2 focus.** Coordination + setup heuristics tune for 2v2; FFA is supported by the engine but not the primary design target for bots.
- **Bombs hunt strong pieces.** v2's `scoreAttack` for `myKind === ZHADAN` scores `30 + estimatedRank × 5` with multipliers vs known 司令 (×3), 军长 (×2), HQ (×2).
- **Engineers favor probable mines but are not forced** there. Weighted always, never required.
- **Cells with `mineConfidence > 0.4` are hard-blocked for non-engineers.** Filtered out of the legal-move list entirely.
- **HQ position prior dropped from the sampler.** HQ pieces can't move, so the hard constraint already nails the JUNQI placement; a prior would be redundant.
- **No bomb-bonus for back-row+unmoved in the sampler.** Bombs in rows 1–2 are unusual in human play.
- **Partner stays strict-fog in 2v2.** No allied-visible variant. Bot treats partner identically to opponents at the sampler level.
- **Sampler defers backtracking.** Greedy + tight-constraint-first + retry-seed on infeasible. Add backtracking only if real games show pathological failure rates.
- **Top-K static-score lookahead is dead.** Option A from the original v3 plan won't ship — it filters away exactly the setup/clearance moves planning is supposed to discover. v3.5 starts from sampled Monte Carlo with all legal root moves.
- **Resignations are explicit in the encoding.** `applyResign` appends a `ResignEntry` to `moveHistory`; replay encoding has `R|<seat>` lines.
- **Dead pieces are transparent to movement.** Engine, bot, and client all filter `p.frozen` in their `MoveContext` builders. One canonical builder (`viewMoveContext` in `shared/src/bot/legal.ts`) shared between the bot and the client.
- **Strong-piece activation bias is tiny (`STRONG_MOVE_BIAS = 1.3` × rank).** Applied as a tie-break on the MC root-move mean utility + in the rollout fast-policy empty-move weight. Far smaller than material-driven deltas, so it only breaks near-ties toward moving 司令/军长 rather than leaving them parked. Frozen baselines (v0–v2.1) are NOT modified — the bias lives only in the MC line.
- **Human-strategic refinements override raw self-play win rate.** v3.1's engineer reveal-avoidance, mine probing, and observed-stronger-attack penalty cost a little self-play strength vs v3-mc (which doesn't exploit those mistakes), but make the bot sounder against humans. Self-play eval is a proxy, not the objective — the objective is playing well against people.
- **#3 (don't attack observed-stronger) is a soft penalty, not a hard prune.** A hard prune removes options the rollout could otherwise value (sacrifice, path-clear); the soft penalty nudges without amputating. Bombs are auto-excluded because a bomb never survives combat to set a `minRank`.
- **Bot selection is speed-gated.** The server runs the expensive `v3-mc` planner at `normal`/`slow` botSpeed, and falls back to the cheap `v2.1` heuristic at `fast`/`instant` (where v3-mc's ~100–300 ms/move would stall the loop).



A fog-respecting heuristic player bot for Si Guo Jun Qi 2v2. No ML. Designed
to be improved incrementally so we can measure each change against the
current implementation by playing matches.

## Status

| Layer | State |
|---|---|
| Bot versions | ✓ `v0-baseline` · ✓ `v1-belief` · ✓ `v2-fog` · ✓ `v2.1-fixes` · ✓ `v3-mc` · ✓ `v3.1-spatial` · ✓ `v4-replymin` · ✓ `v4.1-info` · ✓ `v4.2-greedy` (active, latest) |
| Strict fog of war | ✓ `projectView` strips `attackerKind`/`defenderKind` from non-involved viewers' `moveHistory` |
| Move selection (v2) | Strict-fog belief tracking + mine-confidence cell filtering + bomb-as-attacker heuristic |
| Setup | `smartValidSetup` — mines clustered near flag, 排长/连长 in non-flag HQ, heavies in interior rows |
| Versioning infra | ✓ `shared/src/bot/` with `Bot` interface, registry, `botByName` |
| Eval harness | ✓ `pnpm bot-eval --teamA X --teamB Y --games N --mode 2v2 --seed N` |
| Belief model | ✓ `belief.ts` — outcome-based rank bounds, per-cell mineConfidence, mine-decay on cleared cells |
| Mine confidence | ✓ Per-cell additive: position prior + failed-attack hits weighted by attacker rank |
| Bomb offense | ✓ Bombs score `30 + estimatedRank × 5`, ×3 vs known 司令, ×2 vs known 军长 or HQ |
| Captures panel | ✓ Rebuilt — own losses only, grouped by killer seat |
| Planning | ✓ `v3-mc` — belief-sampled Monte Carlo, all legal root moves × 6-ply rollouts |
| Strong-piece bias | ✓ Small rank-weighted tie-break so heavyweights don't get parked (`strongMoveBonus`) |
| Spatial goals | ✓ `v3.1` — flag-hypothesis offense (`flaghypothesis.ts`) + flag-proximity reward in `evaluateRollout` |
| Defense | ✓ `v3.1` — own-flag safety penalty (enemies near our HQ) in `evaluateRollout` |
| 2v2 coordination | ✓ `v3.1` — partner-coordination root bias: press the opponent the partner isn't |
| Bomb placement bias | ✓ `v3.1` — nudge one bomb into the flag's column at setup |
| Bomb baiting | Deferred (user: "wait, it's more advanced") — needs information-value modeling |

### Measured win rates (30 games per orientation, deterministic seeds)

| Match | Team A wins | Team B wins | Avg turns | Pieces left (A / B) |
|---|---|---|---|---|
| v0 vs v0 (mirror, seed 200) | 50.0% | 50.0% | 185.8 | 14.3 / 12.5 |
| v0 vs v1 (seed 100) | 36.7% | **63.3%** | 206.7 | 11.6 / 12.5 |
| v1 vs v0 (seed 300) | 46.7% | 53.3% | 194.6 | 12.2 / 12.5 |
| v0 vs v2 (seed 800) | 36.7% | **63.3%** | 180.8 | 12.3 / 15.1 |
| v2 vs v0 (seed 700) | **73.3%** | 26.7% | 196.0 | 15.3 / 11.5 |
| v1 vs v2 (seed 500) | 30.0% | **70.0%** | 199.5 | 11.9 / 14.3 |
| v2 vs v1 (seed 600) | **73.3%** | 26.7% | 197.6 | 14.9 / 11.0 |

**Net win rates (avg of both orientations):**

| Bot | vs v0 | vs v1 |
|---|---|---|
| v1 | ~55% | — |
| v2 | **~68%** | **~71%** |

v2 dominates both prior versions from BOTH orientations and consistently
leaves more pieces on the board, indicating cleaner closeouts (it's
trading less and capturing more efficiently). The strict-fog upgrade
costs accuracy in some places but the mine-confidence + bomb offense
heuristics more than compensate.

### v1 belief-model summary

For each piece in `view.pieces`:

- `knownKind` is set if (a) the bot owns it, OR (b) it survived a recorded
  combat in `moveHistory` (winner's kind is published in the combat record).
- `estimatedRank` is the single-number score used by `scoreAttack`:
  - Known soldier → its actual rank.
  - Known bomb → 10 (deterring), mine → 8, flag → 0.
  - Unknown + in HQ + unmoved → 1.5 (likely flag candidate).
  - Unknown + back row + unmoved → 7 (likely mine/defender).
  - Unknown + has moved → 4.16 (average soldier rank).
- `hasMoved` is true if the cell has ever been the destination of a move.
- Heavyweight reluctance: 司令 attacks on unknown front-line cells get
  weight ×0.2; 军长 gets ×0.5. Keeps the marshals from suicide-probing
  bombs in the early/midgame.

**Path:** (b) fog-respecting. The bot must consume the same `PlayerView` a
human would — its own pieces' kinds + whatever it has deduced about opponents.
The omniscient peek into `state.pieces` is a v1 implementation detail to be
removed.

---

## Research notes (mixed Stratego literature + Lu Zhan / Si Guo tactical sources)

### Stratego AI without ML

Pre-DeepStratego academic work boils down to four ideas that compose well:

1. **Belief state per opponent piece** — a probability distribution over the
   12 piece kinds for every face-down enemy piece. Initialized from the
   opening count (e.g. P(kind=司令) = 1/25, P(kind=排长) = 3/25, …). Updated
   on every observation: combats, move patterns, board position.
2. **Information sets and "indistinguishability"** — when multiple pieces
   could be the same kind given what we know, we treat them as a class. We
   don't need to commit to "piece #7 = 师长 vs 旅长" until we have to.
3. **Move heuristics over expected outcomes** — for each candidate move,
   compute its expected combat result under the current beliefs. Don't pick
   max-EV mechanically; combine with positional and safety scores.
4. **Reveal cost** — moving a strong piece reveals information to the
   opponent (long rail slides ⇒ "this is a mobile, not a mine"; turning rail
   corners ⇒ "this is an engineer"). Strong heuristic players hide their
   intentions.

Useful concrete heuristics from the literature and online Stratego forums:

- **Piece values for combat EV** (Stratego.com community consensus, adapted
  to 12 ranks). These are *relative* values for decision-making, not flag
  arithmetic:
  - 司令 (9): 1000
  - 军长 (8): 400
  - 师长 (7): 175
  - 旅长 (6): 100
  - 团长 (5): 70
  - 营长 (4): 50
  - 连长 (3): 30
  - 排长 (2): 25
  - 工兵 (1): 60 *(special — mine-clearing utility)*
  - 炸弹: 200 *(used once)*
  - 地雷: 50 *(blocks one attacker)*
  - 军旗: ∞ *(losing this loses the game)*
- **Engineer premium**: each surviving engineer is worth its rank-1 value
  plus a multiplier reflecting unrevealed enemy mines (~×2 if all mines
  unaccounted for, ×1 if all known).
- **Reveal cost**: when a piece becomes "definitely identified" by an
  observer, the moving player paid an information cost ≈ value(piece) × 0.1
  to 0.3. Bigger penalty for higher-rank reveals (司令 reveal is catastrophic
  because of the Marshal-death flag-reveal rule).

### Lu Zhan / Si Guo Da Zhan tactical canon

Strategy notes culled from Chinese community sources (QQ Games guide, JJ
help center, GameABC, BoardGameGeek strategy threads):

- **HQ row defense**: the flag's HQ is one of two cells. Surround it with
  mines (≥2 of your 3 mines in the back row) and one bomb in column adjacent
  to it. Force the opponent to spend an engineer + a mid-rank piece just to
  break in.
- **司令 is a hostage to the flag-reveal rule**. If you lose your Marshal,
  your flag is publicly outed. So:
  - Don't expose 司令 to unknown enemy pieces until the late game.
  - Keep 司令 near the back so it can rescue the flag once attackers commit.
- **Bombs as ambush, not gate**. The 2 bombs are too few to wall off a
  region. Place them where the opponent is *likely* to send a mid-rank
  attacker — usually rows 3–4 in the column where you've placed
  engineers (they'll dodge mines but eat bombs).
- **Opening probes**: lead with 排长/连长 (你的炮灰). Trade them aggressively
  to map out enemy ranks. Conserve the top 4 (司令, 军长, 师长×2) for the
  midgame.
- **Engineers in column 1 / column 5**: the rail rings give them
  long-distance mobility; their corner-turning ability lets them flank.
  Standard opening sends one engineer down the outside rail to probe the
  enemy's back-row mines.
- **2v2 coordination**:
  - **Front-line lane sharing**: the four central rail nodes facing cols 1,
    3, 5 are the only inter-zone connections. The team with their pieces
    on those nodes controls the tempo.
  - **Don't both attack the same opponent**. Standard 2v2 has one teammate
    pressuring each opposing seat. If both you and your partner attack E,
    W gets a free tempo.
  - **Flag-reveal cooperation**: if your partner's 司令 dies, their flag is
    exposed — you push to defend their HQ, they switch to all-out attack.
- **Endgame**:
  - Once both your engineers are dead, you cannot pass enemy mines. So
    don't trade engineers cheaply.
  - Once both opponent 工兵 are dead, your own mines are *permanent*
    obstacles. Reposition pieces to use mines as walls.

### What we deliberately defer

- **Linear-equation belief propagation** (full deduction of constraints
  across the board). User explicitly out of scope for now. We'll do local
  per-piece updates only.
- **Monte Carlo Tree Search**. Skipping until heuristics plateau.
- **Opponent modeling** (predicting their next move based on prior patterns).
  Future work.

---

## Belief / tracking model — design

A `BotBeliefs` object the bot maintains per its own seat. Updated after
every observation (the bot consumes `PlayerView` and `MoveRecord[]` events).

### Per-piece records

Every piece on the board, friend or foe, gets a record:

```ts
interface PieceBelief {
  pieceId: string;
  owner: SeatId;
  cellId: string;
  alive: boolean;

  // Known kind (own pieces, or revealed via combat in debug mode).
  knownKind: PieceKind | null;

  // Lower bound on rank: this piece must be at LEAST this strong. Comes from
  // combat outcomes ("this killed my 团长" → rank ≥ 6).
  minRank: number | null;

  // Upper bound on rank from observed behavior. ("This piece moved 4 cells
  // along the rail in one turn without turning corners" → can move, so it's
  // mobile, so it isn't a mine or flag.)
  maxRank: number | null;

  // Hard exclusions — kinds this piece CANNOT be.
  excludedKinds: Set<PieceKind>;

  // Optional probability vector for fancier scoring.
  probKind?: Partial<Record<PieceKind, number>>;
}
```

### Update rules (sources of information)

The bot consumes each `MoveRecord` and updates beliefs:

1. **Plain move (no combat)** by an unknown piece:
   - Piece must be mobile → exclude `DILEI`, `JUNQI`.
   - If it traversed a rail corner → exclude every kind except `GONGBING`
     (or, if "any piece on rail" variant is on, just lower minRank by 1).
   - If it moved along a single rail in a straight line ≥ 2 cells → can
     slide, so excluded from immobile kinds (already covered above).

2. **Combat — attacker wins, defender removed**:
   - Attacker rank ≥ defender rank (or attacker is 工兵 and defender was 地雷).
   - If defender's kind became visible to the viewer (debug or both pieces
     reveal), update attacker's `minRank = max(minRank, defenderRank + 1)`.

3. **Combat — defender wins, attacker dies**:
   - Defender rank ≥ attacker rank, OR defender was 地雷 and attacker wasn't
     工兵, OR defender was 炸弹 (mutual).
   - In the "mine wins" case the defender is a mine — flag this cell as
     `kind == DILEI` confidently. (It's also possible the defender was a
     bomb if winner == 'tie'; the result.winner field distinguishes.)
   - When `result.winner === 'defender'` and the defender survived, the
     defender is at least one rank higher (or is a mine).

4. **Combat — tie (mutual destruction)**:
   - Both pieces removed. Strong inference path:
     - If either was a bomb: bomb identity confirmed; the other could be
       anything but is now dead.
     - If both ranked: same rank. Constrains the kind: both pieces were
       exactly `kind = N` for some rank N.

5. **Marshal death → flag reveal**:
   - When `flagRevealed[seat]` flips, we know which HQ holds the flag. Mark
     the other HQ's piece as `kind ≠ JUNQI` and the flag cell as
     `knownKind = JUNQI`.

6. **Time-since-move heuristic** (lower priority):
   - A piece that has never moved in N turns is more likely to be a mine,
     flag, or bomb. Bias `probKind` toward immobile kinds proportional to N.

7. **Position priors**:
   - HQ cells → very high P(JUNQI) on one, P(DILEI) bias on the other.
   - Row 1–2 cells → elevated P(DILEI).
   - Row 6 cells → lowered P(ZHADAN).

### What the bot does with this

Two derived structures every turn:

- **`pieceValueAt(cellId)`**: expected value of attacking this cell —
  `Σ P(kind) × outcome_value(my_piece, kind)`.
- **`flagHypothesisFor(opponentSeat)`**: ranked list of cells that could
  hold their flag, weighted by remaining HQ candidates + mine clustering
  evidence. Drives the directional "push toward enemy flag" heuristic.

---

## Move scoring (replacing the 70/30 attack/empty split)

For each legal move, compute a weighted sum:

```
score = combatEV * w_combat
      + advanceValue * w_advance
      + safetyDelta * w_safety
      + revealCost * w_reveal
      + partnerCoord * w_coord       (2v2 only)
      + tempoBonus
```

Components:

- **`combatEV`** — expected gain/loss using the belief model. Attacking an
  unknown that's 70% likely 排长 and 30% likely 师长 is computed exactly.
- **`advanceValue`** — toward enemy flag candidates (positive) or away
  (negative). Manhattan distance on the cell graph, weighted by remaining
  enemy back-row uncertainty.
- **`safetyDelta`** — change in number of unknown enemies within striking
  distance of our flag or 司令. Pulling a piece back to defend is positive.
- **`revealCost`** — negative for the moving piece. `0.1 × pieceValue` for
  any move; `0.3 × pieceValue` for engineer rail corners; massive for any
  move that exposes 司令 to a known weaker piece.
- **`partnerCoord`** — in 2v2, positive for advancing into the front-line
  lane that's NOT being contested by the partner.
- **`tempoBonus`** — small constant per attack so the bot doesn't stand
  still in a stalemate.

Selection: pick from top-K (K=3 or 4) with a small softmax temperature so
the bot doesn't play perfectly identically every game.

---

## Tactics / strategies — implementation backlog

Ordered roughly by impact. Each item is independent so we can A/B test.

### A. Setup-time improvements (low effort, high impact)
1. **Cluster the back-row mines around the flag's specific HQ**, with one
   mine in column adjacent to the flag and two on row 1/2 sides.
2. **Bomb in the front-line column most likely to be probed first**. For
   2v2, this is opposite the partner — opponents will pressure your
   exposed side first.
3. **Engineer near a back-row mine** so we can clear our own back-row
   ambushes against accidental friendly-fire (shouldn't happen but
   defensive).
4. **司令 placed at row 3 or 4, column 3** (center of zone). Maximum
   mobility, far from front-line probes.
5. **Don't put 排长×3 in adjacent cells** — diversify so the opponent
   can't sweep three for free.

### B. Belief tracking (core inference layer)
6. Implement `PieceBelief` and `BotBeliefs` skeleton.
7. Wire belief updates from `MoveRecord[]` (the existing replay code shows
   we have everything we need).
8. Compute `pieceValueAt` and use it as a new `combatEV` weighting.

### C. Spatial reasoning
9. **Flag-hypothesis cells per opponent**: start with both HQs at 50/50,
   downweight any HQ that gets emptied (piece moved out → not the flag,
   because flag never moves).
10. **Advance scoring**: each piece gets a desired travel direction toward
    its target opponent's flag candidates.
11. **Safety scoring**: count "enemies that can reach our flag's HQ within
    K moves" — pull pieces back if K drops below threshold.

### D. Reveal-cost / piece economy
12. Compute `revealCost` per move; subtract from score.
13. Forbid 司令 from probing unknowns — only attack if `minRank(target) ≥ 7`.
14. Reserve 工兵 for known mines OR last-known-flag direction.

### E. 2v2 coordination
15. Each bot inspects the team partner's recent moves; bias own advance
    direction to the *other* opposing seat.
16. If partner's 司令 is dead (their flag is revealed), shift to defense of
    partner's HQ alongside own.

### F. Bomb baiting (user's idea)
17. **Probe with 团长/营长 in spots that look defended**. If the probe
    survives, we learn it's not a bomb; if it dies but the defender lives,
    we know it's a bomb (winner === 'tie' on the cell).
18. **Don't send 司令 into unknowns at the front** — bombs are nearly
    always there in human play; let lower-rank probes find them first.

### G. Endgame
19. Track remaining enemy engineers; if both are dead, our mines are
    permanent → push more aggressively because we can't get blocked.
20. Track our own engineers; if both are dead, don't approach unknown back-row
    pieces (they could be mines, no recourse).

---

## Open design questions

1. **Where does the bot live?** Currently `server/src/bot.ts`. Should it
   move into `shared/` so we can test it deterministically? Yes — easier
   for unit tests and replay-driven evaluation.
2. **Do we keep `botSpeed` controlling decision time as well as delay?**
   Right now speed is purely artificial UI delay. We could give the bot a
   "decision budget" if we add MCTS later.
3. **Should we expose belief state in debug mode?** A "What does Bot-N
   think Bot-E's piece at C-1-1 is?" overlay would be a great dev tool.
4. **Evaluation harness**: we need a deterministic way to play bot-vs-bot
   matches and tally win/loss. The replay encoder already gives us
   reproducible games; building a CLI that runs N matches between two
   bot versions is small and high-leverage.

---

## Phased rollout — proposal

| Phase | Scope | Acceptance |
|---|---|---|
| **P0** | Lift the omniscient peek: bot consumes `PlayerView`, not `GameState`. Move bot into `shared/` for testability. | Bot still plays (same heuristic, just fog'd) and tests pass. |
| **P1** | Implement `BotBeliefs` skeleton + update from `MoveRecord`. Wire `pieceValueAt` into combat scoring. | Bot does better than v1 in bot-vs-bot from same setup (run 100 matches, expect ≥ 55% win rate). |
| **P2** | Setup heuristics A.1–A.5. Spatial reasoning C.9–C.11. | ≥ 60% vs P1. |
| **P3** | Reveal cost (D), bomb baiting (F), endgame (G). | ≥ 65% vs P2. |
| **P4** | 2v2 coordination (E). | Hard to measure individually — qualitatively, partner doesn't compete with self for same targets. |

Evaluation harness needs to exist by end of P0 so we can score the
subsequent phases.

---

## What's done so far

### P0 (complete) — bot infrastructure

- **Bot moved to `shared/src/bot/`** with versioned registry.
  - `types.ts`: `Bot`, `BotMoveContext`, `BotSetupContext`, `PickedMove`.
  - `legal.ts`: `viewMoveContext(view)`, `legalMovesForBot(view, seat)`,
    `botRng(seed)` — all driven by a `PlayerView`, never `GameState`.
  - `v0.ts`: frozen baseline (rank-4 prior for unknowns).
  - `v1.ts`: belief-based; see `belief.ts`.
  - `index.ts`: `BOTS` registry, `botByName(...)`, `LATEST_BOT` (currently v1).
- **Server delegates to shared bot.** `server/src/bot.ts` builds a
  `PlayerView` for the bot's seat and calls `LATEST_BOT.pickMove`.
  `room.ts` calls `LATEST_BOT.pickSetup` for bot seat setups.
- **Eval harness**: `pnpm bot-eval --teamA <name> --teamB <name> --games N
  --mode 2v2 --seed S`. Reports per-team win rates, avg game length, avg
  pieces remaining, and end-reason breakdown.

### P1 (complete) — belief model + v1 bot

- **`belief.ts`** — `computeBeliefs(view, viewerSeat)` builds a `Map<pieceId,
  PieceBelief>` by walking `view.moveHistory`. For each combat with a
  survivor, the survivor's kind is recorded in a cell→kind map; for plain
  moves, the destination cell is flagged as `hasMoved`. The final
  `estimateRank()` combines known kind + position + mobility into a single
  number.
- **`v1.ts`** — uses `estimatedRank` in `scoreAttack`. Adds two reluctance
  multipliers: 司令×0.2 and 军长×0.5 against unknowns on the front line.
- **Game-log encoding now includes resigns.** `applyResign` appends a
  `ResignEntry` to `moveHistory`; the replay encoding has `R|<seat>` lines
  alongside `M|<seat>|<from>|<to>` lines.

### P4 (in progress) — v4 strength campaign (goal: >90% vs v3.1-spatial)

All vs v3.1-spatial, 48 games (24 per orientation) via `bot-eval-par`:

| Variant | Config delta | Net win vs v3.1 |
|---|---|---|
| v4-replymin | S=24 d=4, reply-min k3 ·0.7, D7 graph distances, D5 clock, I2 trade, D6 camps, C1 roster beliefs | 68.8% |
| v4.1-info | + H1 info-value W=60, I3 urgency | 62.5% |
| v4.1-i25-s44 | info W=25, S=44 | 66.7% |
| v4-s44 | S=44 (compute parity: v4 d4 ≈ ½ v3.1 cost/move) | 72.9% |
| **v4-greedy** | + greedy-ε playouts (ε=0.7) | **85.4%** |
| v4-safe | + avoid-hanging playout term | 83.3% |
| v4-greedy85 | greedy-ε 0.85 | 77.1% (too greedy — playout diversity lost) |
| v4-greedy-d6 | greedy + depth 6 | 70.8% (depth STILL doesn't pay with low-noise playouts) |
| v4-greedy-s60 | greedy + S=60 | 75.0% (sample returns flatten past ~44) |
| v4-ucb | B1 UCB root bandit instead of racing | 18.8% (REJECTED — see IDEAS.md B1) |
| v4-greedy-adv | + advance bias in quiet playout moves | 64.6% (over-aggressive playouts) |
| v4-greedy-crn | + B2 common random numbers | 75.0% |
| v4-greedy-k4 | reply-min k=4, blend 0.85 | 66.7% (more pessimism hurts) |
| v4-greedy-setup | + E3 setup-time MC (10 candidates × 4 worlds) | 66.7% |
| v4-stack | greedy + avoidHanging + CRN combined | 62.5% (stacking ≠ adding) |
| **v4-greedy (capture-first argmax)** | greedy argmax fixed to take winning captures over shuffling heavies | **80.2% pooled over 96 games** (72.9% + 87.5% in 48-game halves) |

| v4-noreply | greedy WITHOUT reply-min (S=64) | 68.8% (reply-min earns ~11 pts; keep) |
| v4-lite-eval | greedy WITHOUT clock/trade/camp eval terms | 68.8% (the eval extras earn ~11 pts; keep) |
| v4-flagurgent | ×3 flag offense/defense once a flag is revealed (loss-forensics fix) | 62.5% (over-weights the race at material's expense; soften before retrying) |
| v4-deepreply | reply-min over BOTH opponents (k=2, k2=2) | 74.0% pooled/96 (81.3% then 66.7% — didn't replicate; k 3→2 loses more than k2 gains) |
| v4-widescreen | 12-sample opening screen when branching > 50 | 66.7% (opening bleed is decision quality, not screen noise) |
| v4-big | S=88 capture-first (~566ms, 2× budget) | 77.1% (flat MC saturates ~80% REGARDLESS of compute) |
| v5-ismcts | full ISMCTS (shared tree, subset-UCB, 1500 iters) | 22.9% (REJECTED — node aliasing: combat vs an unknown piece leads to incomparable states across determinizations, so shared node stats mix worlds exactly like the root bandit did) |

**The escalation ladder is now fully measured**: racing flat MC (80.2%) ≫
UCB root bandit (18.8%) ≈ ISMCTS (22.9%). In fog combat games where a single
move's outcome swings on the sampled identity of the defender, paired-world
flat MC with exact near-root enumeration is structurally superior to
UCB-style trees — determinization aliasing poisons any statistic shared
across worlds below the root. The residual ~20% loss rate persists across
2× compute (v4-big), so it is substantially world/setup variance under
near-mirror play, not search error.

Loss forensics (6 losses, seed block 12400, `bot-loss-analysis.ts`):
two recurring patterns — (a) our flag falls 2–10 turns after our marshal's
death reveals it (defense doesn't escalate on reveal), (b) 4/6 losses were
already 300–400 material down by turn 50 (opening bleed). Pattern (a)'s
naive fix (×3 urgency) regressed; the opening-bleed pattern (b) is unsolved
and is the most promising target for the next campaign.

Statistical reality check: 48-game evals have ±13-pt CIs; the family of greedy
variants all sit in the 62–88% band, and single-batch "wins" (like the original
85.4%) don't replicate reliably. Only ≥96-game pooled numbers are quoted as
real in the final acceptance.

**Outcome (2026-06-12): `v4.2-greedy` ships as LATEST_BOT.**
Final config: S=44, d=4, racing, reply-min k3 blend 0.7, capture-first
greedy-ε playouts (ε=0.7), full V4_SPATIAL. **80.2% net vs v3.1-spatial over
96 pooled games** (~245 Elo), at ~310 ms/move vs v3.1's ~368 ms. The >90%
campaign target was NOT reached: roughly 15 distinct levers were implemented
and measured (table above); both ablations confirm the champion config is a
local optimum of this search family. Per the escalation ladder, the remaining
sanctioned step beyond flat-MC knobs is a true tree search / ISMCTS — deferred.
Loss forensics (see `scripts/bot-loss-analysis.ts`) is the data-driven path to
the next +10 points.

Findings so far:

- **Playout noise was the bottleneck**, exactly as the depth experiment
  implied: greedy-ε playouts (+12.5 pts) beat every search-feature gain.
- **H1 information value costs self-play strength** (−6 pts): v3.1 doesn't
  punish info-ignorance the way humans do, so probes just spend material in
  this eval. Same category as v3.1's human-strategic refinements — worth
  keeping for human play, off the strength line. The model lives in
  `infovalue.ts`: per-piece price `w_unknown × 1/(1+graphDist to likely
  flag)`, credited once per piece on the first rollout combat involving one
  of our pieces (the only combats fog reveals to us). This implements the
  long-deferred bomb-baiting idea.
- **B1 UCB root bandit** implemented (`MonteCarloOptions.ucb`) — pulls go to
  `mean + bias + c·sqrt(ln N / n)`, worlds rotate every 8 pulls, values
  clipped ±2500 so win sentinels don't kill exploration. Measurement pending.
- I3 dead-partner urgency shipped in evaluation (`downPlayerUrgency`): trade
  policy sign flips and flag-advance ×1.5 when playing 1v2.

Pending: greedy-ε 0.85 / UCB / depth-6-greedy variants, final config pick,
high-N ≥90% acceptance run.

### P3.1 (complete) — v3.1 spatial bot

v3-mc plus the v3 backlog heuristics, all built on the shared MC core (`mc.ts`,
which v3-mc and v3.1 both call — v3-mc with defaults, v3.1 with options):

- **Flag-hypothesis offense** (`flaghypothesis.ts`): ranks an opponent's flag
  candidates (their 2 HQs, minus any HQ that's gone empty — the flag never
  leaves, so an empty HQ never held it; revealed flags are pinned exactly).
- **Spatial evaluation** (`evaluate.ts` + `V31_SPATIAL`): `evaluateRollout`
  gains a flag-proximity reward (our nearest piece to each enemy flag) and an
  own-flag safety penalty (nearest enemy to our flag). Inside the concrete
  sampled rollout world the flag cells are known, so averaging across samples
  gives the right expected proximity. v3-mc passes no spatial weights, so its
  evaluation is unchanged.
- **Partner coordination** (2v2): a root-move bias that presses the opponent
  the partner is NOT already near, so the two bots split the map.
- **Bomb placement bias**: `pickSetup` nudges one bomb into the flag's column
  (rows 3–4) so an attacker breaking toward the flag is likelier to hit it.

v3.1 also ships four human-strategic refinements requested separately:

- **Don't reveal engineers casually** (`engineerBias`): an engineer-only move —
  one a non-engineer couldn't make, i.e. a rail corner-turn, detected via
  `isEngineerOnlyMove` — gets a small penalty *unless* it's probing a suspected
  mine. A revealed engineer is a free intel gift to a human opponent.
- **Use engineers to probe suspected mines** (`engineerBias`): bonus for an
  engineer stepping onto a cell with `mineConfidence > 0`.
- **Don't attack observed-stronger pieces** (`observedLosingAttackPenalty`):
  soft penalty for attacking a piece whose observed `minRank > my rank`. Bombs
  are excluded automatically (a bomb never survives combat, so never carries a
  minRank). A *penalty* not a hard prune, so the rollout keeps the option when a
  sacrifice/path-clear is worth it.
- **Reduced strong-piece bias**: `STRONG_MOVE_BIAS` 1.5 → 1.3.

**Measured results (vs v3-mc, 6 games per orientation):**

The spatial features alone (flag offense/defense + partner coordination, before
the four refinements) measured **66.7%** (seed 7000) and **83.3%** (seed 7100)
— a clear ~75% net win over v3-mc.

Adding the four human-strategic refinements brought seed-7000 back to **50.0%**
(parity). At N=6 the swing from 66.7%→50.0% is within the noise band (a single
game is ±17%), but the refinements clearly cost a little raw self-play strength.
That trade is intentional and accepted: v3-mc, the self-play opponent, does not
exploit engineer-reveals or punish doomed attacks the way a *human* will, so the
refinements buy robustness against the actual opponent (humans) that the eval
harness can't score. v3.1 stays at least at parity with v3-mc in self-play AND
plays more soundly against people — so it ships as `LATEST_BOT`.

(MC-vs-MC games are slow — ~250–300 turns × 4 planning seats — which caps how
many we can run per session. Larger-N confirmation is future work.)

**Tests** (`flaghypothesis.test.ts` 3 + `bot_v3_1.test.ts` 5): flag-candidate
ranking (both HQs initially, empty HQ ruled out, `likelyFlagCell`), the reduced
1.3 strong-move bias + rank-less zero bias, valid 25-piece setup with the bomb
bias, and a pickMove smoke run.

### P3 (complete) — v3-mc bot with belief-sampled Monte Carlo

The first non-greedy bot. For each turn:

- Compute `PieceBelief` map from the (fog-filtered) view.
- For `S = 20` samples:
  - Build a concrete `GameState` via `sampleConcreteWorld(view, beliefs, seat, rng)` — see [Sampler — detailed algorithm](#sampler--detailed-algorithm).
  - For every legal root move (NOT top-K — see why-top-K-fails), apply it on the sampled world, then play out `D = 6` plies with `playOutFromSampled` (v2.1-style EV policy in the perfect-info sampled world).
  - Score the terminal state with `evaluateRollout` (material delta + Marshal-alive bonus + win/loss sentinels).
- Pick the move with the highest mean utility across samples.

If all `S` sampling attempts fail (very rare — would require contradictory beliefs), fall back to v2.1.

**Measured results (10 games per orientation):**

| Match | A wins | B wins | Draws | Avg turns | Pieces left A/B |
|---|---|---|---|---|---|
| v3-mc vs v2.1 (seed 5100) | **80.0%** | 10.0% | 10.0% | 208.1 | 20.2 / 13.9 |
| v2.1 vs v3-mc (seed 5200) | 0.0% | **90.0%** | 10.0% | 220.1 | 13.6 / 17.8 |

v3-mc wins ~85% vs v2.1 across both orientations. Avg pieces remaining ~18–20 for v3-mc vs ~13–14 for v2.1 — clean closeouts; the planner trades less and captures more efficiently. Game length ~210 turns (longer than v2.1 vs v2.1 ~185) — the planner avoids quick captures that have negative future value, taking more careful lines instead.

**Cost**: each turn samples 20 worlds × ~30–80 root moves × 6-ply rollouts ≈ 4–10 k ply-sims. On commodity hardware ~100–300 ms per move at the chosen budget. Acceptable for `normal` / `slow` botSpeed; for `fast` / `instant` the server should fall back to v2.1 explicitly (not yet wired — see open items).

**Tests** (`sampler.test.ts`, 8 new): determinism, every opponent piece gets a concrete kind, roster bounds respected (count ≤ ROSTER, sum = 25), setup-rule constraints (flag→HQ, mines→rows 1–2, bombs not row 6), viewer's own kinds preserved, rank lower bound honored across 25 samples, fresh game doesn't throw, `SampleInfeasibleError` is a typed Error.

### P2.1 (complete) — v2.1 bug fixes

User-observed bugs in v2 play:

1. **"Move 1 back" shuffle.** v2's 30% random empty-move share would
   sometimes pick a move that exactly reverses last turn's move by the
   same piece, creating a loop where the bot wastes turns shuffling.
2. **No safety after a strong piece dies.** A 师长 (rank 7) lost to a 司令
   (rank 9); v2 still attacked the survivor with multiple weaker pieces.
   The belief correctly set `minRank=7` but v2's linear `10 + myRank −
   theirRank` formula didn't deter weaker attackers enough.

`v2.1.ts` ships:

- **Anti-shuffle filter** — drop any candidate move where `(from, to)` is
  the exact reverse of `view.lastMoveBySeat[seat]`.
- **EV-based combat scoring** — `scoreAttackEV` uses a piece-value table
  (`values.ts`) plus the belief's `minRank` / `maxRank` to compute
  `P(win)·value(target) − P(lose)·value(myself) − P(tie)·blendedValue`.
  Weaker-vs-stronger attacks now score deeply negative.
- **Engineer valued at 100** (= 旅长, rank 6) reflecting its mine-clearing
  utility and the low engineer count in the roster.
- **Empty-move directional bias** — empty moves get a weight based on
  whether they move closer to the opponent centroid. Pure-random no-op
  movement penalty.
- **Attack share bump 70%→90%** when any attack weight ≥ 30. Stops the
  bot from declining strong attacks for random idle moves.

Results (30 games per orientation, deterministic seeds):

| Match | A wins | B wins | Avg pieces left A/B |
|---|---|---|---|
| v2.1 vs v2 (seed 1000) | **66.7%** | 33.3% | 15.0 / 12.7 |
| v2 vs v2.1 (seed 1100) | 30.0% | **70.0%** | 11.7 / 12.7 |

v2.1 wins ~68% across both orientations. Games end faster (179.8 turns
vs ~196) — the bot stops wasting tempos on shuffles.

### P2 (complete) — v2 bot with strict fog

- **F.A Strict fog of war.** `projectView` strips `combat.attackerKind` and
  `combat.defenderKind` from `moveHistory` for any viewer who wasn't a
  combatant. Engine emits a new `combat.defenderSeat` field so downstream
  derivations (captures panel, belief inference) can identify the loser
  seat without leaking ranks.
- **F.B/F.C Mine confidence + decay.** `belief.ts` rewritten to track
  per-cell `mineHits` (additive from observed failed attacks weighted by
  attacker rank: ≥7→+1.0, 5–6→+0.6, else +0.3) and `cleared` flag (set on
  any successful non-engineer move into the cell, dropping confidence to 0).
- **`v2.ts` move scoring.**
  - Engineer dispatch: cells with `mineConfidence > 0.4` get weight `30 +
    20 × confidence` when an engineer can reach them.
  - Non-engineer filter: cells with `mineConfidence > 0.4` are removed
    from the candidate list — even 司令 won't try to walk a probable mine.
  - Bomb offense: `myKind === 'ZHADAN'` → `30 + estimatedRank × 5`, ×3 vs
    known 司令, ×2 vs 军长 or HQ.
- **Captures panel rebuilt.** Shows the viewer's own losses grouped by
  killer seat. `whoIsDefender` stub and the broken `CapturesTray` dead
  code removed. The new `LossesPanel` reads `combat.defenderSeat` directly.
- **Tests**: 11 new (or rewritten) in `belief.test.ts` covering strict-fog
  inference rules, mine-confidence accumulation, and HQ flag-candidate
  position prior. **Total 103 passing**.

### Engine support already in place (no work needed)

- `MoveRecord[]` with combat metadata (`winner`, `attackerKind`,
  `defenderKind`) — feeds the future belief model directly.
- `flagRevealed` per seat — used for Marshal-death inference.
- `view.lastCombat` — the bot can see what just happened in the most
  recent combat involving its seat (combat-aware updates).

## What's next — v3+ work queue (v2 complete)

P0 + P1 + P2 complete (v2 wins ~70% net of seat order against v1). v2 backlog
items below have all been implemented; the remaining queue is now v3:

### Deferred from v2 — bomb placement bias

`smartValidSetup` currently puts both bombs in rows 3–4 uniformly random.
A small column-3 preference (the central probe lane) or a side-of-seat
preference might add a few percentage points. Punt until eval shows
setup-time wins matter (current move-time heuristics dominate the win rate).

### v3 plan

1. **Flag-hypothesis advance scoring** — per opponent, ranked list of cells
   that could hold their flag. Each move gets `advanceValue` based on
   distance to the most likely candidate. The HQ cell stays a candidate
   until a piece is observed moving OUT of it (flags never move).
2. **Safety scoring + 司令 protection** — counter of unknown enemies within
   K moves of own flag; pull pieces back if K drops below threshold.
3. **2v2 coordination** — partner-aware target selection. If partner is
   pressuring E, this bot pressures W.
4. **Bomb baiting** — explicitly probe high-density unknown clusters near
   the flag with mid-rank pieces.
5. **Multi-ply lookahead / planning** — see below.

### v3.5 — Multi-ply lookahead under imperfect information

All bot versions so far are *one-ply greedy* — they pick the best-scoring
move for THIS turn and ignore future consequences. That misses obvious
coordination plays:

- **Clearance moves**: moving a piece out of the way so my engineer (two
  cells back) has a clear path to a known mine next turn.
- **Setup attacks**: moving a piece toward a cell whose current occupant
  is bottled in, then attacking next turn when they have nowhere to flee.
- **Cover / defense moves**: pulling a strong piece back to threaten a
  cell my opponent's 司令 would have to step through.
- **Tempo trades**: accepting a small material loss now to expose a higher-
  value target next turn.

#### Why top-K filtering breaks all of these

The obvious approach is "for each of the top-K candidates by static score,
search a few plies, pick the best." It fails on exactly the moves we
care about. A clearance move (e.g. "step my 排长 sideways to vacate
column 3 for my engineer") has NEAR-ZERO static value — it doesn't
capture, it doesn't threaten, it's effectively a no-op according to
v2's `scoreAttack`. It will not appear in any top-K list. The very class
of moves we want planning to discover is the class top-K filtering
eliminates first.

So v3.5 starts from belief-sampled Monte Carlo with **every legal move**
at the root, not top-K.

#### Approach — sampled Monte Carlo over all legal root moves

Pseudocode at the root:

```
beliefs = computeBeliefs(view, mySeat)
rootMoves = legalMovesForBot(view, mySeat)    // ALL of them (~30–80)
scoreSums   = Map<move, number>()
visitCounts = Map<move, number>()

for s in 1..S_SAMPLES:                        // S ≈ 20–40
  sampled = sampleConcreteWorld(beliefs)      // concrete kinds for unknowns
  for move in rootMoves:
    state'   = applyMove(sampled, mySeat, move.from, move.to)
    rollout  = playOutWithFastPolicy(state', maxDepth = D)
    scoreSums[move]   += evaluate(rollout)
    visitCounts[move] += 1

return argmax(move => scoreSums[move] / visitCounts[move])
```

Components:

- **`sampleConcreteWorld(beliefs)`** — for each opponent piece without
  `knownKind`, draw a kind from the prior conditioned on `excludedKinds`,
  `minRank`/`maxRank`, position priors, and remaining roster counts
  after subtracting known + dead pieces. This is the imperfect-info
  bit: every search runs in a different plausible world.
- **`playOutWithFastPolicy(state, D)`** — play D plies forward using v2's
  `scoreAttack` as the policy for every seat. Fast because v2 picks a
  move in microseconds. D ≈ 4–8.
- **`evaluate(rollout)`** — terminal-aware utility:
  - Game ended in our team's win: +large
  - Game ended in our team's loss: −large
  - Otherwise: material delta + flag-cell occupancy bonus + 司令-alive
    bonus + maybe a small `mineConfidence`-cleared bonus (we made progress
    even if we didn't capture).

**Why this works for setup moves**: the clearance move scores 0
statically but in the rollout, the *next* turn's engineer-into-mine play
scores high (via v2's `mineConfidence` reward path). The rollout result
attributes that future value back to the clearance move at the root.
Setup-and-payoff emerges from the simulation, not from the per-move
heuristic.

**Why this works for hidden info**: averaging across S sampled worlds
gives the bot a robust answer instead of betting on one specific opponent
configuration. If a back-row piece is a mine in 50% of samples and a 司令
in 50%, the move's evaluation honestly reflects that split.

#### Sampler — detailed algorithm

This is what `sampleConcreteWorld` actually does, per the design discussion.
The job: given the bot's fog-of-war view + the belief map, produce one
plausible perfect-info `GameState` by assigning a concrete `PieceKind` to
every opponent (and partner) piece whose kind the bot doesn't know.

**Hard constraints** the sampler must respect:

| Constraint | Source |
|---|---|
| Per-seat 25-piece roster totals | game rules |
| `belief.knownKind` (flag-reveal, etc.) | bot's view |
| `belief.minRank` / `belief.maxRank` | combat inference |
| `belief.excludedKinds` (hasMoved → not mine/flag) | observation |
| Flag must be in an HQ cell | setup rule |
| Mines only in back two rows of owner's zone | setup rule |
| Bombs not in front line (row 6) | setup rule |

**Soft constraints** (position-prior weight multipliers):

| Condition | Kind | Multiplier |
|---|---|---|
| `inBackRow && !hasMoved` | DILEI | ×3 |
| `inBackRow && !hasMoved` | JUNQI | ×2 |
| `hasMoved` | DILEI / JUNQI | (already in `excludedKinds`; no extra effect) |

Decisions baked in from the design discussion:
- **No `inHQ` position prior.** HQ pieces can't move, so the hard
  constraint (`JUNQI` only legal in HQ, plus the bot's knowledge of
  whether the HQ has had a piece move out) already nails it. Prior would
  be redundant.
- **No bomb-bonus for back-row+unmoved.** Bombs in rows 1–2 are unusual
  in human play; the prior would mislead.
- **Partner stays strict-fog.** In 2v2 the bot treats its partner's
  pieces identically to opponents' (unknown). No allied-visible variant.
- **No backtracking yet.** Greedy + tight-constraint-first + retry-seed
  on `SampleInfeasibleError`. Add backtracking if real games show
  pathological failure rates.

**Algorithm** (per non-viewer seat):

1. **Categorize pieces:**
   - **Known-alive**: `belief.knownKind !== null`. Lock the kind; subtract from pool.
   - **Unknown-alive**: collect for assignment.
   - **Known-dead** (from combats the bot was a party to): subtract kind from pool.
   - **Unknown-dead**: count `totalDeaths − knownDeaths`. These consume pool slots later but aren't returned.

2. **Build the per-seat pool:**
   ```
   pool[seat][kind] = ROSTER[kind] − (count of seat's known pieces of that kind, alive + dead)
   ```
   Where `ROSTER = { SILING: 1, JUNZHANG: 1, SHIZHANG: 2, LUZHANG: 2, TUANZHANG: 2, YINGZHANG: 2, LIANZHANG: 3, PAIZHANG: 3, GONGBING: 3, ZHADAN: 2, DILEI: 3, JUNQI: 1 }`. Total per seat = 25.

   Sanity check: `Σ pool[seat] = unknownAliveCount + unknownDeadCount`.

3. **Sort unknown-alive by valid-kind-set size (ascending).** Tightest constraints first prevents greedy failures where loose pieces "steal" the only valid kind from a constrained piece.

   `validKinds(belief, pool, cell)` = `{ kind ∈ pool with pool[kind] > 0 AND kind ∉ excludedKinds AND (minRank == null OR rank ≥ minRank OR rankless) AND (maxRank == null OR rank ≤ maxRank OR rankless) AND if kind === JUNQI: cell.type === 'HQ' AND if kind === DILEI: cell.row ≤ 2 AND if kind === ZHADAN: cell.row !== 6 }`.

4. **Greedy weighted assignment:**
   ```
   for piece in sorted unknownAlive:
     valid = validKinds(belief, pool, cell)
     if valid.empty: throw SampleInfeasibleError
     weights[kind] = pool[kind] × positionPrior(belief, kind)
     kind = weightedDraw(weights, rng)
     pool[kind] -= 1
     assignment[piece.id] = kind
   ```

5. **Consume remaining pool with unknown-dead.** Uniformly decrement until exhausted. These pieces aren't in the returned state.

6. **Build the GameState.** Mirror the view's structure (mode, teams, seats, turn, turnIndex, movesSinceCapture, flagRevealed, marshalDead, lastCombat, lastMoveBySeat, moveHistory) but with concrete kinds in `pieces` and an `knownToPlayers` that gives the bot full visibility within this sampled world. `phase: 'PLAYING'`. `result: null`.

**Failure handling.** `SampleInfeasibleError` thrown on tight pool. Caller retries with new seeds up to ~5 times, then falls back to v2.1's `pickMove`. Logged as a warning. Should be rare in practice — beliefs come from observed events so the real state always satisfies them; only ordering bad luck can trip greedy. Backtracking is the v3.1 cure if needed.

**Test plan** (`sampler.test.ts`):

1. Determinism: same view + seed → same `GameState`.
2. Roster respect: per opponent seat, assigned-kind counts ≤ roster counts; sum = 25.
3. Constraint respect: no piece with `minRank=5` assigned rank-2 排长; no `excludedKinds.has('DILEI')` piece assigned mine; no mine outside back two rows; no flag outside HQ.
4. Position-prior empirical: 1000 samples from a fixed view with one unknown back-row unmoved piece → DILEI assignment rate well above its uniform-pool share.
5. Failure path: deliberately impossible constraints → `SampleInfeasibleError`.
6. Full-roster consistency: count kinds across alive + dead assignments per seat; equals canonical roster minus known kinds.

#### Rollout policy notes

Each ply of `playOutWithFastPolicy` projects the current sampled-world state for the seat about to move, computes their beliefs, and runs v2.1's `pickMove`. In the sampled world all kinds are concrete, so each seat sees their own pieces correctly. Opponents in the rollout still respect strict fog — they don't know our (sampled) kinds either, but they see their own and can infer from past combats.

First-pass simplification (subject to eval results): opponents in the rollout act with v2.1's heuristic against the sampled world directly, without re-running `projectView` per ply. This biases toward stronger rollout opponents but is much cheaper. If eval shows the bias hurts (probably overestimates difficulty for us), we'll switch to per-ply projection.

#### Cost / budget

Each (sample × move × rollout) is one short sim. With ~50 moves × 30
samples × 6-ply rollouts ≈ 9000 ply-evaluations per turn. At v2's
microsecond-per-pick speed that's ~100–500 ms of compute. Acceptable for
`slow`/`normal` botSpeed. For `fast`/`instant`, the bot driver should
fall back to v2 directly (no lookahead). `bot-eval` gains a `--depth`
flag; live play reads the room's botSpeed.

#### Performance pass (task #52, 2026-06-11)

Measured with `pnpm -C shared bot-bench -- --bot v3.1-spatial --turns 8`
(fresh game, seed 1, S=20):

| Config | avg/turn | max/turn |
|---|---|---|
| Baseline (D=6, full `applyMove` per ply) | 481 ms | 754 ms |
| + `applyMoveForRollout` fast path (D=6) | 437 ms | 602 ms |
| + racing (screen 6 → keep top 25%, min 8) at **D=9** | **372 ms** | **417 ms** |

Two changes:

1. **`applyMoveForRollout`** (engine.ts) — rollout-only move application that
   skips legality re-validation (moves come from `legalMovesForTurn` /
   `legalMovesForBot`, so validation regenerated the whole legal-move set per
   ply for nothing), `knownToPlayers` copies, `moveHistory` array spreads
   (which grow linearly with game length), and `lastCombat`. Keeps combat /
   elimination / turn / win semantics and `lastMoveBySeat` (the rollout
   policy's anti-shuffle reads it). Used at rollout plies AND for root-move
   application in `mc.ts`.
2. **Racing (successive halving)** in `runMonteCarlo` — after 6 screening
   samples across every root move, only the top 25% (min 8) keep receiving
   the remaining 14 samples. The cut ranks by `mean + rootBias` so moves
   rescued by engineer-probe / partner-coordination biases can't be pruned
   on raw material mean. Freed budget funds **depth 6 → 9** at lower wall
   time. v3-mc keeps the unraced defaults (frozen baseline); v3.1 uses
   `RACING_MC`.

#### Depth-scaling experiment (task #53, 2026-06-11)

Question: do deeper rollouts give linear strength gains? Method: v3.1-config
variants at fixed S=12 with depth as the only variable, head-to-head against
the d9 anchor, 8 games per orientation (16 per pairing) via the parallel
harness (`bot-eval-par`, 8 workers, ~1 min per 8 games).

| Variant | vs d9 anchor (16 games) |
|---|---|
| **d3** | **68.8%** (5/8 + 6/8) |
| **d6** | 50.0% (5/8 + 3/8) |
| d9 (mirror) | ~50% by construction |
| **d12** | **31.3%** (3/8 + 2/8) |

**Answer: NO — the curve is monotone DECREASING.** Shallow rollouts win.
Interpretation: the fast playout policy is noisy; every extra simulated ply
injects more policy noise into the returned value, diluting the root move's
signal, while the static evaluation (material + spatial) judged *near* the
root is comparatively reliable. This is the classic weak-playout result from
the Go literature (strong static eval ≫ long weak rollouts).

Consequences applied immediately:
- v4 uses **depth 4** with the savings spent on more samples (S=24) and an
  **exact opponent ply** (reply-min) — precision near the root instead of
  noise far from it.
- The earlier "depth 9 > depth 6" conclusion from the racing pass was
  confounded: racing improved selection, not depth. Racing + d6 would likely
  have done as well; the win was the budget reallocation, not the plies.

#### Performance pass results

Net: **50% deeper rollouts, 23% faster average, 45% lower worst-case.**
Midgame decisions (bench `--warmup 60`) average only ~94 ms — the opening,
with full rosters and maximal branching, is the worst case.

Strength check: racing + depth-9 v3.1 beat v3-mc **75%** (seed 7300, N=4)
— up from parity in the pre-racing config; the extra depth more than repaid
the behavioral refinements' cost.

Guard rail: `rollout_fastpath.test.ts` plays 120 random legal plies through
`applyMove` and `applyMoveForRollout` in parallel and asserts identical
board contents, turn order, eliminations, marshal/flag flags, and results —
the fast path cannot silently drift from real game semantics.

Further ideas (UCB root sampling, opponent-reply minimization, parallel
eval, information-value evaluation) are tracked in [IDEAS.md](IDEAS.md).

#### Safe pruning (only where strictly dominated)

We can shave compute without breaking setup-move discovery: drop only
moves that are *strictly dominated*. Examples:

- A 司令 attacking a known DILEI (always loses).
- Any non-engineer move onto a cell with `mineConfidence > 0.4` (already
  filtered by v2's policy).
- Any move into a teammate's cell (already filtered by legality).

Never prune by static score — that's what loses the clearance moves.

#### Future upgrades

- **UCB-style tree expansion** (true MCTS): if flat MC is too noisy,
  upgrade to a tree where children are visited proportional to
  `mean + c × sqrt(log(N)/n)`. The tree explores promising sub-lines
  more often while still touching every move at least once. Natural
  next step if Option B plateaus.
- **Belief updates inside the rollout**: each simulated ply updates the
  inside-rollout belief based on the simulated combat outcome, so the
  bot models "what would I infer about the opponent after I play this?"
  Only if eval shows the static rollout is too brittle.
- **ISMCTS** (full information-set MCTS): bibliography-grade approach.
  Out of scope unless the above plateau.

#### Watch-outs

- **Determinism**: search must use the seeded `botRng`, not `Math.random`,
  or the eval harness becomes useless. Each (sample, move) pair gets its
  own sub-RNG so reruns are reproducible.
- **Belief immutability**: keep the real `PieceBelief` map immutable
  during search. Sampled worlds are throwaway state.
- **Skip the heuristic-top-K lookahead path** that was the original
  Option A. It can't see setup moves.

#### Phasing

1. Belief sampler + `playOutWithFastPolicy` skeleton + `evaluate`. Unit-
   test that `sampleConcreteWorld` produces only kind assignments
   respecting roster counts, `excludedKinds`, and rank bounds.
2. Wire into a new `v3-mc` bot. Acceptance: ≥ 55% vs v2 across both
   orientations at S=30, D=6.
3. If acceptance fails, try widening rollout depth and/or sample count.
   Then escalate to UCB tree (`v3.1-mcts`) if still below threshold.
