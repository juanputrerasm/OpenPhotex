import test from "node:test";
import assert from "node:assert/strict";
import { mtm2Sim as S } from "../src/index.ts";

const zone = S.createBox([100, 50, 100], [64, 92, 64], 0);
const summit = S.createBox([100, 40, 100], [128, 42, 128], 0);
const ZONE = [100, 50, 100], ON = [150, 40, 100], OFF = [400, 50, 100];

function run(summitState: S.Summit, positions: number[][], seconds: number, dt = 1 / 60) {
  for (let t = 0; t < seconds; t += dt) S.summitTick(summitState, positions, dt);
}

test("Summit Rumble: +10 per whole second in the zone, nothing on the summit, -1 per second outside", () => {
  const s = S.createSummit(3, zone, summit);
  run(s, [ZONE, ON, OFF], 10.5);
  assert.deepEqual(s.trucks.map((t) => t.state), [2, 1, 0]);
  assert.equal(s.trucks[0]!.score, 100);
  assert.equal(s.trucks[1]!.score, 0);
  assert.equal(s.trucks[2]!.score, -10);
});

test("Summit Rumble: leaving the summit costs 50 once per 2 s cooldown", () => {
  const s = S.createSummit(1, zone, summit);
  run(s, [ON], 0.1);
  S.summitTick(s, [OFF], 1 / 60);
  assert.equal(s.trucks[0]!.score, -50);
  assert.ok(Math.abs(s.trucks[0]!.cooldown - 2) < 1e-9);
  // Back on and off inside the cooldown costs nothing more.
  S.summitTick(s, [ON], 1 / 60);
  S.summitTick(s, [OFF], 1 / 60);
  assert.equal(s.trucks[0]!.score, -50);
  // After the cooldown it costs again.
  run(s, [ON], 2.1);
  S.summitTick(s, [OFF], 1 / 60);
  assert.equal(s.trucks[0]!.score, -100 - 0);
});

test("Summit Rumble: the boxes are tested without their angles, strictly inside the half extents", () => {
  const s = S.createSummit(1, zone, summit);
  S.summitTick(s, [[100 + 32, 50, 100]], 1 / 60);
  assert.equal(s.trucks[0]!.state, 1);
  S.summitTick(s, [[100 + 31.9, 50, 100]], 1 / 60);
  assert.equal(s.trucks[0]!.state, 2);
});
