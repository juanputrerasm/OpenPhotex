import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCth, parseDfm, parseKfm, parseNocturneFog, parseNocturneGeo, parseNocturneSet, parseNocturneThm,
  parseNocturneZth, parseSkl, NOCTURNE_THM_HEIGHT, NOCTURNE_THM_SLOTS, NOCTURNE_THM_WIDTH,
  NOCTURNE_ZTH_MAP_BYTES,
} from "../src/index.ts";

const ascii = (text: string) => new TextEncoder().encode(text);

test("DFM exposes LOD geometry, weights, cap ownership and skeleton references", () => {
  const model = parseDfm(ascii(`// version\n7\n// counts\n1,1,1,1,1\n1,1,1,100,0\nONE.SKL\n"body",0\n1,1\n1\n0,1,2,3,4\n0,0,0,0,1,1,0,2,0,1\n0,0,0,0,0,0,0,0,0,0\n0\nONE.RAW\n0,0,0\n1,1,1\n0,0,0\n0\n`));
  assert.equal(model.lods[0].triangles.length, 2);
  assert.deepEqual(model.lods[0].vertices[0][0], { bone: 0, weight: 1, position: [2, 3, 4] });
  assert.deepEqual([...model.lods[0].capTriangleParts], [0]);
  assert.equal(model.skeleton, "ONE.SKL");
});

test("SKL exposes animation samples and motion metadata", () => {
  const skl = parseSkl(ascii(`// version\n3\n1,1\n"root",-1\n1,0,0,0\n1,2,3\n0\n2\n1\nIDLE\n1\n"idle",30,0,0,1\n1,0,0\n0,0,0\n0,0\n0\n0\n1 0\n4,5,6\n`));
  assert.deepEqual([...skl.rotations], [1, 0, 0, 0]);
  assert.deepEqual(skl.motions[0].markers, [0]);
  assert.deepEqual([...skl.referenceOrigins], [4, 5, 6]);
});

test("text and binary KFM dialects expose morph vertices and polygons", () => {
  const text = parseKfm(ascii(`// .KFM version\n8\n3,1,1,1,1\n0\n0\n0\n1\n0,0,0\n1,0,0\n0,1,0\n0,3,0,0,0,1,1,0,2,0,1\n170\nA.RAW\n3,1\n`));
  assert.deepEqual([...text.envMapOpacity], [170]);
  assert.equal(text.polygons[0].corners.length, 3);

  const data = new Uint8Array(28 + 9 * 4 + 72 + 4 + 24 + 8);
  const view = new DataView(data.buffer); let p = 0;
  const put = (v: number) => { view.setInt32(p, v, true); p += 4; };
  for (const v of [4, 3, 1, 1, 1, 1, 0, 0, 0, 0, 256, 0, 0, 0, 256, 0]) put(v);
  for (const v of [7, 3, 0, 0, 256, 0, 0, 0, 0, 65536, 1, 65536, 0, 2, 0, 65536, 0, 0]) put(v);
  put(0); data.set(ascii("B.RAW"), p); p += 24; put(3); put(1);
  const binary = parseKfm(data);
  assert.equal(binary.binary, true);
  assert.equal(binary.polygons[0].type, 7);
  assert.equal(binary.textures[0], "B.RAW");
});

test("CTH supports the original six-property dialect", () => {
  const cloth = parseCth(ascii(`version\n1\nmodel\nCAPE.KFM\nmass,gravity,dampen,spring,bodyFriction,floorFriction\n1,2,3,4,5,6\ntransparency\n0.5\nlockedVertexCount\n1\nlockedVertexList\n7\ncollideBoneCount\n1\n"root",1,2,3\n`));
  assert.equal(cloth.doubleSided, false);
  assert.equal(cloth.windArea, 0);
  assert.deepEqual([...cloth.lockedVertices], [7]);
});

test("GEO reads a bounded spatial grid", () => {
  const data = new Uint8Array(84); const view = new DataView(data.buffer); let p = 0;
  const i = (v: number) => { view.setInt32(p, v, true); p += 4; };
  const f = (v: number) => { view.setFloat32(p, v, true); p += 4; };
  i(4); i(1); i(1); i(1); for (const v of [0, 0, 0, 10, 10, 10, 10, 10, 10, 0, 0, 0, 10, 10, 10]) f(v); i(0); i(0);
  const geo = parseNocturneGeo(data);
  assert.deepEqual(geo.grid, [1, 1, 1]);
  assert.equal(geo.cells[0].vertices.length, 0);
});

test("FOG separates the density cube from its tagged payload", () => {
  const data = new Uint8Array(4101); data[0] = 9; data.set(ascii("EFD"), 4096); data.set([1, 2], 4099);
  const fog = parseNocturneFog(data);
  assert.equal(fog.density.length, 4096);
  assert.equal(fog.encoding, "EFD");
  assert.deepEqual([...fog.payload], [1, 2]);
});

test("SET reads the scene header and retains later unknown sections", () => {
  const set = parseNocturneSet(ascii(`26\n1\nunused.act\nROOM.geo\n0.1\nfogR,fogG,fogB\n1,2,3\nfogVel\n0,0,0\n0,1\n50\nwaterHeight,waterTileSize\n0,32\nuseEnviroModel,enviroModelName\n0,none\ntransparentWaterFlag\n0\nhasSky\n0\n0,none\nuseWorldGeometryFlag,worldGeometryName\n0,none\nweatherType\n0\nlightCount\n0\ncameraCount\n0\nRoom size info\n0\n0\n`));
  assert.equal(set.geometry, "ROOM.geo");
  assert.deepEqual(set.fog.colour, [1, 2, 3]);
  assert.deepEqual(set.trailingLines, ["Room size info", "0", "0"]);
});

test("THM decodes ten RGBX thumbnail slots and identifies empty ones", () => {
  const bytes = new Uint8Array(NOCTURNE_THM_WIDTH * NOCTURNE_THM_HEIGHT * NOCTURNE_THM_SLOTS * 4);
  bytes.set([10, 20, 30, 0]);
  const thm = parseNocturneThm(bytes);
  assert.equal(thm.thumbnails.length, 10);
  assert.deepEqual([...thm.thumbnails[0].rgba.subarray(0, 4)], [10, 20, 30, 255]);
  assert.equal(thm.thumbnails[0].empty, false);
  assert.equal(thm.thumbnails[1].empty, true);
});

test("ZTH reads one little-endian 24-bit 64x48 depth map per camera", () => {
  const bytes = new Uint8Array(NOCTURNE_ZTH_MAP_BYTES * 2);
  new DataView(bytes.buffer).setUint32(NOCTURNE_ZTH_MAP_BYTES + 4, 0x123456, true);
  const zth = parseNocturneZth(bytes);
  assert.equal(zth.depthMaps.length, 2);
  assert.equal(zth.depthMaps[1][1], 0x123456);
});
