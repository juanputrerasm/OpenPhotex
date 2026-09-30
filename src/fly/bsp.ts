import { parseBin, type BinModel } from "../model/bin.ts";

/*
  Fly!'s .BSP models: the big structures a scenery set places, its bridges above all
  (GOLD1.BSP is the Golden Gate Bridge). See docs/FLY.md.

  A .BSP is an MRGL model cut up for a painter's-algorithm renderer. Tags are four characters
  in angle brackets followed by a NUL, as in the text formats but binary:

    <bgno>
    <vbin> uint32 byteLength, then int32 x, y, z vertex words, as in a .BIN vertex list
    <ibin> uint32 byteLength, the same size again: per-vertex data, not identified
    <root>
      <bgno> <abcd> 4 float32 (a splitting plane)  <mrgl> MRGL records ... MRGL_EOL
             <frnt> <bgno> ... <endo>               the node in front of the plane
             <back> <bgno> ... <endo>               and the one behind it
      <endo>
    <endo>

  Each node's <mrgl> records are what a .BIN carries after its vertex list: MRGL_TEXTURE
  and textured facets that index the shared <vbin> list. A renderer with a depth buffer needs
  no BSP order, so the reader splices every node's records behind one vertex list and reads
  the result as the .BIN it amounts to, with parseBin. Verified on all 22 stock .BSP files:
  every face reads, every stream ends in MRGL_EOL, and the models measure as the real
  structures do (the Golden Gate Bridge 750 ft tall and 6,749 ft long, its towers 746 ft).
*/

/** A .BSP read as one model. */
export interface FlyBsp {
  /** Every node's faces over the shared vertex list, exactly as parseBin returns a .BIN. */
  model: BinModel;
  /** How many BSP nodes (splitting planes) the file has. */
  nodeCount: number;
}

const TAG = /^<[a-z ]{4}>$/;
const STRUCTURE = new Set(["bgno", "endo", "root", "frnt", "back"]);
const MRGL_MAGNIFY = 20;
const MRGL_VLIST = 2;

export function parseFlyBsp(bytes: Uint8Array, sourceName = ".BSP"): FlyBsp {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 6));
  const isTag = (at: number) => at + 7 <= bytes.length && TAG.test(text(at)) && bytes[at + 6] === 0;

  let vertices: Uint8Array | null = null;
  const records: Uint8Array[] = [];
  let nodeCount = 0;
  let at = 0;
  while (at < bytes.length) {
    if (!isTag(at)) throw new Error(`${sourceName}: expected a tag at 0x${at.toString(16)}`);
    const tag = text(at).slice(1, 5);
    at += 7;
    if (tag === "vbin" || tag === "ibin") {
      if (at + 4 > bytes.length) throw new Error(`${sourceName}: <${tag}> has no length`);
      const length = view.getUint32(at, true);
      if (at + 4 + length > bytes.length) throw new Error(`${sourceName}: <${tag}> runs past the end`);
      if (tag === "vbin") {
        if (length % 12) throw new Error(`${sourceName}: <vbin> is ${length} bytes, not whole vertices`);
        vertices = bytes.subarray(at + 4, at + 4 + length);
      }
      at += 4 + length;
    } else if (tag === "abcd") {
      nodeCount++;
      at += 16;
    } else if (tag === "mrgl") {
      // The records run to the next structural tag; MRGL has no length of its own to go by.
      let end = at;
      while (end < bytes.length && !(bytes[end] === 0x3c && isTag(end) && STRUCTURE.has(text(end).slice(1, 5)))) end++;
      if (end - at < 4 || view.getUint32(end - 4, true) !== 0) {
        throw new Error(`${sourceName}: the <mrgl> at 0x${(at - 7).toString(16)} does not end in MRGL_EOL`);
      }
      records.push(bytes.subarray(at, end - 4));
      at = end;
    } else if (!STRUCTURE.has(tag)) {
      throw new Error(`${sourceName}: unknown tag <${tag}> at 0x${(at - 7).toString(16)}`);
    }
  }
  if (!vertices) throw new Error(`${sourceName}: no <vbin> vertex list`);

  // MRGL_MAGNIFY 65536, MRGL_VLIST from 0, the vertices, every node's records, MRGL_EOL.
  const header = new Uint8Array(20);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, MRGL_MAGNIFY, true);
  headerView.setUint32(4, 65536, true);
  headerView.setUint32(8, MRGL_VLIST, true);
  headerView.setUint32(12, 0, true);
  headerView.setUint32(16, vertices.length / 12, true);
  const total = header.length + vertices.length + records.reduce((sum, r) => sum + r.length, 0) + 4;
  const bin = new Uint8Array(total);
  let cursor = 0;
  for (const part of [header, vertices, ...records]) {
    bin.set(part, cursor);
    cursor += part.length;
  }
  return { model: parseBin(bin), nodeCount };
}
