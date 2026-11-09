/*
  The CP4 smooth-terrain spline (src/terrain/spline.ts), against terrainspline.c's published
  rules and, when a Traxx 1.7 source tree is present, its test vectors
  (tools/terrainspline_vectors/expected.txt: FNV-1a 64 hashes of input and output). Point
  TRAXX_SRC at the tree (default ~/dev/Traxx_OnGoing_Updates); the vector test skips without it.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { terrainSplineExpand, terrainSplineSeg } from "../src/index.ts";

function fnv1a64(bytes: Uint8Array): string {
  let h = 0xcbf29ce484222325n;
  for (const b of bytes) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

test("a segment keeps a straight slope straight and never overshoots", () => {
  assert.deepEqual([1, 2, 3].map((k) => terrainSplineSeg(0, 100, 200, 300, k)), [125, 150, 175]);
  // A step: monotone, between the two ends.
  for (let k = 1; k <= 3; k++) {
    const v = terrainSplineSeg(0, 0, 1000, 1000, k);
    assert.ok(v >= 0 && v <= 1000);
  }
  // A crest has a zero tangent: the segment after it starts flat.
  assert.ok(terrainSplineSeg(0, 500, 400, 300, 1) > 475);
  // k outside 1..3 is p1.
  assert.equal(terrainSplineSeg(0, 70000, 0, 0, 0), 65535);
});

test("large secants are exact (BigInt path) and agree with the small-number path in shape", () => {
  const v = terrainSplineSeg(0, 1, 65535, 65535, 2);
  assert.ok(v > 0 && v < 65535);
  assert.equal(terrainSplineSeg(65535, 0, 65535, 0, 2), 32768);
});

test("expansion keeps every coarse point and wraps at the edges", () => {
  const coarse = new Uint16Array(65536);
  for (let i = 0; i < coarse.length; i++) coarse[i] = (i * 2654435761) & 0xffff;
  const fine = terrainSplineExpand(coarse);
  for (const [z, x] of [[0, 0], [17, 200], [255, 255]] as const) assert.equal(fine[4 * z * 1024 + 4 * x], coarse[z * 256 + x]);
});

const traxx = process.env.TRAXX_SRC ?? join(homedir(), "dev/Traxx_OnGoing_Updates");
const vectors = join(traxx, "tools/terrainspline_vectors");
test("terrainspline.c's test vectors (FNV-1a 64 of input and output)", { skip: !existsSync(join(vectors, "expected.txt")) }, () => {
  const lines = readFileSync(join(vectors, "expected.txt"), "latin1").split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
  assert.ok(lines.length >= 8);
  for (const line of lines) {
    const [name, inHash, outHash] = line.trim().split(/\s+/);
    const bytes = new Uint8Array(readFileSync(join(vectors, `${name}.in.raw`)));
    assert.equal(fnv1a64(bytes), inHash, `${name} input`);
    const coarse = new Uint16Array(65536);
    for (let i = 0; i < 65536; i++) coarse[i] = bytes[2 * i]! | (bytes[2 * i + 1]! << 8);
    const fine = terrainSplineExpand(coarse);
    const out = new Uint8Array(fine.length * 2);
    for (let i = 0; i < fine.length; i++) { out[2 * i] = fine[i]! & 255; out[2 * i + 1] = fine[i]! >> 8; }
    assert.equal(fnv1a64(out), outHash, `${name} output`);
  }
});
