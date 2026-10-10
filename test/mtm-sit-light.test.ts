import test from "node:test";
import assert from "node:assert/strict";
import { BOX_LIGHT, parseMtmSit, parseSitLight } from "../src/index.ts";

test("a Community Patch 3 light block: all twelve fields, a short line with defaults, and the clamps", () => {
  const full = parseSitLight("64.000000,8.000000,1.000000,0.500000,0.250000,2,6.000000,125.000000,10.000000,3.500000,0.600000,12.000000");
  assert.deepEqual(full.color, [1, 0.5, 0.25]);
  assert.equal(full.glow, 2);
  assert.equal(full.bright, 0.5);
  assert.equal(full.aimOff, 12);
  const short = parseSitLight("32,4,1,1,1,1,3,100,8,2");
  assert.equal(short.bright, 1);
  assert.equal(short.aimOff, 0);
  assert.equal(parseSitLight("9000,8,1,1,1,0,6,125,10,3.5,9,0").rad, 4095);
  assert.equal(parseSitLight("9000,8,1,1,1,0,6,125,10,3.5,9,0").bright, 3.75);
  assert.deepEqual(parseSitLight(null), { rad: 64, hgt: 8, color: [1, 1, 1], glow: 0, glowRad: 6, coneLen: 125, coneRim: 10, coneBase: 3.5, bright: 1, aimOff: 0 });
});

import { writeMtm2Sit } from "../src/index.ts";
import type { Mtm2SitTruck } from "../src/index.ts";

test("a type 12 box carries its light block; a type 12 box without one gets the defaults; others have none", () => {
  const truck = (x: number): Mtm2SitTruck => ({ position: [x, 10, 200], orient: [0, 0, 0] });
  let text = new TextDecoder().decode(writeMtm2Sit({
    lvlName: "TEST.LVL", trackName: "Test", localeName: "Here", pictureBmp: "UI\\TESTS.BMP", iconBmp: "UI\\TESTL.BMP",
    descriptionTxt: "TEST.TXT", trackLength: 100, yourTruck: truck(1), vehicles: [truck(2)],
    boxes: [
      { position: [10, 20, 30], orient: [0, 0, 0], modelName: "LAMP.BIN", type: 12 },
      { position: [11, 21, 31], orient: [0, 0, 0], modelName: "LAMP.BIN", type: 12 },
      { position: [12, 22, 32], orient: [0, 0, 0], modelName: "TREE.BIN", type: 7 },
    ],
    course: [{ start: [0, 0, 0], end: [100, 0, 0], speedLimit: 40, trackWidth: 60 }],
    extendedCourses: [null, null],
  }));
  // The writer has no light block yet: put one after the first box's model line, as Traxx writes it in that block.
  const first = text.indexOf("LAMP.BIN");
  const lineEnd = text.indexOf("\r\n", first) + 2;
  text = text.slice(0, lineEnd) + "Llight rad,hgt,r,g,b,glow,glowRad,coneLen,coneRim,coneBase,bright,aimOff\r\n32,20,1,0.8,0.6,2,4,90,8,2,0.5,10\r\n" + text.slice(lineEnd);
  const sit = parseMtmSit(text, "TEST.SI2");
  const boxes = sit.boxes.filter((b) => b.type !== 99);
  assert.equal(boxes[0].type, BOX_LIGHT);
  assert.equal(boxes[0].light?.rad, 32);
  assert.equal(boxes[0].light?.aimOff, 10);
  assert.equal(boxes[1].light?.rad, 64);
  assert.equal(boxes[2].light, undefined);
});
