/*
  The MTM2 terrain the simulation stands on (MTM2_PHYSICS.md §2.1, §2.2).

  - A 256 × 256 grid of 32 ft cells; the level's `.RAW` heightfield is the grid in file order:
    corner (row, col) is byte `row * 256 + col`, worth 2 ft per step. Rows follow z, columns x.
  - Positions are truncated to 1/256 ft and wrap at 8192 ft.
  - Each cell is two triangles, split along a diagonal that alternates in a checkerboard: when
    `row + col` is even the split runs from (row, col) to (row + 1, col + 1), otherwise along the
    other diagonal. Height is linear inside the triangle; the normal is the triangle's.
  - In Snow, ground below the water level is raised to it, flat, so frozen water is drivable.

  Ramps, ground boxes and object tops are layered on top of this by the world module.
*/
import { CELL_FT, HEIGHT_STEP_FT, TERRAIN_CELLS } from "../constants.ts";
import type { Vec3 } from "../math.ts";

export interface Mtm2Terrain {
  /** The level `.RAW`: 65536 height steps, row-major, rows along z. */
  heights: Uint8Array;
  /** The water level in feet, or null when the level has no water. */
  waterLevelFt: number | null;
  /**
   * The corner heights in feet, in the same order, for a level whose heightfield is finer than
   * MTM2's 2 ft steps (CART Precision Racing, 4x4 Evolution). When present it is used and
   * `heights` is not.
   */
  heightsFt?: Float32Array;
  /**
   * A finer grid over the same world, when the level has one (4x4 Evolution 2's smoothed ground,
   * sim/evo/ground.ts): `cells` per side, each `cellFt` across, heights in feet, rows along z. It is
   * split into triangles as the coarse grid is, by its own rows and columns, and stands in for it.
   */
  fine?: { cells: number; cellFt: number; heightsFt: Float32Array };
}

const UNITS_PER_FT = 256;
const UNITS_PER_CELL = CELL_FT * UNITS_PER_FT; // 0x2000
const MASK = TERRAIN_CELLS - 1;

export function createTerrain(heights: Uint8Array, waterLevelFt: number | null = null): Mtm2Terrain {
  if (heights.length !== TERRAIN_CELLS * TERRAIN_CELLS) {
    throw new RangeError(`terrain needs ${TERRAIN_CELLS * TERRAIN_CELLS} heights, got ${heights.length}`);
  }
  return { heights, waterLevelFt };
}

/**
 * A terrain from corner heights in feet (see `Mtm2Terrain.heightsFt`): the same grid, cells and split. `fineFt`, a
 * square grid of a multiple of 256 heights a side, is a finer grid over it (`Mtm2Terrain.fine`).
 */
export function createTerrainFt(heightsFt: Float32Array, waterLevelFt: number | null = null, fineFt: Float32Array | null = null): Mtm2Terrain {
  if (heightsFt.length !== TERRAIN_CELLS * TERRAIN_CELLS) {
    throw new RangeError(`terrain needs ${TERRAIN_CELLS * TERRAIN_CELLS} heights, got ${heightsFt.length}`);
  }
  const t: Mtm2Terrain = { heights: new Uint8Array(0), heightsFt, waterLevelFt };
  if (fineFt) {
    const cells = Math.round(Math.sqrt(fineFt.length));
    if (cells * cells !== fineFt.length || cells % TERRAIN_CELLS !== 0) throw new RangeError(`a fine grid needs a square multiple of ${TERRAIN_CELLS} a side, got ${fineFt.length}`);
    t.fine = { cells, cellFt: (CELL_FT * TERRAIN_CELLS) / cells, heightsFt: fineFt };
  }
  return t;
}

/** The four corners and fractions of the fine cell under (x, z), and whether it splits along its main diagonal. */
function fineCell(f: NonNullable<Mtm2Terrain["fine"]>, x: number, z: number) {
  const m = f.cells - 1, gx = x / f.cellFt, gz = z / f.cellFt;
  const c = Math.floor(gx), r = Math.floor(gz);
  const fx = gx - c, fz = gz - r;
  const h = (rr: number, cc: number) => f.heightsFt[(rr & m) * f.cells + (cc & m)]!;
  return { h00: h(r, c), h01: h(r, c + 1), h10: h(r + 1, c), h11: h(r + 1, c + 1), fx, fz, main: ((r ^ c) & 1) === 0 };
}

function corner(t: Mtm2Terrain, row: number, col: number): number {
  const i = (row & MASK) * TERRAIN_CELLS + (col & MASK);
  return t.heightsFt ? t.heightsFt[i]! : t.heights[i]! * HEIGHT_STEP_FT;
}

/** The cell and in-cell fractions of a position, as the game computes them. */
function locate(x: number, z: number) {
  const xi = Math.trunc(x * UNITS_PER_FT) | 0;
  const zi = Math.trunc(z * UNITS_PER_FT) | 0;
  return {
    col: (xi >> 13) & MASK,
    row: (zi >> 13) & MASK,
    fx: (xi & (UNITS_PER_CELL - 1)) / UNITS_PER_CELL,
    fz: (zi & (UNITS_PER_CELL - 1)) / UNITS_PER_CELL,
  };
}

/** True when the cell at (row, col) splits along (row, col)-(row + 1, col + 1). */
export function cellSplitsMainDiagonal(row: number, col: number): boolean {
  return ((row ^ col) & 1) === 0;
}

/** Bare terrain height in feet, without the Snow rule. */
export function terrainHeightAt(t: Mtm2Terrain, x: number, z: number): number {
  if (t.fine) {
    const { h00, h01, h10, h11, fx, fz, main } = fineCell(t.fine, x, z);
    return triangleAt(h00, h01, h10, h11, fx, fz, main);
  }
  const { row, col, fx, fz } = locate(x, z);
  const h00 = corner(t, row, col);
  const h01 = corner(t, row, col + 1);
  const h10 = corner(t, row + 1, col);
  const h11 = corner(t, row + 1, col + 1);
  return triangleAt(h00, h01, h10, h11, fx, fz, cellSplitsMainDiagonal(row, col));
}

/** Height inside a cell's triangle: corners h(row, col), fractions across it, and its split. */
function triangleAt(h00: number, h01: number, h10: number, h11: number, fx: number, fz: number, main: boolean): number {
  if (main) {
    return fz < fx
      ? h00 + (h01 - h00) * fx + (h11 - h01) * fz
      : h00 + (h11 - h10) * fx + (h10 - h00) * fz;
  }
  return fz < 1 - fx
    ? h01 + (h00 - h01) * (1 - fx) + (h10 - h00) * fz
    : h01 + (h10 - h11) * (1 - fx) + (h11 - h01) * fz;
}

/** Ground height with the Snow rule: frozen water carries the trucks. */
export function groundHeightAt(t: Mtm2Terrain, x: number, z: number, snow = false): number {
  const h = terrainHeightAt(t, x, z);
  if (snow && t.waterLevelFt !== null && h < t.waterLevelFt) return t.waterLevelFt;
  return h;
}

/**
 * The upward unit normal of the triangle under (x, z), into `out`. Flat over frozen water in
 * Snow.
 */
export function groundNormalAt(t: Mtm2Terrain, x: number, z: number, out: Vec3, snow = false): Vec3 {
  if (snow && t.waterLevelFt !== null && terrainHeightAt(t, x, z) < t.waterLevelFt) {
    out[0] = 0; out[1] = 1; out[2] = 0;
    return out;
  }
  let h00: number, h01: number, h10: number, h11: number, fx: number, fz: number, main: boolean, side = CELL_FT;
  if (t.fine) {
    ({ h00, h01, h10, h11, fx, fz, main } = fineCell(t.fine, x, z));
    side = t.fine.cellFt;
  } else {
    const at = locate(x, z);
    ({ fx, fz } = at);
    h00 = corner(t, at.row, at.col);
    h01 = corner(t, at.row, at.col + 1);
    h10 = corner(t, at.row + 1, at.col);
    h11 = corner(t, at.row + 1, at.col + 1);
    main = cellSplitsMainDiagonal(at.row, at.col);
  }
  // Slopes of the triangle's plane, dh/dx and dh/dz, per cell.
  let sx: number, sz: number;
  if (main) {
    if (fz < fx) { sx = h01 - h00; sz = h11 - h01; } else { sx = h11 - h10; sz = h10 - h00; }
  } else if (fz < 1 - fx) {
    sx = h01 - h00; sz = h10 - h00;
  } else {
    sx = h11 - h10; sz = h11 - h01;
  }
  const len = Math.hypot(sx, side, sz);
  out[0] = -sx / len;
  out[1] = side / len;
  out[2] = -sz / len;
  return out;
}
