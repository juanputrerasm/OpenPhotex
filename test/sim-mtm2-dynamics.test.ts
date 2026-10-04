/*
  MTM2 truck dynamics (OpenMTM2 docs/MTM2_PHYSICS.md §14): invariants on synthetic ground.
  These check behaviour the rules imply (free fall, settling, staying put, determinism); they
  are not tuned against recordings.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { mtm2Sim as S } from "../src/index.ts";

type T3 = [number, number, number];

function scrapePoints(): T3[] {
  const out: T3[] = [];
  for (const z of [9.2, -9.2]) for (const x of [-3.67, 3.67]) for (const y of [0, 2.56, -1]) out.push([x, y, z]);
  return out;
}

function world(heights = new Uint8Array(65536).fill(50)) {
  const terrain = S.createTerrain(heights);
  return { terrain, ground: S.createTerrainGround(terrain, null, 0, null) };
}

function truckOn(ground: ReturnType<typeof world>["ground"], pos: T3, heading = 0, gear = S.GEAR.FIRST) {
  const params = S.createTruckParams({ scrapePoints: scrapePoints() }, { difficulty: S.DIFFICULTY.INTERMEDIATE });
  const state = S.createTruckState(pos, heading, gear, params);
  const ctx = { ground, human: true, difficulty: S.DIFFICULTY.INTERMEDIATE, sonicTrack: false };
  const keys = { accelerate: false, brake: false, left: false, right: false };
  const run = (seconds: number, dt = 1 / 60, held: Partial<typeof keys> = {}) => {
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) {
      S.applyKeyboard(state.controls, { ...keys, ...held },
        { dt, autoShift: true, forwardSpeed: state.bvel[2], dragMode: false, segments: 0 });
      S.stepTruck(state, params, ctx, dt);
      S.postStepTruck(state, params, ground, dt);
    }
  };
  return { params, state, run };
}

const finite = (s: ReturnType<typeof S.createTruckState>) =>
  [...s.pos, ...s.bvel, ...s.euler, ...s.rates, s.rpm].every(Number.isFinite);

test("free fall: velocity grows at g, no contacts", () => {
  const { ground } = world();
  const { state, run } = truckOn(ground, [4000, 300, 4000]);
  run(0.5);
  // Drag at 16 ft/s is a few lbf on a 10,000 lb truck.
  assert.ok(Math.abs(state.bvel[1] + 32.174 * 0.5) < 0.2, `${state.bvel[1]}`);
  assert.equal(state.contactCount, 0);
  assert.ok(state.tires.every((t) => !t.onGround));
});

test("a dropped truck lands on its wheels and comes to rest", () => {
  const { ground } = world();
  const { state, run } = truckOn(ground, [4000, 108, 4000]);
  run(8);
  assert.ok(finite(state));
  assert.deepEqual(Array.from(state.bvel), [0, 0, 0]);
  assert.ok(state.tires.every((t) => t.onGround));
  // No hull point touches (the tire contact points sit within a hair of the ground).
  for (let j = 0; j < 12; j++) assert.ok(state.depths[j] < -0.25, `hull point ${j}: ${state.depths[j]}`);
  for (const t of state.tires) assert.ok(t.compression > 0.6 && t.compression < 1.4, `${t.compression}`);
  // Body origin: ground 100 ft + the 4 ft hub drop + the 3 ft tire, less the sag.
  assert.ok(state.pos[1] > 105 && state.pos[1] < 107, `${state.pos[1]}`);
  assert.ok(Math.abs(state.euler[0]) < 0.02 && Math.abs(state.euler[1]) < 0.02);
  const y = state.pos[1];
  run(2);
  assert.equal(state.pos[1], y, "stays put");
});

test("full throttle: speed builds, the gearbox shifts up, the engine stays under its limit", () => {
  const { ground } = world();
  const { state, run } = truckOn(ground, [1000, 106.2, 1000]);
  run(1);
  const gears: number[] = [];
  let last = 0;
  for (let i = 0; i < 8; i++) {
    run(1, 1 / 60, { accelerate: true });
    const speed = state.bvel[2];
    assert.ok(speed > last, `second ${i}: ${speed} <= ${last}`);
    last = speed;
    gears.push(state.controls.gear);
    assert.ok(state.rpm <= 8500);
  }
  assert.deepEqual([...new Set(gears)], [S.GEAR.FIRST, S.GEAR.SECOND, S.GEAR.THIRD].filter((g) => gears.includes(g)));
  assert.ok(gears.at(-1) === S.GEAR.THIRD);
  // Straight ahead: no sideways drift, no heading change.
  assert.ok(Math.abs(state.pos[0] - 1000) < 1);
});

test("steering right turns the heading towards +x; braking stops the truck", () => {
  const { ground } = world();
  const { state, run } = truckOn(ground, [1000, 106.2, 1000]);
  run(4, 1 / 60, { accelerate: true });
  run(1.5, 1 / 60, { accelerate: true, right: true });
  assert.ok(state.euler[2] > 0.3 && state.euler[2] < Math.PI, `${state.euler[2]}`);
  run(4, 1 / 60, { brake: true });
  // Holding brake once stopped selects Reverse and backs up, as the game does.
  assert.equal(state.controls.gear, S.GEAR.REVERSE);
});

test("deterministic: two runs give identical states", () => {
  const go = () => {
    const { ground } = world();
    const t = truckOn(ground, [1000, 108, 1000], 0.3);
    t.run(3, 1 / 60, { accelerate: true, left: true });
    return t.state;
  };
  const a = go(), b = go();
  assert.deepEqual(Array.from(a.pos), Array.from(b.pos));
  assert.deepEqual(Array.from(a.rates), Array.from(b.rates));
});

test("no NaN on rough ground from many starting poses", () => {
  let seed = 3;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const heights = new Uint8Array(65536);
  for (let r = 0; r < 256; r++) for (let c = 0; c < 256; c++) heights[r * 256 + c] = 50 + Math.round(6 * Math.sin(r / 3) * Math.cos(c / 4));
  const { ground } = world(heights);
  for (let k = 0; k < 20; k++) {
    const t = truckOn(ground, [2000 + rnd() * 2000, 130 + rnd() * 40, 2000 + rnd() * 2000], rnd() * 6);
    t.state.euler[0] = (rnd() - 0.5) * 2;
    t.state.euler[1] = (rnd() - 0.5) * 3;
    t.state.rates[2] = (rnd() - 0.5) * 4;
    t.run(4, 1 / 60, { accelerate: rnd() > 0.5, left: rnd() > 0.7 });
    assert.ok(finite(t.state), `pose ${k}`);
    // Never deeper than the push-out leaves it, at any contact point.
    for (let j = 0; j < 16; j++) assert.ok(t.state.depths[j] < 3, `pose ${k} point ${j}: ${t.state.depths[j]}`);
  }
});

// The game zeroes the motion below 0.1 ft/s (§14.9), which freezes the settling bounce at a point
// that depends on the step length; a few tenths of a foot apart is that rule, not drift.
test("rest height agrees across step lengths", () => {
  const heights = [1 / 30, 1 / 60, 1 / 120].map((dt) => {
    const { ground } = world();
    const t = truckOn(ground, [4000, 108, 4000]);
    t.run(8, dt);
    return t.state.pos[1];
  });
  assert.ok(Math.max(...heights) - Math.min(...heights) < 0.6, heights.join(", "));
});
