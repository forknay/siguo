// Replay encoding and playback.
//
// Format (text, line-based):
//
//   SIGUO|v=1|mode=<2v2|ffa>
//   SETUP|<seat>|<25 layout chars>   (one line per N, E, S, W in that order)
//   M|<seat>|<fromCell>|<toCell>     (one line per move)
//
// Layout chars are taken from PIECE_CHAR (one char per piece kind). The cell
// order used for layout is the canonical setup-cell order returned by
// setupCellsForZone(zone) — 25 cells, no camps.

import {
  type GameMode,
  type SeatId,
  ZONES,
  setupCellsForZone,
} from './board.js';
import {
  type PieceKind,
  PIECE_DEFS,
  PIECE_KINDS_ORDERED,
} from './pieces.js';
import {
  createGameState,
  submitSetup,
  applyMove,
  applyResign,
  type GameState,
  type SeatInfo,
  type MoveRecord,
} from './engine.js';
import { type Layout } from './setup.js';

export const PIECE_CHAR: Record<PieceKind, string> = {
  SILING: 'S', JUNZHANG: 'J', SHIZHANG: 'G', LUZHANG: 'L', TUANZHANG: 'T',
  YINGZHANG: 'Y', LIANZHANG: 'N', PAIZHANG: 'P', GONGBING: 'E',
  ZHADAN: 'B', DILEI: 'D', JUNQI: 'F',
};

const CHAR_TO_KIND: Record<string, PieceKind> = (() => {
  const m: Record<string, PieceKind> = {};
  for (const k of PIECE_KINDS_ORDERED) m[PIECE_CHAR[k]] = k;
  return m;
})();

/**
 * Single-zone setup encoding. The encoded string is "SIGUOSET|v=1|<25 chars>"
 * where the chars use PIECE_CHAR ordered by setupCellsForZone('N'). The actual
 * seat the layout is for is irrelevant — the 25-char ordering is the same for
 * every zone because setupCellsForZone is canonical, and the engine adapts the
 * placement to the receiving seat's cells.
 */
const LAYOUT_HEADER = 'SIGUOSET|v=1';

export function encodeSetupLayout(seat: SeatId, layout: Layout): string {
  return `${LAYOUT_HEADER}|${encodeLayoutForZone(seat, layout)}`;
}

export function decodeSetupLayout(text: string, targetSeat: SeatId): Layout {
  const stripped = text.trim();
  if (!stripped.startsWith(LAYOUT_HEADER)) {
    // Tolerant: also accept just the 25-char string with no header.
    if (stripped.length === 25 && /^[A-Z]{25}$/.test(stripped)) {
      return decodeLayoutForZone(targetSeat, stripped);
    }
    throw new Error('Not a SIGUOSET layout');
  }
  const parts = stripped.split('|');
  const chars = parts[parts.length - 1] ?? '';
  return decodeLayoutForZone(targetSeat, chars);
}

function encodeLayoutForZone(seat: SeatId, layout: Layout): string {
  return setupCellsForZone(seat).map((c) => {
    const kind = layout[c.id];
    return kind ? PIECE_CHAR[kind] : '?';
  }).join('');
}

function decodeLayoutForZone(seat: SeatId, chars: string): Layout {
  const cells = setupCellsForZone(seat);
  if (chars.length !== cells.length) {
    throw new Error(`Layout for ${seat}: expected ${cells.length} chars, got ${chars.length}`);
  }
  const layout: Layout = {};
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]!;
    const ch = chars[i]!;
    const kind = CHAR_TO_KIND[ch];
    if (!kind) throw new Error(`Layout for ${seat}: unknown char '${ch}' at position ${i}`);
    layout[c.id] = kind;
  }
  return layout;
}

export interface EncodedGame {
  mode: GameMode;
  setups: Record<SeatId, Layout>;
  moves: Array<{ seat: SeatId; from: string; to: string }>;
}

/** Serialize a complete game (from setups + moveHistory) to the replay text format. */
export function encodeGame(setups: Partial<Record<SeatId, Layout>>, mode: GameMode, moves: MoveRecord[]): string {
  const lines: string[] = [];
  lines.push(`SIGUO|v=1|mode=${mode}`);
  for (const seat of ZONES) {
    const layout = setups[seat];
    if (layout) {
      lines.push(`SETUP|${seat}|${encodeLayoutForZone(seat, layout)}`);
    }
  }
  for (const m of moves) {
    lines.push(`M|${m.seat}|${m.from}|${m.to}`);
  }
  return lines.join('\n');
}

/** Parse a replay text payload into the structured form. Throws on bad input. */
export function decodeGame(text: string): EncodedGame {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) throw new Error('Empty replay');
  const header = lines[0]!;
  const headerParts = header.split('|');
  if (headerParts[0] !== 'SIGUO') throw new Error('Missing SIGUO header');
  const headerFields = Object.fromEntries(
    headerParts.slice(1).map((p) => p.split('=') as [string, string]),
  );
  const mode = (headerFields.mode ?? '2v2') as GameMode;

  const setups: Partial<Record<SeatId, Layout>> = {};
  const moves: EncodedGame['moves'] = [];
  for (const line of lines.slice(1)) {
    const parts = line.split('|');
    if (parts[0] === 'SETUP') {
      const seat = parts[1] as SeatId;
      const chars = parts[2] ?? '';
      setups[seat] = decodeLayoutForZone(seat, chars);
    } else if (parts[0] === 'M') {
      const seat = parts[1] as SeatId;
      const from = parts[2] ?? '';
      const to = parts[3] ?? '';
      moves.push({ seat, from, to });
    } else {
      // Unknown line — ignore for forward compatibility.
    }
  }
  for (const z of ZONES) {
    if (!setups[z]) throw new Error(`Missing SETUP for seat ${z}`);
  }
  return { mode, setups: setups as Record<SeatId, Layout>, moves };
}

/** Build the initial state for a decoded replay (after all setups applied). */
export function buildReplayInitialState(encoded: EncodedGame): GameState {
  const seats: Record<SeatId, SeatInfo> = {} as Record<SeatId, SeatInfo>;
  for (const z of ZONES) {
    seats[z] = {
      playerId: `replay-${z}`,
      displayName: z,
      isBot: false,
      eliminated: false,
      setupReady: false,
    };
  }
  let state = createGameState(encoded.mode, seats);
  for (const z of ZONES) {
    const layout = encoded.setups[z];
    if (!layout) continue;
    const r = submitSetup(state, z, layout);
    if ('errors' in r) throw new Error(`Replay setup error for ${z}: ${r.errors.join(', ')}`);
    state = r.state;
  }
  return state;
}

/** Step forward N moves from the initial state, returning the new state.
 *
 *  Two kinds of robustness:
 *    1. Stops cleanly at game end (so the caller can scrub past the actual end).
 *    2. Auto-resigns seats whose turn comes up but who don't appear next in the
 *       recording. The bot driver resigns players with zero legal moves, but
 *       applyResign doesn't append to moveHistory, so the recording can jump
 *       turns. We reproduce the resignation here to keep state aligned.
 */
export function applyMovesUpTo(initial: GameState, allMoves: EncodedGame['moves'], n: number): GameState {
  let state = initial;
  for (let i = 0; i < Math.min(n, allMoves.length); i++) {
    if (state.phase !== 'PLAYING') break;
    const m = allMoves[i]!;
    // If the recorded move is for a different seat than whose turn it is,
    // resign the current-turn seats (up to 4 hops) until the turn matches.
    let safety = 4;
    while (state.turn !== m.seat && state.phase === 'PLAYING' && safety-- > 0) {
      state = applyResign(state, state.turn);
    }
    if (state.phase !== 'PLAYING') break;
    if (state.turn !== m.seat) {
      continue;
    }
    const r = applyMove(state, m.seat, m.from, m.to);
    if ('error' in r) {
      continue;
    }
    state = r.state;
  }
  return state;
}

/** Reconstruct setups (zone → layout) from a finished GameState. */
export function setupsFromState(state: GameState): Record<SeatId, Layout> {
  // The state has individual piece records but we need the canonical setup layouts
  // (positions at game-start). We derive them by walking moveHistory in reverse to
  // undo each move's positional effect. Bombs/mines/captures complicate this. For
  // v1 we just call this BEFORE any moves are applied — i.e. right after submitSetup
  // for all 4 seats but before applyMove. Callers should snapshot the setup state.
  const out: Partial<Record<SeatId, Layout>> = { N: {}, E: {}, S: {}, W: {} };
  for (const p of Object.values(state.pieces)) {
    const ownerOut = out[p.owner];
    if (ownerOut) {
      ownerOut[p.cellId] = p.kind;
    }
  }
  return out as Record<SeatId, Layout>;
}
