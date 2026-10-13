/*
  Monster Truck Madness tournaments (.TRN).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { parseMtmSit, parseTrn, writeTrn } from "../src/index.ts";

const TRI = [
  "== Tournament Name ==", "Monster Truck Triathlon", "== Tournament Description File ==", "tri.txt",
  "== Has Drag Race Flag ==", "1", "== Number Of Tracks ==", "3",
  "== Track Entry #1 ==", "DRAG5.SIT,0", "== Track Entry #2 ==", "CIRC4.SIT,10", "== Track Entry #3 ==", "ISLAND.SIT,0", "\x1a",
].join("\r\n");

test("TRN: name, description file, drag flag and the events with their laps; a Ctrl+Z ends the file", () => {
  const trn = parseTrn(new TextEncoder().encode(`${TRI}junk after the end mark`))!;
  assert.equal(trn.name, "Monster Truck Triathlon");
  assert.equal(trn.descriptionFile, "tri.txt");
  assert.equal(trn.hasDrag, true);
  assert.deepEqual(trn.events, [{ file: "DRAG5.SIT", laps: 0 }, { file: "CIRC4.SIT", laps: 10 }, { file: "ISLAND.SIT", laps: 0 }]);
  assert.deepEqual(trn.warnings, []);
});

test("TRN: written as the game writes it, and read back the same", () => {
  const trn = parseTrn(TRI)!;
  const text = writeTrn(trn);
  assert.equal(text, TRI.replace("\r\n\x1a", "\r\n"));
  assert.deepEqual(parseTrn(text), trn);
});

test("TRN: not a tournament, a wrong count, a missing value", () => {
  assert.equal(parseTrn("circ1.lvl\r\n!Race Track Name\r\n"), null);
  const trn = parseTrn("== Tournament Name ==\n== Tournament Description File ==\nx.txt\n== Number Of Tracks ==\n2\n== Track Entry #1 ==\nA.SIT\n")!;
  assert.equal(trn.name, "");
  assert.equal(trn.hasDrag, false);
  assert.deepEqual(trn.events, [{ file: "A.SIT", laps: 0 }]);
  assert.deepEqual(trn.warnings, ["Number Of Tracks says 2, the file lists 1"]);
});

test("SIT header: the logo, map, description and announcer files, and a drag strip's par time in the fly-by line", () => {
  const head = (flyBy: string, type: number) => [
    "drag5.lvl", "!Race Track Name", "Trans World Dome (J)", "Race Track Locale", "St. Louis, MO", "Track Longtitude, Latitude", "1,2",
    "Track Logo .BMP file", "drag5t.bmp", "Track Map .BMP file", "drag5m.bmp", "Track Fly-By .AVI file", flyBy,
    "Track Announcer .WAV file", "Track", "Track Description .TXT file", "drag5.txt", "Track Race Type", String(type),
  ].join("\r\n");
  const drag = parseMtmSit(head("12.43", 1), "DRAG5.SIT");
  assert.equal(drag.logoBmp, "drag5t.bmp");
  assert.equal(drag.mapBmp, "drag5m.bmp");
  assert.equal(drag.descriptionTxt, "drag5.txt");
  assert.equal(drag.announcerWav, "Track");
  assert.equal(drag.dragParTime, 12.43);
  // Not a number, or not a drag strip: no par time.
  assert.equal(parseMtmSit(head("Sonic", 2), "CIRC1.SIT").dragParTime, null);
  assert.equal(parseMtmSit(head("Track", 1), "X.SIT").dragParTime, null);
  assert.equal(parseMtmSit(head("12.43", 2), "X.SIT").dragParTime, null);
});
