(() => {
'use strict';
const CELL_W = 62;
const CELL_H = 50;
const MAX_ARC_SEATS = 99;
const MIN_ANGLE = 30;
const MAX_ANGLE = 360;
const MIN_DRAW_RADIUS = CELL_W * 1.5;
const FAN_ANGLE = 120;
const ROUND_ANGLE = 330;

const KINDS = ['chair', 'desk', 'pew', 'extra'];

function normalizeKind(kind) {
  return KINDS.includes(kind) ? kind : 'chair';
}

function normalizeShape(shape) {
  return shape === 'arc' ? 'arc' : 'grid';
}

function kindName(kind) {
  return { desk: '책상 의자', pew: '장의자', extra: '보조 의자' }[kind] || '1인 의자';
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

class SeatGeometry {
  constructor(shape, angle, rows, cols) {
    this.isArc = normalizeShape(shape) === 'arc';
    this.angle = this.isArc ? clamp(angle | 0, MIN_ANGLE, MAX_ANGLE) : 0;
    this.rows = Math.max(1, rows | 0);
    this.cols = Math.max(1, cols | 0);

    if (this.isArc) {
      this.sweep = this.angle * Math.PI / 180;
      this.countRadius = this.cols * CELL_W / this.sweep;
      this.innerRadius = Math.max(this.countRadius, MIN_DRAW_RADIUS - 0.5 * CELL_H);
    } else {
      this.sweep = 0;
      this.countRadius = 0;
      this.innerRadius = 0;
    }
  }

  static forFloor(floor) {
    return new SeatGeometry(floor.shape, floor.angle, floor.rows, floor.cols);
  }

  capacity(row) {
    if (!this.isArc) return this.cols;
    if (row < 0) return 0;
    const count = Math.floor(this.sweep * (this.countRadius + (row + 0.5) * CELL_H) / CELL_W + 1e-9);
    return clamp(count, 1, MAX_ARC_SEATS);
  }

  contains(row, col) {
    return row >= 0 && row < this.rows && col >= 0 && col < this.capacity(row);
  }

  rowRadius(row) {
    return this.innerRadius + (row + 0.5) * CELL_H;
  }

  angleOf(row, col) {
    if (!this.isArc) return 0;
    return (col + 0.5 - this.capacity(row) / 2) * CELL_W / this.rowRadius(row);
  }

  place(row, col) {
    if (!this.isArc) {
      return { x: (col + 0.5) * CELL_W, y: (row + 0.5) * CELL_H, rotation: 0 };
    }
    const radius = this.rowRadius(row);
    const phi = this.angleOf(row, col);
    return { x: radius * Math.sin(phi), y: radius * Math.cos(phi), rotation: -phi * 180 / Math.PI };
  }

  hit(x, y, clampToBoard = false) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    let row;
    let col;

    if (!this.isArc) {
      row = Math.floor(y / CELL_H);
      col = Math.floor(x / CELL_W);
    } else {
      const distance = Math.sqrt(x * x + y * y);
      row = Math.floor((distance - this.innerRadius) / CELL_H);
      if (clampToBoard) row = clamp(row, 0, this.rows - 1);
      if (row < 0 || row >= this.rows) return null;
      const phi = Math.atan2(x, y);
      col = Math.floor(phi * this.rowRadius(row) / CELL_W + this.capacity(row) / 2);
    }

    if (clampToBoard) {
      row = clamp(row, 0, this.rows - 1);
      col = clamp(col, 0, this.capacity(row) - 1);
    }

    return this.contains(row, col) ? { row, col } : null;
  }

  cellsBetween(row1, col1, row2, col2) {
    const cells = [];
    const top = clamp(Math.min(row1, row2), 0, this.rows - 1);
    const bottom = clamp(Math.max(row1, row2), 0, this.rows - 1);

    if (!this.isArc) {
      const left = clamp(Math.min(col1, col2), 0, this.cols - 1);
      const right = clamp(Math.max(col1, col2), 0, this.cols - 1);
      for (let r = top; r <= bottom; r++) {
        for (let c = left; c <= right; c++) cells.push({ row: r, col: c });
      }
      return cells;
    }

    const r1 = clamp(row1, 0, this.rows - 1);
    const r2 = clamp(row2, 0, this.rows - 1);
    const phi1 = this.angleOf(r1, clamp(col1, 0, this.capacity(r1) - 1));
    const phi2 = this.angleOf(r2, clamp(col2, 0, this.capacity(r2) - 1));
    const from = Math.min(phi1, phi2);
    const to = Math.max(phi1, phi2);

    for (let r = top; r <= bottom; r++) {
      const half = CELL_W / 2 / this.rowRadius(r);
      const count = this.capacity(r);
      for (let c = 0; c < count; c++) {
        const phi = this.angleOf(r, c);
        if (phi >= from - half && phi <= to + half) cells.push({ row: r, col: c });
      }
    }
    return cells;
  }
}

// ───────────── 배치도 그리기 판 ─────────────

const MAX_ROWS = 30;
const MAX_COLS = 40;
const MAX_SEATS = 2000;
const MAX_FLOORS = 9;
const DEFAULT_ROWS = 12;
const DEFAULT_COLS = 16;
const MAX_FLOOR_ID = 99;

function floorName(position) {
  return (position + 1) + '층';
}

function rowName(index) {
  let text = '';
  let value = index;
  do {
    text = String.fromCharCode(65 + value % 26) + text;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return text;
}

function seatId(floor, row, col) {
  const id = 'r' + row + 'c' + col;
  return floor === 0 ? id : 'f' + floor + id;
}

const key = (row, col) => row + ',' + col;

function makeFloor(id, shape, angle, rows, cols) {
  return { id, shape, angle, rows, cols, cells: new Map() };
}

function floorGeometry(floor) {
  return new SeatGeometry(floor.shape, floor.angle, floor.rows, floor.cols);
}

class LayoutDraft {
  constructor() {
    this.floors = [makeFloor(0, 'grid', 0, DEFAULT_ROWS, DEFAULT_COLS)];
    this.usedFloorIds = new Set([0]);
    this.current = 0;
    this.nextBench = 1;
  }

  get cur() { return this.floors[this.current]; }
  get rows() { return this.cur.rows; }
  get cols() { return this.cur.cols; }
  get shape() { return this.cur.shape; }
  get angle() { return this.cur.angle; }
  get geometry() { return floorGeometry(this.cur); }
  get seatCount() { return this.floors.reduce((sum, floor) => sum + floor.cells.size, 0); }
  get currentFloorSeatCount() { return this.cur.cells.size; }
  get floorCount() { return this.floors.length; }

  static fromSeats(seats, floors) {
    const draft = new LayoutDraft();
    draft.floors = [];

    for (const meta of floors || []) {
      const id = meta.f | 0;
      if (id < 0 || draft.floors.some(floor => floor.id === id) || draft.floors.length >= MAX_FLOORS) continue;
      const shape = normalizeShape(meta.shape);
      draft.floors.push(makeFloor(
        id,
        shape,
        shape === 'arc' ? clamp(meta.angle | 0, MIN_ANGLE, MAX_ANGLE) : 0,
        clamp(meta.rows > 0 ? meta.rows : DEFAULT_ROWS, 1, MAX_ROWS),
        clamp(meta.cols > 0 ? meta.cols : DEFAULT_COLS, 1, MAX_COLS)));
    }

    const seatFloors = [...new Set(seats.map(seat => seat.f | 0))].sort((a, b) => a - b);
    for (const id of seatFloors) {
      if (id >= 0 && draft.floors.every(floor => floor.id !== id) && draft.floors.length < MAX_FLOORS) {
        draft.floors.push(makeFloor(id, 'grid', 0, DEFAULT_ROWS, DEFAULT_COLS));
      }
    }

    if (draft.floors.length === 0) draft.floors.push(makeFloor(0, 'grid', 0, DEFAULT_ROWS, DEFAULT_COLS));

    draft.usedFloorIds = new Set(draft.floors.map(floor => floor.id));
    const benchNames = new Map();

    for (const floor of draft.floors) {
      const onFloor = seats.filter(seat => (seat.f | 0) === floor.id && seat.r >= 0 && seat.c >= 0 && seat.r < MAX_ROWS);

      if (onFloor.length > 0) {
        floor.rows = Math.max(floor.rows, Math.max(...onFloor.map(seat => seat.r)) + 1);
        if (floor.shape === 'grid') {
          floor.cols = clamp(Math.max(floor.cols, Math.max(...onFloor.map(seat => seat.c)) + 1), 1, MAX_COLS);
        }
      }

      const geometry = floorGeometry(floor);

      for (const seat of onFloor) {
        if (!geometry.contains(seat.r, seat.c)) continue;
        const kind = normalizeKind(seat.kind);
        let bench = '';

        if (kind === 'pew') {
          const benchKey = floor.id + '/' + (seat.bench ? seat.bench : 'solo-' + seat.id);
          if (!benchNames.has(benchKey)) benchNames.set(benchKey, draft.newBench());
          bench = benchNames.get(benchKey);
        }

        floor.cells.set(key(seat.r, seat.c), { kind, bench, blocked: !!seat.blocked });
      }
    }

    return draft;
  }

  newBench() {
    return 'b' + (this.nextBench++);
  }

  // ── 층 ──

  selectFloor(position) {
    this.current = clamp(position, 0, this.floors.length - 1);
  }

  addFloor() {
    if (this.floors.length >= MAX_FLOORS) return `층은 ${MAX_FLOORS}개까지 만들 수 있어요.`;
    let id = 0;
    while (id <= MAX_FLOOR_ID && this.usedFloorIds.has(id)) id++;
    if (id > MAX_FLOOR_ID) return '층을 너무 여러 번 지웠다 더했어요. 한 번 저장한 뒤 다시 더해 주세요.';
    this.usedFloorIds.add(id);
    const model = this.cur;
    this.floors.push(makeFloor(id, model.shape, model.angle, model.rows, model.cols));
    this.current = this.floors.length - 1;
    return null;
  }

  removeCurrentFloor() {
    if (this.floors.length <= 1) return 0;
    const lost = this.cur.cells.size;
    this.floors.splice(this.current, 1);
    this.current = Math.min(this.current, this.floors.length - 1);
    return lost;
  }

  countLostByShape(shape, angle) {
    const geometry = new SeatGeometry(shape, angle, this.cur.rows, this.cur.cols);
    return [...this.cur.cells.keys()].filter(k => !geometry.contains(...k.split(',').map(Number))).length;
  }

  setShape(shape, angle) {
    this.cur.shape = normalizeShape(shape);
    this.cur.angle = this.cur.shape === 'arc' ? clamp(angle, MIN_ANGLE, MAX_ANGLE) : 0;
    return this.removeOutside();
  }

  removeOutside() {
    const geometry = this.geometry;
    let removed = 0;
    for (const k of [...this.cur.cells.keys()]) {
      const [row, col] = k.split(',').map(Number);
      if (!geometry.contains(row, col)) {
        this.cur.cells.delete(k);
        removed++;
      }
    }
    return removed;
  }

  // ── 칠하기 ──

  get(row, col) {
    return this.cur.cells.get(key(row, col)) || null;
  }

  apply(tool, row1, col1, row2, col2) {
    const cells = this.geometry.cellsBetween(row1, col1, row2, col2);
    const board = this.cur.cells;

    if (tool === 'erase') {
      cells.forEach(cell => board.delete(key(cell.row, cell.col)));
      return null;
    }

    if (tool === 'block') {
      const inside = cells.map(cell => board.get(key(cell.row, cell.col))).filter(Boolean);
      const block = inside.some(cell => !cell.blocked);
      inside.forEach(cell => { cell.blocked = block; });
      return null;
    }

    const added = cells.filter(cell => !board.has(key(cell.row, cell.col))).length;
    if (this.seatCount + added > MAX_SEATS) return `좌석은 ${MAX_SEATS}개까지 만들 수 있어요.`;

    const kind = normalizeKind(tool);
    const byRow = new Map();
    for (const cell of cells) {
      if (!byRow.has(cell.row)) byRow.set(cell.row, []);
      byRow.get(cell.row).push(cell);
    }

    for (const rowCells of byRow.values()) {
      const bench = kind === 'pew' ? this.newBench() : '';
      for (const cell of rowCells) board.set(key(cell.row, cell.col), { kind, bench, blocked: false });
    }
    return null;
  }

  resize(rows, cols) {
    this.cur.rows = clamp(rows, 1, MAX_ROWS);
    this.cur.cols = clamp(cols, 1, MAX_COLS);
    return this.removeOutside();
  }

  countOutside(rows, cols) {
    const geometry = new SeatGeometry(this.cur.shape, this.cur.angle, rows, cols);
    return [...this.cur.cells.keys()].filter(k => !geometry.contains(...k.split(',').map(Number))).length;
  }

  // ── 저장 ──

  toFloors() {
    return this.floors.map(floor => ({ f: floor.id, shape: floor.shape, angle: floor.angle, rows: floor.rows, cols: floor.cols }));
  }

  toSeats() {
    const result = [];
    const benchNames = new Map();
    const manyFloors = this.floors.filter(floor => floor.cells.size > 0).length > 1;

    this.floors.forEach((floor, position) => {
      const prefix = manyFloors ? floorName(position) + ' ' : '';
      const entries = [...floor.cells.entries()]
        .map(([k, cell]) => {
          const [row, col] = k.split(',').map(Number);
          return { row, col, cell };
        })
        .sort((a, b) => a.row - b.row || a.col - b.col);

      let rowIndex = -1;
      let lastRow = null;
      let number = 1;

      for (const { row, col, cell } of entries) {
        if (row !== lastRow) {
          rowIndex++;
          lastRow = row;
          number = 1;
        }

        let bench = '';
        if (cell.kind === 'pew' && cell.bench) {
          if (!benchNames.has(cell.bench)) benchNames.set(cell.bench, 'b' + (benchNames.size + 1));
          bench = benchNames.get(cell.bench);
        }

        result.push({
          id: seatId(floor.id, row, col),
          r: row,
          c: col,
          f: floor.id,
          label: prefix + rowName(rowIndex) + (number++),
          blocked: cell.blocked,
          kind: cell.kind,
          bench
        });
      }
    });

    return result;
  }
}
Object.assign(window.Jjim = window.Jjim || {}, { CELL_W, CELL_H, MAX_ARC_SEATS, MIN_ANGLE, MAX_ANGLE, MIN_DRAW_RADIUS, FAN_ANGLE, ROUND_ANGLE, KINDS, normalizeKind, normalizeShape, kindName, SeatGeometry, MAX_ROWS, MAX_COLS, MAX_SEATS, MAX_FLOORS, DEFAULT_ROWS, DEFAULT_COLS, floorName, rowName, seatId, LayoutDraft });
})();
