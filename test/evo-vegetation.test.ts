// 4x4 Evolution's .TEX fields, .VEG sectors, .RTD shade, .SDW overlay, grass and generated trees
// (src/evo/vegetation.ts; OpenMTM2 docs/EVO2_EXE_ANALYSIS.md 2-4).

import test from "node:test";
import assert from "node:assert/strict";
import {
  EVO_GRASS_TUFTS, EVO_RTD_BYTES, EVO_SDW_NONE, EVO_TREES_PER_SECTOR, evoGenerateTrees, evoGrassCount, evoGrassIndex,
  evoGrassPattern, evoRand, evoShadeAt, evoTreeSlot, evoTreeYaw, parseEvoRtd, parseEvoSdw, parseEvoTex, parseEvoVeg,
} from "../src/index.ts";
import { latin1 } from "./fixtures/build.ts";

const text = (lines: string[]) => latin1(lines.join("\r\n"));

test("TEX: the first number is the surface value, the second the vegetation class", () => {
  const tex = parseEvoTex(text(["Version", "1", "c", "2,1", "603,3,A.RAW", "1204,0,B.RAW", "0,0,S.RAW"]), "X.TEX");
  assert.deepEqual(tex.ordinary.map((r) => [r.surfaceValue, r.vegClass]), [[603, 3], [1204, 0]]);
  // The old names stay, with the same numbers.
  assert.deepEqual(tex.ordinary.map((r) => [r.param0, r.param1]), [[603, 3], [1204, 0]]);
});

test("VEG: block b is the sector at x b % 16, z b / 16; trees keep their index in it", () => {
  const blocks: string[] = [];
  for (let b = 0; b < 256; b++) blocks.push("treeGrid", b === 1 ? "2" : "0", ...(b === 1 ? ["600,10,100,64", "700,10,200,255"] : []));
  const veg = parseEvoVeg(text(["Version", "6", "maxTrees", "9", "whackTrees", "1", ...blocks]), "X.VEG");
  assert.equal(veg.whackTrees, 1);
  assert.deepEqual(veg.trees.map((t) => [t.sector, t.index]), [[1, 0], [1, 1]]);
  assert.equal(veg.gridCount, 256);
});

test("VEG: the per-tree byte is the yaw in 1/256 turns; the slot is the index & 3", () => {
  assert.equal(evoTreeYaw(0), 0);
  assert.equal(evoTreeYaw(64), Math.PI / 2);
  assert.equal(evoTreeYaw(128), Math.PI);
  assert.deepEqual([0, 1, 2, 3, 4, 7, 99].map(evoTreeSlot), [0, 1, 2, 3, 0, 3, 3]);
});

test("rand(): the Watcom runtime's ANSI generator", () => {
  const r = evoRand(1);
  assert.deepEqual([r(), r(), r()], [16838, 5758, 10113]);
});

test("RTD: bit x8 + z8 * 1024, least significant bit first, repeating with the world", () => {
  assert.equal(parseEvoRtd(new Uint8Array(10)), null);
  const bytes = new Uint8Array(EVO_RTD_BYTES);
  const bit = 3 + 2 * 1024;
  bytes[bit >> 3] |= 1 << (bit & 7);
  const rtd = parseEvoRtd(bytes)!;
  assert.equal(evoShadeAt(rtd, 3 * 8 + 4, 2 * 8 + 1), true);
  assert.equal(evoShadeAt(rtd, 2 * 8 + 4, 2 * 8 + 1), false);
  assert.equal(evoShadeAt(rtd, 2 * 8 + 1, 3 * 8 + 4), false);
  assert.equal(evoShadeAt(rtd, 8192 + 3 * 8, 2 * 8), true);
});

test("SDW: 256 x 256 little-endian words", () => {
  assert.equal(parseEvoSdw(new Uint8Array(4)), null);
  const bytes = new Uint8Array(131072);
  bytes[0] = 0x00; bytes[1] = 0x80; bytes[2] = 0x34; bytes[3] = 0x02;
  const sdw = parseEvoSdw(bytes)!;
  assert.equal(sdw[0], EVO_SDW_NONE);
  assert.equal(sdw[1], 0x234);
});

test("grass: 2,048 tufts, offsets in the cell, sizes from the .VEG, slots 0..3", () => {
  const first = evoGrassPattern();
  assert.equal(first.x.length, EVO_GRASS_TUFTS);
  assert.ok(first.size.every((s) => s >= 2 && s <= 4));
  assert.ok(first.x.every((x) => x >= 0 && x <= 32) && first.z.every((z) => z >= 0 && z <= 32));
  // The seeded pass is the game's: the same every time.
  assert.deepEqual(Array.from(evoGrassPattern().x.slice(0, 8)), Array.from(first.x.slice(0, 8)));
  const sized = evoGrassPattern([{ min: 1, max: 5 }, { min: 2, max: 4 }, { min: 4, max: 5 }, { min: 2, max: 4 }]);
  for (let i = 0; i < EVO_GRASS_TUFTS; i++) {
    const lim = [[1, 5], [2, 4], [4, 5], [2, 4]][sized.slot[i]];
    assert.ok(sized.size[i] >= lim[0] && sized.size[i] <= lim[1]);
  }
  // Offsets do not change when the sizes are redrawn.
  assert.deepEqual(Array.from(sized.x), Array.from(first.x));
});

test("grass: 1 << class tufts a cell, four times as many at high detail, at most 32", () => {
  assert.deepEqual([0, 1, 2, 3].map((c) => evoGrassCount(c)), [0, 2, 4, 8]);
  assert.deepEqual([0, 1, 2, 3].map((c) => evoGrassCount(c, true)), [0, 8, 16, 32]);
  assert.equal(evoGrassIndex(5, 9, 10), 5 + 32 * 1 + 256 * 2);
});

test("generated trees: spacing per class, the tree line, the water, at most 100 a sector", () => {
  const input = {
    heightAt: (x: number) => (x < 1000 ? 5 : x > 7000 ? 900 : 50),
    vegClassAt: (_x: number, z: number) => (z < 4096 ? 3 : 1),
    waterLevelFt: 10,
    maxTrees: 30000,
    treeLine: 800,
    minDistanceSquared: { sparse: 400, medium: 100, dense: 25 },
    biasY: [-15, -12, -8, -15],
  };
  const trees = evoGenerateTrees(input, 7);
  assert.ok(trees.length > 0);
  assert.ok(trees.every((t) => t.x >= 1000 && t.x <= 7000), "none under water or above the tree line");
  const bySector = new Map<number, typeof trees>();
  for (const t of trees) bySector.set(t.sector, [...(bySector.get(t.sector) ?? []), t]);
  for (const [sector, list] of bySector) {
    assert.ok(list.length <= EVO_TREES_PER_SECTOR);
    const min2 = (sector >> 4) < 8 ? 25 : 400;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const d2 = (list[i].x - list[j].x) ** 2 + (list[i].z - list[j].z) ** 2;
        if ((list[i].z < 4096) === (list[j].z < 4096)) assert.ok(d2 >= (list[i].z < 4096 ? 25 : 400) - 1e-9, `sector ${sector} ${min2}`);
      }
    }
    // Sunk by treeBiasY * (1 - r) of the slot it was placed in.
    for (const t of list) assert.ok(t.y <= 50 && t.y >= 50 - 15);
  }
  assert.deepEqual(evoGenerateTrees(input, 7), trees);
});
