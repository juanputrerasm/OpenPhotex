/*
  MTM2 course segments: the fields the game's loader reads (MONSTER.EXE 0x4e0970), in feet.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { parseMtmSit, sitFeetTriplet, sitWorldTriplet } from "../src/index.ts";

function sitWithCourse(courseBody: string): string {
  return [
    "!ambient sound,track length,weather mask", "3,1000.000000,65535",
    "*** Course ***", "c1Count,course_direction", courseBody,
    "*** Stadium ***", "",
  ].join("\r\n");
}

const segment = (n: number, start: string, end: string, speeds: string, limits: string | null) => [
  `********************************************* ${n}`,
  "ctype,cspeed_type", "1,0",
  "cstart", start,
  "cend", end,
  "cdec_point,cspeed,lastentry", speeds,
  ...(limits === null ? [] : ["&cSpeedLimit,cTrackWidth", limits]),
].join("\r\n");

test("course segments carry the loader's fields in feet, and the course its direction", () => {
  const sit = parseMtmSit(sitWithCourse([
    "2,1",
    segment(1, "1383.5,168.75,4031.5", "-10.0,167.0,-20.0", "30.000000,73.293808,0", "12.5,40.0"),
    segment(3, "1888.0,178.0,3903.5", "1888.0,166.0,3424.0", "25.0,72.0,1", null),
  ].join("\r\n")), "TEST.SIT");
  const course = sit.primaryCourse!;
  assert.equal(course.direction, 1);
  assert.equal(course.segments.length, 2);
  const [a, b] = course.segments;
  assert.deepEqual(a.startFt, [1383.5, 168.75, 4031.5]);
  // The loader wraps negative x and z by +8192 ft; y stays.
  assert.deepEqual(a.endFt, [8182, 167, 8172]);
  assert.equal(a.ctype, 1);
  assert.equal(a.cspeedType, 0);
  assert.equal(a.cdecPoint, 30);
  assert.equal(a.cspeed, 73.293808);
  assert.equal(a.lastEntry, 0);
  assert.equal(a.speedLimit, 12.5);
  assert.equal(a.trackWidthFt, 40);
  // Editor-space fields stay as before.
  assert.deepEqual(a.start, sitWorldTriplet("1383.5,168.75,4031.5"));
  // A segment without the optional & line takes the game's defaults, not the next segment's.
  assert.equal(b.speedLimit, 0);
  assert.equal(b.trackWidthFt, 32);
  assert.equal(b.lastEntry, 1);
});

test("sitFeetTriplet wraps only negative horizontal coordinates", () => {
  assert.deepEqual(sitFeetTriplet("-1.5,-2.0,-3.0"), [8190.5, -2, 8189]);
  assert.deepEqual(sitFeetTriplet("garbage"), [0, 0, 0]);
});
