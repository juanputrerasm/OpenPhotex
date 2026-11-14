/*
  Track format version 6 (https://openmtm2.github.io/proposals/track-format-v6): the .SI3
  situation file, the .TXV keys, heights with step and base, grid files of N x N cells, 16-bit
  ground boxes, .WTR version 2, .VEG bounds, and the MTM2 simulation in a 512-cell world.
  Every fixture is synthetic.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import {
  readTxvV6, readTxvInfo, writeTxv, parseTxv, setTxvValues, txvUsesV6Keys, txvValue,
  decodeMtm2V6Heights, mtm2V6HeightsH128, mtm2V6HeightsFt, mtm2V6StepAndBase, mtm2V6SamplesFromFt, encodeMtm2HeightRaw16,
  encodeGreyPng, deflateZlib, crc32, decodePngSamples, inflateZlib, terrainSplineExpand,
  checkMtm2GridSize, mtm2GroundBoxDepth, mtm2GroundBoxHeightFt, decodeGroundBoxes, encodeGroundBoxes, emptyGroundBoxGrids, buildMtm2Lte,
  parseWtr, writeWtr, wtrLakeAt, wtrHeightRange, checkMtm2VegBounds, writeMtm2Veg, parseMtm2Veg,
  detectSitOrigin, mtm2SituationExtension, isMtm2V6Situation, MTM2_SITUATION_EXTENSIONS,
  mtm2Sim as S,
} from "../src/index.ts";

const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const throwsKey = (fn: () => unknown, key: string) => assert.throws(fn, (e: Error) => e instanceof RangeError && e.message.includes(key), `refused naming ${key}`);

// ---- 5.1 the situation file

test(".SI3 is an MTM2 situation file of its own", () => {
  assert.deepEqual([...MTM2_SITUATION_EXTENSIONS], ["SIT", "SI2", "SI3"]);
  assert.equal(mtm2SituationExtension("WORLD\\CHI1.si3"), "SI3");
  assert.equal(mtm2SituationExtension("WORLD\\CHI1.SI2"), "SI2");
  assert.equal(mtm2SituationExtension("WORLD\\CHI1.SIX"), null);
  assert.ok(isMtm2V6Situation("WORLD\\CHI1.SI3"));
  assert.ok(!isMtm2V6Situation("WORLD\\CHI1.SI2"));
  // The title settles the origin, as .SI2 does, even for text with no MTM2 marker.
  assert.equal(detectSitOrigin(["!foo"], "WORLD\\CHI1.SI3"), "MTM2");
  assert.equal(detectSitOrigin(["!foo"], "WORLD\\CHI1.SIT"), "MTM1");
});

// ---- 5.2, 6 the .TXV keys

test("readTxvV6 fills the defaults", () => {
  const v = readTxvV6("formatVersion=6\r\n");
  assert.deepEqual(v, {
    formatVersion: 6, worldCells: 256, worldFt: 8192, terrainHeightMap: null, terrainHeightStep: 128, terrainHeightBase: 0,
    terrainGrid: null, warnings: [],
  });
  const w = readTxvV6("# x\r\nFORMATVERSION=6\r\nworldcells=512\r\nterrainHeightMap=DATA\\CHI1_H.PNG\r\nterrainHeightStep=32\r\nterrainHeightBase=-12\r\nterrainGrid=Spline\r\ntool=Traxx\r\n");
  assert.equal(w.worldCells, 512);
  assert.equal(w.worldFt, 16384);
  assert.equal(w.terrainHeightMap, "DATA\\CHI1_H.PNG");
  assert.equal(w.terrainHeightStep, 32);
  assert.equal(w.terrainHeightBase, -12);
  assert.equal(w.terrainGrid, "spline");
});

test("readTxvV6 refuses a value outside the allowed ones, naming the key", () => {
  throwsKey(() => readTxvV6(null), "TXV");
  throwsKey(() => readTxvV6("tool=Traxx\r\n"), "formatVersion");
  throwsKey(() => readTxvV6("formatVersion=5\r\n"), "formatVersion");
  throwsKey(() => readTxvV6("formatVersion=six\r\n"), "formatVersion");
  for (const v of ["0", "128", "384", "1024", "256.0", "x"]) throwsKey(() => readTxvV6(`formatVersion=6\r\nworldCells=${v}\r\nterrainHeightMap=A.RAW\r\n`), "worldCells");
  for (const v of ["0", "3", "256", "-1", "1.5", "64ft"]) throwsKey(() => readTxvV6(`formatVersion=6\r\nterrainHeightStep=${v}\r\n`), "terrainHeightStep");
  for (const v of ["-32769", "32768", "12.5", ""]) throwsKey(() => readTxvV6(`formatVersion=6\r\nterrainHeightBase=${v}\r\n`), "terrainHeightBase");
  throwsKey(() => readTxvV6("formatVersion=6\r\nterrainGrid=smooth\r\n"), "terrainGrid");
  throwsKey(() => readTxvV6("formatVersion=6\r\nterrainHeightMap=DATA\\X_H.TGA\r\n"), "terrainHeightMap");
  throwsKey(() => readTxvV6("formatVersion=6\r\nworldCells=512\r\n"), "terrainHeightMap");
  // Every allowed step and the ends of the base range load.
  for (const step of [1, 2, 4, 8, 16, 32, 64, 128]) assert.equal(readTxvV6(`formatVersion=6\r\nterrainHeightStep=${step}\r\n`).terrainHeightStep, step);
  assert.equal(readTxvV6("formatVersion=6\r\nterrainHeightBase=-32768\r\n").terrainHeightBase, -32768);
  assert.equal(readTxvV6("formatVersion=6\r\nterrainHeightBase=+32767\r\n").terrainHeightBase, 32767);
});

test("a formatVersion above 6 loads with a warning", () => {
  const v = readTxvV6("formatVersion=7\r\n");
  assert.equal(v.formatVersion, 7);
  assert.equal(v.warnings.length, 1);
  assert.match(v.warnings[0]!, /newer build/);
});

test("readTxvInfo carries the new keys as written", () => {
  const info = readTxvInfo("formatVersion=6\r\nworldCells=512\r\nterrainHeightMap=DATA\\A.RAW\r\nterrainHeightStep=32\r\nterrainHeightBase=-5\r\n");
  assert.equal(info.worldCells, 512);
  assert.equal(info.terrainHeightMap, "DATA\\A.RAW");
  assert.equal(info.terrainHeightStep, 32);
  assert.equal(info.terrainHeightBase, -5);
  assert.equal(readTxvInfo("formatVersion=5\r\n").worldCells, null);
});

test("writeTxv keeps the version 6 keys to .SI3 tracks", () => {
  const v6 = parseTxv("formatVersion=6\r\nworldCells=512\r\nterrainHeightMap=DATA\\A.PNG\r\n");
  assert.ok(writeTxv(v6, { situation: "WORLD\\A.SI3" }).length > 0);
  throwsKey(() => writeTxv(v6, { situation: "WORLD\\A.SI2" }), "worldCells");
  throwsKey(() => writeTxv(parseTxv("formatVersion=5\r\nterrainHeightBase=0\r\n"), { situation: "A.SIT" }), "terrainHeightBase");
  throwsKey(() => writeTxv(parseTxv("formatVersion=5\r\n"), { situation: "A.SI3" }), "formatVersion");
  throwsKey(() => writeTxv(parseTxv("formatVersion=6\r\nterrainHeightStep=3\r\n"), { situation: "A.SI3" }), "terrainHeightStep");
  // CP4's own terrainGrid stays allowed in a .SI2 track.
  assert.ok(writeTxv(parseTxv("formatVersion=5\r\nterrainGrid=spline\r\n"), { situation: "A.SI2" }).length > 0);
  assert.ok(txvUsesV6Keys("worldCells=256\r\n"));
  assert.ok(!txvUsesV6Keys("formatVersion=6\r\nterrainGrid=fine\r\n"));
});

test("setTxvValues keeps unknown keys and comments in place", () => {
  const lines = parseTxv("# written by Traxx\r\nformatVersion=5\r\nfutureKey=abc\r\nTerrainGrid=spline\r\nhdTextures=1\r\n");
  const next = setTxvValues(lines, { formatVersion: 6, terrainGrid: "fine", worldCells: 512, hdTextures: null });
  assert.equal(new TextDecoder().decode(writeTxv(next)),
    "# written by Traxx\r\nformatVersion=6\r\nfutureKey=abc\r\nTerrainGrid=fine\r\nworldCells=512\r\n");
  assert.equal(txvValue(next, "futurekey"), "abc");
});

// ---- 7 heights

function rawOf(side: number, f: (z: number, x: number) => number): Uint16Array {
  const a = new Uint16Array(side * side);
  for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) a[z * side + x] = f(z, x);
  return a;
}

test("a RAW terrainHeightMap is 2N^2 or 32N^2 bytes, anything else is refused", () => {
  for (const cells of [256, 512]) {
    const coarse = encodeMtm2HeightRaw16(rawOf(cells, (z, x) => (z * 7 + x * 3) & 0xffff));
    const h = decodeMtm2V6Heights(coarse, { name: "DATA\\A.RAW", cells, step: 32, base: 12 });
    assert.equal(h.mode, "classic");
    assert.equal(h.cells, cells);
    assert.equal(h.coarse.length, cells * cells);
    assert.equal(h.fine, null);
    assert.equal(h.coarse[cells + 2], 7 + 6);
    const fine = encodeMtm2HeightRaw16(rawOf(4 * cells, (z, x) => z + x));
    const f = decodeMtm2V6Heights(fine, { name: "a.raw", cells });
    assert.equal(f.mode, "fine");
    assert.equal(f.fine!.length, 16 * cells * cells);
    assert.equal(f.coarse[1 * cells + 1], 8, "the coarse corner is every fourth fine sample");
    throwsKey(() => decodeMtm2V6Heights(new Uint8Array(coarse.length + 2), { name: "A.RAW", cells }), "A.RAW");
  }
  // A 256 world's file is the wrong size for a 512 world, and the other way.
  throwsKey(() => decodeMtm2V6Heights(new Uint8Array(131072), { name: "A.RAW", cells: 512 }), "512-cell");
  throwsKey(() => decodeMtm2V6Heights(new Uint8Array(524288), { name: "A.RAW", cells: 256 }), "256-cell");
  // An 8-bit 65,536-byte RAW is not a terrainHeightMap.
  throwsKey(() => decodeMtm2V6Heights(new Uint8Array(65536), { name: "A.RAW", cells: 256 }), "A.RAW");
});

test("the grid mode follows section 7.2's table", () => {
  const coarse = encodeMtm2HeightRaw16(rawOf(256, () => 100));
  const fine = encodeMtm2HeightRaw16(rawOf(1024, () => 100));
  const mode = (bytes: Uint8Array, terrainGrid: string | null) => {
    const h = decodeMtm2V6Heights(bytes, { name: "A.RAW", cells: 256, terrainGrid });
    return [h.mode, h.warning !== null];
  };
  assert.deepEqual(mode(coarse, null), ["classic", false]);
  assert.deepEqual(mode(coarse, "classic"), ["classic", false]);
  assert.deepEqual(mode(coarse, "spline"), ["spline", false]);
  assert.deepEqual(mode(coarse, "fine"), ["classic", true]);
  assert.deepEqual(mode(fine, null), ["fine", false]);
  assert.deepEqual(mode(fine, "classic"), ["fine", true]);
  assert.deepEqual(mode(fine, "spline"), ["fine", true]);
  assert.deepEqual(mode(fine, "fine"), ["fine", false]);
  throwsKey(() => decodeMtm2V6Heights(coarse, { name: "A.RAW", cells: 256, terrainGrid: "bogus" }), "terrainGrid");
});

test("a grey PNG terrainHeightMap: 16-bit as stored, 8-bit as b << 8, colour refused", () => {
  const samples = rawOf(512, (z, x) => (z * 131 + x * 17) & 0xffff);
  const png = encodeGreyPng(samples, 512, 512, 16);
  const h = decodeMtm2V6Heights(png, { name: "DATA\\CHI1_H.PNG", cells: 512, step: 128, base: 0 });
  assert.equal(h.bitDepth, 16);
  assert.deepEqual(h.coarse, samples);
  const png8 = encodeGreyPng(rawOf(256, (z, x) => (z + x) & 255), 256, 256, 8);
  const h8 = decodeMtm2V6Heights(png8, { name: "a.png", cells: 256 });
  assert.equal(h8.bitDepth, 8);
  assert.equal(h8.coarse[3], 3 << 8);
  throwsKey(() => decodeMtm2V6Heights(png8, { name: "a.png", cells: 512 }), "512-cell");
  throwsKey(() => decodeMtm2V6Heights(encodeGreyPng(new Uint16Array(256 * 128), 256, 128), { name: "a.png", cells: 256 }), "a.png");
  // An RGB PNG: hand-built with the same writer's chunks, colour type 2.
  const rgb = encodeGreyPng(new Uint16Array(4), 2, 2, 8);
  rgb[8 + 8 + 9] = 2; // IHDR colour type (CRC no longer matches; the decoder does not check it)
  assert.throws(() => decodeMtm2V6Heights(rgb, { name: "a.png", cells: 256 }));
});

test("the spline wraps at N: a 512 map of four copies of a 256 map expands to four copies of its expansion", () => {
  const tile = rawOf(256, (z, x) => Math.round(20000 + 9000 * Math.sin(z / 9) * Math.cos(x / 13)));
  const big = rawOf(512, (z, x) => tile[(z & 255) * 256 + (x & 255)]!);
  const small = terrainSplineExpand(tile);
  const large = terrainSplineExpand(big, 512);
  assert.equal(large.length, 2048 * 2048);
  for (const [z, x] of [[0, 0], [5, 1023], [1023, 1024], [2047, 2047], [1500, 600]] as const) {
    assert.equal(large[z * 2048 + x], small[(z & 1023) * 1024 + (x & 1023)], `fine (${z}, ${x})`);
  }
  // Through the decoder with terrainGrid=spline.
  const h = decodeMtm2V6Heights(encodeMtm2HeightRaw16(big), { name: "A.RAW", cells: 512, terrainGrid: "spline" });
  assert.equal(h.mode, "spline");
  assert.deepEqual(h.fine, large);
  assert.throws(() => terrainSplineExpand(big), /expected 65536/);
  assert.throws(() => terrainSplineExpand(new Uint16Array(300 * 300), 300), /power of two/);
});

test("heights: base + sample / step, stored as 32-bit 1/128 ft with a shift", () => {
  const s = Uint16Array.from([0, 1, 32, 57888, 65535]);
  assert.deepEqual([...mtm2V6HeightsH128(s, 32, 12)], [12 * 128, 4 + 12 * 128, 128 + 12 * 128, 57888 * 4 + 1536, 65535 * 4 + 1536]);
  assert.deepEqual([...mtm2V6HeightsFt(s, 32, 12)], [12, 12.03125, 13, 12 + 1809, 12 + 65535 / 32]);
  assert.deepEqual([...mtm2V6HeightsFt(Uint16Array.from([65535]), 1, 32767)], [32767 + 65535]);
  assert.deepEqual([...mtm2V6HeightsFt(Uint16Array.from([1]), 128, -32768)], [-32768 + 1 / 128]);
  assert.throws(() => mtm2V6HeightsFt(s, 3, 0), /terrainHeightStep/);
});

test("a writer's step and base (section 11)", () => {
  assert.deepEqual(mtm2V6StepAndBase(12, 1821), { step: 32, base: 12 }, "Pikes Peak");
  assert.deepEqual(mtm2V6StepAndBase(0.4, 89.2), { step: 128, base: 0 }, "Chicago");
  assert.deepEqual(mtm2V6StepAndBase(-30.5, 500), { step: 64, base: -31 });
  assert.deepEqual(mtm2V6StepAndBase(0, 8000), { step: 8, base: 0 });
  assert.throws(() => mtm2V6StepAndBase(0, 70000), /65535/);
  const ft = [12, 12.03125, 1821];
  const samples = mtm2V6SamplesFromFt(ft, 32, 12);
  assert.deepEqual([...samples], [0, 1, 57888]);
  assert.deepEqual([...mtm2V6HeightsFt(samples, 32, 12)], ft, "the round trip is exact at the step");
  assert.throws(() => mtm2V6SamplesFromFt([11], 32, 12), /does not fit/);
});

test("the PNG writer is a valid zlib PNG every inflater reads", () => {
  const data = new Uint8Array(100000);
  for (let i = 0; i < data.length; i++) data[i] = (i % 251) ^ (i >> 9);
  const z = deflateZlib(data);
  assert.deepEqual(new Uint8Array(inflateSync(z)), data, "node's zlib");
  assert.deepEqual(inflateZlib(z), data, "OpenPhotex's inflater");
  assert.ok(z.length < data.length / 2);
  assert.equal(crc32(latin1("123456789")), 0xcbf43926);
  const samples = rawOf(64, (r, c) => (r * 1000 + c * 7) & 0xffff);
  const png = decodePngSamples(encodeGreyPng(samples, 64, 64, 16));
  assert.deepEqual([png.width, png.height, png.bitDepth, png.colorType], [64, 64, 16, 0]);
  assert.deepEqual(png.samples, samples);
  assert.throws(() => encodeGreyPng([256], 1, 1, 8), /8 bits/);
});

// ---- 8.2, 8.3 grid files and ground boxes

test("every grid file must hold N x N cells", () => {
  const sizes: Array<[string, number, number]> = [
    ["DATA\\A.CLR", 131072, 524288], ["DATA\\A.LTE", 458752, 1835008], ["DATA\\A.RA0", 65536, 262144], ["DATA\\A.RA1", 131072, 524288],
    ["DATA\\A.RA5", 65536, 262144], ["DATA\\A.CL0", 786432, 3145728], ["DATA\\A.CL2", 786432, 3145728], ["DATA\\A.CL1", 262144, 1048576],
  ];
  for (const [name, at256, at512] of sizes) {
    assert.ok(checkMtm2GridSize(name, at256, 256) > 0);
    assert.ok(checkMtm2GridSize(name, at512, 512) > 0);
    throwsKey(() => checkMtm2GridSize(name, at256, 512), name);
    throwsKey(() => checkMtm2GridSize(name, at512 + 1, 512), name);
  }
  assert.equal(checkMtm2GridSize("A.RA0", 524288, 512), 2, "a 16-bit ground box file");
});

test("ground box pairs are 8 or 16-bit by size, and both files of a pair agree", () => {
  assert.equal(mtm2GroundBoxDepth(new Uint8Array(262144), new Uint8Array(262144), 512), 8);
  assert.equal(mtm2GroundBoxDepth(new Uint8Array(524288), new Uint8Array(524288), 512), 16);
  throwsKey(() => mtm2GroundBoxDepth(new Uint8Array(262144), new Uint8Array(524288), 512), "same depth");
  throwsKey(() => mtm2GroundBoxDepth(new Uint8Array(65536), new Uint8Array(65536), 512, ["RA4", "RA5"]), "RA4");
  assert.equal(mtm2GroundBoxHeightFt(10, 8, 32, -20), 0, "8-bit: base + 2 * byte");
  assert.equal(mtm2GroundBoxHeightFt(64, 16, 32, -20), -18, "16-bit: base + value / step");
});

test("16-bit ground boxes round trip in a 512 grid", () => {
  const box = { x: 400, y: 300, lower: 1000, upper: 40000, faceTexture: [1, 2, 3, 4, 5, 6], faceRotation: [0, 1, 2, 3, 0, 1], faceMirror: [0, 0, 1, 1, 2, 3] };
  const { ra0, ra1, cl0 } = encodeGroundBoxes([box], 512, 0, 16);
  assert.equal(ra0.length, 524288);
  assert.equal(cl0.length, 3145728);
  const back = decodeGroundBoxes(ra0, ra1, cl0, 512, 0, 16);
  assert.equal(back.length, 1);
  assert.deepEqual([back[0]!.x, back[0]!.y, back[0]!.lower, back[0]!.upper], [400, 300, 1000, 40000]);
  assert.deepEqual(back[0]!.faceMirror, box.faceMirror);
  assert.throws(() => encodeGroundBoxes([{ ...box, upper: 300 }], 512), /8-bit/);
  assert.throws(() => encodeGroundBoxes([{ ...box, x: 512 }], 512, 0, 16), /outside/);
  // 8-bit stays as before.
  const eight = encodeGroundBoxes([{ ...box, x: 4, y: 3, lower: 3, upper: 9 }], 256);
  assert.equal(eight.ra0.length, 65536);
});

test("empty grids and the light grid at N", () => {
  const g = emptyGroundBoxGrids(512, 16);
  assert.equal(g.RA0.length, 524288);
  assert.equal(g.RA5.length, 524288);
  assert.equal(g.RA2.length, 262144);
  assert.equal(g.RA2[7], 0xff);
  assert.equal(g.CL0.length, 3145728);
  assert.equal(g.CL1.length, 1048576);
  assert.equal(emptyGroundBoxGrids().RA0.length, 65536);
  const tile = new Uint8Array(65536);
  for (let i = 0; i < tile.length; i++) tile[i] = ((i * 37) >> 4) & 255;
  const big = new Uint8Array(512 * 512);
  for (let z = 0; z < 512; z++) for (let x = 0; x < 512; x++) big[z * 512 + x] = tile[(z & 255) * 256 + (x & 255)]!;
  const sun = [46333, -30000, 2000] as const;
  const lte256 = buildMtm2Lte(tile, sun);
  const lte512 = buildMtm2Lte(big, sun, 512);
  assert.equal(lte512.length, 1835008);
  for (const [z, x] of [[0, 0], [0, 511], [300, 17], [511, 511]] as const) {
    assert.equal(lte512[(z * 512 + x) * 7], lte256[((z & 255) * 256 + (x & 255)) * 7], `the light wraps at N (${z}, ${x})`);
  }
  assert.throws(() => buildMtm2Lte(tile, sun, 512), /512-cell/);
});

// ---- 9.1 lakes

const lake = (height: number, box = { minX: 1, minZ: 1, maxX: 2, maxZ: 2 }) => ({ flags: 1, height, seeds: [{ x: box.minX, z: box.minZ }], box, tileCount: 2 });

test("the world's size picks the .WTR version: 256 cells version 1, 512 cells version 2", () => {
  const map = new Uint8Array(65536);
  map[257] = 1; map[258] = 1;
  const v1 = writeWtr([lake(60)], map);
  assert.equal(parseWtr(v1).major, 1);
  assert.equal(v1.length, 64 + 8 + 64 + 65536);
  assert.throws(() => writeWtr([lake(5000)], map), /256-cell world's lakes/, "a 256-cell world's lake above 2,048 ft");
  assert.throws(() => writeWtr([lake(60)], map, { version: 2 }), /version 1, not 2/);
  assert.equal(parseWtr(writeWtr([lake(60)], new Uint8Array(512 * 512).fill(0, 0))).major, 2);
  // A version 2 header on a 256 x 256 map is refused.
  const bad = writeWtr([lake(60)], map);
  const dv = new DataView(bad.buffer);
  dv.setUint16(4, 2, true);
  assert.throws(() => parseWtr(bad), /512-cell world's/);
});

test(".WTR version 2 round trip in a 512 world: N x N map, i32 heights, u16 boxes, tile count at +0x30", () => {
  const map = new Uint8Array(512 * 512);
  map[400 * 512 + 300] = 1; map[400 * 512 + 301] = 1; map[3] = 2;
  const box = { minX: 300, minZ: 400, maxX: 301, maxZ: 400 };
  const bytes = writeWtr([lake(-40, box), { ...lake(9000, { minX: 3, minZ: 0, maxX: 3, maxZ: 0 }), tileCount: 1 }], map);
  const dv = new DataView(bytes.buffer);
  assert.equal(dv.getUint16(4, true), 2, "major 2");
  assert.equal(dv.getUint16(16, true), 512);
  assert.equal(dv.getUint16(18, true), 512);
  const body = 64;
  assert.equal(dv.getInt32(body + 8 + 4, true), -40);
  assert.equal(dv.getUint16(body + 8 + 0x28, true), 300);
  assert.equal(dv.getUint16(body + 8 + 0x2e, true), 400);
  assert.equal(dv.getUint32(body + 8 + 0x30, true), 2);
  const w = parseWtr(bytes, { cells: 512 });
  assert.equal(w.major, 2);
  assert.equal(w.tilesX, 512);
  assert.equal(w.tileMap!.length, 262144);
  assert.deepEqual(w.lakes[0]!.box, box);
  assert.equal(w.lakes[0]!.height, -40);
  assert.equal(w.lakes[0]!.heightFt, -20);
  assert.equal(w.lakes[1]!.tileCount, 1);
  assert.equal(wtrLakeAt(w, 300 * 32 + 5, 400 * 32 + 5), 1);
  assert.equal(wtrLakeAt(w, 300 * 32 + 5 + 16384, 400 * 32 + 5 - 16384), 1, "wraps at 16,384 ft");
  assert.equal(wtrLakeAt(w, 3 * 32, 0), 2);
  // The world's size must match, and a wrong TMAP is refused.
  throwsKey(() => parseWtr(bytes, { cells: 256 }), "256-cell");
  const short = bytes.slice();
  new DataView(short.buffer).setUint32(32 + 16 + 12, 65536, true);
  throwsKey(() => parseWtr(short), "TMAP");
  const v3 = bytes.slice();
  v3[4] = 3;
  throwsKey(() => parseWtr(v3), "major version 3");
});

test(".WTR heights: version 1's range, version 2's the terrain's whole range", () => {
  assert.deepEqual(wtrHeightRange(1), [1, 4096]);
  assert.deepEqual(wtrHeightRange(2, 128, 0), [1, 1024]);
  assert.deepEqual(wtrHeightRange(2, 32, 12), [25, 2 * (12 + 2048)]);
  assert.deepEqual(wtrHeightRange(2, 1, -100), [-199, 2 * (65536 - 100)]);
});

// ---- 9.2 vegetation

test(".VEG positions across the world: trees below W * 256, grass tiles below N", () => {
  const trees = { count: 1, position: Int32Array.from([12000 * 256, 50 * 256, 100 * 256]), species: new Uint16Array(1), heading: new Uint16Array(1), scale: Uint16Array.from([4096]), tint: Uint8Array.from([128]), tier: new Uint8Array(1) };
  const clumps = { count: 0, tiles: [{ tx: 400, tz: 3, first: 0, count: 0 }], species: new Uint16Array(0), offset: new Uint8Array(0), y: new Int32Array(0), heading: new Uint8Array(0), scale: new Uint8Array(0), tint: new Uint8Array(0) };
  throwsKey(() => checkMtm2VegBounds({ trees, clumps }, 256), "tree 0");
  checkMtm2VegBounds({ trees, clumps }, 512);
  const noTrees = { ...trees, count: 0, position: new Int32Array(0) };
  throwsKey(() => checkMtm2VegBounds({ trees: noTrees, clumps }, 256), "grass tile");
  const edge = { ...trees, position: Int32Array.from([16384 * 256, 0, 0]) };
  throwsKey(() => checkMtm2VegBounds({ trees: edge, clumps: { ...clumps, tiles: [] } }, 512), "tree 0");
  const bytes = writeMtm2Veg({ species: [], trees, clumps: { ...clumps, tiles: [] } }, { cells: 512 });
  assert.equal(parseMtm2Veg(bytes).trees.position[0], 12000 * 256);
  assert.throws(() => writeMtm2Veg({ species: [], trees, clumps: { ...clumps, tiles: [] } }, { cells: 256 }), /outside/);
});

// ---- 8.1 the simulation in a 512 world

test("the terrain of a 512 world: mask N - 1, stride N, wraps at 16,384 ft", () => {
  const n = 512;
  const heightsFt = new Float32Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) heightsFt[r * n + c] = r * 0.5 + c;
  const t = S.createTerrainFt(heightsFt, null, null, n);
  assert.equal(S.terrainCells(t), 512);
  assert.equal(S.terrainWorldFt(t), 16384);
  assert.equal(S.terrainHeightAt(t, 300 * 32, 400 * 32), 400 * 0.5 + 300);
  assert.equal(S.terrainHeightAt(t, 300 * 32 + 16384, 400 * 32 - 16384), 400 * 0.5 + 300);
  assert.equal(S.terrainHeightAt(t, 511 * 32, 0), 511, "column 511 exists");
  assert.throws(() => S.createTerrainFt(new Float32Array(65536), null, null, 512), /262144/);
  assert.throws(() => S.createTerrain(new Uint8Array(65536), null, 512), /262144/);
  // A fine grid of 4N over it, 8 ft cells.
  const fine = new Float32Array(2048 * 2048).fill(7);
  const tf = S.createTerrainFt(heightsFt, null, fine, n);
  assert.equal(tf.fine!.cellFt, 8);
  assert.equal(S.terrainHeightAt(tf, 10000, 15000), 7);
  // The retail world is unchanged.
  const retail = S.createTerrain(new Uint8Array(65536).fill(3));
  assert.equal(retail.cells, undefined);
  assert.equal(S.terrainWorldFt(retail), 8192);
  assert.equal(S.createTerrainGround(retail, null).worldFt, 8192);
  assert.equal(S.createTerrainGround(t, null).worldFt, 16384);
});

test("surface and lakes of a 512 world", () => {
  const clr = new Uint16Array(512 * 512);
  clr[400 * 512 + 300] = 1;
  const map = S.createSurfaceMap(clr, Int32Array.from([200, 700]), 512);
  const t = S.createTerrainFt(new Float32Array(512 * 512).fill(10), null, null, 512);
  assert.equal(S.terrainSurfaceValue(t, map, 300 * 32 + 1, 400 * 32 + 1, null), 700);
  assert.equal(S.terrainSurfaceValue(t, map, 300 * 32 + 1 - 16384, 400 * 32 + 1, null), 700);
  assert.throws(() => S.createSurfaceMap(new Uint16Array(65536), new Int32Array(2), 512), /262144/);
  const tiles = new Uint8Array(512 * 512);
  tiles[400 * 512 + 300] = 1;
  S.setTerrainLakes(t, tiles, Float32Array.from([0, 30]));
  assert.equal(S.terrainLakeAt(t, 300 * 32 + 1, 400 * 32 + 1), 1);
  assert.equal(S.terrainWaterLevelAt(t, 300 * 32 + 1, 400 * 32 + 1), 30);
  assert.throws(() => S.setTerrainLakes(t, new Uint8Array(65536), new Float32Array(2)), /262144/);
});

test("wrapping at W: positions every frame, load positions, nearest copies", () => {
  const W = 16384;
  assert.equal(S.worldFtOf(512), W);
  assert.equal(S.wrapCoord(16390, W), 6);
  assert.equal(S.wrapCoord(-6, W), 16378);
  assert.equal(S.wrapCoord(9000, W), 9000, "not wrapped at 8192 in a 512 world");
  assert.equal(S.wrapDelta(16380 - 5, W), -9);
  assert.equal(S.wrapDelta(6000, W), 6000, "the nearest copy is at W / 2");
  assert.equal(S.wrapDelta(6000), 6000 - 8192);
  assert.equal(S.nearestShift(5, 16380, W), W);
  assert.equal(S.wrapLoadCoord(-100, W), 16284);
  assert.equal(S.wrapLoadCoord(-100), 8092);
  const s = S.createTruckState([16390, 5, 9000], 0, S.GEAR.NEUTRAL, S.createTruckParams({}, {}));
  assert.deepEqual(S.wrapTruck(s, W), [-W, 0]);
  assert.equal(s.pos[0], 6);
  assert.equal(s.pos[2], 9000);
});

test("ground boxes, moving objects and top-crush cars in a 512 world", () => {
  const n = 512;
  const ra0 = new Uint8Array(n * n), ra1 = new Uint8Array(n * n);
  ra1[400 * n + 300] = 5;
  const boxes = S.groundBoxesAround(ra0, ra1, 300 * 32 + 16, 400 * 32 + 16, [], 2, n);
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0]!.pos[0], 300 * 32 + 16);
  // 16-bit, with a base: base + value / step.
  const w0 = new Uint16Array(n * n), w1 = new Uint16Array(n * n);
  w0[400 * n + 300] = 64; w1[400 * n + 300] = 640;
  const b16 = S.groundBoxesAround(w0, w1, 300 * 32 + 16, 400 * 32 + 16, [], 1 / 32, n, -10);
  assert.equal(b16.length, 1);
  assert.equal(b16[0]!.half[1] * 2, 18);
  assert.equal(b16[0]!.pos[1], -10 + 2 + 9);
  const terrain = S.createTerrainFt(new Float32Array(n * n), null, null, n);
  assert.equal(S.groundBoxHeightAt(terrain, ra0, ra1, 300 * 32 + 16, 400 * 32 + 16, 3), 10);
  assert.equal(S.groundBoxHeightAt(terrain, w0, w1, 300 * 32 + 16, 400 * 32 + 16, 3, false, { stepFt: 1 / 32, baseFt: -10 }), 10);
  const box = { pos: new Float64Array([16380, 1, 9000]), half: new Float64Array([1, 1, 1]) } as unknown as Parameters<typeof S.stepMovingObject>[0];
  S.stepMovingObject(box, [10, 0, 0], terrain, null, null, 1);
  assert.equal(box.pos[0], 6, "wraps at 16,384 ft");
  assert.equal(box.pos[2], 9000);
  const car = S.createTopCrush({
    positionFt: [-50, 0, 10], position2Ft: [-50, 0, 10], theta: 0, phi: 0, psi: 0, sizeFt: [10, 5, 4], size2Ft: [5, 5, 2], mass: 1, bvel: [0, 0, 0], rates: [0, 0, 0],
  }, null, null, 16384);
  assert.equal(car.pos[0], 16334);
});

test("a .SI3's negative positions wrap by +W at load (8.4)", async () => {
  const { parseMtmSit } = await import("../src/index.ts");
  const text = [
    "!ambient sound,track length,weather mask", "3,1000.000000,65535",
    "*** Boxes ***", "1",
    "*********************************************", "ipos", "-10.5,20.25,300.75", "theta,phi,psi", "0.0,0.0,1.5",
    "length,width,height", "12.5,64.4,32.6", "mass", "0.0", "!type,flags", "6,0", "priority", "2",
    "*** Course ***", "c1Count,course_direction", "0,0",
    "*** Vehicles ***", "1", "*********************************************",
    "truckFile", "bigfoot.trk", "ipos", "-12.5,106,-3", "theta,phi,psi", "0,0,1.5",
  ].join("\r\n");
  const big = parseMtmSit(text, "WORLD\\CHI1.SI3", { worldFt: 16384 });
  assert.equal(big.origin, "MTM2");
  assert.deepEqual(big.boxes.find((b) => b.type === 6)!.positionFt, [16373.5, 20.25, 300.75]);
  assert.deepEqual(big.trucks.filter((t) => !t.playerSlot)[0]!.positionFt, [16371.5, 106, 16381]);
  // The default stays the retail world, and the next parse is not affected.
  assert.deepEqual(parseMtmSit(text, "T.SI2").boxes.find((b) => b.type === 6)!.positionFt, [8181.5, 20.25, 300.75]);
});
