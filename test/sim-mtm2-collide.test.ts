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

test("hull contacts on a vertical plane get no support (2 and 3 contacts)", () => {
  // §14.12: when the solver's plane normal has y exactly 0, every share is 0.
  const terrain = S.createTerrain(new Uint8Array(65536).fill(50));
  const ground = S.createTerrainGround(terrain, null, 0, null);
  const params = S.createTruckParams({ scrapePoints: scrapePoints() }, { difficulty: S.DIFFICULTY.INTERMEDIATE });
  for (const touching of [[0, 3], [0, 1, 3]]) {
    const s = S.createTruckState([1000, 200, 1000], 0, S.GEAR.FIRST, params);
    s.depths.fill(-10);
    for (const j of touching) { s.depths[j] = 0; s.normals.set([0, 0, -1], j * 3); }
    s.contactCount = touching.length;
    const weight = S.truckWeight(params);
    const out = S.solveHullContacts(s, params.inertia, ground, [0, -weight, 0], weight / 32.174, weight, 1 / 60);
    assert.equal(out.count, touching.length);
    assert.deepEqual(out.force.map((f) => Math.abs(f)), [0, 0, 0], `${touching.length} contacts`);
  }
});

test("level boxes: types 6, 7 and 8 never collide; priority above the detail level does not", () => {
  for (const type of [0, 1, 2, 3, 4, 5, 9, 10, 11]) assert.ok(S.levelBoxCollides({ type }), `type ${type}`);
  for (const type of [6, 7, 8]) assert.ok(!S.levelBoxCollides({ type }), `type ${type}`);
  assert.ok(S.levelBoxCollides({ type: 0, priority: 2 }, 2));
  assert.ok(!S.levelBoxCollides({ type: 0, priority: 2 }, 1));
});

test("a level box is centred on its position and sized by its model's bounds", () => {
  const src = { positionFt: [100, 20, 300] as T3, theta: 0, phi: 0, psi: Math.PI / 2, sizeFt: [64, 64, 64] as T3, mass: 0, type: 1 };
  // Bounds off-centre on purpose: the game ignores the offset.
  const box = S.createLevelBox(src, { min: [-2, 0, -10], max: [4, 8, 2] })!;
  assert.deepEqual(box.pos, [100, 20, 300]);
  assert.deepEqual(box.half, [3, 4, 6]);
  near(box.radius, Math.hypot(3, 4, 6));
  assert.equal(box.type, 1);
  // psi turns the box's z onto world x.
  near(box.matrix[2], 1, 1e-12);
  // No model: the SIT's length (z), width (x), height (y).
  assert.deepEqual(S.createLevelBox(src)!.half, [32, 32, 32]);
  assert.equal(S.createLevelBox({ ...src, positionFt: undefined }), null);
});

test("camera-facing type 9 takes the larger footprint side for both, halved", () => {
  const box = S.createLevelBox({ positionFt: [0, 0, 0], theta: 0, phi: 0, psi: 0, mass: 0, type: 9 }, { min: [-3, 0, -1], max: [3, 10, 1] })!;
  assert.deepEqual(box.half, [1.5, 5, 1.5]);
});

test("a box is pushable only when it is lighter than the truck and has a mass", () => {
  assert.ok(S.boxIsImmovableFor({ mass: 0 }, 300));
  assert.ok(S.boxIsImmovableFor({ mass: 300 }, 300));
  assert.ok(S.boxIsImmovableFor({ mass: 559 }, 300));
  assert.ok(!S.boxIsImmovableFor({ mass: 77.7 }, 300));
});

/** Flat ground at 100 ft, one truck and some boxes, stepped in the game's order (§14.16, §14.17). */
function scene(pos: T3, boxes: ReturnType<typeof S.createBox>[], heading = 0) {
  const terrain = S.createTerrain(new Uint8Array(65536).fill(50));
  const ground = S.createTerrainGround(terrain, null, 0, null);
  const params = S.createTruckParams({ scrapePoints: scrapePoints() }, { difficulty: S.DIFFICULTY.INTERMEDIATE });
  const state = S.createTruckState(pos, heading, S.GEAR.FIRST, params);
  const ctx = { ground, human: true, difficulty: S.DIFFICULTY.INTERMEDIATE, sonicTrack: false };
  const dt = 1 / 60;
  /** World pair force on the truck and on the boxes at the end of the last pair tests. */
  const pairForces = () => {
    const ft = Array.from(state.extForce), m = state.matrix;
    const tw = [0, 1, 2].map((r) => m[r * 3] * ft[0] + m[r * 3 + 1] * ft[1] + m[r * 3 + 2] * ft[2]);
    const bw = [0, 0, 0];
    for (const b of boxes) for (let r = 0; r < 3; r++) bw[r] += b.matrix[r * 3] * b.force[0] + b.matrix[r * 3 + 1] * b.force[1] + b.matrix[r * 3 + 2] * b.force[2];
    return { truck: tw, boxes: bw };
  };
  const step = (onPairs?: () => void) => {
    S.stepTruck(state, params, ctx, dt);
    for (const b of boxes) S.stepBox(b, ground, dt);
    for (const b of boxes) S.collideTruckBox(state, params, b, dt);
    onPairs?.();
    S.postStepTruck(state, params, ground, dt);
    for (const b of boxes) S.postStepBox(b, ground);
  };
  return { state, params, ground, step, pairForces, dt };
}

test("box inertias are m (a^2 + b^2) / 12 of the full sizes, in the truck's I1, I2, I3 slots", () => {
  const b = S.createBox([0, 0, 0], [2, 4, 6], 12); // w, h, l
  assert.deepEqual(S.boxInertia(b), [12 * (16 + 4) / 12, 12 * (16 + 36) / 12, 12 * (4 + 36) / 12]);
  assert.deepEqual(Array.from(b.points.slice(0, 6)), [-1, -2, 3, 1, -2, 3]);
  assert.ok(b.dynamic && !S.createBox([0, 0, 0], [1, 1, 1], 0.5).dynamic, "dynamic from a mass of 1");
});

test("a box at rest with nothing on it is not stepped; a dropped one settles on the ground", () => {
  const terrain = S.createTerrain(new Uint8Array(65536).fill(50));
  const ground = S.createTerrainGround(terrain, null, 0, null);
  const resting = S.createBox([500, 140, 500], [4, 4, 4], 10);
  for (let i = 0; i < 60; i++) { S.stepBox(resting, ground, 1 / 60); S.postStepBox(resting, ground); }
  assert.deepEqual(resting.pos, [500, 140, 500], "floating box left alone");
  const dropped = S.createBox([500, 104, 500], [4, 4, 4], 10);
  dropped.vel[1] = -0.5;
  for (let i = 0; i < 600; i++) { S.stepBox(dropped, ground, 1 / 60); S.postStepBox(dropped, ground); }
  const bottom = dropped.pos[1] - 2;
  assert.ok(bottom > 99.5 && bottom < 100.1, `bottom at ${bottom}`);
  assert.deepEqual(dropped.vel, [0, 0, 0], "at rest");
});

test("pushing a box: the pair forces are equal and opposite, and the box moves on", () => {
  const box = S.createBox([1000, 102, 1030], [6, 4, 6], 50);
  const t = scene([1000, 106.2, 1000], [box]);
  for (let i = 0; i < 60; i++) t.step();
  t.state.bvel[2] = 40;
  let pairs = 0;
  for (let i = 0; i < 120; i++) {
    t.step(() => {
      const { truck, boxes } = t.pairForces();
      if (Math.hypot(...boxes) === 0) return;
      pairs++;
      for (let k = 0; k < 3; k++) near(truck[k], -boxes[k], 1e-6 * Math.max(1, Math.abs(boxes[k])));
    });
  }
  assert.ok(pairs > 0, "the truck met the box");
  assert.ok(box.pos[2] > 1040, `box pushed to z ${box.pos[2]}`);
  assert.ok([...box.pos, ...t.state.pos].every(Number.isFinite));
});

test("a box heavier than the truck is ground for it even though it has a mass", () => {
  const params = S.createTruckParams({ scrapePoints: scrapePoints() }, { difficulty: S.DIFFICULTY.INTERMEDIATE });
  const heavy = S.createBox([1000, 105, 1000], [40, 10, 40], S.truckWeight(params) / 32.174 * 2);
  const t = scene([1000, 116, 1000], [heavy]);
  for (let i = 0; i < 300; i++) t.step();
  assert.ok(t.state.tires.every((x) => x.onGround), "on the heavy box");
  assert.ok(t.state.pos[1] > 112, `truck at ${t.state.pos[1]}`);
});

test("a cone met only by a wheel is shoved by the box corners against the wheel (0x49f920)", () => {
  const params = S.createTruckParams({ scrapePoints: scrapePoints() }, { difficulty: S.DIFFICULTY.INTERMEDIATE });
  const fr = params.hubs[0];
  // A 1.5 ft cone ahead of the front right wheel, outside the hull points (x 3.67).
  const cone = S.createBox([1000 + fr[0] + 0.5, 100.75, 1025], [1.5, 1.5, 1.5], 6);
  const t = scene([1000, 106.2, 1000], [cone]);
  for (let i = 0; i < 60; i++) t.step();
  t.state.bvel[2] = 30;
  for (let i = 0; i < 90; i++) t.step();
  assert.ok(Math.hypot(cone.pos[0] - (1000 + fr[0] + 0.5), cone.pos[2] - 1025) > 2, `cone at ${cone.pos}`);
});

test("a moving object (type 10) slides along its bvel on the ground, rides a ground-box deck it is above, and wraps (14.18)", () => {
  const terrain = S.createTerrain(new Uint8Array(65536).fill(50)); // 100 ft
  // A deck from 104 to 110 ft over cell (40, 40).
  const ra0 = new Uint8Array(65536), ra1 = new Uint8Array(65536);
  ra0[40 * 256 + 40] = 52; ra1[40 * 256 + 40] = 55;
  near(S.groundBoxHeightAt(terrain, ra0, ra1, 40 * 32 + 5, 40 * 32 + 5, 120), 110);
  near(S.groundBoxHeightAt(terrain, ra0, ra1, 40 * 32 + 5, 40 * 32 + 5, 103), 100, 1e-9);
  near(S.groundBoxHeightAt(terrain, ra0, ra1, 41 * 32 + 5, 40 * 32 + 5, 120), 100, 1e-9);

  const obj = S.createBox([39 * 32 + 16, 112.5, 40 * 32 + 16], [17, 5, 85], 0);
  S.stepMovingObject(obj, [32, 0, 0], terrain, ra0, ra1, 1);
  assert.deepEqual(obj.pos, [40 * 32 + 16, 112.5, 40 * 32 + 16], "on the deck: 110 + 2.5");
  S.stepMovingObject(obj, [32, 0, 0], terrain, ra0, ra1, 1);
  near(obj.pos[1], 102.5);
  const edge = S.createBox([8190, 102.5, 100], [17, 5, 85], 0);
  S.stepMovingObject(edge, [10, 0, -200], terrain, null, null, 1);
  assert.deepEqual(edge.pos, [8, 102.5, 8092]);
});

test("a ramp is a wedge on its position, rising to its height at its front (+z) (14.19)", () => {
  const r = S.createRamp({ positionFt: [500, 100, 500], theta: 0, phi: 0, psi: 0, sizeFt: [40, 20, 10], mass: 0 })!;
  near(r.radius, Math.hypot(10, 10, 20));
  near(S.rampHeightAt(r, 500, 520)!, 110); // front edge
  near(S.rampHeightAt(r, 500, 480)!, 100); // back edge
  near(S.rampHeightAt(r, 505, 500)!, 105);
  assert.equal(S.rampHeightAt(r, 511, 500), null, "outside the width");
  // Turned by psi = 90 degrees, the front points along +x.
  const t = S.createRamp({ positionFt: [500, 100, 500], theta: 0, phi: 0, psi: Math.PI / 2, sizeFt: [40, 20, 10], mass: 0 })!;
  near(S.rampHeightAt(t, 520, 500)!, 110, 1e-9);
  near(S.rampHeightAt(t, 480, 500)!, 100, 1e-9);
});

test("listed ramps raise the ground's height but not its normal, first one wins", () => {
  const terrain = S.createTerrain(new Uint8Array(65536).fill(50));
  const ground = S.createTerrainGround(terrain, null, 0, null);
  const r = S.createRamp({ positionFt: [500, 100, 500], theta: 0, phi: 0, psi: 0, sizeFt: [40, 20, 10], mass: 0 })!;
  near(ground.height(500, 520), 100, 1e-9);
  ground.ramps.push(r);
  near(ground.height(500, 520), 110);
  const n: T3 = [0, 0, 0];
  ground.normal(500, 510, n);
  assert.deepEqual(n.map((v) => v + 0), [0, 1, 0]);
  ground.ramps.push(S.createRamp({ positionFt: [500, 50, 500], theta: 0, phi: 0, psi: 0, sizeFt: [40, 20, 10], mass: 0 })!);
  near(ground.height(500, 520), 110, 1e-9);
});

test("pushable force law: the box gets m_box * closing / dt, the truck the same opposite (14.17)", () => {
  const params = S.createTruckParams({ scrapePoints: scrapePoints() }, { difficulty: S.DIFFICULTY.INTERMEDIATE });
  const s = S.createTruckState([1000, 105, 1000], 0, S.GEAR.FIRST, params);
  for (let i = 0; i < 4; i++) S.tireGeometry(s, params, i);
  const dt = 1 / 60, v = 30;
  s.bvel[2] = v;
  s.prevPos.set([1000, 105, 1000 - v * dt]);
  // A wide 50 slug box whose back face the four front hull points (z 9.2) have just crossed.
  const box = S.createBox([1000, 105, 1000 + 9.2 - 0.25 + 5], [40, 10, 10], 50);
  S.collideTruckBox(s, params, box, dt);
  const F = Math.hypot(box.force[0], box.force[1], box.force[2]);
  near(F, 50 * v / dt, 1e-6 * F);
  near(Math.hypot(s.extForce[0], s.extForce[1], s.extForce[2]), F, 1e-6 * F);
});

/** BIGFOOT's hull points in the TRK's order (front bottom, front top, roof, rear top, rear bottom). */
const TRK_HULL: T3[] = [
  [-3.67, 0, 9.2], [3.67, 0, 9.2], [-3.67, 2.56, 9.2], [3.67, 2.56, 9.2],
  [-2.61, 5.23, 1.89], [2.61, 5.23, 1.89], [-2.14, 5.23, -0.8], [2.1, 5.23, -0.8],
  [-3.67, 2.82, -9.2], [3.67, 2.82, -9.2], [-3.67, 0, -9.2], [3.67, 0, -9.2],
];

test("a head-on hit between equal trucks ends with equal speeds (14.20)", () => {
  const terrain = S.createTerrain(new Uint8Array(65536).fill(50));
  const ground = S.createTerrainGround(terrain, null, 0, null);
  const make = (z: number, heading: number) => {
    const p = S.createTruckParams({ scrapePoints: TRK_HULL }, { difficulty: S.DIFFICULTY.INTERMEDIATE });
    return { s: S.createTruckState([1000, 106.2, z], heading, S.GEAR.NEUTRAL, p), p };
  };
  const a = make(1000, 0), b = make(1060, Math.PI);
  const ctx = { ground, human: false, difficulty: S.DIFFICULTY.INTERMEDIATE, sonicTrack: false };
  const dt = 1 / 60;
  const step = () => {
    for (const t of [a, b]) S.stepTruck(t.s, t.p, ctx, dt);
    S.collideTrucks(a, b, dt);
    for (const t of [a, b]) S.postStepTruck(t.s, t.p, ground, dt);
  };
  for (let i = 0; i < 60; i++) step();
  a.s.bvel[2] = 30; b.s.bvel[2] = 30;
  let met = false;
  for (let i = 0; i < 120; i++) {
    step();
    if (b.s.pos[2] - a.s.pos[2] < 19) met = true;
  }
  assert.ok(met, "they met");
  const v = (t: typeof a) => Math.hypot(...Array.from(t.s.bvel));
  assert.ok(b.s.pos[2] - a.s.pos[2] > 17, `no overlap: ${b.s.pos[2] - a.s.pos[2]} ft apart`);
  assert.ok(Math.abs(v(a) - v(b)) < 1, `speeds ${v(a)} and ${v(b)}`);
  assert.ok([...a.s.pos, ...b.s.pos].every(Number.isFinite));
});

test("box against box: a dropped box rests on an immovable one, and boxes stack (14.21)", () => {
  const terrain = S.createTerrain(new Uint8Array(65536).fill(50)); // 100 ft
  const ground = S.createTerrainGround(terrain, null, 0, null);
  const base = S.createBox([500, 105, 500], [20, 10, 20], 0); // top at 110
  const lower = S.createBox([500, 113, 500], [6, 4, 6], 10);
  const upper = S.createBox([500.5, 118, 500], [4, 4, 4], 5);
  lower.vel[1] = upper.vel[1] = -0.5;
  const boxes = [base, lower, upper];
  const dt = 1 / 60;
  for (let i = 0; i < 600; i++) {
    for (const b of boxes) S.stepBox(b, ground, dt);
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) S.collideBoxes(boxes[a], boxes[b], dt);
    for (const b of boxes) S.postStepBox(b, ground);
  }
  assert.ok(Math.abs(lower.pos[1] - 2 - 110) < 0.5, `lower box bottom at ${lower.pos[1] - 2}`);
  assert.ok(Math.abs(upper.pos[1] - 2 - (lower.pos[1] + 2)) < 0.5, `upper box bottom at ${upper.pos[1] - 2}, lower top ${lower.pos[1] + 2}`);
  assert.deepEqual(base.pos, [500, 105, 500], "the base never moves");
  // Two immovable boxes do nothing to each other.
  const a = S.createBox([0, 0, 0], [4, 4, 4], 0), b = S.createBox([1, 0, 0], [4, 4, 4], 0);
  S.collideBoxes(a, b, dt);
  assert.deepEqual(Array.from(a.depths), new Array(8).fill(-9999));
});

test("wheels against wheels: side by side, the tyres overlap and push the trucks apart where the hulls do not touch (14.20)", () => {
  const terrain = S.createTerrain(new Uint8Array(65536).fill(50));
  const ground = S.createTerrainGround(terrain, null, 0, null);
  const make = (x: number) => {
    const p = S.createTruckParams({ scrapePoints: TRK_HULL }, { difficulty: S.DIFFICULTY.INTERMEDIATE });
    return { s: S.createTruckState([x, 106.2, 1000], 0, S.GEAR.NEUTRAL, p), p };
  };
  const ctx = { ground, human: false, difficulty: S.DIFFICULTY.INTERMEDIATE, sonicTrack: false };
  const dt = 1 / 60;
  // Settle each truck alone, far apart, so the hubs and axles have their resting values.
  const a = make(1000), b = make(1100);
  for (let i = 0; i < 90; i++) for (const t of [a, b]) { S.stepTruck(t.s, t.p, ctx, dt); S.postStepTruck(t.s, t.p, ground, dt); }
  // b beside a, 9 ft to its right: its left tyres overlap a's right tyres by about 3 ft, the
  // hull boxes (+-3.67 ft) stay 1.7 ft apart. b moves towards a.
  b.s.pos[0] = a.s.pos[0] + 9;
  b.s.bvel[0] = -5;
  const gap0 = b.s.pos[0] - a.s.pos[0];
  S.collideTrucks(a, b, dt);
  assert.ok(b.s.pos[0] - a.s.pos[0] > gap0, `pushed apart: ${b.s.pos[0] - a.s.pos[0]} ft (was ${gap0})`);
  assert.ok(a.s.extForce[0] < 0 && b.s.extForce[0] > 0, `forces ${a.s.extForce[0]}, ${b.s.extForce[0]}`);
  // Without the overlap, nothing.
  const c = make(1200), d = make(1300);
  for (let i = 0; i < 90; i++) for (const t of [c, d]) { S.stepTruck(t.s, t.p, ctx, dt); S.postStepTruck(t.s, t.p, ground, dt); }
  d.s.pos[0] = c.s.pos[0] + 13;
  d.s.bvel[0] = -5;
  S.collideTrucks(c, d, dt);
  assert.equal(c.s.extForce[0], 0);
  assert.equal(d.s.pos[0] - c.s.pos[0], 13);
});
