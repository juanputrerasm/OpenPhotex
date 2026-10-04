/*
  MTM2 ground surfaces and water (OpenMTM2 docs/MTM2_PHYSICS.md §2.3, §2.4), hand-computed.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { createTerrain } from "../src/sim/mtm2/world/terrain.ts";
import {
  createSurfaceMap, cutFactor, surfaceDragDensity, surfaceMu, surfaceSinkFt, surfaceType,
  terrainSurfaceValue, textureTypeValues, tireMu,
} from "../src/sim/mtm2/world/surface.ts";
import { fixedSin, waterLevelFt } from "../src/sim/mtm2/world/water.ts";
import { WEATHER } from "../src/sim/mtm2/constants.ts";

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test("texture types: matched by name, last entry wins, unmatched 0, empty TTY all dirt", () => {
  const names = ["GRASS", "road", "MUD", "road"];
  const values = textureTypeValues(names, [
    { name: "ROAD", value: 100 }, { name: "GRASS", value: 600 }, { name: "ROAD", value: 112 },
    { name: "NOTHERE", value: 900 },
  ]);
  // The second "road" is never matched: entries attach to the first texture of a name.
  assert.deepEqual([...values], [600, 112, 0, 0]);
  assert.deepEqual([...textureTypeValues(names, [])], [200, 200, 200, 200]);
});

function level(heightStep: number, clrWord: number) {
  const terrain = createTerrain(new Uint8Array(65536).fill(heightStep));
  const clr = new Uint16Array(65536).fill(clrWord);
  return { terrain, clr };
}

test("terrain surface: the cell's CLR texture, then water at or below the level", () => {
  const { terrain, clr } = level(5, 0xc001); // 10 ft; texture 1, rotation bits set
  clr[3 * 256 + 7] = 2;
  const map = createSurfaceMap(clr, new Int32Array([100, 712, 300]));
  assert.equal(terrainSurfaceValue(terrain, map, 1, 1, null), 712);
  assert.equal(terrainSurfaceValue(terrain, map, 7 * 32 + 1, 3 * 32 + 1, null), 300);
  assert.equal(terrainSurfaceValue(terrain, map, 1, 1, 9.5), 712);
  assert.equal(terrainSurfaceValue(terrain, map, 1, 1, 10), 1300);
  assert.equal(terrainSurfaceValue(terrain, map, 1, 1, 12, true), 800);
  // No water: ground at exactly 0 ft still reads deep water, as in the game.
  const flat = level(0, 1);
  assert.equal(terrainSurfaceValue(flat.terrain, createSurfaceMap(flat.clr, new Int32Array([0, 200])), 5, 5, null), 1300);
  // A texture past the table reads 0.
  const far = level(5, 40);
  assert.equal(terrainSurfaceValue(far.terrain, createSurfaceMap(far.clr, new Int32Array(2)), 5, 5, null), 0);
});

test("type, sink depth, mu, drag density", () => {
  assert.equal(surfaceType(712), 7);
  near(surfaceSinkFt(712), 1);
  near(surfaceSinkFt(406), 0.5);
  const mu = [1, 1, 0.9, 0.4, 0.4, 0.7, 0.7, 0.6, 0.2, 0.3, 0.8, 0.8, 0.6, 0.4, 1, 1];
  mu.forEach((m, type) => assert.equal(surfaceMu(type), m, `type ${type}`));
  assert.equal(surfaceDragDensity(3), 0.15);
  assert.equal(surfaceDragDensity(13), 0.15);
  assert.equal(surfaceDragDensity(4), 0.002377);
});

test("tire mu = cut factor x 1.75 x mu x weather, for every type", () => {
  const cuts: [number, number, number][] = [
    [1, 1, 1], [1, 0.9, 0.8], [0.9, 1, 0.9], [0.8, 0.9, 1], [0.8, 0.9, 1], [0.8, 0.9, 1], [0.9, 1, 0.9],
    [0.8, 0.9, 1], [0.6, 0.8, 1], [0.6, 0.8, 1], [0.9, 1, 0.9], [0.9, 1, 0.9], [0.8, 0.9, 1], [1, 1, 1],
  ];
  cuts.forEach((row, type) => row.forEach((f, cut) => {
    assert.equal(cutFactor(type, cut), f);
    near(tireMu(type, cut, WEATHER.CLEAR), f * 1.75 * surfaceMu(type));
  }));
  near(tireMu(1, 0, WEATHER.RAIN), 1.75 * 0.8);
  near(tireMu(8, 2, WEATHER.SNOW), 1.75 * 0.2 * 0.6);
  near(tireMu(2, 1, WEATHER.CLEAR, 2), 2 * 0.9);
});

test("the game's fixed-point sine", () => {
  assert.equal(fixedSin(0), 0);
  assert.equal(fixedSin(0x4000), 65536);
  assert.equal(fixedSin(0xc000), -65536);
  assert.equal(fixedSin(0x100), Math.trunc(Math.sin(0.02454369260546875) * 65536));
  // Halfway between table entries 0 and 1.
  assert.equal(fixedSin(0x80), Math.trunc(Math.trunc(Math.sin(0.02454369260546875) * 65536) / 2));
});

test("water level: steps of 2 ft, bobbing 1 ft over 8 s, still in snow, none at 0", () => {
  assert.equal(waterLevelFt(0, 3), null);
  assert.equal(waterLevelFt(null), null);
  near(waterLevelFt(10, 0)!, 20);
  near(waterLevelFt(10, 2)!, 21);
  near(waterLevelFt(10, 4)!, 20);
  near(waterLevelFt(10, 6)!, 19);
  near(waterLevelFt(10, 8)!, 20);
  near(waterLevelFt(10, 6, true)!, 20);
  // Between peaks the wave is truncated to 1/64 ft.
  const l = waterLevelFt(10, 1)!;
  near(l * 64, Math.round(l * 64));
  near(l, 20 + Math.SQRT1_2, 1 / 32);
});
