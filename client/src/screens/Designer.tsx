// Standalone layout designer. Reuses the Setup UI but without a server connection.
// Lets the user craft a 25-piece layout, copy its encoded string to clipboard, and
// stash it in localStorage for later pasting in a real match.

import { useMemo, useState } from 'react';
import {
  BOARD,
  PIECE_DEFS,
  PIECE_KINDS_ORDERED,
  decodeSetupLayout,
  encodeSetupLayout,
  randomValidSetup,
  validateLayout,
  type Layout,
  type PieceKind,
  type SeatId,
} from '@siguo/shared';
import { Board, SEAT_COLORS } from '../components/Board.js';
import { PieceInspector } from '../components/PieceInspector.js';
import { RankGuide } from '../components/RankGuide.js';
import { useGame } from '../state.js';
import { copyToClipboard } from '../clipboard.js';

const SAVED_KEY = 'siguo:savedLayouts';

interface SavedLayout {
  name: string;
  encoding: string;
  ts: number;
}

function loadSaved(): SavedLayout[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedLayout[];
  } catch {
    return [];
  }
}

function writeSaved(list: SavedLayout[]) {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, 12))); } catch { /* ignore */ }
}

export function Designer() {
  // Layouts are zone-agnostic in encoding, but constraints are evaluated against a
  // concrete seat. We always design as N — the encoded result works for any seat.
  const designSeat: SeatId = 'N';
  const [layout, setLayout] = useState<Layout>({});
  const [pickedKind, setPickedKind] = useState<PieceKind | null>(null);
  const [savedList, setSavedList] = useState<SavedLayout[]>(loadSaved);
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState('');

  const used: Partial<Record<PieceKind, number>> = {};
  for (const k of Object.values(layout)) used[k] = (used[k] ?? 0) + 1;
  const remaining = PIECE_KINDS_ORDERED.map((k) => ({ kind: k, count: PIECE_DEFS[k].count - (used[k] ?? 0) }));

  const placeableCells = useMemo(() => {
    const set = new Set<string>();
    for (const c of BOARD.cells.values()) {
      if (c.zone !== designSeat) continue;
      if (c.type === 'CAMP') continue;
      set.add(c.id);
    }
    return set;
  }, []);

  const setupOccupied = new Set(Object.keys(layout));
  const errs = validateLayout(designSeat, layout);
  const isComplete = errs.length === 0 && Object.keys(layout).length === 25;

  function placePiece(cellId: string) {
    if (!placeableCells.has(cellId)) return;
    if (!pickedKind) {
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
    if (pickedKind === 'JUNQI' && cell.type !== 'HQ') return;
    if (pickedKind === 'DILEI' && cell.row > 2) return;
    if (pickedKind === 'ZHADAN' && cell.row === 6) return;
    const next = { ...layout };
    next[cellId] = pickedKind;
    setLayout(next);
    const remainingAfter = def.count - (usedCount + 1);
    if (remainingAfter <= 0) setPickedKind(null);
  }

  function copyEncoding() {
    if (!isComplete) return;
    const enc = encodeSetupLayout(designSeat, layout);
    copyToClipboard(enc).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    });
  }

  function saveLocally() {
    if (!isComplete) return;
    const enc = encodeSetupLayout(designSeat, layout);
    const next: SavedLayout[] = [
      { name: name.trim() || `Layout ${new Date().toLocaleString()}`, encoding: enc, ts: Date.now() },
      ...savedList.filter((l) => l.encoding !== enc),
    ].slice(0, 12);
    setSavedList(next);
    writeSaved(next);
    setName('');
  }

  function loadFromSaved(s: SavedLayout) {
    try {
      setLayout(decodeSetupLayout(s.encoding, designSeat));
    } catch { /* ignore */ }
  }

  function remove(encoding: string) {
    const next = savedList.filter((l) => l.encoding !== encoding);
    setSavedList(next);
    writeSaved(next);
  }

  const pieces = Object.entries(layout).map(([cellId, kind], i) => ({
    id: `designer-${i}`, cellId, owner: designSeat, kind, frozen: false,
  }));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', height: '100vh' }}>
      <div className="board-container">
        <Board
          pieces={pieces}
          setupPlaceableCells={placeableCells}
          setupOccupiedCells={setupOccupied}
          onCellClick={placePiece}
          viewerSeat={designSeat}
          focusViewerZone
        />
        <PieceInspector
          kind={pickedKind}
          color={SEAT_COLORS[designSeat]}
          label={pickedKind ? 'Click a cell to place' : 'Pick a piece below'}
        />
        <RankGuide />
      </div>
      <div className="col side-panel" style={{ padding: '1rem', background: 'var(--bg-elev)', overflowY: 'auto' }}>
        <h2 style={{ color: SEAT_COLORS[designSeat] }}>Layout designer</h2>
        <div className="muted" style={{ fontSize: 12 }}>
          Design a 25-piece opening layout. The encoded string works for any seat — you can paste it during real-game setup to skip manual placement.
        </div>

        <div className="row" style={{ flexWrap: 'wrap', gap: '0.4rem' }}>
          <button onClick={() => setLayout(randomValidSetup(designSeat))}>Random fill</button>
          <button onClick={() => { setLayout({}); setPickedKind(null); }}>Clear</button>
          <button onClick={copyEncoding} disabled={!isComplete}>
            {copied ? 'Copied ✓' : 'Copy encoding'}
          </button>
        </div>

        <div className="col" style={{ gap: '0.3rem' }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this layout (optional)"
            style={{ fontSize: 12 }}
            maxLength={40}
          />
          <button onClick={saveLocally} disabled={!isComplete}>Save to this browser</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
          {remaining.map(({ kind, count }) => {
            const def = PIECE_DEFS[kind];
            const isPicked = pickedKind === kind;
            return (
              <button
                key={kind}
                onClick={() => setPickedKind(count > 0 ? kind : null)}
                disabled={count === 0}
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

        {savedList.length > 0 && (
          <div style={{ padding: '0.5rem', background: 'var(--bg)', borderRadius: 6 }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Saved layouts</div>
            {savedList.map((s) => (
              <div key={s.encoding} className="row" style={{ justifyContent: 'space-between', gap: '0.3rem', alignItems: 'center', marginBottom: 4 }}>
                <button onClick={() => loadFromSaved(s)} style={{ fontSize: 11, flex: 1, textAlign: 'left' }}>
                  {s.name}
                </button>
                <button onClick={() => remove(s.encoding)} style={{ fontSize: 11 }}>✕</button>
              </div>
            ))}
          </div>
        )}

        <button onClick={() => useGame.setState({ designerMode: false })}>
          ← Back to landing
        </button>
      </div>
    </div>
  );
}
