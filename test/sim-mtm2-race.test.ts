/*
  Race rules (OpenMTM2 docs/MTM2_PHYSICS.md §14.24).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { mtm2Sim as S } from "../src/index.ts";

type T3 = [number, number, number];
const HULL: T3[] = [
  [-3.67, 0, 9.2], [3.67, 0, 9.2], [-3.67, 2.56, 9.2], [3.67, 2.56, 9.2],
  [-2.61, 5.23, 1.89], [2.61, 5.23, 1.89], [-2.14, 5.23, -0.8], [2.1, 5.23, -0.8],
  [-3.67, 2.82, -9.2], [3.67, 2.82, -9.2], [-3.67, 0, -9.2], [3.67, 0, -9.2],
];
const params = () => S.createTruckParams({ scrapePoints: HULL }, { difficulty: S.DIFFICULTY.INTERMEDIATE });

/** One checkpoint across +z at z = 1100: a 40 ft gate, the detector three times as wide. */
function oneCheckpoint() {
  return S.raceCheckpoints(S.buildCheckpoints([{ type: 6, positionFt: [1000, 110, 1100], sizeFt: [4, 40, 20], theta: 0, phi: 0, psi: 0 }]));
}

/** A truck that last step was `back` ft behind (z) where it is now, moving along `dir`. */
function truckAt(x: number, z: number, vz: number) {
  const p = params();
  const s = S.createTruckState([x, 106, z], vz >= 0 ? 0 : Math.PI, S.GEAR.FIRST, p);
  s.bvel[2] = Math.abs(vz);
  return { s, p };
}

test("a checkpoint counts when the truck crosses detector and gate forwards; beside the gate it is a miss", () => {
  const cps = oneCheckpoint();
  const dt = 1 / 60;
  // Through the gate: hull point 1 (z 9.2) just crossed the back face (z 1098).
  const through = truckAt(1000, 1098 - 9.2 + 0.4, 30);
  const race = S.createRace([through], cps, [], 1, 1);
  race.clock = 5;
  assert.equal(S.testCheckpoint(race, race.trucks[0], dt), 2);
  assert.equal(race.trucks[0].checkpoint, 0, "back to the first checkpoint");
  assert.equal(race.trucks[0].laps, 1, "one checkpoint: a lap");
  // Beside the gate, inside the detector (three times as wide): a miss.
  const beside = truckAt(1030, 1098 - 9.2 + 0.4, 30);
  const r2 = S.createRace([beside], cps, [], 1, 1);
  r2.clock = 5;
  assert.equal(S.testCheckpoint(r2, r2.trucks[0], dt), 3);
  assert.equal(r2.trucks[0].laps, 0);
  // Backwards through it: nothing.
  const back = truckAt(1000, 1098 + 20 + 9.2 - 0.4, -30);
  const r3 = S.createRace([back], cps, [], 1, 1);
  r3.clock = 5;
  assert.equal(S.testCheckpoint(r3, r3.trucks[0], dt), 0);
});

test("the split is the moment of crossing: clock - start - depth / speed", () => {
  const cps = oneCheckpoint();
  const t = truckAt(1000, 1098 - 9.2 + 0.5, 30);
  const race = S.createRace([t], cps, [], 3, 1);
  race.clock = 10;
  S.testCheckpoint(race, race.trucks[0], 1 / 60);
  const lap = race.trucks[0].lapTimes[0];
  assert.ok(Math.abs(lap - (10 - S.COUNTDOWN_S - 0.5 / 30)) < 1e-9, `lap ${lap}`);
});

test("the race is over when the first truck completes the laps; the others finish their current lap", () => {
  const cps = oneCheckpoint();
  const a = truckAt(1000, 1000, 0), b = truckAt(1000, 1000, 0);
  const race = S.createRace([a, b], cps, [], 3, 1);
  const [ta, tb] = race.trucks;
  tb.laps = 1;
  ta.laps = 2;
  // a closes its third lap.
  ta.checkpoint = 0;
  const leader = truckAt(1000, 1098 - 9.2 + 0.4, 30);
  ta.s = leader.s;
  race.clock = 100;
  S.testCheckpoint(race, ta, 1 / 60);
  assert.equal(ta.laps, 3);
  assert.ok(race.over && ta.finished);
  assert.equal(tb.finishLap, 2, "b finishes at the end of its current (second) lap");
});

test("the order: more checkpoints, then segments, then progress; finished trucks by race time", () => {
  const race = S.createRace([truckAt(0, 0, 0), truckAt(0, 0, 0), truckAt(0, 0, 0)], oneCheckpoint(), [], 2, 1);
  const [a, b, c] = race.trucks;
  a.passed = 3; b.passed = 4; c.passed = 4;
  b.s.ap.segmentsPassed = 7; c.s.ap.segmentsPassed = 7;
  b.progress = 0.2; c.progress = 0.6;
  S.raceOrder(race);
  assert.deepEqual(race.trucks.map((t) => t.place), [3, 2, 1]);
  a.laps = 2; a.raceTime = 90; b.laps = 2; b.raceTime = 80;
  S.raceOrder(race);
  assert.deepEqual(race.trucks.map((t) => t.place), [2, 1, 3]);
});
