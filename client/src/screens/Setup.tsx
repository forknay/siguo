import { useMemo, useState } from 'react';
import { useGame } from '../state.js';
import {
  BOARD,
  PIECE_DEFS,
  PIECE_KINDS_ORDERED,
  decodeSetupLayout,
  randomValidSetup,
  validateLayout,
  type PieceKind,
  type SeatId,
  type Layout,
} from '@siguo/shared';
import { Board, SEAT_COLORS } from '../components/Board.js';
import { PieceInspector } from '../components/PieceInspector.js';
import { RankGuide } from '../components/RankGuide.js';

export function Setup() {
  const seat = useGame((s) => s.seat);
  const view = useGame((s) => s.view);
  const send = useGame((s) => s.send);
  const [layout, setLayout] = useState<Layout>({});
  const [pickedKind, setPickedKind] = useState<PieceKind | null>(null);
  const [pasteValue, setPasteValue] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);

  if (!seat || !view) return <div className="screen-center">Loading setup…</div>;
  const mine = seat;
  const submitted = view.seats[mine].setupReady;

  // Bank: remaining counts per kind.
  const used: Partial<Record<PieceKind, number>> = {};
  for (const k of Object.values(layout)) used[k] = (used[k] ?? 0) + 1;
  const remaining: Array<{ kind: PieceKind; count: number }> = PIECE_KINDS_ORDERED.map(
    (k) => ({ kind: k, count: PIECE_DEFS[k].count - (used[k] ?? 0) }),
  );

  const placeableCells = useMemo(() => {
    const set = new Set<string>();
    for (const c of BOARD.cells.values()) {
      if (c.zone !== mine) continue;
      if (c.type === 'CAMP') continue;
      set.add(c.id);
    }
    return set;
  }, [mine]);

  const setupOccupied = new Set(Object.keys(layout));

  const errs = validateLayout(mine, layout);
  const isComplete = errs.length === 0 && Object.keys(layout).length === 25;

  function placePiece(cellId: string) {
    if (submitted) return;
    if (!placeableCells.has(cellId)) return;
    if (!pickedKind) {
      // Click on placed piece: pick it up
      const existing = layout[cellId];
      if (existing) {
        const next = { ...layout };
        delete next[cellId];
        setLayout(next);
        setPickedKind(existing);
      }
      return;
    }
    const def = PIECE_DEFS[pickedKind];
    const usedCount = used[pickedKind] ?? 0;
    if (usedCount >= def.count) return;
    const cell = BOARD.cells.get(cellId)!;
    // Constraint check
    if (pickedKind === 'JUNQI' && cell.type !== 'HQ') return;
    if (pickedKind === 'DILEI' && cell.row > 2) return;
    if (pickedKind === 'ZHADAN' && cell.row === 6) return;
    // If there's already a piece here we just overwrite (the old kind goes back to bank).
    const next = { ...layout };
    next[cellId] = pickedKind;
    setLayout(next);
    // Sticky picker (#29): keep the same kind selected so the player can drop
    // multiple mines/engineers/etc in a row without re-clicking the bank. Auto-
    // clear when the bank for this kind reaches 0.
    const remainingAfter = def.count - (usedCount + 1);
    if (remainingAfter <= 0) {
      setPickedKind(null);
    }
  }

  function autoFill() {
    setLayout(randomValidSetup(mine));
    setPickedKind(null);
  }

  function clear() {
    setLayout({});
    setPickedKind(null);
  }

  function submit() {
    send({ type: 'SubmitSetup', layout });
  }

  const pieces = Object.entries(layout).map(([cellId, kind], i) => ({
    id: `setup-${i}`,
    cellId,
    owner: mine,
    kind,
    frozen: false,
  }));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', height: '100vh' }}>
      <div className="board-container">
        <Board
          pieces={pieces}
          setupPlaceableCells={placeableCells}
          setupOccupiedCells={setupOccupied}
          onCellClick={placePiece}
          viewerSeat={mine}
        />
        <PieceInspector
          kind={pickedKind}
          color={SEAT_COLORS[mine]}
          label={pickedKind ? 'Click a cell to place' : 'Pick a piece below'}
        />
        <RankGuide />
      </div>
      <div className="col" style={{ padding: '1rem', background: 'var(--bg-elev)', overflowY: 'auto' }}>
        <h2 style={{ color: SEAT_COLORS[mine] }}>Set up — seat {mine}</h2>
        {submitted && (
          <div className="muted" style={{ color: 'var(--accent)' }}>
            ✓ Submitted. Waiting for others…
          </div>
        )}
        <div className="row" style={{ flexWrap: 'wrap', gap: '0.4rem' }}>
          <button onClick={autoFill} disabled={submitted}>Random fill</button>
          <button onClick={clear} disabled={submitted}>Clear</button>
          <button onClick={submit} disabled={!isComplete || submitted}>Submit setup</button>
        </div>

        <details>
          <summary className="muted" style={{ fontSize: 12, cursor: 'pointer' }}>
            Paste a saved layout
          </summary>
          <div className="col" style={{ gap: '0.3rem', marginTop: 4 }}>
            <textarea
              rows={3}
              value={pasteValue}
              onChange={(e) => setPasteValue(e.target.value)}
              placeholder="SIGUOSET|v=1|……"
              style={{ fontFamily: 'monospace', fontSize: 11 }}
            />
            <button
              disabled={submitted || pasteValue.trim().length === 0}
              onClick={() => {
                try {
                  const decoded = decodeSetupLayout(pasteValue.trim(), mine);
                  setLayout(decoded);
                  setPickedKind(null);
                  setPasteValue('');
                  setPasteError(null);
                } catch (e) {
                  setPasteError(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              Load layout
            </button>
            {pasteError && (
              <div style={{ color: 'var(--danger)', fontSize: 11 }}>{pasteError}</div>
            )}
          </div>
        </details>
        <div className="muted" style={{ fontSize: 12 }}>
          Click a piece below, then click cells in your zone to place them. The selection stays so you can place all of one kind in a row. Click a placed piece to return it to the bank.
        </div>
        {pickedKind && (
          <button onClick={() => setPickedKind(null)} style={{ fontSize: 11 }}>
            Deselect piece
          </button>
        )}
        <div className="muted" style={{ fontSize: 12 }}>
          Constraints: 军旗 must be in an HQ. 地雷 only in back 2 rows. 炸弹 not in the front line.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
          {remaining.map(({ kind, count }) => {
            const def = PIECE_DEFS[kind];
            const isPicked = pickedKind === kind;
            return (
              <button
                key={kind}
                onClick={() => setPickedKind(count > 0 ? kind : null)}
                disabled={count === 0 || submitted}
                style={{
                  border: `2px solid ${isPicked ? 'var(--accent)' : '#2d3a6e'}`,
                  background: count === 0 ? '#0e1530' : 'var(--bg-elev)',
                  textAlign: 'left',
                  padding: '0.45rem 0.6rem',
                }}
              >
                <div style={{ fontSize: 18 }}>{def.chinese}</div>
                <div style={{ fontSize: 11 }} className="muted">
                  {def.english} · {count}/{def.count}
                </div>
              </button>
            );
          })}
        </div>

        {errs.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--danger)' }}>
            {errs.slice(0, 3).map((e, i) => <div key={i}>• {e.message}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}
