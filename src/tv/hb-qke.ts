import { toDataLines } from "./coords.ts";

/*
  Hellbender .QKE: ground quakes and box quakes, the level's moving terrain.

  Not Terminal Velocity's .QKE: TV and Fury3 ship a file of that name too, but it is a different
  table, a count that is 0 in 181 of their 190 files. Hellbender's is a labelled script of
  terrain cells and ground boxes that move between two heights: its doors, lifts, crushers and
  collapsing floors. The layout is the order HELLBEND.EXE's writer (0x410260) prints the fields
  in, and the runtime (0x411530 for ground, 0x410ec0 for boxes, dispatched by 0x4122a0) gives
  their meaning:

    -------- Ground Quake Count -------
    <n>
    ------- Ground Quake Entry <i>-------
    mode                                    0 inactive; 1 and 3 are the two ground behaviours
    upper, lower                            the two height limits
    x0, z0, x1, z1, layer                   the cell rectangle; layer 1 surface, 2 cavern floor,
                                            3 cavern ceiling
    4 ints                                  not named
    startDirection, riseTime, topWait, fallTime, bottomWait
    endMode, flag, flag, count              endMode 1 loops, 2 runs once and stops
    5 sound names or NULL                   rise, fall, at top, at bottom, fifth
    !--Additional quake info--
    additional info                         a number the runtime passes along when the quake fires
    -------- Box Quake Count --------
    <n>
    -------- Box Quake Entry <i> --------
    mode
    upper, lower
    z, x, layer                             one cell; layer 1 the surface boxes, else the cavern's
    4 ints                                  not named
    startDirection, riseTime, topWait, fallTime, bottomWait
    endMode, flag, flag, flag, count
    5 sound names or NULL
    !--Additional quake info--
    additional info
    @--Box quake switch info--
    switch                                  non-zero: the box is a switch another quake watches
    2 texture names or NULL                 the switch's two states (MESWTCH1.RAW, MESWTCH0.RAW)

  Heights are the engine's internal units, 128 per height step (a byte is stored `<< 7`), and
  cavern heights carry the cavern bias, so `value / 128` is the altitude in steps that the
  level's other layers use (see hb-underground.ts). Times count down against the engine's frame
  clock; values such as 65536 and 196608 suggest 16.16 fixed-point seconds. A ground quake moves the cells of its rectangle; a box quake moves one ground
  box, and with a switch it can be chained to another ("processBoxQuake: no match for watchBox
  found").

  The cell, layer, limits, times and loop behaviour are certain; the fields marked unnamed are
  kept as numbers.
*/

/** What ground and box quakes share. */
export interface HbQuakeBase {
  index: number;
  mode: number;
  /** Upper and lower limits, engine units (128 per height step). */
  upper: number;
  lower: number;
  /** The same limits in height steps. */
  upperStep: number;
  lowerStep: number;
  startDirection: number;
  /** Travel and wait times, in the engine's frame-clock units. */
  riseTime: number;
  topWait: number;
  fallTime: number;
  bottomWait: number;
  endMode: number;
  /** The flag fields of the end-mode line, after endMode, in file order. */
  flags: number[];
  /** Rise, fall, at top, at bottom and the fifth sound; null for NULL. */
  sounds: (string | null)[];
  /** The value after "!--Additional quake info--". */
  additionalInfo: number;
  /** The four unnamed integers. */
  unnamed: number[];
}

export interface HbGroundQuake extends HbQuakeBase {
  /** Cell rectangle, inclusive, wrapping on the 128 grid. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** 1 surface, 2 cavern floor, 3 cavern ceiling. */
  layer: number;
}

export interface HbBoxQuake extends HbQuakeBase {
  x: number;
  z: number;
  /** 1 the surface ground boxes; any other value the cavern's. */
  layer: number;
  switchFlag: number;
  switchTextures: (string | null)[];
}

export interface HbQuakes {
  groundQuakes: HbGroundQuake[];
  boxQuakes: HbBoxQuake[];
  /** True when every declared entry was read. */
  complete: boolean;
}

/** Engine units per height step in a .QKE limit. */
export const HB_QUAKE_HEIGHT_UNIT = 128;

const isLabel = (line: string) => /^(--|!--|@--)/.test(line);

/**
 * Parses a Hellbender .QKE. Returns null when the file does not start with the ground quake
 * count; an entry that does not parse ends the reading, with `complete` false.
 */
export function parseHbQuakes(bytes: Uint8Array | null | undefined): HbQuakes | null {
  if (!bytes || !bytes.length) return null;
  const lines = toDataLines(bytes).filter((line) => line !== "");
  let i = 0;
  const label = (pattern: RegExp) => {
    if (i < lines.length && isLabel(lines[i]) && pattern.test(lines[i])) { i++; return true; }
    return false;
  };
  const numbers = (min: number): number[] | null => {
    const line = lines[i];
    if (line === undefined || isLabel(line)) return null;
    const values = line.split(",").map((v) => Number.parseInt(v.trim(), 10));
    if (values.length < min || !values.every(Number.isFinite)) return null;
    i++;
    return values;
  };
  const name = (): string | null | undefined => {
    const line = lines[i];
    if (line === undefined || isLabel(line)) return undefined;
    i++;
    return line.toUpperCase() === "NULL" ? null : line.toUpperCase();
  };
  const names = (n: number) => {
    const out: (string | null)[] = [];
    for (let k = 0; k < n; k++) {
      const value = name();
      if (value === undefined) return null;
      out.push(value);
    }
    return out;
  };

  if (!label(/ground quake count/i)) return null;
  const groundCount = numbers(1)?.[0];
  if (groundCount === undefined || groundCount < 0) return null;

  const base = (index: number, mode: number[], limits: number[], unnamed: number[], times: number[], end: number[],
    sounds: (string | null)[], additionalInfo: number): HbQuakeBase => ({
    index,
    mode: mode[0],
    upper: limits[0],
    lower: limits[1],
    upperStep: limits[0] / HB_QUAKE_HEIGHT_UNIT,
    lowerStep: limits[1] / HB_QUAKE_HEIGHT_UNIT,
    startDirection: times[0],
    riseTime: times[1],
    topWait: times[2],
    fallTime: times[3],
    bottomWait: times[4],
    endMode: end[0],
    flags: end.slice(1),
    sounds,
    additionalInfo,
    unnamed: unnamed.slice(0, 4),
  });

  const groundQuakes: HbGroundQuake[] = [];
  let complete = true;
  for (let n = 0; n < groundCount; n++) {
    label(/ground quake entry/i);
    const mode = numbers(1), limits = numbers(2), cells = numbers(5), unnamed = numbers(4), times = numbers(5), end = numbers(4);
    const sounds = mode && limits && cells && unnamed && times && end ? names(5) : null;
    const trigger = sounds && label(/additional quake info/i) ? numbers(1) : null;
    if (!mode || !limits || !cells || !unnamed || !times || !end || !sounds || !trigger) { complete = false; break; }
    groundQuakes.push({
      ...base(n, mode, limits, unnamed, times, end, sounds, trigger[0]),
      x0: cells[0], z0: cells[1], x1: cells[2], z1: cells[3], layer: cells[4],
    });
  }

  const boxQuakes: HbBoxQuake[] = [];
  const boxCount = complete && label(/box quake count/i) ? numbers(1)?.[0] : undefined;
  if (boxCount === undefined) complete = complete && i >= lines.length;
  for (let n = 0; n < (boxCount ?? 0); n++) {
    label(/box quake entry/i);
    const mode = numbers(1), limits = numbers(2), cell = numbers(3), unnamed = numbers(4), times = numbers(5), end = numbers(5);
    const sounds = mode && limits && cell && unnamed && times && end ? names(5) : null;
    const trigger = sounds && label(/additional quake info/i) ? numbers(1) : null;
    const switchFlag = trigger && label(/box quake switch info/i) ? numbers(1) : null;
    const switchTextures = switchFlag ? names(2) : null;
    if (!mode || !limits || !cell || !unnamed || !times || !end || !sounds || !trigger || !switchFlag || !switchTextures) { complete = false; break; }
    boxQuakes.push({
      ...base(n, mode, limits, unnamed, times, end, sounds, trigger[0]),
      z: cell[0], x: cell[1], layer: cell[2],
      switchFlag: switchFlag[0],
      switchTextures,
    });
  }
  return { groundQuakes, boxQuakes, complete };
}
