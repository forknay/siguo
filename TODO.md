# TODO

- [x] A piece on a corner of a center should not impede on the curved highway (they are two different roads)
- [x] Dead pieces should not interfere with movement
- [x] Saved setup layouts — designer screen + encoding + paste at match start (#39)
- [x] "Back to lobby" button after a game ends, with server-side room reset (#40)
- [x] Engineer animation follows multi-leg rail BFS path, not straight A→B (#41)
- [x] Smarter bot piece placement — 排长/连长 in non-flag HQ + heavyweights in interior rows + mines clustered near flag (#42)

## Test inventory (89 passing)

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

### `setup.test.ts` — setup validation + smart bot setup (11 tests)
- Random setup produces 25 placements covering all placeable cells
- Random setup passes validation for every zone × multiple seeds
- Random setup is deterministic given a seed
- Flag must be in an HQ
- Mine must be in rows 1–2
- Bomb cannot be in front line (row 6)
- Correct piece counts
- **smartValidSetup (#42, 4 tests)**: produces a fully valid layout for every zone × multiple seeds; never places top-3 ranks on the HQ row; non-flag HQ holds 排长 or 连长 (never engineer / mine / heavyweight); deterministic given a seed

### `moves.test.ts` — legal moves + pathOfMove (29 tests)
- **pathOfMove (3 tests)**: road step returns [from, to]; single-direction rail slide enumerates intermediate cells through the center; engineer BFS multi-leg path through corners
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

All **28 tracked tasks completed** (#15–#42). The full list:

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
| 32 | ✓ | Animate moves along the actual rail/road path (non-engineer slide helper) |
| 33 | ✓ | Camps: 8-directional adjacency (diagonals from every camp, not just center) |
| 34 | ✓ | Central area: middle cell C(2,2) is transit-only (8 stoppable cells, not 9) |
| 35 | ✓ | Minimize/collapse button on the RankGuide |
| 36 | ✓ | Turn-indicator arrow pointing into the current player's zone |
| 37 | ✓ | Replay system: encoding scheme + step-through replay mode |
| 38 | ✓ | TODO.md follow-ups: curve bypasses corner cell + dead pieces don't interfere |
| 39 | ✓ | Saved setup layouts — designer screen + encoding + paste at match start |
| 40 | ✓ | Back-to-lobby button after game end |
| 41 | ✓ | Engineer animation follows multi-leg rail BFS path (not straight A→B) |
| 42 | ✓ | Smarter bot piece placement — avoid wasting strong pieces in the non-flag HQ |
