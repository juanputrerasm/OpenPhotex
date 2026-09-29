import test from "node:test";
import assert from "node:assert/strict";
import { parsePod, readPodEntry, PodFormatError } from "../src/index.ts";
import { buildPod1, latin1 } from "./fixtures/build.ts";

function assertPodError(fn: () => unknown, code: string, entryIndex?: number) {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof PodFormatError, `expected PodFormatError, got ${error}`);
    assert.equal(error.code, code);
    if (entryIndex !== undefined) assert.equal(error.entryIndex, entryIndex);
    return true;
  });
}

test("POD1: header, directory and payloads", () => {
  const bytes = buildPod1(
    [
      { name: "TRUCK\\BIGFOOT.TRK", data: "truck manifest" },
      { name: "ART\\GRASS.RAW", data: new Uint8Array(16).fill(7) },
      { name: "EMPTY.TXT", data: "" },
    ],
    { comment: "MTM2 Trucks" },
  );
  const pod = parsePod(bytes);
  assert.equal(pod.format, "pod1");
  assert.equal(pod.comment, "MTM2 Trucks");
  assert.equal(pod.byteLength, bytes.length);
  assert.equal(pod.directoryOffset, 84);
  assert.equal(pod.directoryEnd, 84 + 3 * 40);
  assert.equal(pod.checksum, null);
  assert.equal(pod.auditCount, null);
  assert.equal(pod.entries.length, 3);

  const [trk, raw, empty] = pod.entries;
  assert.deepEqual(trk, {
    index: 0,
    name: "TRUCK\\BIGFOOT.TRK",
    normalizedName: "TRUCK/BIGFOOT.TRK",
    title: "BIGFOOT.TRK",
    length: 14,
    offset: 84 + 3 * 40,
    recordOffset: 84,
    paletteName: null,
    timestamp: null,
    crc: null,
  });
  assert.equal(raw.offset, trk.offset + 14);
  assert.equal(raw.recordOffset, 124);
  assert.equal(new TextDecoder().decode(readPodEntry(bytes, trk)), "truck manifest");
  assert.deepEqual(readPodEntry(bytes, raw), new Uint8Array(16).fill(7));
  assert.equal(empty.length, 0);
  assert.equal(readPodEntry(bytes, empty).length, 0);
});

test("POD1: accepts an ArrayBuffer and a Uint8Array view with a byteOffset", () => {
  const bytes = buildPod1([{ name: "A.TXT", data: "abc" }]);
  assert.equal(parsePod(bytes.buffer as ArrayBuffer).entries[0].name, "A.TXT");

  const padded = new Uint8Array(bytes.length + 10);
  padded.set(bytes, 10);
  const view = padded.subarray(10);
  const pod = parsePod(view);
  assert.equal(new TextDecoder().decode(readPodEntry(view, pod.entries[0])), "abc");
});

test("POD1: a .RAW name field's second string names its .ACT palette", () => {
  const pod = parsePod(buildPod1([
    { name: "ART\\ROAD.RAW", nameFieldTail: "METALCR2.ACT\0" },
    { name: "ART\\DIRT.RAW", nameFieldTail: " vga.act \0" },
  ]));
  assert.equal(pod.entries[0].paletteName, "METALCR2.ACT");
  // Trimmed, and the original case kept.
  assert.equal(pod.entries[1].paletteName, "vga.act");
});

test("POD1: packer junk after the path is not taken for a palette", () => {
  const pod = parsePod(buildPod1([
    // Not a .RAW: the second string is ignored whatever it says.
    { name: "ART\\ROAD.BIN", nameFieldTail: "METALCR2.ACT\0" },
    // Does not end in .ACT.
    { name: "ART\\A.RAW", nameFieldTail: "leftover\0" },
    // Unterminated: runs to the end of the 32-byte field.
    { name: "ART\\B.RAW", rawNameField: latin1("ART\\B.RAW\0" + "X".repeat(18) + ".ACT") },
  ]));
  for (const entry of pod.entries) assert.equal(entry.paletteName, null);
});

test("POD1: names are trimmed of spaces and control bytes; the comment is trimmed", () => {
  const pod = parsePod(buildPod1([{ name: "  DATA\\TRACK.SIT \t" }], { comment: "  Summit Rumble  " }));
  assert.equal(pod.entries[0].name, "DATA\\TRACK.SIT");
  assert.equal(pod.comment, "Summit Rumble");
});

test("POD1: 8-bit names decode as windows-1252, as JSTrackViewer's TextDecoder('latin1') did", () => {
  const pod = parsePod(buildPod1([{ name: "ART\\CAF\xc9\x80.RAW" }]));
  assert.equal(pod.entries[0].name, "ART\\CAF\u00c9\u20ac.RAW");
  assert.equal(pod.entries[0].title, "CAF\u00c9\u20ac.RAW");
});

test("POD1: a name that fills all 32 bytes without a NUL is rejected", () => {
  assertPodError(() => parsePod(buildPod1([{ name: "", rawNameField: latin1("A".repeat(32)) }])), "BAD_ENTRY_NAME", 0);
});

test("POD1: empty and implausible names are rejected", () => {
  assertPodError(() => parsePod(buildPod1([{ name: "OK.TXT" }, { name: "   " }])), "BAD_ENTRY_NAME", 1);
  assertPodError(() => parsePod(buildPod1([{ name: "C:\\GAME\\X.TXT" }])), "BAD_ENTRY_NAME", 0);
  assertPodError(() => parsePod(buildPod1([{ name: "BAD\x07NAME.TXT" }])), "BAD_ENTRY_NAME", 0);
});

test("POD1: payloads outside the file are rejected", () => {
  assertPodError(() => parsePod(buildPod1([{ name: "A.TXT", data: "x", length: 1000 }])), "ENTRY_OUT_OF_BOUNDS", 0);
  assertPodError(() => parsePod(buildPod1([{ name: "A.TXT", offset: 0xffffff }])), "ENTRY_OUT_OF_BOUNDS", 0);
  // A zero-length entry pointing exactly at EOF is fine.
  const bytes = buildPod1([{ name: "A.TXT", data: "" }]);
  assert.equal(parsePod(bytes).entries[0].offset, bytes.length);
});

test("POD1: entry counts outside 1..8192 are rejected", () => {
  assertPodError(() => parsePod(buildPod1([], { count: 0 })), "BAD_ENTRY_COUNT");
  assertPodError(() => parsePod(buildPod1([], { count: -1 })), "BAD_ENTRY_COUNT");
  assertPodError(() => parsePod(buildPod1([], { count: 8193 })), "BAD_ENTRY_COUNT");
});

test("POD1: truncated input", () => {
  assertPodError(() => parsePod(new Uint8Array(0)), "TOO_SMALL");
  assertPodError(() => parsePod(new Uint8Array(83)), "TOO_SMALL");
  const bytes = buildPod1([{ name: "A.TXT" }, { name: "B.TXT" }]);
  assertPodError(() => parsePod(bytes.subarray(0, 84 + 40 + 20)), "DIRECTORY_OUT_OF_BOUNDS");
});

/*
  A directory written with 64-byte name fields and 72-byte records is not a POD format. The
  parser once retried such files as "Extended POD1"; it must now reject them rather than read
  the 32-byte layout's second record out of the middle of the first 64-byte name.
*/
test("POD1: a 64-byte-name directory is rejected, not reinterpreted", () => {
  const count = 2;
  const out = new Uint8Array(84 + count * 72 + 8);
  const view = new DataView(out.buffer);
  view.setInt32(0, count, true);
  ["DATA\\FIRST.SIT", "DATA\\SECOND.LVL"].forEach((name, i) => {
    const record = 84 + i * 72;
    out.set(latin1(name), record);
    view.setUint32(record + 64, 4, true);
    view.setUint32(record + 68, 84 + count * 72 + i * 4, true);
  });
  assertPodError(() => parsePod(out), "BAD_ENTRY_NAME", 1);
});

test("readPodEntry returns a copy and range-checks", () => {
  const bytes = buildPod1([{ name: "A.TXT", data: "abcdef" }]);
  const entry = parsePod(bytes).entries[0];
  const copy = readPodEntry(bytes, entry);
  copy[0] = 0;
  assert.equal(bytes[entry.offset], "a".charCodeAt(0));
  assert.notEqual(copy.buffer, bytes.buffer);
  // A shortened range reads the start of an entry.
  assert.equal(new TextDecoder().decode(readPodEntry(bytes, { offset: entry.offset, length: 3 })), "abc");
  assertPodError(() => readPodEntry(bytes, { offset: entry.offset, length: 7 }), "ENTRY_OUT_OF_BOUNDS");
  assertPodError(() => readPodEntry(bytes, { offset: -1, length: 1 }), "ENTRY_OUT_OF_BOUNDS");
});

test("parsed archives are plain, structured-cloneable data", () => {
  const pod = parsePod(buildPod1([{ name: "ART\\A.RAW", nameFieldTail: "P.ACT\0", data: "xyz" }]));
  assert.deepEqual(structuredClone(pod), pod);
  assert.deepEqual(JSON.parse(JSON.stringify(pod)), pod);
});
