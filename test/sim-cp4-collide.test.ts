/*
  Community Patch 4's triangle collision (OpenMTM2 docs/CP4_EXE_ANALYSIS.md 11; its author published no
  source code): the soup, the shape queries and the solver against synthetic boxes. The main check is that
  a box made of triangles holds a truck up as the classic box of the same size does.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { cp4Sim as C, mtm2Sim as S, MRGL, writeBin } from "../src/index.ts";

type T3 = [number, number, number];

/** The 12 triangles of a box centred on the origin, half extents h. */
function boxTris(h: T3): number[] {
  const [x, y, z] = h;
  const v: T3[] = [[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]];
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [3, 7, 6, 2], [0, 1, 5, 4]];
  const out: number[] = [];
  for (const [a, b, c, d] of quads) for (const t of [[a, b, c], [a, c, d]]) for (const k of t) out.push(...v[k]!);
  return out;
}

function scrapePoints(): T3[] {
  const out: T3[] = [];
  for (const z of [9.2, -9.2]) for (const x of [-3.67, 3.67]) for (const y of [0, 2.56, -1]) out.push([x, y, z]);
  return out;
}

/** A level box (type 0) with or without its triangles. */
function levelBox(pos: T3, size: T3, mass = 0, tris = true) {
  const b = S.createBox(pos, size, mass);
  b.type = 0;
  if (tris) b.shape = C.buildCollShape(boxTris([size[0] / 2, size[1] / 2, size[2] / 2]));
  return b;
}

function scene(rules: S.Mtm2Rules, pos: T3, boxes: S.SimBox[]) {
  const ground = S.createTerrainGround(S.createTerrain(new Uint8Array(65536).fill(50)), null, 0, null, rules);
  const params = S.createTruckParams({ scrapePoints: scrapePoints() }, { difficulty: S.DIFFICULTY.INTERMEDIATE });
  const state = S.createTruckState(pos, 0, S.GEAR.FIRST, params);
  const ctx: S.StepContext = { ground, human: true, difficulty: S.DIFFICULTY.INTERMEDIATE, sonicTrack: false };
  const step = (dt = 1 / 60, throttle = 0) => {
    state.controls.throttle = throttle;
    S.stepTruck(state, params, ctx, dt);
    for (const b of boxes) S.collideTruckBox(state, params, b, dt, rules);
    S.postStepTruck(state, params, ground, dt);
  };
  return { state, params, ground, step };
}

test("a BIN's soup: facets fanned, in feet, game frame", () => {
  // A 2 x 2 ft square at height 1 ft, as one quad: two triangles.
  const words = [0, 256, 0, 512, 256, 0, 512, 256, 512, 0, 256, 512];
  const { bytes } = writeBin({ vertices: words, groups: [{ texture: "deck.raw", opcode: MRGL.ZFACET, faces: [{ vertexIndices: [0, 1, 2, 3] }] }] });
  const soup = C.binBytesCollisionSoup(bytes)!;
  assert.equal(soup.positions.length, 18);
  assert.deepEqual([...soup.positions.slice(0, 9)], [0, 1, 0, 2, 1, 0, 2, 1, 2]);
  assert.deepEqual([...soup.positions.slice(9)], [0, 1, 0, 2, 1, 2, 0, 1, 2]);
  assert.deepEqual(soup.textures, ["DECK.RAW"]);
  assert.deepEqual([...soup.textureIndex], [0, 0]);
  // Twice the magnify, half the size.
  const half = C.binBytesCollisionSoup(writeBin({ magnify: 131072, vertices: words, groups: [{ texture: "", opcode: MRGL.ZFACET, faces: [{ vertexIndices: [0, 1, 2] }] }] }).bytes)!;
  assert.deepEqual([...half.positions], [0, 0.5, 0, 1, 0.5, 0, 1, 0.5, 1]);
});

test("the shape: a solid box is usable, a flat plate keeps its classic box", () => {
  const cube = C.buildCollShape(boxTris([2, 1, 3]));
  assert.equal(cube.degenerate, false);
  assert.ok(Math.abs(cube.hullVolume - 4 * 2 * 6) < 1e-6, `${cube.hullVolume}`);
  assert.ok(C.shapeUsable(cube));
  const plate = C.buildCollShape([0, 0, 0, 4, 0, 0, 4, 0, 4, 0, 0, 0, 4, 0, 4, 0, 0, 4]);
  assert.equal(plate.degenerate, true);
  assert.equal(C.shapeUsable(plate), false);
  const dims = cube.grid!.dims;
  assert.ok(dims.every((d) => d >= 1 && d <= 96) && dims[0] * dims[1] * dims[2] <= 32768);
});

test("ray: the nearest hit, its normal toward the ray's origin, double-sided", () => {
  const cube = C.buildCollShape(boxTris([2, 1, 3]));
  const down = C.rayQuery(cube, [0.3, 5, 0.2], [0, -1, 0], 10)!;
  assert.ok(Math.abs(down.t - 4) < 1e-9);
  assert.deepEqual(down.normal.map((v) => Math.round(v) + 0), [0, 1, 0]);
  // From inside, up: the top face from below, its normal turned down toward the origin.
  const up = C.rayQuery(cube, [0.3, 0, 0.2], [0, 1, 0], 10)!;
  assert.ok(Math.abs(up.t - 1) < 1e-9);
  assert.deepEqual(up.normal.map((v) => Math.round(v) + 0), [0, -1, 0]);
  assert.equal(C.rayQuery(cube, [0.3, 5, 0.2], [0, -1, 0], 3), null, "too short");
  // Two coincident triangles: the lower index wins.
  const twice = C.buildCollShape([...boxTris([2, 1, 3]), ...boxTris([2, 1, 3])]);
  assert.ok(C.rayQuery(twice, [0.3, 5, 0.2], [0, -1, 0], 10)!.tri < 12);
});

test("cylinder: depth below the axis; tread clip cuts the sides, a capsule does not", () => {
  const cube = C.buildCollShape(boxTris([2, 1, 3]));
  // Axis along x, 2.5 ft above the top, radius 3: 0.5 ft into the top.
  const hit = C.cylinderQuery(cube, [0, 3.5, 0], [1, 0, 0], 3, 1, 0, true)!;
  assert.ok(Math.abs(hit.penetration - 0.5) < 1e-9, `${hit.penetration}`);
  assert.deepEqual(hit.normal.map((v) => Math.round(v) + 0), [0, 1, 0]);
  // Beside the box along the axis: the clipped cylinder misses it, the capsule's end reaches it.
  assert.equal(C.cylinderQuery(cube, [4, 2, 0], [1, 0, 0], 3, 1, 0, true), null);
  assert.ok(C.cylinderQuery(cube, [4, 2, 0], [1, 0, 0], 3, 1, 0, false)!.penetration > 0);
});

test("a truck parks on a triangle box as on the classic box of the same size", () => {
  const ride = (rules: S.Mtm2Rules, tris: boolean) => {
    const box = levelBox([1000, 105, 1000], [40, 10, 40], 0, tris);
    const sc = scene(rules, [1000, 122, 1000], [box]);
    for (let i = 0; i < 400; i++) sc.step();
    assert.ok(sc.state.tires.every((t) => t.onGround), "all wheels down");
    return sc.state;
  };
  const classic = ride(C.CP4_CLASSIC_RULES, true);
  const tri = ride(C.CP4_RULES, true);
  assert.ok(Math.abs(tri.pos[1] - classic.pos[1]) < 0.05, `triangles ${tri.pos[1]} vs box ${classic.pos[1]}`);
  assert.ok(Math.abs(tri.euler[0]) < 0.02 && Math.abs(tri.euler[1]) < 0.02, "level");
  assert.equal(tri.tires[0].supportSource, 3);
  assert.equal(classic.tires[0].supportSource, 2);
});

test("a ground box and a degenerate shape always collide as classic boxes", () => {
  const g = levelBox([0, 0, 0], [4, 4, 4]);
  assert.equal(C.triangleBox(g, C.CP4_RULES), true);
  assert.equal(C.triangleBox(g, C.CP4_CLASSIC_RULES), false);
  assert.equal(C.triangleBox(g, S.MTM2_RULES), false);
  const ground = levelBox([0, 0, 0], [4, 4, 4]);
  ground.ground = true;
  assert.equal(C.triangleBox(ground, C.CP4_RULES), false);
  const flat = levelBox([0, 0, 0], [4, 4, 4], 0, false);
  flat.shape = C.buildCollShape([0, 0, 0, 4, 0, 0, 4, 0, 4]);
  assert.equal(C.triangleBox(flat, C.CP4_RULES), false);
});

test("the support on a small prop is capped at 2 ft", () => {
  // A 4 ft block under the truck's front right wheel, its top 3 ft above the wheel's bottom.
  const sc = scene(C.CP4_RULES, [1000, 100, 1000], []);
  const { state, params } = sc;
  for (let i = 0; i < 300; i++) sc.step();
  const t = state.tires[0];
  const m = state.matrix;
  const hw = [m[0] * t.hub[0] + m[1] * t.hub[1] + m[2] * t.hub[2], m[3] * t.hub[0] + m[4] * t.hub[1] + m[5] * t.hub[2], m[6] * t.hub[0] + m[7] * t.hub[1] + m[8] * t.hub[2]];
  const bottom = state.pos[1] + hw[1] - params.tireRadiusFt;
  // Wide enough for the rays, which start on the wheel's inner sidewall as MTM2's (11.4).
  const block = levelBox([state.pos[0] + hw[0], bottom + 3 - 2, state.pos[2] + hw[2]], [8, 4, 3]);
  state.prevPos.set(state.pos); state.prevMatrix.set(state.matrix);
  for (const tt of state.tires) tt.penetration = -9999;
  S.collideTruckImmovableBox(state, params, block, 1 / 60, C.CP4_RULES);
  assert.ok(state.tires[0].penetration > 0 && state.tires[0].penetration <= 2 + 1e-9, `${state.tires[0].penetration}`);
  // A tall block is not capped.
  const tall = levelBox([state.pos[0] + hw[0], bottom + 3 - 10, state.pos[2] + hw[2]], [8, 20, 3]);
  for (const tt of state.tires) tt.penetration = -9999;
  S.collideTruckImmovableBox(state, params, tall, 1 / 60, C.CP4_RULES);
  assert.ok(state.tires[0].penetration > 2, `${state.tires[0].penetration}`);
});

test("a truck driving at a triangle wall stops at it", () => {
  const wall = levelBox([1000, 120, 1040], [60, 40, 4]);
  const sc = scene(C.CP4_RULES, [1000, 104, 1000], [wall]);
  for (let i = 0; i < 120; i++) sc.step();
  sc.state.bvel[2] = 60;
  for (let i = 0; i < 240; i++) sc.step(1 / 60, 1);
  // The truck's nose (9.2 ft ahead) stays out of the 4 ft wall whose near face is at z = 1038.
  assert.ok(sc.state.pos[2] < 1038, `${sc.state.pos[2]}`);
  assert.ok([...sc.state.pos, ...sc.state.bvel].every(Number.isFinite));
});

test("climb blend: a smoothstep from 0.35 to 1 of the radius", () => {
  // The rule's own ramp (11.6): b = smoothstep((f - lo) / (hi - lo)).
  const lo = C.CP4_TRIANGLES.climbBlendLo, hi = C.CP4_TRIANGLES.climbBlendHi;
  const b = (f: number) => { const x = (f - lo) / (hi - lo); return x <= 0 ? 0 : x >= 1 ? 1 : (3 - 2 * x) * x * x; };
  assert.equal(b(0.35), 0);
  assert.equal(b(1), 1);
  assert.ok(Math.abs(b(0.675) - 0.5) < 1e-12);
});

test("SRF grip: a typed deck's surface for the tires, the terrain where the deck is far below", () => {
  const ground = S.createTerrainGround(S.createTerrain(new Uint8Array(65536).fill(50)), null, 0, null, C.CP4_RULES);
  const deck = levelBox([500, 110, 500], [20, 2, 20]);
  deck.shape!.surfaceTypes = new Int16Array(12).fill(800); // ice
  C.withSurfaceMeshes(ground, [deck]);
  assert.equal(ground.tireSurface!(500, 111, 500), 800);
  // Beside the deck: the terrain (no surface map: 200).
  assert.equal(ground.tireSurface!(530, 100, 530), 200);
  // Untyped faces are skipped.
  deck.shape!.surfaceTypes.fill(C.UNTYPED_SURFACE);
  assert.equal(ground.tireSurface!(500, 111, 500), 200);
});
