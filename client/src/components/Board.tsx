// SVG board. Renders all cells, road/rail edges, and pieces.
//
// Coordinate system is the engine's global frame (center at 0,0). We use a viewBox of
// (-8.7, -8.7, 17.4, 17.4); cells are 1 unit apart and ~0.7 units wide. The board is
// rendered with no rotation; the viewer's seat is identified by color (see SEAT_COLORS).

import { BOARD, type Cell } from '@siguo/shared';
import type { VisiblePiece, SeatId } from '@siguo/shared';
import { Piece } from './Piece.js';

export const SEAT_COLORS: Record<SeatId, string> = {
  N: '#d96666',
  E: '#66b27a',
  S: '#6699d9',
  W: '#c98ad9',
};

interface BoardProps {
  pieces: VisiblePiece[];
  /** Cell ids currently legal as destinations (highlighted). */
  legalCells?: ReadonlySet<string>;
  /** Cell id currently selected (the piece chosen to move). */
  selectedCell?: string | null;
  /** Cells in the viewer's zone that are valid setup placements (highlight in setup). */
  setupPlaceableCells?: ReadonlySet<string>;
  /** Cells already containing a piece during setup (own pieces). */
  setupOccupiedCells?: ReadonlySet<string>;
  onCellClick?: (cellId: string) => void;
  flagRevealed?: Record<SeatId, boolean>;
}

// Tight viewBox — minimal padding so cells render large. Width and height are
// driven entirely by the parent container (Play/Setup use a wider grid column
// for the board now), so the SVG fills the available space.
const PAD = 0.3;
const VIEWBOX = `${-8 - PAD} ${-8 - PAD} ${16 + 2 * PAD} ${16 + 2 * PAD}`;

export function Board(props: BoardProps) {
  const cells = Array.from(BOARD.cells.values());
  const roadEdges = collectRoadEdges();
  const railEdges = collectRailEdges();

  return (
    <svg
      viewBox={VIEWBOX}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: '100%', height: '100%', maxHeight: '98vh', display: 'block' }}
    >
      {/* Background tint per zone */}
      <g opacity={0.18}>
        <rect x={-2.5} y={-8.5} width={5}   height={6}   fill={SEAT_COLORS.N} />
        <rect x={-2.5} y={2.5}  width={5}   height={6}   fill={SEAT_COLORS.S} />
        <rect x={2.5}  y={-2.5} width={6}   height={5}   fill={SEAT_COLORS.E} />
        <rect x={-8.5} y={-2.5} width={6}   height={5}   fill={SEAT_COLORS.W} />
        <rect x={-2.5} y={-2.5} width={5}   height={5}   fill="#1a2a55" />
      </g>

      {/* Rail edges first (drawn underneath cells). */}
      <g stroke="#d8e1ff" strokeWidth={0.16} strokeLinecap="round" opacity={0.85}>
        {railEdges.map((e) => (
          <line key={e.key} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} />
        ))}
      </g>
      {/* Rail "tie" pattern: short ticks perpendicular to the rail line, drawn lightly */}
      <g stroke="#cdd6ff" strokeWidth={0.04} opacity={0.6}>
        {railEdges.flatMap((e) => railTicks(e.a, e.b))}
      </g>

      {/* Road edges (thinner). */}
      <g stroke="#6478b8" strokeWidth={0.04} opacity={0.85}>
        {roadEdges.map((e) => (
          <line key={e.key} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} />
        ))}
      </g>

      {/* Cells */}
      <g>
        {cells.map((c) => (
          <CellShape
            key={c.id}
            cell={c}
            legal={props.legalCells?.has(c.id) ?? false}
            selected={props.selectedCell === c.id}
            setupPlaceable={props.setupPlaceableCells?.has(c.id) ?? false}
            setupOccupied={props.setupOccupiedCells?.has(c.id) ?? false}
            onClick={() => props.onCellClick?.(c.id)}
          />
        ))}
      </g>

      {/* Pieces */}
      <g>
        {props.pieces.map((p) => {
          const cell = BOARD.cells.get(p.cellId);
          if (!cell) return null;
          return (
            <Piece
              key={p.id}
              x={cell.x}
              y={cell.y}
              kind={p.kind}
              ownerColor={SEAT_COLORS[p.owner]}
              frozen={p.frozen}
              revealed={p.kind !== null}
            />
          );
        })}
      </g>
    </svg>
  );
}

interface CellShapeProps {
  cell: Cell;
  legal: boolean;
  selected: boolean;
  setupPlaceable: boolean;
  setupOccupied: boolean;
  onClick: () => void;
}

function CellShape({ cell, legal, selected, setupPlaceable, setupOccupied, onClick }: CellShapeProps) {
  const stroke = selected ? '#ffd24c' : legal ? '#7ad8ff' : setupPlaceable ? '#9bb0e6' : '#3a4a82';
  const fill = cell.type === 'CENTER'
    ? 'transparent'
    : cell.type === 'HQ'
      ? '#2c3a72'
      : cell.type === 'CAMP'
        ? '#384878'
        : '#1f2c5c';

  if (cell.type === 'CENTER') {
    return (
      <g onClick={onClick} style={{ cursor: 'pointer' }}>
        <circle
          cx={cell.x}
          cy={cell.y}
          r={0.46}
          fill={fill === 'transparent' ? '#192557' : fill}
          stroke={stroke}
          strokeWidth={selected || legal ? 0.06 : 0.025}
          opacity={0.9}
        />
        <circle cx={cell.x} cy={cell.y} r={0.1} fill="#d8e1ff" opacity={0.5} />
      </g>
    );
  }

  if (cell.type === 'CAMP') {
    return (
      <circle
        cx={cell.x}
        cy={cell.y}
        r={0.36}
        fill={fill}
        stroke={stroke}
        strokeWidth={selected || legal ? 0.06 : 0.025}
        onClick={onClick}
        style={{ cursor: 'pointer' }}
      />
    );
  }

  // Station / HQ rounded rect.
  const size = 0.78;
  const rx = cell.type === 'HQ' ? 0.18 : 0.12;
  return (
    <g onClick={onClick} style={{ cursor: 'pointer' }}>
      <rect
        x={cell.x - size / 2}
        y={cell.y - size / 2}
        width={size}
        height={size}
        rx={rx}
        ry={rx}
        fill={fill}
        stroke={stroke}
        strokeWidth={selected || legal || setupPlaceable ? 0.06 : 0.025}
      />
      {cell.type === 'HQ' && (
        <text
          x={cell.x}
          y={cell.y + 0.28}
          textAnchor="middle"
          fontSize={0.12}
          fill="#98a2c4"
        >
          HQ
        </text>
      )}
      {setupOccupied && (
        <circle cx={cell.x + 0.3} cy={cell.y - 0.3} r={0.07} fill="#7ad8ff" />
      )}
    </g>
  );
}

interface Vec { x: number; y: number; }

function collectRoadEdges(): Array<{ a: Vec; b: Vec; key: string }> {
  const seen = new Set<string>();
  const out: Array<{ a: Vec; b: Vec; key: string }> = [];
  for (const [aId, neighbors] of BOARD.roads) {
    const a = BOARD.cells.get(aId)!;
    for (const bId of neighbors) {
      const key = aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const b = BOARD.cells.get(bId)!;
      out.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, key });
    }
  }
  return out;
}

function collectRailEdges(): Array<{ a: Vec; b: Vec; key: string }> {
  const seen = new Set<string>();
  const out: Array<{ a: Vec; b: Vec; key: string }> = [];
  for (const [aId, dirs] of BOARD.rails) {
    const a = BOARD.cells.get(aId)!;
    for (const bId of Object.values(dirs)) {
      if (!bId) continue;
      const key = aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const b = BOARD.cells.get(bId)!;
      out.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, key });
    }
  }
  return out;
}

function railTicks(a: Vec, b: Vec): JSX.Element[] {
  // Draw a few short perpendicular ticks to suggest railroad ties.
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return [];
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy * 0.18;
  const py = ux * 0.18;
  const ticks: JSX.Element[] = [];
  const n = Math.max(1, Math.round(len * 3));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const cx = a.x + dx * t;
    const cy = a.y + dy * t;
    ticks.push(
      <line
        key={`${a.x},${a.y}-${b.x},${b.y}-${i}`}
        x1={cx - px}
        y1={cy - py}
        x2={cx + px}
        y2={cy + py}
      />,
    );
  }
  return ticks;
}
