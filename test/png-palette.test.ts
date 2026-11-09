/*
  decodePngSamples on palette PNGs (colour type 3) at 1, 2, 4 and 8 bits, with PLTE and tRNS,
  and the tRNS key of grey and RGB images. The fixtures are written here, independently of the
  reader: packed rows, every filter type, zlib from node.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { decodePngSamples } from "../src/index.ts";

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  return out; // the reader does not check CRCs
}

/** A PNG from unfiltered row bytes (`rows[y]` without the filter byte), each row given filter y % 5. */
function pngFromRows(width: number, height: number, depth: number, colorType: number, bpp: number, rows: Uint8Array[], extra: Uint8Array[] = []): Uint8Array {
  const stride = rows[0]!.length;
  const filtered = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const f = y % 5, r = y * (stride + 1);
    filtered[r] = f;
    for (let i = 0; i < stride; i++) {
      const x = rows[y]![i]!;
      const a = i >= bpp ? rows[y]![i - bpp]! : 0;
      const b = y > 0 ? rows[y - 1]![i]! : 0;
      const c = y > 0 && i >= bpp ? rows[y - 1]![i - bpp]! : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]!;
      filtered[r + 1 + i] = (x - pred) & 255;
    }
  }
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr[8] = depth; ihdr[9] = colorType;
  const parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), ...extra, chunk("IDAT", new Uint8Array(deflateSync(filtered))), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, q) => n + q.length, 0));
  let o = 0;
  for (const q of parts) { out.set(q, o); o += q.length; }
  return out;
}

/** Pack indices MSB first, `bits` per pixel, rows padded to a byte. */
function packRow(indices: number[], bits: number): Uint8Array {
  const row = new Uint8Array(Math.ceil((indices.length * bits) / 8));
  indices.forEach((v, x) => { const bit = x * bits; row[bit >> 3]! |= v << (8 - bits - (bit & 7)); });
  return row;
}

for (const bits of [1, 2, 4, 8]) {
  test(`palette PNG at ${bits} bits: indices, PLTE and tRNS`, () => {
    const w = 13, h = 7, n = 1 << bits;
    const idx = (x: number, y: number) => (x * 3 + y * 5) % n;
    const rows = Array.from({ length: h }, (_, y) => packRow(Array.from({ length: w }, (_, x) => idx(x, y)), bits));
    const plte = new Uint8Array(n * 3).map((_, i) => (i * 37 + 11) & 255);
    const trns = Uint8Array.from([0, 128]);
    const png = pngFromRows(w, h, bits, 3, 1, rows, [chunk("PLTE", plte), chunk("tRNS", trns)]);
    const s = decodePngSamples(png);
    assert.equal(s.colorType, 3);
    assert.equal(s.bitDepth, bits);
    assert.equal(s.channels, 1);
    assert.deepEqual([...s.palette!], [...plte]);
    assert.deepEqual([...s.paletteAlpha!], n === 2 ? [0, 128] : [0, 128]);
    assert.equal(s.transparentKey, null);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) assert.equal(s.samples[y * w + x], idx(x, y), `(${x},${y})`);
  });
}

test("a palette PNG without PLTE, or at 16 bits, is refused", () => {
  const rows = [Uint8Array.from([0, 1])];
  assert.throws(() => decodePngSamples(pngFromRows(2, 1, 8, 3, 1, rows)), /without PLTE/);
  assert.throws(() => decodePngSamples(pngFromRows(1, 1, 16, 3, 2, rows, [chunk("PLTE", new Uint8Array(6))])), /not valid for a palette/);
});

test("palette PNG with no tRNS has no alpha table; grey and RGB keep their tRNS key", () => {
  const p = decodePngSamples(pngFromRows(2, 1, 8, 3, 1, [Uint8Array.from([1, 0])], [chunk("PLTE", Uint8Array.from([1, 2, 3, 4, 5, 6]))]));
  assert.equal(p.paletteAlpha, null);
  assert.deepEqual([...p.samples], [1, 0]);
  const g = decodePngSamples(pngFromRows(2, 1, 8, 0, 1, [Uint8Array.from([9, 7])], [chunk("tRNS", Uint8Array.from([0, 7]))]));
  assert.deepEqual(g.transparentKey, [7]);
  assert.equal(g.palette, null);
  const rgb = decodePngSamples(pngFromRows(1, 1, 8, 2, 3, [Uint8Array.from([1, 2, 3])], [chunk("tRNS", Uint8Array.from([0, 1, 0, 2, 0, 3]))]));
  assert.deepEqual(rgb.transparentKey, [1, 2, 3]);
});

test("grey PNGs at 1, 2 and 4 bits unpack MSB first, unscaled", () => {
  // 5 pixels a row: 1-bit 10110 -> 0b10110000; 2-bit 3,0,1,2,3 -> 0b11000110, 0b11000000; 4-bit 15,0,7,8,1.
  const cases: [number, number[], number[]][] = [
    [1, [0b10110000], [1, 0, 1, 1, 0]],
    [2, [0b11000110, 0b11000000], [3, 0, 1, 2, 3]],
    [4, [0xf0, 0x78, 0x10], [15, 0, 7, 8, 1]],
  ];
  for (const [depth, row, want] of cases) {
    const s = decodePngSamples(pngFromRows(5, 2, depth, 0, 1, [Uint8Array.from(row), Uint8Array.from(row)]));
    assert.equal(s.bitDepth, depth);
    assert.equal(s.channels, 1);
    assert.deepEqual([...s.samples], [...want, ...want]);
  }
  assert.throws(() => decodePngSamples(pngFromRows(1, 1, 4, 2, 1, [Uint8Array.of(0)])), /bit depth 4 is not supported/);
});
