/*
  Community Patch 4 beta 0.53 / Traxx 1.7.1 waterfalls (WORLD\<stem>.WFL). The synthetic files are
  laid out by hand here, independently of writeWfl; then, when present, Fila's 0.53 sandbox
  (CP4_SANDBOX_053, default ~/games/cp4sandbox053/fog_test.pod), which skips on a machine without it.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseWfl, writeWfl, isWfl, wflPointsFt, readTxvInfo, parsePod, findPodEntry, readPodEntry, WFL_FLAG_SPLASH } from "../src/index.ts";

interface Rec {
  source: number; npoints: number; flags: number; speed: number; height: number;
  pts: Array<[number, number]>; opacity: number; mist: number; volume: number;
  sound?: string; texture?: string; mistDepth?: number; mistHeight?: number;
}

/** An MWFL file laid out byte by byte from the Traxx 1.7.1 layout. */
function handWfl(recs: Rec[], opts: { stride?: number; minor?: number; major?: number; tiles?: number; version?: number; extraDir?: boolean } = {}): Uint8Array {
  const { stride = 128, major = 1, tiles = 256, version = 1, extraDir = false } = opts;
  const minor = opts.minor ?? (stride === 132 ? 1 : 0);
  const dirCount = extraDir ? 2 : 1;
  const chunkOff = 32 + 16 * dirCount;
  const chunkSize = 8 + recs.length * stride;
  const b = new Uint8Array(chunkOff + chunkSize);
  const w16 = (o: number, v: number) => { b[o] = v & 255; b[o + 1] = (v >> 8) & 255; };
  const w32 = (o: number, v: number) => { w16(o, v & 0xffff); w16(o + 2, (v >>> 16) & 0xffff); };
  b.set([77, 87, 70, 76]);
  w16(4, major); w16(6, minor); w32(8, 32); w32(12, dirCount); w16(16, tiles); w16(18, tiles);
  let d = 32;
  if (extraDir) { b.set([88, 89, 90, 87], d); w32(d + 4, 1); w32(d + 8, 0); w32(d + 12, 4); d += 16; }
  b.set([70, 65, 76, 76], d); w32(d + 4, version); w32(d + 8, chunkOff); w32(d + 12, chunkSize);
  w32(chunkOff, recs.length); w16(chunkOff + 4, stride);
  recs.forEach((r, i) => {
    const p = chunkOff + 8 + i * stride;
    b[p] = i + 1; b[p + 1] = r.source; b[p + 2] = r.npoints;
    w16(p + 4, r.flags); w16(p + 6, r.speed); w32(p + 8, r.height);
    r.pts.forEach(([x, z], k) => { w32(p + 12 + 8 * k, x); w32(p + 16 + 8 * k, z); });
    b[p + 76] = r.opacity; b[p + 77] = r.mist; b[p + 78] = r.volume;
    [...(r.sound ?? "")].forEach((c, k) => { b[p + 80 + k] = c.charCodeAt(0); });
    [...(r.texture ?? "")].forEach((c, k) => { b[p + 96 + k] = c.charCodeAt(0); });
    if (stride >= 132) { b[p + 128] = r.mistDepth ?? 0; b[p + 129] = r.mistHeight ?? 0; }
  });
  return b;
}

const spring: Rec = { source: 0, npoints: 2, flags: 7, speed: 96, height: 41, pts: [[16 * 100, 16 * 200], [16 * 130, 16 * 200]], opacity: 85, mist: 100, volume: 100, sound: "ROAR", texture: "FALLTEX" };
const fed: Rec = { source: 2, npoints: 3, flags: WFL_FLAG_SPLASH, speed: 400, height: 517, pts: [[131071, 0], [8, 16], [40, 48]], opacity: 50, mist: 0, volume: 200 };

test("WFL v1.0: header, records, flags, units and stems", () => {
  const bytes = handWfl([spring, fed]);
  assert.ok(isWfl(bytes));
  const w = parseWfl(bytes);
  assert.deepEqual([w.major, w.minor, w.stride, w.falls.length], [1, 0, 128, 2]);
  const a = w.falls[0]!, b = w.falls[1]!;
  assert.deepEqual([a.id, a.source, a.flags, a.freeze, a.splash, a.sound], [1, 0, 7, true, true, true]);
  assert.equal(a.speedFtPerSec, 6);
  assert.equal(a.heightFt, 20.5);
  assert.deepEqual(wflPointsFt(a), [[100, 200], [130, 200]]);
  assert.deepEqual([a.opacity, a.mist, a.volume, a.mistDepth, a.mistHeight], [85, 100, 100, 100, 100]);
  assert.deepEqual([a.soundName, a.textureName], ["ROAR", "FALLTEX"]);
  assert.deepEqual([b.source, b.freeze, b.splash, b.sound, b.points.length], [2, false, true, false, 3]);
  assert.deepEqual(b.points[0], { x: 131071, z: 0 });
  assert.deepEqual([b.soundName, b.textureName], ["", ""]);
});

test("WFL v1.1: mist depth and height, 0 is 100 and the cap is 250", () => {
  const w = parseWfl(handWfl([{ ...spring, mistDepth: 0, mistHeight: 255 }, { ...fed, mistDepth: 40, mistHeight: 250 }], { stride: 132 }));
  assert.deepEqual([w.minor, w.stride], [1, 132]);
  assert.deepEqual([w.falls[0]!.mistDepth, w.falls[0]!.mistHeight], [100, 250]);
  assert.deepEqual([w.falls[1]!.mistDepth, w.falls[1]!.mistHeight], [40, 250]);
});

test("WFL: a stem is at most 15 characters, the 16th byte is never read", () => {
  const bytes = handWfl([{ ...spring, sound: "ABCDEFGHIJKLMNOP" }]);
  assert.equal(parseWfl(bytes).falls[0]!.soundName, "ABCDEFGHIJKLMNO");
});

test("WFL: Traxx's refusals", () => {
  assert.throws(() => parseWfl(new Uint8Array(40)), /not an MWFL/);
  assert.throws(() => parseWfl(handWfl([spring], { major: 0 })), /major/);
  assert.throws(() => parseWfl(handWfl([spring], { major: 3 })), /newer/);
  assert.throws(() => parseWfl(handWfl([spring], { tiles: 512 })), /terrain size/);
  assert.throws(() => parseWfl(handWfl([spring], { version: 2 })), /FALL/, "the first FALL entry is claimed even with a wrong version");
  assert.throws(() => parseWfl(handWfl([{ ...spring, npoints: 1 }])), /points/);
  assert.throws(() => parseWfl(handWfl([{ ...spring, npoints: 9 }])), /points/);
  const short = handWfl([spring]);
  short[48 + 4] = 120; // stride 120
  assert.throws(() => parseWfl(short), /FALL chunk/);
  const many = handWfl([spring]);
  many[48] = 65; // 65 falls
  assert.throws(() => parseWfl(many), /FALL chunk/);
  assert.equal(parseWfl(handWfl([spring], { extraDir: true })).falls.length, 1, "an unknown directory id is skipped");
});

test("writeWfl lays the file out as Traxx does: v1.0 unless a mist size is custom", () => {
  const asWrite = (r: Rec) => ({
    source: r.source, flags: r.flags, speed: r.speed, height: r.height, points: r.pts.map(([x, z]) => ({ x, z })),
    opacity: r.opacity, mist: r.mist, volume: r.volume, soundName: r.sound, textureName: r.texture, mistDepth: r.mistDepth, mistHeight: r.mistHeight,
  });
  assert.deepEqual(writeWfl([asWrite(spring), asWrite(fed)]), handWfl([spring, fed]));
  assert.deepEqual(writeWfl([asWrite({ ...spring, mistDepth: 100, mistHeight: 0 })]), handWfl([spring]), "100 and 0 are the default");
  assert.deepEqual(writeWfl([asWrite(spring), asWrite({ ...fed, mistHeight: 60 })]),
    handWfl([{ ...spring, mistDepth: 100, mistHeight: 100 }, { ...fed, mistDepth: 100, mistHeight: 60 }], { stride: 132 }));
  assert.throws(() => writeWfl([]), /1 to 64/);
  assert.throws(() => writeWfl([asWrite({ ...spring, sound: "ABCDEFGHIJKLMNOP" })]), /15 characters/);
});

const sandbox = process.env.CP4_SANDBOX_053 ?? join(homedir(), "games/cp4sandbox053/fog_test.pod");
test("Fila's beta 0.53 sandbox: two falls, rewritten byte for byte; the .TXV counts them", { skip: !existsSync(sandbox) }, () => {
  const bytes = new Uint8Array(readFileSync(sandbox));
  const pod = parsePod(bytes);
  const read = (p: string) => { const e = findPodEntry(pod, p); assert.ok(e, p); return readPodEntry(bytes, e); };
  const raw = read("WORLD\\FOGTEST.WFL");
  const w = parseWfl(raw);
  assert.equal(w.falls.length, 2);
  assert.equal(readTxvInfo(read("DATA\\FOGTEST.TXV")).waterfalls, 2);
  const again = writeWfl(w.falls.map((f) => ({ ...f, soundName: f.soundName, textureName: f.textureName })));
  assert.deepEqual(again, raw);
});
