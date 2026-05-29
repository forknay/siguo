import { describe, it, expect } from 'vitest';
import {
  BOARD,
  ZONES,
  zoneCellId,
  centerCellId,
  getCell,
  getRailNeighbor,
  getRoadNeighbors,
  setupCellsForZone,
} from '../src/board.js';

describe('board geometry', () => {
  it('has 4 zones × 30 + 9 central cells = 129 cells', () => {
    expect(BOARD.cells.size).toBe(4 * 30 + 9);
  });

  it('each zone has 23 stations + 5 camps + 2 HQs', () => {
    for (const zone of ZONES) {
      const cells = Array.from(BOARD.cells.values()).filter((c) => c.zone === zone);
      const stations = cells.filter((c) => c.type === 'STATION').length;
      const camps = cells.filter((c) => c.type === 'CAMP').length;
      const hqs = cells.filter((c) => c.type === 'HQ').length;
      expect(stations).toBe(23);
      expect(camps).toBe(5);
      expect(hqs).toBe(2);
    }
  });

  it('HQs are in row 1 cols 2 and 4', () => {
    for (const zone of ZONES) {
      expect(getCell(zoneCellId(zone, 1, 2)).type).toBe('HQ');
      expect(getCell(zoneCellId(zone, 1, 4)).type).toBe('HQ');
    }
  });

  it('camps form a quincunx', () => {
    for (const zone of ZONES) {
      expect(getCell(zoneCellId(zone, 3, 2)).type).toBe('CAMP');
      expect(getCell(zoneCellId(zone, 3, 4)).type).toBe('CAMP');
      expect(getCell(zoneCellId(zone, 4, 3)).type).toBe('CAMP');
      expect(getCell(zoneCellId(zone, 5, 2)).type).toBe('CAMP');
      expect(getCell(zoneCellId(zone, 5, 4)).type).toBe('CAMP');
    }
  });

  it('HQ cells are not on rail; ring cells are on rail; inner cells are not', () => {
    expect(getCell(zoneCellId('N', 1, 2)).onRail).toBe(false);
    expect(getCell(zoneCellId('N', 2, 3)).onRail).toBe(true);
    expect(getCell(zoneCellId('N', 6, 3)).onRail).toBe(true);
    expect(getCell(zoneCellId('N', 4, 3)).onRail).toBe(false);
    expect(getCell(zoneCellId('N', 3, 1)).onRail).toBe(true);
    expect(getCell(zoneCellId('N', 4, 5)).onRail).toBe(true);
  });

  it('center cells are 3×3 stoppable rail nodes', () => {
    for (let row = 1; row <= 3; row++) {
      for (let col = 1; col <= 3; col++) {
        const c = getCell(centerCellId(row, col));
        expect(c.type).toBe('CENTER');
        expect(c.onRail).toBe(true);
      }
    }
  });
});

describe('road edges', () => {
  it('every orthogonal neighbor inside a zone is a road', () => {
    const c = zoneCellId('N', 3, 3);
    const neighbors = new Set(getRoadNeighbors(c));
    expect(neighbors.has(zoneCellId('N', 2, 3))).toBe(true);
    expect(neighbors.has(zoneCellId('N', 4, 3))).toBe(true);
    expect(neighbors.has(zoneCellId('N', 3, 2))).toBe(true);
    expect(neighbors.has(zoneCellId('N', 3, 4))).toBe(true);
  });

  it('center camp has diagonal X-roads to all 4 corner camps', () => {
    const centerCamp = zoneCellId('N', 4, 3);
    const n = new Set(getRoadNeighbors(centerCamp));
    expect(n.has(zoneCellId('N', 3, 2))).toBe(true);
    expect(n.has(zoneCellId('N', 3, 4))).toBe(true);
    expect(n.has(zoneCellId('N', 5, 2))).toBe(true);
    expect(n.has(zoneCellId('N', 5, 4))).toBe(true);
  });

  it('every camp has 8-directional adjacency (4 orthogonal + 4 diagonal)', () => {
    const cornerCamp = zoneCellId('N', 3, 2);
    const n = new Set(getRoadNeighbors(cornerCamp));
    // Orthogonal neighbors
    expect(n.has(zoneCellId('N', 2, 2))).toBe(true);
    expect(n.has(zoneCellId('N', 4, 2))).toBe(true);
    expect(n.has(zoneCellId('N', 3, 1))).toBe(true);
    expect(n.has(zoneCellId('N', 3, 3))).toBe(true);
    // Diagonals
    expect(n.has(zoneCellId('N', 2, 1))).toBe(true);
    expect(n.has(zoneCellId('N', 2, 3))).toBe(true);
    expect(n.has(zoneCellId('N', 4, 1))).toBe(true);
    expect(n.has(zoneCellId('N', 4, 3))).toBe(true); // diagonal → center camp
  });

  it('center cell C(2,2) is transit-only', () => {
    const cc = getCell(centerCellId(2, 2));
    expect(cc.transitOnly).toBe(true);
    // Other central cells are stoppable (no transitOnly flag).
    expect(getCell(centerCellId(1, 1)).transitOnly).toBeUndefined();
    expect(getCell(centerCellId(3, 3)).transitOnly).toBeUndefined();
  });

  it('no road crosses between zones', () => {
    for (const id of getRoadNeighbors(zoneCellId('N', 6, 3))) {
      expect(getCell(id).zone).toBe('N');
    }
  });

  it('no road touches the central area', () => {
    for (const cell of BOARD.cells.values()) {
      if (cell.zone !== 'C') continue;
      expect(getRoadNeighbors(cell.id)).toHaveLength(0);
    }
  });
});

describe('rail edges', () => {
  it('zone ring cells have rail neighbors on the ring', () => {
    // (N, row 2, col 3): rail east → (N, 2, 4), rail west → (N, 2, 2), south? not on ring inside.
    expect(getRailNeighbor(zoneCellId('N', 2, 3), 'E')).toBe(zoneCellId('N', 2, 4));
    expect(getRailNeighbor(zoneCellId('N', 2, 3), 'W')).toBe(zoneCellId('N', 2, 2));
  });

  it('corner ring cell connects two ring directions', () => {
    // N(2,1) global is x=-2, y=-7. Rail neighbors: east to N(2,2) and south to N(3,1).
    const c = zoneCellId('N', 2, 1);
    expect(getRailNeighbor(c, 'E')).toBe(zoneCellId('N', 2, 2));
    expect(getRailNeighbor(c, 'S')).toBe(zoneCellId('N', 3, 1));
    expect(getRailNeighbor(c, 'N')).toBeUndefined();
    expect(getRailNeighbor(c, 'W')).toBeUndefined();
  });

  it('N front line connects to center top row at cols 1, 3, 5 only', () => {
    // N(6, 1) ↔ C(1, 1); N(6, 3) ↔ C(1, 2); N(6, 5) ↔ C(1, 3).
    expect(getRailNeighbor(zoneCellId('N', 6, 1), 'S')).toBe(centerCellId(1, 1));
    expect(getRailNeighbor(zoneCellId('N', 6, 3), 'S')).toBe(centerCellId(1, 2));
    expect(getRailNeighbor(zoneCellId('N', 6, 5), 'S')).toBe(centerCellId(1, 3));
    // N(6, 2) and N(6, 4) are NOT linked to the center — only ring rail to siblings.
    expect(getRailNeighbor(zoneCellId('N', 6, 2), 'S')).toBeUndefined();
    expect(getRailNeighbor(zoneCellId('N', 6, 4), 'S')).toBeUndefined();
  });

  it('S front line connects via 180°-rotated mapping (S(6,1) ↔ C(3,3))', () => {
    expect(getRailNeighbor(zoneCellId('S', 6, 1), 'N')).toBe(centerCellId(3, 3));
    expect(getRailNeighbor(zoneCellId('S', 6, 3), 'N')).toBe(centerCellId(3, 2));
    expect(getRailNeighbor(zoneCellId('S', 6, 5), 'N')).toBe(centerCellId(3, 1));
  });

  it('center 3×3 connects rook-neighbors with rail edges', () => {
    // C(2,2) is the middle — has neighbors in all 4 directions.
    expect(getRailNeighbor(centerCellId(2, 2), 'N')).toBe(centerCellId(1, 2));
    expect(getRailNeighbor(centerCellId(2, 2), 'S')).toBe(centerCellId(3, 2));
    expect(getRailNeighbor(centerCellId(2, 2), 'E')).toBe(centerCellId(2, 3));
    expect(getRailNeighbor(centerCellId(2, 2), 'W')).toBe(centerCellId(2, 1));
  });

  it('non-rail cells have no rail neighbors', () => {
    expect(BOARD.rails.get(zoneCellId('N', 1, 2))).toBeUndefined(); // HQ
    expect(BOARD.rails.get(zoneCellId('N', 4, 3))).toBeUndefined(); // center camp
    expect(BOARD.rails.get(zoneCellId('N', 3, 3))).toBeUndefined(); // inner station, not on ring
  });
});

describe('setupCellsForZone', () => {
  it('returns 25 placeable cells (23 stations + 2 HQs, no camps) per zone', () => {
    for (const zone of ZONES) {
      const cells = setupCellsForZone(zone);
      expect(cells.length).toBe(25);
      expect(cells.every((c) => c.zone === zone)).toBe(true);
      expect(cells.every((c) => c.type !== 'CAMP')).toBe(true);
    }
  });
});
