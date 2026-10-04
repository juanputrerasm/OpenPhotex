/*
  MTM2 checkpoints (OpenMTM2 docs/MONSTER_EXE_ANALYSIS.md §6.2), hand-computed.
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCheckpoints, checkpointCrossingTime, pointInCheckpointBox, speedThroughCheckpoint,
  withinCheckpointReach,
} from "../src/sim/mtm2/world/checkpoints.ts";
import { parseMtmSit } from "../src/index.ts";

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

const cpBox = (x: number, z: number, psi: number, size = [20, 100, 40]) => ({
  type: 6, positionFt: [x, 50, z], sizeFt: size, theta: 0, phi: 0, psi,
});

test("type 6 boxes in file order; detector 3x wide, 2x tall, same depth", () => {
  const cps = buildCheckpoints([cpBox(100, 100, 0), { ...cpBox(0, 0, 0), type: 0 }, cpBox(500, 900, 1)]);
  assert.equal(cps.length, 2);
  assert.deepEqual(cps.map((c) => c.index), [0, 1]);
  assert.deepEqual(cps[1].gate.position, [500, 50, 900]);
  // SIT sizes are length, width, height; boxes store width (x), height (y), length (z).
  assert.deepEqual(cps[0].gate.size, [100, 40, 20]);
  assert.deepEqual(cps[0].detector.size, [300, 80, 20]);
  near(cps[0].gate.radius, Math.hypot(50, 20, 10));
  near(cps[0].detector.radius, Math.hypot(150, 40, 10));
});

test("sphere pretest uses twice the summed radii", () => {
  const [cp] = buildCheckpoints([cpBox(100, 100, 0)]);
  const reach = (cp.detector.radius + 10) * 2;
  assert.equal(withinCheckpointReach(cp.detector, [100 + reach - 0.01, 50, 100], 10), true);
  assert.equal(withinCheckpointReach(cp.detector, [100 + reach + 0.01, 50, 100], 10), false);
});

test("direction: velocity along the checkpoint's +z axis", () => {
  const [straight, turned] = buildCheckpoints([cpBox(0, 0, 0), cpBox(0, 0, Math.PI / 2)]);
  near(speedThroughCheckpoint(straight.gate, [0, 0, 30]), 30);
  near(speedThroughCheckpoint(straight.gate, [0, 0, -30]), -30);
  // Facing +x, a truck moving along +x passes forwards.
  near(speedThroughCheckpoint(turned.gate, [25, 0, 0]), 25);
  near(speedThroughCheckpoint(turned.gate, [0, 0, 25]), 0, 1e-12);
});

test("crossing time is pulled back by depth / speed", () => {
  near(checkpointCrossingTime(12.5, 3, 60), 12.45);
});

test("gate and detector extents", () => {
  const [cp] = buildCheckpoints([cpBox(0, 0, 0)]);
  // Width 100: a point 60 ft to the side is outside the gate but inside the detector (300 wide).
  assert.equal(pointInCheckpointBox(cp.gate, [60, 50, 0]), false);
  assert.equal(pointInCheckpointBox(cp.detector, [60, 50, 0]), true);
  assert.equal(pointInCheckpointBox(cp.detector, [0, 50, 15]), false);
});

test("a model's extents replace the SIT size", () => {
  const [cp] = buildCheckpoints([{ ...cpBox(0, 0, 0), modelName: "ckboxn.bin" }], (name) => (name === "ckboxn.bin" ? [64, 32, 8] : null));
  assert.deepEqual(cp.gate.size, [64, 32, 8]);
  assert.deepEqual(cp.detector.size, [192, 64, 8]);
});

test("SIT boxes carry raw feet and sizes for the simulation", () => {
  const sit = parseMtmSit([
    "!ambient sound,track length,weather mask", "3,1000.000000,65535",
    "*** Boxes ***", "1",
    "*********************************************", "ipos", "-10.5,20.25,300.75", "theta,phi,psi", "0.0,0.0,1.5",
    "length,width,height", "12.5,64.4,32.6", "mass", "0.0", "!type,flags", "6,0", "priority", "2",
    "*** Course ***", "c1Count,course_direction", "0,0",
  ].join("\r\n"), "T.SIT");
  const box = sit.boxes.find((b) => b.type === 6)!;
  assert.deepEqual(box.positionFt, [8181.5, 20.25, 300.75]);
  assert.deepEqual(box.sizeFt, [12.5, 64.4, 32.6]);
  assert.equal(box.length, 13);
  assert.equal(box.priority, 2);
});
