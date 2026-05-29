// Large zoomed-in view of the currently selected/picked piece. Floats in the
// top-left corner of the board so the small piece glyphs on the board can stay
// tiny while you can still see clearly which one you just clicked.
//
// Layout: Chinese name + English name on top, then a big colored tile rendering
// of the piece (matching the on-board look) below.

import { PIECE_DEFS, type PieceKind } from '@siguo/shared';

interface Props {
  kind: PieceKind | null;
  /** Optional caption below the glyph (e.g. "Selected", "Place this piece"). */
  label?: string | undefined;
  /** Optional accent color (e.g. seat color of the piece's owner). */
  color?: string | undefined;
}

const TILE_SIZE = 96;

export function PieceInspector({ kind, label, color }: Props) {
  const tileColor = color ?? '#6699d9';
  return (
    <div className="piece-inspector" style={color ? { borderTop: `4px solid ${color}` } : undefined}>
      <div className="piece-inspector-name">
        {kind
          ? PIECE_DEFS[kind].chinese
          : <span className="muted" style={{ fontSize: '1rem' }}>none</span>}
      </div>
      <div className="piece-inspector-rank">
        {kind ? PIECE_DEFS[kind].english : <span className="muted">{label ?? 'Click a piece'}</span>}
      </div>
      {kind && (
        <div
          style={{
            marginTop: 10,
            width: TILE_SIZE,
            height: TILE_SIZE,
            borderRadius: 12,
            background: tileColor,
            border: '2px solid #0e1530',
            display: 'grid',
            placeItems: 'center',
            fontFamily: 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif',
            fontWeight: 700,
            fontSize: 44,
            color: '#0e1530',
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
        >
          {PIECE_DEFS[kind].chinese}
        </div>
      )}
      {kind && label && (
        <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>{label}</div>
      )}
    </div>
  );
}
