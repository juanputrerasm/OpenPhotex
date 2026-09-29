/*
  The CLI as an external interface: run the built binary and check stdout, stderr and exit
  codes. `npm test` builds first.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPod1, buildPod2 } from "./fixtures/build.ts";

const CLI = new URL("../dist/cli/main.js", import.meta.url).pathname;
// realpath: on macOS the temp dir is reached through the /var -> /private/var symlink.
const dir = realpathSync(mkdtempSync(join(tmpdir(), "openphotex-cli-")));

const pod1Path = join(dir, "TRUCKS.POD");
writeFileSync(pod1Path, buildPod1(
  [
    { name: "TRUCK\\BIGFOOT.TRK", data: "bigfoot manifest" },
    { name: "ART\\BIGFOOT.RAW", data: new Uint8Array([0, 1, 2, 255]), nameFieldTail: "BIGFOOT.ACT\0" },
    { name: "ART\\BIGFOOT.ACT", data: new Uint8Array(768) },
    { name: "MODELS\\SHARED.BIN", data: "one" },
    { name: "EXTRA\\SHARED.BIN", data: "two" },
  ],
  { comment: "Test Trucks" },
));
const pod2Path = join(dir, "TRACK.POD");
writeFileSync(pod2Path, buildPod2([{ name: "levels\\peak.lvl", data: "lvl", timestamp: 1, crc: 2 }], { comment: "Peak", checksum: 3, auditCount: 4 }));
const junkPath = join(dir, "JUNK.POD");
writeFileSync(junkPath, new Uint8Array(200).fill(0x41));

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd: dir });
  return { status: result.status, stdout: result.stdout, text: result.stdout.toString("utf8"), stderr: result.stderr.toString("utf8") };
}

test("pod info --json: full, fixed document", () => {
  const r = run("pod", "info", pod2Path, "--json");
  assert.equal(r.status, 0);
  assert.equal(r.stderr, "");
  assert.deepEqual(JSON.parse(r.text), {
    schemaVersion: 1,
    command: "pod info",
    file: pod2Path,
    archive: {
      format: "pod2",
      comment: "Peak",
      byteLength: readFileSync(pod2Path).length,
      entryCount: 1,
      directoryOffset: 96,
      directoryEnd: 96 + 20 + 16,
      checksum: 3,
      auditCount: 4,
    },
  });
});

test("pod list --json: every entry key present, in a fixed order", () => {
  const r = run("pod", "list", pod1Path, "--json");
  assert.equal(r.status, 0);
  const doc = JSON.parse(r.text);
  assert.deepEqual(Object.keys(doc), ["schemaVersion", "command", "file", "filter", "archive", "entries"]);
  assert.equal(doc.entries.length, 5);
  assert.deepEqual(Object.keys(doc.entries[0]), [
    "index", "name", "normalizedName", "title", "offset", "length", "recordOffset", "paletteName", "timestamp", "crc",
  ]);
  assert.equal(doc.entries[1].paletteName, "BIGFOOT.ACT");
  assert.equal(doc.entries[0].name, "TRUCK\\BIGFOOT.TRK");
});

test("pod list --filter and --raw", () => {
  const byName = JSON.parse(run("pod", "list", pod1Path, "--json", "--filter", "bigfoot.*").text);
  assert.deepEqual(byName.entries.map((e: { index: number }) => e.index), [0, 1, 2]);
  assert.equal(byName.filter, "bigfoot.*");
  const byPath = JSON.parse(run("pod", "list", pod1Path, "--json", "--filter", "art/*").text);
  assert.deepEqual(byPath.entries.map((e: { index: number }) => e.index), [1, 2]);
  const raw = JSON.parse(run("pod", "list", pod1Path, "--json", "--raw").text);
  assert.equal(raw.entries[0].record.length, 80);
  assert.ok(raw.entries[0].record.startsWith(Buffer.from("TRUCK\\BIGFOOT.TRK").toString("hex")));
});

test("pod list: readable table", () => {
  const r = run("pod", "list", pod1Path);
  assert.equal(r.status, 0);
  assert.match(r.text, /TRUCK\\BIGFOOT\.TRK/);
  assert.match(r.text, /\[palette BIGFOOT\.ACT\]/);
});

test("pod extract: by path, file name and #index, byte-exact", () => {
  const out = join(dir, "bigfoot.trk");
  let r = run("pod", "extract", pod1Path, "truck/bigfoot.trk", "-o", out);
  assert.equal(r.status, 0);
  assert.equal(readFileSync(out, "utf8"), "bigfoot manifest");

  r = run("pod", "extract", pod1Path, "BIGFOOT.RAW", "--stdout");
  assert.equal(r.status, 0);
  assert.deepEqual([...r.stdout], [0, 1, 2, 255]);

  r = run("pod", "extract", pod1Path, "#3", "--stdout");
  assert.equal(r.text, "one");
});

test("pod extract: default output is the file name in the working directory; no silent overwrite", () => {
  let r = run("pod", "extract", pod1Path, "ART\\BIGFOOT.ACT", "--json");
  assert.equal(r.status, 0);
  const doc = JSON.parse(r.text);
  assert.equal(doc.command, "pod extract");
  assert.equal(doc.extracted[0].output, join(dir, "BIGFOOT.ACT"));
  assert.equal(readFileSync(join(dir, "BIGFOOT.ACT")).length, 768);

  r = run("pod", "extract", pod1Path, "ART\\BIGFOOT.ACT", "--json");
  assert.equal(r.status, 2);
  assert.equal(JSON.parse(r.stderr).error.code, "OUTPUT_EXISTS");
  assert.equal(run("pod", "extract", pod1Path, "ART\\BIGFOOT.ACT", "--force").status, 0);
});

test("pod extract --all keeps the directory structure", () => {
  const out = join(dir, "all");
  const r = run("pod", "extract", pod1Path, "--all", "-o", out, "--json");
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.text).extracted.length, 5);
  assert.equal(readFileSync(join(out, "MODELS", "SHARED.BIN"), "utf8"), "one");
  assert.equal(readFileSync(join(out, "EXTRA", "SHARED.BIN"), "utf8"), "two");

  const filtered = join(dir, "filtered");
  run("pod", "extract", pod1Path, "--all", "-o", filtered, "--filter", "*.act");
  assert.ok(existsSync(join(filtered, "ART", "BIGFOOT.ACT")));
  assert.ok(!existsSync(join(filtered, "TRUCK")));
});

test("errors: codes on stderr as JSON, stdout empty, distinct exit codes", () => {
  const cases: [string[], number, string][] = [
    [["pod", "extract", pod1Path, "NOPE.BIN", "--json"], 4, "ENTRY_NOT_FOUND"],
    [["pod", "extract", pod1Path, "SHARED.BIN", "--json"], 4, "AMBIGUOUS_ENTRY"],
    [["pod", "extract", pod1Path, "#99", "--json"], 4, "ENTRY_NOT_FOUND"],
    [["pod", "info", join(dir, "missing.pod"), "--json"], 2, "FILE_NOT_FOUND"],
    [["pod", "info", junkPath, "--json"], 3, "BAD_ENTRY_COUNT"],
    [["pod", "frobnicate", pod1Path, "--json"], 1, "USAGE"],
    [["pod", "list", pod1Path, "--nope", "--json"], 1, "USAGE"],
    [["pod", "extract", pod1Path, "--json"], 1, "USAGE"],
    [["mesh", "info", pod1Path, "--json"], 1, "USAGE"],
  ];
  for (const [args, status, code] of cases) {
    const r = run(...args);
    assert.equal(r.status, status, args.join(" "));
    assert.equal(r.text, "", `stdout must be empty on error: ${args.join(" ")}`);
    const error = JSON.parse(r.stderr);
    assert.equal(error.schemaVersion, 1);
    assert.equal(error.error.code, code, args.join(" "));
    assert.equal(typeof error.error.message, "string");
  }
  const ambiguous = JSON.parse(run("pod", "extract", pod1Path, "SHARED.BIN", "--json").stderr);
  assert.deepEqual(ambiguous.error.candidates, ["MODELS\\SHARED.BIN", "EXTRA\\SHARED.BIN"]);
});

test("errors without --json are one readable line on stderr", () => {
  const r = run("pod", "info", junkPath);
  assert.equal(r.status, 3);
  assert.equal(r.text, "");
  assert.match(r.stderr, /^openphotex: Suspicious POD item count/);
});

test("--version and --help", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(run("--version").text.trim(), pkg.version);
  const help = run("--help");
  assert.equal(help.status, 0);
  assert.match(help.text, /openphotex pod list/);
  assert.equal(run().status, 1);
});
