/*
  MTM2 stuck trucks: reset, helicopter and flight (OpenMTM2 docs/MTM2_PHYSICS.md §10.3).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { mtm2Sim as S } from "../src/index.ts";

type T3 = [number, number, number];
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

function scrapePoints(): T3[] {
  const out: T3[] = [];
  for (const z of [9.2, -9.2]) for (const x of [-3.67, 3.67]) for (const y of [0, 2.56, -1]) out.push([x, y, z]);
  return out;
}

// Flat ground at 100 ft.
function setup() {
  const terrain = S.createTerrain(new Uint8Array(65536).fill(50));
  const ground = S.createTerrainGround(terrain, null, 0, null);
  const params = S.createTruckParams({ scrapePoints: scrapePoints() }, { difficulty: S.DIFFICULTY.INTERMEDIATE });
  return { ground, params };
}

const straight = (start: T3, end: T3): S.CourseSegment => ({
  ctype: 1, cspeedType: 0, start, end, decPoint: 20, speed: 50, speedLimit: 0, trackWidth: 40, lastEntry: false,
});

function run(
  state: S.Mtm2TruckState, params: S.Mtm2TruckParams, ground: S.Mtm2Ground, recovery: S.RecoveryContext,
  seconds: number, onStep?: (t: number) => void,
) {
  const ctx = { ground, human: true, difficulty: S.DIFFICULTY.INTERMEDIATE, sonicTrack: false, recovery };
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    S.stepTruck(state, params, ctx, dt);
    S.postStepTruck(state, params, ground, dt);
    onStep?.(i * dt);
  }
}

test("a flipped player truck is reset once it comes to rest: lifted 10 ft, levelled, facing the segment end", () => {
  const { ground, params } = setup();
  const state = S.createTruckState([1000, 106, 1000], 0, S.GEAR.FIRST, params);
  state.euler[1] = Math.PI; // on its roof
  const segment = straight([900, 100, 900], [1000, 100, 1500]);
  const rc: S.RecoveryContext = {
    racing: true, player: true, autopilot: false, difficulty: 1, summit: false, segment, previous: null,
  };
  // The reset shows as a jump of about 10 ft in one step.
  let resetAt = -1, yBefore = state.pos[1], minTimer = 0;
  run(state, params, ground, rc, 9, (t) => {
    minTimer = Math.min(minTimer, state.heliTimer);
    if (resetAt < 0 && state.pos[1] - yBefore > 8) resetAt = t;
    yBefore = state.pos[1];
  });
  // It settles on its roof within a second or so, and the at-rest check resets it.
  assert.ok(resetAt > 0.3 && resetAt < 3, `reset at ${resetAt}`);
  assert.ok(minTimer < 0, `timer reached ${minTimer}`);
  assert.ok(Math.abs(Math.cos(state.euler[1])) > 0.9, "upright");
  // Facing (1000, 1500) from about (1000, 1000): heading near 0.
  assert.ok(Math.abs(S.wrapPi(state.euler[2])) < 0.1, `heading ${state.euler[2]}`);
  // Not racing: no reset.
  const idle = S.createTruckState([1000, 106, 1000], 0, S.GEAR.FIRST, params);
  idle.euler[1] = Math.PI;
  run(idle, params, ground, { ...rc, racing: false }, 8);
  assert.ok(Math.abs(Math.cos(idle.euler[1])) > 0.9 && Math.cos(idle.euler[1]) < 0, "still on its roof");
});

test("the Helicopter key lifts, carries for 10 s and sets the truck down at the segment start", () => {
  const { ground, params } = setup();
  const state = S.createTruckState([1000, 102.5, 1000], 1, S.GEAR.FIRST, params);
  const segment = straight([1100, 100, 1050], [1100, 100, 1550]);
  const rc: S.RecoveryContext = {
    racing: true, player: true, autopilot: false, difficulty: 1, summit: false, segment, previous: null,
  };
  run(state, params, ground, rc, 5);
  const restY = state.pos[1];
  S.pressHelicopterKey(state, { dragRace: false, summit: false });
  assert.equal(state.heliTimer, -15);
  run(state, params, ground, rc, 1 / 60);
  assert.ok(state.heliTimer > 14.9 && state.heliTimer <= 15, `timer ${state.heliTimer}`);
  const start = [state.pos[0], state.pos[2]];
  // Five seconds of the helicopter flying in: the truck waits.
  run(state, params, ground, rc, 4.9);
  near(state.pos[0], start[0]); near(state.pos[2], start[1]);
  let maxHover = 0;
  run(state, params, ground, rc, 10.2, () => { maxHover = Math.max(maxHover, state.pos[1] - 100); });
  assert.ok(maxHover > 25, `hover ${maxHover}`);
  near(state.pos[0], 1100, 0.2); near(state.pos[2], 1050, 0.2);
  near(S.wrapPi(state.euler[2]), 0, 0.01);
  // Released: it falls and lands.
  assert.equal(state.heliTimer, 0);
  run(state, params, ground, rc, 4);
  // Back at ride height, within the 0.25 ft contact skin the at-rest freeze allows.
  near(state.pos[1], restY, 0.3);
});

test("pressing the key in flight drops the truck; a queue adds 5 s per truck", () => {
  const { ground, params } = setup();
  const state = S.createTruckState([1000, 102.5, 1000], 0, S.GEAR.FIRST, params);
  const rc: S.RecoveryContext = {
    racing: true, player: true, autopilot: false, difficulty: 1, summit: true, segment: null, previous: null,
    othersInFlight: 2,
  };
  S.pressHelicopterKey(state, { dragRace: false, summit: false });
  run(state, params, ground, rc, 1 / 60);
  assert.ok(state.heliTimer > 24.9, `timer ${state.heliTimer}`);
  S.pressHelicopterKey(state, { dragRace: false, summit: false });
  assert.equal(state.heliTimer, 0);
  // Not in a drag race.
  S.pressHelicopterKey(state, { dragRace: true, summit: false });
  assert.equal(state.heliTimer, 0);
});

test("a slow CPU truck counts down and the helicopter comes after 5 s", () => {
  const { ground, params } = setup();
  const state = S.createTruckState([1000, 102.5, 1000], 0, S.GEAR.FIRST, params);
  const rc: S.RecoveryContext = {
    racing: true, player: false, autopilot: true, difficulty: 1, summit: false,
    segment: straight([900, 100, 900], [900, 100, 1400]), previous: null,
  };
  let liftedAt = -1;
  run(state, params, ground, rc, 7, (t) => { if (liftedAt < 0 && state.heliTimer > 0) liftedAt = t; });
  assert.ok(liftedAt > 4.9 && liftedAt < 5.2, `lifted at ${liftedAt}`);
});

test("a CPU truck at rest is neither reset nor lifted before the race runs (the countdown), on any difficulty", () => {
  for (const difficulty of [0, 1, 2]) {
    const { ground, params } = setup();
    const state = S.createTruckState([1000, 102.5, 1000], 0, S.GEAR.PARK, params);
    const rc: S.RecoveryContext = {
      racing: false, player: false, autopilot: true, difficulty, summit: false,
      segment: straight([900, 100, 900], [900, 100, 1400]), previous: null,
    };
    run(state, params, ground, rc, 8);
    assert.equal(state.heliTimer, 0, `difficulty ${difficulty}`);
    assert.ok(Math.abs(state.pos[0] - 1000) < 1 && Math.abs(state.pos[2] - 1000) < 1, `difficulty ${difficulty}`);
  }
});

test("truck radius reaches the front right tire's outer edge", () => {
  const { params } = setup();
  const hub = params.hubs[0];
  near(S.truckRadius(params), Math.hypot(Math.abs(hub[0]) + params.tireWidthFt / 2, hub[2] + params.tireRadiusFt));
});

test("the player's stuck timer: counts while lying on the hull, resets past -5 s, recovers on the wheels", () => {
  const { ground, params } = setup();
  const state = S.createTruckState([1000, 110, 1000], 0, S.GEAR.FIRST, params);
  const rc: S.RecoveryContext = {
    racing: true, player: true, autopilot: false, difficulty: 1, summit: false, segment: null, previous: null,
  };
  for (const t of state.tires) t.onGround = false;
  for (let i = 0; i < 299; i++) assert.equal(S.updateStuck(state, params, ground, rc, 3, 2, false, 1 / 60), null);
  assert.ok(state.heliTimer < -4.9 && state.heliTimer > -5);
  assert.equal(S.updateStuck(state, params, ground, rc, 3, 2, false, 1 / 60), null);
  assert.equal(S.updateStuck(state, params, ground, rc, 3, 2, false, 1 / 60), "reset");
  near(state.pos[1], 120);
  assert.equal(state.heliTimer, 0);
  // A wheel down counts it back up.
  state.heliTimer = -3;
  state.tires[0].onGround = true;
  S.updateStuck(state, params, ground, rc, 3, 2, false, 0.5);
  near(state.heliTimer, -2.5);
});
