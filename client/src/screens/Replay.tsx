// Step-through replay viewer. Loaded when the URL contains ?replay=<encoded>.
// The encoded payload is the text format produced by encodeGame() in shared/replay.ts.

import { useMemo, useState } from 'react';
import {
  buildReplayInitialState,
  applyMovesUpTo,
  decodeGame,
  projectView,
  type EncodedGame,
  type SeatId,
} from '@siguo/shared';
import { Board, SEAT_COLORS } from '../components/Board.js';
import { useGame } from '../state.js';

interface Props {
  encoded: string;
}

const SEATS: SeatId[] = ['N', 'E', 'S', 'W'];

export function Replay({ encoded }: Props) {
  const decoded: EncodedGame | { error: string } = useMemo(() => {
    try {
      return decodeGame(encoded);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [encoded]);

  const [step, setStep] = useState(0);
  const [viewerSeat, setViewerSeat] = useState<SeatId>('N');

  if ('error' in decoded) {
    return (
      <div className="screen-center">
        <div className="card">
          <h2>Replay error</h2>
          <pre>{decoded.error}</pre>
          <a href="/">← Back to lobby</a>
        </div>
      </div>
    );
  }

  const initial = useMemo(() => {
    try { return { state: buildReplayInitialState(decoded) }; }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  }, [decoded]);
  const totalSteps = decoded.moves.length;
  const stateResult = useMemo(() => {
    if ('error' in initial) return initial;
    try { return { state: applyMovesUpTo(initial.state, decoded.moves, step) }; }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  }, [initial, decoded, step]);

  if ('error' in stateResult) {
    return (
      <div className="screen-center">
        <div className="card">
          <h2>Replay error at step {step}</h2>
          <pre style={{ fontSize: 11 }}>{stateResult.error}</pre>
          <button onClick={() => setStep(Math.max(0, step - 1))}>← Step back</button>
        </div>
      </div>
    );
  }

  // Replays show all pieces (no fog) — debug-style view.
  const view = projectView(stateResult.state, viewerSeat, { debug: true });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', height: '100vh', position: 'relative' }}>
      <div className="board-container">
        <Board
          pieces={view.pieces}
          flagRevealed={view.flagRevealed}
          currentTurn={view.turn}
          lastMoveBySeat={view.lastMoveBySeat}
          viewerSeat={viewerSeat}
        />
      </div>
      <div className="col side-panel" style={{ padding: '1rem', background: 'var(--bg-elev)', overflowY: 'auto' }}>
        <h2>Replay</h2>
        <div className="muted">Mode: {decoded.mode}</div>
        <div className="muted">Move {step} / {totalSteps}</div>

        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button onClick={() => setStep(0)} disabled={step === 0}>⏮ Start</button>
          <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>◀ Prev</button>
          <button onClick={() => setStep((s) => Math.min(totalSteps, s + 1))} disabled={step >= totalSteps}>Next ▶</button>
          <button onClick={() => setStep(totalSteps)} disabled={step >= totalSteps}>End ⏭</button>
        </div>
        <input
          type="range"
          min={0}
          max={totalSteps}
          value={step}
          onChange={(e) => setStep(parseInt(e.target.value, 10))}
        />

        <div className="row" style={{ flexWrap: 'wrap', gap: '0.3rem' }}>
          <span className="muted" style={{ fontSize: 12 }}>View as:</span>
          {SEATS.map((s) => (
            <button
              key={s}
              onClick={() => setViewerSeat(s)}
              style={{
                padding: '0.2rem 0.5rem',
                fontSize: 12,
                background: viewerSeat === s ? SEAT_COLORS[s] : 'var(--bg-elev)',
                color: viewerSeat === s ? '#0e1530' : 'var(--text)',
                fontWeight: viewerSeat === s ? 700 : 400,
              }}
            >
              {s}
            </button>
          ))}
        </div>

        <div style={{ padding: '0.5rem', background: 'var(--bg)', borderRadius: 6 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Recent moves</div>
          <div style={{ fontFamily: 'monospace', fontSize: 11, lineHeight: 1.4, maxHeight: 200, overflowY: 'auto' }}>
            {decoded.moves.slice(Math.max(0, step - 10), step).reverse().map((m, i) => (
              <div key={i}>
                <span style={{ color: SEAT_COLORS[m.seat] }}>{m.seat}</span>{' '}
                <span className="muted">#{step - i - 1}</span>{' '}
                {m.from} → {m.to}
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 'auto' }}>
          <button
            onClick={() => {
              // Clear pasted replay state and URL param if present.
              const url = new URL(window.location.href);
              if (url.searchParams.has('replay')) {
                url.searchParams.delete('replay');
                window.history.replaceState({}, '', url.toString());
              }
              useGame.setState({ pastedReplay: null });
              // Force a re-render of App by triggering the effect dep.
              window.location.reload();
            }}
          >
            ← Back to lobby
          </button>
        </div>
      </div>
    </div>
  );
}
