/*
  MTM2 course construction (OpenMTM2 docs/MTM2_PHYSICS.md §12), hand-computed.
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  arcBetween, buildArc, buildCourse, isArc, lineIntersection, nextSegmentIndex, orientedCourse, wrapAngle,
  type CourseArc, type CourseStraight, type Point3,
} from "../src/sim/mtm2/world/course.ts";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const flat = () => 0;

const straight = (start: Point3, end: Point3, cspeed = 50): CourseStraight => ({
  ctype: 1, cspeedType: 0, start, end, decPoint: 30, speed: cspeed, speedLimit: 0, trackWidth: 32, lastEntry: false,
});

/** A square loop of side 1000 ft, each straight stopping 100 ft short of the corners. */
const square = [
  straight([100, 0, 0], [900, 0, 0]),
  straight([1000, 0, 100], [1000, 0, 900]),
  straight([900, 0, 1000], [100, 0, 1000]),
  straight([0, 0, 900], [0, 0, 100]),
];

test("angle wrap", () => {
  near(wrapAngle(3 * Math.PI / 2), -Math.PI / 2);
  near(wrapAngle(-3 * Math.PI / 2), Math.PI / 2);
  near(wrapAngle(7 * Math.PI), Math.PI, 1e-9);
});

test("line intersection, general and axis-aligned", () => {
  const p = lineIntersection([0, 5, 0], [10, 5, 10], [0, 0, 20], [10, 0, 10]);
  near(p[0], 10); assert.equal(p[1], 0); near(p[2], 10);
  // Each corner of the square goes through one of the axis-aligned branches.
  const corners = [[1000, 0], [1000, 1000], [0, 1000], [0, 0]];
  square.forEach((s, i) => {
    const t = square[(i + 1) % 4];
    const q = lineIntersection(s.start, s.end, t.start, t.end);
    near(q[0], corners[i][0]); near(q[2], corners[i][1]);
  });
  // Parallel lines do not meet.
  const parallel = lineIntersection([0, 0, 0], [1, 0, 1], [5, 0, 0], [6, 0, 1]);
  assert.ok(!Number.isFinite(parallel[0]) || !Number.isFinite(parallel[2]));
});

test("a right-angle fillet: radius, centre, entry and exit, corner speed", () => {
  const arc = arcBetween(square[0], square[1], flat);
  near(arc.radius, 100);
  near(arc.centre[0], 900); near(arc.centre[2], 100); assert.equal(arc.centre[1], 0);
  // Entry at B (900, 0) seen from the centre: heading pi; exit at C (1000, 100): pi/2.
  near(Math.abs(arc.entryAngle), Math.PI);
  near(arc.exitAngle, Math.PI / 2);
  assert.equal(arc.bank, 0);
  near(arc.speed, Math.sqrt(0.725 * 100 * 32.174 * 1.75));
  assert.equal(arc.decPoint, 20);
  near(arcBetween(square[0], square[1], flat, { sonicTrack: true }).speed, Math.sqrt(0.75 * 100 * 32.174 * 1.75));
});

test("a 135 degree turn: tangent at the longer leg's distance", () => {
  const s = Math.SQRT1_2;
  const a = straight([0, 0, 0], [0, 0, 1000]);
  const b = straight([100 * s, 0, 1100 - 100 * s], [800 * s, 0, 1100 - 800 * s]);
  const arc = arcBetween(a, b, flat);
  near(arc.radius, Math.tan(Math.PI / 8) * 100);
  near(arc.centre[0], arc.radius);
  near(arc.centre[2], 1000);
  near(arc.entryAngle, -Math.PI / 2);
  near(arc.exitAngle, Math.PI / 4);
  near(arc.decPoint, arc.radius / 3);
});

test("the far-side flag measures from the opposite side, and flips the sense test too", () => {
  const from: Point3 = [0, 0, 1000], corner: Point3 = [0, 0, 1100];
  const to: Point3 = [70.71067811865476, 0, 1029.2893218813452];
  const near_ = buildArc(from, corner, to, false, true, flat);
  const far = buildArc(from, corner, to, true, true, flat);
  near(far.radius, near_.radius);
  near(far.centre[0], near_.centre[0]);
  // thetaC moves from -pi/8 to 7pi/8, and the sense test (3pi/4 - pi < 0) picks the other order.
  near(far.entryAngle, -3 * Math.PI / 4);
  near(far.exitAngle, Math.PI / 2);
  // arcBetween sets it for a sharp turn whose gap lies on the other side.
  const s = Math.SQRT1_2;
  const a = straight([0, 0, 0], [0, 0, 1000]);
  const b = straight([-50, 0, 1050], [-50 + 700 * s, 0, 1050 - 700 * s]);
  const flagged = arcBetween(a, b, flat);
  const corner2 = lineIntersection(a.start, a.end, b.start, b.end);
  const expected = buildArc(a.end, corner2, b.start, true, true, flat);
  near(flagged.entryAngle, expected.entryAngle);
});

test("touching straights: the 30 ft default", () => {
  const a = straight([0, 0, 0], [0, 0, 1000]);
  const b = straight([0, 0, 1000], [1000 * Math.sin(Math.PI / 3), 0, 1000 + 1000 * Math.cos(Math.PI / 3)]);
  const arc = arcBetween(a, b, flat);
  // alpha = pi/3, R = 30 / cos alpha = 60 >= sqrt(1800): radius sqrt(3600 - 900), centre R away.
  near(arc.radius, Math.sqrt(2700));
  near(arc.centre[0], 60 * Math.sin(Math.PI / 3));
  near(arc.centre[2], 1000 - 60 * 0.5);
  // A hairpin sharper than 90 degrees: R^2 < 1800, radius 30 at 30 / sin alpha.
  const c = straight([0, 0, 1000], [100 * Math.sin(2.6), 0, 1000 + 100 * Math.cos(2.6)]);
  const hairpin = arcBetween(a, c, flat);
  assert.equal(hairpin.radius, 30);
});

test("bank from the ground 5 ft either side of the arc, along the corner heading", () => {
  const ground = (x: number) => x * 0.1;
  const arc = arcBetween(square[0], square[1], ground);
  // Heading from the centre to the corner is 3 pi / 4: x grows by sin(3pi/4) per foot.
  const rise = (105 - 95) * Math.SQRT1_2 * 0.1;
  near(arc.bank, Math.atan(rise * 0.1));
  near(arc.speed, Math.sqrt(0.725 * 100 * 32.174 * (Math.sin(arc.bank) + 1.75 * Math.cos(arc.bank))));
  near(arc.centre[1], 90);
});

test("the built course: straights and arcs alternate, speeds forward, last flagged", () => {
  const course = buildCourse(square.map((s) => ({
    startFt: s.start, endFt: s.end, ctype: 1, cspeedType: 0, cdecPoint: 30, cspeed: 99,
    speedLimit: 0, trackWidthFt: 32,
  })), flat);
  assert.equal(course.length, 8);
  course.forEach((seg, i) => assert.equal(isArc(seg), i % 2 === 1, `segment ${i + 1}`));
  const corner = Math.sqrt(0.725 * 100 * 32.174 * 1.75);
  for (const seg of course) near(seg.speed, corner);
  assert.deepEqual(course.map((s) => s.lastEntry), [false, false, false, false, false, false, false, true]);
  const arcs = course.filter(isArc) as CourseArc[];
  assert.deepEqual(arcs.map((a) => [Math.round(a.centre[0]), Math.round(a.centre[2])]), [[900, 100], [900, 900], [100, 900], [100, 100]]);
  // Each arc ends where the next straight starts.
  arcs.forEach((a, i) => {
    const next = course[(2 * i + 2) % 8] as CourseStraight;
    near(a.centre[0] + Math.sin(a.exitAngle) * a.radius, next.start[0], 1e-6);
    near(a.centre[2] + Math.cos(a.exitAngle) * a.radius, next.start[2], 1e-6);
  });
});

const built = () => buildCourse(square.map((s, i) => ({
  startFt: s.start, endFt: s.end, ctype: 1, cspeedType: 0, cdecPoint: 30, cspeed: 60 + i,
  speedLimit: 0, trackWidthFt: 32,
})), flat);

test("a reversed course turns every segment round, and segment 1 takes the last one's speed (14.22)", () => {
  const course = built();
  const turned = orientedCourse(course, true);
  assert.equal(orientedCourse(course, false), course);
  assert.equal(turned.length, course.length);
  const [a, b] = [course[0] as CourseStraight, turned[0] as CourseStraight];
  assert.deepEqual(b.start, a.end);
  assert.deepEqual(b.end, a.start);
  assert.equal(b.speed, course[course.length - 1]!.speed);
  const arc = course[1] as CourseArc, arcTurned = turned[1] as CourseArc;
  assert.equal(arcTurned.entryAngle, arc.exitAngle);
  assert.equal(arcTurned.exitAngle, arc.entryAngle);
  assert.equal(arcTurned.speed, arc.speed);
  assert.equal(orientedCourse(course, true), turned, "cached");
});

test("the next segment: the one after (the first after the last), or reversed the one before (the last before the first)", () => {
  const course = built();
  const last = course.length - 1;
  assert.equal(nextSegmentIndex(course, 0), 1);
  assert.equal(nextSegmentIndex(course, last), 0);
  assert.equal(nextSegmentIndex(course, 3, true), 2);
  assert.equal(nextSegmentIndex(course, 0, true), last);
});
