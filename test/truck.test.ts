/*
  Truck and car manifests (MTM TRK, CPR CAR, and dialect detection) and CPR .CMD car models.
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  cmdFaceTriangles, cmdWingPackages, detectTruckManifest, parseCprCarLines, parseCprCmd, parseMtmTrkLines,
  parseTruckManifest, truckManifestLines, MTM_WHEEL_KEYS,
} from "../src/index.ts";

const lines = (...l: string[]) => truckManifestLines(l.join("\r\n"));

test("MTM2: header, unlabelled name, .x/.y/.z anchors, lights, wave run", () => {
  const trk = parseMtmTrkLines(lines(
    "MTM2 truckName", "Bigfoot", "truckModelBaseName", "bigfoot", "tireModelBaseName", "bfc",
    "axlebarOffset", "1.55,-2.67,0.2", "faxle.rtire.static_bpos.x", "4.292", "faxle.rtire.static_bpos.y", "-1",
    "faxle.rtire.static_bpos.z", "5", "Scrape point 1", "1,2,3", "Wave File", "bfootf.wav", "bfootu.wav", "bfootd.wav",
    "Number of Lights", "1", "Light 0 type", "1", "Light 0 body axis pos (x,y,z)", "1,2,3", "somethingElse", "7",
  ));
  assert.equal(trk.dialect, "MTM2");
  assert.equal(trk.header, "MTM2 truckName");
  assert.equal(trk.truckName, "Bigfoot");
  assert.equal(trk.truckModelBaseName, "bigfoot");
  assert.deepEqual(trk.axlebarOffset, { x: 1.55, y: -2.67, z: 0.2 });
  assert.deepEqual(trk.wheelAnchors[MTM_WHEEL_KEYS[0]], { x: 4.292, y: -1, z: 5 });
  assert.deepEqual(trk.waveFiles, ["bfootf.wav", "bfootu.wav", "bfootd.wav"]);
  assert.equal(trk.lights[0].type, 1);
  // Three values: the radius is absent, not defaulted; that is the viewer's choice.
  assert.equal(trk.lights[0].bitmapRadius, null);
  assert.deepEqual(trk.lights[0].propertyLabels, ["type", "body axis pos (x,y,z)"]);
  assert.deepEqual(trk.unknownFields, { somethingElse: "7" });
  assert.equal(trk.shockTextureName, null);
});

test("MTM1: no header, full model file names; MTM2.1's superior axle-bar offset", () => {
  const mtm1 = parseMtmTrkLines(lines("truckName", "Bearfoot", "truckModelName", "bearfoot.bin", "tireModelName", "tire.bin"));
  assert.equal(mtm1.dialect, "MTM1");
  assert.equal(mtm1.header, null);
  assert.equal(mtm1.truckModelBaseName, "bearfoot.bin");
  const mtm21 = parseMtmTrkLines(lines("MTM2.1 truckName", "X", "superiorAxlebarOffset", "1,2,3"));
  assert.equal(mtm21.dialect, "MTM2.1");
  assert.deepEqual(mtm21.superiorAxlebarOffset, { frontAxleY: 1, rearAxleY: 2, middleY: 3 });
});

test("CPR CAR: detected by its helmet/pace-car labels; four wheel models in file order", () => {
  const car = lines(
    "truckName", "Newman-Haas", "truckModelName", "nh.cmd", "tireModelName", "lf.bin", "rf.bin", "lr.bin", "rr.bin",
    "Helmet name", "helmet.bin", "Helmet pos", "0,1,2", "paceCarFlag", "0", "Wave File", "a.wav", "b.wav",
    "Scrape point 1", "1,1,1",
  );
  assert.equal(detectTruckManifest(car), "cpr-car");
  const parsed = parseCprCarLines(car);
  assert.equal(parsed.truckModelName, "nh.cmd");
  assert.deepEqual(parsed.wheelModelNames, {
    "faxle.ltire.static_bpos": "lf.bin", "faxle.rtire.static_bpos": "rf.bin",
    "raxle.ltire.static_bpos": "lr.bin", "raxle.rtire.static_bpos": "rr.bin",
  });
  assert.deepEqual(parsed.helmetPosition, { x: 0, y: 1, z: 2 });
  assert.deepEqual(parsed.waveFiles, ["a.wav", "b.wav"]);
  assert.equal(parsed.scrapePoints.length, 1);
  // The same opening without a CPR label is an MTM1 truck.
  assert.equal(detectTruckManifest(lines("truckName", "Bearfoot", "truckModelName", "x.bin")), "mtm");
});

test("parseTruckManifest dispatches all three dialects", () => {
  assert.equal(parseTruckManifest("version\r\n6\r\ntruckName\r\nBlazer\r\n").kind, "evo");
  assert.equal(parseTruckManifest("MTM2 truckName\r\nBigfoot\r\n").kind, "mtm");
  assert.equal(parseTruckManifest("gtruckName\r\nX\r\npaceCarFlag\r\n1\r\n").kind, "cpr-car");
});

const CMD = [
  "name", "Test Car", "lowDetailName", "test.bin", "lowDetailCenterZ", "-512", "material", "test.raw",
  "partName", "BODY", "vertexCount", "4", "faceCount", "2", "center", "256,0,0", "angle", "0,0,0",
  "vertexList", "0,0,0", "256,0,0", "256,0,256", "0,0,256",
  "normalList", "0,65536,0", "0,65536,0", "0,65536,0", "0,65536,0",
  "faceList", "41,4", "0,65536,0,0", "0,0,0", "1,16711680,0", "2,16711680,16711680", "3,0,16711680",
  "41,3", "0,0,0,0", "0,0,0", "1,0,0", "2,0,0",
  "partName", "RWING", "vertexCount", "1", "faceCount", "0", "center", "0,0,0", "angle", "0,1,0",
  "vertexList", "1,2,3", "normalList", "0,0,1", "faceList",
  "partName", "RWING1", "vertexCount", "0", "faceCount", "0", "center", "0,0,0", "angle", "0,0,0",
  "vertexList", "normalList", "faceList",
].join("\r\n");

test("CMD: header, parts with raw fixed-point numbers, faces as written", () => {
  const cmd = parseCprCmd(CMD, "TEST.CMD");
  assert.deepEqual([cmd.displayName, cmd.lowDetailName, cmd.lowDetailCenterZ, cmd.textureName], ["Test Car", "test.bin", -512, "test.raw"]);
  const body = cmd.parts[0];
  assert.deepEqual(body.center, { x: 256, y: 0, z: 0 });
  assert.deepEqual([...body.vertices.subarray(3, 6)], [256, 0, 0]);
  assert.equal(body.faces[0].type, 0x29);
  assert.deepEqual(body.faces[0].plane, [0, 65536, 0, 0]);
  assert.deepEqual(body.faces[0].corners[2], { vertexIndex: 2, u: 0xff0000, v: 0xff0000 });
  assert.equal(body.faces[1].corners.length, 3);
  assert.deepEqual(cmd.warnings, ["Part RWING has a non-zero angle; its rotation convention is not yet known."]);
});

test("CMD: wing packages exist only where both partners do", () => {
  assert.deepEqual(cmdWingPackages(["BODY", "RWING", "RWING1", "SPDFIN", "LFWING1"]), { roadCourse: ["RWING"], speedway: ["RWING1", "SPDFIN"] });
  assert.equal(cmdWingPackages(["BODY", "RWING1"]), null);
});

test("CMD: a quad splits along the diagonal whose triangles agree", () => {
  // A folded quad: corners 0 and 2 are lifted, so only the 1-3 diagonal keeps both halves level.
  const fold = [{ x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, { x: 0, y: 1, z: 0 }];
  const flat = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }];
  assert.deepEqual(cmdFaceTriangles(flat), [[0, 1, 2], [0, 2, 3]]);
  assert.equal(cmdFaceTriangles(fold).length, 2);
  assert.deepEqual(cmdFaceTriangles(flat.slice(0, 3)), [[0, 1, 2]]);
  assert.deepEqual(cmdFaceTriangles([...flat, { x: 0.5, y: 2, z: 0 }]), [[0, 1, 2], [0, 2, 3], [0, 3, 4]]);
});

test("CMD: refusals name the line", () => {
  assert.throws(() => parseCprCmd("name\r\nX\r\nlowDetailName", "A.CMD"), /Missing low-detail model name/);
  assert.throws(() => parseCprCmd(CMD.replace("3,0,16711680", "9,0,16711680"), "B.CMD"), /Invalid vertex index 9 in part BODY near line/);
  assert.throws(() => parseCprCmd(CMD.replace("41,3", "41,2"), "C.CMD"), /Invalid corner count 2/);
});
