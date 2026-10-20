/*
  4x4 Evolution 2's smoothed ground (OpenMTM2 docs/EVO2_EXE_ANALYSIS.md, "Ground"): 0x46a160 and 0x471cb0.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { evoSim, mtm2Sim } from "../src/index.ts";

test("the sub-grid keeps the corners, keeps a slope straight and rounds a crest (Catmull-Rom, 0x46a160)", () => {
  const corners = new Uint16Array(65536);
  // A slope along x: 32 units a column. A crest along z: one row raised by 3200 units (100 ft).
  for (let row = 0; row < 256; row++) for (let col = 0; col < 256; col++) corners[row * 256 + col] = 1000 + col * 32 + (row === 100 ? 3200 : 0);
  const fine = evoSim.evoSmoothHeights(corners);
  const at = (row: number, col: number, sz: number, sx: number) => fine[(row * 4 + sz) * 1024 + col * 4 + sx]!;
  assert.equal(at(10, 10, 0, 0), corners[10 * 256 + 10]);
  assert.deepEqual([1, 2, 3].map((k) => at(10, 10, 0, k)), [1000 + 320 + 8, 1000 + 320 + 16, 1000 + 320 + 24]);
  // Beside the crest the spline overshoots below the plain slope first (Catmull-Rom's dip), then rises to it.
  assert.ok(at(98, 10, 2, 0) < 1000 + 320, "the dip before the crest");
  assert.ok(at(99, 10, 2, 0) > 1000 + 320 + 1600, "the crest's shoulder rounded up above the straight line's half");
});

test("a terrain with the fine grid stands on it, triangles split by the fine cells' parity (0x471cb0)", () => {
  const corners = new Float32Array(65536).fill(50);
  const fineFt = new Float32Array(1024 * 1024).fill(50);
  // One fine point raised: the ground rises within 8 ft of it, not 32.
  fineFt[400 * 1024 + 400] = 60;
  const t = mtm2Sim.createTerrainFt(corners, null, fineFt);
  assert.equal(mtm2Sim.terrainHeightAt(t, 400 * 8, 400 * 8), 60);
  assert.equal(mtm2Sim.terrainHeightAt(t, 400 * 8 + 9, 400 * 8), 50);
  assert.ok(mtm2Sim.terrainHeightAt(t, 400 * 8 + 4, 400 * 8 + 1) > 50);
  const n: [number, number, number] = [0, 0, 0];
  mtm2Sim.groundNormalAt(t, 400 * 8 + 4, 400 * 8 + 1, n);
  assert.ok(n[0] > 0.5, "the slope of an 8 ft cell");
});
