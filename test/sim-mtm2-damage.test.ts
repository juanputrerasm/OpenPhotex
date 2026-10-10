import test from "node:test";
import assert from "node:assert/strict";
import { mtm2Sim as S } from "../src/index.ts";

test("damage levels follow the impact force: 0, up to 10000, up to 30000, above", () => {
  assert.deepEqual([-5, 0, 1, 10000, 10001, 30000, 30001, 1e6].map(S.damageLevelForForce), [0, 0, 1, 1, 2, 2, 3, 3]);
});

test("a zone's level lives in two bits of the damage code and only rises", () => {
  let code = 0;
  assert.equal(S.isDamaged(code), false);
  let hit = S.recordZoneHit(code, 3, 5000);
  assert.deepEqual([hit.level, hit.raised, S.zoneLevel(hit.code, 3), S.zoneLevel(hit.code, 4)], [1, true, 1, 0]);
  code = hit.code;
  assert.equal(S.isDamaged(code), true);
  hit = S.recordZoneHit(code, 3, 40000);
  assert.deepEqual([hit.level, S.zoneLevel(hit.code, 3)], [3, 3]);
  code = hit.code;
  // A gentler hit later does not lower it.
  hit = S.recordZoneHit(code, 3, 100);
  assert.deepEqual([hit.raised, hit.code], [false, code]);
  // Zone 12 uses the top bits.
  assert.equal(S.zoneLevel(S.recordZoneHit(0, 12, 20000).code, 12), 2);
});

test("the dent grows with the level: about 16 to 24 units at level 0 and 64 to 72 at level 3", () => {
  assert.deepEqual([S.dentUnits(0, 0), S.dentUnits(0, 0.9999), S.dentUnits(3, 0), S.dentUnits(3, 0.9999)], [15, 23, 63, 71]);
  assert.ok(S.dentUnits(2, 0.5) > S.dentUnits(1, 0.5));
});

test("zones 1 to 4 reach 2 ft and 5 to 12 reach 1.5 ft, pushing the way their signs say", () => {
  assert.equal(S.zoneDent(1).radiusFt, 2);
  assert.equal(S.zoneDent(4).radiusFt, 2);
  assert.equal(S.zoneDent(5).radiusFt, 1.5);
  assert.deepEqual(S.zoneDent(1).direction, [1, 1, -1]);
  assert.deepEqual(S.zoneDent(12).direction, [-1, 1, 1]);
});

test("pushing moves only the vertices within the radius, and a vertex repeated per face moves together", () => {
  const positions = new Float32Array([0, 0, 0, 0.5, 0, 0, 5, 0, 0, 0.5, 0, 0]);
  const moved = S.dentVertices(positions, [0, 0, 0], [1, 0, 0], 2, 1, () => 0.5);
  assert.equal(moved, 3);
  assert.equal(positions[6], 5);
  const amount = S.dentUnits(1, 0.5) / 256;
  assert.ok(Math.abs(positions[0]! - amount) < 1e-6);
  assert.equal(positions[3], positions[9], "the repeated vertex stayed welded");
});

test("a dent builds up over calls because the radius is tested on the moved vertex", () => {
  const positions = new Float32Array([1.9, 0, 0]);
  for (let i = 0; i < 20; i++) S.dentVertices(positions, [0, 0, 0], [1, 0, 0], 2, 0, () => 0);
  // It was pushed out of the 2 ft radius after a few calls and then stayed.
  assert.ok(positions[0]! >= 2 && positions[0]! < 2.1);
});
