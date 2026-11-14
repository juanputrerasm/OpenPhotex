/*
  .WFL version 2 and the waterfall build on a track format version 6 world (the specification's section 9.3): the
  header's N x N, i32 crest heights in the terrain's range, crest points below 16 W, the wrap at W, the N x N lake map,
  and the walk on the 32-bit h128 heights.
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseWfl, writeWfl, wflFallFitsV1, readFallFile, checkFallRecords, validateFall, buildFallMeshes, fallGround, fallWater,
  fallHeightRange, fallMist, fallSound, type WflFall, type WflWriteFall,
} from "../src/index.ts";

const wf = (pts: Array<[number, number]>, height: number, source = 0): WflWriteFall => ({
  source, flags: 6, speed: 96, height, points: pts.map(([x, z]) => ({ x: x * 16, z: z * 16 })), opacity: 100, mist: 100, volume: 100,
  soundName: "ROAR", textureName: "",
});
const asRecord = (f: WflWriteFall, id = 1): WflFall => ({
  id, source: f.source, flags: f.flags, freeze: false, splash: true, sound: true, speed: f.speed, speedFtPerSec: f.speed / 16,
  height: f.height, heightFt: f.height / 2, points: f.points.map((p) => ({ ...p })), opacity: 100, mist: 100, volume: 100,
  mistDepth: 100, mistHeight: 100, soundName: f.soundName ?? "", textureName: "",
});

test("WFL v2: a 512 world's header, i32 heights and points beyond 8,192 ft round-trip", () => {
  const falls = [wf([[12000, 9000], [12040, 9000]], 2900), wf([[100, 100], [130, 100]], -20)];
  const bytes = writeWfl(falls, { cells: 512 });
  assert.deepEqual([bytes[4], bytes[5], bytes[16] | (bytes[17] << 8), bytes[18] | (bytes[19] << 8)], [2, 0, 512, 512]);
  const w = parseWfl(bytes, { cells: 512 });
  assert.deepEqual([w.major, w.cells, w.falls.length], [2, 512, 2]);
  assert.equal(w.falls[0]!.heightFt, 1450);
  assert.equal(w.falls[1]!.height, -20, "i32");
  assert.deepEqual(w.falls[0]!.points[0], { x: 192000, z: 144000 });
  assert.throws(() => parseWfl(bytes, { cells: 256 }), /another terrain size/);
  assert.throws(() => writeWfl([wf([[16384, 0], [16300, 0]], 10)], { cells: 512 }), /outside a 512-cell world/);
});

test("WFL: the world's size picks the version, 256 cells version 1, 512 cells version 2", () => {
  const low = [wf([[100, 100], [130, 100]], 200)];
  assert.equal(writeWfl(low)[4], 1);
  assert.equal(writeWfl(low, { cells: 256 })[4], 1);
  assert.equal(writeWfl(low, { cells: 512 })[4], 2);
  assert.throws(() => writeWfl([wf([[100, 100], [130, 100]], 5000)], { cells: 256 }), /256-cell world's falls/, "a 256-cell world's fall above 2,048 ft");
  assert.ok(wflFallFitsV1({ height: 4096 }) && !wflFallFitsV1({ height: 4097 }) && !wflFallFitsV1({ height: -1 }));
  assert.throws(() => parseWfl(writeWfl(low), { cells: 512 }), /another terrain size/, "a version 1 file on a 512 world");
  // A version 2 header on a 256 world is refused.
  const v2at256 = writeWfl(low);
  v2at256[4] = 2;
  assert.throws(() => parseWfl(v2at256), /another terrain size/);
});

test("readFallFile: major 2 is read at the world's size, another size is status 6", () => {
  const v2 = writeWfl([wf([[12000, 9000], [12040, 9000]], 2900)], { cells: 512 });
  const f = readFallFile(v2, { cells: 512 });
  assert.deepEqual([f.status, f.major, f.falls[0]!.height], [0, 2, 2900]);
  assert.equal(readFallFile(v2).status, 6, "a 256 world");
  assert.equal(readFallFile(writeWfl([wf([[100, 100], [130, 100]], 200)]), { cells: 512 }).status, 6, "version 1 on a 512 world");
  const v2at256 = writeWfl([wf([[100, 100], [130, 100]], 200)]);
  v2at256[4] = 2;
  assert.equal(readFallFile(v2at256).status, 6, "version 2 on a 256 world");
});

test("fallHeightRange and the record checks on a 512 world", () => {
  assert.deepEqual(fallHeightRange(1), { min: 1, max: 4096 });
  assert.deepEqual(fallHeightRange(2, { step: 32, base: 88 }), { min: 177, max: 4272 });
  const heightRange = fallHeightRange(2, { step: 32, base: 88 });
  const ok = asRecord(wf([[16000, 9000], [16040, 9000]], 4000), 1);
  const tooHigh = asRecord(wf([[1000, 1000], [1040, 1000]], 4273), 2);
  const below = asRecord(wf([[1000, 1000], [1040, 1000]], 176), 3);
  const far = { ...asRecord(wf([[1000, 1000], [1040, 1000]], 400), 4), points: [{ x: 16384 * 16, z: 0 }, { x: 16, z: 0 }] };
  const c = checkFallRecords([ok, tooHigh, below, far], { cells: 512, heightRange });
  assert.deepEqual(c.accepted.map((a) => a.index), [0]);
  assert.deepEqual(c.rejected.map((r) => r.reason), ["badHeight", "badHeight", "badCoord"]);
  assert.equal(checkFallRecords([ok]).rejected[0]!.reason, "badCoord", "16,000 ft is outside a 256 world");
});

test("validateFall wraps at W and reads the N x N lake map", () => {
  const N = 512, map = new Uint8Array(N * N);
  // Lake 1 fills tiles x 500..511 and 0..3, z 100..110: the crest runs along z = 3200 across the wrap at 16,384 ft.
  for (let z = 100; z <= 110; z++) for (const x of [500, 501, 502, 503, 504, 505, 506, 507, 508, 509, 510, 511, 0, 1, 2, 3]) map[z * N + x] = 1;
  // Crest from x 16,370 to x 20, 34 ft the short way across the wrap; flow dir (dz, -dx) = (0, -1), so the source
  // lake lies at larger z: the crest is the lake's bottom edge z = 100 * 32 = 3,200 ft.
  const crest = asRecord(wf([[16370, 3200], [20, 3200]], 900, 1));
  assert.equal(validateFall(crest, { cells: N, tileMap: map, lakes: [{ id: 1, height: 900 }] }), null);
  assert.equal(validateFall(crest, { cells: N, tileMap: new Uint8Array(N * N), lakes: [{ id: 1, height: 900 }] }), "FALL_DIRECTION");
  // 8,180 to 20 ft: 32 ft across a 256 world's wrap, 8,160 ft (too wide) in a 512 world.
  const wide = asRecord(wf([[8180, 100], [20, 100]], 900));
  assert.equal(validateFall(wide, { cells: 256 }), null);
  assert.equal(validateFall(wide, { cells: N }), "FALL_WIDTH");
});

test("a fall on a 512 world: h128 ground, the N x N water, wrap and mist at W", () => {
  const N = 512, fine = 4 * N;
  // A shelf at 1,500 ft north of z = 12,000 ft dropping to 1,300 ft, h128 on the 8 ft grid.
  const h = new Int32Array(fine * fine);
  for (let z = 0; z < fine; z++) for (let x = 0; x < fine; x++) h[z * fine + x] = (z * 8 >= 12000 ? 1500 : 1300) * 128;
  const ground = fallGround({ mode: "spline", coarse: null, fine: h }, { cells: N, h128: true });
  assert.equal(ground(15000, 13000), 1500);
  assert.equal(ground(15000, 11000), 1300);
  const map = new Uint8Array(N * N);
  for (let z = 300; z < 375; z++) for (let x = 460; x < 480; x++) map[z * N + x] = 1;
  const water = fallWater({ cells: N, tileMap: map, lakes: [{ id: 1, height: 2700 }] }, null);
  assert.equal(water(15000, 10000, 0), 1350, "lake 1 at tile (468, 312)");
  assert.equal(water(15000, 10000, 1), null, "the fall's own lake does not stop it");
  const spring = asRecord(wf([[15000, 12000], [15040, 12000]], 3000));
  const m = buildFallMeshes([spring], { ground, water, cells: N, tileMap: map, lakes: [{ id: 1, height: 2700 }], heightRange: fallHeightRange(2, { step: 32, base: 88 }) });
  assert.deepEqual([m.falls.length, m.refused, m.rejected], [1, [], []]);
  const f = m.falls[0]!;
  assert.equal(f.worldFt, 16384);
  assert.equal(f.landing.y, 1350, "lands in lake 1");
  const mist = fallMist(f);
  assert.ok(mist && mist.centre[0] > 8192 && mist.centre[0] < 16384);
  const sound = fallSound(f);
  assert.ok("position" in sound && sound.position[0] > 8192);
});
