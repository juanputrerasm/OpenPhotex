/*
  Community Patch 4 (beta 0.52) / Traxx 1.7 track formats: 16-bit heights and height PNGs, .WTR
  lakes, MTM2 .VEG vegetation, the SIT `F` fog block, .TXV keys, .CPT cockpits and .SRF surface
  sidecars. Synthetic fixtures first; then, when present, Traxx 1.7's own test files and the
  vegetation/fog sandbox Fila published (CP4_SANDBOX, default ~/games/cp4sandbox/fog_test.pod),
  which skip on a machine without them.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import {
  decodeMtm2Heights, decodeMtm2HeightPng, resolveMtm2TerrainMode, decodePngSamples, inflateZlib,
  parseWtr, writeWtr, wtrLakeAt, parseMtm2Veg, writeMtm2Veg, isMtm2Veg, parseSitFog, formatSitFogLine, SIT_FOG_HEADER,
  readTxvInfo, parseCpt, parseSrf, srfTypeOf, parsePod, findPodEntry, readPodEntry, parseMtmSit, writeMtm2Sit, mtm2SitFromParsed,
  terrainSplineExpand,
} from "../src/index.ts";

function png(width: number, height: number, depth: 8 | 16, colorType: number, pixel: (x: number, y: number) => number[]): Uint8Array {
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]!;
  const bpp = ch * depth / 8;
  const raw = new Uint8Array((width * bpp + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = y % 5; // exercise every filter type: write the bytes as if unfiltered, then filter below
    for (let x = 0; x < width; x++) for (const s of pixel(x, y)) {
      if (depth === 16) { raw[o++] = s >> 8; raw[o++] = s & 255; } else raw[o++] = s;
    }
  }
  // Apply each row's filter so the decoder has to undo it.
  const stride = width * bpp;
  const filtered = new Uint8Array(raw.length);
  for (let y = 0; y < height; y++) {
    const r = y * (stride + 1), f = raw[r]!;
    filtered[r] = f;
    for (let i = 0; i < stride; i++) {
      const x = raw[r + 1 + i]!;
      const a = i >= bpp ? raw[r + 1 + i - bpp]! : 0;
      const b = y > 0 ? raw[r - stride + i]! : 0;
      const c = y > 0 && i >= bpp ? raw[r - stride + i - bpp]! : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]!;
      filtered[r + 1 + i] = (x - pred) & 255;
    }
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    return out; // CRC not checked by the reader
  };
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr[8] = depth; ihdr[9] = colorType;
  const parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(deflateSync(filtered))), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}

test("inflate matches zlib on stored, fixed and dynamic blocks", () => {
  const text = new TextEncoder().encode("Monster Truck Madness 2 ".repeat(500) + Array.from({ length: 3000 }, (_, i) => String.fromCharCode(32 + ((i * 7919) % 90))).join(""));
  for (const level of [0, 1, 9]) assert.deepEqual(inflateZlib(new Uint8Array(deflateSync(text, { level }))), text);
});

test("16-bit grey PNG samples survive every filter; grey + alpha keeps the grey", () => {
  const img = decodePngSamples(png(37, 23, 16, 0, (x, y) => [(x * 1700 + y * 911) & 0xffff]));
  assert.equal(img.bitDepth, 16);
  for (let y = 0; y < 23; y++) for (let x = 0; x < 37; x++) assert.equal(img.samples[y * 37 + x], (x * 1700 + y * 911) & 0xffff);
  const h = decodeMtm2HeightPng(png(256, 256, 8, 4, (x) => [x, 0x11]));
  assert.equal(h.mode, "classic16");
  assert.equal(h.coarse[5], 5 << 8);
  assert.throws(() => decodeMtm2HeightPng(png(256, 256, 8, 2, () => [1, 2, 3])), /greyscale/);
});

test("height file length and terrainGrid pick the mode, as Traxx 1.7's ResolveTerrainMode", () => {
  assert.equal(resolveMtm2TerrainMode(65536).mode, "classic8");
  assert.equal(resolveMtm2TerrainMode(131072).mode, "classic16");
  assert.equal(resolveMtm2TerrainMode(131072, "spline").mode, "spline");
  assert.equal(resolveMtm2TerrainMode(65536, " SPLINE ").mode, "spline");
  const fineOnSmall = resolveMtm2TerrainMode(131072, "fine");
  assert.equal(fineOnSmall.mode, "classic16");
  assert.ok(fineOnSmall.warning);
  assert.equal(resolveMtm2TerrainMode(2097152).mode, "fine");
  assert.equal(resolveMtm2TerrainMode(2097152, "fine").warning, null);
  assert.ok(resolveMtm2TerrainMode(131072, "bogus").warning);
  assert.throws(() => resolveMtm2TerrainMode(1000), /1000 bytes/);
});

test("heights are 1/128 ft; a byte b is b << 8; spline expands, fine keeps its coarse corners", () => {
  const b8 = new Uint8Array(65536).fill(255);
  const c8 = decodeMtm2Heights(b8);
  assert.equal(c8.coarse[0], 255 << 8);
  assert.equal(c8.coarse[0]! / 128, 510);
  const b16 = new Uint8Array(131072);
  b16[0] = 0x0b; b16[1] = 0x05; // 1291 = 10.0859 ft
  assert.equal(decodeMtm2Heights(b16).coarse[0], 1291);
  const s = decodeMtm2Heights(b16, "spline");
  assert.equal(s.fine!.length, 1024 * 1024);
  assert.deepEqual(s.fine, terrainSplineExpand(s.coarse));
  const bf = new Uint8Array(2097152);
  const fv = new DataView(bf.buffer);
  fv.setUint16((4 * 3 * 1024 + 4 * 7) * 2, 4321, true);
  const f = decodeMtm2Heights(bf);
  assert.equal(f.mode, "fine");
  assert.equal(f.coarse[3 * 256 + 7], 4321);
});

test(".WTR round trip and tile lookup", () => {
  const tmap = new Uint8Array(65536);
  tmap[10 + 20 * 256] = 1; tmap[11 + 20 * 256] = 2;
  const bytes = writeWtr([
    { flags: 1, height: 517, seeds: [{ x: 10, z: 20 }], box: { minX: 10, minZ: 20, maxX: 10, maxZ: 20 }, tileCount: 1 },
    { flags: 0, height: 646, seeds: [{ x: 11, z: 20 }, { x: 11, z: 21 }], box: { minX: 11, minZ: 20, maxX: 11, maxZ: 21 }, tileCount: 1 },
  ], tmap);
  const w = parseWtr(bytes);
  assert.equal(w.lakes.length, 2);
  assert.equal(w.lakes[0]!.heightFt, 258.5);
  assert.equal(w.lakes[0]!.reflective, true);
  assert.deepEqual(w.lakes[1]!.seeds, [{ x: 11, z: 20 }, { x: 11, z: 21 }]);
  assert.equal(wtrLakeAt(w, 10 * 32 + 5, 20 * 32 + 31), 1);
  assert.equal(wtrLakeAt(w, 11 * 32 + 8192, 20 * 32), 2);
  // Major 2 is track format version 6's .WTR (test/track-format-v6.test.ts); 3 is newer than any reader knows.
  const newer = bytes.slice(); newer[4] = 3;
  assert.throws(() => parseWtr(newer), /newer/);
});

test("MTM2 .VEG round trip; trees come back sorted by tile", () => {
  const trees = { count: 2, position: Int32Array.from([9000 * 256 / 32, 100, 9000, 10, 50, 20]), species: Uint16Array.from([0, 0]), heading: Uint16Array.from([1, 2]), scale: Uint16Array.from([4096, 100]), tint: new Uint8Array(2), tier: Uint8Array.from([0, 2]) };
  const clumps = { count: 1, tiles: [{ tx: 3, tz: 4, first: 0, count: 1 }], species: Uint16Array.from([1]), offset: Uint8Array.from([8, 16]), y: Int32Array.from([-512]), heading: Uint8Array.from([64]), scale: Uint8Array.from([48]), tint: new Uint8Array(1) };
  const species = [
    { model: "PINE01.BIN", farModel: "V0000001.BIN", kind: 0, collide: 1, flags: 5, trunkDiameter: 64, trunkHeight: 160 },
    { model: "GRASS.BIN", farModel: "", kind: 1, collide: 2, flags: 0, trunkDiameter: 0, trunkHeight: 0 },
  ];
  const bytes = writeMtm2Veg({ species, trees, clumps, rule: "seed=1\r\n", info: "tool=Test\r\ntrees=2\r\n" });
  assert.ok(isMtm2Veg(bytes));
  const v = parseMtm2Veg(bytes);
  assert.equal(v.species[1]!.collide, 0, "ground species never collide");
  assert.equal(v.species[0]!.farModel, "V0000001.BIN");
  assert.equal(v.trees.count, 2);
  assert.deepEqual(Array.from(v.trees.position.subarray(0, 3)), [10, 50, 20], "the tree in tile (0,0) first");
  assert.equal(v.trees.scale[0], 256, "scale has a floor of 256");
  assert.equal(v.clumps.y[0], -512);
  assert.equal(v.rule, "seed=1\r\n");
  assert.equal(v.info.trees, "2");
});

test("the F fog block: engine defaults for missing fields, Traxx's clamps and %f formatting", () => {
  const line = "100.000000,100.000000,40.000000,0.000000,200.000000,0.749020,0.780392,0.819608,16.000000,20.000000,5.000000,1.000000,511,0.490000,0.800000,10.000000,10.000000,0.000000";
  const fog = parseSitFog(line);
  assert.equal(fog.vis, 200);
  assert.equal(fog.wmask, 511);
  assert.equal(formatSitFogLine(fog), line);
  const short = parseSitFog("50,60,7");
  assert.equal(short.vis, 300);
  assert.deepEqual(short.color, [0.75, 0.78, 0.82]);
  assert.equal(short.wsize, 40);
  assert.equal(parseSitFog("1,1,1,0,0").vis, 1, "vis has a floor of 1");
  assert.equal(SIT_FOG_HEADER.length < 80, true);
});

test(".TXV info keys", () => {
  const info = readTxvInfo("# MTM2 track version record - written by Traxx\r\nformatVersion=5\r\nterrainGrid=fine\r\nterrainHeights=DATA\\X_H.PNG\r\nvegetation=1\r\nvegTrees=12394\r\nfogVolumes=2\r\n");
  assert.equal(info.formatVersion, 5);
  assert.equal(info.terrainGrid, "fine");
  assert.equal(info.terrainHeights, "DATA\\X_H.PNG");
  assert.equal(info.vegetation, true);
  assert.equal(info.vegTrees, 12394);
  assert.equal(info.legacyFallback, null);
});

test(".CPT cockpit layout and .SRF surface sidecar", () => {
  const cpt = parseCpt("; c\r\nVERSION = 1\r\nCAB = X_CP.BIN\r\nEYE = 0, 4, 1\r\nSPEEDO = X_CPN1.BIN, -1.2, 3.2, 2.7, 0, 0, 1, 304.5, 2.65\r\nSHIFTER = X_CPS.BIN, 1, 2, 3, 1, 0, 0, -5, 5, 17, 30, 42, 53\r\nGEARLAMP_N = X_CPLN.BIN\r\nSHIFTLIGHT = X_CPLS.BIN, 6500\r\nMIRROR = 1, 4, 2, 0, 0, -1, 1.1, 0.3, 65536\r\nFUTURE = 1\r\n");
  assert.equal(cpt.version, 1);
  assert.deepEqual(cpt.eye, [0, 4, 1]);
  assert.deepEqual(cpt.speedo, { model: "X_CPN1.BIN", pivot: [-1.2, 3.2, 2.7], axis: [0, 0, 1], values: [304.5, 2.65] });
  assert.equal(cpt.shifter!.values.length, 6);
  assert.equal(cpt.gearLamps.N, "X_CPLN.BIN");
  assert.deepEqual(cpt.shiftLight, { model: "X_CPLS.BIN", values: [6500] });
  assert.equal(cpt.mirror!.length, 9);
  assert.equal(cpt.entries.at(-1)!.key, "FUTURE");
  const srf = parseSrf("DECK=wood\r\nROAD = Cement\r\n*=default\r\nPOOL=water2\r\nBAD\r\nX=lava\r\ndeck=metal\r\n");
  assert.equal(srfTypeOf(srf, "DECK"), "metal", "the later line wins");
  assert.equal(srfTypeOf(srf, "road"), "cement");
  assert.equal(srfTypeOf(srf, "OTHER"), "default");
  assert.deepEqual(srf.rejected.map((r) => r.line), [4, 5, 6]);
  const s2 = parseSrf("; comment\r\n# another\r\nROADTEX=cement\r\nVERYLONGTEXTURE=mud\r\nX=water\r\n");
  assert.equal(srfTypeOf(s2, "ROADTEX.RAW"), "cement", "the stem without the extension");
  assert.equal(srfTypeOf(s2, "VERYLONGTEXTURENAME2.PNG"), "mud", "the first 15 characters");
  assert.equal(srfTypeOf(s2, "OTHER.RAW"), null, "not a surface");
  assert.equal(s2.rejected.length, 1, "water is refused too; comments are not lines");
});

const traxxPng = join(process.env.TRAXX_SRC ?? join(homedir(), "dev/Traxx_OnGoing_Updates"), "tools/heightpng_fixtures/gray16_256_gradient.png");
test("Traxx 1.7's external 16-bit PNG fixture (written by .NET, v = x*160 + z*95)", { skip: !existsSync(traxxPng) }, () => {
  const h = decodeMtm2HeightPng(new Uint8Array(readFileSync(traxxPng)));
  assert.equal(h.bitDepth, 16);
  for (let z = 0; z < 256; z++) for (let x = 0; x < 256; x++) assert.equal(h.coarse[z * 256 + x], x * 160 + z * 95);
});

const sandbox = process.env.CP4_SANDBOX ?? join(homedir(), "games/cp4sandbox/fog_test.pod");
test("Fila's vegetation/fog sandbox (fog_test.pod): WTR, VEG, TXV and two fog boxes", { skip: !existsSync(sandbox) }, () => {
  const bytes = new Uint8Array(readFileSync(sandbox));
  const pod = parsePod(bytes);
  const read = (p: string) => { const e = findPodEntry(pod, p); assert.ok(e, p); return readPodEntry(bytes, e); };
  const wtr = parseWtr(read("WORLD\\FOGTEST.WTR"));
  assert.equal(wtr.lakes.length, 2);
  assert.equal(wtr.lakes[0]!.height, 517);
  let wet = 0;
  for (const t of wtr.tileMap!) if (t) wet++;
  assert.equal(wet, wtr.lakes.reduce((n, k) => n + k.tileCount, 0), "TMAP agrees with the tile counts");
  const veg = parseMtm2Veg(read("WORLD\\FOGTEST.VEG"));
  assert.equal(veg.trees.count, 12394);
  assert.equal(veg.clumps.count, 131072);
  assert.equal(veg.info.toolVersion, "1.7.0");
  assert.equal(veg.clumps.tiles.reduce((n, t) => n + t.count, 0), veg.clumps.count);
  const info = readTxvInfo(read("DATA\\FOGTEST.TXV"));
  assert.equal(info.formatVersion, 4);
  assert.equal(info.fogVolumes, 2);
  const sitBytes = read("WORLD\\FOGTEST.SI2");
  const sit = parseMtmSit(sitBytes);
  const fogs = sit.boxes.filter((b) => b.type === 14);
  assert.equal(fogs.length, 2);
  assert.equal(fogs[0]!.fog!.wmask, 511);
  const again = parseMtmSit(writeMtm2Sit(mtm2SitFromParsed(sit)));
  assert.deepEqual(again.boxes.filter((b) => b.type === 14).map((b) => b.fog), fogs.map((b) => b.fog), "fog survives a write");
  assert.equal(decodeMtm2Heights(read("DATA\\FOGTEST.RAW")).mode, "classic8");
});

test("the engine drops the 16-bit file's lowest bit: v >> 1 at 1/64 ft", async () => {
  const { mtm2EngineHeightsFt } = await import("../src/index.ts");
  assert.deepEqual(Array.from(mtm2EngineHeightsFt(Uint16Array.from([1291, 1290, 65535]))), [645 / 64, 645 / 64, 32767 / 64]);
});

test("a lake tile is deep water below the lake's surface and gives its own water level", async () => {
  const { mtm2Sim } = await import("../src/index.ts");
  const t = mtm2Sim.createTerrain(new Uint8Array(65536).fill(50), 20); // ground 100 ft, track water 20 ft
  const tmap = new Uint8Array(65536);
  tmap[3 + 4 * 256] = 1;
  const levels = new Float32Array(256);
  levels[1] = 110;
  mtm2Sim.setTerrainLakes(t, tmap, levels);
  const ground = mtm2Sim.createTerrainGround(t, { clr: new Uint16Array(65536), textureValues: [200] } as never, 0);
  assert.equal(ground.surface(3 * 32 + 5, 0, 4 * 32 + 5), 1300);
  assert.equal(ground.surface(10 * 32, 0, 4 * 32), 200);
  assert.equal(ground.waterLevelAt!(3 * 32 + 5, 4 * 32 + 5), 110);
  assert.equal(ground.waterLevelAt!(10 * 32, 4 * 32), 20);
});

test("a truck names its 3D cockpit with its last two non-blank lines, COCKPIT then the .CPT", async () => {
  const { mtmTrkCockpit } = await import("../src/index.ts");
  assert.equal(mtmTrkCockpit(["MTM2", "Truck", "x", "COCKPIT", "EXAMPLE_CP.CPT", "", ""]), "EXAMPLE_CP.CPT");
  assert.equal(mtmTrkCockpit(["MTM2", "COCKPIT", "A.CP"]), null, "under 5 characters");
  assert.equal(mtmTrkCockpit(["COCKPIT", "DATA\\X_CP.CPT"]), null, "no path");
  assert.equal(mtmTrkCockpit(["COCKPIT", "X_CP.CPT", "more"]), null, "not the last lines");
});

/**
 * CP4's formats grow by addition only (its developers, reply_to_kmaster_online_rooms_2.md section 4): `bytes` with a
 * newer minor version and an extra chunk of an id we do not know, its directory entry first, the data last.
 */
function withUnknownChunk(bytes: Uint8Array, version = 1): Uint8Array {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = dv.getUint32(8, true), count = dv.getUint32(12, true);
  const extra = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const out = new Uint8Array(bytes.length + 16 + extra.length);
  out.set(bytes.subarray(0, headerSize));
  out.set(bytes.subarray(headerSize), headerSize + 16);
  const o = new DataView(out.buffer);
  o.setUint16(6, 7, true);
  o.setUint32(12, count + 1, true);
  for (let i = 0; i < count; i++) {
    const e = headerSize + 16 + i * 16;
    o.setUint32(e + 8, o.getUint32(e + 8, true) + 16, true);
  }
  out.set([0x58, 0x54, 0x52, 0x41], headerSize);
  o.setUint32(headerSize + 4, version, true);
  o.setUint32(headerSize + 8, bytes.length + 16, true);
  o.setUint32(headerSize + 12, extra.length, true);
  out.set(extra, bytes.length + 16);
  return out;
}

test("VEG and WTR readers skip a chunk they do not know and a newer minor version", () => {
  const trees = { count: 1, position: Int32Array.from([10, 50, 20]), species: Uint16Array.from([0]), heading: Uint16Array.from([1]), scale: Uint16Array.from([4096]), tint: new Uint8Array(1), tier: new Uint8Array(1) };
  const clumps = { count: 0, tiles: [], species: new Uint16Array(0), offset: new Uint8Array(0), y: new Int32Array(0), heading: new Uint8Array(0), scale: new Uint8Array(0), tint: new Uint8Array(0) };
  const species = [{ model: "PINE01.BIN", farModel: "", kind: 0, collide: 1, flags: 0, trunkDiameter: 64, trunkHeight: 160 }];
  const veg = withUnknownChunk(writeMtm2Veg({ species, trees, clumps, info: "tool=Test\r\n" }), 3);
  const v = parseMtm2Veg(veg);
  assert.equal(v.species[0]!.model, "PINE01.BIN");
  assert.equal(v.trees.count, 1);
  assert.equal(v.info.tool, "Test");

  const tmap = new Uint8Array(65536); tmap[0] = 1;
  const wtr = withUnknownChunk(writeWtr([{ height: 40, flags: 0, seeds: [{ x: 0, z: 0 }], box: { minX: 0, minZ: 0, maxX: 0, maxZ: 0 }, tileCount: 1 }], tmap));
  const w = parseWtr(wtr);
  assert.equal(w.lakes.length, 1);
  assert.equal(w.lakes[0]!.height, 40);
});

test("VEG: the first directory entry of an id wins, even a bad one (Traxx VegFindChunk)", () => {
  const trees = { count: 1, position: Int32Array.from([10, 50, 20]), species: Uint16Array.from([0]), heading: Uint16Array.from([1]), scale: Uint16Array.from([4096]), tint: new Uint8Array(1), tier: new Uint8Array(1) };
  const clumps = { count: 0, tiles: [], species: new Uint16Array(0), offset: new Uint8Array(0), y: new Int32Array(0), heading: new Uint8Array(0), scale: new Uint8Array(0), tint: new Uint8Array(0) };
  const species = [{ model: "PINE01.BIN", farModel: "", kind: 0, collide: 1, flags: 0, trunkDiameter: 64, trunkHeight: 160 }];
  const bytes = writeMtm2Veg({ species, trees, clumps, info: "tool=Test\r\n" });
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Mark the first entry (SPEC) as a version we do not know: SPEC is then absent, as in Traxx.
  dv.setUint32(32 + 4, 2, true);
  assert.equal(parseMtm2Veg(bytes).species.length, 0);
});
