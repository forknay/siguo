import { useEffect, useMemo, useState } from 'react';
import { useGame } from '../state.js';
import {
  BOARD,
  PIECE_DEFS,
  PIECE_KINDS_ORDERED,
  legalMovesFromCell,
  viewMoveContext,
  type MoveContext,
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
  const liveView = useGame((s) => s.view);
  const viewHistory = useGame((s) => s.viewHistory);
  const scrubOffset = useGame((s) => s.scrubOffset);
  const scrubBy = useGame((s) => s.scrubBy);
  const setScrubOffset = useGame((s) => s.setScrubOffset);
  const seat = useGame((s) => s.seat);
  const send = useGame((s) => s.send);
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingDraw, setPendingDraw] = useState(false);

  const isScrubbing = scrubOffset < 0 && viewHistory.length > 0;
  // The view we render: a cached past view when scrubbing, else the live one.
  const view = isScrubbing
    ? viewHistory[viewHistory.length - 1 + scrubOffset] ?? liveView
    : liveView;

  // Clear any selection the moment we enter a scrubbed (read-only) state.
  useEffect(() => {
    if (isScrubbing && selected !== null) setSelected(null);
  }, [isScrubbing, selected]);

  // Single source of truth for view → MoveContext lives in shared (frozen-piece
  // filter, unknown-kind placeholder, isAlly logic). Reusing it here keeps the
  // client and the bot from drifting on what "transparent to movement" means.
  const ctx: MoveContext = useMemo(
    () => (view ? viewMoveContext(view) : { pieceAt: () => null, isAlly: (a, b) => a === b }),
    [view],
  );

  const legal = useMemo(() => {
    if (!view || !selected || !seat || isScrubbing) return new Set<string>();
    const piece = view.pieces.find((p) => p.cellId === selected);
    if (!piece || piece.owner !== seat) return new Set<string>();
    return new Set(legalMovesFromCell(ctx, selected));
  }, [view, ctx, selected, seat, isScrubbing]);

  const selectedPiece = useMemo(() => {
    if (!view || !selected) return null;
    return view.pieces.find((p) => p.cellId === selected) ?? null;
  }, [view, selected]);

  if (!view || !seat) return <div className="screen-center">Loading game…</div>;

  const myTurn = !isScrubbing && liveView !== null
    && liveView.turn === seat && liveView.phase === 'PLAYING' && !liveView.seats[seat].eliminated;

  function handleCellClick(cellId: string) {
    if (!view) return;
    if (isScrubbing) return;
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
      <div className="board-container" style={{ position: 'relative' }}>
        <div style={isScrubbing ? { filter: 'saturate(0.6) brightness(0.8)' } : undefined}>
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
        </div>
        {isScrubbing && (
          <div
            style={{
              position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
              background: 'var(--accent)', color: '#0e1530', padding: '0.3rem 0.8rem',
              borderRadius: 6, fontSize: 13, fontWeight: 600, zIndex: 10,
            }}
          >
            ⏮ Viewing move {viewHistory.length - 1 + scrubOffset} of {viewHistory.length - 1}
            {' · '}
            <button
              style={{ fontSize: 12, padding: '0.1rem 0.4rem', marginLeft: 4 }}
              onClick={() => setScrubOffset(0)}
            >
              ← back to present
            </button>
          </div>
        )}
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

        {viewHistory.length > 1 && (
          <div style={{ padding: '0.5rem', background: 'var(--bg)', borderRadius: 6 }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
              Review history{isScrubbing ? ' (read-only)' : ''}
            </div>
            <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
              <button onClick={() => setScrubOffset(-(viewHistory.length - 1))} disabled={scrubOffset <= -(viewHistory.length - 1)}>⏮</button>
              <button onClick={() => scrubBy(-1)} disabled={scrubOffset <= -(viewHistory.length - 1)}>◀ Prev</button>
              <button onClick={() => scrubBy(1)} disabled={scrubOffset >= 0}>Next ▶</button>
              <button onClick={() => setScrubOffset(0)} disabled={scrubOffset >= 0}>⏭ Now</button>
            </div>
            <input
              type="range"
              min={-(viewHistory.length - 1)}
              max={0}
              value={scrubOffset}
              onChange={(e) => setScrubOffset(parseInt(e.target.value, 10))}
              style={{ width: '100%', marginTop: 4 }}
            />
          </div>
        )}
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
          <button onClick={() => send({ type: 'Resign' })} disabled={isScrubbing || !liveView || liveView.phase !== 'PLAYING' || liveView.seats[seat].eliminated}>
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
            disabled={isScrubbing || !liveView || liveView.phase !== 'PLAYING' || liveView.seats[seat].eliminated}
          >
            {pendingDraw ? 'Cancel draw offer' : 'Offer draw'}
          </button>
        </div>

        <LossesPanel losses={myLosses} />

        <MoveHistory history={view.moveHistory} />

        <ChatPanel />

        {liveView?.phase === 'ENDED' && (
          <div style={{ padding: '0.75rem', background: 'var(--bg)', borderRadius: 6 }}>
            <h3>Game over</h3>
            {liveView.result?.kind === 'TEAM_WIN' && <div>Team {liveView.result.team} wins!</div>}
            {liveView.result?.kind === 'PLAYER_WIN' && <div>{liveView.result.seat} wins!</div>}
            {liveView.result?.kind === 'DRAW' && <div>Draw ({liveView.result.reason})</div>}
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
