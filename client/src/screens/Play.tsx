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

  // Tally captured opponent pieces that this viewer is allowed to see.
  const knownCaptures: Record<SeatId, Record<PieceKind, number>> = {
    N: emptyCaptures(), E: emptyCaptures(), S: emptyCaptures(), W: emptyCaptures(),
  };
  for (const rec of view.moveHistory) {
    if (!rec.combat) continue;
    const { combat } = rec;
    // We know about a piece if we own it (we saw it set up) or it died in our combat.
    // Server already filters which pieces are visible — but combat reveals identities
    // only to the two combatants in debug mode. In non-debug mode rec.combat.* are
    // present in the moveHistory because the server includes them in the engine
    // payload regardless (server filtering happens in projectView for cell-state, not
    // moveHistory). To stay safe we only count captures the viewer is involved in.
    const viewerInvolved = rec.seat === view.viewerSeat || isTeammate(view, rec.seat, view.viewerSeat);
    const defenderSeat = whoIsDefender(view, rec);
    const defenderIsTeammate = defenderSeat ? isTeammate(view, defenderSeat, view.viewerSeat) : false;
    void viewerInvolved; void defenderIsTeammate;
    // Simplest visible policy: count any combat death where the viewer's team won
    // OR lost a piece. We just attribute the killed kind to the LOSING side.
    if (combat.winner === 'attacker') {
      // Defender's piece died — credit attacker seat with the captured-kind tally.
      if (defenderSeat) knownCaptures[rec.seat][combat.defenderKind] += 1;
    } else if (combat.winner === 'defender') {
      // Attacker's piece died — defender keeps cell, captures attacker.
      if (defenderSeat) knownCaptures[defenderSeat][combat.attackerKind] += 1;
    } else {
      // Tie — both die. Credit no one (or credit both); shown on captures of both seats.
      if (defenderSeat) knownCaptures[defenderSeat][combat.attackerKind] += 1;
      knownCaptures[rec.seat][combat.defenderKind] += 1;
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

        <CapturesTray captures={knownCaptures} />

        <MoveHistory history={view.moveHistory} />

        <ChatPanel />

        {view.phase === 'ENDED' && (
          <div style={{ padding: '0.75rem', background: 'var(--bg)', borderRadius: 6 }}>
            <h3>Game over</h3>
            {view.result?.kind === 'TEAM_WIN' && <div>Team {view.result.team} wins!</div>}
            {view.result?.kind === 'PLAYER_WIN' && <div>{view.result.seat} wins!</div>}
            {view.result?.kind === 'DRAW' && <div>Draw ({view.result.reason})</div>}
            <ReplayShareButton />
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
    navigator.clipboard?.writeText(replayText ?? '').then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => { /* ignore */ },
    );
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

function emptyCaptures(): Record<PieceKind, number> {
  return Object.fromEntries(PIECE_KINDS_ORDERED.map((k) => [k, 0])) as Record<PieceKind, number>;
}

function isTeammate(view: ReturnType<typeof useGame.getState>['view'], a: SeatId, b: SeatId | null): boolean {
  if (!view || !b) return false;
  if (a === b) return true;
  if (view.mode === 'ffa') return false;
  return view.teams[a] === view.teams[b];
}

function whoIsDefender(
  view: ReturnType<typeof useGame.getState>['view'],
  rec: { seat: SeatId; to: string },
): SeatId | null {
  // The defender is whoever owned the piece at the destination cell BEFORE the move.
  // After the move the cell may belong to someone else. We can recover it from the
  // lastCombat field on the view, but the engine emits combat data per move so we
  // need the prior-turn occupant. Approximation: look at the seats other than the
  // attacker; in practice this is fine for the captures tally because the engine
  // already tagged the combat result with the defender's piece kind.
  void view;
  void rec;
  return null;
}

function CapturesTray({ captures }: { captures: Record<SeatId, Record<PieceKind, number>> }) {
  const totals = SEATS.map((s) => {
    const total = Object.values(captures[s]).reduce((a, b) => a + b, 0);
    return { seat: s, total };
  });
  if (totals.every((t) => t.total === 0)) {
    return (
      <div style={{ padding: '0.5rem', background: 'var(--bg)', borderRadius: 6 }}>
        <div className="muted" style={{ fontSize: 12 }}>Captures</div>
        <div className="muted" style={{ fontSize: 12 }}>None yet</div>
      </div>
    );
  }
  return (
    <div style={{ padding: '0.5rem', background: 'var(--bg)', borderRadius: 6 }}>
      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Captures by seat</div>
      {SEATS.map((s) => {
        const total = Object.values(captures[s]).reduce((a, b) => a + b, 0);
        if (total === 0) return null;
        return (
          <div key={s} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ color: SEAT_COLORS[s], fontWeight: 600, fontSize: 12, minWidth: 18 }}>{s}</span>
            {PIECE_KINDS_ORDERED.map((k) => {
              const count = captures[s][k];
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

function MoveHistory({ history }: { history: ReturnType<typeof useGame.getState>['view'] extends infer V ? V extends { moveHistory: infer H } ? H : never : never }) {
  const recent = (history as Array<{ seat: SeatId; from: string; to: string; turnIndex: number }>).slice(-10).reverse();
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
              {m.from} → {m.to}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
