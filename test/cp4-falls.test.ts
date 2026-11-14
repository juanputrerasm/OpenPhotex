/*
  Community Patch 4 beta 0.53's waterfall build (sim/cp4/falls.ts, OpenMTM2 docs/CP4_EXE_ANALYSIS.md 12). The
  synthetic cases give the walk ground and water callbacks of known shape, so counts, layouts and box numbers follow
  from the spec by hand; then, when present, Fila's 0.53 sandbox (CP4_SANDBOX_053, default
  ~/games/cp4sandbox053/fog_test.pod), which skips on a machine without it.
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
  type WflFall, type FallMeshes,
} from "../src/index.ts";

/** A record as parseWfl gives it, crest points in feet. */
function rec(o: { id?: number; pts: Array<[number, number]>; height: number; speed?: number; source?: number; flags?: number;
  opacity?: number; mist?: number; volume?: number; mistDepth?: number; mistHeight?: number; sound?: string; texture?: string }): WflFall {
  const speed = o.speed ?? 96, flags = o.flags ?? 2;
  return {
    id: o.id ?? 1, source: o.source ?? 0, flags, freeze: (flags & 1) !== 0, splash: (flags & 2) !== 0, sound: (flags & 4) !== 0,
    speed, speedFtPerSec: speed / 16, height: o.height, heightFt: o.height / 2,
    points: o.pts.map(([x, z]) => ({ x: Math.round(x * 16), z: Math.round(z * 16) })),
    opacity: o.opacity ?? 100, mist: o.mist ?? 100, volume: o.volume ?? 100, mistDepth: o.mistDepth ?? 100, mistHeight: o.mistHeight ?? 100,
    soundName: o.sound ?? "", textureName: o.texture ?? "",
  };
}

const vtx = (m: FallMeshes, i: number) => Array.from(m.vertices.subarray(i * FALL_VERTEX_FLOATS, (i + 1) * FALL_VERTEX_FLOATS));
const near = (a: number, b: number, eps = 1e-3, what = "") => assert.ok(Math.abs(a - b) <= eps, `${what} ${a} != ${b}`);

/** Columns of written vertices, read back from the buffer (sheet vertices are kind 0 grouped by u). */
function columnsOf(m: FallMeshes, f: FallMeshes["falls"][number]) {
  const cols: number[][] = [];
  let lastU = Number.NaN;
  for (let i = f.firstVertex; i < f.firstVertex + f.sheetVertexCount; i++) {
    const u = m.vertices[i * FALL_VERTEX_FLOATS + V.u]!;
    if (u !== lastU) { cols.push([]); lastU = u; }
    cols[cols.length - 1]!.push(i);
  }
  return cols;
}

// ---- 1. A flat shelf dropping into water ----

const shelfGround = (_x: number, z: number) => (z >= 1000 ? 100 : 20);
const shelfWater = () => 50;
const shelf = rec({ pts: [[1000, 1000], [1040, 1000]], height: 200, speed: 96, flags: 7, sound: "ROAR", mistHeight: 100 });

test("a shelf into water: 21 columns at 2 ft, every column ends in water with its sink, foam strip, global indices", () => {
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

  const dbg = fallDebugColumns(shelf, 2, { ground: shelfGround, water: shelfWater })!;
  const cols = columnsOf(m, f);
  assert.equal(cols.length, 21);
  cols.forEach((c, i) => assert.equal(c.length, dbg[i]!.rows.length + 1, `column ${i}: rows + the sink`));
  assert.equal(f.sheetVertexCount, dbg.reduce((n, c) => n + c.rows.length + 1, 0));
  assert.equal(f.foamVertexCount, 3 * 21);
  assert.equal(f.vertexCount, f.sheetVertexCount + f.foamVertexCount);
  assert.equal(m.vertices.length, f.vertexCount * 16);
  let tris = 0;
  for (let i = 0; i + 1 < cols.length; i++) tris += cols[i]!.length + cols[i + 1]!.length - 2;
  tris += 4 * 20;
  assert.equal(f.indexCount, 3 * tris);
  assert.equal(m.indices.length, f.indexCount);
  for (const i of m.indices) assert.ok(i >= f.firstVertex && i < f.firstVertex + f.vertexCount);

  // Row 0 of column 3: on the crest, at the anchor's height.
  const r0 = vtx(m, cols[3]![0]!);
  assert.deepEqual(r0, [6 * 256, 0, 0, 6, 0, 6, 1, 1, 1, 0, 0, 0, r0[V.normalX]!, r0[V.normalY]!, r0[V.normalZ]!, 0]);
  assert.equal(vtx(m, cols[0]![0]!)[V.edge], 0);
  near(vtx(m, cols[1]![0]!)[V.edge]!, 1 / 3);

  // The water row and the sink.
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
  near(sk[V.speed]!, Math.exp(-Math.hypot(ox, 4, oz) / 8) * wr[V.speed]!, 1e-3);
  assert.deepEqual(sk.slice(V.normalX, V.normalZ + 1), wr.slice(V.normalX, V.normalZ + 1), "the sink takes the water row's normal");
  for (const i of c0.slice(0, -1)) assert.equal(vtx(m, i)[V.end], 1);

  // Normals: unit, facing (fx, 1, fz) = (0, 1, -1).
  for (const c of cols) for (const i of c) {
    const v = vtx(m, i);
    near(Math.hypot(v[V.normalX]!, v[V.normalY]!, v[V.normalZ]!), 1, 1e-5);
    assert.ok(v[V.normalY]! - v[V.normalZ]! >= 0);
  }

  // Foam: three vertices a column at the surface + 0.1 ft, 40 ft wide (clamp(1.5 * 50, 4, 40)).
  const fo = f.firstVertex + f.sheetVertexCount;
  const [a, b, c] = [vtx(m, fo), vtx(m, fo + 1), vtx(m, fo + 2)];
  for (const v of [a, b, c]) {
    assert.equal(v[V.kind], 1);
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

  // Bounds include the foam's 20 ft overhang on both ends.
  near(f.bounds.min[0], -20 * 256, 0.01);
  near(f.bounds.max[0], 60 * 256, 0.01);
  assert.equal(f.bounds.max[1], 0);
  assert.equal(f.bounds.min[1], (46 - 100) * 256);

  // Landing: across the 40 ft of columns + the 2 ft spacing.
  const L = f.landing;
  assert.deepEqual([L.y, L.drop, L.dirX, L.dirZ], [50, 50, 0, -1]);
  near(L.width, 42, 1e-9);
  near(L.x, 1020, 1e-9);
  assert.equal(f.rowsMin, f.rowsMax);
});

test("the shelf's mist box and sound", () => {
  const m = buildFallMeshes([shelf], { ground: shelfGround, water: shelfWater });
  const f = m.falls[0]!;
  const mist = fallMist(f, shelf)!;
  // density = 1 * clamp(6 * 40 * 50 / 7200, 0.25, 2) * 1
  near(mist.density, 12000 / 7200, 1e-12);
  assert.equal(mist.lengthFt, 30);
  near(mist.widthFt, 72, 1e-9);
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
  // The 0.6 * drop and 20 ft floors; mist depth / height %, and H at most 240.
  const tall = { ...f, landing: { ...f.landing, drop: 500 } };
  const t = fallMist(tall, { ...shelf, mistDepth: 50, mistHeight: 250 })!;
  assert.equal(t.lengthFt, 150);
  assert.equal(t.heightFt, 240);
  assert.equal(t.density, 2, "clamped at 2");

  // Volume (volume% / 100) * clamp(speed * L / 240, 0.3, 1); hearing 1 + clamp((speed * L - 240) / 960, 0, 1).
  const s = fallSound(f, shelf);
  assert.ok(s.silent === null);
  assert.equal(s.volume, 1);
  assert.equal(s.hearing, 1);
  assert.equal(s.file, "sound\\ROAR.WAV");
  assert.deepEqual(s.position, [f.landing.x, 50, f.landing.z]);
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
  // No kept water: the landing is the lowest last row, no width, and no mist.
  assert.equal(f.landing.width, 0);
  near(f.landing.y, 60.3, 1e-9);
  near(f.landing.drop, 39.7, 1e-9);
  assert.deepEqual([f.landing.dirX, f.landing.dirZ], [0, -1]);
  assert.equal(fallMist(f, spring), null);
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

test("budget: a coarser spacing when 2 ft is over 16384 vertices; the track fills, then DROPPED, and the loop goes on", () => {
  const at2 = fallDebugColumns(wide(1), 2, { ground: cliff, water: pool })!;
  const need2 = at2.reduce((n, c) => n + c.rows.length + 1, 0) + 3 * at2.length;
  assert.ok(need2 > FALL_MAX_FALL_VERTICES, `2 ft needs ${need2}`);
  const falls = Array.from({ length: 40 }, (_, i) => wide(i + 1));
  falls.push(rec({ id: 41, pts: [[100, 4000], [104, 4000]], height: 350 }));
  const m = buildFallMeshes(falls, { ground: cliff, water: pool });
  const first = m.falls[0]!;
  assert.equal(first.spacing, 3);
  assert.equal(first.shortened, false);
  assert.ok(first.vertexCount <= FALL_MAX_FALL_VERTICES);
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

test("budget: SHORTENED at 8 ft by bisection, R the most rows that fit", () => {
  // A 2048 ft free fall: 126 columns of about 256 rows at 8 ft.
  const m = buildFallMeshes([rec({ pts: [[500, 4000], [1500, 4000]], height: 4096 })], { ground: () => 0, water: () => 1 });
  const f = m.falls[0]!;
  assert.equal(f.spacing, 8);
  assert.equal(f.columns, 126);
  assert.equal(f.shortened, true);
  assert.equal(f.rowLimit, Math.floor(FALL_MAX_FALL_VERTICES / 126));
  assert.equal(f.vertexCount, 126 * 130);
  assert.deepEqual([f.rowsMin, f.rowsMax], [130, 130]);
  assert.equal(f.ends.water, 126, "the walk still ended in water");
  assert.equal(f.foamVertexCount, 0, "no water column is kept");
  assert.equal(f.indexCount, 3 * 125 * (2 * 130 - 2));
  assert.equal(f.landing.width, 0);
  assert.ok(fallMist(f, rec({ pts: [[0, 0], [2, 0]], height: 1 })) !== null, "mist needs only a water end");
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
  assert.deepEqual(r.mists.map((x) => x.slot), [0, 1]);
  assert.deepEqual(r.noSlot, [2]);
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
  assert.equal(a.foamVertexCount, 3 * a.columns);
  assert.ok(fallMist(a, wfl.falls[0]!) !== null);
  // Fall 2: a spring at 375.5 ft over dry ground (the track has no .LVL water).
  assert.equal(b.source, 0);
  assert.equal(b.columns, 25);
  assert.equal(b.ends.water, 0);
  assert.equal(fallMist(b, wfl.falls[1]!), null);
  for (const f of m.falls) {
    assert.ok(f.vertexCount > 0 && f.vertexCount <= FALL_MAX_FALL_VERTICES);
    assert.ok(f.rowsMin >= 2 && f.rowsMax < 4002);
    assert.deepEqual(fallSound(f, wfl.falls[f.index]!), { silent: "no-stem" }, "SOUND without a stem is silent");
  }
  assert.equal(m.vertices.length / 16, a.vertexCount + b.vertexCount);
  assert.equal(m.indices.length, a.indexCount + b.indexCount);
  for (const i of m.indices) assert.ok(i < m.vertices.length / 16);
});
