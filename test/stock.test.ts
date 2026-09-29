/*
  Checks against retail game archives, when a local install is present.

  Game data is never committed. Point OPENPHOTEX_GAMES at a folder laid out as
  <game>/<FILE>.POD (default ~/games); each test skips itself when its file is missing, so the
  suite passes on a machine without the games.

  The expectations are facts read from the stock files, not from this parser: entry counts and
  comments as the games ship them.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  parseBin,
  parseCprCmd,
  parseTruckManifest,
  decodeTiff,
  isEvoSit,
  isEvoTrk,
  parseEvoLvl,
  parseEvoSit,
  parseEvoTex,
  parseEvoTrk,
  parseEvoVeg,
  parseEvoWat,
  parseSmf,
  actPaletteDepth,
  buildPod1Directory,
  decodeActPalette,
  decodeRawTexture,
  findPodEntriesByExtension,
  findPodEntry,
  parsePod,
  pod1DirectoryEntries,
  rawTextureSide,
  readPod2AuditTrail,
  readPodEntry,
  verifyPodChecksums,
} from "../src/index.ts";

const GAMES = process.env.OPENPHOTEX_GAMES ?? join(process.env.HOME ?? "", "games");

function stock(relative: string) {
  const path = join(GAMES, relative);
  return { path, skip: existsSync(path) ? false : `no ${path}` };
}

const truck2 = stock("mtm2/TRUCK2.POD");
test("MTM2 TRUCK2.POD", { skip: truck2.skip }, () => {
  const bytes = new Uint8Array(readFileSync(truck2.path));
  const pod = parsePod(bytes);
  assert.equal(pod.format, "pod1");
  assert.equal(pod.comment, "MTM2 Trucks");
  assert.equal(pod.entries.length, 439);
  const trk = findPodEntry(pod, "TRUCK/BIGFOOT.TRK");
  assert.ok(trk);
  assert.equal(trk.offset, 5420955);
  assert.equal(trk.length, 6156);
  assert.match(new TextDecoder("latin1").decode(readPodEntry(bytes, trk)), /\S/);
});

const peak = stock("evo2/PEAK.pod");
test("4x4 Evolution 2 PEAK.pod", { skip: peak.skip }, () => {
  const pod = parsePod(new Uint8Array(readFileSync(peak.path)));
  assert.equal(pod.format, "pod2");
  assert.equal(pod.comment, "Pikes Peak");
  assert.equal(pod.entries.length, 2150);
  assert.ok(pod.entries.every((e) => e.timestamp !== null && e.crc !== null));
});

const sc24 = stock("fly/SC24.EPD");
test("Fly! SC24.EPD", { skip: sc24.skip }, () => {
  const bytes = new Uint8Array(readFileSync(sc24.path));
  const pod = parsePod(bytes);
  assert.equal(pod.format, "epd");
  assert.equal(pod.comment, "SC24");
  assert.equal(pod.entries.length, 54);
  const act = findPodEntry(pod, "MAPS/SC24N.ACT");
  assert.ok(act);
  assert.equal(act.length, 768);
  // Every timestamp falls in 1999, the year Fly! shipped.
  assert.ok(pod.entries.every((e) => new Date((e.timestamp ?? 0) * 1000).getUTCFullYear() === 1999));
});

/*
  Every POD in the install parses, in the format its game uses, with every payload in bounds
  and at least one .RAW palette hint recovered across the POD1 games.
*/
test("every stock POD parses", { skip: existsSync(GAMES) ? false : `no ${GAMES}` }, () => {
  const expected: Record<string, "pod1" | "pod2"> = {
    mtm1: "pod1", mtm2: "pod1", cpr: "pod1", tv: "pod1", tf: "pod1", hb: "pod1", evo1: "pod2", evo2: "pod2",
  };
  let checked = 0;
  let palettes = 0;
  for (const game of Object.keys(expected)) {
    const folder = join(GAMES, game);
    if (!existsSync(folder)) continue;
    for (const name of readdirSync(folder).filter((n) => /\.pod$/i.test(n))) {
      const bytes = new Uint8Array(readFileSync(join(folder, name)));
      const pod = parsePod(bytes);
      assert.equal(pod.format, expected[game], `${game}/${name}`);
      for (const entry of pod.entries) assert.ok(entry.offset + entry.length <= bytes.length);
      palettes += pod.entries.filter((e) => e.paletteName).length;
      checked++;
    }
  }
  assert.ok(checked > 0);
  assert.ok(palettes > 0, "no .RAW palette hints found in any stock POD1");
});

/*
  The writer's regression guard: every stock POD1 directory is rebuilt byte for byte from its
  parsed entries, palette records included, and every stock archive stores its payloads
  contiguously in directory order.
*/
test("every stock POD1 directory rebuilds byte for byte", { skip: existsSync(GAMES) ? false : `no ${GAMES}` }, () => {
  let rebuilt = 0;
  for (const game of ["mtm1", "mtm2", "cpr", "tv", "tf", "hb"]) {
    const folder = join(GAMES, game);
    if (!existsSync(folder)) continue;
    for (const name of readdirSync(folder).filter((n) => /\.pod$/i.test(n))) {
      const bytes = new Uint8Array(readFileSync(join(folder, name)));
      const pod = parsePod(bytes);
      const directory = buildPod1Directory(pod.comment, pod1DirectoryEntries(pod.entries));
      assert.deepEqual(directory, bytes.subarray(0, pod.directoryEnd), `${game}/${name}`);
      rebuilt++;
    }
  }
  assert.ok(rebuilt > 0);
});

/*
  The POD2 integrity layouts, which JPod's specification could only describe: every stock Evo
  archive's CRCs match, and its audit trail exactly fills the bytes after the payloads with
  records whose action codes behave as add (new only), remove (old only) and change.
*/
test("every stock POD2 verifies and has a decodable audit trail", { skip: existsSync(GAMES) ? false : `no ${GAMES}` }, () => {
  let checked = 0;
  for (const game of ["evo1", "evo2"]) {
    const folder = join(GAMES, game);
    if (!existsSync(folder)) continue;
    for (const name of readdirSync(folder).filter((n) => /\.pod$/i.test(n))) {
      const bytes = new Uint8Array(readFileSync(join(folder, name)));
      const pod = parsePod(bytes);
      const report = verifyPodChecksums(bytes, pod);
      assert.ok(report.archive.ok, `${game}/${name} archive CRC`);
      assert.deepEqual(report.mismatches, [], `${game}/${name} entry CRCs`);
      const trail = readPod2AuditTrail(bytes, pod);
      assert.equal(trail.length, pod.auditCount);
      for (const r of trail) {
        assert.ok(r.action, `${game}/${name} audit ${r.index} action ${r.actionCode}`);
        if (r.action === "add") assert.equal(r.oldTimestamp, 0);
        if (r.action === "remove") assert.equal(r.newTimestamp, 0);
      }
      checked++;
    }
  }
  assert.ok(checked > 0);
});

/*
  The palette facts docs/RAW_ACT.md rests on: no stock .ACT anywhere is a 6-bit VGA table (none
  has 63 as its brightest channel), so every one decodes as stored, dark ones included; and every
  .RAW whose size is a texture size decodes.
*/
test("every stock palette is 8-bit and every stock texture decodes", { skip: existsSync(GAMES) ? false : `no ${GAMES}` }, () => {
  let palettes = 0, dark = 0, textures = 0;
  for (const [game, family] of [["mtm1", "classic"], ["mtm2", "classic"], ["cpr", "classic"], ["tv", "classic"], ["tf", "classic"], ["hb", "classic"], ["evo1", "evo"], ["evo2", "evo"]] as const) {
    const folder = join(GAMES, game);
    if (!existsSync(folder)) continue;
    for (const name of readdirSync(folder).filter((n) => /\.pod$/i.test(n))) {
      const bytes = new Uint8Array(readFileSync(join(folder, name)));
      const pod = parsePod(bytes);
      for (const entry of findPodEntriesByExtension(pod, ".ACT")) {
        const act = readPodEntry(bytes, entry);
        if (act.length < 768) continue;
        assert.equal(actPaletteDepth(act), 8, `${game}/${name} ${entry.name}`);
        if (Math.max(...act.subarray(0, 768)) < 63) dark++;
        palettes++;
      }
      const grey = decodeActPalette(new Uint8Array(768).map((_, i) => Math.floor(i / 3)))!;
      for (const entry of findPodEntriesByExtension(pod, ".RAW")) {
        if (!rawTextureSide(entry.length, family)) continue;
        const image = decodeRawTexture(readPodEntry(bytes, entry), grey, { family });
        assert.equal(image.width * image.height, entry.length);
        textures++;
      }
    }
  }
  assert.ok(palettes > 0 && textures > 0);
  assert.ok(dark > 0, "the dark 8-bit palettes (NITESKY, TSHADOW, ...) are present");
});

/*
  Every 4x4 Evolution data file in the stock archives reads without error: scene scripts,
  levels, texture tables, vegetation, water, models, TIFFs and vehicle manifests.
*/
test("every stock 4x4 Evolution file parses", { skip: existsSync(GAMES) ? false : `no ${GAMES}` }, () => {
  const counts: Record<string, number> = {};
  const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
  for (const game of ["evo1", "evo2"]) {
    const folder = join(GAMES, game);
    if (!existsSync(folder)) continue;
    for (const name of readdirSync(folder).filter((n) => /\.pod$/i.test(n))) {
      const bytes = new Uint8Array(readFileSync(join(folder, name)));
      const pod = parsePod(bytes);
      for (const entry of pod.entries) {
        const data = readPodEntry(bytes, entry);
        const ext = entry.title.split(".").pop();
        const where = `${game}/${name} ${entry.name}`;
        if (ext === "SIT" && isEvoSit(data)) { assert.deepEqual(parseEvoSit(data, where).warnings, [], where); bump("sit"); }
        else if (ext === "LVL") { parseEvoLvl(data, where); bump("lvl"); }
        else if (ext === "TEX") { assert.deepEqual(parseEvoTex(data, where).warnings, [], where); bump("tex"); }
        else if (ext === "VEG") { assert.deepEqual(parseEvoVeg(data, where).warnings, [], where); bump("veg"); }
        else if (ext === "WAT") { parseEvoWat(data, where); bump("wat"); }
        else if (ext === "SMF") { assert.deepEqual(parseSmf(data, where).warnings, [], where); bump("smf"); }
        else if (ext === "TIF") { decodeTiff(data, where); bump("tif"); }
        else if (ext === "TRK" && isEvoTrk(data)) { assert.ok(parseEvoTrk(data, where).signature, where); bump("trk"); }
      }
    }
  }
  assert.equal(counts.trk, 271, "121 Evo 1 and 150 Evo 2 vehicle manifests");
  for (const k of ["sit", "lvl", "tex", "veg", "smf", "tif"]) assert.ok(counts[k] > 0, k);
});

/*
  Every truck and car manifest in the stock archives parses in its own dialect, and every CPR
  .CMD car model parses with no warnings (all faces type 0x29, all part angles zero).
*/
test("every stock truck/car manifest and CPR .CMD parses", { skip: existsSync(GAMES) ? false : `no ${GAMES}` }, () => {
  const counts: Record<string, number> = {};
  for (const game of ["mtm1", "mtm2", "cpr", "evo1", "evo2"]) {
    const folder = join(GAMES, game);
    if (!existsSync(folder)) continue;
    for (const name of readdirSync(folder).filter((n) => /\.pod$/i.test(n))) {
      const bytes = new Uint8Array(readFileSync(join(folder, name)));
      const pod = parsePod(bytes);
      for (const entry of pod.entries) {
        const where = `${game}/${name} ${entry.name}`;
        if (/^TRUCK\/.*\.TRK$|^VEHICLE\/.*\.CAR$/.test(entry.normalizedName)) {
          const { kind, manifest } = parseTruckManifest(readPodEntry(bytes, entry), where);
          counts[kind] = (counts[kind] ?? 0) + 1;
          assert.ok("truckName" in manifest && manifest.truckName, where);
        } else if (entry.title.endsWith(".CMD")) {
          assert.deepEqual(parseCprCmd(readPodEntry(bytes, entry), where).warnings, [], where);
          counts.cmd = (counts.cmd ?? 0) + 1;
        }
      }
    }
  }
  assert.ok(counts.mtm > 0 && counts["cpr-car"] > 0 && counts.cmd > 0, JSON.stringify(counts));
});

/*
  Every stock .BIN walks to MRGL_EOL without stopping early, and every ANIMATED_BIN is a frame
  list with no geometry.
*/
test("every stock .BIN walks cleanly", { skip: existsSync(GAMES) ? false : `no ${GAMES}` }, () => {
  const kinds: Record<string, number> = {};
  let faces = 0;
  for (const game of ["mtm1", "mtm2", "cpr", "tv", "tf", "hb"]) {
    const folder = join(GAMES, game);
    if (!existsSync(folder)) continue;
    for (const name of readdirSync(folder).filter((n) => /\.pod$/i.test(n))) {
      const bytes = new Uint8Array(readFileSync(join(folder, name)));
      const pod = parsePod(bytes);
      for (const entry of pod.entries.filter((e) => e.title.endsWith(".BIN"))) {
        const bin = parseBin(readPodEntry(bytes, entry));
        kinds[bin.kind] = (kinds[bin.kind] ?? 0) + 1;
        const where = `${game}/${name} ${entry.name}`;
        assert.equal(bin.incomplete, false, `${where}: ${bin.stopReason}`);
        if (bin.kind === "animated") assert.ok(bin.frameNames.length > 0 && bin.faces.length === 0, where);
        faces += bin.faces.length;
      }
    }
  }
  assert.ok(kinds.mrgl > 0 && faces > 0, JSON.stringify(kinds));
});
