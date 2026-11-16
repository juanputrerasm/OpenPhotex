/*
  Community Patch 4's waterfall build as beta 0.53 hotfix 3 does it (sim/cp4/falls.ts, fall-sheet.ts,
  fall-droplets.ts; OpenMTM2 docs/CP4_EXE_ANALYSIS.md 12 and 16). The synthetic cases give the walk ground and water
  callbacks of known shape, so counts, layouts and box numbers follow from the spec by hand; then, when present,
  Fila's 0.53 sandbox (CP4_SANDBOX_053, default ~/games/cp4sandbox053/fog_test.pod), which skips on a machine without it.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  buildFallMeshes, checkFallRecords, validateFall, fallDebugColumns, fallGround, fallTerrainHeight, fallWater, fallMist, fallMists,
  fallMistSlotFree, fallSound, fallSoundGain, fallLook, fallRippleFrame, fallTextureName, cp4Sim,
  FALL_VERTEX as V, FALL_VERTEX_FLOATS, FALL_MAX_FALL_VERTICES, FALL_MAX_TRACK_VERTICES, FALL_RIPPLE_FRAMES, FALL_SOUND_LOOP_ROOM,
  FALL_LOOK_ICE, FALL_LOOK_ORIGINAL, FALL_LOOK_REALISTIC, FALL_LOOK_ENHANCED, FALL_GPU_DRAW, FALL_GPU_ICE,
  parsePod, findPodEntry, readPodEntry, parseWfl, parseWtr, writeWfl, readFallFile, FALL_FILE_STATUS_TEXT, parseMtmLvl, readTxvInfo, decodeMtm2Heights,
  fallSlabThickness, fallCountBack, fallRibbonWidth, createFallDroplets, stepFallDroplets, FALL_DROPLETS, FALL_KIND_BACK, FALL_KIND_FOAM,
  type WflFall, type FallMeshes,
} from "../src/index.ts";

/** A record as parseWfl gives it, crest points in feet. */
function rec(o: { id?: number; pts: Array<[number, number]>; height: number; speed?: number; source?: number; flags?: number;
  opacity?: number; mist?: number; volume?: number; mistDepth?: number; mistHeight?: number; roughFrom?: number; sound?: string; texture?: string }): WflFall {
  const speed = o.speed ?? 96, flags = o.flags ?? 2;
  return {
    id: o.id ?? 1, source: o.source ?? 0, flags, freeze: (flags & 1) !== 0, splash: (flags & 2) !== 0, sound: (flags & 4) !== 0,
    speed, speedFtPerSec: speed / 16, height: o.height, heightFt: o.height / 2,
    points: o.pts.map(([x, z]) => ({ x: Math.round(x * 16), z: Math.round(z * 16) })),
    opacity: o.opacity ?? 100, mist: o.mist ?? 100, volume: o.volume ?? 100, mistDepth: o.mistDepth ?? 100, mistHeight: o.mistHeight ?? 100,
    roughFrom: o.roughFrom ?? 0, soundName: o.sound ?? "", textureName: o.texture ?? "",
  };
}

const vtx = (m: FallMeshes, i: number) => Array.from(m.vertices.subarray(i * FALL_VERTEX_FLOATS, (i + 1) * FALL_VERTEX_FLOATS));
const near = (a: number, b: number, eps = 1e-3, what = "") => assert.ok(Math.abs(a - b) <= eps, `${what} ${a} != ${b}`);

/** Columns of written sheet vertices (the sheet is written column by column, `columnRows` each). */
function columnsOf(_m: FallMeshes, f: FallMeshes["falls"][number]) {
  const cols: number[][] = [];
  let at = f.firstVertex;
  for (const n of f.columnRows) { cols.push(Array.from({ length: n }, (_, i) => at + i)); at += n; }
  return cols;
}

// ---- 1. A flat shelf dropping into water ----

const shelfGround = (_x: number, z: number) => (z >= 1000 ? 100 : 20);
const shelfWater = () => 50;
const shelf = rec({ pts: [[1000, 1000], [1040, 1000]], height: 200, speed: 96, flags: 7, sound: "ROAR", mistHeight: 100 });

test("a shelf into water: 21 columns at 2 ft, every column ends in water with its sink, the slab's back face, foam strip, global indices", () => {
  const m = buildFallMeshes([shelf], { ground: shelfGround, water: shelfWater });
  assert.equal(m.falls.length, 1);
  assert.deepEqual([m.refused, m.dropped, m.skipped, m.tooBig], [[], [], false, false]);
  const f = m.falls[0]!;
  assert.equal(f.spacing, 2);
  assert.equal(f.columns, 21);
  assert.deepEqual(f.ends, { water: 21, rest: 0, limit: 0 });
  assert.deepEqual(f.anchorFt, [1000, 100, 1000]);
  assert.deepEqual(f.anchor, [1000 * 256, 200 * 128, 1000 * 256]);
  assert.equal(f.crestLengthFt, 40);
  assert.equal(f.crestSpeedFtPerSec, 6);
  assert.deepEqual([f.mergedColumns, f.droppedTriangles, f.ribbonVertexCount], [0, 0, 0], "parallel columns: no tubes, no tears, no ribbons");

  const dbg = fallDebugColumns(shelf, 2, { ground: shelfGround, water: shelfWater })!;
  const cols = columnsOf(m, f);
  assert.equal(cols.length, 21);
  cols.forEach((c, i) => assert.equal(c.length, dbg[i]!.rows.length + 1, `column ${i}: rows + the sink`));
  assert.equal(f.sheetVertexCount, dbg.reduce((n, c) => n + c.rows.length + 1, 0));
  // Buffer order: sheet, ribbons, back, foam. Every sheet triangle has an airborne corner here, so the back face
  // doubles the sheet.
  assert.equal(f.backVertexCount, f.sheetVertexCount);
  assert.equal(f.foamVertexCount, 3 * 21);
  assert.equal(f.vertexCount, f.sheetVertexCount + f.ribbonVertexCount + f.backVertexCount + f.foamVertexCount);
  assert.equal(m.vertices.length, f.vertexCount * 16);
  let tris = 0;
  for (let i = 0; i + 1 < cols.length; i++) tris += cols[i]!.length + cols[i + 1]!.length - 2;
  assert.equal(f.backTriangleCount, tris);
  assert.equal(f.indexCount, 3 * (2 * tris + 4 * 20));
  assert.equal(m.indices.length, f.indexCount);
  for (const i of m.indices) assert.ok(i >= f.firstVertex && i < f.firstVertex + f.vertexCount);
  const back0 = f.firstVertex + f.sheetVertexCount + f.ribbonVertexCount;
  for (let i = back0; i < back0 + f.backVertexCount; i++) assert.equal(vtx(m, i)[V.kind], FALL_KIND_BACK);
  // The back face's triangles come first, wound the other way.
  assert.ok(m.indices[0]! >= back0 && m.indices[0]! < back0 + f.backVertexCount);

  // Row 0 of column 3: on the crest, at the anchor's height (the slab tapers to nothing at the crest), u across the
  // water equal to the crest's arc on a straight crest.
  const r0 = vtx(m, cols[3]![0]!);
  assert.deepEqual([r0[V.posX], r0[V.posY], r0[V.posZ]], [6 * 256, 0, 0]);
  near(r0[V.u]!, 6, 1e-4, "u");
  assert.deepEqual(r0.slice(V.tau, V.kind + 1), [0, 6, 1, 1, 1, 0]);
  assert.equal(vtx(m, cols[0]![0]!)[V.edge], 0);
  near(vtx(m, cols[1]![0]!)[V.edge]!, 1 / 3);
  // Lower down u stays the crest's arc: the columns fall straight, 2 ft apart.
  for (const [c, col] of cols.entries()) near(vtx(m, col[5]!)[V.u]!, 2 * c, 1e-3, `u col ${c}`);

  // The outer column has no thickness (the lens is 0 at the tube's side): its water row and sink as 0.53 wrote them.
  const c0 = cols[0]!, wr = vtx(m, c0[c0.length - 2]!), sk = vtx(m, c0[c0.length - 1]!), prev = vtx(m, c0[c0.length - 3]!);
  assert.equal(wr[V.posY], (50 - 100) * 256);
  assert.equal(wr[V.end], 1);
  assert.equal(wr[V.drop], 50);
  assert.equal(sk[V.posY], (46 - 100) * 256);
  assert.equal(sk[V.end], 0);
  assert.equal(sk[V.drop], 54);
  const D = [0, 1, 2].map((k) => (wr[k]! - prev[k]!) / 256);
  assert.ok(-D[1]! / Math.hypot(...D) >= 0.5, "the last step is steep");
  const ox = (4 / -D[1]!) * D[0]!, oz = (4 / -D[1]!) * D[2]!;
  near(sk[V.posX]!, wr[V.posX]! + ox * 256, 0.05);
  near(sk[V.posZ]!, wr[V.posZ]! + oz * 256, 0.05);
  near(sk[V.path]!, wr[V.path]! + Math.hypot(ox, 4, oz), 1e-3);
  const raw = dbg[0]!.rows[dbg[0]!.rows.length - 1]!.speed;
  near(sk[V.tau]!, wr[V.tau]! + 4 / Math.max(raw, 0.5), 1e-4);
  assert.deepEqual(sk.slice(V.normalX, V.normalZ + 1), wr.slice(V.normalX, V.normalZ + 1), "the sink takes the water row's normal");
  for (const i of c0.slice(0, -1)) assert.equal(vtx(m, i)[V.end], 1);
  // An inner column is pushed out along its normal: the middle one's water row stands above the surface.
  const mid = cols[10]!, mw = vtx(m, mid[mid.length - 2]!);
  assert.ok(mw[V.posY]! > (50 - 100) * 256);

  // ADVECT: the speed changes by at most 1.25 ft/s a foot of path down every column; path and tau never go back.
  for (const c of cols) for (let k = 1; k < c.length; k++) {
    const a = vtx(m, c[k - 1]!), b = vtx(m, c[k]!);
    assert.ok(Math.abs(b[V.speed]! - a[V.speed]!) <= 1.25 * Math.max(0, b[V.path]! - a[V.path]!) + 1e-3);
    assert.ok(b[V.path]! >= a[V.path]! && b[V.tau]! >= a[V.tau]!);
  }

  // Normals: unit, the front facing (fx, 1, fz) = (0, 1, -1), the back face the other way.
  for (const c of cols) for (const i of c) {
    const v = vtx(m, i);
    near(Math.hypot(v[V.normalX]!, v[V.normalY]!, v[V.normalZ]!), 1, 1e-5);
    assert.ok(v[V.normalY]! - v[V.normalZ]! >= 0);
  }
  const bk = vtx(m, back0 + 5);
  assert.ok(bk[V.normalY]! - bk[V.normalZ]! <= 0);

  // Foam: three vertices a column at the surface + 0.1 ft, 40 ft wide (clamp(1.5 * 50, 4, 40)).
  const fo = back0 + f.backVertexCount;
  const [a, b, c] = [vtx(m, fo), vtx(m, fo + 1), vtx(m, fo + 2)];
  for (const v of [a, b, c]) {
    assert.equal(v[V.kind], FALL_KIND_FOAM);
    near(v[V.posY]!, (50.1 - 100) * 256, 1e-3);
    assert.equal(v[V.path], 0);
    assert.deepEqual(v.slice(V.normalX, V.normalZ + 1), [0, 1, 0]);
    assert.equal(v[V.drop], 50);
    assert.equal(v[V.air], 0);
  }
  assert.deepEqual([a[V.end], b[V.end], c[V.end]], [0, 1, 0]);
  assert.deepEqual([b[V.posX], b[V.posZ]], [wr[V.posX], wr[V.posZ]]);
  near(Math.abs(a[V.posX]! - b[V.posX]!) / 256, 20, 1e-3);
  near(Math.abs(c[V.posX]! - b[V.posX]!) / 256, 20, 1e-3);
  assert.equal(b[V.speed], Math.fround(raw), "foam speed is the raw |v|");
  // Foam triangles close the index list.
  const ft = Array.from(m.indices.subarray(f.indexCount - 4 * 20 * 3, f.indexCount - 4 * 19 * 3));
  assert.deepEqual(ft, [fo, fo + 3, fo + 4, fo, fo + 4, fo + 1, fo + 1, fo + 4, fo + 5, fo + 1, fo + 5, fo + 2]);

  // Bounds include the foam's 20 ft overhang on both ends and the sinks.
  near(f.bounds.min[0], -20 * 256, 0.01);
  near(f.bounds.max[0], 60 * 256, 0.01);
  assert.ok(f.bounds.max[1] >= 0);
  assert.ok(f.bounds.min[1] <= (46 - 100) * 256);

  // One stream, in water: across the 40 ft of columns + the 2 ft spacing.
  assert.equal(f.streams.length, 1);
  const L = f.landing, S0 = f.streams[0]!;
  assert.deepEqual([S0.columns, S0.water, f.totalColumns], [21, true, 21]);
  assert.deepEqual([L.y, L.drop, L.dirX, L.dirZ], [50, 50, 0, -1]);
  near(L.width, 42, 1e-9);
  near(L.x, 1020, 1e-9);
  assert.deepEqual(L, { x: S0.x, y: S0.y, z: S0.z, width: S0.width, drop: S0.drop, dirX: S0.dirX, dirZ: S0.dirZ });
  assert.equal(f.rowsMin, f.rowsMax);
});

test("the shelf's mist box and sound", () => {
  const m = buildFallMeshes([shelf], { ground: shelfGround, water: shelfWater });
  const f = m.falls[0]!;
  const mist = fallMist(f, shelf)!;
  // density = 1 * clamp(6 * 40 * 50 / 7200, 0.25, 2) * 1
  near(mist.density, 12000 / 7200, 1e-12);
  assert.equal(mist.lengthFt, 30);
  near(mist.widthFt, 42 + 2 * 4.5, 1e-9, "W = width + 2 clamp(0.05 drop + 2, 2, 6)");
  assert.equal(mist.heightFt, 35);
  near(mist.centre[0], 1020, 1e-9);
  near(mist.centre[1], f.landing.z - 9, 1e-9);
  assert.equal(mist.floorFt, 48);
  assert.deepEqual(mist.axisL, [0, -1]);
  assert.deepEqual(mist.axisW, [1, 0]);
  near(mist.fog.vis, 72, 1e-9);
  assert.equal(mist.fog.half, 17.5);
  assert.equal(mist.fog.wmask, 0x1df, "FREEZE: not in snow");
  assert.deepEqual([mist.fog.edge, mist.fog.top, mist.fog.bot, mist.fog.maxOp, mist.fog.round, mist.fog.wisp, mist.fog.wsize, mist.fog.wspd],
    [20, 5, 0, 1, 1, 0.6, 25, 2]);
  assert.deepEqual(mist.fog.color, [0.75, 0.78, 0.82]);
  assert.equal(fallMist(f, { ...shelf, flags: 2 })!.fog.wmask, 0x1ff);
  near(fallMist(f, shelf, { waterfallMistPct: 50 })!.density, 0.5 * 12000 / 7200, 1e-12);
  assert.equal(fallMist(f, shelf, { waterfallMistPct: 0 }), null);
  assert.equal(fallMist(f, { ...shelf, mist: 0 }), null);
  // The 0.6 * drop and 20 ft floors; mist depth / height %, and H at most 240; W's margin at most 6 ft a side.
  const tall = { ...f, streams: [{ ...f.streams[0]!, drop: 500 }] };
  const t = fallMist(tall, { ...shelf, mistDepth: 50, mistHeight: 250 })!;
  assert.equal(t.lengthFt, 150);
  assert.equal(t.heightFt, 240);
  assert.equal(t.density, 2, "clamped at 2");
  near(t.widthFt, 42 + 12, 1e-9);
  // A narrow stream: W at least 6; a stream's share of the columns thins it before the clamp.
  const thin = { ...f, streams: [{ ...f.streams[0]!, width: 0, drop: 0 }] };
  assert.equal(fallMist(thin, shelf)!.widthFt, 6);
  const half = { ...f, totalColumns: 42 };
  near(fallMist(half, shelf)!.density, 0.5 * 12000 / 7200, 1e-12);
  assert.equal(fallMist(f, shelf, { stream: 1 }), null, "no second stream");

  // Volume (volume% / 100) * clamp(speed * L / 240, 0.3, 1); hearing 1 + clamp((speed * L - 240) / 960, 0, 1).
  const s = fallSound(f, shelf);
  assert.ok(s.silent === null);
  assert.equal(s.volume, 1);
  assert.equal(s.hearing, 1);
  assert.equal(s.file, "sound\\ROAR.WAV");
  assert.deepEqual(s.position, [f.landing.x, 50, f.landing.z], "at the main landing");
  const fast = { ...f, crestSpeedFtPerSec: 12 }, slow = { ...f, crestSpeedFtPerSec: 1 };
  const sf = fallSound(fast, { ...shelf, volume: 150 }), ss = fallSound(slow, { ...shelf, volume: 150 });
  assert.ok(sf.silent === null && ss.silent === null);
  assert.equal(sf.volume, 1.5);
  assert.equal(sf.hearing, 1.25);
  near(ss.volume, 0.45, 1e-12);
  assert.equal(ss.hearing, 1);
  assert.deepEqual(fallSound(f, { ...shelf, flags: 3 }), { silent: "no-sound-flag" });
  assert.deepEqual(fallSound(f, { ...shelf, soundName: "" }), { silent: "no-stem" });
  assert.deepEqual(fallSound(f, shelf, { snow: true }), { silent: "frozen" });
  const wrapped = fallSound({ ...f, landing: { ...f.landing, x: -10, z: 8200 } }, shelf);
  assert.ok(wrapped.silent === null);
  assert.deepEqual([wrapped.position[0], wrapped.position[2]], [8182, 8]);
  assert.equal(FALL_SOUND_LOOP_ROOM, 30);
  assert.equal(fallSoundGain(1, 2, 1000), 0);
  near(fallSoundGain(1, 2, 999.999999), 0.5, 1e-6);
  near(fallSoundGain(0.8, 1, 250), 0.8 * (1 - Math.sqrt(250) / Math.sqrt(1000)), 1e-12);
});

// ---- 2. A spring onto dry ground: the trailing-flat trim ----

const slopeGround = (_x: number, z: number) => (z >= 2000 ? 100 : z >= 1960 ? 100 - (2000 - z) : 60);
const dry = () => null;

test("a spring down a slope onto dry flat ground: rest ends, the trim keeps 8 ft past the last 1 ft of drop", () => {
  const spring = rec({ pts: [[2000, 2000], [2010, 2000]], height: 200 });
  const dbg = fallDebugColumns(spring, 2, { ground: slopeGround, water: dry })!;
  assert.equal(dbg.length, 6);
  const slideY: number[] = [];
  for (const c of dbg) {
    assert.equal(c.end, 2);
    const n = c.rows.length;
    // The rule of 12.2.5, from the rows.
    const flat = (i: number) => {
      const r = c.rows[i]!;
      const a = -(slopeGround(r.x + 0.5, r.z) - slopeGround(r.x - 0.5, r.z)), b = -(slopeGround(r.x, r.z + 0.5) - slopeGround(r.x, r.z - 0.5));
      return r.air === 0 && 1 / Math.hypot(a, 1, b) > 0.9848078;
    };
    let k = n;
    while (k > 0 && flat(k - 1)) k--;
    assert.ok(k < n, "the column ends in a flat contact");
    let s = Math.max(k - 1, 0);
    while (s < n && c.rows[s]!.y - c.rows[n - 1]!.y >= 1) s++;
    assert.ok(c.rows[n - 1]!.path - c.rows[s]!.path > 8);
    // The water slides down: no airborne stretch drops half the fall, so the landing is the run-out's start (16.3.2).
    slideY.push(c.rows[s]!.y);
    const kept = c.keptRows;
    assert.ok(kept < n, "trimmed");
    assert.ok(c.rows[kept - 1]!.path - c.rows[s]!.path > 8);
    assert.ok(c.rows[kept - 2]!.path - c.rows[s]!.path <= 8);
  }
  const m = buildFallMeshes([spring], { ground: slopeGround, water: dry });
  const f = m.falls[0]!;
  assert.deepEqual(f.ends, { water: 0, rest: 6, limit: 0 });
  assert.equal(f.foamVertexCount, 0);
  assert.equal(f.sheetVertexCount, dbg.reduce((n, c) => n + c.keptRows, 0));
  const cols = columnsOf(m, f);
  cols.forEach((c, i) => assert.equal(c.length, dbg[i]!.keptRows));
  // The end fade: clamp((P_last - P) / 6, 0, 1).
  const c0 = cols[0]!, pLast = vtx(m, c0[c0.length - 1]!)[V.path]!;
  for (const i of c0) near(vtx(m, i)[V.end]!, Math.min(1, Math.max(0, (pLast - vtx(m, i)[V.path]!) / 6)), 1e-5);
  assert.equal(vtx(m, c0[c0.length - 1]!)[V.end], 0);
  // No kept water: one dry stream of every live column at its landing row, 5 x 2 ft + the spacing wide, with mist
  // (16.4: the 0.53 water-end test is gone).
  assert.equal(f.streams.length, 1);
  const st = f.streams[0]!;
  assert.deepEqual([st.water, st.columns], [false, 6]);
  near(st.width, 12, 1e-9);
  near(st.y, slideY.reduce((a, b) => a + b, 0) / 6, 1e-9);
  near(st.drop, 100 - st.y, 1e-9);
  assert.deepEqual([st.dirX, st.dirZ], [0, -1]);
  const mist = fallMist(f, spring)!;
  assert.ok(mist !== null, "a dry fall has its mist");
  near(mist.floorFt, st.y - 2, 1e-9);
  near(mist.widthFt, 12 + 2 * Math.min(Math.max(0.05 * st.drop + 2, 2), 6), 1e-9);
});

// ---- 3. A bent crest ----

test("a bent crest: columns along the polyline, the inner point's direction, and a turn over 90 deg refused", () => {
  const p1: [number, number] = [3020, 3000];
  const p2: [number, number] = [3030, 3000 - 17.3125];
  const bent = rec({ pts: [[3000, 3000], p1, p2], height: 200 });
  const flat = () => 0, wet = () => 10;
  assert.equal(validateFall(bent), null);
  const L2 = Math.hypot(10, 17.3125), L = 20 + L2;
  const dbg = fallDebugColumns(bent, 2, { ground: flat, water: wet })!;
  assert.equal(dbg.length, Math.ceil(L / 2 - 1e-9) + 1);
  dbg.forEach((c, i) => assert.equal(c.s, i < dbg.length - 1 ? 2 * i : L));
  // Column 10 sits on the inner point; its flow is normalize(dir in + dir out), each (dz, -dx) of its segment.
  const c10 = dbg[10]!;
  near(c10.x, 3020, 1e-9);
  near(c10.z, 3000, 1e-9);
  const d0 = [0, -1], d1 = [-17.3125 / L2, -10 / L2];
  const sx = d0[0]! + d1[0]!, sz = d0[1]! + d1[1]!, sl = Math.hypot(sx, sz);
  near(c10.fx, sx / sl, 1e-12);
  near(c10.fz, sz / sl, 1e-12);
  // A column on the second segment lies on it.
  const c13 = dbg[13]!, t = (26 - 20) / L2;
  near(c13.x, 3020 + 10 * t, 1e-9);
  near(c13.z, 3000 - 17.3125 * t, 1e-9);
  const m = buildFallMeshes([bent], { ground: flat, water: wet });
  assert.equal(m.falls[0]!.columns, dbg.length);
  near(m.falls[0]!.crestLengthFt, L, 1e-9);
  // 120 deg: the second segment heads back.
  assert.equal(validateFall(rec({ pts: [[3000, 3000], p1, [3010, 3000 - 17.3125]], height: 200 })), "FALL_TURN");
});

// ---- 4. Refusals and record checks ----

test("REFUSED: POINTS, TURN, WIDTH, SOURCE, HEIGHT, DIRECTION, in the engine's order", () => {
  const tileMap = new Uint8Array(65536);
  for (let tx = 30; tx <= 40; tx++) tileMap[100 * 256 + tx] = 1; // lake 1 at z 3200..3232
  const ctx = { lakes: [{ id: 1, height: 200 }], tileMap };
  // Flow (dz, -dx) points to -z, away from the lake on the +z side.
  const fed = rec({ pts: [[1000, 3200], [1040, 3200]], height: 200, source: 1 });
  assert.equal(validateFall(fed, ctx), null);
  assert.equal(validateFall({ ...fed, source: 2 }, ctx), "FALL_SOURCE");
  assert.equal(validateFall(fed, {}), "FALL_SOURCE", "no WTR loaded");
  assert.equal(validateFall({ ...fed, height: 201 }, ctx), "FALL_HEIGHT");
  assert.equal(validateFall(rec({ pts: [[1040, 3200], [1000, 3200]], height: 200, source: 1 }), ctx), "FALL_DIRECTION");
  assert.equal(validateFall(rec({ pts: [[1000, 3200], [1001.5, 3200]], height: 200 })), "FALL_POINTS");
  assert.equal(validateFall(rec({ pts: [[1000, 3200], [1010, 3200], [1001, 3201]], height: 200 })), "FALL_TURN");
  assert.equal(validateFall(rec({ pts: [[1000, 3200], [2100, 3200]], height: 200 })), "FALL_WIDTH");
  assert.equal(validateFall(rec({ pts: [[1000, 3200], [2024, 3200]], height: 200 })), null, "1024 ft is allowed");
  // POINTS is tested before WIDTH and SOURCE.
  assert.equal(validateFall(rec({ pts: [[1000, 3200], [1001, 3200], [2100, 3200]], height: 200, source: 9 }), ctx), "FALL_POINTS");
  // The wrapped difference: 8190 -> 2 is a 4 ft segment across the seam.
  assert.equal(validateFall(rec({ pts: [[8190, 100], [2, 100]], height: 200 })), null);
  // A spring skips the lake checks.
  assert.equal(validateFall({ ...fed, source: 0, height: 999 }, ctx), null);
  // A point whose probe misses the lake: the second point steps off the lake's last tile.
  assert.equal(validateFall(rec({ pts: [[1000, 3200], [1320, 3200]], height: 200, source: 1 }), ctx), "FALL_DIRECTION");

  const m = buildFallMeshes([fed, { ...fed, id: 2, height: 202 }], { ...ctx, ground: () => 0, water: () => 10 });
  assert.equal(m.falls.length, 1);
  assert.deepEqual(m.refused, [{ index: 1, id: 2, reason: "FALL_HEIGHT" }]);
  assert.equal(m.skipped, true);
  assert.equal(m.tooBig, false);
});

test("record checks: id, duplicate, coordinates, speed, height, flags, names, 64 accepted; clamps", () => {
  const ok = (id: number, o: Partial<WflFall> = {}): WflFall => ({ ...rec({ id, pts: [[100, 100], [110, 100]], height: 100 }), ...o });
  const r = checkFallRecords([
    ok(1, { opacity: 150, mist: 250, volume: 230 }),
    ok(0),
    ok(1),
    ok(3, { points: [{ x: 0x20000, z: 0 }, { x: 0, z: 0 }] }),
    ok(4, { speed: 15 }), ok(5, { speed: 1601 }),
    ok(6, { height: 0 }), ok(7, { height: 4097 }),
    ok(8, { flags: 8 }),
    ok(9, { soundName: "ABCDEFGHIJKLMNOP" }),
    ok(10, { points: [{ x: 1, z: 1 }] }),
    ok(11, { speed: 16, height: 4096, flags: 7 }),
  ]);
  assert.deepEqual(r.accepted.map((a) => a.index), [0, 11]);
  assert.deepEqual(r.counters, { badId: 1, dupId: 1, badPoints: 1, badCoord: 1, badSpeed: 2, badHeight: 2, badFlags: 1, badName: 1, over: 0 });
  const a = r.accepted[0]!.fall;
  assert.deepEqual([a.opacity, a.mist, a.volume], [100, 200, 200]);
  // The id is taken before the later checks: a bad record still holds its id.
  const held = checkFallRecords([ok(5, { speed: 1 }), ok(5)]);
  assert.deepEqual(held.counters.dupId, 1);
  assert.equal(held.accepted.length, 0);
  const many = checkFallRecords(Array.from({ length: 66 }, (_, i) => ok(i + 1)));
  assert.equal(many.accepted.length, 64);
  assert.equal(many.counters.over, 2);
  const m = buildFallMeshes([ok(1), ok(1)], { ground: () => 0, water: () => 10 });
  assert.equal(m.falls.length, 1);
  assert.equal(m.skipped, true, "a record counter raises \"skipped\"");
});

// ---- 5. The budget ----

const wide = (id: number) => rec({ id, pts: [[500, 4000], [1500, 4000]], height: 350 });
const cliff = (_x: number, z: number) => (z >= 4000 ? 175 : 0);
const pool = () => 100;

test("budget: a coarser spacing when 2 ft is over 32768 vertices with the back face; the track fills, then DROPPED, and the loop goes on", () => {
  const at2 = fallDebugColumns(wide(1), 2, { ground: cliff, water: pool })!;
  const need2 = at2.reduce((n, c) => n + c.rows.length + 1, 0) + 3 * at2.length;
  assert.equal(FALL_MAX_FALL_VERTICES, 32768);
  assert.ok(need2 < FALL_MAX_FALL_VERTICES, `the sheet and foam alone fit (${need2})`);
  // The back face (16.3.3) is counted in the fit, so 2 ft no longer fits.
  const falls = Array.from({ length: 40 }, (_, i) => wide(i + 1));
  falls.push(rec({ id: 41, pts: [[100, 4000], [104, 4000]], height: 350 }));
  const m = buildFallMeshes(falls, { ground: cliff, water: pool });
  const first = m.falls[0]!;
  assert.equal(first.spacing, 3);
  assert.equal(first.shortened, false);
  assert.ok(first.vertexCount <= FALL_MAX_FALL_VERTICES);
  assert.ok(first.backVertexCount > 0);
  assert.ok(m.vertices.length / 16 <= FALL_MAX_TRACK_VERTICES);
  assert.ok(m.falls.some((f) => f.spacing > 3), "later falls go coarser as the track room shrinks");
  assert.ok(m.dropped.length > 0);
  assert.equal(m.tooBig, true);
  assert.equal(m.skipped, false);
  const left = FALL_MAX_TRACK_VERTICES - m.falls.filter((f) => f.index < m.dropped[0]!.index).reduce((n, f) => n + f.vertexCount, 0);
  assert.equal(m.dropped[0]!.left, left);
  assert.ok(left < 2 * 126, "not even 2 rows of the 8 ft columns fit");
  assert.equal(m.falls[m.falls.length - 1]!.id, 41, "a small fall after the drops is still built");
  m.falls.forEach((f, i) => {
    assert.equal(f.slot, i);
    assert.equal(m.vertices[f.firstVertex * 16 + V.fall], i);
    if (i > 0) {
      const p = m.falls[i - 1]!;
      assert.equal(f.firstVertex, p.firstVertex + p.vertexCount);
      assert.equal(f.firstIndex, p.firstIndex + p.indexCount);
    }
  });
});

test("budget: SHORTENED at 8 ft by bisection, R the most rows that fit with the back face", () => {
  // A 2048 ft free fall: 126 columns of about 256 rows at 8 ft, all of it airborne, so the back face doubles it.
  const m = buildFallMeshes([rec({ pts: [[500, 4000], [1500, 4000]], height: 4096 })], { ground: () => 0, water: () => 1 });
  const f = m.falls[0]!;
  assert.equal(f.spacing, 8);
  assert.equal(f.columns, 126);
  assert.equal(f.shortened, true);
  assert.equal(f.rowLimit, Math.floor(FALL_MAX_FALL_VERTICES / (2 * 126)));
  assert.equal(f.sheetVertexCount, 126 * 130);
  assert.equal(f.backVertexCount, 126 * 130);
  assert.equal(f.vertexCount, 2 * 126 * 130);
  assert.deepEqual([f.rowsMin, f.rowsMax], [130, 130]);
  assert.equal(f.ends.water, 126, "the walk still ended in water");
  assert.equal(f.foamVertexCount, 0, "no water column is kept");
  assert.equal(f.indexCount, 2 * 3 * 125 * (2 * 130 - 2));
  // No column is kept in water: one dry stream over every column.
  assert.deepEqual([f.streams.length, f.streams[0]!.water, f.streams[0]!.columns], [1, false, 126]);
  near(f.landing.width, 125 * 8 + 8, 1e-6);
  assert.ok(fallMist(f, rec({ pts: [[0, 0], [2, 0]], height: 1 })) !== null);
});

// ---- Ground, water, looks ----

test("fallGround: the engine's integer triangles (classic and fine), wrapping", () => {
  const coarse = new Uint16Array(65536);
  coarse[0 * 256 + 1] = 1 << 8; // corner x 1, z 0 at 2 ft
  const g = fallGround({ mode: "classic8", coarse, fine: null });
  assert.equal(g(0, 0), 0);
  assert.equal(g(32, 0), 2);
  assert.equal(g(16, 0), 1);
  assert.equal(g(3, 0), 0.1875);
  // Truncation: 1.01 ft -> xi 258, fraction 2064, (512 * 2064) >> 16 = 16 -> 1/16 ft (a float lerp gives 0.063125).
  assert.equal(g(1.01, 0), 0.0625);
  assert.equal(g(-16, 0), g(8192 - 16, 0));
  assert.equal(g(16 + 8192, 0), 1);
  // Cell (0, 0) is same parity: x > z uses the (1, 0) corner, x < z does not.
  assert.equal(g(16, 8), 0.5); // 2 * 0.5 + (0 - 2) * 0.25
  assert.equal(g(8, 16), 0);
  // Cell (1, 0): other parity, split from (2, 0) to (1, 1).
  assert.equal(g(40, 0), 1.5);
  // 16-bit: the lowest bit is dropped (v >> 1 at 1/64 ft).
  const c16 = new Uint16Array(65536);
  c16[0] = 129;
  assert.equal(fallGround({ mode: "classic16", coarse: c16, fine: null })(0, 0), 1);
  // Fine grid: 8 ft cells, the same rule.
  const fine = new Uint16Array(1024 * 1024);
  fine[0 * 1024 + 1] = 1280; // 10 ft at x 8
  const gf = fallGround({ mode: "fine", coarse: new Uint16Array(65536), fine });
  assert.equal(gf(8, 0), 10);
  assert.equal(gf(4, 0), 5);
  assert.equal(gf(4, 0), fallTerrainHeight(Int32Array.from(fine, (v) => v >> 1), 1024, 4, 0));
});

test("fallWater: the tile's lake, the source exclusion, the .LVL water below 1/256 ft is none", () => {
  const tileMap = new Uint8Array(65536);
  tileMap[3 * 256 + 2] = 1;
  tileMap[3 * 256 + 3] = 7; // a lake the loader did not keep
  const wtr = { lakes: [{ id: 1, height: 300 }], tileMap };
  const w = fallWater(wtr, 20);
  assert.equal(w(70, 100, 0), 150);
  assert.equal(w(70, 100, 1), 20, "the source lake's own tiles are the track's water");
  assert.equal(w(10, 10, 1), 20);
  assert.equal(w(110, 100, 0), null);
  assert.equal(w(70 - 8192, 100 + 8192, 0), 150, "wraps");
  assert.equal(fallWater(wtr, 1 / 512)(10, 10, 0), null);
  assert.equal(fallWater(wtr, 1 / 256)(10, 10, 0), 1 / 256);
  assert.equal(fallWater(null, null)(70, 100, 0), null);
});

test("looks, the ripple, texture names, mist slots", () => {
  const o = { waterRealism: false, enhancedWater: false, weather: 0, flags: 1, gpu: FALL_GPU_DRAW | FALL_GPU_ICE };
  assert.equal(fallLook(o), FALL_LOOK_ORIGINAL);
  assert.equal(fallLook({ ...o, enhancedWater: true }), FALL_LOOK_ENHANCED);
  assert.equal(fallLook({ ...o, enhancedWater: true, waterRealism: true }), FALL_LOOK_REALISTIC);
  assert.equal(fallLook({ ...o, weather: 5 }), FALL_LOOK_ICE);
  assert.equal(fallLook({ ...o, weather: 5, gpu: FALL_GPU_DRAW }), FALL_LOOK_ORIGINAL, "no ice bit: drawn as water");
  assert.equal(fallLook({ ...o, weather: 5, flags: 2 }), FALL_LOOK_ORIGINAL);
  assert.equal(fallLook({ ...o, gpu: 0 }), null);
  assert.equal(FALL_RIPPLE_FRAMES.length, 14);
  assert.deepEqual([FALL_RIPPLE_FRAMES[0], FALL_RIPPLE_FRAMES[7], FALL_RIPPLE_FRAMES[8], FALL_RIPPLE_FRAMES[13]],
    ["RIPPL100.RAW", "RIPPL800.RAW", "RIPPL700.RAW", "RIPPL200.RAW"]);
  assert.equal(fallRippleFrame(0.25 * 14 + 0.3), "RIPPL200.RAW");
  assert.equal(fallTextureName("FALLS"), "FALLS.RAW");
  assert.equal(fallTextureName("FALLS.PNG"), "FALLS.PNG");
  assert.equal(fallMistSlotFree(63, 0), true);
  assert.equal(fallMistSlotFree(60, 4), false);
  const m = buildFallMeshes(Array.from({ length: 3 }, (_, i) => ({ ...shelf, id: i + 1 })), { ground: shelfGround, water: shelfWater });
  const r = fallMists(m.falls, { sitFogVolumes: 62 });
  assert.deepEqual(r.mists.map((x) => [x.slot, x.stream]), [[0, 0], [1, 0]]);
  assert.deepEqual(r.noSlot, [{ slot: 2, stream: 0 }]);
  assert.equal(typeof cp4Sim.buildFallMeshes, "function");
});

// ---- The engine's reader (12.1.2, 12.1.3) ----

const fileOf = (n = 1, extra: Partial<Parameters<typeof writeWfl>[0][number]> = {}) => writeWfl(Array.from({ length: n }, (_, i) => ({
  source: 0, flags: 2, speed: 96, height: 200, points: [{ x: 1600 + i * 64, z: 1600 }, { x: 1600 + i * 64, z: 2400 }],
  opacity: 80, mist: 50, volume: 100, soundName: "ROAR", textureName: "", ...extra,
})));
const poke16 = (b: Uint8Array, o: number, v: number) => { const c = b.slice(); c[o] = v & 255; c[o + 1] = v >> 8; return c; };
const poke32 = (b: Uint8Array, o: number, v: number) => { const c = poke16(b, o, v & 0xffff); c[o + 2] = (v >>> 16) & 255; c[o + 3] = v >>> 24; return c; };

test("readFallFile reads a Traxx file as parseWfl does", () => {
  const bytes = fileOf(2, { mistDepth: 150, mistHeight: 0 });
  const f = readFallFile(bytes);
  assert.equal(f.status, 0);
  assert.deepEqual([f.major, f.minor, f.stride], [1, 1, 132]);
  assert.deepEqual(f.falls, parseWfl(bytes).falls);
  assert.deepEqual(Object.values(f.counters), [0, 0, 0, 0, 0, 0]);
});

test("readFallFile: the engine's status codes, in its order (12.1.2)", () => {
  const ok = fileOf();
  assert.equal(readFallFile(new Uint8Array(0)).status, 1);
  assert.equal(readFallFile(ok.slice(0, 3)).status, 3, "under 4 bytes");
  assert.equal(readFallFile(Uint8Array.from([0x4d, 0x57, 0x46, 0x58, ...ok.slice(4)])).status, 2, "bad magic");
  assert.equal(readFallFile(ok.slice(0, 0x1f)).status, 3, "under the header");
  assert.equal(readFallFile(poke16(ok, 4, 3)).status, 4, "major 3");
  assert.equal(readFallFile(poke16(ok, 4, 0)).status, 4, "major 0");
  assert.equal(readFallFile(poke32(ok, 8, 0x10)).status, 5, "directory inside the header");
  assert.equal(readFallFile(poke32(ok, 12, 99)).status, 5, "directory past the end");
  assert.equal(readFallFile(poke16(ok, 0x10, 128)).status, 6, "another terrain size");
  for (const s of [0, 2, 3, 4, 5, 6, 7] as const) assert.equal(typeof FALL_FILE_STATUS_TEXT[s], "string");
  assert.equal(FALL_FILE_STATUS_TEXT[7], "no usable waterfall list");
});

test("readFallFile: only the first FALL entry, and the chunk's counters (12.1.2)", () => {
  const ok = fileOf();
  const unknown = ok.slice(); unknown.set([0x58, 0x58, 0x58, 0x58], 32);
  const u = readFallFile(unknown);
  assert.deepEqual([u.status, u.counters.unknown], [7, 1]);
  const v2 = readFallFile(poke32(ok, 36, 2));
  assert.deepEqual([v2.status, v2.counters.badVersion], [7, 1]);
  const past = readFallFile(poke32(ok, 44, 100000));
  assert.deepEqual([past.status, past.counters.outOfBounds], [7, 1]);
  const stride = readFallFile(poke16(ok, 52, 0x7f));
  assert.deepEqual([stride.status, stride.counters.badStride], [7, 1]);
  assert.equal(readFallFile(poke32(ok, 48, 0)).status, 7, "no records");
  // A second FALL entry is a duplicate; the first is still read.
  const two = new Uint8Array(ok.length + 16);
  two.set(ok.slice(0, 48)); two.set(ok.slice(32, 48), 48); two.set(ok.slice(48), 64);
  const d = readFallFile(poke32(poke32(poke32(two, 12, 2), 40, 64), 56, 64));
  assert.deepEqual([d.status, d.counters.duplicate, d.falls.length], [0, 1, 1]);
  // A count past the chunk is clamped to what it holds.
  const t = readFallFile(poke32(fileOf(3), 48, 9));
  assert.deepEqual([t.status, t.falls.length, t.counters.truncated], [0, 3, 1]);
});

test("readFallFile leaves bad records to the record checks: skipped, not refused (12.1.2)", () => {
  const nine = poke16(fileOf(2), 56 + 2, 9);
  const f = readFallFile(nine);
  assert.equal(f.status, 0);
  assert.equal(f.falls[0]!.points.length, 9);
  const c = checkFallRecords(f.falls);
  assert.deepEqual([c.counters.badPoints, c.accepted.length], [1, 1]);
  assert.throws(() => parseWfl(nine), "Traxx's reader refuses the whole file");
  const named = fileOf(1);
  for (let i = 0; i < 16; i++) named[56 + 0x50 + i] = 0x41;
  const n = readFallFile(named);
  assert.equal(n.falls[0]!.soundName.length, 16);
  assert.equal(checkFallRecords(n.falls).counters.badName, 1);
  const many = readFallFile(fileOf(64));
  assert.equal(many.falls.length, 64);
  assert.equal(checkFallRecords([...many.falls, { ...many.falls[0]!, id: 65 }]).counters.over, 1);
});

// ---- Beta 0.53 hotfix 3 (16) ----

test("readFallFile: roughFrom (byte 0x82) as hotfix 3 reads it: 251..254 become 0 and are counted, 0 and 255 kept (16.2.2)", () => {
  const values = [0, 25, 250, 251, 254, 255];
  const bytes = writeWfl(values.map((roughFrom, i) => ({
    source: 0, flags: 2, speed: 96, height: 200, points: [{ x: 1600 + i * 64, z: 1600 }, { x: 1600 + i * 64, z: 2400 }],
    opacity: 80, mist: 50, volume: 100, soundName: "", textureName: "", roughFrom,
  })));
  const f = readFallFile(bytes);
  assert.equal(f.stride, 132);
  assert.deepEqual(f.falls.map((x) => x.roughFrom), [0, 25, 250, 0, 0, 255]);
  assert.equal(f.roughInvalid, 2);
  assert.equal(f.status, 0, "no message: not a damaged file");
  assert.deepEqual(parseWfl(bytes).falls.map((x) => x.roughFrom), values, "the authoring reader stays raw");
  // A v1.0 file (128-byte records) has no roughFrom.
  const old = readFallFile(fileOf(1));
  assert.deepEqual([old.stride, old.falls[0]!.roughFrom, old.roughInvalid], [128, 0, 0]);
  // The built fall carries it (the shader's per-fall [3].y).
  const m = buildFallMeshes([{ ...shelf, roughFrom: 40 }], { ground: shelfGround, water: shelfWater });
  assert.equal(m.falls[0]!.roughFrom, 40);
});

test("slab thickness (16.3.10): crest depth, drape and air, the lens, the tapers, wfDepthScale and waterfallBulk", () => {
  const base = { v0: 6, vE: 6, air: 1, drop: 50, s: 10, lEnd: 100, a: 5, b: 5, columns: 21 };
  // h0 = min(2, 36 / 32) = 1.125; in the air h0 (1 + 50 / 25) = 3.375.
  near(fallSlabThickness(base), 3.375, 1e-12);
  // Draped at half the crest speed: h0 v0 / vE = 2.25 (under pile 2.25 and 2.5).
  near(fallSlabThickness({ ...base, air: 0, vE: 3 }), 2.25, 1e-12);
  // Draped and fast: the 0.5 ft floor.
  near(fallSlabThickness({ ...base, air: 0, vE: 60 }), 0.5, 1e-12);
  // Halfway into the air: the mean of the two.
  near(fallSlabThickness({ ...base, air: 0.5, vE: 6 }), (1.125 + 3.375) / 2, 1e-12);
  // A fast crest: h0 stops at 2 ft; a tall drop is clamped at 8 ft.
  near(fallSlabThickness({ ...base, v0: 16, vE: 16, drop: 200 }), 8, 1e-12);
  // The lens: a = 1, b = 3, t = -0.5, sqrt(0.75); 0 at the tube's side.
  near(fallSlabThickness({ ...base, a: 1, b: 3 }), 3.375 * Math.sqrt(0.75), 1e-12);
  assert.equal(fallSlabThickness({ ...base, a: 0, b: 6 }), 0);
  // The tapers: 1 ft at the crest, 3 ft at the foot.
  near(fallSlabThickness({ ...base, s: 0.5 }), 3.375 * 0.5, 1e-12);
  near(fallSlabThickness({ ...base, s: 99 }), 3.375 / 3, 1e-12);
  // Two columns or fewer: a flat sheet.
  assert.equal(fallSlabThickness({ ...base, columns: 2 }), 0);
  // The spread factor and the merge weight multiply the draped depth.
  near(fallSlabThickness({ ...base, air: 0, vE: 6, k: 2 }), 2.25, 1e-12);
  // wfDepthScale 200: h0 = min(4, 2.25) = 2.25; waterfallBulk 300: the drape floor 1.5, the air (1 + 3 * 50 / 25).
  near(fallSlabThickness({ ...base, ds: 2 }), 2.25 * 3, 1e-12);
  near(fallSlabThickness({ ...base, air: 0, vE: 60, bulk: 3 }), 1.5, 1e-12);
  near(fallSlabThickness({ ...base, bulk: 3 }), 1.125 * 7, 1e-12);
  // The options reach the build: a thicker slab pushes the middle column further.
  const thick = (o: object) => {
    const m = buildFallMeshes([shelf], { ground: shelfGround, water: shelfWater, ...o });
    const f = m.falls[0]!, i = f.columnRows.slice(0, 10).reduce((n, r) => n + r, 0) + 6;
    return vtx(m, i)[V.posY]!;
  };
  assert.ok(thick({ waterfallBulk: 400 }) > thick({}));
  assert.equal(thick({ waterfallBulk: 0 }), thick({ waterfallBulk: 1 }), "clamped to 1..1000");
});

test("CountBack (16.3.3): the corners of every sheet triangle with an airborne corner; none under 3 columns", () => {
  const f = (rows: number[], air: Array<[number, number]>) => fallCountBack(rows, rows.map((n, c) => {
    const a = new Uint8Array(n);
    for (const [cc, r] of air) if (cc === c) a[r] = 1;
    return a;
  }));
  assert.deepEqual(f([3, 3, 3], []), { verts: 0, tris: 0 });
  // One airborne vertex in the middle of a 3 x 3 grid: its 6 triangles and their 7 corners.
  assert.deepEqual(f([3, 3, 3], [[1, 1]]), { verts: 7, tris: 6 });
  assert.deepEqual(f([3, 3], [[1, 1]]), { verts: 0, tris: 0 });
  // The fan of a longer column counts too.
  // (0, 1) (1, 2) (1, 3) from the left fan, (1, 2) (2, 1) (1, 3) from the right.
  assert.deepEqual(f([2, 4, 2], [[1, 3]]), { verts: 4, tris: 2 });
});

/** Water only on both sides: the middle columns land on the ground. */
const twoPools = (x: number) => (x < 1012 || x > 1028 ? 50 : null);

test("streams (16.3.12): a fall split by dry ground lands in two pools, each with its own mist, the largest the main landing", () => {
  const m = buildFallMeshes([shelf], { ground: shelfGround, water: (x) => twoPools(x) });
  const f = m.falls[0]!;
  assert.equal(f.streams.length, 2);
  const [a, b] = f.streams as [typeof f.streams[0], typeof f.streams[0]];
  assert.ok(a.water && b.water, "a fall's streams are all water when any column is kept in water");
  assert.ok(a.x < 1012 && b.x > 1028);
  assert.equal(a.columns + b.columns, f.totalColumns);
  assert.equal(f.totalColumns, f.ends.water);
  assert.deepEqual([a.y, b.y], [50, 50]);
  const main = a.columns >= b.columns ? a : b;
  assert.equal(f.landing.x, main.x);
  // One mist a stream, each dense by its share of the columns.
  const r = fallMists(m.falls);
  assert.deepEqual(r.mists.map((x) => x.stream), [0, 1]);
  const d = (s: typeof a) => Math.min(Math.max(6 * 40 * s.drop / 7200 * (s.columns / f.totalColumns), 0.25), 2);
  near(r.mists[0]!.mist.density, d(a), 1e-12);
  near(r.mists[1]!.mist.density, d(b), 1e-12);
  // The foam strip breaks with the water.
  assert.equal(f.foamVertexCount, 3 * f.totalColumns);
  // Every fall's first stream takes a fog slot before any second stream.
  const two = buildFallMeshes([shelf, { ...shelf, id: 2 }], { ground: shelfGround, water: (x) => twoPools(x) });
  const slots = fallMists(two.falls, { sitFogVolumes: 61 });
  assert.deepEqual(slots.mists.map((x) => [x.slot, x.stream]), [[0, 0], [1, 0], [0, 1]]);
  assert.deepEqual(slots.noSlot, [{ slot: 1, stream: 1 }]);
});

/** A 2 ft channel down a slope: only the middle column runs on; the others stop at the crest. */
const channel = (x: number, z: number) => (z >= 1000 ? 100 : Math.abs(x - 1020) < 1 ? 100 - (1000 - z) * 0.6 : 99.7);

test("ribbons (16.3.6): a lone column's rows get two vertices W / 2 either side; its stream is the ribbon's W wide", () => {
  const m = buildFallMeshes([rec({ pts: [[1010, 1000], [1030, 1000]], height: 200, speed: 48 })], { ground: channel, water: () => null });
  const f = m.falls[0]!;
  assert.ok(f.droppedTriangles > 0, "the fans past the stopped columns are torn");
  assert.ok(f.ribbonVertexCount > 0);
  assert.equal(f.ribbonVertexCount % 2, 0);
  assert.ok(f.ribbonTriangleCount > 0);
  const W = fallRibbonWidth(1, 2);
  assert.equal(W, 2, "clamp(0.35 x 1 x 2, 2, 1 x 2)");
  near(fallRibbonWidth(10, 2), 7, 1e-12);
  near(fallRibbonWidth(2, 8), 5.6, 1e-12);
  const r0 = f.firstVertex + f.sheetVertexCount;
  for (let i = r0; i < r0 + f.ribbonVertexCount; i += 2) {
    const l = vtx(m, i), r = vtx(m, i + 1);
    assert.deepEqual([l[V.kind], r[V.kind], l[V.edge], r[V.edge]], [0, 0, 0, 0]);
    near(Math.hypot(r[V.posX]! - l[V.posX]!, r[V.posZ]! - l[V.posZ]!) / 256, W, 1e-3, "W apart");
    near(r[V.u]! - l[V.u]!, W, 1e-4);
  }
  for (const i of m.indices) assert.ok(i >= f.firstVertex && i < f.firstVertex + f.vertexCount);
  assert.ok(Array.from(m.vertices).every(Number.isFinite));
  const lone = f.streams.find((s) => s.columns === 1 && s.drop > 100)!;
  assert.equal(lone.width, W);
  assert.equal(lone.water, false);
  // Draped water has no back face.
  assert.equal(f.backVertexCount, 0);
});

test("flow tubes (16.3.4): converging columns merge toward the middle; the merged end at the junction", () => {
  const ridge = (x: number, z: number) => (z >= 1000 ? 100 : 100 - (1000 - z) * 0.6 + Math.max(0, 12 - Math.abs(x - 1020)) * 3);
  const m = buildFallMeshes([rec({ pts: [[1000, 1000], [1040, 1000]], height: 200, speed: 48 })], { ground: ridge, water: () => 40 });
  const f = m.falls[0]!;
  assert.ok(f.mergedColumns > 0);
  assert.equal(f.columnRows.reduce((n, r) => n + r, 0), f.sheetVertexCount);
  for (const i of m.indices) assert.ok(i >= f.firstVertex && i < f.firstVertex + f.vertexCount);
  assert.ok(Array.from(m.vertices).every(Number.isFinite));
  assert.equal(f.streams.length, 2, "the ridge parts the water: two pools");
});

test("droplets (16.5): per-stream bursts within 150 ft, 6 a frame, the 80-burst bank, SPLASH, Snow + FREEZE, dry streams too", () => {
  const m = buildFallMeshes([shelf], { ground: shelfGround, water: (x) => twoPools(x) });
  const f = m.falls[0]!;
  const st = createFallDroplets(m.falls);
  assert.equal(st.rng[0], f.rngSeed);
  const near0: [number, number] = [f.streams[0]!.x, f.streams[0]!.z];
  // The bank starts empty: the first frame of 1/60 s has 8 bursts to spend, 6 at most a stream.
  const b1 = stepFallDroplets(st, m.falls, { dt: 1 / 60, player: near0, enabled: true });
  assert.ok(b1.length <= 8);
  for (const s of [0, 1]) assert.ok(b1.filter((b) => b.stream === s).length <= FALL_DROPLETS.perStreamFrame);
  for (const b of b1) {
    const s = f.streams[b.stream]!;
    assert.equal(b.waterY, s.y);
    assert.equal(b.position[1], s.y);
    assert.ok(b.intensity > 0 && b.intensity <= 1);
    assert.equal(b.halfWidth, Math.min(12, s.width / 2));
    assert.ok(b.velocity[1] > 0);
  }
  // A long frame banks at most 80.
  stepFallDroplets(st, m.falls, { dt: 10, player: near0, enabled: true });
  assert.ok(st.budget <= FALL_DROPLETS.budgetMax);
  // Far away: nothing, and the timers reset.
  const far = stepFallDroplets(st, m.falls, { dt: 1 / 60, player: [near0[0] + 400, near0[1]], enabled: true });
  assert.equal(far.length, 0);
  assert.ok(st.timers.every((t) => t === 0));
  // Through the world's wrap: a copy 8192 ft away is the same stream.
  assert.ok(stepFallDroplets(createFallDroplets(m.falls), m.falls, { dt: 0.1, player: [near0[0] + 8192, near0[1]], enabled: true }).length > 0);
  // No SPLASH, or Snow on a FREEZE fall, or the gate shut: nothing.
  const quiet = (falls: typeof m.falls, o: object = {}) => stepFallDroplets(createFallDroplets(falls), falls, { dt: 0.1, player: near0, enabled: true, ...o }).length;
  assert.equal(quiet(m.falls.map((x) => ({ ...x, flags: 0 }))), 0);
  assert.equal(quiet(m.falls, { weather: 5 }), 0, "the shelf has FREEZE");
  assert.ok(quiet(m.falls.map((x) => ({ ...x, flags: 2 })), { weather: 5 }) > 0);
  assert.equal(quiet(m.falls, { enabled: false }), 0);
  assert.equal(quiet(m.falls, { dropletsPct: 0 }), 0);
  // A dry stream throws too.
  const spring = rec({ pts: [[2000, 2000], [2010, 2000]], height: 200 });
  const d = buildFallMeshes([spring], { ground: slopeGround, water: dry });
  const ds = d.falls[0]!.streams[0]!;
  assert.equal(ds.water, false);
  assert.ok(stepFallDroplets(createFallDroplets(d.falls), d.falls, { dt: 0.1, player: [ds.x, ds.z], enabled: true }).length > 0);
});

// ---- Fila's beta 0.53 sandbox ----

const sandbox = process.env.CP4_SANDBOX_053 ?? join(homedir(), "games/cp4sandbox053/fog_test.pod");
test("Fila's beta 0.53 sandbox: both falls build on its terrain and lakes", { skip: !existsSync(sandbox) }, () => {
  const bytes = new Uint8Array(readFileSync(sandbox));
  const pod = parsePod(bytes);
  const read = (p: string) => { const e = findPodEntry(pod, p); assert.ok(e, p); return readPodEntry(bytes, e); };
  const wfl = parseWfl(read("WORLD\\FOGTEST.WFL"));
  const wtr = parseWtr(read("WORLD\\FOGTEST.WTR"));
  const lvl = parseMtmLvl(read("LEVELS\\FOGTEST.LVL"))!;
  const txv = readTxvInfo(read("DATA\\FOGTEST.TXV"));
  const heights = decodeMtm2Heights(read("DATA\\FOGTEST.RAW"), txv.terrainGrid);
  const lvlWater = lvl.waterHeight === null ? null : lvl.waterHeight * 0.5;
  const m = buildFallMeshes(wfl.falls, { ...wtr, ground: fallGround(heights), water: fallWater(wtr, lvlWater) });
  assert.deepEqual([m.refused, m.dropped, m.rejected, m.skipped, m.tooBig], [[], [], [], false, false]);
  assert.equal(m.falls.length, 2);
  const [a, b] = m.falls as [FallMeshes["falls"][number], FallMeshes["falls"][number]];
  // Fall 1: fed by lake 2 (324 ft), 94 ft of crest, into lake 1 (258.5 ft).
  assert.equal(a.source, 2);
  assert.equal(a.columns, Math.ceil(94 / 2) + 1);
  assert.equal(a.spacing, 2);
  assert.equal(a.ends.water, a.columns);
  assert.equal(a.landing.y, wtr.lakes[0]!.heightFt);
  assert.equal(a.landing.drop, 324 - 258.5);
  // Its columns converge: the merged ones end at their junctions and the foam strip runs over the live ones.
  assert.ok(a.mergedColumns > 0);
  assert.equal(a.foamVertexCount, 3 * (a.columns - a.mergedColumns));
  assert.deepEqual([a.streams.length, a.streams[0]!.water, a.streams[0]!.columns], [1, true, a.columns - a.mergedColumns]);
  assert.ok(fallMist(a, wfl.falls[0]!) !== null);
  // Fall 2: a spring at 375.5 ft over dry ground (the track has no .LVL water).
  assert.equal(b.source, 0);
  assert.equal(b.columns, 25);
  assert.equal(b.ends.water, 0);
  assert.ok(fallMist(b, wfl.falls[1]!) !== null, "hotfix 3: a dry fall has mist");
  assert.equal(b.streams[0]!.water, false);
  for (const f of m.falls) {
    assert.ok(f.vertexCount > 0 && f.vertexCount <= FALL_MAX_FALL_VERTICES);
    assert.ok(f.rowsMin >= 2 && f.rowsMax < 4002);
    assert.deepEqual(fallSound(f, wfl.falls[f.index]!), { silent: "no-stem" }, "SOUND without a stem is silent");
  }
  assert.equal(m.vertices.length / 16, a.vertexCount + b.vertexCount);
  assert.equal(m.indices.length, a.indexCount + b.indexCount);
  for (const i of m.indices) assert.ok(i < m.vertices.length / 16);
});
