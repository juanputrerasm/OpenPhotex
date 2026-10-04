/*
  MTM2 data files: .KLP loop points, SOUNDnnn.TXT, SUN.TXT, .LOC and the POWERBIG cockpit layout.
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCockpitLayout, parseKlp, parseLoc, parseMtmAmbientSounds, parseMtmSun, weatherMaskIncludes,
} from "../src/index.ts";

test("KLP: no loop, one loop with its end stored minus 1, several loops written end first", () => {
  assert.deepEqual(parseKlp("1 0 0\r\n"), { type: 1, mode: 1, flag: false, loops: [{ start: 0, end: null }] });
  assert.deepEqual(parseKlp("2 86339 90000"), { type: 2, mode: 2, flag: false, loops: [{ start: 86339, end: 89999 }] });
  assert.deepEqual(parseKlp("0"), { type: 0, mode: 0, flag: false, loops: [] });
  const many = parseKlp("3\r\n2\r\n0 11828\r\n13631 11828\r\n")!;
  assert.equal(many.mode, 1);
  assert.equal(many.flag, false);
  assert.deepEqual(many.loops, [{ start: 11828, end: null }, { start: 11828, end: 13631 }]);
  assert.equal(parseKlp("6 1 0 5")!.mode, 2);
  assert.equal(parseKlp("6 1 0 5")!.flag, true);
  assert.equal(parseKlp("4 1 0 5")!.flag, true);
  assert.equal(parseKlp("7 0 0"), null);
  assert.equal(parseKlp("3 21 0 0"), null);
  assert.equal(parseKlp("3 2 0 5"), null);
  assert.equal(parseKlp(""), null);
});

test("SOUNDnnn.TXT: positional, label lines before values", () => {
  const s = parseMtmAmbientSounds([
    "checkpoint wav file", "airhorn.wav", "finish lap wav file", "check2.wav",
    "number of one-shots", "2", "wavName, vol, timerMin, timerMax, weatherMask",
    "dino1.wav,     1.4,  1.0,  60.0,  479", "owl1.wav, 1.0, 1.0, 40.0, 511",
    "number of looping sounds", "1", "wavName, vol, weatherMask", "jungl-n1.wav,  .4,  64",
  ].join("\r\n"));
  assert.equal(s.checkpointWav, "airhorn.wav");
  assert.equal(s.finishLapWav, "check2.wav");
  assert.deepEqual(s.oneShots[0], { wav: "dino1.wav", volume: 1.4, timerMin: 1, timerMax: 60, weatherMask: 479 });
  assert.equal(s.oneShots.length, 2);
  assert.deepEqual(s.loops, [{ wav: "jungl-n1.wav", volume: 0.4, weatherMask: 64 }]);
  assert.equal(weatherMaskIncludes(64, 6), true);
  assert.equal(weatherMaskIncludes(479, 5), false);
});

test("SUN.TXT: comment lines skipped, layers and rays", () => {
  const sun = parseMtmSun([
    "// type", "1", "// pos", "0,65536,-196608", "// radius", "916.000000", "// layers", "2", "// layer data",
    "sun06.raw, 0.200000, 43.000000, 8, 8, 248, 248", "suncram.raw, -1.000000, 213.000000, 130, 2, 254, 126",
    "// rays", "2", "// ray data", "0, 0, 0", "0, 2048, 0",
  ].join("\r\n"));
  assert.equal(sun.type, 1);
  assert.deepEqual(sun.position, [0, 65536, -196608]);
  assert.equal(sun.masterRadius, 916);
  assert.deepEqual(sun.layers[1], { texture: "suncram.raw", axisPosition: -1, radius: 213, tex: [130, 2, 254, 126] });
  assert.deepEqual(sun.rays, [[0, 0, 0], [0, 2048, 0]]);
});

test("LOC: tag and string pairs, multi-line blocks, comments, end marker", () => {
  const loc = parseLoc([
    "TRI Message System", "256", "LOC",
    "@@TAG", "Lap:", "@@STRING", "Aplay:",
    "@@TAG", "Two", "", "lines", "@@COMMENT", "ignored", "@@STRING", "", "Replaced",
    "@@TAG", "Place: ", "@@STRING", "Bad ",
    "@@END", "@@TAG", "after the end",
  ].join("\r\n"))!;
  assert.deepEqual(loc, [
    { tag: "Lap:", text: "Aplay:" },
    { tag: "Two\n\nlines", text: "Replaced" },
    { tag: "Place: ", text: "Bad " },
  ]);
  assert.equal(parseLoc("Not a message file\r\n256\r\nLOC\r\n"), null);
});

test("POWERBIG: sections and the typed layout", () => {
  const layout = parseCockpitLayout([
    "; Background image file", "pbig480.raw", "pbigl480.raw", "pbigr480.raw", "pbigb480.raw",
    "; 3D Window coordinate and size", "0,88,640,240",
    "; Speedometer center", "153,319", "; Speedometer radius", "32", "; needle", "needle.bin",
    "; zero", "304.5", "; per mph", "2.65", "; face", "124,296,19,47",
    "; Tachometer center", "435,307", "; radius", "24", "; needle", "needle.bin", "; zero", "153.0",
    "; per rpm", "0.0261", "; face", "438,287,12,45",
    "; Steering wheel", "145,330,350,150", "; Erase window", "174,362,466,480", "; base", "PW480",
    "; Number of mirrors", "1", "; Mirror Location, size", "535,120,105,48", "; Angles", "0,0,32768",
    "; Translation", "0,0,0", "; Zoom", "49152", "; Bitmap position and size", "532,115,108,56",
    "; Bitmap name", "fordm480.raw", "; Shifter name", "ps480", "; Shifter position and size", "496,272,128,192",
    "; Shift light bitmap", "pl480.raw", "; Shift light position and size", "378,261,18,19",
  ].join("\r\n"))!;
  assert.deepEqual(layout.backgrounds, ["pbig480.raw", "pbigl480.raw", "pbigr480.raw", "pbigb480.raw"]);
  assert.deepEqual(layout.window3d, [0, 88, 640, 240]);
  assert.deepEqual(layout.speedometer, { center: [153, 319], radius: 32, needleModel: "needle.bin", zeroAngle: 304.5, degreesPerUnit: 2.65, faceRedraw: [124, 296, 19, 47] });
  assert.equal(layout.tachometer.degreesPerUnit, 0.0261);
  assert.equal(layout.steeringWheelBase, "PW480");
  assert.deepEqual(layout.mirrors[0].angles, [0, 0, 32768]);
  assert.equal(layout.mirrors[0].bitmap, "fordm480.raw");
  assert.equal(layout.shifter, "ps480");
  assert.deepEqual(layout.shiftLightRect, [378, 261, 18, 19]);
  assert.equal(layout.sections.length, 28);
  assert.equal(parseCockpitLayout("; Background\r\nx.raw\r\n; 3D\r\n0,0,1,1\r\n"), null);
});
