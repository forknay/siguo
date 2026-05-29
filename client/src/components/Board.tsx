// SVG board. Renders all cells, road/rail edges, central-corner curves, and pieces.
//
// Coordinate system is the engine's global frame (center at 0,0). Cross-shaped
// playable area runs x ∈ [-8, 8], y ∈ [-8, 8]. Cells are 1 unit apart inside zones
// and 2 units apart in the 3×3 central rail grid. Pieces are SVG <g> elements at
// the cell positions; the viewer's seat is identified by color (see SEAT_COLORS).

import { BOARD, type Cell, type SeatId, type VisiblePiece } from '@siguo/shared';
import { Piece } from './Piece.js';

export const SEAT_COLORS: Record<SeatId, string> = {
  N: '#d96666',
  E: '#66b27a',
  S: '#6699d9',
  W: '#c98ad9',
};

const SEATS: SeatId[] = ['N', 'E', 'S', 'W'];

interface BoardProps {
  pieces: VisiblePiece[];
  legalCells?: ReadonlySet<string>;
  selectedCell?: string | null;
  setupPlaceableCells?: ReadonlySet<string>;
  setupOccupiedCells?: ReadonlySet<string>;
  onCellClick?: (cellId: string) => void;
  flagRevealed?: Record<SeatId, boolean>;
  /** Which seat's turn it is — controls the turn-indicator arrow on that side. */
  currentTurn?: SeatId | null;
  /** Per-seat last move (from→to cell ids). Adds a colored outline glow. */
  lastMoveBySeat?: Partial<Record<SeatId, { from: string; to: string }>>;
  /** Viewer seat — used to rotate the board so the viewer's zone sits at the bottom. */
  viewerSeat?: SeatId | null;
}

/** Degrees of rotation so the given viewer's zone sits at the south of the board. */
function viewerRotation(viewer: SeatId | null | undefined): number {
  switch (viewer) {
    case 'N': return 180;
    case 'E': return 90;   // rotate 90° clockwise → E zone at the bottom
    case 'W': return -90;  // rotate 90° counter-clockwise → W zone at the bottom
    case 'S':
    default:
      return 0;
  }
}

const PAD = 1.0;
const VIEWBOX = `${-8 - PAD} ${-8 - PAD} ${16 + 2 * PAD} ${16 + 2 * PAD}`;

/**
 * The four central corner cells render their two zone-connecting rails as a single
 * smooth quadratic bezier curve instead of two perpendicular line segments. Each
 * entry describes which two front-line cell ids the corner connects and which
 * corner cell is the bezier control point.
 */
const CORNER_CURVES: Array<{ a: string; corner: string; b: string }> = [
  { a: 'W-6-5', corner: 'C-1-1', b: 'N-6-1' },
  { a: 'N-6-5', corner: 'C-1-3', b: 'E-6-1' },
  { a: 'W-6-1', corner: 'C-3-1', b: 'S-6-5' },
  { a: 'E-6-5', corner: 'C-3-3', b: 'S-6-1' },
];

const CORNER_SUPPRESSED_RAILS: ReadonlySet<string> = (() => {
  const s = new Set<string>();
  for (const { a, corner, b } of CORNER_CURVES) {
    s.add(edgeKey(a, corner));
    s.add(edgeKey(corner, b));
  }
  return s;
})();

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function Board(props: BoardProps) {
  const cells = Array.from(BOARD.cells.values());
  const roadEdges = collectRoadEdges();
  const railEdges = collectRailEdges().filter((e) => !CORNER_SUPPRESSED_RAILS.has(e.key));
  const rotation = viewerRotation(props.viewerSeat ?? null);

  return (
    <svg
      viewBox={VIEWBOX}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: '100%', height: '100%', maxHeight: '98vh', display: 'block' }}
    >
    <g transform={`rotate(${rotation})`}>
      <defs>
        <filter id="lastMoveGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.06" />
        </filter>
      </defs>

      {/* Background tint per zone */}
      <g opacity={0.18}>
        <rect x={-2.5} y={-8.5} width={5} height={6} fill={SEAT_COLORS.N} />
        <rect x={-2.5} y={2.5}  width={5} height={6} fill={SEAT_COLORS.S} />
        <rect x={2.5}  y={-2.5} width={6} height={5} fill={SEAT_COLORS.E} />
        <rect x={-8.5} y={-2.5} width={6} height={5} fill={SEAT_COLORS.W} />
        <rect x={-2.5} y={-2.5} width={5} height={5} fill="#1a2a55" />
      </g>

      {/* Turn-indicator arrows on each side of the cross. */}
      <TurnArrows currentTurn={props.currentTurn ?? null} />

      {/* Rail edges first (drawn underneath cells). */}
      <g stroke="#d8e1ff" strokeWidth={0.16} strokeLinecap="round" opacity={0.85}>
        {railEdges.map((e) => (
          <line key={e.key} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} />
        ))}
        {/* Curved central-corner rails as quadratic beziers. */}
        {CORNER_CURVES.map(({ a, corner, b }) => {
          const A = BOARD.cells.get(a)!;
          const P = BOARD.cells.get(corner)!;
          const B = BOARD.cells.get(b)!;
          return (
            <path
              key={`curve-${corner}`}
              d={`M ${A.x} ${A.y} Q ${P.x} ${P.y} ${B.x} ${B.y}`}
              fill="none"
            />
          );
        })}
      </g>
      {/* Rail tie pattern on straight rails. */}
      <g stroke="#cdd6ff" strokeWidth={0.04} opacity={0.6}>
        {railEdges.flatMap((e) => railTicks(e.a, e.b))}
      </g>

      {/* Road edges (thinner). */}
      <g stroke="#6478b8" strokeWidth={0.04} opacity={0.85}>
        {roadEdges.map((e) => (
          <line key={e.key} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} />
        ))}
      </g>

      {/* Last-move highlight rings, drawn behind cells so cell outlines stay sharp. */}
      <g>
        {SEATS.flatMap((seat) => {
          const lm = props.lastMoveBySeat?.[seat];
          if (!lm) return [];
          const from = BOARD.cells.get(lm.from);
          const to = BOARD.cells.get(lm.to);
          const color = SEAT_COLORS[seat];
          const elems: JSX.Element[] = [];
          if (from) {
            elems.push(
              <circle
                key={`lm-from-${seat}`}
                cx={from.x}
                cy={from.y}
                r={0.55}
                fill="none"
                stroke={color}
                strokeWidth={0.06}
                strokeDasharray="0.15 0.1"
                opacity={0.6}
              />,
            );
          }
          if (to) {
            elems.push(
              <circle
                key={`lm-to-${seat}`}
                cx={to.x}
                cy={to.y}
                r={0.55}
                fill="none"
                stroke={color}
                strokeWidth={0.08}
                opacity={0.85}
              />,
            );
          }
          return elems;
        })}
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
              textCounterRotate={-rotation}
            />
          );
        })}
      </g>
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
    // Transit-only center (C-2-2) renders smaller + dashed, signaling no-stop.
    if (cell.transitOnly) {
      return (
        <g style={{ pointerEvents: 'none' }}>
          <circle
            cx={cell.x}
            cy={cell.y}
            r={0.32}
            fill="none"
            stroke="#5a6ea6"
            strokeWidth={0.04}
            strokeDasharray="0.12 0.08"
            opacity={0.7}
          />
          <text
            x={cell.x}
            y={cell.y + 0.05}
            textAnchor="middle"
            fontSize={0.16}
            fill="#7585b0"
            opacity={0.8}
          >
            ⇆
          </text>
        </g>
      );
    }
    return (
      <g onClick={onClick} style={{ cursor: 'pointer' }}>
        <circle
          cx={cell.x}
          cy={cell.y}
          r={0.46}
          fill="#192557"
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

/** Turn-indicator chevrons just outside each player's zone. Active seat lit; others dim. */
function TurnArrows({ currentTurn }: { currentTurn: SeatId | null }) {
  // Position each arrow centered on the outer edge of its zone.
  const arrowSpecs: Array<{ seat: SeatId; cx: number; cy: number; rotate: number }> = [
    { seat: 'N', cx: 0, cy: -8.6, rotate: 90 },   // pointing south into N zone (down into board)
    { seat: 'S', cx: 0, cy: 8.6, rotate: -90 },   // pointing north into S zone
    { seat: 'E', cx: 8.6, cy: 0, rotate: 180 },   // pointing west into E zone
    { seat: 'W', cx: -8.6, cy: 0, rotate: 0 },    // pointing east into W zone
  ];
  return (
    <g>
      {arrowSpecs.map(({ seat, cx, cy, rotate }) => {
        const active = currentTurn === seat;
        const color = SEAT_COLORS[seat];
        return (
          <g
            key={seat}
            transform={`translate(${cx} ${cy}) rotate(${rotate})`}
            opacity={active ? 1 : 0.18}
          >
            {/* A simple triangle chevron */}
            <polygon
              points="-0.35,-0.35 0.4,0 -0.35,0.35"
              fill={color}
              stroke="#0e1530"
              strokeWidth={0.04}
            />
            {/* Seat label hidden to keep the arrow clean — color identifies it. */}
          </g>
        );
      })}
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
      const key = edgeKey(aId, bId);
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
      const key = edgeKey(aId, bId);
      if (seen.has(key)) continue;
      seen.add(key);
      const b = BOARD.cells.get(bId)!;
      out.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, key });
    }
  }
  return out;
}

function railTicks(a: Vec, b: Vec): JSX.Element[] {
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
