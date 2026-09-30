import { FLY_QUADRANT_CELLS } from "./globe.ts";

/*
  The terrain files of one globe tile quadrant, DATA\Dxxxyyy\G<x><y>.* in the numbered
  scenery archives. See docs/FLY.md.

  Every file here is column-major: x (west to east) is the outer index and y (south to north)
  the inner one, so cell i sits at x = floor(i / 32), y = i % 32. This was established twice
  over on San Francisco: the .ALT heights put Mount Diablo, Mount Tamalpais and Mount Saint
  Helena where they belong only when read this way, and each cell's .REF texture names that
  same cell in all 2,944 named textures of D169156.

    .ALT  33 x 33 float32 corner heights, feet
    .TYP  one line per cell: type:<kind>: <n>,<n>
    .TEX  a count, then that many texture file names
    .REF  one texture index per cell, plus two lines of two for each kind 2 cell
    .AL2  an (n + 1) x (n + 1) block of heights for each cell whose kind is not 0
*/

/** Corner heights along each side of a quadrant. */
export const FLY_ALT_SIDE = FLY_QUADRANT_CELLS + 1;
const CELLS = FLY_QUADRANT_CELLS * FLY_QUADRANT_CELLS;
const decoder = new TextDecoder("latin1");

/** A cell's .TYP line. */
export interface FlyCellType {
  /** 0 plain; 1 finer heights in .AL2; 2 finer heights and a 2 x 2 block of sub-textures. */
  kind: number;
  /** How many steps the cell is divided into along each side: 1, 2 or 4. */
  divisions: number;
}

/** Everything a quadrant's files say, in cell order (index x * 32 + y). */
export interface FlyQuadrant {
  /** Corner heights in feet, index x * 33 + y. */
  heights: Float32Array;
  cellTypes: FlyCellType[];
  /** The .TEX texture names, which .REF indexes. */
  textures: string[];
  /** Each cell's texture, an index into `textures`. */
  cellTextures: Int32Array;
  /**
   * For a kind 2 cell, its four sub-textures in [x][y] order (x0y0, x0y1, x1y0, x1y1); -1
   * where there is none. Null for every other cell.
   */
  cellSubTextures: (number[] | null)[];
  /**
   * For a cell with finer heights, its (divisions + 1)^2 heights, index x * (divisions + 1) + y.
   * Its corners repeat the .ALT corners. Null for a plain cell.
   */
  cellHeights: (Float32Array | null)[];
}

/** The 33 x 33 corner heights of a .ALT file, in feet, index x * 33 + y. */
export function parseFlyAlt(bytes: Uint8Array, sourceName = ".ALT"): Float32Array {
  const expected = FLY_ALT_SIDE * FLY_ALT_SIDE * 4;
  if (bytes.length !== expected) throw new Error(`${sourceName}: ${bytes.length} bytes, expected ${expected}`);
  const heights = new Float32Array(FLY_ALT_SIDE * FLY_ALT_SIDE);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < heights.length; i++) heights[i] = view.getFloat32(i * 4, true);
  return heights;
}

/** The texture names of a .TEX file. */
export function parseFlyTex(bytes: Uint8Array, sourceName = ".TEX"): string[] {
  const lines = textLines(bytes);
  const count = Number(lines[0]);
  if (!Number.isInteger(count) || count < 0) throw new Error(`${sourceName}: unreadable texture count "${lines[0] ?? ""}"`);
  const names = lines.slice(1, 1 + count);
  if (names.length !== count) throw new Error(`${sourceName}: ${count} textures promised, ${names.length} found`);
  return names;
}

/** The cell types of a .TYP file. */
export function parseFlyTyp(bytes: Uint8Array, sourceName = ".TYP"): FlyCellType[] {
  const lines = textLines(bytes);
  if (lines.length !== CELLS) throw new Error(`${sourceName}: ${lines.length} cells, expected ${CELLS}`);
  return lines.map((line, i) => {
    const match = /^type:\s*(\d+)\s*:\s*(\d+)\s*,\s*(\d+)$/i.exec(line);
    if (!match || match[2] !== match[3]) throw new Error(`${sourceName}: cell ${i} reads "${line}"`);
    return { kind: Number(match[1]), divisions: Number(match[2]) };
  });
}

/** The texture indices of a .REF file, which depend on the cell types. */
export function parseFlyRef(bytes: Uint8Array, cellTypes: readonly FlyCellType[], sourceName = ".REF"): {
  cellTextures: Int32Array;
  cellSubTextures: (number[] | null)[];
} {
  const lines = textLines(bytes).map((line) => line.split(/\s+/).map(Number));
  const cellTextures = new Int32Array(CELLS);
  const cellSubTextures: (number[] | null)[] = new Array(CELLS).fill(null);
  let at = 0;
  const take = (width: number, cell: number): number[] => {
    const values = lines[at++];
    if (!values || values.length !== width || values.some((v) => !Number.isInteger(v))) {
      throw new Error(`${sourceName}: cell ${cell} expected ${width} index(es) on line ${at}`);
    }
    return values;
  };
  for (let cell = 0; cell < CELLS; cell++) {
    cellTextures[cell] = take(1, cell)[0];
    if (cellTypes[cell]?.kind === 2) cellSubTextures[cell] = [...take(2, cell), ...take(2, cell)];
  }
  if (at !== lines.length) throw new Error(`${sourceName}: ${lines.length - at} line(s) left over`);
  return { cellTextures, cellSubTextures };
}

/** The finer heights of a .AL2 file, which depend on the cell types. */
export function parseFlyAl2(bytes: Uint8Array, cellTypes: readonly FlyCellType[], sourceName = ".AL2"): (Float32Array | null)[] {
  const lines = textLines(bytes).map((line) => line.split(/\s+/).map(Number));
  const cellHeights: (Float32Array | null)[] = new Array(CELLS).fill(null);
  let at = 0;
  for (let cell = 0; cell < CELLS; cell++) {
    const type = cellTypes[cell];
    if (!type || type.kind === 0) continue;
    const side = type.divisions + 1;
    const heights = new Float32Array(side * side);
    for (let x = 0; x < side; x++) {
      const values = lines[at++];
      if (!values || values.length !== side || values.some((v) => !Number.isFinite(v))) {
        throw new Error(`${sourceName}: cell ${cell} expected ${side} heights on line ${at}`);
      }
      heights.set(values, x * side);
    }
    cellHeights[cell] = heights;
  }
  if (at !== lines.length) throw new Error(`${sourceName}: ${lines.length - at} line(s) left over`);
  return cellHeights;
}

/** A whole quadrant from its five files. `.AL2` may be empty or absent for a flat quadrant. */
export function parseFlyQuadrant(files: {
  alt: Uint8Array;
  typ: Uint8Array;
  tex: Uint8Array;
  ref: Uint8Array;
  al2?: Uint8Array | null;
}, sourceName = "quadrant"): FlyQuadrant {
  const cellTypes = parseFlyTyp(files.typ, `${sourceName}.TYP`);
  const { cellTextures, cellSubTextures } = parseFlyRef(files.ref, cellTypes, `${sourceName}.REF`);
  return {
    heights: parseFlyAlt(files.alt, `${sourceName}.ALT`),
    cellTypes,
    textures: parseFlyTex(files.tex, `${sourceName}.TEX`),
    cellTextures,
    cellSubTextures,
    cellHeights: parseFlyAl2(files.al2 ?? new Uint8Array(0), cellTypes, `${sourceName}.AL2`),
  };
}

function textLines(bytes: Uint8Array): string[] {
  return decoder.decode(bytes).split(/\r\n|\r|\n/).map((line) => line.trim()).filter(Boolean);
}
