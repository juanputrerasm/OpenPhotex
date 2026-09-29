import test from "node:test";
import assert from "node:assert/strict";
import { decodeTiff, isTiff } from "../src/index.ts";

interface Tag { tag: number; type: number; values: number[] }

/** A little-endian single-strip TIFF with the given tags and pixel bytes. */
function buildTiff(tags: Tag[], pixels: Uint8Array): Uint8Array {
  const sizes: Record<number, number> = { 3: 2, 4: 4 };
  const ifd = 8;
  const ifdSize = 2 + tags.length * 12 + 4;
  let extra = ifd + ifdSize;
  const blobs: [number, Tag][] = [];
  const all = [...tags].sort((a, b) => a.tag - b.tag);
  for (const t of all) if (sizes[t.type] * t.values.length > 4) { blobs.push([extra, t]); extra += sizes[t.type] * t.values.length; }
  const pixelOffset = extra;
  const out = new Uint8Array(pixelOffset + pixels.length);
  const view = new DataView(out.buffer);
  out.set([0x49, 0x49], 0); view.setUint16(2, 42, true); view.setUint32(4, ifd, true);
  view.setUint16(ifd, all.length, true);
  all.forEach((t, i) => {
    const at = ifd + 2 + i * 12;
    const values = t.tag === 273 ? [pixelOffset] : t.values;
    view.setUint16(at, t.tag, true); view.setUint16(at + 2, t.type, true); view.setUint32(at + 4, values.length, true);
    const blob = blobs.find(([, b]) => b === t);
    const write = (base: number) => values.forEach((v, k) => (t.type === 3 ? view.setUint16(base + k * 2, v, true) : view.setUint32(base + k * 4, v, true)));
    if (blob) { view.setUint32(at + 8, blob[0], true); write(blob[0]); } else write(at + 8);
  });
  out.set(pixels, pixelOffset);
  return out;
}

const base = (w: number, h: number, photometric: number, samples: number): Tag[] => [
  { tag: 256, type: 3, values: [w] }, { tag: 257, type: 3, values: [h] }, { tag: 258, type: 3, values: Array(samples).fill(8) },
  { tag: 259, type: 3, values: [1] }, { tag: 262, type: 3, values: [photometric] }, { tag: 273, type: 4, values: [0] },
  { tag: 277, type: 3, values: [samples] }, { tag: 279, type: 4, values: [w * h * samples] },
];

test("palette TIFF with an opacity sample; the ColorMap's 16-bit runs", () => {
  const colorMap = new Array(768).fill(0);
  colorMap[1] = 0xff00; colorMap[256 + 1] = 0x8000; colorMap[512 + 1] = 0x1000;
  const tiff = buildTiff([...base(2, 1, 3, 2), { tag: 320, type: 3, values: colorMap }], Uint8Array.from([1, 77, 0, 255]));
  assert.equal(isTiff(tiff), true);
  const image = decodeTiff(tiff, "A.TIF");
  assert.equal(image.kind, "palette");
  assert.equal(image.hasAlpha, true);
  assert.deepEqual([...image.rgba], [255, 128, 16, 77, 0, 0, 0, 255]);
});

test("RGBA TIFF: the Evo 2 _BUMP normal-map form", () => {
  const image = decodeTiff(buildTiff(base(1, 1, 2, 4), Uint8Array.from([128, 127, 253, 255])), "N.TIF");
  assert.equal(image.kind, "rgb");
  assert.deepEqual([...image.rgba], [128, 127, 253, 255]);
});

test("forms Evo does not ship are refused with a reason", () => {
  assert.throws(() => decodeTiff(buildTiff(base(1, 1, 1, 1), Uint8Array.from([5])), "G.TIF"), /photometric 1/);
  const compressed = base(1, 1, 2, 3); compressed[3] = { tag: 259, type: 3, values: [5] };
  assert.throws(() => decodeTiff(buildTiff(compressed, Uint8Array.from([1, 2, 3])), "C.TIF"), /compression 5/);
  assert.throws(() => decodeTiff(buildTiff(base(1, 1, 3, 1), Uint8Array.from([0])), "P.TIF"), /no usable ColorMap/);
  assert.equal(isTiff(Uint8Array.from([0x4d, 0x4d, 0, 42, 0, 0, 0, 8])), true);
  assert.equal(isTiff(Uint8Array.from([1, 2, 3])), false);
});
