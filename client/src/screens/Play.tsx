import { useMemo, useState } from 'react';
import { useGame } from '../state.js';
import {
  BOARD,
  PIECE_DEFS,
  PIECE_KINDS_ORDERED,
  legalMovesFromCell,
  type MoveContext,
  type PieceRef,
  type PieceKind,
  type SeatId,
} from '@siguo/shared';
import { Board, SEAT_COLORS } from '../components/Board.js';
import { CombatReveal } from '../components/CombatReveal.js';
import { PieceInspector } from '../components/PieceInspector.js';
import { RankGuide } from '../components/RankGuide.js';
import { ChatPanel } from '../components/ChatPanel.js';
import { copyToClipboard } from '../clipboard.js';

const SEATS: SeatId[] = ['N', 'E', 'S', 'W'];

export function Play() {
  const view = useGame((s) => s.view);
  const seat = useGame((s) => s.seat);
  const send = useGame((s) => s.send);
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingDraw, setPendingDraw] = useState(false);

  const ctx: MoveContext = useMemo(() => {
    const refs: Record<string, PieceRef> = {};
    if (view) {
      for (const p of view.pieces) {
        if (p.kind !== null) {
          refs[p.cellId] = { id: p.id, cellId: p.cellId, kind: p.kind, owner: p.owner };
        } else {
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
      if (piece && piece.owner === seat) {
        setSelected(cellId);
        return;
      }
      setSelected(null);
      return;
    }
    if (piece && piece.owner === seat && piece.kind && PIECE_DEFS[piece.kind].mobile) {
      const cell = BOARD.cells.get(cellId);
      if (cell?.type === 'HQ') return;
      setSelected(cellId);
    }
  }

  // Tally MY losses, grouped by killer seat. Under strict fog the viewer
  // always knows the kind of their own piece — so combat.attackerKind is
  // present when rec.seat === viewerSeat, and combat.defenderKind is present
  // when combat.defenderSeat === viewerSeat.
  const myLosses: Partial<Record<SeatId, Partial<Record<PieceKind, number>>>> = {};
  for (const rec of view.moveHistory) {
    if (rec.kind === 'resign' || !rec.combat) continue;
    const { combat } = rec;
    const winner = combat.winner;
    // Case 1: I was the attacker (my piece moved) and I died.
    if (rec.seat === seat && (winner === 'defender' || winner === 'tie') && combat.attackerKind) {
      const killer = combat.defenderSeat;
      (myLosses[killer] ??= {});
      myLosses[killer][combat.attackerKind] = (myLosses[killer][combat.attackerKind] ?? 0) + 1;
    }
    // Case 2: I was the defender and I died.
    if (combat.defenderSeat === seat && (winner === 'attacker' || winner === 'tie') && combat.defenderKind) {
      const killer = rec.seat;
      (myLosses[killer] ??= {});
      myLosses[killer][combat.defenderKind] = (myLosses[killer][combat.defenderKind] ?? 0) + 1;
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', height: '100vh', position: 'relative' }}>
      <div className="board-container">
        <Board
          pieces={view.pieces}
          legalCells={legal}
          selectedCell={selected}
          onCellClick={handleCellClick}
          flagRevealed={view.flagRevealed}
          currentTurn={view.turn}
          lastMoveBySeat={view.lastMoveBySeat}
          lastCombat={view.lastCombat}
          viewerSeat={seat}
        />
        <PieceInspector
          kind={selectedPiece?.kind ?? null}
          color={selectedPiece ? SEAT_COLORS[selectedPiece.owner] : undefined}
        />
        <RankGuide />
      </div>
      <div className="col side-panel" style={{ padding: '1rem', background: 'var(--bg-elev)', overflowY: 'auto' }}>
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
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button onClick={() => send({ type: 'Resign' })} disabled={view.phase !== 'PLAYING' || view.seats[seat].eliminated}>
            Resign
          </button>
          <button
            onClick={() => {
              if (!pendingDraw) {
                send({ type: 'OfferDraw' });
                setPendingDraw(true);
              } else {
                send({ type: 'CancelDraw' });
                setPendingDraw(false);
              }
            }}
            disabled={view.phase !== 'PLAYING' || view.seats[seat].eliminated}
          >
            {pendingDraw ? 'Cancel draw offer' : 'Offer draw'}
          </button>
        </div>

        <LossesPanel losses={myLosses} />

        <MoveHistory history={view.moveHistory} />

        <ChatPanel />

        {view.phase === 'ENDED' && (
          <div style={{ padding: '0.75rem', background: 'var(--bg)', borderRadius: 6 }}>
            <h3>Game over</h3>
            {view.result?.kind === 'TEAM_WIN' && <div>Team {view.result.team} wins!</div>}
            {view.result?.kind === 'PLAYER_WIN' && <div>{view.result.seat} wins!</div>}
            {view.result?.kind === 'DRAW' && <div>Draw ({view.result.reason})</div>}
            <ReplayShareButton />
            <button
              style={{ marginTop: '0.5rem' }}
              onClick={() => send({ type: 'ReturnToLobby' })}
            >
              Back to lobby
            </button>
          </div>
        )}
      </div>
      <CombatReveal />
    </div>
  );
}

function ReplayShareButton() {
  const send = useGame((s) => s.send);
  const replayText = useGame((s) => s.replayText);
  const [copied, setCopied] = useState(false);

  if (!replayText) {
    return (
      <button style={{ marginTop: '0.5rem' }} onClick={() => send({ type: 'RequestReplay' })}>
        Generate replay code
      </button>
    );
  }

  function copy() {
    if (!replayText) return;
    copyToClipboard(replayText).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    });
  }

  return (
    <div className="col" style={{ marginTop: '0.5rem', gap: '0.3rem' }}>
      <div className="muted" style={{ fontSize: 12 }}>
        Replay code — paste this into the "Watch replay" tab on the landing screen, or share it.
      </div>
      <textarea
        readOnly
        value={replayText}
        style={{ fontSize: 10, fontFamily: 'monospace', resize: 'vertical' }}
        rows={5}
        onFocus={(e) => e.currentTarget.select()}
      />
      <button onClick={copy}>{copied ? 'Copied ✓' : 'Copy to clipboard'}</button>
    </div>
  );
}

/**
 * Shows pieces YOU have lost, grouped by which seat killed them. Strict fog:
 * the viewer always knows what they themselves had at game start, so own-piece
 * kinds are always available even when the combat record's kind fields were
 * stripped for non-viewer participants.
 */
function LossesPanel({ losses }: { losses: Partial<Record<SeatId, Partial<Record<PieceKind, number>>>> }) {
  const seatsWithLosses = SEATS.filter((s) => {
    const m = losses[s];
    return m && Object.values(m).some((c) => (c ?? 0) > 0);
  });
  if (seatsWithLosses.length === 0) {
    return (
      <div style={{ padding: '0.5rem', background: 'var(--bg)', borderRadius: 6 }}>
        <div className="muted" style={{ fontSize: 12 }}>Your losses</div>
        <div className="muted" style={{ fontSize: 12 }}>None yet</div>
      </div>
    );
  }
  return (
    <div style={{ padding: '0.5rem', background: 'var(--bg)', borderRadius: 6 }}>
      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Your losses (by killer)</div>
      {seatsWithLosses.map((s) => {
        const m = losses[s]!;
        return (
          <div key={s} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ color: SEAT_COLORS[s], fontWeight: 600, fontSize: 12, minWidth: 18 }}>{s}</span>
            {PIECE_KINDS_ORDERED.map((k) => {
              const count = m[k] ?? 0;
              if (count === 0) return null;
              return (
                <span
                  key={k}
                  style={{
                    fontSize: 12,
                    padding: '2px 5px',
                    border: '1px solid #2d3a6e',
                    borderRadius: 4,
                    background: '#1a2247',
                  }}
                >
                  {PIECE_DEFS[k].chinese}{count > 1 ? `×${count}` : ''}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function MoveHistory({ history }: { history: Array<{ kind?: 'move' | 'resign'; seat: SeatId; from?: string; to?: string; turnIndex: number }> }) {
  const recent = history.slice(-10).reverse();
  return (
    <div style={{ padding: '0.5rem', background: 'var(--bg)', borderRadius: 6 }}>
      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Recent moves</div>
      {recent.length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }}>None yet</div>
      ) : (
        <div style={{ fontFamily: 'monospace', fontSize: 11, lineHeight: 1.4 }}>
          {recent.map((m, i) => (
            <div key={i}>
              <span style={{ color: SEAT_COLORS[m.seat] }}>{m.seat}</span>{' '}
              <span className="muted">#{m.turnIndex}</span>{' '}
              {m.kind === 'resign'
                ? <span style={{ color: 'var(--danger)' }}>resigned</span>
                : <>{m.from} → {m.to}</>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
