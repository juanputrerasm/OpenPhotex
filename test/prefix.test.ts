/*
  Parsing a directory from the start of a file, as a browser does with a File or Blob it does
  not want to load whole.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { parsePod, podDirectoryEnd, PodFormatError } from "../src/index.ts";
import { buildPod1, buildPod2 } from "./fixtures/build.ts";

/** The read loop a caller writes: grow the prefix until podDirectoryEnd stops asking for more. */
function readDirectoryPrefix(file: Uint8Array): { prefix: Uint8Array; reads: number } {
  let prefix = file.subarray(0, 0);
  let reads = 0;
  for (;;) {
    const need = podDirectoryEnd(prefix, file.length);
    if (need <= prefix.length) return { prefix, reads };
    prefix = file.subarray(0, need);
    reads++;
  }
}

const pod1 = buildPod1([
  { name: "ART\\A.RAW", nameFieldTail: "A.ACT\0", data: "x".repeat(1000) },
  { name: "DATA\\B.SIT", data: "y".repeat(500) },
], { comment: "prefix" });
const pod2 = buildPod2([
  { name: "levels\\a.lvl", data: "x".repeat(1000), timestamp: 5, crc: 6 },
  { name: "art\\b.raw", data: "y".repeat(500) },
], { comment: "prefix", checksum: 1, auditCount: 2 });

test("a directory read from a prefix equals one read from the whole file", () => {
  for (const file of [pod1, pod2]) {
    const { prefix } = readDirectoryPrefix(file);
    const whole = parsePod(file);
    assert.equal(prefix.length, whole.directoryEnd);
    assert.ok(prefix.length < file.length);
    assert.deepEqual(parsePod(prefix, { byteLength: file.length }), whole);
  }
});

test("POD1 settles in two reads, POD2 in three", () => {
  assert.equal(readDirectoryPrefix(pod1).reads, 2);
  assert.equal(readDirectoryPrefix(pod2).reads, 3);
});

test("payload bounds are checked against byteLength, not the prefix", () => {
  const { prefix } = readDirectoryPrefix(pod1);
  assert.throws(() => parsePod(prefix, { byteLength: pod1.length - 1 }), (e: unknown) =>
    e instanceof PodFormatError && e.code === "ENTRY_OUT_OF_BOUNDS" && e.entryIndex === 1);
});

test("too short a prefix is a RangeError, not a format error", () => {
  assert.throws(() => parsePod(pod1.subarray(0, 100), { byteLength: pod1.length }), RangeError);
  assert.throws(() => parsePod(pod2.subarray(0, 0x60 + 20), { byteLength: pod2.length }), RangeError);
  assert.throws(() => parsePod(pod1, { byteLength: 10 }), RangeError);
});

test("podDirectoryEnd on non-POD bytes still terminates, and parsePod then rejects them", () => {
  const junk = new Uint8Array(4096).fill(0x41);
  const { prefix } = readDirectoryPrefix(junk);
  assert.throws(() => parsePod(prefix, { byteLength: junk.length }), (e: unknown) =>
    e instanceof PodFormatError && e.code === "BAD_ENTRY_COUNT");
  const tiny = new Uint8Array(2);
  assert.equal(readDirectoryPrefix(tiny).prefix.length, 2);
  assert.throws(() => parsePod(tiny), (e: unknown) => e instanceof PodFormatError && e.code === "TOO_SMALL");
});
