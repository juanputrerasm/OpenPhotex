/*
  `openphotex read`: format detection, the JSON document, --full, --as and the errors. Runs the
  built binary; `npm test` builds first.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MRGL, writeBin } from "../src/index.ts";
import { buildPod1 } from "./fixtures/build.ts";

const CLI = new URL("../dist/cli/main.js", import.meta.url).pathname;
const dir = realpathSync(mkdtempSync(join(tmpdir(), "openphotex-read-")));

const bin = writeBin({ vertices: [0, 0, 0, 256, 0, 0, 256, 0, 256], groups: [{ texture: "GRASS.RAW", opcode: MRGL.ZFACET, faces: [{ vertexIndices: [0, 1, 2] }] }] }).bytes;
const trk = ["CRaceTrack.trackCount", "0", "CRaceTrack.trackBackground", "test.raw"].join("\r\n");
const lvl = ["0", "null.txt", "t.raw", "t.clr", "t.act", "t.tex", "x", "t.pup", "t.ani", "t.tdf", "sky.raw", "sky.act", "t.def", "t.nav", "m", "x", "t.lte", "1,2,3", "4", "5,6,7", "8", "9"].join("\r\n");
const podPath = join(dir, "LEVEL.POD");
writeFileSync(podPath, buildPod1([
  { name: "MODELS\\CUBE.BIN", data: bin },
  { name: "DATA\\ROAD.TRK", data: trk },
  { name: "LEVELS\\T.LVL", data: lvl },
  { name: "DATA\\T.TEX", data: "2\r\nA.RAW\r\nB.RAW\r\n" },
  { name: "SOUND\\X.WAV", data: "RIFF" },
]));
const loose = join(dir, "LOOSE.LVL");
writeFileSync(loose, lvl);

function run(...args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test("read --json: the reader's result, typed arrays summarised", () => {
  const r = run("read", podPath, "CUBE.BIN", "--json");
  assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.schemaVersion, 1);
  assert.equal(doc.command, "read");
  assert.equal(doc.entry, "MODELS\\CUBE.BIN");
  assert.equal(doc.format, "bin");
  assert.equal(doc.reader, "parseBin");
  assert.deepEqual(doc.data.vertices, { typedArray: "Int32Array", length: 9 });
  assert.equal(doc.data.faces[0].textureName, "GRASS.RAW");
  const full = JSON.parse(run("read", podPath, "CUBE.BIN", "--json", "--full").stdout);
  assert.deepEqual(full.data.vertices, [0, 0, 0, 256, 0, 0, 256, 0, 256]);
});

test("read detects by extension, content and archive", () => {
  const format = (entry: string) => JSON.parse(run("read", podPath, entry, "--json").stdout).format;
  assert.equal(format("ROAD.TRK"), "cpr-trk");
  // A POD1 with no .SIT is not an MTM archive, so its .LVL is the Terminal Velocity family's.
  assert.equal(format("T.LVL"), "tv-lvl");
  assert.equal(format("T.TEX"), "tex");
  assert.deepEqual(JSON.parse(run("read", podPath, "T.TEX", "--json").stdout).data, ["A.RAW", "B.RAW"]);
});

test("read: a loose .LVL needs --as; an unknown format says so", () => {
  const none = run("read", loose, "--json");
  assert.equal(none.status, 3);
  assert.equal(JSON.parse(none.stderr).error.code, "UNSUPPORTED_FORMAT");
  const asTv = run("read", loose, "--as", "tv-lvl", "--json");
  assert.equal(asTv.status, 0);
  assert.equal(JSON.parse(asTv.stdout).data.skyActName, "SKY.ACT");
  assert.equal(run("read", podPath, "X.WAV").status, 3);
  assert.equal(run("read", loose, "--as", "nonsense").status, 1);
  assert.equal(run("pod", "list", podPath, "--full").status, 1);
});

test("read without --json prints a short summary", () => {
  const r = run("read", podPath, "T.LVL");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^LEVELS\\T\.LVL: tv-lvl \(parseTvLvl\)\n/);
  assert.match(r.stdout, /sunVector: +3 items/);
});
