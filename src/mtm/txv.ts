/*
  DATA\<stem>.TXV, the MTM2 track version record that Community Patch 3 tools write beside a
  level: plain text, CRLF, `key=value` lines and `#` comments, for example

    # MTM2 track version record - written by Traxx
    formatVersion=1
    tool=Traxx
    toolVersion=1.6.5
    built=2026-09-26
    legacyFallback=0
    hdTextures=1

  The engine loads a track whatever its record says, so the record is a diagnostic. Unknown
  keys are the forward-compatibility mechanism: a tool keeps the keys it does not know, so the
  reader keeps every line in order and the writer puts them back.
*/

/** A `key=value` line, or any other line (a comment) kept as written. Blank lines are dropped. */
export type TxvLine = { key: string; value: string } | { text: string };

const decoder = new TextDecoder("latin1");

export function parseTxv(input: Uint8Array | string): TxvLine[] {
  const text = typeof input === "string" ? input : decoder.decode(input);
  const out: TxvLine[] = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    const clean = line.replace(/\x1a/g, "");
    if (!clean.trim()) continue;
    const eq = clean.indexOf("=");
    if (clean.startsWith("#") || eq < 0) out.push({ text: clean });
    else out.push({ key: clean.slice(0, eq).trim(), value: clean.slice(eq + 1).trim() });
  }
  return out;
}

/** The value of a key, compared without case, or null. */
export function txvValue(lines: readonly TxvLine[], key: string): string | null {
  const wanted = key.toLowerCase();
  for (const line of lines) if ("key" in line && line.key.toLowerCase() === wanted) return line.value;
  return null;
}

/**
 * The bytes of a .TXV. With `situation`, the track's situation file extension, the keys of track
 * format version 6 are checked first (docs/LEVELS.md, "Track format version 6"): a .SIT or .SI2
 * track must not carry them, and a .SI3 track must carry formatVersion 6 or later with every key
 * in range. A RangeError names the offending key.
 */
export function writeTxv(lines: readonly TxvLine[], { situation }: { situation?: string } = {}): Uint8Array {
  if (situation != null) {
    const ext = situation.replace(/^.*\./, "").toUpperCase();
    if (ext === "SI3") readTxvV6(lines);
    else if (ext === "SIT" || ext === "SI2") {
      const used = TXV_V6_ONLY_KEYS.filter((k) => txvValue(lines, k) !== null);
      if (used.length) throw new RangeError(`TXV: ${used[0]} belongs to a .SI3 track (track format version 6), not a .${ext}`);
    } else throw new RangeError(`TXV: unknown situation file extension .${ext}`);
  }
  const text = lines.map((line) => `${"key" in line ? `${line.key}=${line.value}` : line.text}\r\n`).join("");
  return Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);
}

/**
 * Set keys in a .TXV, keeping every other line (unknown keys, comments) and the order: a key that
 * is present keeps its place and spelling and takes the new value; a new key is appended. A null
 * value removes the key.
 */
export function setTxvValues(lines: readonly TxvLine[], values: Readonly<Record<string, string | number | null>>): TxvLine[] {
  const out: TxvLine[] = [];
  const pending = new Map(Object.entries(values).map(([k, v]) => [k.toLowerCase(), { key: k, value: v }]));
  const done = new Set<string>();
  for (const line of lines) {
    if (!("key" in line)) { out.push(line); continue; }
    const lower = line.key.toLowerCase();
    const set = pending.get(lower);
    if (!set) { out.push(line); continue; }
    if (done.has(lower) || set.value === null) continue;
    done.add(lower);
    out.push({ key: line.key, value: String(set.value) });
  }
  for (const [lower, set] of pending) if (!done.has(lower) && set.value !== null) out.push({ key: set.key, value: String(set.value) });
  return out;
}

/*
  The keys Community Patch 4 and Traxx 1.7 give a meaning to. `formatVersion` is the highest
  feature level the track uses: 1 classic, 2 lights or movers, 3 vegetation, 4 fog volumes,
  5 a 16-bit terrain grid. The engine reads `terrainGrid` (classic | spline | fine) and
  `terrainHeights` (a height PNG, at most 64 characters) to load the terrain; the rest is
  diagnostic.
*/
export interface TxvInfo {
  formatVersion: number | null;
  tool: string | null;
  toolVersion: string | null;
  built: string | null;
  legacyFallback: boolean | null;
  hdTextures: boolean | null;
  fogVolumes: number | null;
  vegetation: boolean | null;
  vegTrees: number | null;
  vegClumps: number | null;
  terrainGrid: string | null;
  terrainHeights: string | null;
  /** Waterfalls in WORLD\<stem>.WFL (Traxx 1.7.1 writes it only with the file). */
  waterfalls: number | null;
  /** Track format version 6 keys as written (readTxvV6 validates them): cells a side, 256 or 512. */
  worldCells: number | null;
  /** The entry holding the heights, a .PNG or a .RAW (version 6). */
  terrainHeightMap: string | null;
  /** Height steps per foot, a power of two 1..128 (version 6). */
  terrainHeightStep: number | null;
  /** Whole feet added to every height (version 6). */
  terrainHeightBase: number | null;
}

export function readTxvInfo(input: Uint8Array | string | readonly TxvLine[]): TxvInfo {
  const lines = Array.isArray(input) ? input as readonly TxvLine[] : parseTxv(input as Uint8Array | string);
  const str = (k: string) => txvValue(lines, k);
  const int = (k: string) => { const v = str(k); if (v == null) return null; const n = Number.parseInt(v, 10); return Number.isFinite(n) ? n : null; };
  const bool = (k: string) => { const n = int(k); return n == null ? null : n !== 0; };
  return {
    formatVersion: int("formatVersion"), tool: str("tool"), toolVersion: str("toolVersion"), built: str("built"),
    legacyFallback: bool("legacyFallback"), hdTextures: bool("hdTextures"), fogVolumes: int("fogVolumes"),
    vegetation: bool("vegetation"), vegTrees: int("vegTrees"), vegClumps: int("vegClumps"),
    terrainGrid: str("terrainGrid"), terrainHeights: str("terrainHeights"), waterfalls: int("waterfalls"),
    worldCells: int("worldCells"), terrainHeightMap: str("terrainHeightMap"), terrainHeightStep: int("terrainHeightStep"),
    terrainHeightBase: int("terrainHeightBase"),
  };
}

/*
  Track format version 6 (the open specification "MTM2 track format version 6: taller tracks and
  larger worlds", https://openmtm2.github.io/proposals/track-format-v6, section 6). A version 6
  track is listed by its WORLD\<stem>.SI3 and must have a .TXV with formatVersion=6. Its keys:

    worldCells         256 or 512 (default 256): cells a side, the world is 32 N ft
    terrainHeightMap   the heights' entry, a .PNG (grey, 8 or 16-bit) or a .RAW (u16); required
                       with worldCells=512, else absent means CP4's rules (DATA\<stem>.RAW or
                       terrainHeights)
    terrainHeightStep  steps per foot: 1, 2, 4, ..., 128 (default 128)
    terrainHeightBase  whole feet added to every height, -32768..32767 (default 0)
    terrainGrid        classic, spline or fine

  A value outside these is refused with a message naming the key, rather than guessed at
  (section 5.2). A formatVersion above 6 loads with a warning. Keys are CP4's: case-insensitive,
  the first line of a key wins (txvValue).
*/
export const TXV_V6_KEYS = ["formatVersion", "worldCells", "terrainHeightMap", "terrainHeightStep", "terrainHeightBase", "terrainGrid"] as const;
/*
  The keys only a .SI3 track may use. Section 5.1 says "any key of section 6 other than
  formatVersion", but terrainGrid is Community Patch 4's own key (formatVersion 5), carried by
  .SI2 tracks today, so it stays allowed there.
*/
export const TXV_V6_ONLY_KEYS = ["worldCells", "terrainHeightMap", "terrainHeightStep", "terrainHeightBase"] as const;
export const TXV_FORMAT_VERSION_V6 = 6;
export const MTM2_WORLD_CELLS = [256, 512] as const;
export const MTM2_HEIGHT_STEPS = [1, 2, 4, 8, 16, 32, 64, 128] as const;

/** The validated version 6 keys of a .SI3 track, defaults filled in. */
export interface TxvV6 {
  formatVersion: number;
  /** N, cells a side: 256 or 512. */
  worldCells: 256 | 512;
  /** W = 32 N, the world's side in feet. */
  worldFt: number;
  /** The heights' entry as written, or null for CP4's rules. */
  terrainHeightMap: string | null;
  terrainHeightStep: number;
  terrainHeightBase: number;
  /** The terrainGrid key, or null when absent (the file's size then picks: classic for N, fine for 4N). */
  terrainGrid: "classic" | "spline" | "fine" | null;
  /** formatVersion above 6: the track may need a newer build. */
  warnings: string[];
}

const WHOLE = /^[+-]?\d+$/;

/** Read and check the version 6 keys of a .SI3 track's .TXV (section 6). Throws a RangeError naming the key. */
export function readTxvV6(input: Uint8Array | string | readonly TxvLine[] | null): TxvV6 {
  if (input == null) throw new RangeError("TXV: a .SI3 track needs DATA\\<stem>.TXV with formatVersion=6");
  const lines = Array.isArray(input) ? input as readonly TxvLine[] : parseTxv(input as Uint8Array | string);
  const whole = (key: string): number | null => {
    const v = txvValue(lines, key);
    if (v === null) return null;
    if (!WHOLE.test(v)) throw new RangeError(`TXV: ${key}=${v} is not a whole number`);
    return Number.parseInt(v, 10);
  };
  const warnings: string[] = [];
  const formatVersion = whole("formatVersion");
  if (formatVersion === null) throw new RangeError("TXV: formatVersion is missing; a .SI3 track needs formatVersion=6");
  if (formatVersion < TXV_FORMAT_VERSION_V6) throw new RangeError(`TXV: formatVersion=${formatVersion}; a .SI3 track needs formatVersion=6`);
  if (formatVersion > TXV_FORMAT_VERSION_V6) warnings.push(`formatVersion=${formatVersion}: this track may need a newer build`);
  const cells = whole("worldCells") ?? 256;
  if (cells !== 256 && cells !== 512) throw new RangeError(`TXV: worldCells=${cells}; allowed: 256 or 512`);
  const step = whole("terrainHeightStep") ?? 128;
  if (!(MTM2_HEIGHT_STEPS as readonly number[]).includes(step)) throw new RangeError(`TXV: terrainHeightStep=${step}; allowed: 1, 2, 4, 8, 16, 32, 64 or 128`);
  const base = whole("terrainHeightBase") ?? 0;
  if (base < -32768 || base > 32767) throw new RangeError(`TXV: terrainHeightBase=${base}; allowed: -32768 to 32767`);
  const gridRaw = txvValue(lines, "terrainGrid");
  let terrainGrid: TxvV6["terrainGrid"] = null;
  if (gridRaw !== null) {
    const g = gridRaw.toLowerCase();
    if (g !== "classic" && g !== "spline" && g !== "fine") throw new RangeError(`TXV: terrainGrid=${gridRaw}; allowed: classic, spline or fine`);
    terrainGrid = g;
  }
  const map = txvValue(lines, "terrainHeightMap");
  if (map !== null && !/\.(png|raw)$/i.test(map)) throw new RangeError(`TXV: terrainHeightMap=${map}; it must name a .PNG or a .RAW`);
  if (map === "") throw new RangeError("TXV: terrainHeightMap is empty");
  if (cells === 512 && map === null) throw new RangeError("TXV: terrainHeightMap is required with worldCells=512");
  return {
    formatVersion, worldCells: cells, worldFt: cells * 32, terrainHeightMap: map, terrainHeightStep: step, terrainHeightBase: base,
    terrainGrid, warnings,
  };
}

/** True when a .TXV uses a key of section 6 other than formatVersion: such a track must be a .SI3. */
export function txvUsesV6Keys(input: Uint8Array | string | readonly TxvLine[]): boolean {
  const lines = Array.isArray(input) ? input as readonly TxvLine[] : parseTxv(input as Uint8Array | string);
  return TXV_V6_ONLY_KEYS.some((k) => txvValue(lines, k) !== null);
}
