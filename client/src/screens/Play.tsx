import { useMemo, useState } from 'react';
import { useGame } from '../state.js';
import {
  BOARD,
  PIECE_DEFS,
  legalMovesFromCell,
  type MoveContext,
  type PieceRef,
  type SeatId,
} from '@siguo/shared';
import { Board, SEAT_COLORS } from '../components/Board.js';
import { CombatReveal } from '../components/CombatReveal.js';
import { PieceInspector } from '../components/PieceInspector.js';
import { RankGuide } from '../components/RankGuide.js';

const SEATS: SeatId[] = ['N', 'E', 'S', 'W'];


export function Play() {
  const view = useGame((s) => s.view);
  const seat = useGame((s) => s.seat);
  const send = useGame((s) => s.send);
  const [selected, setSelected] = useState<string | null>(null);

  // Recompute the move context from the view (we know our own pieces' ranks).
  const ctx: MoveContext = useMemo(() => {
    const refs: Record<string, PieceRef> = {};
    if (view) {
      for (const p of view.pieces) {
        if (p.kind !== null) {
          refs[p.cellId] = { id: p.id, cellId: p.cellId, kind: p.kind, owner: p.owner };
        } else {
          // For pathing we assume a placeholder mobile piece — it just acts as a blocker.
          refs[p.cellId] = { id: p.id, cellId: p.cellId, kind: 'PAIZHANG', owner: p.owner };
        }
      }
    }
    return {
      pieceAt: (id) => refs[id] ?? null,
      isAlly: (a, b) => {
        if (!view) return a === b;
        if (a === b) return true;
        if (view.mode === 'ffa') return false;
        return view.teams[a] === view.teams[b];
      },
    };
  }, [view]);

  const legal = useMemo(() => {
    if (!view || !selected || !seat) return new Set<string>();
    const piece = view.pieces.find((p) => p.cellId === selected);
    if (!piece || piece.owner !== seat) return new Set<string>();
    return new Set(legalMovesFromCell(ctx, selected));
  }, [view, ctx, selected, seat]);

  const selectedPiece = useMemo(() => {
    if (!view || !selected) return null;
    return view.pieces.find((p) => p.cellId === selected) ?? null;
  }, [view, selected]);

  if (!view || !seat) return <div className="screen-center">Loading game…</div>;

  const myTurn = view.turn === seat && view.phase === 'PLAYING' && !view.seats[seat].eliminated;

  function handleCellClick(cellId: string) {
    if (!view) return;
    if (view.phase !== 'PLAYING') return;
    if (!myTurn) return;
    const piece = view.pieces.find((p) => p.cellId === cellId);
    if (selected) {
      if (legal.has(cellId)) {
        send({ type: 'Move', from: selected, to: cellId });
        setSelected(null);
        return;
      }
      // Clicking another own piece: re-select.
      if (piece && piece.owner === seat) {
        setSelected(cellId);
        return;
      }
      setSelected(null);
      return;
    }
    if (piece && piece.owner === seat && piece.kind && PIECE_DEFS[piece.kind].mobile) {
      const cell = BOARD.cells.get(cellId);
      if (cell?.type === 'HQ') return; // HQ-locked
      setSelected(cellId);
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', height: '100vh', position: 'relative' }}>
      <div style={{ padding: '0.5rem' }}>
        <Board
          pieces={view.pieces}
          legalCells={legal}
          selectedCell={selected}
          onCellClick={handleCellClick}
          flagRevealed={view.flagRevealed}
        />
        <PieceInspector
          kind={selectedPiece?.kind ?? null}
          color={selectedPiece ? SEAT_COLORS[selectedPiece.owner] : undefined}
        />
        <RankGuide />
      </div>
      <div className="col" style={{ padding: '1rem', background: 'var(--bg-elev)', overflowY: 'auto' }}>
        <h2>Game</h2>
        <div>
          <div className="muted">You are seat <span style={{ color: SEAT_COLORS[seat] }}>{seat}</span></div>
          <div>Mode: {view.mode === '2v2' ? '2 vs 2' : 'Free-for-all'}</div>
          <div>Turn #{view.turnIndex} — {myTurn ? <strong>your turn</strong> : <span style={{ color: SEAT_COLORS[view.turn] }}>{view.turn}'s turn</span>}</div>
          <div className="muted">Moves since last capture: {view.movesSinceCapture}/70</div>
        </div>
        <div className="col" style={{ gap: '0.35rem' }}>
          <div className="muted" style={{ fontSize: 12 }}>Players</div>
          {SEATS.map((s) => (
            <div key={s} style={{ color: SEAT_COLORS[s], opacity: view.seats[s].eliminated ? 0.4 : 1 }}>
              {s}: {view.seats[s].displayName}
              {view.seats[s].eliminated ? ' (eliminated)' : ''}
              {view.marshalDead[s] ? ' · 司令 dead' : ''}
            </div>
          ))}
        </div>
        <div className="row">
          <button onClick={() => send({ type: 'Resign' })} disabled={view.phase !== 'PLAYING' || view.seats[seat].eliminated}>
            Resign
          </button>
        </div>
        {view.phase === 'ENDED' && (
          <div style={{ padding: '0.75rem', background: 'var(--bg)', borderRadius: 6 }}>
            <h3>Game over</h3>
            {view.result?.kind === 'TEAM_WIN' && <div>Team {view.result.team} wins!</div>}
            {view.result?.kind === 'PLAYER_WIN' && <div>{view.result.seat} wins!</div>}
            {view.result?.kind === 'DRAW' && <div>Draw ({view.result.reason})</div>}
          </div>
        )}
      </div>
      <CombatReveal />
    </div>
  );
}

