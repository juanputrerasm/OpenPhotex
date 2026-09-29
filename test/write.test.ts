import test from "node:test";
import assert from "node:assert/strict";
import { buildPod1Directory, parsePod, pod1DirectoryEntries, readPodEntry, writePod1, PodWriteError } from "../src/index.ts";
import { buildPod1, latin1 } from "./fixtures/build.ts";

function assertWriteError(fn: () => unknown, code: string, entryIndex?: number) {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof PodWriteError, `expected PodWriteError, got ${error}`);
    assert.equal(error.code, code);
    if (entryIndex !== undefined) assert.equal(error.entryIndex, entryIndex);
    return true;
  });
}

test("writePod1 produces exactly the layout the fixture builder writes", () => {
  const entries = [
    { name: "TRUCK\\BIGFOOT.TRK", data: latin1("manifest") },
    { name: "ART\\GRASS.RAW", data: new Uint8Array(16).fill(7), paletteName: "METALCR2.ACT" },
    { name: "EMPTY.TXT", data: new Uint8Array(0) },
  ];
  const written = writePod1("MTM2 Trucks", entries);
  const expected = buildPod1(
    entries.map((e) => ({ name: e.name, data: e.data, nameFieldTail: e.paletteName ? e.paletteName + "\0" : undefined })),
    { comment: "MTM2 Trucks" },
  );
  assert.deepEqual(written, expected);
});

test("read, rebuild: the same bytes", () => {
  const original = buildPod1([
    { name: "ART\\A.RAW", data: "aaaa", nameFieldTail: "P.ACT\0" },
    { name: "DATA\\B.SIT", data: "bb" },
  ], { comment: "Round trip" });
  const pod = parsePod(original);
  const directory = buildPod1Directory(pod.comment, pod1DirectoryEntries(pod.entries));
  assert.deepEqual(directory, original.subarray(0, pod.directoryEnd));
  const rebuilt = writePod1(pod.comment, pod.entries.map((e) => ({ ...e, data: readPodEntry(original, e) })));
  assert.deepEqual(rebuilt, original);
});

test("entries are stored in the order given, payloads contiguous after the directory", () => {
  const directory = buildPod1Directory("", [{ name: "Z.TXT", length: 3 }, { name: "A.TXT", length: 5 }]);
  const view = new DataView(directory.buffer);
  assert.equal(directory.length, 84 + 2 * 40);
  assert.equal(view.getUint32(84 + 36, true), 164);
  assert.equal(view.getUint32(124 + 36, true), 167);
  assert.equal(new TextDecoder().decode(directory.subarray(124, 129)), "A.TXT");
});

test("the name budget is 31 bytes, including a palette record", () => {
  const thirtyOne = "ART\\" + "X".repeat(23) + ".RAW";
  assert.equal(thirtyOne.length, 31);
  buildPod1Directory("", [{ name: thirtyOne, length: 0 }]);
  assertWriteError(() => buildPod1Directory("", [{ name: thirtyOne + "X", length: 0 }]), "NAME_TOO_LONG", 0);
  // 13 + 1 + 17 + 1 = 32 fits; one more character does not.
  buildPod1Directory("", [{ name: "ART\\ABCDE.RAW", paletteName: "ABCDEFGHIJKLM.ACT", length: 0 }]);
  assertWriteError(() => buildPod1Directory("", [{ name: "ART\\ABCDEF.RAW", paletteName: "ABCDEFGHIJKLM.ACT", length: 0 }]), "NAME_TOO_LONG", 0);
});

test("names the reader would refuse are refused", () => {
  for (const name of ["", " A.TXT", "A.TXT ", "C:\\A.TXT", "A\tB.TXT"]) {
    assertWriteError(() => buildPod1Directory("", [{ name, length: 0 }]), "BAD_NAME", 0);
  }
  assertWriteError(() => buildPod1Directory("", [{ name: "\u4e2d.TXT", length: 0 }]), "BAD_TEXT", 0);
});

test("duplicate paths are refused, ignoring case and separators", () => {
  assertWriteError(
    () => buildPod1Directory("", [{ name: "ART\\A.ACT", length: 0 }, { name: "art/a.act", length: 0 }]),
    "DUPLICATE_NAME",
    1,
  );
});

test("palette records only on .RAW entries, only naming a bare .ACT", () => {
  assertWriteError(() => buildPod1Directory("", [{ name: "A.BIN", paletteName: "P.ACT", length: 0 }]), "BAD_PALETTE", 0);
  assertWriteError(() => buildPod1Directory("", [{ name: "A.RAW", paletteName: "P.PAL", length: 0 }]), "BAD_PALETTE", 0);
  assertWriteError(() => buildPod1Directory("", [{ name: "A.RAW", paletteName: "ART\\P.ACT", length: 0 }]), "BAD_PALETTE", 0);
});

test("comment, count and size limits", () => {
  buildPod1Directory("x".repeat(79), [{ name: "A", length: 0 }]);
  assertWriteError(() => buildPod1Directory("x".repeat(80), [{ name: "A", length: 0 }]), "BAD_TEXT");
  assertWriteError(() => buildPod1Directory("", []), "BAD_ENTRY_COUNT");
  const many = Array.from({ length: 8193 }, (_, i) => ({ name: `F${i}`, length: 0 }));
  assertWriteError(() => buildPod1Directory("", many), "BAD_ENTRY_COUNT");
  assertWriteError(() => buildPod1Directory("", [{ name: "A", length: 0x7fffffff }]), "TOO_LARGE", 0);
});

test("windows-1252 text round-trips through read and write", () => {
  const original = buildPod1([{ name: "ART\\CAF\xc9\x80.RAW", data: "x" }], { comment: "Caf\xe9 \x93quoted\x94" });
  const pod = parsePod(original);
  assert.equal(pod.comment, "Caf\u00e9 \u201cquoted\u201d");
  assert.deepEqual(writePod1(pod.comment, pod.entries.map((e) => ({ ...e, data: readPodEntry(original, e) }))), original);
});
