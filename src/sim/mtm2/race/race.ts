/*
  A race (MTM2_PHYSICS.md §14.24, MONSTER_EXE_ANALYSIS.md §6): the countdown, each truck's
  checkpoints and laps, the finish, and the race order.

  The race tick runs once per step, after the trucks' post-steps: for each truck the checkpoint
  test, the time to the segment's end, the segment advance (§14.23) and the progress in the
  segment; then the order; then the clock. Circuit and Rally share it; Summit Rumble scoring and drag racing are not in yet.
*/
import { createBox, type SimBox } from "../collide/box.ts";
import { HULL_ORDER, depthInside, faceNormal, nearestFace } from "../collide/faces.ts";
import { advanceAutopilotSegment, headingOf, segmentEta, wrapGame, type AutopilotContext } from "../truck/autopilot.ts";
import type { Mtm2TruckParams } from "../truck/params.ts";
import { liftOff, truckRadius, type RecoveryContext } from "../truck/recovery.ts";
import { autopilotGain, type Mtm2TruckState } from "../truck/state.ts";
import type { Mtm2Ground } from "../world/ground.ts";
import { isArc, type CourseSegment } from "../world/course.ts";
import type { Mtm2Checkpoint } from "../world/checkpoints.ts";

type V3 = [number, number, number];
const toWorld = (m: ArrayLike<number>, x: number, y: number, z: number): V3 =>
  [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
const toBody = (m: ArrayLike<number>, x: number, y: number, z: number): V3 =>
  [m[0] * x + m[3] * y + m[6] * z, m[1] * x + m[4] * y + m[7] * z, m[2] * x + m[5] * y + m[8] * z];

/** The countdown before the start (§6.1), seconds. */
export const COUNTDOWN_S = 3;
/** The checkpoint pretest radius factor and the segment-counter cap (§14.24). */
const PRETEST = 2, SEGMENT_CAP = 90;

export interface RaceTruck {
  s: Mtm2TruckState;
  p: Mtm2TruckParams;
  /** The player's truck (missed checkpoints are announced, not recovered). */
  player: boolean;
  /** The next checkpoint, an index into the race's checkpoints (+0xfa8). */
  checkpoint: number;
  /** Checkpoints passed in all (+0xfac) and course segments counted on passes (+0x8fc). */
  passed: number;
  passCount: number;
  /** Laps completed (+0x8f4); each lap's time (+0xf50); the race time over them (+0xfa4); the fastest (+0xfa0, 0 none). */
  laps: number;
  lapTimes: number[];
  raceTime: number;
  fastestLap: number;
  /** This lap's splits, each the time since the last checkpoint. */
  splits: number[];
  /** The lap the truck finishes on (the race's laps, or less once the race is over). */
  finishLap: number;
  finished: boolean;
  /** The last checkpoint result: 0 none, 2 pass, 3 miss (+0x908). */
  state: number;
  /** Progress in the current segment, 0..1 (+0x8c8), and the place (+0x8f8). */
  progress: number;
  place: number;
}

export interface Race {
  trucks: RaceTruck[];
  checkpoints: { gate: SimBox; detector: SimBox; psi: number }[];
  course: readonly CourseSegment[];
  laps: number;
  /** The race clock (0x6f61d8) and the moment of the start (raceStartTime). */
  clock: number;
  startTime: number;
  /** The first truck has completed the laps. */
  over: boolean;
  difficulty: number;
}

/** The checkpoints as boxes: gate and detector (§6.2), with the checkpoint's heading. */
export function raceCheckpoints(cps: readonly Mtm2Checkpoint[]): Race["checkpoints"] {
  return cps.map((c) => ({
    gate: createBox(c.gate.position, c.gate.size, 0, c.gate.angles),
    detector: createBox(c.detector.position, c.detector.size, 0, c.detector.angles),
    psi: c.gate.angles[2],
  }));
}

export function createRace(
  trucks: readonly { s: Mtm2TruckState; p: Mtm2TruckParams; player?: boolean }[],
  checkpoints: Race["checkpoints"], course: readonly CourseSegment[], laps: number, difficulty: number,
): Race {
  return {
    trucks: trucks.map((t, i) => ({
      s: t.s, p: t.p, player: !!t.player, checkpoint: 0, passed: 0, passCount: 0, laps: 0, lapTimes: [], raceTime: 0,
      fastestLap: 0, splits: [], finishLap: laps, finished: false, state: 0, progress: 0, place: i + 1,
    })),
    checkpoints, course, laps, clock: 0, startTime: COUNTDOWN_S, over: false, difficulty,
  };
}

/** Whether the countdown has run out. */
export function raceStarted(race: Race): boolean {
  return race.clock >= race.startTime;
}

/**
 * The checkpoint-mode hull test (§14.24 step 2): the deepest hull point that crossed the box's
 * back face (-z), with its depth and body point; null when none.
 */
export function backFaceCrossing(s: Mtm2TruckState, p: Mtm2TruckParams, box: SimBox, dt: number): { depth: number; point: V3 } | null {
  const m = s.matrix, bm = box.matrix, half = box.half;
  const iv = toWorld(m, s.bvel[0], s.bvel[1], s.bvel[2]);
  const lift = toWorld(m, 0, s.points[2 * 3 + 1] * 0.5, 0);
  const rel: V3 = [s.pos[0] - box.pos[0], s.pos[1] - box.pos[1], s.pos[2] - box.pos[2]];
  const prevRef = toBody(bm,
    rel[0] - (iv[0] - box.vel[0]) * dt + lift[0],
    rel[1] - (iv[1] - box.vel[1]) * dt + lift[1],
    rel[2] - (iv[2] - box.vel[2]) * dt + lift[2]);
  let best: { depth: number; point: V3 } | null = null;
  let deepest = -9999;
  for (let j = 0; j < 12; j++) {
    const body: V3 = [s.points[j * 3], s.points[j * 3 + 1], s.points[j * 3 + 2]];
    const w = toWorld(m, body[0], body[1], body[2]);
    const cur = toBody(bm, rel[0] + w[0], rel[1] + w[1], rel[2] + w[2]);
    const d: V3 = [cur[0] - prevRef[0], cur[1] - prevRef[1], cur[2] - prevRef[2]];
    const l = Math.hypot(d[0], d[1], d[2]);
    const dir: V3 = l === 0 ? [0, 1, 0] : [d[0] / l, d[1] / l, d[2] / l];
    const { face } = nearestFace(half, prevRef, dir, true, HULL_ORDER);
    if (face < 0 || faceNormal(face)[2] !== -1) continue;
    const depth = depthInside(half, cur, face);
    if (deepest < depth) { deepest = depth; best = { depth, point: body }; }
  }
  void p;
  return best && best.depth > 0 ? best : null;
}

/** A point's velocity through a box along its axis (+z), box axes. */
function speedThrough(s: Mtm2TruckState, box: SimBox, P: V3): number {
  const [pr, q, r] = s.rates;
  const v = [s.bvel[0] + (r * P[2] - pr * P[1]), s.bvel[1] + (pr * P[0] - q * P[2]), s.bvel[2] + (q * P[1] - r * P[0])];
  const w = toWorld(s.matrix, v[0], v[1], v[2]);
  return toBody(box.matrix, w[0], w[1], w[2])[2];
}

/** One truck's checkpoint test (§14.24); returns 2 on a pass, 3 on a miss, 0 otherwise. */
export function testCheckpoint(race: Race, t: RaceTruck, dt: number, recover?: { ground: Mtm2Ground; rc: RecoveryContext }): number {
  const cp = race.checkpoints[t.checkpoint];
  if (!cp || t.finished) return 0;
  const s = t.s, det = cp.detector;
  const d = Math.hypot(s.pos[0] - det.pos[0], s.pos[1] - det.pos[1], s.pos[2] - det.pos[2]);
  if (!(d < (det.radius + truckRadius(t.p)) * PRETEST)) return 0;
  const hit = backFaceCrossing(s, t.p, det, dt);
  if (!hit) return 0;
  const vz = speedThrough(s, det, hit.point);
  if (!(vz > 0)) return 0;
  const result = backFaceCrossing(s, t.p, cp.gate, dt) ? 2 : 3;
  if (result === 2) pass(race, t, hit.depth, vz);
  else if (t.state !== 3 && !t.player && recover) missedCheckpoint(race, t, cp, recover);
  t.state = result;
  return result;
}

function pass(race: Race, t: RaceTruck, depth: number, vz: number): void {
  if (t.passCount < SEGMENT_CAP) t.passCount++;
  const crossed = race.clock - race.startTime - depth / vz;
  const before = t.splits.reduce((a, x) => a + x, 0);
  t.splits.push(crossed - before - t.raceTime);
  t.checkpoint++;
  t.passed = t.laps * race.checkpoints.length + t.checkpoint;
  if (t.checkpoint < race.checkpoints.length) return;
  // The lap closes.
  const lap = t.splits.reduce((a, x) => a + x, 0);
  t.raceTime += lap;
  t.lapTimes.push(lap);
  if (lap !== 0 && (t.fastestLap === 0 || lap < t.fastestLap)) t.fastestLap = lap;
  t.laps++;
  t.splits = [];
  t.checkpoint = 0;
  finishLap(race, t);
}

/** After a lap closes (`0x52ee50`): the first to complete the laps ends the race (§14.24). */
function finishLap(race: Race, t: RaceTruck): void {
  if (!race.over && t.laps >= race.laps) {
    race.over = true;
    for (const o of race.trucks) o.finishLap = Math.min(o.laps + 1, race.laps);
    t.finishLap = t.laps;
  }
  if (t.laps >= t.finishLap) t.finished = true;
}

/** A CPU truck that missed its checkpoint (§14.24): put back on it (Professional) or lifted. */
function missedCheckpoint(race: Race, t: RaceTruck, cp: Race["checkpoints"][number], recover: { ground: Mtm2Ground; rc: RecoveryContext }): void {
  const s = t.s;
  if (race.difficulty === 2) {
    s.pos[0] = cp.gate.pos[0];
    s.pos[1] += 10;
    s.pos[2] = cp.gate.pos[2];
    s.bvel.fill(0); s.rates.fill(0);
    s.euler[0] = 0; s.euler[1] = 0; s.euler[2] = cp.psi;
    // 20 ft back along the checkpoint's axis.
    s.pos[0] -= Math.sin(cp.psi) * 20;
    s.pos[2] -= Math.cos(cp.psi) * 20;
  } else {
    s.heliTimer = -6;
    liftOff(s, t.p, recover.ground, recover.rc, s.contactCount);
  }
}

/**
 * Progress in the current segment (+0x8c8, §14.24): 1 minus the share left, measured from the
 * hull's front point, or its rear point while passing.
 */
export function segmentProgress(t: RaceTruck, course: readonly CourseSegment[], difficulty: number): number {
  const seg = course[t.s.ap.segment];
  if (!seg) return 0;
  const z1 = t.p.scrapePoints[t.s.ap.side !== 0 ? 10 : 0]?.[2] ?? 0;
  const pos = t.s.pos;
  let f: number;
  if (isArc(seg)) {
    const theta = headingOf(pos[0] - seg.centre[0], pos[2] - seg.centre[2]);
    f = (seg.radius * wrapGame(seg.exitAngle - theta) - z1) / (seg.radius * wrapGame(seg.exitAngle - seg.entryAngle));
  } else {
    const toEnd = Math.hypot(seg.end[0] - pos[0], seg.end[1] - pos[1], seg.end[2] - pos[2]);
    const length = Math.hypot(seg.end[0] - seg.start[0], seg.end[1] - seg.start[1], seg.end[2] - seg.start[2]);
    f = length === 0 ? 0 : (toEnd - z1 / autopilotGain(difficulty)) / length;
  }
  return 1 - f;
}

/** Whether `b` is ahead of `a` in the race order (§14.24). */
function ahead(race: Race, a: RaceTruck, b: RaceTruck): boolean {
  if (a.laps >= race.laps) return b.laps >= race.laps && b.raceTime < a.raceTime;
  if (b.laps >= race.laps || a.passed < b.passed) return true;
  if (a.passed !== b.passed) return false;
  const sa = a.s.ap.segmentsPassed, sb = b.s.ap.segmentsPassed;
  return sa < sb || (sa === sb && a.progress < b.progress);
}

/** The places of every truck (+0x8f8). */
export function raceOrder(race: Race): void {
  for (const a of race.trucks) {
    let place = 1;
    for (const b of race.trucks) if (b !== a && ahead(race, a, b)) place++;
    a.place = place;
  }
}

/**
 * The race tick (§14.24), after the trucks have stepped: checkpoints, segments and progress for
 * each truck, then the order and the clock. `ap` is each truck's autopilot context (its course).
 */
export function raceTick(race: Race, dt: number, ap: AutopilotContext, recover?: { ground: Mtm2Ground; rc: (t: RaceTruck) => RecoveryContext }): void {
  if (raceStarted(race)) {
    for (const t of race.trucks) {
      testCheckpoint(race, t, dt, recover ? { ground: recover.ground, rc: recover.rc(t) } : undefined);
      const seg = race.course[t.s.ap.segment];
      if (seg) t.s.ap.eta += (segmentEta(t.s, t.p, seg, ap.height) - t.s.ap.eta) * dt * 0.75;
      advanceAutopilotSegment(t.s, { ...ap, place: t.place, rubberBand: !t.player && !race.trucks.some((o) => o.player && o.place === 1) && race.trucks.some((o) => o.player) }, t.p);
      t.progress = t.s.ap.progress = segmentProgress(t, race.course, race.difficulty);
    }
    raceOrder(race);
  }
  race.clock += dt;
}
