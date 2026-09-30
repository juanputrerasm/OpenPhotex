import test from "node:test";
import assert from "node:assert/strict";
import { parsePod, podDirectoryEnd, readPodEntry, PodFormatError } from "../src/index.ts";
import { buildEpd, latin1 } from "./fixtures/build.ts";

function assertPodError(fn: () => unknown, code: string, entryIndex?: number) {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof PodFormatError, `expected PodFormatError, got ${error}`);
    assert.equal(error.code, code);
    if (entryIndex !== undefined) assert.equal(error.entryIndex, entryIndex);
    return true;
  });
}

test("EPD: header, records and payloads", () => {
  const bytes = buildEpd(
    [
      { name: "MAPS\\SC24N.ACT", data: new Uint8Array(768), timestamp: 923846544, crc: 0x1234 },
      { name: "MAPS\\SC24N1.RAW", data: "raw!" },
    ],
    { title: "SC24" },
  );
  const pod = parsePod(bytes);
  assert.equal(pod.format, "epd");
  assert.equal(pod.comment, "SC24");
  assert.equal(pod.directoryOffset, 0x110);
  assert.equal(pod.directoryEnd, 0x110 + 2 * 80);
  assert.equal(pod.checksum, null);
  assert.equal(pod.auditCount, null);
  assert.deepEqual(pod.entries[0], {
    index: 0,
    name: "MAPS\\SC24N.ACT",
    normalizedName: "MAPS/SC24N.ACT",
    title: "SC24N.ACT",
    length: 768,
    offset: 0x110 + 2 * 80,
    recordOffset: 0x110,
    paletteName: null,
    timestamp: 923846544,
    // The last uint32 of an EPD record is unidentified, so it is not reported as a CRC.
    crc: null,
  });
  assert.equal(new TextDecoder().decode(readPodEntry(bytes, pod.entries[1])), "raw!");
});

/*
  The count is at 0x104. The word at 0x90 is uninitialised memory: 54 in most sectional-chart
  archives whatever their real size, and garbage such as 153309048 in the scenery archives.
*/
test("EPD: the count is at 0x104, not the stale word at 0x90", () => {
  const entries = Array.from({ length: 60 }, (_, i) => ({ name: `MAPS\\T${i}.RAW`, data: "x" }));
  const pod = parsePod(buildEpd(entries, { staleCount: 54 }));
  assert.equal(pod.entries.length, 60);
  assert.equal(pod.entries[59].name, "MAPS\\T59.RAW");
  assert.equal(parsePod(buildEpd([{ name: "A.TXT" }], { staleCount: 153309048 })).entries.length, 1);
});

test("EPD: the title is a NUL-terminated name of up to 8 characters", () => {
  assert.equal(parsePod(buildEpd([{ name: "A.TXT" }], { title: "SANFRAN1" })).comment, "SANFRAN1");
  assert.equal(parsePod(buildEpd([{ name: "A.TXT" }], { title: "LA1" })).comment, "LA1");
});

test("EPD: path reconstruction from prefix and remainder", () => {
  const pod = parsePod(buildEpd([
    // A lower-case prefix is not a directory name: the remainder stands alone.
    { name: "", prefix: "maps", remainder: "\\A.ACT" },
    // No backslash on the remainder: the remainder stands alone.
    { name: "", prefix: "MAPS", remainder: "B.RAW" },
    // Remainder alone.
    { name: "C.TXT" },
  ]));
  assert.deepEqual(pod.entries.map((e) => e.name), ["\\A.ACT", "B.RAW", "C.TXT"]);
});

/*
  With nothing in the remainder, the name is the whole 64-byte field read as one string, which
  in practice is whatever sits in the prefix up to its terminator.
*/
test("EPD: an empty remainder falls back to the whole field", () => {
  const bytes = buildEpd([{ name: "", prefix: "", remainder: "" }]);
  bytes.set(latin1("LONG\0"), 0x110);
  assert.equal(parsePod(bytes).entries[0].name, "LONG");
});

test("EPD: heap junk after terminators is ignored", () => {
  const pod = parsePod(buildEpd([{ name: "MAPS\\X.MAP", data: "x" }]));
  assert.equal(pod.entries[0].name, "MAPS\\X.MAP");
});

test("EPD: bad counts, truncation and out-of-bounds payloads", () => {
  const zero = buildEpd([{ name: "A.TXT" }]);
  new DataView(zero.buffer).setUint32(0x104, 0, true);
  assertPodError(() => parsePod(zero), "BAD_ENTRY_COUNT");
  assertPodError(() => parsePod(latin1("dtxe" + "\0".repeat(100))), "TOO_SMALL");
  const two = buildEpd([{ name: "A.TXT" }, { name: "B.TXT" }]);
  assertPodError(() => parsePod(two.subarray(0, 0x110 + 100)), "DIRECTORY_OUT_OF_BOUNDS");
  assertPodError(() => parsePod(buildEpd([{ name: "A.TXT", data: "a", length: 99 }])), "ENTRY_OUT_OF_BOUNDS", 0);
});

test("EPD: directory-only reads settle after two reads", () => {
  const file = buildEpd([{ name: "MAPS\\A.RAW", data: "x".repeat(500) }]);
  let prefix = file.subarray(0, 0);
  let reads = 0;
  for (;;) {
    const need = podDirectoryEnd(prefix, file.length);
    if (need <= prefix.length) break;
    prefix = file.subarray(0, need);
    reads++;
  }
  assert.equal(prefix.length, 0x110 + 80);
  assert.equal(reads, 3); // 0x60 bytes, the count at 0x108, then the table
  assert.deepEqual(parsePod(prefix, { byteLength: file.length }), parsePod(file));
});
