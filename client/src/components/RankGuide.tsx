// Bottom-left rank-order guide. Collapsible (− / +) so it can be tucked away
// when it overlaps the board on small screens. Preference persists in localStorage.

import { useState } from 'react';
import { PIECE_DEFS, PIECE_KINDS_ORDERED } from '@siguo/shared';

const STORAGE_KEY = 'siguo:rankGuide:collapsed';

function initialCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function RankGuide() {
  const [collapsed, setCollapsed] = useState<boolean>(initialCollapsed);
  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }

  return (
    <div className="rank-guide" style={{ minWidth: collapsed ? 0 : 120 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="muted" style={{ fontSize: 10 }}>
          {collapsed ? 'Strength' : 'Strength (high → low)'}
        </span>
        <button
          onClick={toggle}
          aria-label={collapsed ? 'Expand' : 'Collapse'}
          style={{
            width: 22,
            height: 22,
            padding: 0,
            border: '1px solid #2d3a6e',
            background: 'transparent',
            color: 'var(--text)',
            borderRadius: 4,
            fontSize: 14,
            lineHeight: 1,
            cursor: 'pointer',
            pointerEvents: 'auto',
          }}
        >
          {collapsed ? '+' : '−'}
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="rank-guide-list" style={{ marginTop: 6 }}>
            {PIECE_KINDS_ORDERED.map((kind) => {
              const def = PIECE_DEFS[kind];
              const isSpecial = kind === 'ZHADAN' || kind === 'DILEI' || kind === 'JUNQI';
              return (
                <div key={kind} className="rank-guide-item">
                  <span
                    style={{
                      fontFamily: 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif',
                      fontWeight: 600,
                      color: isSpecial ? 'var(--accent)' : 'var(--text)',
                    }}
                  >
                    {def.chinese}
                  </span>
                  <span className="muted">{def.english}</span>
                </div>
              );
            })}
          </div>
          <div className="muted" style={{ marginTop: 6, fontSize: 10 }}>
            工兵 disarms 地雷 · 炸弹 = mutual
          </div>
        </>
      )}
    </div>
  );
}
