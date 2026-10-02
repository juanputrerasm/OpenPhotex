/*
  A .SIT whose box count does not match the records it holds: the reader reports it and reads
  only the records that are there, never the next section's.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { parseMtmSit, writeMtm2Sit } from "../src/index.ts";
import type { Mtm2SitTruck } from "../src/index.ts";

const truck = (x: number): Mtm2SitTruck => ({ position: [x, 10, 200], orient: [0, 0, 0] });
const sitText = () => new TextDecoder().decode(writeMtm2Sit({
  lvlName: "TEST.LVL", trackName: "Test", localeName: "Here", pictureBmp: "UI\\TESTS.BMP", iconBmp: "UI\\TESTL.BMP",
  descriptionTxt: "TEST.TXT", trackLength: 100, yourTruck: truck(1), vehicles: [truck(2)],
  boxes: [
    { position: [10, 20, 30], orient: [0, 0, 0], modelName: "ROCK.BIN", type: 0 },
    { position: [11, 21, 31], orient: [0, 0, 0], modelName: "TREE.BIN", type: 7 },
  ],
  course: [{ start: [0, 0, 0], end: [100, 0, 0], speedLimit: 40, trackWidth: 60 }],
  extendedCourses: [null, null],
}));

test("a SIT whose box count matches its records reads without warnings", () => {
  const sit = parseMtmSit(sitText(), "TEST.SIT");
  assert.equal(sit.boxes.length, 2);
  assert.deepEqual(sit.warnings, []);
});

test("a SIT declaring more boxes than it holds is reported and does not read the course as a box", () => {
  const sit = parseMtmSit(sitText().replace("*** Boxes ***\r\n2\r\n", "*** Boxes ***\r\n3\r\n"), "TEST.SIT");
  assert.equal(sit.boxes.length, 2);
  assert.equal(sit.warnings.length, 1);
  assert.equal(sit.warnings[0], "Box count 3 and real object count 2 doesn't match");
});

test("a SIT declaring fewer boxes than it holds is reported and reads the declared count", () => {
  const sit = parseMtmSit(sitText().replace("*** Boxes ***\r\n2\r\n", "*** Boxes ***\r\n1\r\n"), "TEST.SIT");
  assert.equal(sit.boxes.length, 1);
  assert.equal(sit.warnings[0], "Box count 1 and real object count 2 doesn't match");
});
