/*
  MTM2 collisions with immovable boxes (OpenMTM2 docs/MTM2_PHYSICS.md §7.3, §14.14).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { mtm2Sim as S } from "../src/index.ts";

type T3 = [number, number, number];
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

function scrapePoints(): T3[] {
  const out: T3[] = [];
  for (const z of [9.2, -9.2]) for (const x of [-3.67, 3.67]) for (const y of [0, 2.56, -1]) out.push([x, y, z]);
  return out;
}

test("ground boxes: the 3 x 3 cells around a point whose heights differ", () => {
  const ra0 = new Uint8Array(65536), ra1 = new Uint8Array(65536);
  // Cell (col 31, row 32): from 10 ft to 30 ft.
  ra0[32 * 256 + 31] = 5; ra1[32 * 256 + 31] = 15;
  // Same heights: no box.
  ra0[32 * 256 + 32] = 7; ra1[32 * 256 + 32] = 7;
  const boxes = S.groundBoxesAround(ra0, ra1, 32 * 32 + 5, 32 * 32 + 5);
  assert.equal(boxes.length, 1);
  assert.deepEqual(boxes[0].pos, [31 * 32 + 16, 20, 32 * 32 + 16]);
  assert.deepEqual(boxes[0].half, [16, 10, 16]);
  assert.equal(boxes[0].mass, 0);
  near(boxes[0].radius, Math.hypot(16, 10, 16));
  // Two cells away: out of range.
  assert.equal(S.groundBoxesAround(ra0, ra1, 34 * 32 + 5, 32 * 32 + 5).length, 0);
});

/** Flat terrain at 100 ft with ground boxes from `ra0` / `ra1`; one truck. */
function world(ra0: Uint8Array, ra1: Uint8Array, pos: T3, heading = 0) {
  const terrain = S.createTerrain(new Uint8Array(65536).fill(50));
  const ground = S.createTerrainGround(terrain, null, 0, null);
  const params = S.createTruckParams({ scrapePoints: scrapePoints() }, { difficulty: S.DIFFICULTY.INTERMEDIATE });
  const state = S.createTruckState(pos, heading, S.GEAR.FIRST, params);
  const ctx = { ground, human: true, difficulty: S.DIFFICULTY.INTERMEDIATE, sonicTrack: false };
  const dt = 1 / 60;
  const step = () => {
    S.stepTruck(state, params, ctx, dt);
    for (const box of S.groundBoxesAround(ra0, ra1, state.pos[0], state.pos[2])) {
      S.collideTruckImmovableBox(state, params, box, dt);
    }
    S.postStepTruck(state, params, ground, dt);
  };
  return { state, params, step };
}

function platform(lo: number, hi: number, c0: number, c1: number, r0: number, r1: number) {
  const ra0 = new Uint8Array(65536), ra1 = new Uint8Array(65536);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { ra0[r * 256 + c] = lo; ra1[r * 256 + c] = hi; }
  return { ra0, ra1 };
}

test("a truck parks on a ground-box platform at its usual ride height above it", () => {
  const flat = world(new Uint8Array(65536), new Uint8Array(65536), [1000, 110, 1000]);
  for (let i = 0; i < 300; i++) flat.step();
  const rideHeight = flat.state.pos[1] - 100;
  // A 10 ft platform (100 to 110 ft) under cells 28-34.
  const { ra0, ra1 } = platform(50, 55, 28, 34, 28, 34);
  const on = world(ra0, ra1, [1000, 125, 1000]);
  for (let i = 0; i < 300; i++) on.step();
  const above = on.state.pos[1] - 110;
  assert.ok(Math.abs(above - rideHeight) < 0.4, `ride ${above} on the box vs ${rideHeight} on the ground`);
  assert.ok(on.state.tires.every((t) => t.onGround), "all wheels on the box");
  assert.ok(Math.abs(on.state.euler[0]) < 0.02 && Math.abs(on.state.euler[1]) < 0.02, "level");
});

test("no tunnelling: a truck at 150 ft/s stops at a ground-box wall", () => {
  // A wall 20 ft high across x, cells row 40 (z 1280 to 1312).
  const { ra0, ra1 } = platform(50, 60, 0, 255, 40, 40);
  const t = world(ra0, ra1, [1000, 106.2, 1150]);
  for (let i = 0; i < 120; i++) t.step();
  t.state.bvel[2] = 150;
  let maxZ = 0;
  for (let i = 0; i < 180; i++) { t.step(); maxZ = Math.max(maxZ, t.state.pos[2]); }
  assert.ok(maxZ < 1280, `front reached z ${maxZ}`);
  assert.ok([...t.state.pos, ...t.state.bvel].every(Number.isFinite));
  assert.ok(t.state.bvel[2] < 20, `still ${t.state.bvel[2]} ft/s into the wall`);
});
