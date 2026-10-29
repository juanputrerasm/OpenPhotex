import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SmkError, openSmk, smkInfo } from "../src/index.ts";

/** Bits written least significant first, as Smacker reads them. */
class BitWriter {
  bytes: number[] = [];
  private bit = 0;
  put(value: number, count: number): this {
    for (let i = 0; i < count; i++) {
      if (this.bit === 0) this.bytes.push(0);
      if ((value >>> i) & 1) this.bytes[this.bytes.length - 1]! |= 1 << this.bit;
      this.bit = (this.bit + 1) & 7;
    }
    return this;
  }
  done(): Uint8Array { return Uint8Array.from(this.bytes); }
}

/** An 8-bit tree: a leaf is a number, a node a pair. */
type Tree8 = number | [Tree8, Tree8];
function putTree8(w: BitWriter, t: Tree8): void {
  if (typeof t === "number") { w.put(0, 1); w.put(t, 8); return; }
  w.put(1, 1);
  putTree8(w, t[0]);
  putTree8(w, t[1]);
}
/** The bits that pick leaf `path` (0 left, 1 right) in an 8-bit tree. */
const pathBits = (w: BitWriter, path: number[]) => { for (const b of path) w.put(b, 1); };

/**
 * A 16-bit tree whose leaves are given as [lowPath, highPath] into the two 8-bit trees, with its escapes.
 * `shape` is a big-tree leaf (an index into `leaves`) or a pair.
 */
type Shape = number | [Shape, Shape];
function putBigTree(w: BitWriter, low: Tree8, high: Tree8, escapes: [number, number, number], shape: Shape, leaves: [number[], number[]][]): void {
  w.put(1, 1);
  w.put(1, 1); putTree8(w, low); w.put(0, 1);
  w.put(1, 1); putTree8(w, high); w.put(0, 1);
  for (const e of escapes) w.put(e, 16);
  const walk = (s: Shape) => {
    if (typeof s === "number") { w.put(0, 1); pathBits(w, leaves[s]![0]); pathBits(w, leaves[s]![1]); return; }
    w.put(1, 1); walk(s[0]); walk(s[1]);
  };
  walk(shape);
  w.put(0, 1);
}

const u32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];

/** A Smacker file: `frames` chunks (bytes) with their type bytes, and the trees' bits. */
function makeSmk({ width, height, trees, frames, rate = 100, audioRate = 0 }: {
  width: number; height: number; trees: Uint8Array; frames: { type: number; data: number[] }[]; rate?: number; audioRate?: number;
}): Uint8Array {
  const header = [
    ...[0x53, 0x4d, 0x4b, 0x32], ...u32(width), ...u32(height), ...u32(frames.length), ...u32(rate), ...u32(0),
    ...Array.from({ length: 7 }, (_, k) => u32(k === 0 && audioRate ? 4096 : 0)).flat(),
    ...u32(trees.length), ...u32(64), ...u32(64), ...u32(64), ...u32(64),
    ...Array.from({ length: 7 }, (_, k) => u32(k === 0 ? audioRate : 0)).flat(), ...u32(0),
  ];
  assert.equal(header.length, 104);
  const padded = frames.map((f) => [...f.data, ...Array((4 - (f.data.length % 4)) % 4).fill(0)]);
  return Uint8Array.from([
    ...header, ...padded.flatMap((d) => u32(d.length)), ...frames.map((f) => f.type), ...trees, ...padded.flat(),
  ]);
}

test("a Smacker header: size, frames, frame time, flags and audio tracks", () => {
  const w = new BitWriter();
  for (let k = 0; k < 4; k++) w.put(0, 1);
  const smk = makeSmk({ width: 8, height: 8, trees: w.done(), frames: [{ type: 0, data: [0] }], rate: -6666, audioRate: 0xc0000000 | 11025 });
  const info = smkInfo(smk);
  assert.deepEqual([info.version, info.width, info.height, info.frames, info.frameMs], ["SMK2", 8, 8, 1, 66.66]);
  assert.deepEqual(info.audio, [{ track: 0, rate: 11025, channels: 1, bits: 8, packed: true }]);
  assert.throws(() => smkInfo(Uint8Array.from([1, 2, 3])), SmkError);
});

test("blocks: a fill from a one-leaf type tree; a two-leaf tree fills one block and skips the rest", () => {
  // Every tree absent but the block types: one leaf, FILL (3), a run of 4 (index 3), colour 7.
  const fill = 3 | (3 << 2) | (7 << 8);
  const one = new BitWriter();
  one.put(0, 1).put(0, 1).put(0, 1);
  putBigTree(one, fill & 255, fill >> 8, [0xffff, 0xfffe, 0xfffd], 0, [[[], []]]);
  const palette = [1, 63, 0, 0]; // one 4-byte palette chunk: size 1, entry 0 = (63, 0, 0)... size byte counts itself
  const smk = makeSmk({ width: 8, height: 8, trees: one.done(), frames: [{ type: 1, data: [...palette, 0] }] });
  const d = openSmk(smk);
  const f = d.next()!;
  assert.ok(f.pixels.every((p) => p === 7));
  assert.deepEqual([...f.palette.subarray(0, 3)], [255, 0, 0]);
  assert.equal(d.next(), null);

  // Two leaves: FILL colour 9 for one block (left, bit 0), then SKIP a run of 3 (right, bit 1).
  const fillOne = 3 | (0 << 2) | (9 << 8), skip3 = 2 | (2 << 2);
  const two = new BitWriter();
  two.put(0, 1).put(0, 1).put(0, 1);
  putBigTree(two, [fillOne & 255, skip3 & 255], [fillOne >> 8, skip3 >> 8], [0xffff, 0xfffe, 0xfffd], [0, 1], [[[0], [0]], [[1], [1]]]);
  const video = new BitWriter().put(0, 1).put(1, 1).done();
  const g = openSmk(makeSmk({ width: 8, height: 8, trees: two.done(), frames: [{ type: 0, data: [...video] }] })).next()!;
  const at = (x: number, y: number) => g.pixels[y * 8 + x];
  assert.equal(at(0, 0), 9);
  assert.equal(at(3, 3), 9);
  assert.equal(at(4, 0), 0, "skipped blocks keep the picture before (black)");
});

test("the palette chunk: new entries in 6-bit levels, a skip keeps entries, a copy takes them from the palette before", () => {
  const w = new BitWriter();
  w.put(0, 1).put(0, 1).put(0, 1);
  const fill = 3 | (3 << 2);
  putBigTree(w, fill & 255, fill >> 8, [0xffff, 0xfffe, 0xfffd], 0, [[[], []]]);
  const trees = w.done();
  // Frame 0: entries 0 and 1 new. Frame 1: skip 1 entry, copy 1 entry from old entry 0 into entry 1, then new for entry 2.
  const first = [3, 32, 16, 8, 0, 0, 63, 0x80 | 253, 0, 0, 0];
  first[0] = Math.ceil(first.length / 4);
  const second = [3, 0x80, 0x40, 0, 1, 2, 3, 0x80 | 252];
  second[0] = Math.ceil(second.length / 4);
  const d = openSmk(makeSmk({ width: 4, height: 4, trees, frames: [
    { type: 1, data: [...first, ...Array(first[0]! * 4 - first.length).fill(0)] },
    { type: 1, data: [...second, ...Array(second[0]! * 4 - second.length).fill(0)] },
  ] }));
  const a = d.next()!;
  assert.deepEqual([...a.palette.subarray(0, 6)], [130, 65, 32, 0, 0, 255]);
  const b = d.next()!;
  assert.deepEqual([...b.palette.subarray(0, 9)], [130, 65, 32, 130, 65, 32, 4, 8, 12]);
});

test("packed 8-bit audio: the first sample as is, then deltas from its tree", () => {
  const w = new BitWriter();
  w.put(0, 1).put(0, 1).put(0, 1);
  putBigTree(w, (3 | (3 << 2)) & 255, 0, [0xffff, 0xfffe, 0xfffd], 0, [[[], []]]);
  const audio = new BitWriter();
  audio.put(1, 1).put(0, 1).put(0, 1); // data, mono, 8-bit
  audio.put(0, 1); putTree8(audio, 2); audio.put(0, 1); // one tree, a lone leaf: every delta is 2
  audio.put(128, 8);
  const bits = [...audio.done()];
  const chunk = [...u32(8 + bits.length), ...u32(4), ...bits];
  const d = openSmk(makeSmk({ width: 4, height: 4, trees: w.done(), audioRate: 0xc0000000 | 22050, frames: [{ type: 2, data: chunk }] }));
  const f = d.next()!;
  assert.equal(f.audio.length, 1);
  assert.deepEqual([...f.audio[0]!.samples].map((v) => Math.round(v * 128 + 128)), [128, 130, 132, 134]);
});

const VIDEOS = join(process.env.OPENPHOTEX_GAMES ?? join(process.env.HOME ?? "", "games"), "mtm2", "VIDEOS");
test("Monster Truck Madness 2's films decode to their last frame, sound as long as picture", { skip: existsSync(VIDEOS) ? false : `no ${VIDEOS}` }, () => {
  for (const name of readdirSync(VIDEOS).filter((n) => /\.smk$/i.test(n))) {
    const d = openSmk(new Uint8Array(readFileSync(join(VIDEOS, name))));
    let frames = 0, samples = 0;
    for (let f = d.next(); f; f = d.next()) { frames++; for (const a of f.audio) samples += a.samples.length; }
    assert.equal(frames, d.info.frames, name);
    const seconds = (frames * d.info.frameMs) / 1000;
    if (d.info.audio.length) assert.ok(Math.abs(samples / d.info.audio[0]!.rate - seconds) < 0.5, `${name}: audio ${samples} samples for ${seconds} s`);
  }
});
