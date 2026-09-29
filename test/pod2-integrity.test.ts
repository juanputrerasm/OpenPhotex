import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32Mpeg2, parsePod, readPod2AuditTrail, verifyPodChecksums, PodFormatError } from "../src/index.ts";
import { buildPod1, buildPod2, latin1 } from "./fixtures/build.ts";

test("crc32Mpeg2 matches the published CRC-32/MPEG-2 check value", () => {
  assert.equal(crc32Mpeg2(latin1("123456789")), 0x0376e6e7);
  assert.equal(crc32Mpeg2(new Uint8Array(0)), 0xffffffff);
});

interface Audit { user: string; timestamp: number; action: number; path: string; oldTime: number; oldSize: number; newTime: number; newSize: number }

function auditRecord(a: Audit): Uint8Array {
  const out = new Uint8Array(312);
  const view = new DataView(out.buffer);
  out.set(latin1(a.user), 0);
  view.setUint32(32, a.timestamp, true);
  view.setUint32(36, a.action, true);
  out.set(latin1(a.path), 40);
  view.setUint32(296, a.oldTime, true);
  view.setUint32(300, a.oldSize, true);
  view.setUint32(304, a.newTime, true);
  view.setUint32(308, a.newSize, true);
  return out;
}

/** A POD2 with real CRCs and an audit trail appended after the payloads, as the stock archives have. */
function sealedPod2(audits: Audit[]): Uint8Array {
  const payloads = [latin1("level data"), latin1("palette")];
  const base = buildPod2(
    [{ name: "levels\\a.lvl", data: payloads[0], crc: crc32Mpeg2(payloads[0]) }, { name: "art\\a.act", data: payloads[1], crc: crc32Mpeg2(payloads[1]) }],
    { auditCount: audits.length },
  );
  const out = new Uint8Array(base.length + audits.length * 312);
  out.set(base, 0);
  audits.forEach((a, i) => out.set(auditRecord(a), base.length + i * 312));
  new DataView(out.buffer).setUint32(4, crc32Mpeg2(out.subarray(8)), true);
  return out;
}

const AUDITS: Audit[] = [
  { user: "david", timestamp: 967748329, action: 0, path: "LEVELS\\A.LVL", oldTime: 0, oldSize: 0, newTime: 956962610, newSize: 10 },
  { user: "david", timestamp: 967748400, action: 2, path: "ART\\A.ACT", oldTime: 956962610, oldSize: 768, newTime: 967748400, newSize: 7 },
  { user: "jim", timestamp: 967748500, action: 1, path: "ART\\OLD.RAW", oldTime: 956962610, oldSize: 4096, newTime: 0, newSize: 0 },
];

test("verifyPodChecksums: a sealed archive checks out; a flipped payload byte is found", () => {
  const bytes = sealedPod2(AUDITS);
  const pod = parsePod(bytes);
  const report = verifyPodChecksums(bytes, pod);
  assert.equal(report.archive.ok, true);
  assert.equal(report.entriesChecked, 2);
  assert.deepEqual(report.mismatches, []);

  const damaged = bytes.slice();
  damaged[pod.entries[1].offset] ^= 0xff;
  const bad = verifyPodChecksums(damaged, parsePod(damaged));
  assert.equal(bad.archive.ok, false);
  assert.deepEqual(bad.mismatches.map((m) => m.index), [1]);
});

test("readPod2AuditTrail decodes the records between the payloads and EOF", () => {
  const bytes = sealedPod2(AUDITS);
  const trail = readPod2AuditTrail(bytes, parsePod(bytes));
  assert.equal(trail.length, 3);
  assert.deepEqual(trail[0], {
    index: 0,
    offset: bytes.length - 3 * 312,
    user: "david",
    timestamp: 967748329,
    actionCode: 0,
    action: "add",
    path: "LEVELS\\A.LVL",
    oldTimestamp: 0,
    oldSize: 0,
    newTimestamp: 956962610,
    newSize: 10,
  });
  assert.deepEqual(trail.map((r) => r.action), ["add", "change", "remove"]);
});

test("an unseen action code is kept, with no name", () => {
  const bytes = sealedPod2([{ ...AUDITS[0], action: 7 }]);
  const [record] = readPod2AuditTrail(bytes, parsePod(bytes));
  assert.equal(record.actionCode, 7);
  assert.equal(record.action, null);
});

test("an audit count that does not fit after the payloads is an error", () => {
  const bytes = sealedPod2([]);
  new DataView(bytes.buffer).setUint32(0x5c, 5, true);
  assert.throws(() => readPod2AuditTrail(bytes, parsePod(bytes)), (e: unknown) => e instanceof PodFormatError && e.code === "ENTRY_OUT_OF_BOUNDS");
});

test("CRCs and audit trails are POD2-only and need the whole file", () => {
  const pod1 = buildPod1([{ name: "A.TXT", data: "a" }]);
  assert.throws(() => verifyPodChecksums(pod1, parsePod(pod1)), TypeError);
  assert.throws(() => readPod2AuditTrail(pod1, parsePod(pod1)), TypeError);
  const pod2 = sealedPod2([]);
  const prefix = pod2.subarray(0, parsePod(pod2).directoryEnd);
  assert.throws(() => verifyPodChecksums(prefix, parsePod(prefix, { byteLength: pod2.length })), RangeError);
});

test("CLI: pod verify exit codes and pod audit JSON", () => {
  const CLI = new URL("../dist/cli/main.js", import.meta.url).pathname;
  const dir = mkdtempSync(join(tmpdir(), "openphotex-pod2-"));
  const good = join(dir, "GOOD.POD");
  const bad = join(dir, "BAD.POD");
  const bytes = sealedPod2(AUDITS);
  writeFileSync(good, bytes);
  const damaged = bytes.slice();
  damaged[parsePod(bytes).entries[0].offset] ^= 1;
  writeFileSync(bad, damaged);
  const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });

  const ok = run("pod", "verify", good, "--json");
  assert.equal(ok.status, 0);
  assert.equal(JSON.parse(ok.stdout).ok, true);

  const failed = run("pod", "verify", bad, "--json");
  assert.equal(failed.status, 5);
  const doc = JSON.parse(failed.stdout);
  assert.equal(doc.ok, false);
  assert.deepEqual(doc.mismatches.map((m: { index: number }) => m.index), [0]);
  assert.equal(JSON.parse(failed.stderr).error.code, "CHECKSUM_MISMATCH");

  const audit = JSON.parse(run("pod", "audit", good, "--json", "--filter", "*.act").stdout);
  assert.deepEqual(Object.keys(audit), ["schemaVersion", "command", "file", "filter", "auditCount", "records"]);
  assert.equal(audit.auditCount, 3);
  assert.deepEqual(audit.records.map((r: { path: string }) => r.path), ["ART\\A.ACT"]);
});
