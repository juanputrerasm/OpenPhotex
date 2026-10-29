/*
  The level formats: CPR's .TRK/.TTX track layer, the TV-family .LVL, coordinates, sky
  gradient, ground boxes and Hellbender's cavern. Synthetic inputs only; the stock checks are in
  stock.test.ts.
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  CPR_WALL_LAYERS,
  HB_POWERUPS,
  HB_UNDERGROUND_BIAS,
  cellTriangleHeight,
  decodeClrGrid,
  heightAtPoint,
  hbPowerup,
  parseHbQuakes,
  parseHbNavPoints,
  parsePowerups,
  parseTvTunnel,
  tunnelSegmentGeometry,
  TUNNEL_SEGMENT_LENGTH,
  cprCheckpointRole,
  cprSegmentPairs,
  cprTextureIndex,
  cprTextureSlice,
  cprTextureU,
  cprTrackIsClosed,
  cprVisibleSlots,
  decodeClrWord,
  decodeGroundBoxes,
  decodeHbUnderground,
  hbPlacementToEditor,
  isCprPitCheckpoint,
  isDegenerateSlot,
  isNullAssetName,
  parseCprTrk,
  buildCprRoad,
  CPR_TREE_WALL,
  CPR_WALL_PART_HEIGHT_FT,
  parseCprTtx,
  parseTvLvl,
  skyGradient,
  skyHorizon,
  tvLvlFallbackName,
  tvPlacementToEditor,
} from "../src/index.ts";

/** One .TRK record with `points` cross section points, all walls 0 except those given. */
function trkRecord(along: number, points = 3, walls: Record<number, number> = {}): string[] {
  const segments = points - 1;
  const lines = ["pointCount", String(points), "segmentCount", String(segments), "curveFlag", "1", "p", `0,5,${along}`];
  lines.push("type", ...Array.from({ length: segments }, (_, i) => String(i % 3)));
  lines.push("plist", ...Array.from({ length: points }, (_, i) => `${i * 10},5,${along}`));
  lines.push("!texture", ...Array.from({ length: segments }, (_, i) => `${i | 0x2000},262144,16384000,262144,16384000`));
  lines.push("wallType", ...Array.from({ length: points }, (_, i) => String(walls[i] ?? 0)));
  lines.push("wallTexture", ...Array.from({ length: points }, () => "7,4103,4103,4103"));
  lines.push("h", "0,1,0");
  lines.push("pointOffset", ...Array.from({ length: points }, (_, i) => String(i === 1 ? 0 : i * 10)));
  lines.push("!altitude", "5", "grade", "0.5", "%interpGrade", "0.25", "w", "30,32");
  lines.push("^heightOffset", ...Array.from({ length: points }, () => "0"));
  return lines;
}

function trkText(records: string[][], count = records.length): string {
  const header = ["CRaceTrack.trackCount", String(count), "CRaceTrack.trackBackground", "test.raw", "CRaceTrack.scale", "0.999987", "CRaceTrack.length", "120.5"];
  return [...header, ...records.flat()].join("\r\n") + "\r\n";
}

test("parseCprTrk reads the header and every labelled field of a record", () => {
  const trk = parseCprTrk(new TextEncoder().encode(trkText([trkRecord(0), trkRecord(40)])));
  assert.ok(trk);
  assert.equal(trk.trackCount, 2);
  assert.equal(trk.background, "test.raw");
  assert.equal(trk.scale, 0.999987);
  assert.equal(trk.length, 120.5);
  assert.equal(trk.surfaces.length, 2);
  const s = trk.surfaces[1];
  assert.equal(s.curveFlag, 1);
  assert.deepEqual(s.anchor, [0, 5, 40]);
  assert.deepEqual(s.segmentTypes, [0, 1]);
  assert.deepEqual(s.points, [[0, 5, 40], [10, 5, 40], [20, 5, 40]]);
  assert.deepEqual(s.textureIndexes, [0x2000, 0x2001]);
  assert.deepEqual(s.textureCoordinates[0], [0x2000, 262144, 16384000, 262144, 16384000]);
  assert.deepEqual(s.wallTextures[0], [7, 4103, 4103, 4103]);
  assert.deepEqual(s.normal, [0, 1, 0]);
  assert.equal(s.altitude, 5);
  assert.equal(s.grade, 0.5);
  assert.equal(s.interpolatedGrade, 0.25);
  assert.equal(s.width, 30);
  assert.equal(s.interpolatedWidth, 32);
  assert.deepEqual(s.heightOffsets, [0, 0, 0]);
});

test("parseCprTrk: no count is null, a broken record ends the list", () => {
  assert.equal(parseCprTrk("pointCount\n3\n"), null);
  const broken = trkRecord(40);
  broken[broken.indexOf("wallType")] = "wallKind";
  const trk = parseCprTrk(trkText([trkRecord(0), broken, trkRecord(80)]));
  assert.equal(trk?.trackCount, 3);
  assert.equal(trk?.surfaces.length, 1);
});

test("parseCprTtx normalizes names and reads the surface type", () => {
  assert.deepEqual(parseCprTtx("3\r\nlagsand3.raw,3\r\nart\\tored.raw,0\r\nplain.raw\r\n"), [
    { name: "LAGSAND3.RAW", flags: 3 },
    { name: "ART/TORED.RAW", flags: 0 },
    { name: "PLAIN.RAW", flags: 0 },
  ]);
});

test("CPR texture references and coordinates", () => {
  assert.equal(cprTextureIndex(0x2005), 5);
  assert.equal(cprTextureSlice(0x2005), 2);
  assert.equal(cprTextureIndex(undefined), 0);
  assert.equal(cprTextureU(262144), 1 / 64);
  assert.equal(cprTextureU(16384000), 250 / 256);
});

test("CPR slots: degenerate slots and the visible range between the outer walls", () => {
  const surface = { pointOffsets: [0, 0, 10], points: [] as number[][] };
  assert.equal(isDegenerateSlot(surface, 0), true);
  assert.equal(isDegenerateSlot(surface, 1), false);
  assert.equal(isDegenerateSlot({ pointOffsets: [], points: [[1, 2, 3], [1, 2, 3]] }, 0), true);

  const points = Array.from({ length: 20 }, (_, i) => [i, 0, 0]);
  const walls = new Array(20).fill(0);
  assert.deepEqual(cprVisibleSlots({ points, wallTypes: walls }), { first: 0, last: 18 });
  walls[3] = 1; walls[5] = 2; walls[16] = 3; walls[18] = 99;
  assert.deepEqual(cprVisibleSlots({ points, wallTypes: walls }), { first: 3, last: 15 });
  assert.equal(CPR_WALL_LAYERS[5].filter((l) => l.fence).length, 1);
});

test("a CPR track closes when its last section runs on into its first", () => {
  const ring = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    const c = [Math.cos(a) * 100, 0, Math.sin(a) * 100];
    return { points: Array.from({ length: 20 }, () => c) };
  });
  assert.equal(cprTrackIsClosed(ring), true);
  assert.deepEqual(cprSegmentPairs(ring).at(-1), [11, 0]);
  const line = ring.slice(0, 6);
  assert.equal(cprTrackIsClosed(line), false);
  assert.equal(cprSegmentPairs(line).length, 5);
});

test("CPR checkpoint roles follow file order", () => {
  assert.equal(cprCheckpointRole(0, 7), "pitEntry");
  assert.equal(cprCheckpointRole(3, 7), "startFinish");
  assert.equal(cprCheckpointRole(5, 7), "gate");
  assert.equal(cprCheckpointRole(0, 3), "gate");
  assert.equal(isCprPitCheckpoint("pitSpeedLimitEnd"), true);
  assert.equal(isCprPitCheckpoint("startFinish"), false);
});

test("parseTvLvl reads the positional header and the display name", () => {
  const lines = ["; header", "null.txt", "levels\\lev1.raw", "lev1.clr", "lev1.act", "lev1.tex", "x", "NULL.PUP",
    "lev1.ani", "lev1.tdf", "sky.raw", "bluesky.act", "lev1.def", "lev1.nav", "track 3", "x", "lev1.lte",
    "1,2,3", "40", "4,5,6", "90", "7", "Frozen Wastes"];
  const lvl = parseTvLvl(lines.join("\r\n"));
  assert.equal(lvl.origin, "TV/F3");
  assert.equal(lvl.complete, true);
  assert.equal(lvl.rawOrTnlName, "LEVELS/LEV1.RAW");
  assert.equal(lvl.skyActName, "BLUESKY.ACT");
  assert.equal(isNullAssetName(lvl.pupName), true);
  assert.equal(isNullAssetName(lvl.defName), false);
  assert.deepEqual(lvl.sunVector, [1, 2, 3]);
  assert.equal(lvl.levelValue, 7);
  assert.equal(lvl.displayName, "Frozen Wastes");
  assert.equal(parseTvLvl([...lines, "!New ground additions"].join("\n")).origin, "HB");
  assert.equal(tvLvlFallbackName("LEVELS\\LEV1.LVL"), "LEV1");
});

test("TV and Hellbender placements convert on their own scales", () => {
  assert.deepEqual(tvPlacementToEditor(3 * (1 << 20), 4 * (1 << 15), -(1 << 20), 256), [192, 255 * 64, 4]);
  assert.deepEqual(tvPlacementToEditor(0, -5, 0, 256)[2], 0);
  assert.deepEqual(hbPlacementToEditor(2 * 8 * 65536, -65536, 0, 128), [128, 0, -2]);
});

test("the sky gradient is 16 colours from colour 192, the last one the horizon", () => {
  const act = new Uint8Array(768).map((_, i) => i & 0xff);
  const gradient = skyGradient(act);
  assert.ok(gradient);
  assert.equal(gradient.length, 48);
  assert.equal(gradient[0], (192 * 3) & 0xff);
  assert.deepEqual(skyHorizon(gradient), [(207 * 3) & 0xff, (207 * 3 + 1) & 0xff, (207 * 3 + 2) & 0xff]);
  assert.equal(skyGradient(new Uint8Array(600)), null);
});

test("ground boxes: .CLR words, empty cells and face textures", () => {
  assert.deepEqual(decodeClrWord(0xd123), { texture: 0x123, mirror: 1, rotation: 3 });
  const ra0 = new Uint8Array([0, 2, 0, 0]);
  const ra1 = new Uint8Array([0, 6, 0, 0]);
  const cl0 = new Uint8Array(48);
  cl0[12] = 0x05; cl0[13] = 0x40;
  const boxes = decodeGroundBoxes(ra0, ra1, cl0, 2, -256);
  assert.equal(boxes.length, 1);
  const [box] = boxes;
  assert.equal(box.x, 1);
  assert.equal(box.y, 0);
  assert.equal(box.lower, -254);
  assert.equal(box.upper, -250);
  assert.equal(box.midX, 96);
  assert.equal(box.midZ, 4 - 256);
  assert.equal(box.faceTexture[0], 5);
  assert.equal(box.faceRotation[0], 1);
  assert.deepEqual(decodeGroundBoxes(ra0, ra1, null, 2)[0].faceTexture, [-1, -1, -1, -1, -1, -1]);
  assert.deepEqual(decodeGroundBoxes(ra0, ra1, new Uint8Array(10), 2), []);
});

test("Hellbender cavern: hollow cells, the grown mask and the split texture words", () => {
  const n = 4;
  const floor = new Uint8Array(n * n).fill(10);
  const ceiling = new Uint8Array(n * n).fill(10);
  ceiling[0] = 12; // a gap of 2 is "solid"
  ceiling[5] = 30; // cell (1,1) is hollow
  const cl1 = new Uint8Array(n * n * 4);
  cl1.set([1, 2, 3, 4], 5 * 4);
  const cave = decodeHbUnderground(floor, ceiling, cl1, n);
  assert.ok(cave);
  assert.equal(HB_UNDERGROUND_BIAS, -255);
  assert.equal(cave.hollowCellCount, 1);
  // The hollow cell and its eight neighbours; (3,3) is out of reach.
  assert.equal(cave.mask.reduce((a, b) => a + b, 0), 9);
  assert.equal(cave.mask[15], 0);
  assert.deepEqual([...cave.floorClr.subarray(10, 12)], [1, 2]);
  assert.deepEqual([...cave.ceilingClr.subarray(10, 12)], [3, 4]);
  assert.equal(decodeHbUnderground(floor, floor, null, n), null);
  assert.equal(decodeHbUnderground(floor, null, null, n), null);
});

test("CPR walls (CART.EXE 0x4473b0, 0x44be30, 0x44a1a0): a tree point holds only a tree; a tree is a 60 ft card, never solid; a panel is 4 ft", () => {
  // Twenty points: 2 and 17 are the tree points. Point 2 says Tall wall, point 17 Tree, point 0 Very tall.
  const trk = parseCprTrk(trkText([trkRecord(0, 20, { 0: 4, 2: 2, 17: 7 }), trkRecord(40, 20, { 0: 4, 2: 2, 17: 7 })]))!;
  assert.equal(trk.surfaces[0]!.wallTypes[2], 0, "the game clears a wall on a tree point");
  assert.equal(trk.surfaces[0]!.wallTypes[17], CPR_TREE_WALL);
  assert.equal(trk.surfaces[0]!.wallTypes[0], 4);
  assert.equal(CPR_WALL_PART_HEIGHT_FT, 4);
  const road = buildCprRoad(trk.surfaces);
  const tree = road.walls.find((w) => w.point === 17)!, tall = road.walls.find((w) => w.point === 0)!;
  assert.equal(tree.heightFt, 60);
  assert.equal(tree.solid, false);
  assert.equal(tall.heightFt, 16, "a Very tall wall: four 4 ft panels");
  assert.equal(tall.solid, true);
});

test("Hellbender cavern: narrow .CL1 (one byte per word) reads as bare texture indices", () => {
  const n = 2;
  const floor = new Uint8Array(n * n).fill(10);
  const ceiling = new Uint8Array(n * n).fill(40);
  const cl1 = new Uint8Array(n * n * 2);
  cl1.set([7, 9], 2);
  const cave = decodeHbUnderground(floor, ceiling, cl1, n)!;
  assert.deepEqual([...cave.floorClr.subarray(2, 4)], [7, 0]);
  assert.deepEqual([...cave.ceilingClr.subarray(2, 4)], [9, 0]);
});

test("narrow .CLR and .CL0: one byte per cell or face is a texture with no mirror or rotation", () => {
  assert.deepEqual([...decodeClrGrid(new Uint8Array([1, 2, 3, 0xff]), 2)!], [1, 2, 3, 0xff]);
  assert.deepEqual([...decodeClrGrid(new Uint8Array([1, 0x40, 2, 0, 3, 0, 4, 0]), 2)!], [0x4001, 2, 3, 4]);
  assert.equal(decodeClrGrid(new Uint8Array(3), 2), null);
  const ra0 = new Uint8Array([0, 0, 0, 0]);
  const ra1 = new Uint8Array([5, 0, 0, 0]);
  const cl0 = new Uint8Array(4 * 6);
  cl0.set([11, 12, 13, 14, 15, 16], 0);
  const [box] = decodeGroundBoxes(ra0, ra1, cl0, 2);
  assert.deepEqual(box.faceTexture, [11, 12, 13, 14, 15, 16]);
  assert.deepEqual(box.faceRotation, [0, 0, 0, 0, 0, 0]);
});

test("cell triangles: the checkerboard split matches the engines' sampler", () => {
  // Corners h00=0, h10=4, h11=8, h01=0. On the (0,0)-(1,1) diagonal the centre is (0+8)/2 = 4;
  // on the other diagonal it is (4+0)/2 = 2.
  assert.equal(cellTriangleHeight(0, 4, 8, 0, 0.5, 0.5, false), 4);
  assert.equal(cellTriangleHeight(0, 4, 8, 0, 0.5, 0.5, true), 2);
  // Corners are exact on either split.
  for (const other of [false, true]) {
    assert.equal(cellTriangleHeight(1, 2, 3, 4, 0, 0, other), 1);
    assert.equal(cellTriangleHeight(1, 2, 3, 4, 1, 0, other), 2);
    assert.equal(cellTriangleHeight(1, 2, 3, 4, 1, 1, other), 3);
    assert.equal(cellTriangleHeight(1, 2, 3, 4, 0, 1, other), 4);
  }
  // A 3x3 grid: cell (1,0) is odd, so the checkerboard takes the other diagonal there.
  const raw = new Uint8Array([0, 0, 4, 0, 8, 8, 0, 0, 0]);
  const grid = { gridSize: 3 };
  assert.equal(heightAtPoint(grid, raw, 1.5, 0.5, "fixed"), (0 + 8) / 2);
  assert.equal(heightAtPoint(grid, raw, 1.5, 0.5, "checkerboard"), (4 + 8) / 2);
});

test("Hellbender powerups: 31 types, Fury3's order first, names attached to .PUP", () => {
  assert.equal(HB_POWERUPS.length, 31);
  assert.equal(hbPowerup(0)?.model, "F6RFL.BIN");
  assert.equal(hbPowerup(22)?.name, "Message Pod");
  assert.equal(hbPowerup(30)?.name, "Super Weapon Piece 8");
  assert.equal(hbPowerup(31), null);
  const [pickup] = parsePowerups(new TextEncoder().encode("1\r\n0,0,0,13\r\n"), 128, "HB");
  assert.equal(pickup.name, "Cluster");
  assert.equal(pickup.modelName, "F6CLS.BIN");
  assert.equal(pickup.furyName, "");
});

/** One .TNL segment in file order. */
function tnlSegment(sides: number, open = 0, type = 0): string[] {
  return [
    "8192,4096,8448,4096," + sides, "0,65536,0", "3200,1024", "0,65536", "3200,1024",
    "65535", "1", String(open), String(type), "1",
    ...Array.from({ length: sides }, (_, k) => String(k + 2)),
    "0", "65535", "32768",
  ];
}

test(".TNL: segments of 13 + N lines, rings by the engine's rule, one cell per segment", () => {
  const text = ["2", ...tnlSegment(6), ...tnlSegment(4, 1, 2)].join("\r\n") + "\r\n";
  const tnl = parseTvTunnel(new TextEncoder().encode(text))!;
  assert.ok(tnl.complete);
  assert.equal(tnl.segments.length, 2);
  const [a, b] = tnl.segments;
  assert.deepEqual(a.centreA, [8192, 4096]);
  assert.deepEqual(a.centreB, [8448, 4096]);
  assert.deepEqual(a.ringA, { startAngle: 0, endAngle: 65536, radiusX: 3200, radiusY: 1024 });
  assert.deepEqual(a.sideTextures, [2, 3, 4, 5, 6, 7]);
  assert.equal(a.timer, 65535);
  assert.equal(a.textureList, 1);
  assert.deepEqual(a.unknown, [0, 1, 0, 65535, 32768]);
  assert.equal(b.open, 1);
  assert.equal(b.type, 2);

  const g = tunnelSegmentGeometry(a);
  assert.equal(g.ringA.length, 6);
  assert.deepEqual(g.ringA[0], [8192 + 3200, 4096, 0]);
  assert.equal(g.ringB[0][2], TUNNEL_SEGMENT_LENGTH);
  assert.equal(g.ringB[0][0], 8448 + 3200);
  assert.deepEqual(g.faces[5], { a: 5, b: 0, texture: 7 });

  // Open by one: three ring vertices a third of a turn apart, the fourth on ring A's centre.
  const open = tunnelSegmentGeometry(b);
  assert.equal(open.ringA[0][2], TUNNEL_SEGMENT_LENGTH);
  assert.deepEqual(open.ringA[3], [8192, 4096, TUNNEL_SEGMENT_LENGTH]);
  assert.ok(Math.abs(open.ringA[1][0] - (8192 + Math.cos((21845 / 65536) * 2 * Math.PI) * 3200)) < 1e-9);

  assert.equal(parseTvTunnel(new TextEncoder().encode("91\r\n")), null);
  const short = parseTvTunnel(new TextEncoder().encode(["2", ...tnlSegment(6)].join("\r\n")))!;
  assert.equal(short.segments.length, 1);
  assert.equal(short.complete, false);
});

test("Hellbender .QKE: ground and box quakes in the writer's field order", () => {
  const text = [
    "-------- Ground Quake Count -------", "1",
    "------- Ground Quake Entry 1-------", "3", "1280,0", "4,5,6,7,2", "0,0,0,0",
    "0,65536,131072,65536,0", "1,0,1,2", "UP.WAV", "NULL", "NULL", "NULL", "NULL",
    "!--Additional quake info--", "5",
    "-------- Box Quake Count --------", "1",
    "-------- Box Quake Entry 1 --------", "1", "-17920,-25344", "10,88,2", "86,0,0,0",
    "1,196608,0,65536,196608", "0,1,0,1,4", "3-0UDOOR.WAV", "1-0DDOOR.WAV", "NULL", "NULL", "NULL",
    "!--Additional quake info--", "0", "@--Box quake switch info--", "1", "MESWTCH1.RAW", "MESWTCH0.RAW",
  ].join("\r\n") + "\r\n";
  const qke = parseHbQuakes(new TextEncoder().encode(text))!;
  assert.ok(qke.complete);
  const [ground] = qke.groundQuakes;
  assert.equal(ground.mode, 3);
  assert.deepEqual([ground.x0, ground.z0, ground.x1, ground.z1, ground.layer], [4, 5, 6, 7, 2]);
  assert.equal(ground.upperStep, 10);
  assert.equal(ground.topWait, 131072);
  assert.equal(ground.endMode, 1);
  assert.deepEqual(ground.sounds, ["UP.WAV", null, null, null, null]);
  assert.equal(ground.additionalInfo, 5);
  const [box] = qke.boxQuakes;
  assert.deepEqual([box.z, box.x, box.layer], [10, 88, 2]);
  assert.equal(box.upperStep, -140);
  assert.equal(box.lowerStep, -198);
  assert.equal(box.riseTime, 196608);
  assert.deepEqual(box.flags, [1, 0, 1, 4]);
  assert.equal(box.switchFlag, 1);
  assert.deepEqual(box.switchTextures, ["MESWTCH1.RAW", "MESWTCH0.RAW"]);
  assert.equal(parseHbQuakes(new TextEncoder().encode("0\r\n")), null);
});

test("Hellbender .NAV: sync points the game added are flagged, and types 10 and 11 are named", () => {
  const entry = (type: number, text: string, payload: string[] = []) => [
    String(type), "0,0,0", "!priority,time", "0,0", "@Completion sound & completion text (39 chars max)", "null",
    "null: line ignored", "; Proximity Sound file", "null", text, ...payload, "-------------------------------------------------",
  ];
  const text = ["4", ...entry(7, "Sync point: auto added"), ...entry(7, "Sync Point"), ...entry(10, "x", ["0,0,0", "1"]), ...entry(11, "y", ["5"])].join("\r\n");
  const points = parseHbNavPoints(new TextEncoder().encode(text), 128);
  assert.equal(points.length, 4);
  assert.deepEqual(points.map((p) => p.autoAdded), [true, false, false, false]);
  assert.equal(points[2].typeName, "Orientation (unused)");
  assert.equal(points[3].typeName, "Random (unused)");
});
