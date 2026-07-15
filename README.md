# siguo — 四国军棋

Local-network playable digital version of **Si Guo Jun Qi** (Si Guo Da Zhan / 四国大战), the 4-player Chinese variant of Lu Zhan Jun Qi (Stratego cousin). Host on one machine; everyone else joins via a browser on the same Wi-Fi. Bots fill empty seats so 1–4 humans can play.

> si guo jun qi for my dad

## Highlights

- **4-player game**, fully playable: 2v2 teams **and** free-for-all.
- **Canonical rule set**: HQ immobility, engineers-only railroad corners through the corner cells (with curved bypass at the four 九宫 corners), mines stay after non-engineer trigger, bombs cause mutual destruction, Marshal-death triggers flag-reveal, 70-move stalemate, all 5 camps 8-directional, central cell `C-2-2` is transit-only.
- **Strict fog of war**. Server-authoritative state. Opponents' ranks never appear in your wire payload; combat reveals only the outcome.
- **Belief-sampled Monte Carlo bot** (`v4.2-greedy`, the current `LATEST_BOT`) — imagines ~44 plausible hidden boards per turn, searches each with reply-minimization + low-noise greedy playouts, and plays the best average move. ~80% vs the prior champion. To understand or improve it, read [`BOT_DEV_GUIDE.md`](BOT_DEV_GUIDE.md) (step-by-step tutorial + roadmap); the lab notebook is [BOT.md](BOT.md) and the idea backlog is [IDEAS.md](IDEAS.md).
- **Layout designer** — craft a 25-piece opening, copy as a text encoding, paste into real-game setup. Persists recents in `localStorage`.
- **Replay system** — every game produces a shareable text encoding; paste into the **Watch replay** tab on the landing screen to step through with Prev/Next, autoplay, and per-seat viewing perspective.
- **LAN-friendly hosting** — server prints detected LAN URLs; lobby shows a 4-char room code.

## Tech stack

- pnpm workspaces — `shared/` (engine + bots), `server/` (Node + Socket.IO), `client/` (React + Vite + SVG).
- TypeScript end-to-end, Zod for wire validation, Vitest for engine + bot tests.

## Running it

```sh
# one-time setup
corepack enable pnpm
pnpm install

# dev (server + client in parallel)
pnpm dev
```

- Server listens on `:3000` (Express + Socket.IO).
- Client dev server runs on `:5173` (Vite, proxies `/socket.io` and `/api` to the server).
- Open `http://localhost:5173/` to play locally with bots.

### Hosting on your LAN

`pnpm dev` actually starts **two** servers:

- the API/socket server on `:3000`, which serves whatever is in `client/dist/` (the last `pnpm build`)
- the Vite dev server on `:5173`, which serves your current source with hot reload

So during development:

- **Share the `:5173` URL** (`http://<your-lan-ip>:5173`) — friends see your live edits with no rebuild step. Vite is bound to `0.0.0.0` and proxies sockets back to the API server.
- **Share the `:3000` URL** — friends see whatever was in `client/dist/` at the last `pnpm build`. If you make changes, run `pnpm build` again and tell them to hard-refresh.

For "production-style" hosting (single port, no dev server overhead):

```sh
pnpm build      # typecheck and build the client into client/dist
pnpm start      # server serves the built client at :3000
```

On boot the server prints all detected LAN URLs, e.g.:

```
siguo server listening on http://0.0.0.0:3000
  LAN: http://192.168.1.42:3000
```

Anyone on the same Wi-Fi can open the URL and join the room with the 4-character code shown in the lobby.

## Game features

### Layout designer

The **Layout designer** tab on the landing screen lets you craft a personal 25-piece opening without a network connection. The view zooms to a single zone. Click-to-place, drag-and-drop pieces, validate constraints in real time. When complete, click **Copy encoding** to put the layout text on your clipboard, or **Save to this browser** to keep up to 12 named layouts in `localStorage`.

In a real game's Setup screen, open the "Paste a saved layout" details block and drop in the encoding. The engine validates it against the seat's normal constraints (flag in HQ, mines in rows 1–2, bombs not in row 6) before applying.

### Replays

Click **Generate replay code** in the side panel after a game ends. The server returns a compact text encoding of the full game (mode, all 4 setups, every move + resignation). Copy it; share it anywhere; recipients paste it into the **Watch replay** tab on the landing screen.

The replay UI has Prev / Next / Start / End buttons, a Play / Pause autoplay button (default 500 ms/move, matching the bot's `normal` speed), a scrub bar, and a "View as N/E/S/W" toggle so you can rewatch the same game from any seat's perspective. Replays render all pieces visible — even ones the original players never learned.

### Debug mode

Append `?debug=1` to the URL when creating or joining a room (e.g. `http://localhost:5173/?debug=1`). Your client will see every opponent's piece ranks and the combat reveal modal will show the kinds of both combatants. Without the flag, opponent pieces stay face-down and combat shows only the outcome.

### Side-panel features (in-game)

- **Turn indicator** chevrons just outside each zone; only the current player's is lit.
- **Last-move highlight** rings around each seat's most-recent move (dashed source, solid destination), color-coded by seat.
- **Your losses** panel — pieces YOU have lost, grouped by the killer seat. Under strict fog this is one of the few statistics the viewer is legitimately allowed to know.
- **Recent moves** monospace log of the last ~10 moves with seat-colored prefixes. Resignations show as `<seat> resigned` in red.
- **Review history** — Prev / Next / Start / Now buttons + a scrub bar to step backward through the game mid-match. The board dims and goes read-only while reviewing, and snaps back to the present automatically the moment a new move arrives. Each step shows a fog-correct past view (the client replays cached server views, so nothing hidden is leaked).
- **Bot speed** picker (lobby, host-only) — slow / normal / fast / instant.
- **Resign** and **Offer draw** buttons.
- **Back to lobby** (after game-over) — resets the room while keeping seats.
- **Chat panel** — embedded in both lobby and play screens.

### Rule-spec quick reference

Each player has 25 pieces:

- **司令 (Marshal, rank 9)** ×1, **军长 (General, 8)** ×1, **师长 (Major Gen, 7)** ×2, **旅长 (Brigadier, 6)** ×2, **团长 (Colonel, 5)** ×2, **营长 (Major, 4)** ×2, **连长 (Captain, 3)** ×3, **排长 (Lieutenant, 2)** ×3 — ranked soldiers (higher rank wins; equal-rank = mutual destruction).
- **工兵 (Engineer, rank 1)** ×3 — defuses mines (only piece that can), can turn corners on railroads.
- **炸弹 (Bomb)** ×2 — mutual destruction with whatever it touches.
- **地雷 (Mine)** ×3 — immobile, kills any attacker except the engineer.
- **军旗 (Flag)** ×1 — immobile, must live in one of the two HQs. Capture = elimination.

Movement: one step along a road, or slide along a railroad to the first occupied cell. Non-engineers cannot turn 90° corners on the rail — except the four central-corner cells where the rail visually curves (W↔N, N↔E, S↔W, S↔E corner connections are passable by all pieces, even with someone sitting on the corner cell). The 3×3 central rail grid (九宫) is reachable from cols 1, 3, 5 of each zone's front line; 8 of its cells are stoppable; the very center (`C-2-2`) is transit-only.

Combat reveals only the outcome. The two combatants don't learn each other's piece kind. Use debug mode if you want to verify rules during testing.

In 2v2, partners sit opposite each other (N+S vs E+W). The game ends when both opposing flags are captured. In free-for-all, the last flag standing wins. 70 moves without a capture → stalemate draw.

For the full rules reference used to drive the engine, see [the rules spec](../.claude/plans/research-the-rules-and-refactored-catmull-agent-ab7df9e1861611521.md).

## Bots

The current default bot is **v3.1-spatial** (latest of six versions kept in the registry for measurement). It plays under strict fog of war using belief-sampled Monte Carlo: for each move it draws ~20 plausible concrete worlds from its belief map, evaluates every legal move via a 6-ply rollout, and picks the highest mean utility. On top of the base planner (v3-mc) it adds flag-hypothesis offense (head toward the enemy flag), own-flag safety (defend our HQ), 2v2 partner coordination (split the map), and a flag-column bomb placement. v3.1 wins ~75% vs v3-mc, which itself wins ~85% vs v2.1.

Prior versions (v0–v2.1) are kept in the registry for evaluation comparisons. v2.1 specifically still plays under strict fog of war with these heuristics:

- A per-piece **belief tracker** that walks `view.moveHistory` and derives rank bounds + mine-confidence scores from combat outcomes.
- **Anti-shuffle**: never picks a move that exactly reverses its previous move with the same piece.
- **EV-based combat scoring**: weight = `P(win)·value(target) − P(lose)·value(self) − P(tie)·blend`, using a piece-value table where engineer is valued at 100 (= 旅长 rank 6, because mine-clearing utility is scarce).
- **Mine-confidence filtering**: non-engineer moves into cells with `mineConfidence > 0.4` are removed from the candidate list entirely. Engineers preferentially target those cells.
- **Bomb offense**: bombs score `30 + estimatedRank × 5`, ×3 vs known 司令, ×2 vs known 军长 or HQ.
- **Empty-move directional bias**: empty moves are weighted toward the opponent centroid.
- **Setup**: smart layout placement (mines clustered near flag, 排长/连长 sacrificed in non-flag HQ, 司令/军长/师长 in interior rows 3–5).

Measured win rates: v3-mc wins **~85% vs v2.1** across orientations; v2.1 wins ~68% vs v2 and ~75% vs v0-baseline.

See [BOT.md](BOT.md) for the full design notes, version-by-version diff, and the v3 roadmap (belief-state Monte Carlo planning).

### Running the bot eval

```sh
pnpm bot-eval -- --teamA v2.1-fixes --teamB v2-fog --games 30 --mode 2v2 --seed 0
# parallel (shards across CPU cores, identical results for a given base seed):
pnpm -C shared bot-eval-par -- --teamA v4-replymin --teamB v3.1-spatial --games 32 --seed 0 --workers 8
# decision-latency benchmark (opening; add --warmup 60 for midgame):
pnpm -C shared bot-bench -- --bot v4-replymin --turns 8
```

Reports per-team win rates, average game length, pieces remaining per team, and end-reason breakdown (flag-capture / stalemate / all-resigned / draw).

## Running the tests

```sh
pnpm test           # runs the full Vitest engine + bot suite (127 tests)
pnpm -C shared test
```

Test files live in `shared/tests/`:
- `board.test.ts` (19) — geometry, rail/road edges, camps, central area
- `setup.test.ts` (11) — placement validation + smart setup
- `moves.test.ts` (31) — road/rail, corner rules, curve bypasses, pathOfMove, dead-piece transparency
- `combat.test.ts` (9) — combat resolution table
- `engine.test.ts` (14) — reducer / turn flow / win conditions / dead pieces
- `view.test.ts` (4) — fog-of-war projection
- `replay.test.ts` (6) — replay encoding round-trip + resign entries
- `belief.test.ts` (11) — bot belief tracking + strict-fog inference + mine confidence
- `bot_v2_1.test.ts` (5) — piece values + v2.1 sanity
- `sampler.test.ts` (8) — v3-mc belief sampler: determinism, roster bounds, setup-rule constraints, rank-bound respect
- `flaghypothesis.test.ts` (3) — v3.1 flag-candidate ranking
- `bot_v3_1.test.ts` (5) — reduced strong-move bias + v3.1 setup/move smoke
- `rollout_fastpath.test.ts` (1) — `applyMoveForRollout` ≡ `applyMove` over 120 random plies

## Project structure

```
shared/   pure rule engine + bots (no I/O)
  board.ts        cell + edge graph
  pieces.ts       piece roster
  setup.ts        validation + random + smart layout
  moves.ts        legal-move generator (road + rail with corner curve rule + dead-piece transparency)
  combat.ts       combat resolution table
  engine.ts       reducer + GameState + MoveRecord (move | resign discriminated)
  view.ts         strict-fog projection per viewer
  protocol.ts     Zod schemas for every wire message
  replay.ts       game-text encoding / decoding
  bot/
    types.ts      Bot interface
    legal.ts      view-based MoveContext + legalMovesForBot
    belief.ts     per-piece belief tracking (rank bounds + mineConfidence)
    values.ts     piece-value table (engineer=100)
    v0.ts         baseline (frozen for eval)
    v1.ts         + belief-aware scoring
    v2.ts         + strict fog + mine confidence + bomb offense
    v2_1.ts       + anti-shuffle + EV scoring
    sampler.ts    belief sampler (view → concrete GameState)
    rollout.ts    v2.1-style fast policy on concrete GameState
    evaluate.ts   terminal-aware utility (material + flag offense/defense)
    flaghypothesis.ts  rank an opponent's flag cells
    mc.ts         shared belief-sampled Monte Carlo core
    v3_mc.ts      base Monte Carlo (frozen for measurement)
    v3_1.ts       + flag offense/defense + partner coord (current default)
    index.ts      registry, LATEST_BOT
  scripts/
    bot-eval.ts   bot-vs-bot eval harness
server/   Express + Socket.IO authoritative state
  server.ts       socket handlers
  room.ts         lobby + game state machine
  bot.ts          bot driver (calls LATEST_BOT.pickMove/pickSetup)
  net.ts          LAN IP detection
client/   React + Vite + SVG
  screens/        Landing, Lobby, Setup, Play, Designer, Replay
  components/     Board, Piece, CombatReveal, PieceInspector, RankGuide, ChatPanel
  state.ts        Zustand store + socket wiring
  clipboard.ts    secure-context-aware copy helper
```

## Related docs

- [BOT_DEV_GUIDE.md](BOT_DEV_GUIDE.md) — **start here to understand or improve the bot**: step-by-step architecture, concepts, version lineage, experiment methodology, lessons, and roadmap
- [BOT.md](BOT.md) — bot design + strategy research + version-by-version diff + eval results (the chronological lab notebook)
- [IDEAS.md](IDEAS.md) — improvement brainstorm (search perf/quality, beliefs, eval, setup, tooling)
- [TODO.md](TODO.md) — feature backlog + test inventory + completed-task history
