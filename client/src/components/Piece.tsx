// Piece token with multi-leg animated movement along the engine's pathOfMove
// result. When the cellId changes, Piece looks up the path (e.g. [from, mid1,
// mid2, ..., to] for an engineer multi-corner BFS) and animates the SVG
// transform along each leg sequentially with eased interpolation. Non-engineer
// straight slides and road steps still animate, just with fewer waypoints.

import { useEffect, useRef, useState } from 'react';
import { BOARD, PIECE_DEFS, pathOfMove, type PieceKind } from '@siguo/shared';

interface PieceProps {
  cellId: string;
  x: number;
  y: number;
  kind: PieceKind | null;
  ownerColor: string;
  frozen: boolean;
  revealed: boolean;
  /** Rotation (degrees) for the parent board; text counter-rotates to stay upright. */
  textCounterRotate?: number;
}

/** Total animation budget per move (ms). Distributed across legs by distance. */
const TOTAL_DURATION_MS = 420;
const MIN_DURATION_MS = 180;
const MAX_DURATION_MS = 900;

interface Vec { x: number; y: number; }

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function Piece({
  cellId, x, y, kind, ownerColor, frozen, revealed, textCounterRotate = 0,
}: PieceProps) {
  const size = 0.68;
  const opacity = frozen ? 0.5 : 1;

  // Animated position (renders the transform). Initially equals target.
  const [pos, setPos] = useState<Vec>({ x, y });
  const prevCellId = useRef(cellId);
  const rafId = useRef<number | null>(null);

  useEffect(() => {
    if (prevCellId.current === cellId) {
      // No move; keep pos in sync if (x,y) changed because the board was rotated.
      setPos({ x, y });
      return;
    }

    // Look up the engine's path through the rail/road graph.
    const pathIds = pathOfMove(prevCellId.current, cellId);
    const waypoints: Vec[] = pathIds
      .map((id) => BOARD.cells.get(id))
      .filter((c): c is NonNullable<typeof c> => !!c)
      .map((c) => ({ x: c.x, y: c.y }));

    if (waypoints.length < 2) {
      // Nothing to animate; snap.
      setPos({ x, y });
      prevCellId.current = cellId;
      return;
    }

    // Total distance for time-budgeting.
    let totalDist = 0;
    for (let i = 1; i < waypoints.length; i++) {
      const a = waypoints[i - 1]!;
      const b = waypoints[i]!;
      totalDist += Math.hypot(b.x - a.x, b.y - a.y);
    }
    const speed = totalDist > 0 ? totalDist / TOTAL_DURATION_MS : 0;
    const duration = totalDist > 0
      ? Math.max(MIN_DURATION_MS, Math.min(MAX_DURATION_MS, totalDist / speed))
      : MIN_DURATION_MS;

    const startTs = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startTs;
      const t = Math.min(1, elapsed / duration);
      const eased = easeInOut(t);
      const targetDist = eased * totalDist;
      // Walk segments and interpolate.
      let acc = 0;
      let placed = false;
      for (let i = 1; i < waypoints.length; i++) {
        const a = waypoints[i - 1]!;
        const b = waypoints[i]!;
        const segLen = Math.hypot(b.x - a.x, b.y - a.y);
        if (acc + segLen >= targetDist || i === waypoints.length - 1) {
          const u = segLen > 0 ? Math.min(1, (targetDist - acc) / segLen) : 1;
          setPos({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
          placed = true;
          break;
        }
        acc += segLen;
      }
      if (!placed) {
        const last = waypoints[waypoints.length - 1]!;
        setPos({ x: last.x, y: last.y });
      }
      if (t < 1) {
        rafId.current = requestAnimationFrame(tick);
      } else {
        setPos({ x, y });
        prevCellId.current = cellId;
        rafId.current = null;
      }
    };
    rafId.current = requestAnimationFrame(tick);
    return () => {
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    };
  }, [cellId, x, y]);

  return (
    <g
      transform={`translate(${pos.x},${pos.y})`}
      opacity={opacity}
      pointerEvents="none"
    >
      <rect
        x={-size / 2}
        y={-size / 2}
        width={size}
        height={size}
        rx={0.1}
        ry={0.1}
        fill={ownerColor}
        stroke="#0e1530"
        strokeWidth={0.04}
      />
      {revealed && kind ? (
        <text
          x={0}
          y={0.08}
          textAnchor="middle"
          fontSize={0.28}
          fill="#0e1530"
          fontWeight={700}
          transform={textCounterRotate ? `rotate(${textCounterRotate})` : undefined}
          style={{ fontFamily: 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif' }}
        >
          {PIECE_DEFS[kind].chinese}
        </text>
      ) : (
        <g>
          <rect
            x={-size / 2 + 0.1}
            y={-size / 2 + 0.1}
            width={size - 0.2}
            height={size - 0.2}
            rx={0.05}
            ry={0.05}
            fill="none"
            stroke="#0e1530"
            strokeOpacity={0.45}
            strokeWidth={0.03}
          />
        </g>
      )}
    </g>
  );
}
