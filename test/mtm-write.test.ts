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
  assert.equal(sit.trackLength, 1234.5);
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

test("writeMtm2Sit writes ramps, box details, cylinders, top crush, courses, stadium and backdrop that read back", () => {
  const bytes = writeMtm2Sit({
    lvlName: "TEST.lvl", trackName: "T", localeName: "L", longitudeLatitude: "1,2", pictureBmp: "TESTS.BMP", iconBmp: "TESTL.BMP",
    descriptionTxt: "0,0", raceTimes: "0.000000,0.000000,0.000000",
    yourTruck: truck(100, 0), vehicles: [truck(1, 3)],
    ramps: [{ position: [1, 2, 3], orient: [0, 0, 0], extents: [40, 20, 10], rates: [0.5, 0, 0] }],
    boxes: [{
      position: [10, 20, 30], orient: [0, 0, 0], modelName: "LAMP.BIN", type: 12, priority: 2, bvel: [1, 3, 2], rates: [0, 0.25, 0],
      hitSound: "HIT.WAV", loopSound: "LOOP.WAV", light: ["80.000000", "10.000000", 1, 0.5, 0.25, "2", 6, 125, 10, 3.5, 1.25, 4],
    }],
    cylinders: { count: 1, lines: ["*********************************************", "ipos", "1,2,3"] },
    topCrush: [{ position: [300, 30, 400], position2: [300, 34, 400], orient: [0, 0, 0], modelName: "CPCRUB2.BIN", cabModelName: "CPCRUB1.BIN" }],
    course: [{ start: [0, 0, 0], end: [100, 0, 0], types: "1,0", speeds: "12,70.5,1" }], courseDirection: 1,
    extendedCourses: [null, [{ start: [1, 1, 1], end: [2, 2, 2] }]], extendedCourseDirections: [0, 1],
    stadium: { flag: 1, x: 120, z: 100, sx: 14, sz: 14, modelName: "ARENA.BIN" },
    backdrop: { modelNames: ["BACK.BIN"] },
  });
  const text = new TextDecoder().decode(bytes);
  assert.ok(text.endsWith("backdropModelName\r\nBACK.BIN\r\n"), "every line ends CRLF");
  assert.ok(text.includes("Llight rad,hgt,r,g,b,glow,glowRad,coneLen,coneRim,coneBase,bright,aimOff\r\n80.000000,10.000000,1.00,0.50,0.25,2,"));
  const sit = parseMtmSit(bytes, "TEST.SIT");
  assert.equal(sit.longitudeLatitude, "1,2");
  assert.equal(sit.trucks[1].courseToFollow, 3);
  const [ramp, lamp, body, cab] = sit.boxes;
  assert.equal(ramp.type, 99);
  assert.deepEqual(ramp.rates, [0.5, 0, 0]);
  assert.equal(lamp.priority, 2);
  assert.deepEqual(lamp.bvel, [1, 3, 2]);
  assert.deepEqual(lamp.rates, [0, 0.25, 0]);
  assert.equal(lamp.hitSound, "HIT.WAV");
  assert.equal(lamp.loopSound, "LOOP.WAV");
  assert.deepEqual(lamp.lightFields, [80, 10, 1, 0.5, 0.25, 2, 6, 125, 10, 3.5, 1.25, 4]);
  assert.equal(lamp.light?.bright, 1.25);
  assert.deepEqual([body.crushRole, cab.crushRole], ["body", "cab"]);
  assert.equal(sit.topCrush[0].cabModelName, "CPCRUB1.BIN");
  assert.deepEqual(sit.cylinders, { count: 1, lines: ["*********************************************", "ipos", "1,2,3"] });
  assert.equal(sit.primaryCourse?.direction, 1);
  assert.deepEqual([sit.primaryCourse?.segments[0].cdecPoint, sit.primaryCourse?.segments[0].cspeed, sit.primaryCourse?.segments[0].lastEntry], [12, 70.5, 1]);
  assert.equal(sit.extendedCourses.length, 1);
  assert.equal(sit.extendedCourses[0].slot, 1);
  assert.equal(sit.extendedCourses[0].direction, 1);
  assert.deepEqual(sit.arena, { modelName: "ARENA.BIN", x: 120, y: 100, sx: 14, sy: 14, placed: true });
  assert.deepEqual(sit.backdropModelNames, ["BACK.BIN"]);
});

test("writeMtm2Sit without the ambient line reads back as MTM1, with the older stadium form", () => {
  const bytes = writeMtm2Sit({
    lvlName: "OLD.lvl", trackName: "T", localeName: "L", pictureBmp: "A.BMP", iconBmp: "B.BMP", descriptionTxt: "0,0",
    ambientLine: false, yourTruck: truck(0), vehicles: [], boxes: [], course: [], extendedCourses: [],
    stadium: { placed: false, flag: 1, modelName: "OLDARENA.BIN" },
  });
  const sit = parseMtmSit(bytes, "OLD.SIT");
  assert.equal(sit.origin, "MTM1");
  assert.equal(sit.ambientSound, null);
  assert.deepEqual(sit.arena, { modelName: "OLDARENA.BIN", x: 0, y: 0, sx: 0, sy: 0, placed: false });
  assert.deepEqual(sit.backdropModelNames, []);
});

test("the SIT is written one byte per character, in windows-1252, and refuses what that cannot hold", () => {
  const base = {
    lvlName: "T.lvl", localeName: "L", pictureBmp: "A.BMP", iconBmp: "B.BMP", descriptionTxt: "0,0",
    yourTruck: truck(0), vehicles: [], boxes: [], course: [], extendedCourses: [],
  };
  const bytes = writeMtm2Sit({ ...base, trackName: "Champs-\u00c9lys\u00e9es \u20ac" });
  const sit = parseMtmSit(bytes, "T.SIT");
  assert.equal(sit.trackName, "Champs-\u00c9lys\u00e9es \u20ac");
  assert.ok(bytes.includes(0xc9) && bytes.includes(0x80), "\u00c9 and \u20ac as single bytes");
  assert.throws(() => writeMtm2Sit({ ...base, trackName: "\u4e2d" }), RangeError);
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
  assert.deepEqual([lvl.textName, lvl.zeroRawName, lvl.pupName, lvl.aniName, lvl.tdfName, lvl.defName, lvl.navName, lvl.fogName],
    ["T.TXT", "ZERO.RAW", "T.PUP", "T.ANI", "T.TDF", "T.DEF", "T.NAV", "T.FOG"]);
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
  const palette = decodeActPalette(act);
  assert.ok(palette);
  const image = decodeRawTexture(raw, palette);
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

test("top-crush cars: read by position, model form and size form (MONSTER.EXE 0x551660)", () => {
  const base = new TextDecoder().decode(writeMtm2Sit({
    lvlName: "TEST.LVL", trackName: "T", localeName: "L", pictureBmp: "A.BMP", iconBmp: "B.BMP", descriptionTxt: "T.TXT",
    ambientSound: 0, weatherMask: 1, trackLength: 6000, yourTruck: truck(0), vehicles: [truck(1)], boxes: [],
    course: [{ start: [0, 0, 0], end: [100, 0, 0] }], extendedCourses: [],
  }));
  const record = (form: string[]) => [
    "*******************", "ipos", "200.00,20.00,300.00", "ipos2", "201.00,21.00,302.00", "theta,phi,psi", "0,0,1.5",
    ...form, "mass", "12.5", "bvel", "1,2,3", "p,q,r", "0.1,0.2,0.3",
  ];
  const section = ["*** Top Crush ***", "2",
    ...record(["modelName", "CAR.BIN", "cabModelName", "CARCAB.BIN"]),
    ...record(["length,width,height", "16,8,5", "length2,width2,height2", "10,7,9"])];
  const text = base.replace("*** Top Crush ***\r\n0", section.join("\r\n"));
  const sit = parseMtmSit(new TextEncoder().encode(text), "TEST.SIT");
  assert.equal(sit.topCrush.length, 2);
  const [a, b] = sit.topCrush;
  assert.equal(a.modelName, "CAR.BIN");
  assert.equal(a.cabModelName, "CARCAB.BIN");
  assert.equal(a.sizeFt, null);
  assert.deepEqual(a.positionFt, [200, 20, 300]);
  assert.deepEqual(a.position2Ft, [201, 21, 302]);
  assert.equal(a.psi, 1.5);
  assert.equal(a.mass, 12.5);
  assert.deepEqual(a.bvel, [1, 2, 3]);
  assert.deepEqual(a.rates, [0.1, 0.2, 0.3]);
  assert.equal(b.modelName, "");
  assert.deepEqual(b.sizeFt, [16, 8, 5]);
  assert.deepEqual(b.size2Ft, [10, 7, 9]);
  assert.equal(sit.boxes.filter((x) => x.crushRole).length, 4);
});
