/*
  `openphotex texture`: palette choice, PNG output checked pixel by pixel after inflating it.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { buildPod1, buildPod2 } from "./fixtures/build.ts";

const CLI = new URL("../dist/cli/main.js", import.meta.url).pathname;
const dir = realpathSync(mkdtempSync(join(tmpdir(), "openphotex-tex-")));
const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: "utf8" });

function act(fill: (i: number) => [number, number, number]): Uint8Array {
  const out = new Uint8Array(768);
  for (let i = 0; i < 256; i++) out.set(fill(i), i * 3);
  return out;
}
const RED = act((i) => [i === 1 ? 200 : 0, 0, 0]);
const BLUE = act((i) => [0, 0, i === 1 ? 180 : 0]);
const raw = new Uint8Array(32 * 32).fill(1);
raw[0] = 0;

/** RGBA pixels of a PNG written by the CLI (8-bit RGBA, filter 0 on every row). */
function readPng(path: string): { width: number; height: number; rgba: Uint8Array } {
  const png = readFileSync(path);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  const idatLength = png.readUInt32BE(33);
  assert.equal(png.toString("latin1", 37, 41), "IDAT");
  const lines = inflateSync(png.subarray(41, 41 + idatLength));
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) rgba.set(lines.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4);
  return { width, height, rgba };
}

const pod = join(dir, "TEX.POD");
writeFileSync(pod, buildPod1([
  { name: "ART\\ROAD.RAW", data: raw },
  { name: "ART\\ROAD.ACT", data: RED },
  { name: "ART\\SIGN.RAW", data: raw, nameFieldTail: "BLUE.ACT\0" },
  { name: "ART\\BLUE.ACT", data: BLUE },
  { name: "ART\\LOST.RAW", data: raw, nameFieldTail: "ELSEWHERE.ACT\0" },
  { name: "ART\\BAD.RAW", data: new Uint8Array(100) },
]));

test("same-stem .ACT first, reported in the JSON", () => {
  const r = run("texture", pod, "ART/ROAD.RAW", "-o", "road.png", "--json");
  assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.deepEqual(doc.palette, { source: "same-stem", name: "ART\\ROAD.ACT", depth: 8 });
  assert.equal(doc.family, "classic");
  const png = readPng(join(dir, "road.png"));
  assert.equal(png.width, 32);
  assert.deepEqual([...png.rgba.subarray(0, 8)], [0, 0, 0, 255, 200, 0, 0, 255]);
});

test("the POD1 palette record when there is no same-stem .ACT", () => {
  const doc = JSON.parse(run("texture", pod, "SIGN.RAW", "-o", "sign.png", "--json").stdout);
  assert.deepEqual(doc.palette, { source: "palette-record", name: "ART\\BLUE.ACT", depth: 8 });
  assert.deepEqual([...readPng(join(dir, "sign.png")).rgba.subarray(4, 8)], [0, 0, 180, 255]);
});

test("an explicit --palette entry or --act file wins", () => {
  const doc = JSON.parse(run("texture", pod, "ROAD.RAW", "--palette", "BLUE.ACT", "-o", "p.png", "--json").stdout);
  assert.equal(doc.palette.source, "palette-entry");
  writeFileSync(join(dir, "loose.act"), BLUE);
  const viaFile = JSON.parse(run("texture", pod, "ROAD.RAW", "--act", "loose.act", "-o", "a.png", "--json").stdout);
  assert.equal(viaFile.palette.source, "act-file");
});

test("no palette to be found is PALETTE_REQUIRED (exit 4), naming the record", () => {
  const r = run("texture", pod, "LOST.RAW", "-o", "lost.png", "--json");
  assert.equal(r.status, 4);
  const error = JSON.parse(r.stderr).error;
  assert.equal(error.code, "PALETTE_REQUIRED");
  assert.equal(error.paletteName, "ELSEWHERE.ACT");
});

test("a loose .RAW with --act, and --cutout", () => {
  writeFileSync(join(dir, "loose.raw"), raw);
  writeFileSync(join(dir, "red.act"), RED);
  const r = run("texture", "loose.raw", "--act", "red.act", "--cutout", "-o", "cut.png", "--json");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).hasAlpha, true);
  // Index 0 is palette-black, so the cutout makes it transparent.
  assert.deepEqual([...readPng(join(dir, "cut.png")).rgba.subarray(0, 8)], [0, 0, 0, 0, 200, 0, 0, 255]);
});

test("Evo: family from the POD2 container, and an .OPA plane", () => {
  const evo = join(dir, "EVO.POD");
  const small = new Uint8Array(8 * 8).fill(1);
  const opa = new Uint8Array(64).map((_, i) => i * 4);
  writeFileSync(evo, buildPod2([
    { name: "art\\pine.raw", data: small },
    { name: "art\\pine.act", data: RED },
    { name: "art\\pine.opa", data: opa },
  ]));
  const r = run("texture", evo, "art/pine.raw", "--opa", "art/pine.opa", "-o", "pine.png", "--json");
  assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.family, "evo");
  assert.equal(doc.hasAlpha, true);
  const png = readPng(join(dir, "pine.png"));
  assert.equal(png.width, 8);
  assert.equal(png.rgba[4 * 10 + 3], 40);
});

test("errors: not a texture size, missing -o, POD without an entry", () => {
  assert.equal(JSON.parse(run("texture", pod, "BAD.RAW", "-o", "x.png", "--json").stderr).error.code, "UNSUPPORTED_FORMAT");
  assert.equal(run("texture", pod, "ROAD.RAW", "--json").status, 1);
  assert.equal(run("texture", pod, "-o", "x.png").status, 1);
  assert.equal(run("pod", "list", pod, "--cutout").status, 1);
});
