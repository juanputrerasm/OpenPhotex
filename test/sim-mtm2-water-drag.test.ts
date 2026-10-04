/*
  MTM2 water drag areas (OpenMTM2 docs/MTM2_PHYSICS.md §14.7.1), hand-computed.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { mtm2Sim as S } from "../src/index.ts";

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
type T3 = [number, number, number];

test("wheel areas: segment, chord and depth; full circle past the diameter; none when dry", () => {
  assert.deepEqual(S.wheelWaterAreas(0, 3, 2), [0, 0, 0]);
  assert.deepEqual(S.wheelWaterAreas(-1, 3, 2), [0, 0, 0]);
  // Half under: half the disc, the full diameter as chord.
  const half = S.wheelWaterAreas(3, 3, 2);
  near(half[0], Math.PI * 9 / 2); near(half[1], 12); near(half[2], 6);
  // A quarter of the diameter: segment of height 1.5 on r = 3.
  const a = Math.acos(0.5);
  const q = S.wheelWaterAreas(1.5, 3, 2);
  near(q[0], 9 * a - 1.5 * 3 * Math.sin(a)); near(q[1], 2 * 3 * Math.sin(a) * 2); near(q[2], 3);
  // Three quarters: the disc minus that segment.
  const t = S.wheelWaterAreas(4.5, 3, 2);
  near(t[0], Math.PI * 9 - q[0]); near(t[1], 12); near(t[2], 9);
  // Deeper than the wheel counts as the diameter.
  const deep = S.wheelWaterAreas(20, 3, 2);
  near(deep[0], Math.PI * 9); near(deep[2], 12);
});

function points(): T3[] {
  const out: T3[] = [];
  for (const z of [9, -9]) for (const x of [-4, 4]) for (const y of [0, 3, -1]) out.push([x, y, z]);
  return out;
}

function setup(waterLevelFt: number | null) {
  // Flat ground at 10 ft, all deep water below the level.
  const terrain = S.createTerrain(new Uint8Array(65536).fill(5));
  const surface = S.createSurfaceMap(new Uint16Array(65536), new Int32Array([200]));
  const ground = S.createTerrainGround(terrain, surface, 0, waterLevelFt);
  const params = S.createTruckParams({ scrapePoints: points() }, { difficulty: S.DIFFICULTY.INTERMEDIATE });
  const state = S.createTruckState([100, 20, 100], 0, S.GEAR.FIRST, params);
  return { ground, params, state };
}

test("dry truck: rhoA is the aero area at air density", () => {
  const { ground, params, state } = setup(null);
  const f = S.fluidAreas(state, params, ground);
  near(f.rhoA[0], 125 * 0.002377); near(f.rhoA[1], 150 * 0.002377); near(f.rhoA[2], 75 * 0.002377);
  assert.equal(f.splash, false);
});

test("hull faces: a fully wet front face and bottom face move area from air to water", () => {
  const { ground, params, state } = setup(30);
  state.waterDepths.fill(2);
  state.bvel[2] = 20; // forward: the front face (points 1, 2, 7, 8)
  const f = S.fluidAreas(state, params, ground);
  const P = state.points;
  // Front face from point 1 to point 8: x and y extents.
  const fz = Math.abs((P[7 * 3] - P[0]) * (P[7 * 3 + 1] - P[1]));
  // Bottom (y) face from point 1 to point 12: x and z extents.
  const fy = Math.abs((P[11 * 3] - P[0]) * (P[11 * 3 + 2] - P[2]));
  near(f.rhoA[2], fz * 0.15 + Math.max(0, 75 - fz) * 0.002377);
  near(f.rhoA[1], fy * 0.15 + Math.max(0, 150 - fy) * 0.002377);
  near(f.rhoA[0], 125 * 0.002377);
  assert.equal(f.splash, true);
});

test("hull face with one wet corner: half the product of its legs", () => {
  const { ground, state } = setup(30);
  state.waterDepths.fill(0);
  state.waterDepths[0] = 2; // point 1
  // A tilted normal at point 1 gives it legs along x and y.
  state.normals.set([0.6, 0.8, 0], 0);
  const r = S.hullFaceWaterArea(state, ground, [1, 2, 7, 8], 2);
  near(r.area, 0.5 * Math.abs(2 * 0.6 * 2 * 0.8));
  assert.equal(r.density, 0.15);
});

test("wheels in water add their areas at water density", () => {
  const { ground, params, state } = setup(30);
  state.waterDepths.fill(0);
  for (const t of state.tires) { t.waterDepth = params.tireRadiusFt; t.waterPoint = [100, 10, 100]; }
  const f = S.fluidAreas(state, params, ground);
  const w = S.wheelWaterAreas(params.tireRadiusFt, params.tireRadiusFt, params.tireWidthFt);
  near(f.rhoA[0], 2 * w[0] * 0.15 + (125 - 2 * w[0]) * 0.002377);
  near(f.rhoA[1], 4 * w[1] * 0.15 + (150 - 4 * w[1]) * 0.002377);
  near(f.rhoA[2], 2 * w[2] * 0.15 + (75 - 2 * w[2]) * 0.002377);
});

test("a truck driving into deep water slows far more than on land", () => {
  const run = (level: number | null) => {
    const { ground, params, state } = setup(level);
    state.pos[1] = 12;
    const ctx = { ground, human: true, difficulty: S.DIFFICULTY.INTERMEDIATE, sonicTrack: false };
    state.bvel[2] = 40;
    for (let i = 0; i < 120; i++) {
      S.stepTruck(state, params, ctx, 1 / 60);
      S.postStepTruck(state, params, ground, 1 / 60);
    }
    return state.bvel[2];
  };
  const land = run(null), water = run(14);
  assert.ok(water < land - 5, `water ${water} vs land ${land}`);
});
