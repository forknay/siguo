# siguo — 四国军棋

Local-network playable digital version of **Si Guo Jun Qi** (Si Guo Da Zhan / 四国大战), the 4-player Chinese variant of Lu Zhan Jun Qi (Stratego cousin). Host on one machine; everyone else joins via a browser on the same Wi-Fi. Bots fill empty seats so 1–4 humans can play.

> si guo jun qi for my dad

## What's in v1

- 4-player game, fully playable: 2v2 teams **and** free-for-all.
- Canonical rule set: HQ immobility, engineers-only railroad corners, mines stay after non-engineer trigger, bombs cause mutual destruction, Marshal-death triggers flag-reveal, 70-move stalemate counter.
- Server-authoritative state with per-player fog-of-war — opponents' ranks never appear in your wire payload.
- Random-move bot can fill any empty seat (random valid setup + random legal moves).
- LAN URL displayed on the host lobby for easy joining.

## Tech stack

- pnpm workspaces — `shared/` (engine), `server/` (Node + Socket.IO), `client/` (React + Vite + SVG).
- TypeScript end-to-end; Zod for wire validation; Vitest for engine tests.

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

```sh
pnpm build      # typecheck and build the client into client/dist
pnpm start      # server serves the built client at :3000
```

On boot the server prints all detected LAN URLs, e.g.:

```
siguo server listening on http://0.0.0.0:3000
  LAN: http://192.168.1.42:3000
```

Anyone on the same Wi-Fi can open that URL and join the room with the 4-character code shown in the lobby.

## Debug mode

Append `?debug=1` to the URL when creating or joining a room (e.g. `http://localhost:5173/?debug=1`). Your client will see every opponent's piece ranks AND the combat reveal modal will show the kinds of both combatants. Use this to verify rules, test the bot, or just spectate. Without the flag, opponent pieces stay face-down and combat shows only the outcome.

## Running the tests

```sh
pnpm test           # runs the full Vitest engine suite (~67 tests)
pnpm -C shared test # just the engine
```

## Project structure

```
shared/   pure rule engine (no I/O)
  board.ts        cell + edge graph
  pieces.ts       piece roster (12 kinds × 25 pieces/player)
  setup.ts        setup validation + random valid layout
  moves.ts        legal-move generator (road + rail w/ corner rule)
  combat.ts       combat resolution table
  engine.ts       reducer + GameState
  view.ts         fog-of-war projection per viewer
  protocol.ts     Zod schemas for every wire message
server/   Express + Socket.IO authoritative state
  server.ts       socket handlers
  room.ts         lobby + game state machine
  bot.ts          random-move bot driver
  net.ts          LAN IP detection
client/   React + Vite + SVG
  screens/        Landing, Lobby, Setup, Play
  components/     Board, Piece, CombatReveal
  state.ts        Zustand store + socket wiring
```

## Game rules (short version)

Each of 4 players (N/E/S/W) sets up 25 pieces face-down in their zone:

- **司令 (Marshal)**, 军长, 师长, 旅长, 团长, 营长, 连长, 排长 — ranked soldiers (higher rank wins).
- **工兵 (Engineer)** — lowest mobile rank, but defuses mines and can turn corners on railroads.
- **炸弹 (Bomb)** — mutual destruction with whatever it touches.
- **地雷 (Mine)** — immobile, kills any attacker except the engineer.
- **军旗 (Flag)** — immobile, lives in an HQ; capture = elimination.

On your turn, move one piece along the printed roads (one step) or along a railroad (slide to the first occupied/blocked cell; non-engineers cannot turn the corner). The 3×3 central rail grid (九宫) is reachable from cols 1, 3, and 5 of each zone's front line, and pieces *may stop on it* — it's both a transit and a contested zone. When pieces collide, the engine resolves combat using hidden ranks. **Identities stay hidden even after combat** — players only see the outcome (which side lost which cell). Use `?debug=1` to enable an all-pieces-visible mode for testing.

In 2v2, partners sit opposite each other (N+S vs E+W). The game ends when both opposing flags are captured. In free-for-all, the last flag standing wins.

For the full rules reference used to drive the engine, see [the rules spec](../.claude/plans/research-the-rules-and-refactored-catmull-agent-ab7df9e1861611521.md).

## Known gaps (deferred for v2)

- Smarter bot (currently uniform random). Engine has a swap-in interface.
- Variant toggles UI (engine is parameterized; canonical rules are hardcoded for now).
- Chat UI (server broadcasts chat messages but there's no input panel — talk to each other in person for now).
- Draw offer (resignation is enough for v1).
- Board rotation per viewer (your zone always shows in its absolute position — color identifies you).
