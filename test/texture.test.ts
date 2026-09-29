import test from "node:test";
import assert from "node:assert/strict";
import { actPaletteDepth, applyOpacityPlane, decodeActPalette, decodeIndexedImage, decodeRawTexture, rawTextureSide } from "../src/index.ts";

function palette(fill: (i: number) => [number, number, number]): Uint8Array {
  const out = new Uint8Array(768);
  for (let i = 0; i < 256; i++) out.set(fill(i), i * 3);
  return out;
}

test("an 8-bit palette is returned as stored, as a copy", () => {
  const act = palette((i) => [i, 255 - i, 128]);
  const decoded = decodeActPalette(act)!;
  assert.deepEqual(decoded, act);
  assert.notEqual(decoded.buffer, act.buffer);
  assert.equal(actPaletteDepth(act), 8);
});

test("a palette whose brightest channel is exactly 63 is 6-bit, scaled so 63 is 255", () => {
  const act = palette((i) => [i % 64, 63, 0]);
  assert.equal(actPaletteDepth(act), 6);
  const decoded = decodeActPalette(act)!;
  assert.deepEqual([...decoded.subarray(0, 3)], [0, 255, 0]);
  assert.deepEqual([...decoded.subarray(3 * 32, 3 * 32 + 3)], [Math.round((32 * 255 + 31) / 63), 255, 0]);
  assert.equal(decoded[3 * 63], 255);
});

test("a dark 8-bit palette (brightest under 63) is NOT brightened", () => {
  // NITESKY-like: every channel at or under 41.
  const act = palette((i) => [i % 42, i % 20, 5]);
  assert.equal(actPaletteDepth(act), 8);
  assert.deepEqual(decodeActPalette(act), act);
  // All zeros (MI4BLACK, BOMB) stays black.
  assert.deepEqual(decodeActPalette(new Uint8Array(768)), new Uint8Array(768));
});

test("only the first 768 bytes are a palette; fewer is no palette", () => {
  const act = new Uint8Array(800).fill(200);
  act[790] = 63;
  assert.equal(decodeActPalette(act)!.length, 768);
  assert.equal(decodeActPalette(new Uint8Array(767)), null);
  assert.equal(decodeActPalette(null), null);
  assert.equal(actPaletteDepth(new Uint8Array(10)), null);
});

test("rawTextureSide: square powers of two within each family's limits", () => {
  assert.equal(rawTextureSide(64 * 64), 64);
  assert.equal(rawTextureSide(32 * 32), 32);
  assert.equal(rawTextureSide(1024 * 1024), 1024);
  assert.equal(rawTextureSide(16 * 16), 0);
  assert.equal(rawTextureSide(2048 * 2048), 0);
  assert.equal(rawTextureSide(60 * 60), 0);
  assert.equal(rawTextureSide(64 * 32), 0);
  assert.equal(rawTextureSide(8 * 8, "evo"), 8);
  assert.equal(rawTextureSide(2048 * 2048, "evo"), 2048);
  assert.equal(rawTextureSide(4096 * 4096, "evo"), 0);
});

test("decodeRawTexture maps indices through the palette, opaque", () => {
  const raw = new Uint8Array(32 * 32).map((_, i) => i % 256);
  const act = palette((i) => [i, i >> 1, 255 - i]);
  const image = decodeRawTexture(raw, act);
  assert.equal(image.width, 32);
  assert.equal(image.height, 32);
  assert.equal(image.hasAlpha, false);
  assert.ok(image.rgba instanceof Uint8ClampedArray);
  assert.deepEqual([...image.rgba.subarray(4 * 5, 4 * 6)], [5, 2, 250, 255]);
});

test("cutout: palette-black texels become transparent black; other texels stay opaque", () => {
  const act = palette((i) => (i === 7 ? [0, 0, 0] : [10, 20, 30]));
  const raw = new Uint8Array(32 * 32).fill(1);
  raw[0] = 7;
  const plain = decodeRawTexture(raw, act);
  assert.deepEqual([...plain.rgba.subarray(0, 4)], [0, 0, 0, 255]);
  const cut = decodeRawTexture(raw, act, { cutout: true });
  assert.equal(cut.hasAlpha, true);
  assert.deepEqual([...cut.rgba.subarray(0, 4)], [0, 0, 0, 0]);
  assert.deepEqual([...cut.rgba.subarray(4, 8)], [10, 20, 30, 255]);
});

test("decodeRawTexture refuses sizes the family does not use and short palettes", () => {
  assert.throws(() => decodeRawTexture(new Uint8Array(16 * 16), new Uint8Array(768)), RangeError);
  assert.equal(decodeRawTexture(new Uint8Array(16 * 16), new Uint8Array(768), { family: "evo" }).width, 16);
  assert.throws(() => decodeRawTexture(new Uint8Array(64 * 64), new Uint8Array(700)), RangeError);
});

test("applyOpacityPlane writes a full alpha gradient, and ignores a plane of the wrong size", () => {
  const image = decodeRawTexture(new Uint8Array(8 * 8), palette(() => [1, 2, 3]), { family: "evo" });
  const opa = new Uint8Array(64).map((_, i) => i * 4);
  const withAlpha = applyOpacityPlane(image, opa);
  assert.equal(withAlpha.hasAlpha, true);
  assert.equal(withAlpha.rgba[4 * 10 + 3], 40);
  const untouched = decodeRawTexture(new Uint8Array(8 * 8), palette(() => [1, 2, 3]), { family: "evo" });
  assert.equal(applyOpacityPlane(untouched, new Uint8Array(63)), untouched);
  assert.equal(applyOpacityPlane(untouched, null).hasAlpha, false);
});

test("decodeIndexedImage: any size; missing texels transparent, extra indices ignored", () => {
  const act = palette((i) => [i, 0, 0]);
  const screen = decodeIndexedImage(new Uint8Array(320 * 200).fill(9), act, 320, 200);
  assert.equal(screen.width, 320);
  assert.equal(screen.hasAlpha, false);
  assert.deepEqual([...screen.rgba.subarray(0, 4)], [9, 0, 0, 255]);
  const short = decodeIndexedImage(new Uint8Array(3).fill(5), act, 2, 2);
  assert.equal(short.hasAlpha, true);
  assert.deepEqual([...short.rgba.subarray(8, 16)], [5, 0, 0, 255, 0, 0, 0, 0]);
  assert.equal(decodeIndexedImage(new Uint8Array(10), act, 2, 2).rgba.length, 16);
  assert.throws(() => decodeIndexedImage(new Uint8Array(4), act, 0, 4), RangeError);
});
