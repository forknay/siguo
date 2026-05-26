// Large zoomed-in view of the currently selected/picked piece. Floats in the
// top-left corner of the board so the small piece glyphs on the board don't have
// to be readable up close.

import { PIECE_DEFS, type PieceKind } from '@siguo/shared';

interface Props {
  kind: PieceKind | null;
  /** Display label below the glyph, e.g. "Selected" or "Place this piece". */
  label?: string;
  /** Override the tile color (e.g. seat color of the owner). */
  color?: string;
}

export function PieceInspector({ kind, label, color }: Props) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        background: 'rgba(15, 21, 48, 0.85)',
        border: '1px solid #2d3a6e',
        borderRadius: 10,
        padding: '0.6rem 0.8rem',
        pointerEvents: 'none',
        minWidth: 110,
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 84,
          height: 84,
          margin: '0 auto',
          borderRadius: 10,
          background: kind ? color ?? '#6699d9' : 'transparent',
          border: kind ? '2px solid #0e1530' : '1px dashed #3a4a82',
          display: 'grid',
          placeItems: 'center',
          fontFamily: 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif',
          fontWeight: 700,
          fontSize: 36,
          color: '#0e1530',
        }}
      >
        {kind ? PIECE_DEFS[kind].chinese : <span style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 400 }}>none</span>}
      </div>
      <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text)' }}>
        {kind ? PIECE_DEFS[kind].english : <span className="muted">{label ?? 'Click a piece'}</span>}
      </div>
      {kind && label && (
        <div style={{ fontSize: 10, color: 'var(--muted)' }}>{label}</div>
      )}
    </div>
  );
}
