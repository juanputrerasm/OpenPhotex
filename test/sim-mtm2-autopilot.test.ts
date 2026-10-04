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
