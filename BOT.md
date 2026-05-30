# Bot strategy + implementation plan

A fog-respecting heuristic player bot for Si Guo Jun Qi 2v2. No ML. Designed
to be improved incrementally so we can measure each change against the
current implementation by playing matches.

## Status

| Layer | State |
|---|---|
| Move selection | **v1-fog (baseline)** — fog-respecting weighted attacks, unknown enemies use rank-4 prior |
| Setup | `smartValidSetup` — mines clustered near flag, 排长/连长 in non-flag HQ, heavies in interior rows |
| Versioning infra | ✓ `shared/src/bot/` with `Bot` interface, registry, `botByName` |
| Eval harness | ✓ `pnpm bot-eval --teamA X --teamB Y --games N --mode 2v2 --seed N` |
| Belief model | **None yet** (P1) |
| Spatial goals | **None yet** — bot doesn't know where the enemy flag is (P2) |
| Defense | **None yet** — never pulls pieces back toward own flag (P2) |
| Reveal cost | **None yet** (P3) |
| 2v2 coordination | **None yet** (P4) |

### v1-fog baseline numbers (mirror match, 5-game smoke test, seed 0)

```
Team A (v1-fog) wins:  2 (40.0%)
Team B (v1-fog) wins:  3 (60.0%)
Avg game length:       192.4 turns
Avg pieces left A:     11.4
Avg pieces left B:     12.6
End reasons: flag-capture=5, stalemate=0, all-resigned=0, draw=0
```

Variance is high at N=5; we'll lock baseline win rate at N=100 once we have
v2 to compare against. Note B advantage is roughly within noise — seat
geometry (which team moves first in clockwise rotation given N is "first")
likely contributes. Larger samples will confirm.

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

### P0 (complete)

- **Bot moved to `shared/src/bot/`** with versioned registry.
  - `types.ts`: `Bot`, `BotMoveContext`, `BotSetupContext`, `PickedMove`.
  - `legal.ts`: `viewMoveContext(view)`, `legalMovesForBot(view, seat)`,
    `botRng(seed)` — all driven by a `PlayerView`, never `GameState`.
  - `v1.ts`: the fog-respecting baseline. Same weighted-attack heuristic as
    the old omniscient bot, but with `UNKNOWN_RANK_PRIOR = 4` for any
    enemy whose kind the view didn't reveal.
  - `index.ts`: `BOTS` registry, `botByName(...)`, `LATEST_BOT`.
- **Server delegates to shared bot.** `server/src/bot.ts` is now a thin
  driver that builds a `PlayerView` for the bot's seat and calls
  `LATEST_BOT.pickMove`. `room.ts` calls `LATEST_BOT.pickSetup` for bot
  seat setups.
- **Eval harness**: `pnpm bot-eval --teamA v1-fog --teamB v1-fog --games
  100 --mode 2v2 --seed 0`. Reports per-team win rates, avg game length,
  avg pieces remaining, and end-reason breakdown (flag-capture / stalemate
  / all-resigned / draw).

### Engine support already in place (no work needed)

- `MoveRecord[]` with combat metadata (`winner`, `attackerKind`,
  `defenderKind`) — feeds the future belief model directly.
- `flagRevealed` per seat — used for Marshal-death inference.
- `view.lastCombat` — the bot can see what just happened in the most
  recent combat involving its seat (combat-aware updates).

## What's next (concrete PR-sized chunks)

1. **`BotBeliefs` skeleton + tests.** (P1.a)
   - Define `PieceBelief` per the design above.
   - Drive belief updates from a `MoveRecord[]` sequence in unit tests
     (synthetic histories, assert `minRank` / `maxRank` / `excludedKinds`).
   - No move-scoring change yet; just the inference engine.
2. **Plug beliefs into v2 bot move scoring.** (P1.b)
   - Replace `UNKNOWN_RANK_PRIOR` with `expectedRank(target)` derived from
     the piece's `PieceBelief`.
   - Add `pieceValueAt(cellId)` computing EV against the bot's piece.
   - Run `pnpm bot-eval --teamA v1-fog --teamB v2 --games 100` and expect
     v2 ≥ 55%.
3. **Flag-hypothesis + advance scoring.** (P2.a)
   - Per opponent: ranked list of possible flag cells (HQs minus emptied
     ones).
   - Each move gets an `advanceValue` based on distance to the most likely
     enemy flag.
4. **Safety scoring + 司令 protection.** (P2.b)
   - Counter of unknown enemies within K moves of own flag.
   - Hard rule: 司令 doesn't probe unknowns at the front line.

Acceptance for each: rerun bot-eval at N≥100 vs the prior version; check
win-rate delta and qualitative sanity (game length, pieces remaining,
end-reason distribution).
