/*
  The MTM2 writers and the texture encoder, each checked by reading the output back with
  OpenPhotex's own readers.
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  MTM2_PALETTE_FIRST_AUTHORED, MTM2_PALETTE_WHITE_INDEX, MTM_WHEEL_KEYS, buildFogMap, buildMtm2Lte, decodeActPalette,
  decodeRawTexture, emptyGroundBoxGrids, encodeRawTexture, medianCutPalette, mtm2LevelPalette, parseMtmLvl, parseMtmSit,
  parseMtmTrkLines, parseTexList, sampleForPalette, sitWorldTriplet, truckManifestLines, writeEmptyList, writeMtm2Lvl,
  writeMtm2Sit, writeMtm2Trk, writeTexList,
} from "../src/index.ts";
import type { Mtm2SitTruck, Mtm2Trk } from "../src/index.ts";

const truck = (x: number, courseToFollow?: number): Mtm2SitTruck => ({ position: [x, 10, 200], orient: [0, 0, 1.5], courseToFollow });

test("writeMtm2Sit reads back as an MTM2 SIT with its trucks, boxes and courses", () => {
  const bytes = writeMtm2Sit({
    lvlName: "TEST.LVL", trackName: "Test\nTrack", localeName: "Here", pictureBmp: "UI\\TESTS.BMP", iconBmp: "UI\\TESTL.BMP",
    descriptionTxt: "TEST.TXT", ambientSound: 3, weatherMask: 5, trackLength: 1234.5,
    yourTruck: truck(100, 0), vehicles: [truck(1), truck(2)],
    boxes: [
      { position: [10, 20, 30], orient: [0, 0, 0.5], modelName: "ROCK.BIN", type: 0 },
      { position: ["11.00", "21.00", "31.00"], orient: [0, 0, 0], extents: [5, 6, 7], type: 6, mass: 12.5 },
    ],
    course: [{ start: [0, 0, 0], end: [100, 0, 0], speedLimit: 40, trackWidth: 60 }],
    extendedCourses: [[{ start: [1, 1, 1], end: [2, 2, 2] }], null],
  });
  const text = new TextDecoder().decode(bytes);
  assert.ok(text.includes("\r\n") && !/[^\r]\n/.test(text), "CRLF throughout");
  const sit = parseMtmSit(bytes, "TEST.SIT");
  assert.equal(sit.origin, "MTM2");
  assert.equal(sit.lvlName, "TEST.LVL");
  assert.equal(sit.trackName, "Test Track");
  assert.equal(sit.localeName, "Here");
  assert.equal(sit.ambientSound, 3);
  assert.equal(sit.weatherMask, 5);
  assert.equal(sit.trucks.length, 3);
  assert.equal(sit.trucks[0].playerSlot, true);
  assert.deepEqual(sit.trucks[1].position, sitWorldTriplet("1.00,10.00,200.00"));
  assert.equal(sit.boxes.length, 2);
  assert.deepEqual(sit.boxes[0].position, sitWorldTriplet("10.00,20.00,30.00"));
  assert.equal(sit.boxes[0].modelName, "ROCK.BIN");
  assert.equal(sit.boxes[0].psi, 0.5);
  assert.equal(sit.boxes[0].mass, 0);
  assert.deepEqual([sit.boxes[1].length, sit.boxes[1].width, sit.boxes[1].height], [5, 6, 7]);
  assert.equal(sit.boxes[1].type, 6);
  assert.equal(sit.boxes[1].checkpointSequence, 0);
  assert.equal(sit.boxes[1].mass, 12.5);
  assert.equal(sit.primaryCourse?.segments.length, 1);
  assert.equal(sit.primaryCourse?.segments[0].speedLimit, 40);
  assert.equal(sit.extendedCourses.length, 1);
});

test("writeMtm2Lvl, writeTexList and the empty side files read back", () => {
  const lvl = parseMtmLvl(writeMtm2Lvl({
    descriptionTxt: "T.TXT", rawName: "T.RAW", clrName: "T.CLR", actName: "T.ACT", texName: "T.TEX", pupName: "T.PUP",
    aniName: "T.ANI", tdfName: "T.TDF", defName: "T.DEF", navName: "T.NAV", fogName: "T.FOG", lteName: "T.LTE",
    sunVector: [46333, -46333, 0], waterHeight: 77,
  }));
  assert.ok(lvl);
  assert.equal(lvl.rawName, "T.RAW");
  assert.equal(lvl.texName, "T.TEX");
  assert.equal(lvl.skyRawName, "CLOUDY2.RAW");
  assert.equal(lvl.lteName, "T.LTE");
  assert.deepEqual(lvl.sunVector, [46333, -46333, 0]);
  assert.equal(lvl.shadowIntensity, 40960);
  assert.equal(lvl.waterHeight, 77);
  assert.deepEqual(parseTexList(writeTexList(["GRASS.RAW", "ROAD.RAW"])), ["GRASS.RAW", "ROAD.RAW"]);
  assert.equal(new TextDecoder().decode(writeEmptyList()), "0\r\n");
});

test("the empty ground-box grids and the light grid have the stock sizes and values", () => {
  const grids = emptyGroundBoxGrids();
  assert.deepEqual(Object.keys(grids), ["RA0", "RA1", "RA2", "RA3", "RA4", "RA5", "CL0", "CL1", "CL2"]);
  assert.equal(grids.CL0.length, 12 * 65536);
  assert.equal(grids.CL1.length, 4 * 65536);
  assert.ok(grids.RA2.every((v) => v === 0xff) && grids.RA0.every((v) => v === 0));

  const flat = buildMtm2Lte(new Uint8Array(65536).fill(40), [46333, -46333, 0]);
  assert.equal(flat.length, 7 * 65536);
  // Level ground faces straight up: fully lit, and the six ground-box bytes stay zero.
  assert.equal(flat[0], 255);
  assert.deepEqual([...flat.subarray(1, 7)], [0, 0, 0, 0, 0, 0]);
  // A slope rising to the east is darker under a sun travelling east than under one travelling west.
  const ramp = new Uint8Array(65536).map((_, i) => (i & 255) >> 2);
  const east = buildMtm2Lte(ramp, [46333, -46333, 0]), west = buildMtm2Lte(ramp, [-46333, -46333, 0]);
  const cell = (100 + 100 * 256) * 7;
  assert.notEqual(east[cell], west[cell]);
});

const manifest: Mtm2Trk = {
  truckName: "Test Truck", truckModelBaseName: "test", tireModelBaseName: "tire", axleModelName: "axle.bin",
  shockTextureName: "shock.raw", barTextureName: "shock.raw", axlebarOffset: { x: 0, y: -1.5, z: 0 }, driveshaftPos: null,
  wheelAnchors: Object.fromEntries(MTM_WHEEL_KEYS.map((key, i) => [key, { x: i % 2 ? -4 : 4, y: -3, z: i < 2 ? 5 : -5 }])),
  scrapePoints: [{ x: 1, y: 2, z: 3 }, { x: -1, y: 2, z: 3 }], instrumentCluster: "cluster.bmp", waveFiles: ["engine.wav", "horn.wav"],
  lights: [{ type: 0, pos: { x: 1, y: 2, z: 3 }, bitmapRadius: 0.5, coneTexture: "cone.raw", sourceBitmap: "glow.raw", msOn: 100, msOff: 50 }],
  superiorAxlebarOffset: { frontAxleY: 1, rearAxleY: 2, middleY: 3 },
};

test("writeMtm2Trk reads back as an MTM2 truck manifest", () => {
  const back = parseMtmTrkLines(truckManifestLines(writeMtm2Trk(manifest)));
  assert.equal(back.truckName, "Test Truck");
  assert.equal(back.axleModelName, "axle.bin");
  assert.deepEqual(back.axlebarOffset, { x: 0, y: -1.5, z: 0 });
  for (const key of MTM_WHEEL_KEYS) assert.deepEqual(back.wheelAnchors[key], manifest.wheelAnchors[key]);
  assert.deepEqual(back.scrapePoints, manifest.scrapePoints);
  assert.deepEqual(back.waveFiles, ["engine.wav", "horn.wav"]);
  assert.equal(back.lights.length, 1);
  assert.equal(back.lights[0].sourceBitmap, "glow.raw");
  assert.equal(back.lights[0].msOn, 100);
  assert.deepEqual(back.superiorAxlebarOffset, { frontAxleY: 1, rearAxleY: 2, middleY: 3 });
});

test("writeMtm2Trk refuses an empty value, which would shift every later label", () => {
  assert.throws(() => writeMtm2Trk({ ...manifest, shockTextureName: "" }), RangeError);
  assert.throws(() => writeMtm2Trk({ ...manifest, waveFiles: [" "] }), RangeError);
  assert.throws(() => writeMtm2Trk({ ...manifest, lights: [{ ...manifest.lights[0], sourceBitmap: undefined }] }), RangeError);
});

test("encodeRawTexture round-trips art with 256 colours or fewer, and keys alpha on index 0", () => {
  // 32 x 32, the smallest stock size, in 256 distinct colours (i * 7 mod 256 is a bijection).
  const side = 32;
  const rgba = new Uint8Array(side * side * 4);
  for (let i = 0; i < side * side; i++) rgba.set([(i * 7) & 255, (i * 13) & 255, (i * 29) & 255, 255], i * 4);
  const { raw, act } = encodeRawTexture(rgba, side, side);
  const image = decodeRawTexture(raw, decodeActPalette(act));
  assert.deepEqual([...image.rgba].filter((_, i) => i % 4 !== 3), [...rgba].filter((_, i) => i % 4 !== 3));

  rgba[3] = 0;
  const keyed = encodeRawTexture(rgba, side, side);
  assert.equal(keyed.raw[0], 0);
  assert.ok(keyed.raw.subarray(1).every((index) => index !== 0));
  assert.throws(() => encodeRawTexture(new Uint8Array(8 * 4 * 4), 8, 4), RangeError);
});

test("median cut, the MTM2 level palette and its fog map", () => {
  const histogram = sampleForPalette(new Map(), new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0]));
  assert.equal(histogram.size, 2, "transparent texels are not counted");
  assert.deepEqual(medianCutPalette(histogram, 8).sort(), [[0, 0, 255], [255, 0, 0]]);

  const palette = mtm2LevelPalette(histogram);
  assert.deepEqual([...palette.subarray(MTM2_PALETTE_WHITE_INDEX * 3, MTM2_PALETTE_WHITE_INDEX * 3 + 3)], [252, 252, 252]);
  assert.deepEqual([...palette.subarray(7 * 3, 8 * 3)], [192, 192, 192]);
  assert.deepEqual([...palette.subarray(255 * 3)], [255, 255, 255]);
  const fog = buildFogMap(palette);
  assert.equal(fog.length, 32768);
  assert.equal(fog[0], 0);
  // Pure red's RGB555 cell maps to the authored red, never to a system entry.
  const red = fog[31 * 1024];
  assert.ok(red >= MTM2_PALETTE_FIRST_AUTHORED && red <= MTM2_PALETTE_WHITE_INDEX);
  assert.deepEqual([...palette.subarray(red * 3, red * 3 + 3)], [255, 0, 0]);
});
