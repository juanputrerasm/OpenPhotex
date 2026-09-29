/*
  Synthetic POD builders for tests.

  They write the byte layout directly, independent of the parser, so a test states the format
  it expects rather than round-tripping the implementation. No game data is involved.
*/

export interface FixtureEntry {
  name: string;
  data?: Uint8Array | string;
  /** POD1: bytes written into the name field after the path's NUL (palette name, packer junk). */
  nameFieldTail?: Uint8Array | string;
  /** POD1: replace the whole 32-byte name field verbatim. */
  rawNameField?: Uint8Array;
  /** Override the stored payload length / offset, to build corrupt archives. */
  length?: number;
  offset?: number;
  /** POD2 */
  timestamp?: number;
  crc?: number;
}

export function latin1(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

function toBytes(data: Uint8Array | string | undefined): Uint8Array {
  if (data === undefined) return new Uint8Array(0);
  return typeof data === "string" ? latin1(data) : data;
}

/** POD1: int32 count, 80-byte comment, then 40-byte records (32-byte name, uint32 length, uint32 offset), then payloads. */
export function buildPod1(entries: FixtureEntry[], options: { comment?: string | Uint8Array; count?: number } = {}): Uint8Array {
  const payloads = entries.map((e) => toBytes(e.data));
  const directoryEnd = 84 + entries.length * 40;
  const total = directoryEnd + payloads.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setInt32(0, options.count ?? entries.length, true);
  out.set(toBytes(options.comment ?? "").subarray(0, 79), 4);

  let cursor = directoryEnd;
  entries.forEach((entry, i) => {
    const record = 84 + i * 40;
    if (entry.rawNameField) {
      out.set(entry.rawNameField.subarray(0, 32), record);
    } else {
      const name = latin1(entry.name);
      out.set(name, record);
      if (entry.nameFieldTail !== undefined) out.set(toBytes(entry.nameFieldTail), record + name.length + 1);
    }
    view.setUint32(record + 32, entry.length ?? payloads[i].length, true);
    view.setUint32(record + 36, entry.offset ?? cursor, true);
    out.set(payloads[i], cursor);
    cursor += payloads[i].length;
  });
  return out;
}

/** POD2: "POD2", checksum, 80-byte comment, count, audit count, 20-byte records, name table, payloads. */
export function buildPod2(
  entries: FixtureEntry[],
  options: { comment?: string; checksum?: number; auditCount?: number; nameOffsets?: number[]; nameTable?: Uint8Array } = {},
): Uint8Array {
  const payloads = entries.map((e) => toBytes(e.data));
  const tableEnd = 0x60 + entries.length * 20;

  let nameTable: Uint8Array;
  let nameOffsets: number[];
  if (options.nameTable) {
    nameTable = options.nameTable;
    nameOffsets = options.nameOffsets ?? entries.map(() => 0);
  } else {
    const parts = entries.map((e) => latin1(e.name + "\0"));
    nameOffsets = [];
    let at = 0;
    for (const part of parts) { nameOffsets.push(at); at += part.length; }
    nameTable = new Uint8Array(at);
    parts.forEach((part, i) => nameTable.set(part, nameOffsets[i]));
    if (options.nameOffsets) nameOffsets = options.nameOffsets;
  }

  const dataStart = tableEnd + nameTable.length;
  const total = dataStart + payloads.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  out.set(latin1("POD2"), 0);
  view.setUint32(0x04, options.checksum ?? 0xdeadbeef, true);
  out.set(latin1(options.comment ?? "").subarray(0, 79), 0x08);
  view.setUint32(0x58, entries.length, true);
  view.setUint32(0x5c, options.auditCount ?? 0, true);
  out.set(nameTable, tableEnd);

  let cursor = dataStart;
  entries.forEach((entry, i) => {
    const record = 0x60 + i * 20;
    view.setUint32(record + 0, nameOffsets[i], true);
    view.setUint32(record + 4, entry.length ?? payloads[i].length, true);
    view.setUint32(record + 8, entry.offset ?? cursor, true);
    view.setUint32(record + 12, entry.timestamp ?? 0, true);
    view.setUint32(record + 16, entry.crc ?? 0, true);
    out.set(payloads[i], cursor);
    cursor += payloads[i].length;
  });
  return out;
}

/**
 * EPD: "dtxe", 4-byte title, junk to the count at 0x90, junk to the table at 0x110, then 80-byte
 * records (4-byte prefix, 60-byte remainder, length, offset, timestamp, unknown), then payloads.
 * String padding is filled with the BA AD F0 0D debug-heap pattern, as in the one known sample.
 */
export function buildEpd(
  entries: (FixtureEntry & { prefix?: string; remainder?: string })[],
  options: { title?: string } = {},
): Uint8Array {
  const payloads = entries.map((e) => toBytes(e.data));
  const tableEnd = 0x110 + entries.length * 80;
  const total = tableEnd + payloads.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  const junk = [0xba, 0xad, 0xf0, 0x0d];
  for (let i = 0; i < tableEnd; i++) out[i] = junk[i % 4];
  out.set(latin1("dtxe"), 0);
  out.set(latin1((options.title ?? "TEST").padEnd(4, "\0").slice(0, 4)), 4);
  view.setUint32(0x90, entries.length, true);

  let cursor = tableEnd;
  entries.forEach((entry, i) => {
    const record = 0x110 + i * 80;
    // Default split: a directory prefix and a remainder starting with '\', as Fly! writes them.
    const slash = entry.name.indexOf("\\");
    const prefix = entry.prefix ?? (slash > 0 && slash <= 4 ? entry.name.slice(0, slash) : "");
    const remainder = entry.remainder ?? (prefix ? entry.name.slice(prefix.length) : entry.name);
    out.set(latin1(prefix + (prefix.length < 4 ? "\0" : "")), record);
    out.set(latin1(remainder + "\0"), record + 4);
    view.setUint32(record + 64, entry.length ?? payloads[i].length, true);
    view.setUint32(record + 68, entry.offset ?? cursor, true);
    view.setUint32(record + 72, entry.timestamp ?? 0, true);
    view.setUint32(record + 76, entry.crc ?? 0, true);
    out.set(payloads[i], cursor);
    cursor += payloads[i].length;
  });
  return out;
}
