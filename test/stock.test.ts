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
  parseFlyScf,
  parseFlyBsp,
  parseFlySceneryObjects,
  parseFlyQuadrant,
  parseFlyTextureName,
  parseFlyFolderName,
  flyTileAt,
  FLY_ALT_SIDE,
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
  cprTrackIsClosed,
  findPodEntryByTitle,
  findStartPoint,
  parseCprTrk,
  parseCprTtx,
  parseDef,
  parseHbNavPoints,
  parseMtmSit,
  parseNavPoints,
  parseTvLvl,
  podPathTitle,
  CPR_SURFACE_TYPES,
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

const sc24 = stock("fly/Maps/SC24.EPD");
test("Fly! SC24.EPD", { skip: sc24.skip }, () => {
  const bytes = new Uint8Array(readFileSync(sc24.path));
  const pod = parsePod(bytes);
  assert.equal(pod.format, "epd");
  assert.equal(pod.comment, "SC24");
  // 272, not the 54 the stale word at 0x90 claims: 268 chart tiles plus a north and a south
  // .ACT and .MAP.
  assert.equal(pod.entries.length, 272);
  assert.equal(pod.entries.filter((e) => e.title.endsWith(".RAW")).length, 268);
  const act = findPodEntry(pod, "MAPS/SC24N.ACT");
  assert.ok(act);
  assert.equal(act.length, 768);
  // Every timestamp falls in 1999, the year Fly! shipped.
  assert.ok(pod.entries.every((e) => new Date((e.timestamp ?? 0) * 1000).getUTCFullYear() === 1999));
});

/*
  Every Fly! archive, charts and scenery: the title is the file's stem, and the directory ends
  exactly where the first payload begins. Some scenery archives follow each payload with one NUL,
  so payloads need not be contiguous.
*/
const flyFolder = stock("fly");
test("every stock Fly! EPD parses", { skip: flyFolder.skip }, () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (item.isDirectory()) walk(join(dir, item.name));
      else if (/\.EPD$/i.test(item.name)) files.push(join(dir, item.name));
    }
  };
  walk(flyFolder.path);
  for (const file of files) {
    const pod = parsePod(new Uint8Array(readFileSync(file)));
    assert.equal(pod.format, "epd", file);
    assert.equal(pod.comment, file.replace(/^.*[\\/]/, "").replace(/\.EPD$/i, "").toUpperCase(), file);
    const firstPayload = Math.min(...pod.entries.filter((e) => e.length > 0).map((e) => e.offset));
    assert.equal(pod.directoryEnd, firstPayload, file);
  }
  assert.ok(files.length > 0);
});

/*
  Every Fly! scenery set: its manifest names archives that exist, its object files parse, and
  every quadrant of every globe tile parses. Each textured cell's .REF texture names that very
  cell, and each kind 2 cell's sub-textures name its detail folder, which is what fixes the
  column-major cell order (docs/FLY.md).
*/
const flyScenery = stock("fly/Scenery");
test("every stock Fly! scenery set parses", { skip: flyScenery.skip }, () => {
  let quadrants = 0, named = 0, objects = 0;
  for (const set of readdirSync(flyScenery.path, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const dir = join(flyScenery.path, set.name);
    const files = readdirSync(dir);
    const scfName = files.find((f) => /\.SCF$/i.test(f));
    assert.ok(scfName, set.name);
    const scf = parseFlyScf(new Uint8Array(readFileSync(join(dir, scfName))), scfName);
    assert.equal(scf.files.length, 7, set.name);
    for (const file of scf.files) {
      const actual = files.find((f) => f.toLowerCase() === file.toLowerCase());
      assert.ok(actual, `${set.name}: ${file}`);
      const bytes = new Uint8Array(readFileSync(join(dir, actual)));
      const pod = parsePod(bytes);
      for (const entry of pod.entries) {
        if (/\.S\d\d$/.test(entry.title)) {
          const result = parseFlySceneryObjects(readPodEntry(bytes, entry), entry.name);
          assert.deepEqual(result.warnings, [], entry.name);
          assert.ok(result.objects.every((object) => object.snapToGround), `${entry.name}: object without snap-to-ground bit`);
          objects += result.objects.length;
        }
        if (!/^G[01][01]\.ALT$/.test(entry.title)) continue;
        const stem = entry.normalizedName.slice(0, -4);
        const get = (ext: string) => {
          const e = findPodEntry(pod, stem + ext);
          return e ? readPodEntry(bytes, e) : null;
        };
        const quadrant = parseFlyQuadrant({ alt: get(".ALT")!, typ: get(".TYP")!, tex: get(".TEX")!, ref: get(".REF")!, al2: get(".AL2") }, stem);
        quadrants++;
        const tile = parseFlyFolderName(stem.split("/")[1])!;
        const qx = Number(entry.title[1]) * 32, qy = Number(entry.title[2]) * 32;
        for (let cell = 0; cell < 1024; cell++) {
          const x = qx + Math.floor(cell / 32), y = qy + (cell % 32);
          const name = parseFlyTextureName(quadrant.textures[quadrant.cellTextures[cell]] ?? "");
          if (name) {
            assert.deepEqual(name, { folderFirst: tile.first, folderSecond: tile.second, x, y }, `${stem} cell ${cell}`);
            named++;
          }
          const subs = quadrant.cellSubTextures[cell];
          for (let i = 0; subs && i < 4; i++) {
            if (subs[i] < 0) continue;
            const sub = parseFlyTextureName(quadrant.textures[subs[i]]);
            // x0y0, x0y1, x1y0, x1y1
            assert.deepEqual(sub, { folderFirst: x, folderSecond: y, x: i >> 1, y: i & 1 }, `${stem} cell ${cell} sub ${i}`);
          }
        }
      }
    }
  }
  assert.ok(quadrants > 0 && named > 0);
  assert.equal(objects, 1580);
});

/*
  Every stock .BSP reads whole, and the Golden Gate Bridge measures as the real one does: its
  towers stand 746 ft above the water, and its suspended spans run about 6,450 ft.
*/
test("every stock Fly! .BSP reads, the Golden Gate Bridge to scale", { skip: flyScenery.skip }, () => {
  let files = 0;
  for (const set of readdirSync(flyScenery.path, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const file of readdirSync(join(flyScenery.path, set.name)).filter((f) => /MODELS\.EPD$/i.test(f))) {
      const bytes = new Uint8Array(readFileSync(join(flyScenery.path, set.name, file)));
      const pod = parsePod(bytes);
      for (const entry of pod.entries.filter((e) => e.title.endsWith(".BSP"))) {
        const { model, nodeCount } = parseFlyBsp(readPodEntry(bytes, entry), entry.name);
        assert.ok(model.faces.length > 0 && nodeCount > 0 && model.stopReason === null, entry.name);
        files++;
        if (entry.title !== "GOLD1.BSP") continue;
        let low = Infinity, high = -Infinity, south = Infinity, north = -Infinity;
        for (let i = 0; i < model.vertices.length; i += 3) {
          low = Math.min(low, model.vertices[i + 1]); high = Math.max(high, model.vertices[i + 1]);
          south = Math.min(south, model.vertices[i + 2]); north = Math.max(north, model.vertices[i + 2]);
        }
        // 256 raw units to the foot, height in the second word, the bridge's length in the third.
        assert.ok(Math.abs((high - low) / 256 - 750) < 10, `height ${(high - low) / 256}`);
        assert.ok((north - south) / 256 > 6400 && (north - south) / 256 < 7000, `length ${(north - south) / 256}`);
      }
    }
  }
  assert.equal(files, 22);
});

/*
  Summits, from the San Francisco heights read column-major. The grid points are about 2 km
  apart, so a sharp peak reads low; the check is that each lands on high ground, which the
  row-major reading does not (it puts Mount Tamalpais in the sea).
*/
test("Fly! San Francisco heights put the summits in place", { skip: stock("fly/Scenery/SANFRAN").skip }, () => {
  const dir = stock("fly/Scenery/SANFRAN").path;
  const archives = ["SANFRAN1.EPD", "SANFRAN2.EPD", "SANFRAN3.EPD", "SANFRAN4.EPD"].map((f) => {
    const bytes = new Uint8Array(readFileSync(join(dir, f)));
    return { bytes, pod: parsePod(bytes) };
  });
  const heightNear = (lat: number, lon: number): number => {
    const at = flyTileAt(lat, lon);
    const folder = `D${at.column}${at.row}`;
    const qx = at.x >= 32 ? 1 : 0, qy = at.y >= 32 ? 1 : 0;
    for (const { bytes, pod } of archives) {
      const entry = findPodEntry(pod, `DATA/${folder}/G${qx}${qy}.ALT`);
      if (!entry) continue;
      const alt = new DataView(readPodEntry(bytes, entry).slice().buffer);
      const x = Math.round(at.x - qx * 32), y = Math.round(at.y - qy * 32);
      let best = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const cx = Math.min(32, Math.max(0, x + dx)), cy = Math.min(32, Math.max(0, y + dy));
        best = Math.max(best, alt.getFloat32((cx * FLY_ALT_SIDE + cy) * 4, true));
      }
      return best;
    }
    throw new Error(`no heights for ${lat}, ${lon}`);
  };
  // [latitude, longitude, real height in feet]
  const summits: Record<string, [number, number, number]> = {
    "Mount Diablo": [37.8816, -121.9142, 3849],
    "Mount Tamalpais": [37.9235, -122.5965, 2571],
    "Mount Saint Helena": [38.6694, -122.6333, 4342],
    "Mount Hamilton": [37.3414, -121.6425, 4265],
  };
  for (const [name, [lat, lon, real]] of Object.entries(summits)) {
    const h = heightNear(lat, lon);
    assert.ok(h > real * 0.6 && h <= real * 1.02, `${name}: ${h} ft`);
  }
  assert.equal(heightNear(37.5, -123.0), 0); // the Pacific
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

/*
  The level formats. Every MTM1, MTM2 and CPR .SIT is recognized as its own game; every CPR
  .TRK is the 20 point, 19 section cross section CPREDIT.EXE names, a closed circuit, with a
  full header; every TV, Fury3 and Hellbender .LVL is a complete header whose .DEF parses
  (a tunnel level's may hold no placements).
*/
test("every stock level file parses", { skip: existsSync(GAMES) ? false : `no ${GAMES}` }, () => {
  const sitOrigin: Record<string, string> = { mtm1: "MTM1", mtm2: "MTM2", cpr: "CPR" };
  const counts = { sit: 0, trk: 0, ttx: 0, lvl: 0, def: 0, nav: 0 };
  for (const game of ["mtm1", "mtm2", "cpr", "tv", "tf", "hb"]) {
    const folder = join(GAMES, game);
    if (!existsSync(folder)) continue;
    for (const name of readdirSync(folder).filter((n) => /\.pod$/i.test(n))) {
      const bytes = new Uint8Array(readFileSync(join(folder, name)));
      const pod = parsePod(bytes);
      const read = (title: string | null) => {
        if (!title) return null;
        const entry = findPodEntry(pod, title) ?? findPodEntryByTitle(pod, podPathTitle(title));
        return entry ? readPodEntry(bytes, entry) : null;
      };
      for (const entry of pod.entries) {
        const where = `${game}/${name}:${entry.name}`;
        if (sitOrigin[game] && /\.SI[T2]$/.test(entry.title)) {
          assert.equal(parseMtmSit(readPodEntry(bytes, entry), entry.title).origin, sitOrigin[game], where);
          counts.sit++;
        }
        if (game === "cpr" && entry.title.endsWith(".TRK")) {
          const trk = parseCprTrk(readPodEntry(bytes, entry));
          assert.ok(trk && trk.background && (trk.length ?? 0) > 0, where);
          assert.equal(trk.surfaces.length, trk.trackCount, where);
          assert.ok(trk.surfaces.every((s) => s.points.length === 20 && s.segmentTypes.length === 19), where);
          assert.ok(cprTrackIsClosed(trk.surfaces), where);
          counts.trk++;
        }
        if (game === "cpr" && entry.title.endsWith(".TTX")) {
          const ttx = parseCprTtx(readPodEntry(bytes, entry));
          assert.ok(ttx.length > 0 && ttx.every((t) => t.flags >= 0 && t.flags < CPR_SURFACE_TYPES.length), where);
          counts.ttx++;
        }
        if (["tv", "tf", "hb"].includes(game) && entry.title.endsWith(".LVL")) {
          const lvl = parseTvLvl(readPodEntry(bytes, entry));
          assert.ok(lvl.complete, where);
          assert.equal(lvl.origin, game === "hb" ? "HB" : "TV/F3", where);
          counts.lvl++;
          const def = read(lvl.defName);
          if (def) {
            assert.ok(parseDef(def), where);
            counts.def++;
          }
          const nav = read(lvl.navName);
          if (nav && lvl.origin === "HB") counts.nav += parseHbNavPoints(nav, 128).length > 0 ? 1 : 0;
          if (nav && lvl.origin !== "HB") counts.nav += findStartPoint(parseNavPoints(nav, 256)) ? 1 : 0;
        }
      }
    }
  }
  if (existsSync(join(GAMES, "cpr"))) assert.equal(counts.trk, 17);
  assert.ok(counts.sit > 0 && counts.lvl > 0 && counts.def === counts.lvl && counts.nav > 0, JSON.stringify(counts));
});
