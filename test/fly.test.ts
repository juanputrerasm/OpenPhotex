import test from "node:test";
import assert from "node:assert/strict";
import {
  parseFlyTagged, flyTag, parseFlyAngle, flyRowLatitude, flyColumnLongitude, flyTileBounds, flyTileAt,
  parseFlyFolderName, flyFolderName, parseFlyTextureName, parseFlyScf, parseFlySceneryObjects, parseFlyAlt,
  parseFlyTex, parseFlyTyp, parseFlyRef, parseFlyAl2, parseFlyQuadrant, FLY_ALT_SIDE, parseFlyBsp, writeBin, MRGL,
} from "../src/index.ts";
import { latin1 } from "./fixtures/build.ts";

const crlf = (lines: string[]) => latin1(lines.join("\r\n") + "\r\n");

test("Fly tagged text: values, comments, owned blocks and the file block", () => {
  const tags = parseFlyTagged(crlf([
    "<bgno> ==== BEGIN ====",
    "\t<name> ---- set name ----",
    "\tSan Francisco",
    "<grid> ---- grid ----",
    "2",
    "<bgno> ---- entry ----",
    "\t<mpxy>", "\t100", "\t77",
    "<endo>",
    "<bgno>",
    "\t<mpxy>", "\t454", "\t88",
    "<endo>",
    "<id  >",
    "mobj2",
    "<endo> ==== END ====",
  ]));
  assert.deepEqual(tags.map((t) => t.tag), ["name", "grid", "id"]);
  assert.deepEqual(flyTag(tags, "name")?.values, ["San Francisco"]);
  const grid = flyTag(tags, "grid")!;
  assert.deepEqual(grid.values, ["2"]);
  assert.equal(grid.blocks.length, 2);
  assert.deepEqual(grid.blocks[1][0].values, ["454", "88"]);
  // "<id  >" loses its padding.
  assert.deepEqual(flyTag(tags, "id")?.values, ["mobj2"]);
  assert.throws(() => parseFlyTagged("<name>\nx\n<endo>\n"), /<endo> without/);
});

test("Fly angles: all three spellings, signed", () => {
  assert.ok(Math.abs(parseFlyAngle("36 43 17.33 N")! - (36 + 43 / 60 + 17.33 / 3600)) < 1e-12);
  assert.ok(Math.abs(parseFlyAngle("123 45 00.00 W")! + 123.75) < 1e-12);
  assert.ok(Math.abs(parseFlyAngle("37 54'43.8401\"N")! - (37 + 54 / 60 + 43.8401 / 3600)) < 1e-12);
  assert.ok(Math.abs(parseFlyAngle("34 17'N")! - (34 + 17 / 60)) < 1e-12);
  assert.ok(parseFlyAngle("12 30'S")! < 0);
  assert.equal(parseFlyAngle("nonsense"), null);
});

/*
  The row edges below are the ones the stock .SCF files name (docs/FLY.md): the recurrence has
  to reproduce them, so they are facts to test against rather than outputs of the code.
*/
test("Fly globe tiles: row latitudes, column longitudes, lookup", () => {
  assert.equal(flyRowLatitude(128), 0);
  const scf: [number, string][] = [
    [152, "32 02 58.58"], [153, "33 14 29.51"], [155, "35 34 39.87"], [156, "36 43 17.33"], [158, "38 57 32.71"],
    [159, "40 03 09.29"], [160, "41 07 44.40"], [161, "42 11 17.63"], [162, "43 13 48.65"],
  ];
  for (const [row, text] of scf) {
    assert.ok(Math.abs(flyRowLatitude(row) - parseFlyAngle(`${text} N`)!) < 0.01 / 3600, `row ${row}`);
  }
  assert.equal(flyRowLatitude(100), -flyRowLatitude(156));
  assert.equal(flyColumnLongitude(168), -123.75);
  assert.equal(flyColumnLongitude(0), 0);
  const tile = flyTileBounds(169, 156);
  assert.equal(tile.west, -122.34375);
  assert.equal(tile.east, -120.9375);
  assert.equal(tile.north, flyRowLatitude(157));
  // Mount Diablo: tile D169157, about 20 cells east and 2 north of its corner.
  const at = flyTileAt(37.8816, -121.9142);
  assert.deepEqual([at.column, at.row, Math.floor(at.x), Math.floor(at.y)], [169, 157, 19, 1]);
  assert.deepEqual(parseFlyFolderName("D168156"), { first: 168, second: 156 });
  assert.equal(parseFlyFolderName("G00"), null);
  assert.equal(flyFolderName(61, 50), "D061050");
});

test("Fly texture names: folder and row-major place", () => {
  // 0x643A9672 = 1681561202: tile D168156, cell 1202 = row 18, column 50.
  assert.deepEqual(parseFlyTextureName("DATA\\D168156\\643A9672.RAW"), { folderFirst: 168, folderSecond: 156, x: 50, y: 18 });
  // 0x24637DA0 = 0610500000 (nine digits, padded): detail folder D061050, sub-texture 0.
  assert.deepEqual(parseFlyTextureName("24637DA0.RAW"), { folderFirst: 61, folderSecond: 50, x: 0, y: 0 });
  // 0x24637DE1 = 0610500065: row 1, column 1.
  assert.deepEqual(parseFlyTextureName("24637de1.raw"), { folderFirst: 61, folderSecond: 50, x: 1, y: 1 });
  assert.equal(parseFlyTextureName("wt000s1.raw"), null);
});

test("Fly .SCF manifest", () => {
  const scf = parseFlyScf(crlf([
    "<bgno> ==== BEGIN SCENERY FILE ====",
    "\t<name> ---- scenery set name ----", "\tSan Francisco",
    "\t<call> ---- coverage area lower left ----", "\t36 43 17.33 N", "\t123 45 00.00 W",
    "\t<caur> ---- coverage area upper right ----", "\t38 57 32.71 N", "\t120 56 15.00 W",
    "\t<ldll> ---- load lower left ----", "\t35 34 39.87 N", "\t125 09 22.50 W",
    "\t<ldur> ---- load upper right ----", "\t40 03 09.29 N", "\t119 31 52.50 W",
    "\t<file> ---- pod file ----", "\tsanfran1.epd",
    "\t<file> ---- pod file ----", "\tsfmodels.epd",
    "<endo> ==== END SCENERY FILE ====",
  ]));
  assert.equal(scf.name, "San Francisco");
  assert.deepEqual(scf.files, ["sanfran1.epd", "sfmodels.epd"]);
  assert.equal(scf.coverage?.west, -123.75);
  assert.ok(Math.abs(scf.load!.north - flyRowLatitude(159)) < 1e-5);
});

test("Fly SCENERY.Sxx objects: position, orientation, parts, distance models, beacons", () => {
  const { objects, warnings } = parseFlySceneryObjects(crlf([
    "<bgno>",
    "<wobj>", "mobj", "<bgno>",
    "<geop>", "37 54'43.8401\"N", "122 22'41.5354\"W", "139.93359375",
    "<type>", "mobj", "<flag>", "-2147483339", "<detl>", "1", "<id  >", "mobj2", "<name>", "Blue Gas Tank",
    "<mmgr>", "<bgno>", "<simu>", "comp", "<modl>", "comp", "BLUTANK.BIN", "<endo>",
    "<iang>", "0.000000,0.067196,0.000000",
    "<endo>",
    "<wobj>", "mobj", "<bgno>",
    "<geop>", "37 48'00.0\"N", "122 28'00.0\"W", "10.",
    "<type>", "mobj", "<id  >", "mobj3", "<name>", "NO-NAME",
    "<mmgr>", "<bgno>", "<simu>", "comp",
    "<mdst>", "comp", "GOLD1.BSP", "0", "14000",
    "<mdst>", "comp", "GOLD2.BSP", "14000", "1000000", "<endo>",
    "<iang>", "0.000000,3.060057,0.000000",
    "<endo>",
    "<wobj>", "becn", "<bgno>",
    "<geop>", "37 00'00.0\"N", "122 00'00.0\"W", "5",
    "<type>", "becn", "<id  >", "becn1", "<mmgr>", "<bgno>", "<modl>", "comp", "beach.arm", "<endo>",
    "<lens>", "2",
    "<endo>",
    "<wobj>", "mobj", "<bgno>", "<id  >", "broken", "<endo>",
    "<endo>",
  ]), "TEST.S11");
  assert.equal(objects.length, 3);
  const [tank, bridge, beacon] = objects;
  assert.equal(tank.name, "Blue Gas Tank");
  assert.equal(tank.flag, -2147483339);
  assert.equal(tank.snapToGround, true);
  assert.equal(tank.altitude, 139.93359375);
  assert.ok(tank.longitude < 0 && tank.latitude > 37.9);
  assert.deepEqual(tank.orientation, [0, 0.067196, 0]);
  assert.deepEqual(tank.models, [{ part: "comp", file: "BLUTANK.BIN", near: null, far: null }]);
  assert.deepEqual(bridge.models.map((m) => [m.file, m.near, m.far]), [["GOLD1.BSP", 0, 14000], ["GOLD2.BSP", 14000, 1000000]]);
  assert.equal(bridge.snapToGround, false);
  assert.equal(beacon.kind, "becn");
  assert.equal(beacon.lens, 2);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /broken/);
});

/** A .ALT whose height at (x, y) is 1000 * x + y, written column by column. */
function altFixture(): Uint8Array {
  const bytes = new Uint8Array(FLY_ALT_SIDE * FLY_ALT_SIDE * 4);
  const view = new DataView(bytes.buffer);
  for (let x = 0; x < FLY_ALT_SIDE; x++) {
    for (let y = 0; y < FLY_ALT_SIDE; y++) view.setFloat32((x * FLY_ALT_SIDE + y) * 4, 1000 * x + y, true);
  }
  return bytes;
}

/** Cell 0 plain, cell 1 kind 1 split 2 x 2, cell 2 kind 2 split 2 x 2, cell 3 kind 1 split 4 x 4. */
function typLines(): string[] {
  const lines = new Array(1024).fill("type:0: 1,1");
  lines[1] = "type:1: 2,2";
  lines[2] = "type:2: 2,2";
  lines[3] = "type:1: 4,4";
  return lines;
}

test("Fly quadrant: .ALT, .TEX, .TYP, .REF and .AL2", () => {
  const alt = parseFlyAlt(altFixture());
  assert.equal(alt[5 * FLY_ALT_SIDE + 7], 5007);
  assert.throws(() => parseFlyAlt(new Uint8Array(10)), /expected 4356/);

  assert.deepEqual(parseFlyTex(crlf(["2", "wt000s1.raw", "643A9672.RAW"])), ["wt000s1.raw", "643A9672.RAW"]);
  assert.throws(() => parseFlyTex(crlf(["3", "a.raw"])), /3 textures promised/);

  const types = parseFlyTyp(crlf(typLines()));
  assert.deepEqual(types.slice(0, 4), [
    { kind: 0, divisions: 1 }, { kind: 1, divisions: 2 }, { kind: 2, divisions: 2 }, { kind: 1, divisions: 4 },
  ]);
  assert.throws(() => parseFlyTyp(crlf(["type:0: 1,1"])), /1 cells, expected 1024/);

  const refLines = Array.from({ length: 1024 }, (_, i) => String(i % 7));
  refLines.splice(3, 0, "5 6 ", "-1 4 ");  // after cell 2's own line
  const ref = parseFlyRef(crlf(refLines), types);
  assert.equal(ref.cellTextures[2], 2);
  assert.equal(ref.cellTextures[3], 3);
  assert.deepEqual(ref.cellSubTextures[2], [5, 6, -1, 4]);
  assert.equal(ref.cellSubTextures[1], null);
  assert.throws(() => parseFlyRef(crlf(refLines.slice(0, 1025)), types), /expected 1 index/);

  const block = (side: number, base: number) =>
    Array.from({ length: side }, (_, x) => Array.from({ length: side }, (_, y) => (base + 10 * x + y).toFixed(6)).join(" ") + " ");
  const al2 = parseFlyAl2(crlf([...block(3, 100), ...block(3, 200), ...block(5, 300)]), types);
  assert.equal(al2[0], null);
  assert.equal(al2[1]!.length, 9);
  assert.equal(al2[1]![1 * 3 + 2], 112);
  assert.equal(al2[2]![2 * 3 + 0], 220);
  assert.equal(al2[3]![4 * 5 + 4], 344);
  assert.throws(() => parseFlyAl2(crlf(block(3, 0)), types), /cell 2 expected 3 heights/);

  const quadrant = parseFlyQuadrant({
    alt: altFixture(), typ: crlf(new Array(1024).fill("type:0: 1,1")), tex: crlf(["1", "a.raw"]),
    ref: crlf(new Array(1024).fill("0")), al2: new Uint8Array(0),
  });
  assert.equal(quadrant.cellHeights.every((h) => h === null), true);
  assert.equal(quadrant.textures[0], "a.raw");
});

/*
  A .BSP in miniature: four vertices, and two BSP nodes each carrying the MRGL records of one
  textured face, the second node in front of the first. The records are what writeBin puts
  after a .BIN's vertex list, which is exactly what a .BSP node holds.
*/
function bspFixture(options: { dropEol?: boolean } = {}): Uint8Array {
  const vertices = [0, 0, 0, 25600, 0, 0, 25600, 0, 25600, 0, 0, 25600];
  const records = (texture: string, corners: number[]) => {
    const bytes = writeBin({ vertices, groups: [{ texture, opcode: MRGL.ZGFACETTMAP, faces: [{ vertexIndices: corners, u: [0, 0, 0], v: [0, 0, 0xff0000] }] }] }).bytes;
    return bytes.subarray(20 + vertices.length * 4, options.dropEol ? bytes.length - 4 : bytes.length);
  };
  const tag = (name: string) => latin1(`<${name}>\0`);
  const sized = (data: Uint8Array) => {
    const out = new Uint8Array(4 + data.length);
    new DataView(out.buffer).setUint32(0, data.length, true);
    out.set(data, 4);
    return out;
  };
  const vbin = new Uint8Array(new Int32Array(vertices).buffer);
  const plane = new Uint8Array(new Float32Array([0, 1, 0, 0]).buffer);
  const parts = [
    tag("bgno"), tag("vbin"), sized(vbin), tag("ibin"), sized(new Uint8Array(vbin.length)), tag("root"),
    tag("bgno"), tag("abcd"), plane, tag("mrgl"), records("A.RAW", [0, 1, 2]),
    tag("frnt"), tag("bgno"), tag("abcd"), plane, tag("mrgl"), records("B.RAW", [0, 2, 3]), tag("endo"),
    tag("endo"), tag("endo"),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

test("Fly .BSP: every node's faces over the shared vertices", () => {
  const { model, nodeCount } = parseFlyBsp(bspFixture());
  assert.equal(nodeCount, 2);
  assert.equal(model.kind, "mrgl");
  assert.equal(model.vertices.length, 12);
  assert.deepEqual(model.faces.map((f) => [f.textureName, f.vertexIndices]), [["A.RAW", [0, 1, 2]], ["B.RAW", [0, 2, 3]]]);
  assert.equal(model.stopReason, null);
  assert.throws(() => parseFlyBsp(bspFixture({ dropEol: true })), /does not end in MRGL_EOL/);
  assert.throws(() => parseFlyBsp(latin1("<bgno>\0<zzzz>\0")), /unknown tag <zzzz>/);
  assert.throws(() => parseFlyBsp(latin1("<bgno>\0<endo>\0")), /no <vbin>/);
});
