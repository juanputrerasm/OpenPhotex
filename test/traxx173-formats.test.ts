/*
  Traxx 1.7.3 / CP4 beta 0.53 hotfix 3 format additions: the .WFL v1.1 rough-from byte (130) and the
  .WTR edge-rule header (minor 1, flags bit 0 at byte 20).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { parseWfl, writeWfl, parseWtr, writeWtr, WFL_ROUGH_OFF, WTR_HEADER_EDGE_RULE } from "../src/index.ts";

const fall = (extra: Record<string, number> = {}) => ({
  source: 0, flags: 0, speed: 160, height: 200, points: [{ x: 1600, z: 1600 }, { x: 3200, z: 1600 }],
  opacity: 100, mist: 50, volume: 80, ...extra,
});

test("WFL: rough from 0 keeps the v1.0 file", () => {
  const b = writeWfl([fall()]);
  const w = parseWfl(b);
  assert.equal(w.stride, 128);
  assert.equal(w.minor, 0);
  assert.equal(w.falls[0]!.roughFrom, 0);
});

test("WFL: a rough from makes v1.1 and lands in byte 130", () => {
  for (const rf of [1, 40, 250, WFL_ROUGH_OFF, 252]) {
    const b = writeWfl([fall(), fall({ roughFrom: rf })]);
    const w = parseWfl(b);
    assert.equal(w.stride, 132);
    assert.equal(w.minor, 1);
    assert.equal(w.falls[0]!.roughFrom, 0);
    assert.equal(w.falls[1]!.roughFrom, rf, "kept raw, 251..254 included");
    assert.equal(b[48 + 8 + 132 + 130], rf);
    assert.equal(b[48 + 8 + 132 + 131], 0, "byte 131 reserved");
    assert.equal(w.falls[1]!.mistDepth, 100);
  }
  assert.throws(() => writeWfl([fall({ roughFrom: 256 })]), /rough from/);
});

test("WTR: the edge-rule header round-trips; the default header is Traxx 1.7.0's", () => {
  const map = new Uint8Array(65536);
  map[10 + 10 * 256] = 1;
  const lake = { flags: 1, height: 100, seeds: [{ x: 10, z: 10 }], box: { minX: 10, minZ: 10, maxX: 10, maxZ: 10 }, tileCount: 1 };
  const old = writeWtr([lake], map);
  assert.equal(old[6], 0);
  assert.equal(old[20], 0);
  const o = parseWtr(old);
  assert.equal(o.edgeRule, false);
  assert.equal(o.headerFlags, 0);
  const edge = writeWtr([lake], map, { edgeRule: true });
  const e = parseWtr(edge);
  assert.equal(e.minor, 1);
  assert.equal(e.headerFlags, WTR_HEADER_EDGE_RULE);
  assert.equal(e.edgeRule, true);
  assert.deepEqual(e.tileMap, map);
});
