import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPod2Directory, crc32Mpeg2, crc32Mpeg2Update, CRC32_MPEG2_INIT, encodePod2AuditRecord, parsePod,
  pod2DirectoryEntries, readPod2AuditTrail, readPodEntry, setPod2Checksum, verifyPodChecksums, writePod2,
  POD2_AUDIT_RECORD_SIZE, PodWriteError,
} from "../src/index.ts";
import { latin1 } from "./fixtures/build.ts";

function assertWriteError(fn: () => unknown, code: string, entryIndex?: number) {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof PodWriteError, `expected PodWriteError, got ${error}`);
    assert.equal(error.code, code);
    if (entryIndex !== undefined) assert.equal(error.entryIndex, entryIndex);
    return true;
  });
}

test("the incremental CRC matches the one-shot CRC and the CRC-32/MPEG-2 check value", () => {
  const check = latin1("123456789");
  assert.equal(crc32Mpeg2(check), 0x0376e6e7);
  assert.equal(crc32Mpeg2Update(crc32Mpeg2Update(CRC32_MPEG2_INIT, check.subarray(0, 4)), check.subarray(4)), 0x0376e6e7);
});

test("writePod2 output parses, verifies and carries its audit trail", () => {
  const entries = [
    { name: "ART\\ROCK.RAW", data: new Uint8Array(64).fill(3), timestamp: 1_000_000 },
    { name: "DATA\\TRACK.SIT", data: latin1("sit"), timestamp: 2_000_000 },
    { name: "EMPTY.TXT", data: new Uint8Array(0) },
  ];
  const audit = [
    { user: "juan", timestamp: 3_000_000, action: "add" as const, path: "ART\\ROCK.RAW", newTimestamp: 1_000_000, newSize: 64 },
    { user: "juan", timestamp: 3_000_001, action: "change" as const, path: "DATA\\TRACK.SIT", oldTimestamp: 1, oldSize: 2, newTimestamp: 2_000_000, newSize: 3 },
    { user: "juan", timestamp: 3_000_002, action: "remove" as const, path: "OLD.TXT", oldTimestamp: 5, oldSize: 9 },
  ];
  const bytes = writePod2("Test track", entries, audit);
  const pod = parsePod(bytes);
  assert.equal(pod.format, "pod2");
  assert.equal(pod.comment, "Test track");
  assert.equal(pod.auditCount, 3);
  assert.deepEqual(pod.entries.map((e) => [e.name, e.timestamp]), [["ART\\ROCK.RAW", 1_000_000], ["DATA\\TRACK.SIT", 2_000_000], ["EMPTY.TXT", 0]]);
  pod.entries.forEach((e, i) => assert.deepEqual(readPodEntry(bytes, e), entries[i].data));
  const report = verifyPodChecksums(bytes, pod);
  assert.ok(report.archive.ok);
  assert.deepEqual(report.mismatches, []);
  const trail = readPod2AuditTrail(bytes, pod);
  assert.deepEqual(trail.map((r) => [r.user, r.action, r.path, r.oldSize, r.newSize]), [
    ["juan", "add", "ART\\ROCK.RAW", 0, 64],
    ["juan", "change", "DATA\\TRACK.SIT", 2, 3],
    ["juan", "remove", "OLD.TXT", 9, 0],
  ]);
});

test("read, rebuild: the same bytes, raw comment and raw audit trail kept", () => {
  const comment = new Uint8Array(80);
  comment.set(latin1("Spaced "), 0);
  const original = writePod2(comment, [
    { name: "A.TXT", data: latin1("aa"), timestamp: 7 },
    { name: "B\\C.TXT", data: latin1("bbb"), timestamp: 8 },
  ], [{ user: "x", timestamp: 1, action: 0, path: "A.TXT", newSize: 2 }]);
  const pod = parsePod(original);
  assert.equal(pod.comment, "Spaced");
  const trail = original.subarray(original.length - pod.auditCount! * POD2_AUDIT_RECORD_SIZE);
  const rebuilt = writePod2(original.subarray(8, 88), pod.entries.map((e) => ({ name: e.name, data: readPodEntry(original, e), timestamp: e.timestamp! })), trail);
  assert.deepEqual(rebuilt, original);

  const directory = buildPod2Directory(original.subarray(8, 88), pod2DirectoryEntries(pod.entries), pod.auditCount!);
  const head = original.slice(0, pod.directoryEnd);
  head.fill(0, 4, 8);
  assert.deepEqual(directory, head);
});

test("setPod2Checksum stores the CRC of 0x08..EOF at 0x04", () => {
  const bytes = writePod2("x", [{ name: "A", data: latin1("a") }]);
  const copy = bytes.slice();
  copy.fill(0, 4, 8);
  assert.equal(setPod2Checksum(copy), new DataView(bytes.buffer).getUint32(4, true));
  assert.deepEqual(copy, bytes);
});

test("an audit record is 312 bytes and refuses fields that do not fit", () => {
  assert.equal(encodePod2AuditRecord({ user: "u", timestamp: 0, action: "add", path: "P" }).length, 312);
  assertWriteError(() => encodePod2AuditRecord({ user: "u".repeat(32), timestamp: 0, action: "add", path: "P" }), "BAD_TEXT");
  assertWriteError(() => encodePod2AuditRecord({ user: "u", timestamp: 0, action: "add", path: "P".repeat(256) }), "BAD_TEXT");
});

test("POD2 names have no 31-byte limit but keep the other rules", () => {
  const long = "ART\\" + "X".repeat(60) + ".RAW";
  assert.equal(parsePod(writePod2("", [{ name: long, data: latin1("1") }])).entries[0].name, long);
  assertWriteError(() => writePod2("", [{ name: "A".repeat(256), data: latin1("1") }]), "NAME_TOO_LONG", 0);
  assertWriteError(() => writePod2("", [{ name: "C:\\A", data: latin1("1") }]), "BAD_NAME", 0);
  assertWriteError(() => writePod2("", [{ name: "A\\B", data: latin1("1") }, { name: "a/b", data: latin1("2") }]), "DUPLICATE_NAME", 1);
  assertWriteError(() => writePod2("", []), "BAD_ENTRY_COUNT");
  assertWriteError(() => writePod2("c".repeat(80), [{ name: "A", data: latin1("1") }]), "BAD_TEXT");
});

test("readPod2AuditRecords decodes a trail sliced out of the archive", async () => {
  const { readPod2AuditRecords } = await import("../src/index.ts");
  const bytes = writePod2("t", [{ name: "A", data: latin1("abc") }], [
    { user: "u", timestamp: 9, action: "add", path: "A", newSize: 3 },
  ]);
  const pod = parsePod(bytes);
  const start = bytes.length - POD2_AUDIT_RECORD_SIZE;
  assert.deepEqual(readPod2AuditRecords(bytes.subarray(start), start), readPod2AuditTrail(bytes, pod));
  assert.throws(() => readPod2AuditRecords(new Uint8Array(10)), RangeError);
});
