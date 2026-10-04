/*
  The autopilot (OpenMTM2 docs/MTM2_PHYSICS.md §14.22, §14.23).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { mtm2Sim as S } from "../src/index.ts";

type T3 = [number, number, number];
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

const HULL: T3[] = [
  [-3.67, 0, 9.2], [3.67, 0, 9.2], [-3.67, 2.56, 9.2], [3.67, 2.56, 9.2],
  [-2.61, 5.23, 1.89], [2.61, 5.23, 1.89], [-2.14, 5.23, -0.8], [2.1, 5.23, -0.8],
  [-3.67, 2.82, -9.2], [3.67, 2.82, -9.2], [-3.67, 0, -9.2], [3.67, 0, -9.2],
];

test("the game's angle wrap and heading", () => {
  near(S.wrapGame(3 * Math.PI / 2), -Math.PI / 2);
  near(S.wrapGame(-7), -7 + 2 * Math.PI);
  assert.equal(S.headingOf(0, -1), Math.PI);
  assert.equal(S.headingOf(0, 1), 0);
  assert.equal(S.headingOf(1, 0), Math.PI / 2);
});

test("difficulty gains: 0.5, 0.75, 1.0", () => {
  assert.deepEqual([0, 1, 2].map(S.autopilotGain), [0.5, 0.75, 1.0]);
});

/** A 1200 x 800 ft rectangle of straights, clockwise seen from above, on flat ground at 100 ft. */
function rectangleWorld() {
  const terrain = S.createTerrain(new Uint8Array(65536).fill(50));
  const ground = S.createTerrainGround(terrain, null, 0, null);
  const corners: T3[] = [[1000, 100, 1000], [1000, 100, 2200], [1800, 100, 2200], [1800, 100, 1000]];
  const straights = corners.map((a, i) => {
    const b = corners[(i + 1) % 4];
    // Each straight stops 150 ft short of the corners, leaving room for the arcs.
    const dir = [Math.sign(b[0] - a[0]), 0, Math.sign(b[2] - a[2])];
    return {
      startFt: [a[0] + dir[0] * 150, 100, a[2] + dir[2] * 150], endFt: [b[0] - dir[0] * 150, 100, b[2] - dir[2] * 150],
      ctype: 1, cspeedType: 0, cdecPoint: 20, cspeed: 60, speedLimit: 0, trackWidthFt: 32,
    };
  });
  const course = S.buildCourse(straights, (x, z) => ground.height(x, z));
  return { ground, course };
}

test("advancing: a straight ends at the line across it where the next arc begins", () => {
  const { course } = rectangleWorld();
  const params = S.createTruckParams({ scrapePoints: HULL }, { difficulty: S.DIFFICULTY.INTERMEDIATE });
  const s = S.createTruckState([1000, 106, 1500], 0, S.GEAR.FIRST, params);
  const ctx = { course, height: () => 100, dt: 1 / 60, difficulty: 1 };
  assert.equal(S.advanceAutopilotSegment(s, ctx), false);
  // The first straight ends at z 2050; within cdec_point (20 ft) of that line it moves on.
  s.pos[2] = 2035;
  assert.equal(S.advanceAutopilotSegment(s, ctx), true);
  assert.equal(s.ap.segment, 1);
  assert.equal(s.ap.segmentsPassed, 1);
});

test("rubber-banding: a leading CPU truck loses trunc(frac(vz) * 5 / place) * 0.1 entering a straight", () => {
  const { course } = rectangleWorld();
  const params = S.createTruckParams({ scrapePoints: HULL }, { difficulty: S.DIFFICULTY.INTERMEDIATE });
  const s = S.createTruckState([1000, 106, 1500], 0, S.GEAR.FIRST, params);
  s.ap.segment = 1; // the first arc; its exit leads onto straight 2 along +x
  const arc = course[1] as S.CourseArc;
  s.pos[0] = arc.centre[0] + Math.sin(arc.exitAngle) * arc.radius;
  s.pos[2] = arc.centre[2] + Math.cos(arc.exitAngle) * arc.radius + 1;
  s.bvel[2] = 50.9;
  assert.ok(S.advanceAutopilotSegment(s, { course, height: () => 100, dt: 1 / 60, difficulty: 1, place: 1, rubberBand: true }));
  near(s.ap.gain, 0.75 - 0.4, 1e-12);
});

test("a CPU truck laps the course on autopilot, staying near the line", () => {
  const { ground, course } = rectangleWorld();
  const params = S.createTruckParams({ scrapePoints: HULL }, { difficulty: S.DIFFICULTY.INTERMEDIATE });
  const s = S.createTruckState([1000, 106.2, 1150], 0, S.GEAR.FIRST, params);
  const dt = 1 / 60;
  const step = { ground, human: false, difficulty: 1, sonicTrack: false };
  const ap = { course, height: (x: number, z: number) => ground.height(x, z), dt, difficulty: 1 };
  let worst = 0, top = 0;
  for (let i = 0; i < 60 * 120; i++) {
    S.advanceAutopilotSegment(s, ap);
    S.applyAutopilot(s, params, ap);
    S.stepTruck(s, params, step, dt);
    S.postStepTruck(s, params, ground, dt);
    // Off the rectangle's lines (x 1000 or 1800, z 1000 or 2200), inside the corners.
    const off = Math.min(Math.abs(s.pos[0] - 1000), Math.abs(s.pos[0] - 1800), Math.abs(s.pos[2] - 1000), Math.abs(s.pos[2] - 2200));
    worst = Math.max(worst, off);
    top = Math.max(top, Math.hypot(...Array.from(s.bvel)));
  }
  assert.ok([...s.pos, ...s.bvel].every(Number.isFinite));
  assert.ok(s.ap.segmentsPassed >= 8, `only ${s.ap.segmentsPassed} segments in two minutes`);
  assert.ok(worst < 160, `${worst} ft off the course`);
  assert.ok(top > 40, `top speed ${top}`);
});

// Traffic and the time to the segment's end (§14.24, §14.25).

function twoTrucks() {
  const { ground, course } = rectangleWorld();
  const params = S.createTruckParams({ scrapePoints: HULL }, { difficulty: S.DIFFICULTY.INTERMEDIATE });
  const a = S.createTruckState([1000, 106, 1200], 0, S.GEAR.FIRST, params);
  const b = S.createTruckState([1000, 106, 1260], 0, S.GEAR.FIRST, params);
  const trucks = [{ s: a, p: params }, { s: b, p: params }];
  const ctx = { course, height: (x: number, z: number) => ground.height(x, z), dt: 1 / 60, difficulty: 1, traffic: trucks };
  const setSpeed = (s: S.Mtm2TruckState, v: number) => { for (const t of s.tires) t.spin = v / params.tireRadiusFt; };
  return { course, params, a, b, trucks, ctx, setSpeed };
}

test("time to a straight's end: accelerate, then brake into the corner speed", () => {
  const { course, params, a, ctx, setSpeed } = twoTrucks();
  const seg = course[0] as S.CourseStraight;
  setSpeed(a, 30);
  a.ap.decel = 12; a.ap.accel = 8;
  const D = Math.hypot(seg.end[0] - a.pos[0], seg.end[1] - 100, seg.end[2] - a.pos[2]);
  const vc = seg.speed, v = 30;
  const x = (12 * (D - seg.decPoint) * 2 + vc * vc - v * v) / ((12 + 8) * 2);
  const vp = Math.sqrt(8 * x * 2 + v * v);
  near(S.segmentEta(a, params, seg, ctx.height), (vp - v) / 8 + (vp - vc) / 12, 1e-6);
  // A deceleration under 0.1 is written back as 0.1.
  a.ap.decel = 0;
  S.segmentEta(a, params, seg, ctx.height);
  assert.equal(a.ap.decel, 0.1);
});

test("time to an arc's end: the arc left at the tires' speed", () => {
  const { course, params, a, ctx, setSpeed } = twoTrucks();
  const arc = course[1] as S.CourseArc;
  const th = arc.exitAngle - 0.5;
  a.pos[0] = arc.centre[0] + Math.sin(th) * arc.radius; a.pos[2] = arc.centre[2] + Math.cos(th) * arc.radius;
  setSpeed(a, 40);
  near(S.segmentEta(a, params, arc, ctx.height), (arc.radius * 0.5) / 40, 1e-6);
});

test("following: the target speed is capped at sqrt(vF^2 + 2 a (d - R)) behind the nearest truck ahead", () => {
  const { params, a, b, trucks, ctx, setSpeed } = twoTrucks();
  a.ap.progress = 0.05; b.ap.progress = 0.12;
  a.ap.eta = 10; b.ap.eta = 5; // b is more than the window ahead: no pass target
  a.ap.decel = 10;
  setSpeed(b, 20);
  const R = 2 * S.truckRadius(params);
  const out = S.applyTraffic(a, params, ctx, trucks, 0, 0.01, 100);
  assert.equal(a.ap.passTarget, -1);
  assert.equal(a.ap.side, 0);
  assert.equal(a.ap.follow, 1);
  near(out.target, Math.sqrt(400 + 2 * 10 * (60 - R)), 1e-9);
  assert.equal(out.c, 0.01);
  // A truck off the line (|e| >= 32) is ignored.
  b.ap.crossTrack = 40;
  assert.equal(S.applyTraffic(a, params, ctx, trucks, 0, 0, 100).target, 100);
  assert.equal(a.ap.follow, -1);
});

test("passing: a truck just ahead becomes the target, a side is chosen, and the correction aims beside it", () => {
  const { params, a, b, trucks, ctx } = twoTrucks();
  b.pos[0] = 1003; b.pos[2] = 1230;
  a.bvel[2] = 50;
  a.ap.progress = 0.05; b.ap.progress = 0.08;
  a.ap.eta = 5.05; b.ap.eta = 5; // within the window z1 / cspeed * G0
  b.ap.crossTrack = 3;
  b.ap.correction = 0.05; a.ap.correction = 0;
  const out = S.applyTraffic(a, params, ctx, trucks, 0, 0, 100);
  assert.equal(a.ap.passTarget, 1);
  assert.equal(a.ap.candidates, 1);
  // Both on straights and close: the side follows c_T - c_A (+ the hysteresis).
  assert.equal(a.ap.side, 1);
  // The point beside the target is more than 1/8 rad off: the straight's clamp.
  assert.equal(out.c, 0.125);
  // The other way round, the other side.
  b.ap.correction = -0.05; a.ap.side = 0;
  S.applyTraffic(a, params, ctx, trucks, 0, 0, 100);
  assert.equal(a.ap.side, -1);
});

test("passing: the previous target is kept while it is on the line on the next segment", () => {
  const { params, a, b, trucks, ctx } = twoTrucks();
  a.ap.passTarget = 1; a.ap.side = 1;
  b.ap.segment = 1;
  const arc = ctx.course[1] as S.CourseArc;
  b.pos[0] = arc.centre[0] + Math.sin(arc.entryAngle) * arc.radius; b.pos[2] = arc.centre[2] + Math.cos(arc.entryAngle) * arc.radius;
  S.applyTraffic(a, params, ctx, trucks, 0, 0, 100);
  assert.equal(a.ap.passTarget, 1);
  assert.equal(a.ap.candidates, 1);
  // Off the line it is dropped, and with no target the side returns to 0.
  b.ap.crossTrack = 33;
  S.applyTraffic(a, params, ctx, trucks, 0, 0, 100);
  assert.equal(a.ap.passTarget, -1);
  assert.equal(a.ap.side, 0);
});

test("beside a truck ahead: within 1.25 R / G0 and more than 30 degrees off its tail, aim 100 ft up alongside", () => {
  const { params, a, b, trucks, ctx } = twoTrucks();
  const R = 2 * S.truckRadius(params);
  b.pos[0] = 1000 - 18; b.pos[2] = 1210; // ahead on the left
  a.ap.progress = 0.05; b.ap.progress = 0.06;
  a.ap.eta = 10; b.ap.eta = 5;
  const out = S.applyTraffic(a, params, ctx, trucks, 0, 0, 100);
  assert.equal(a.ap.follow, 1);
  const d = Math.hypot(18, 10);
  assert.ok(d < (1.25 / 0.75) * R && 10 / d < 0.866);
  // a is on b's right (+x), so the aim point is b + R n + 100 h.
  near(out.c, S.headingOf(-18 + R, 10 + 100), 1e-9);
});
