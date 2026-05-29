// Board geometry for Si Guo Jun Qi.
// Four player zones (N/E/S/W) arranged around a central rail grid.
// Each zone is a 5-col × 6-row grid with row 1 = back (HQ row) and row 6 = front line.
// The central area is a 3×3 grid of stoppable rail cells (the 九宫 / "nine palaces"),
// connected to each zone's front-line cells at cols 1, 3, and 5 only.
//
// Global coordinate system (origin at the board center; x east-positive, y south-positive):
//   Central cells C(row=1..3, col=1..3): x = 2*(col-2), y = 2*(row-2)
//     → e.g. C(1,1) at (-2,-2), C(2,2) at (0,0), C(3,3) at (2,2)
//   Zone N (north of center):       N(r,c) at x = c - 3,  y = r - 9
//   Zone S (south, rotated 180°):   S(r,c) at x = 3 - c,  y = 9 - r
//   Zone E (east, rotated 90° CCW): E(r,c) at x = 9 - r,  y = c - 3
//   Zone W (west, rotated 90° CW):  W(r,c) at x = r - 9,  y = 3 - c
//
// Rails connect cells in global N/E/S/W directions. A non-engineer rail slide picks one
// direction at the start and may not turn; an engineer may turn freely. See moves.ts.
// Pieces MAY stop on central cells.

export const ZONES = ['N', 'E', 'S', 'W'] as const;
export type ZoneId = (typeof ZONES)[number];
export type SeatId = ZoneId;
export type GameMode = '2v2' | 'ffa';

export const DIRECTIONS = ['N', 'E', 'S', 'W'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export type CellType = 'STATION' | 'CAMP' | 'HQ' | 'CENTER';

export interface Cell {
  id: string;
  zone: ZoneId | 'C';
  row: number;
  col: number;
  x: number;
  y: number;
  type: CellType;
  onRail: boolean;
  /** Pieces may move THROUGH this cell along the rail but cannot stop on it.
   *  Used for the center-center junction C(2,2). */
  transitOnly?: boolean;
}

export type RailNeighbors = Partial<Record<Direction, string>>;

export interface BoardGraph {
  cells: Map<string, Cell>;
  /** Undirected adjacency list of road edges (a→b implies b→a). */
  roads: Map<string, Set<string>>;
  /** Per-cell rail neighbor in each global direction. */
  rails: Map<string, RailNeighbors>;
}

/** Return the cell id for a zone-local position. */
export function zoneCellId(zone: ZoneId, row: number, col: number): string {
  return `${zone}-${row}-${col}`;
}

/** Return the cell id for a central-area position (row/col 1..3). */
export function centerCellId(row: number, col: number): string {
  return `C-${row}-${col}`;
}

function zonePosition(zone: ZoneId, row: number, col: number): { x: number; y: number } {
  switch (zone) {
    case 'N':
      return { x: col - 3, y: row - 9 };
    case 'S':
      return { x: 3 - col, y: 9 - row };
    case 'E':
      return { x: 9 - row, y: col - 3 };
    case 'W':
      return { x: row - 9, y: 3 - col };
  }
}

function centerPosition(row: number, col: number): { x: number; y: number } {
  return { x: 2 * (col - 2), y: 2 * (row - 2) };
}

function classifyZoneCell(row: number, col: number): CellType {
  if (row === 1 && (col === 2 || col === 4)) return 'HQ';
  if ((row === 3 || row === 5) && (col === 2 || col === 4)) return 'CAMP';
  if (row === 4 && col === 3) return 'CAMP';
  return 'STATION';
}

function cellOnRailWithinZone(row: number, col: number): boolean {
  // Ring railroad runs along row 2, row 6, cols 1 & 5 (within rows 2-6 only).
  if (row === 1) return false;
  return row === 2 || row === 6 || col === 1 || col === 5;
}

/** Build the canonical board graph. Constructed once at module load. */
function buildBoard(): BoardGraph {
  const cells = new Map<string, Cell>();
  const roads = new Map<string, Set<string>>();
  const rails = new Map<string, RailNeighbors>();

  // 1. Generate zone cells.
  for (const zone of ZONES) {
    for (let row = 1; row <= 6; row++) {
      for (let col = 1; col <= 5; col++) {
        const id = zoneCellId(zone, row, col);
        const type = classifyZoneCell(row, col);
        const { x, y } = zonePosition(zone, row, col);
        const onRail = type !== 'HQ' && cellOnRailWithinZone(row, col);
        cells.set(id, { id, zone, row, col, x, y, type, onRail });
      }
    }
  }

  // 2. Generate central cells: 3×3 grid of stoppable rail nodes. The very center
  //    C(2,2) is transit-only — pieces may pass through but cannot rest there.
  for (let row = 1; row <= 3; row++) {
    for (let col = 1; col <= 3; col++) {
      const id = centerCellId(row, col);
      const { x, y } = centerPosition(row, col);
      const transitOnly = row === 2 && col === 2;
      const cell: Cell = { id, zone: 'C', row, col, x, y, type: 'CENTER', onRail: true };
      if (transitOnly) cell.transitOnly = true;
      cells.set(id, cell);
    }
  }

  // 3. Road edges: orthogonal adjacency within zones + diagonal X-roads around camps.
  const addRoad = (a: string, b: string) => {
    if (!roads.has(a)) roads.set(a, new Set());
    if (!roads.has(b)) roads.set(b, new Set());
    roads.get(a)!.add(b);
    roads.get(b)!.add(a);
  };
  for (const zone of ZONES) {
    for (let row = 1; row <= 6; row++) {
      for (let col = 1; col <= 5; col++) {
        const here = zoneCellId(zone, row, col);
        if (col < 5) addRoad(here, zoneCellId(zone, row, col + 1));
        if (row < 6) addRoad(here, zoneCellId(zone, row + 1, col));
      }
    }
    // 8-directional adjacency from every camp (行营), not just the center one.
    // The four corner camps and the center camp each gain road edges to their
    // four diagonal neighbors (in addition to the orthogonal road edges from
    // the loop above).
    const campDiagonals: Array<[number, number, Array<[number, number]>]> = [
      // [campRow, campCol, [(diagRow, diagCol), ...]]
      [3, 2, [[2, 1], [2, 3], [4, 1], [4, 3]]],
      [3, 4, [[2, 3], [2, 5], [4, 3], [4, 5]]],
      [4, 3, [[3, 2], [3, 4], [5, 2], [5, 4]]],
      [5, 2, [[4, 1], [4, 3], [6, 1], [6, 3]]],
      [5, 4, [[4, 3], [4, 5], [6, 3], [6, 5]]],
    ];
    for (const [cRow, cCol, diagonals] of campDiagonals) {
      const campId = zoneCellId(zone, cRow, cCol);
      for (const [dRow, dCol] of diagonals) {
        addRoad(campId, zoneCellId(zone, dRow, dCol));
      }
    }
  }

  // 4. Rail edges — built explicitly (no longer derived purely from global adjacency
  //    because central cells are 2 units apart from each other).
  const addRail = (from: string, to: string, dir: Direction) => {
    if (!rails.has(from)) rails.set(from, {});
    rails.get(from)![dir] = to;
  };
  const linkRail = (a: string, b: string, dirAtoB: Direction) => {
    addRail(a, b, dirAtoB);
    addRail(b, a, oppositeDirection(dirAtoB));
  };

  // 4a. Zone ring rails — adjacent ring cells within a zone (orthogonal, distance 1).
  for (const zone of ZONES) {
    for (let row = 1; row <= 6; row++) {
      for (let col = 1; col <= 5; col++) {
        if (!cellOnRailWithinZone(row, col)) continue;
        const here = zoneCellId(zone, row, col);
        // East neighbor on ring?
        if (col < 5 && cellOnRailWithinZone(row, col + 1)) {
          const eastId = zoneCellId(zone, row, col + 1);
          const a = cells.get(here)!;
          const b = cells.get(eastId)!;
          const dir = directionFromTo(a, b);
          if (dir) addRail(here, eastId, dir);
        }
        // South neighbor on ring?
        if (row < 6 && cellOnRailWithinZone(row + 1, col)) {
          const southId = zoneCellId(zone, row + 1, col);
          const a = cells.get(here)!;
          const b = cells.get(southId)!;
          const dir = directionFromTo(a, b);
          if (dir) addRail(here, southId, dir);
        }
      }
    }
  }
  // Also add the reverse direction edges (we only added one direction above).
  // Easiest: walk the rails map and ensure each edge is symmetric.
  const railSnapshot = new Map<string, RailNeighbors>();
  for (const [k, v] of rails) railSnapshot.set(k, { ...v });
  for (const [from, dirs] of railSnapshot) {
    for (const dir of DIRECTIONS) {
      const to = dirs[dir];
      if (!to) continue;
      const back = oppositeDirection(dir);
      if (!rails.get(to)?.[back]) addRail(to, from, back);
    }
  }

  // 4b. Central 3×3 grid rails — rook neighbors connect with explicit directions.
  for (let row = 1; row <= 3; row++) {
    for (let col = 1; col <= 3; col++) {
      const here = centerCellId(row, col);
      if (col < 3) linkRail(here, centerCellId(row, col + 1), 'E');
      if (row < 3) linkRail(here, centerCellId(row + 1, col), 'S');
    }
  }

  // 4c. Zone front lines connect to the center at cols 1, 3, 5 only.
  // Mapping per zone:
  //   N(6, 1) ↔ C(1, 1), N(6, 3) ↔ C(1, 2), N(6, 5) ↔ C(1, 3)
  //   S(6, 1) ↔ C(3, 3), S(6, 3) ↔ C(3, 2), S(6, 5) ↔ C(3, 1)   (S col 1 = east globally)
  //   E(6, 1) ↔ C(1, 3), E(6, 3) ↔ C(2, 3), E(6, 5) ↔ C(3, 3)
  //   W(6, 1) ↔ C(3, 1), W(6, 3) ↔ C(2, 1), W(6, 5) ↔ C(1, 1)
  const frontConnections: Array<[ZoneId, number, number, number]> = [
    // [zone, frontCol, centerRow, centerCol]
    ['N', 1, 1, 1], ['N', 3, 1, 2], ['N', 5, 1, 3],
    ['S', 1, 3, 3], ['S', 3, 3, 2], ['S', 5, 3, 1],
    ['E', 1, 1, 3], ['E', 3, 2, 3], ['E', 5, 3, 3],
    ['W', 1, 3, 1], ['W', 3, 2, 1], ['W', 5, 1, 1],
  ];
  for (const [zone, frontCol, cRow, cCol] of frontConnections) {
    const frontId = zoneCellId(zone, 6, frontCol);
    const centerId = centerCellId(cRow, cCol);
    const front = cells.get(frontId)!;
    const center = cells.get(centerId)!;
    const dirFront = directionFromTo(front, center)!;
    linkRail(frontId, centerId, dirFront);
  }

  return { cells, roads, rails };
}

function directionFromTo(from: Cell, to: Cell): Direction | undefined {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy < 0) return 'N';
  if (dx === 0 && dy > 0) return 'S';
  if (dx > 0 && dy === 0) return 'E';
  if (dx < 0 && dy === 0) return 'W';
  return undefined;
}

export function oppositeDirection(d: Direction): Direction {
  return d === 'N' ? 'S' : d === 'S' ? 'N' : d === 'E' ? 'W' : 'E';
}

export const BOARD: BoardGraph = buildBoard();

export function setupCellsForZone(zone: ZoneId): Cell[] {
  const out: Cell[] = [];
  for (const cell of BOARD.cells.values()) {
    if (cell.zone === zone && cell.type !== 'CAMP') out.push(cell);
  }
  return out;
}

export function getCell(id: string): Cell {
  const c = BOARD.cells.get(id);
  if (!c) throw new Error(`Unknown cell id: ${id}`);
  return c;
}

export function getRailNeighbor(id: string, dir: Direction): string | undefined {
  return BOARD.rails.get(id)?.[dir];
}

export function getRoadNeighbors(id: string): string[] {
  return Array.from(BOARD.roads.get(id) ?? []);
}
