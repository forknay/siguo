// Bottom-left rank-order guide. Higher pieces beat lower pieces in plain combat;
// engineer/bomb/mine have special abilities described in the README and are
// included here without their special behaviour written out — that's intentional
// per the spec (the guide shows simple rank order only).

import { PIECE_DEFS, PIECE_KINDS_ORDERED } from '@siguo/shared';

export function RankGuide() {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        left: 12,
        background: 'rgba(15, 21, 48, 0.85)',
        border: '1px solid #2d3a6e',
        borderRadius: 10,
        padding: '0.55rem 0.65rem',
        pointerEvents: 'none',
        fontSize: 11,
        lineHeight: 1.3,
      }}
    >
      <div style={{ color: 'var(--muted)', fontSize: 10, marginBottom: 4 }}>
        Strength (high → low)
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', columnGap: 6, rowGap: 1 }}>
        {PIECE_KINDS_ORDERED.map((kind) => {
          const def = PIECE_DEFS[kind];
          const isSpecial = kind === 'ZHADAN' || kind === 'DILEI' || kind === 'JUNQI';
          return (
            <RowGuide
              key={kind}
              chinese={def.chinese}
              english={def.english}
              dim={isSpecial}
            />
          );
        })}
      </div>
      <div style={{ marginTop: 6, color: 'var(--muted)', fontSize: 10 }}>
        工兵 disarms 地雷 · 炸弹 = mutual
      </div>
    </div>
  );
}

function RowGuide({ chinese, english, dim }: { chinese: string; english: string; dim: boolean }) {
  return (
    <>
      <span
        style={{
          fontFamily: 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif',
          fontWeight: 600,
          color: dim ? 'var(--accent)' : 'var(--text)',
        }}
      >
        {chinese}
      </span>
      <span style={{ color: 'var(--muted)' }}>{english}</span>
    </>
  );
}
