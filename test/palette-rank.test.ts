/*
  Palette ranking for 8-bit .RAW textures: the picker list (no origin) and the automatic chain
  a caller that knows the game gets.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { BUNDLED_PALETTE_IDS, bundledPalette, findTextureSibling, paletteCandidates, parsePod, textureStem } from "../src/index.ts";
import type { PaletteCandidate } from "../src/index.ts";
import { buildPod1 } from "./fixtures/build.ts";

function archive(names: string[], palettes: Record<string, string> = {}) {
  return parsePod(buildPod1(names.map((name) => ({ name, data: new Uint8Array(768), nameFieldTail: palettes[name] ? `${palettes[name]}\0` : undefined }))));
}

const describe = (c: PaletteCandidate) =>
  c.source === "bundled" ? `bundled:${c.bundled}`
    : c.source === "track" ? "track"
      : c.source === "pod-metadata" ? `pod-metadata:${c.name}:${c.entry?.name ?? c.bundled ?? "unresolved"}`
        : `${c.source}:${c.entry.name}`;

test("bundled palettes are the four 768-byte stock palettes", () => {
  for (const id of BUNDLED_PALETTE_IDS) assert.equal(bundledPalette(id).length, 768);
  // METALCR2 opens on a grey ramp; the CPR palette does not.
  assert.deepEqual([...bundledPalette("metalcr2Mtm1").subarray(0, 6)], [0, 0, 0, 8, 8, 8]);
  assert.notDeepEqual(bundledPalette("metalcr2Mtm1"), bundledPalette("metalcr2Cpr"));
});

test("texture siblings prefer the art folders, then any folder by name", () => {
  assert.equal(textureStem("art\\Rd4a.raw"), "RD4A");
  const pod = archive(["OTHER\\RD4A.ACT", "DATA\\RD4A.ACT", "ART\\RD4A.RAW", "X\\SKY.ACT"]);
  assert.equal(findTextureSibling(pod, "rd4a.raw", ".act")?.name, "DATA\\RD4A.ACT");
  assert.equal(findTextureSibling(pod, "SKY.RAW", ".ACT")?.name, "X\\SKY.ACT");
  assert.equal(findTextureSibling(pod, "NONE.RAW", ".ACT"), null);
});

test("the picker list: every rule, all bundled palettes, same-folder last, nothing twice", () => {
  const pod = archive(
    ["ART\\TREE.RAW", "ART\\TREE.ACT", "ART\\ROCK.ACT", "ART\\METALCR2.ACT", "VGA.ACT", "LEVELS\\L1.ACT"],
    { "ART\\TREE.RAW": "ROCK.ACT" },
  );
  const list = paletteCandidates(pod, { name: "TREE.RAW" }).map(describe);
  assert.deepEqual(list, [
    "same-stem:ART\\TREE.ACT",
    "pod-metadata:ROCK.ACT:ART\\ROCK.ACT",
    "archive:ART\\METALCR2.ACT",
    "archive:VGA.ACT",
    "bundled:metalcr2Mtm1",
    "bundled:metalcr2Cpr",
    "bundled:vgaHB",
    "bundled:vgaTV",
  ]);
});

test("a metadata palette that is not packed: METALCR2 is supplied, anything else is unresolved", () => {
  const metal = archive(["ART\\A.RAW"], { "ART\\A.RAW": "METALCR2.ACT" });
  assert.equal(describe(paletteCandidates(metal, { name: "A.RAW" })[0]), "pod-metadata:METALCR2.ACT:metalcr2Mtm1");
  const other = archive(["ART\\A.RAW", "ART\\B.ACT"], { "ART\\A.RAW": "LOST.ACT" });
  const list = paletteCandidates(other, { name: "A.RAW" }).map(describe);
  assert.equal(list[0], "pod-metadata:LOST.ACT:unresolved");
  assert.equal(list.at(-1), "same-folder:ART\\B.ACT");
});

test("with an origin: model art in the racing games takes the shared palette over the track's", () => {
  const pod = archive(["ART\\CKBOX.RAW"]);
  const chain = (origin: string, kind: "model" | "terrain") =>
    paletteCandidates(pod, { name: "CKBOX.RAW" }, { origin, kind, trackPalette: true }).map(describe);
  assert.deepEqual(chain("MTM2", "model"), ["bundled:metalcr2Mtm1", "track"]);
  assert.deepEqual(chain("CPR", "model"), ["bundled:metalcr2Cpr", "track"]);
  assert.deepEqual(chain("MTM2", "terrain"), ["bundled:metalcr2Mtm1", "track"]);
  assert.deepEqual(chain("MTM1", "terrain"), ["track", "bundled:metalcr2Mtm1"]);
  assert.deepEqual(chain("HB", "model"), ["track", "bundled:vgaHB"]);
  assert.deepEqual(chain("TV/F3", "model"), ["track", "bundled:vgaTV"]);
  // Another game still gets a chain, with MTM1's palette and the flight ranking.
  assert.deepEqual(chain("EVO2", "model"), ["track", "bundled:metalcr2Mtm1"]);
  assert.deepEqual(paletteCandidates(pod, { name: "CKBOX.RAW" }, { automatic: true }).map(describe), ["bundled:metalcr2Mtm1"]);
});

test("with an origin: the archive's METALCR2 beats VGA and the bundled copy, and no same-folder guess", () => {
  const pod = archive(["ART\\A.RAW", "ART\\METALCR2.ACT", "VGA.ACT", "ART\\B.ACT"]);
  assert.deepEqual(paletteCandidates(pod, { name: "A.RAW" }, { origin: "CPR" }).map(describe), [
    "archive:ART\\METALCR2.ACT",
    "bundled:metalcr2Cpr",
  ]);
});
