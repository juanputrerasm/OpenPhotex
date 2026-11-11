/*
  Water under a tire (truck/object-support.ts): the game's in-water rule for the sounds (retail 0x41bbd0), and the
  host choice `dryOnObjects` (not the game's) that keeps a tire held up by an object off the terrain's water.
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

/** Flat ground, cement everywhere (100), with the track's water at `levelFt`. */
function ground(levelFt: number | null) {
  const terrain = S.createTerrain(new Uint8Array(65536).fill(50), levelFt);
  const surfaces = S.createSurfaceMap(new Uint16Array(65536), Int32Array.from([100]));
  return S.createTerrainGround(terrain, surfaces, 0, levelFt);
}

test("a tire held up by an object reads Default for water and deep water, and keeps any other value", () => {
  assert.equal(S.OBJECT_DRY_SURFACE, 0);
  assert.equal(S.objectSurfaceValue(1300), 0);
  assert.equal(S.objectSurfaceValue(300), 0);
  assert.equal(S.objectSurfaceValue(304), 0);
  for (const v of [100, 800, 1100, 1400, 0, -1, -2]) assert.equal(S.objectSurfaceValue(v), v);
});

test("what holds a tire up: anything but the terrain, or a ramp over the point", () => {
  const g = ground(null);
  for (const src of [0, 2, 3, 4]) assert.ok(S.tireOnObject({ supportSource: src }, g, 100, 100), `source ${src}`);
  assert.ok(!S.tireOnObject({ supportSource: 1 }, g, 100, 100));
  assert.ok(!S.tireOnObject({}, g, 100, 100));
  const ramp = S.createRamp({ positionFt: [100, 10, 100], sizeFt: [40, 20, 4], theta: 0, phi: 0, psi: 0, mass: 0 })!;
  g.ramps.push(ramp);
  assert.ok(S.tireOnObject({ supportSource: 1 }, g, 100, 100));
  assert.ok(!S.tireOnObject({ supportSource: 1 }, g, 1000, 1000));
});

test("stepTruck: with dryOnObjects a tire on an object over water grips as Default; on the terrain, or without the choice, as the game", () => {
  const g = ground(1000);
  const params = S.createTruckParams({ scrapePoints: scrapePoints() }, { difficulty: S.DIFFICULTY.INTERMEDIATE });
  const run = (dryOnObjects: boolean, source: number) => {
    const s = S.createTruckState([4000, 108, 4000], 0, S.GEAR.FIRST, params);
    for (const t of s.tires) { t.onGround = true; t.supportSource = source; }
    S.stepTruck(s, params, { ground: g, human: true, difficulty: S.DIFFICULTY.INTERMEDIATE, sonicTrack: false, dryOnObjects }, 1 / 60);
    return s.tires.map((t) => t.surface);
  };
  assert.deepEqual(run(false, 2), [1300, 1300, 1300, 1300]);
  assert.deepEqual(run(true, 1), [1300, 1300, 1300, 1300]);
  assert.deepEqual(run(true, 2), [0, 0, 0, 0]);
  assert.deepEqual(run(true, 3), [0, 0, 0, 0]);
});

test("in water for the sounds: a hub under the level at the hub, or a tire on the ground on water; never in Snow", () => {
  const params = S.createTruckParams({ scrapePoints: scrapePoints() }, { difficulty: S.DIFFICULTY.INTERMEDIATE });
  const s = S.createTruckState([4000, 100, 4000], 0, S.GEAR.FIRST, params);
  for (const t of s.tires) { t.hub = [0, -2, 0]; t.onGround = true; t.surface = 100; }
  const at = (levelFt: number | null) => ({ waterLevelFt: levelFt });
  assert.ok(!S.inWaterForSound(s, at(90)));
  assert.ok(!S.inWaterForSound(s, at(null)));
  // Hubs at 98 ft.
  assert.ok(S.inWaterForSound(s, at(99)));
  assert.ok(!S.inWaterForSound(s, at(97)));
  assert.ok(!S.inWaterForSound(s, at(99), 5));
  // A lake's level where it is, not the track's.
  assert.ok(S.inWaterForSound(s, { waterLevelFt: 50, waterLevelAt: () => 99 }));
  assert.ok(!S.inWaterForSound(s, { waterLevelFt: 99, waterLevelAt: () => 50 }));
  // A tire on the ground on water or deep water, whatever the level; off the ground it does not count.
  s.tires[2].surface = 1300;
  assert.ok(S.inWaterForSound(s, at(null)));
  s.tires[2].onGround = false;
  assert.ok(!S.inWaterForSound(s, at(null)));
  s.tires[1].surface = 300;
  assert.ok(S.inWaterForSound(s, at(null)));
  // Default (a tire on an object over water, with dryOnObjects) is dry.
  s.tires[1].surface = 0;
  assert.ok(!S.inWaterForSound(s, at(null)));
});
