import test from "node:test";
import assert from "node:assert/strict";
import { parsePod, readPodEntry, PodFormatError } from "../src/index.ts";
import { buildPod1, buildPod2, latin1 } from "./fixtures/build.ts";

function assertPodError(fn: () => unknown, code: string, entryIndex?: number) {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof PodFormatError, `expected PodFormatError, got ${error}`);
    assert.equal(error.code, code);
    if (entryIndex !== undefined) assert.equal(error.entryIndex, entryIndex);
    return true;
  });
}

test("POD2: header, records, name table and payloads", () => {
  const bytes = buildPod2(
    [
      { name: "levels\\peak.lvl", data: "level", timestamp: 946684800, crc: 0x12345678 },
      { name: "art\\sky.raw", data: new Uint8Array([1, 2, 3]) },
    ],
    { comment: "Pikes Peak", checksum: 0xcafef00d, auditCount: 7 },
  );
  const pod = parsePod(bytes);
  assert.equal(pod.format, "pod2");
  assert.equal(pod.comment, "Pikes Peak");
  assert.equal(pod.checksum, 0xcafef00d);
  assert.equal(pod.auditCount, 7);
  assert.equal(pod.directoryOffset, 0x60);
  // Records, then a name table of "levels\peak.lvl\0art\sky.raw\0".
  assert.equal(pod.directoryEnd, 0x60 + 2 * 20 + 16 + 12);

  assert.deepEqual(pod.entries[0], {
    index: 0,
    name: "levels\\peak.lvl",
    normalizedName: "LEVELS/PEAK.LVL",
    title: "PEAK.LVL",
    length: 5,
    offset: pod.directoryEnd,
    recordOffset: 0x60,
    paletteName: null,
    timestamp: 946684800,
    crc: 0x12345678,
  });
  assert.equal(pod.entries[1].recordOffset, 0x60 + 20);
  assert.equal(new TextDecoder().decode(readPodEntry(bytes, pod.entries[0])), "level");
  assert.deepEqual(readPodEntry(bytes, pod.entries[1]), new Uint8Array([1, 2, 3]));
});

test("POD2: identified by signature even where a POD1 reading would also be possible", () => {
  const pod = parsePod(buildPod2([{ name: "A.TXT", data: "a" }]));
  assert.equal(pod.format, "pod2");
  assert.equal(parsePod(buildPod1([{ name: "A.TXT", data: "a" }])).format, "pod1");
});

test("POD2: entries may share name-table strings", () => {
  const nameTable = latin1("shared.txt\0");
  const pod = parsePod(buildPod2([{ name: "", data: "1" }, { name: "", data: "2" }], { nameTable, nameOffsets: [0, 0] }));
  assert.deepEqual(pod.entries.map((e) => e.name), ["shared.txt", "shared.txt"]);
});

test("POD2: name offsets outside the name table, unterminated and empty names are rejected", () => {
  assertPodError(() => parsePod(buildPod2([{ name: "A.TXT" }], { nameOffsets: [100] })), "BAD_ENTRY_NAME", 0);
  assertPodError(
    () => parsePod(buildPod2([{ name: "", data: "payload" }], { nameTable: latin1("NOTERMINATOR"), nameOffsets: [0] })),
    "BAD_ENTRY_NAME",
    0,
  );
  assertPodError(
    () => parsePod(buildPod2([{ name: "", data: "payload" }], { nameTable: latin1("  \0"), nameOffsets: [0] })),
    "BAD_ENTRY_NAME",
    0,
  );
});

/*
  The name table is bounded by the first payload, not EOF, so a corrupt name offset cannot
  walk into payload data looking for a NUL.
*/
test("POD2: the name table stops at the first payload", () => {
  const bytes = buildPod2([{ name: "", data: "PAYLOAD\0" }], { nameTable: latin1("A.TXT"), nameOffsets: [0] });
  assertPodError(() => parsePod(bytes), "BAD_ENTRY_NAME", 0);
});

test("POD2: payloads outside the file are rejected", () => {
  assertPodError(() => parsePod(buildPod2([{ name: "A.TXT", data: "x", length: 50 }])), "ENTRY_OUT_OF_BOUNDS", 0);
});

test("POD2: bad counts and truncation", () => {
  const empty = buildPod2([]);
  assertPodError(() => parsePod(empty), "BAD_ENTRY_COUNT");
  const tooMany = buildPod2([{ name: "A.TXT" }]);
  new DataView(tooMany.buffer).setUint32(0x58, 65537, true);
  assertPodError(() => parsePod(tooMany), "BAD_ENTRY_COUNT");
  assertPodError(() => parsePod(latin1("POD2" + "\0".repeat(20))), "TOO_SMALL");
  const truncated = buildPod2([{ name: "A.TXT" }, { name: "B.TXT" }]);
  assertPodError(() => parsePod(truncated.subarray(0, 0x60 + 25)), "DIRECTORY_OUT_OF_BOUNDS");
});
