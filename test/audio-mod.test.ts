import test from "node:test";
import assert from "node:assert/strict";
import { parseMod, renderMod } from "../src/index.ts";

/** A 4-channel module: one pattern of `rows` used rows, one square-wave sample, `notes` playing on channel 1. */
function makeMod(cells: { row: number; channel: number; period: number; sample: number; effect?: number; param?: number }[], songLength = 1): Uint8Array {
  const channels = 4;
  const bytes = new Uint8Array(1084 + 64 * channels * 4 + 64);
  bytes.set(new TextEncoder().encode("TEST"), 0);
  // Sample 1: 64 bytes, square, volume 64, no loop.
  const o = 20;
  bytes[o + 22] = 0; bytes[o + 23] = 32; bytes[o + 25] = 64; bytes[o + 29] = 1;
  bytes[950] = songLength;
  bytes.set(new TextEncoder().encode("M.K."), 1080);
  for (const c of cells) {
    const at = 1084 + (c.row * channels + c.channel) * 4;
    bytes[at] = (c.sample & 0xf0) | (c.period >> 8); bytes[at + 1] = c.period & 255;
    bytes[at + 2] = ((c.sample & 15) << 4) | (c.effect ?? 0); bytes[at + 3] = c.param ?? 0;
  }
  const data = 1084 + 64 * channels * 4;
  for (let i = 0; i < 64; i++) bytes[data + i] = i < 32 ? 100 : 156;
  return bytes;
}

test("a module's header and cells read: signature, channels, orders, a cell's sample and period", () => {
  const song = parseMod(makeMod([{ row: 2, channel: 1, period: 428, sample: 1 }]))!;
  assert.equal(song.title, "TEST");
  assert.equal(song.channels, 4);
  assert.equal(song.songLength, 1);
  assert.equal(song.samples[0]!.length, 64);
  assert.equal(song.samples[0]!.data.length, 64);
  assert.deepEqual(song.patterns[0]![2 * 4 + 1], { sample: 1, period: 428, effect: 0, param: 0 });
  assert.equal(parseMod(new Uint8Array(2000)), null, "no signature");
  assert.equal(parseMod(new Uint8Array(10)), null);
});

test("a song plays once through at speed 6, tempo 125: 64 rows of 6 ticks of 20 ms", () => {
  const song = parseMod(makeMod([{ row: 0, channel: 0, period: 428, sample: 1 }]))!;
  const out = renderMod(song, { sampleRate: 8000 });
  assert.equal(out.left.length, 64 * 6 * 160);
  assert.ok(out.left.some((v) => Math.abs(v) > 0.05), "the note sounds");
  assert.ok(out.left.every((v) => v >= -1 && v <= 1));
  // Channel 0 is on the left: more there than on the right (separation 0.5).
  const energy = (a: Float32Array) => a.reduce((s, v) => s + v * v, 0);
  assert.ok(energy(out.left) > energy(out.right) * 1.5);
});

test("tempo and speed effects change the length; a pattern break skips the rest of the pattern", () => {
  const fast = parseMod(makeMod([{ row: 0, channel: 0, period: 428, sample: 1, effect: 0xf, param: 3 }]))!;
  assert.equal(renderMod(fast, { sampleRate: 8000 }).left.length, 64 * 3 * 160);
  const breaks = parseMod(makeMod([{ row: 7, channel: 0, period: 0, sample: 0, effect: 0xd, param: 0 }]))!;
  assert.equal(renderMod(breaks, { sampleRate: 8000 }).left.length, 8 * 6 * 160);
  const tempo = parseMod(makeMod([{ row: 0, channel: 0, period: 0, sample: 0, effect: 0xf, param: 250 }]))!;
  assert.equal(renderMod(tempo, { sampleRate: 8000 }).left.length, 64 * 6 * 80);
});

test("a position jump back to the start ends the render at the loop point", () => {
  const looping = parseMod(makeMod([{ row: 15, channel: 0, period: 0, sample: 0, effect: 0xb, param: 0 }], 1))!;
  const out = renderMod(looping, { sampleRate: 8000 });
  assert.equal(out.loopStartFrame, 0);
  assert.equal(out.left.length, 16 * 6 * 160);
});
