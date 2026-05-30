# TODO

- [x] A piece on a corner of a center should not impede on the curved highway (they are two different roads)
- [x] Dead pieces should not interfere with movement
- [ ] Saved setup layouts — designer screen + encoding + paste at match start (#39)
- [ ] "Back to lobby" button after a game ends, with server-side room reset (#40)
- [ ] Engineer animation follows multi-leg rail BFS path, not straight A→B (#41)

## Test inventory (82 passing)

All tests live under `shared/tests/` and run with `pnpm test`.

### `board.test.ts` — geometry (19 tests)
- 4 zones × 30 + 9 central cells = 129
- Each zone: 23 stations + 5 camps + 2 HQs
- HQs at row 1 cols 2 and 4
- Camps form the quincunx in rows 3–5 cols 2/3/4
- Rail-on/off classification for HQ, ring, inner, camp, center cells
- Central 3×3 cells: stoppable rail nodes
- Every orthogonal in-zone neighbor is a road
- Center camp has X-diagonals to the 4 corner camps
- **Every camp has 8-directional adjacency (#33)**
- **Center cell C-2-2 is transit-only (#34)**
- No road crosses between zones
- No road touches the central area
- Zone ring rail cells have rail neighbors on the ring
- Corner ring cell connects two ring directions
- N front line connects to center top row at cols 1, 3, 5 only
- S front line connects via 180°-rotated mapping
- Center 3×3 connects rook-neighbors with rail
- Non-rail cells have no rail neighbors
- `setupCellsForZone` returns 25 placeable cells per zone

### `setup.test.ts` — setup validation (7 tests)
- Random setup produces 25 placements covering all placeable cells
- Random setup passes validation for every zone × multiple seeds
- Deterministic given a seed
- Flag must be in an HQ
- Mine must be in rows 1–2
- Bomb cannot be in front line (row 6)
- Correct piece counts

### `moves.test.ts` — legal moves (26 tests)
- Road moves: single orthogonal step into empty cells
- Cannot move into a camp containing anyone
- Center camp diagonals work both ways
- Cannot stop on a teammate
- HQ immobility: piece in HQ has no legal moves
- Mines and flags have no legal moves
- Non-engineer rail: slides clear ring in one direction
- Non-engineer cannot turn the zone ring corner
- Non-engineer slides straight through center to opposite zone
- Non-engineer CAN stop in the center (perimeter cells)
- Non-engineer at front-line cols 2/4 cannot reach center
- Slide stops at first enemy (combat)
- Slide blocked by ally
- Engineer rail BFS turns corners on the ring
- Engineer reaches adjacent-zone front lines through curve corners
- Engineer can stop in 8 of 9 central cells (C-2-2 is transit-only)
- Cannot attack into an enemy-occupied camp
- Can enter an empty camp
- **Central-corner curves (5 tests, #26)**: W→C-1-1→N, N→C-1-3→E, S→C-3-1→W; curve blocks at ally on exit; curve stops at enemy on exit
- **Curve bypasses corner cell (3 tests, TODO #1)**: non-engineer slide curves around an enemy on C-1-1; curves around a teammate; engineer can reach across the curve when corner is blocked

### `combat.test.ts` — combat resolution (9 tests)
- Higher rank wins; lower rank loses; equal rank mutual destruction
- Engineer defuses mine; non-engineer dies to mine (mine stays)
- Attacking bomb / bomb attacking → mutual destruction
- Bomb vs mine → mutual destruction
- Any attacker captures the flag

### `engine.test.ts` — state machine (14 tests)
- `createGameState` + `submitSetup` transition to PLAYING when all four submit
- Rejects invalid layouts
- Move when it's not your turn → no legal moves
- Move into empty cell, turn advances, `movesSinceCapture` increments
- Higher-rank attacker wins, takes the cell, `lastCombat` populated
- Engineer defuses mine in `applyMove`
- Non-engineer dies to mine; mine stays
- Flag capture eliminates owner, turn skips them
- Killing Marshal triggers `flagRevealed` + `marshalDead`
- Bomb causes mutual destruction
- 2v2: when both team B flags fall, team A wins
- FFA: last seat standing wins via resignation chain
- **Dead pieces ignored by legal moves (TODO #2)**
- **Move onto a dead piece silently removes it, no combat (TODO #2)**

### `view.test.ts` — fog of war (4 tests)
- Owner sees own pieces; opponents do not
- Teammate pieces are hidden (strict v1 default)
- After Marshal death, the flag becomes visible to all
- On ENDED phase, everything is revealed

### `replay.test.ts` — replay encoding (3 tests)
- Encodes and decodes setups round-trip
- Round-trip preserves the move list and arrives at identical final state
- `setupsFromState` reads piece placements directly from state

## Project task ledger

All 24 tracked tasks completed. See the task tool's history for details. Summary:

| Phase | Items |
|---|---|
| v1 scaffolding | #15 |
| Initial iteration on rules + UX | #16, #17 |
| Engine refinements | #26, #33, #34, #38 (TODO.md) |
| Server features | #19, #23, #31, #37 |
| Client UI | #20, #21, #22, #24, #25, #27, #28, #29, #30, #32, #35, #36 |
| Replay system | #37 |
| Docs | #18 |
