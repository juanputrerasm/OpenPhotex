/*
  MTM2 truck parameters, drivetrain and keyboard controls (OpenMTM2 docs/MTM2_PHYSICS.md §3, §5.2;
  MONSTER_EXE_ANALYSIS.md §7, §8.4, §8.5), hand-computed.
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  clampWheelbase, createTruckParams, defaultWheelAnchors, suspensionRates, transferRatio, type Triplet,
} from "../src/sim/mtm2/truck/params.ts";
import {
  airTargetRpm, chaseRpm, deliveredTorque, driveForce, engineTorque, gearRatio, groundTargetRpm,
  stepGearbox, wheelSpinFromRpm,
} from "../src/sim/mtm2/truck/drivetrain.ts";
import { applyJoystick, applyKeyboard, createControlState, KEY_DT_SCALE, rearSteer } from "../src/sim/mtm2/truck/controls.ts";
import { createTruckState } from "../src/sim/mtm2/truck/state.ts";
import { DIFFICULTY, GEAR } from "../src/sim/mtm2/constants.ts";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test("defaults: 10,000 lb, 310.8 slug, default anchors and soft springs", () => {
  const p = createTruckParams();
  assert.equal(p.weightLb, 10000);
  near(p.massSlug, 310.81, 0.01);
  assert.deepEqual(p.hubs, defaultWheelAnchors());
  assert.equal(p.frontAxleZ, 5.67);
  assert.equal(p.rearAxleZ, -4);
  // Soft front: 4 / 9.67 * 10000 * 0.5 / 1.0 = 2068.25 lb/ft.
  near(p.spring[0], 2068.2523, 1e-3);
  near(p.spring[1], 5.67 / 9.67 * 5000, 1e-6);
  near(p.damper[0], 3.5 * Math.sqrt(p.spring[0]));
  assert.equal(p.transferRatio, 1.185);
  assert.equal(p.gripK, 1.75);
  assert.equal(p.torqueGain, 0.9);
});

test("wheelbase clamp: per side, half the excess each, never across z = 0", () => {
  const hubs = clampWheelbase([[4, -4, 7], [-4, -4, 5], [4, -4, -6], [-4, -4, -4]]);
  // Right side: 13 - 11.6 = 1.4 excess, 0.7 each way.
  near(hubs[0][2], 6.3);
  near(hubs[2][2], -5.3);
  // Left side: 9 ft, untouched.
  assert.equal(hubs[1][2], 5);
  assert.equal(hubs[3][2], -4);
  // Both on one side of the origin: the moved wheel stops at 0.
  const odd = clampWheelbase([[4, -4, 1], [-4, -4, 1], [4, -4, -14], [-4, -4, -14]]);
  assert.equal(odd[0][2], 0);
  near(odd[2][2], -14 + 1.7, 1e-6);
  // The TRK values stay for drawing.
  const drawn: Triplet[] = [[4, -4, 7], [-4, -4, 7], [4, -4, -6], [-4, -4, -6]];
  const p = createTruckParams({ wheelAnchors: drawn });
  assert.deepEqual(p.drawHubs, drawn);
  near(p.frontAxleZ, 6.3);
});

test("suspension sag: soft 1, medium 0.75, hard 0.5 ft; anything else soft", () => {
  for (const [setting, sag] of [[0, 1], [1, 0.75], [2, 0.5], [7, 1]]) {
    const r = suspensionRates(5.67, -4, 10000, setting);
    assert.equal(r.sag, sag);
    near(r.spring[0], (4 / 9.67) * 5000 / sag, 1e-6);
  }
});

test("transfer ratio: table by hundreds, clamped, scaled by difficulty", () => {
  assert.equal(transferRatio(1500, DIFFICULTY.INTERMEDIATE), 1.185);
  assert.equal(transferRatio(1599, DIFFICULTY.INTERMEDIATE), 1.185);
  assert.equal(transferRatio(600, DIFFICULTY.INTERMEDIATE), 1.682);
  assert.equal(transferRatio(5000, DIFFICULTY.INTERMEDIATE), 1);
  assert.equal(transferRatio(300, DIFFICULTY.INTERMEDIATE), 0);
  near(transferRatio(1500, DIFFICULTY.ROOKIE), 1.185 * 1.25);
  near(transferRatio(1500, DIFFICULTY.PROFESSIONAL), 1.185 * 0.75);
});

test("grip and torque gains by driver", () => {
  const cpuSonicPro = createTruckParams({}, { cpu: true, difficulty: DIFFICULTY.PROFESSIONAL, sonicTrack: true });
  assert.equal(cpuSonicPro.gripK, 2);
  assert.equal(cpuSonicPro.torqueGain, 1.1);
  assert.equal(createTruckParams({}, { cpu: true, difficulty: DIFFICULTY.PROFESSIONAL }).gripK, 1.75);
  assert.equal(createTruckParams({}, { autoShift: false }).torqueGain, 1);
  assert.equal(createTruckParams({}, { cpu: true }).torqueGain, 1);
});

test("engine torque curve and gains", () => {
  near(engineTorque(2000), 1700 * (-2.367e-8 * 4e6 + 9.467e-5 * 2000 + 0.905), 1e-9);
  near(engineTorque(2000), 1699.4, 0.1);
  near(engineTorque(6000), 1055.53, 0.01);
  const human = { human: true, autoShift: true, difficulty: 1, sonicTrack: false };
  near(deliveredTorque(2000, 0.5, human), 0.5 * engineTorque(2000) * 0.9);
  near(deliveredTorque(2000, 1, { ...human, autoShift: false }), engineTorque(2000));
  near(deliveredTorque(2000, 1, { human: false, autoShift: true, difficulty: 2, sonicTrack: true }), engineTorque(2000) * 1.1);
});

test("gear ratios and drive force", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(gearRatio), [0, -60, 0, 40.467, 24.017, 16.45]);
  // transfer * gear * T / r * split * 0.5
  near(driveForce(1.185, GEAR.FIRST, 1000, 3, 0.8), 1.185 * 40.467 * (1000 / 3) * 0.8 * 0.5);
  assert.equal(driveForce(1.185, GEAR.NEUTRAL, 1000, 3, 0.8), 0);
});

test("rpm targets: ground from speed with an 800 floor, air from wheel spin wound by the brake", () => {
  // 30 ft/s in first: 1.185 * 40.467 * 30 * 60 / (3 * 2 pi)
  near(groundTargetRpm(1.185, GEAR.FIRST, 30, 3, 0), 1.185 * 40.467 * 30 * 60 / (6 * Math.PI));
  near(groundTargetRpm(1.185, GEAR.REVERSE, -2, 3, 0), 800);
  near(groundTargetRpm(1.185, GEAR.NEUTRAL, 30, 3, 0.5), 4250);
  near(groundTargetRpm(1.185, GEAR.PARK, 30, 3, 0), 800);
  // Air: spin 10 rad/s in second gives 10 * 24.017 * 1.185 * 60 / 2pi, minus 3200 * dt.
  const spinRpm = 10 * 24.017 * 1.185 * 60 / (2 * Math.PI);
  near(airTargetRpm(1.185, GEAR.SECOND, 10, 0, 0, 0.1), spinRpm - 320);
  near(airTargetRpm(1.185, GEAR.SECOND, 10, 1, 0, 0.1), 8500 - 320);
  near(airTargetRpm(1.185, GEAR.SECOND, 0, 0, 1, 0.1), 0);
  near(wheelSpinFromRpm(spinRpm, 1.185, GEAR.SECOND)!, 10);
  assert.equal(wheelSpinFromRpm(3000, 1.185, GEAR.NEUTRAL), null);
  // The lag: rate 1/s, capped on the ground.
  near(chaseRpm(1000, 3000, 0.1, true), 1200);
  near(chaseRpm(8400, 20000, 0.1, true), 8500);
  near(chaseRpm(8400, 20000, 0.1, false), 9560);
});

test("gearbox: automatic thresholds, manual requests, Park brakes, drag staging", () => {
  const box = (gear: number, shiftRequest = 0) => ({ gear, shiftRequest, brakeFront: 0, brakeRear: 0 });
  const ctx = (rpm: number, autoShift = true, forwardSpeed = 10, dragStaging = false) => ({ rpm, autoShift, forwardSpeed, dragStaging });
  let b = box(GEAR.FIRST); stepGearbox(b, ctx(7001)); assert.equal(b.gear, GEAR.SECOND);
  b = box(GEAR.FIRST); stepGearbox(b, ctx(7000)); assert.equal(b.gear, GEAR.FIRST);
  b = box(GEAR.THIRD); stepGearbox(b, ctx(8000)); assert.equal(b.gear, GEAR.THIRD);
  b = box(GEAR.SECOND); stepGearbox(b, ctx(3499)); assert.equal(b.gear, GEAR.FIRST);
  b = box(GEAR.FIRST); stepGearbox(b, ctx(900)); assert.equal(b.gear, GEAR.FIRST);
  // Requests are ignored with automatic shifting, and always cleared.
  b = box(GEAR.FIRST, 1); stepGearbox(b, ctx(4000)); assert.equal(b.gear, GEAR.FIRST); assert.equal(b.shiftRequest, 0);
  // Manual.
  b = box(GEAR.SECOND, 1); stepGearbox(b, ctx(4000, false)); assert.equal(b.gear, GEAR.THIRD);
  b = box(GEAR.THIRD, 1); stepGearbox(b, ctx(4000, false)); assert.equal(b.gear, GEAR.THIRD);
  b = box(GEAR.FIRST, -1); stepGearbox(b, ctx(4000, false, 5)); assert.equal(b.gear, GEAR.FIRST);
  b = box(GEAR.FIRST, -1); stepGearbox(b, ctx(4000, false, 0)); assert.equal(b.gear, GEAR.NEUTRAL);
  b = box(GEAR.PARK, 1); stepGearbox(b, ctx(800, false)); assert.equal(b.gear, GEAR.REVERSE);
  b = box(GEAR.PARK, 1); stepGearbox(b, ctx(800, false, 0, true)); assert.equal(b.gear, GEAR.NEUTRAL);
  b = box(GEAR.NEUTRAL, -1); stepGearbox(b, ctx(800, false, 0, true)); assert.equal(b.gear, GEAR.PARK);
  assert.equal(b.brakeFront, 1);
  assert.equal(b.brakeRear, 1);
});

test("keyboard pedals ramp at half their stored rates", () => {
  const c = createControlState();
  const ctx = { dt: 0.1, autoShift: true, forwardSpeed: 10, dragMode: false, segments: 0 };
  applyKeyboard(c, { accelerate: true, brake: false, left: false, right: false }, ctx);
  near(c.throttle, 3.5 * 0.1 * KEY_DT_SCALE);
  applyKeyboard(c, { accelerate: false, brake: false, left: false, right: false }, ctx);
  assert.equal(c.throttle, 0);
  // Braking while rolling forward brakes and clears the throttle.
  c.throttle = 0.6;
  applyKeyboard(c, { accelerate: false, brake: true, left: false, right: false }, ctx);
  assert.equal(c.throttle, 0);
  near(c.brakeFront, 0.35 * KEY_DT_SCALE);
  // Stopped: the brake key selects Reverse and drives.
  const r = createControlState();
  applyKeyboard(r, { accelerate: false, brake: true, left: false, right: false }, { ...ctx, forwardSpeed: 0 });
  assert.equal(r.gear, GEAR.REVERSE);
  near(r.throttle, 0.35 * KEY_DT_SCALE);
  applyKeyboard(r, { accelerate: true, brake: false, left: false, right: false }, { ...ctx, forwardSpeed: -3 });
  assert.equal(r.gear, GEAR.FIRST);
  // Manual shifting: the throttle holds when the key is released.
  const m = createControlState();
  m.throttle = 0.5;
  applyKeyboard(m, { accelerate: false, brake: false, left: false, right: false }, { ...ctx, autoShift: false });
  assert.equal(m.throttle, 0.5);
  // In a drag race the brake only brakes until 4 segments are passed.
  const d = createControlState();
  applyKeyboard(d, { accelerate: false, brake: true, left: false, right: false }, { ...ctx, forwardSpeed: 0, dragMode: true, segments: 2 });
  assert.equal(d.gear, GEAR.FIRST);
});

test("keyboard steering: linear in the stick, shaped by the exponent, ±0.45 lock", () => {
  const c = createControlState();
  const ctx = { dt: 0.1, autoShift: true, forwardSpeed: 0, dragMode: false, segments: 0 };
  const dtp = 0.1 * KEY_DT_SCALE;
  applyKeyboard(c, { accelerate: false, brake: false, left: false, right: true }, ctx);
  near(c.steerExponent, 1.25);
  near(c.steer, 0.45 * Math.pow(dtp / 0.45, 1.25));
  near(c.rearSteer, -0.33 * c.steer);
  // The linear angle accumulates across frames even as the exponent changes.
  applyKeyboard(c, { accelerate: false, brake: false, left: false, right: true }, { ...ctx, forwardSpeed: 50 });
  near(c.steerExponent, 1.25 * 1.1);
  near(c.steer, 0.45 * Math.pow((2 * dtp) / 0.45, 1.375));
  for (let i = 0; i < 40; i++) applyKeyboard(c, { accelerate: false, brake: false, left: false, right: true }, ctx);
  near(c.steer, 0.45);
  // Released: back at 4 dt' per frame.
  applyKeyboard(c, { accelerate: false, brake: false, left: false, right: false }, ctx);
  near(c.steer, 0.45 * Math.pow((0.45 - 4 * dtp) / 0.45, 1.25));
  near(rearSteer(0.4, true), -0.33 * 0.4 * 1.25);
});

test("a new truck state", () => {
  const s = createTruckState([100, 50, 200], 1.5);
  assert.deepEqual([...s.pos], [100, 50, 200]);
  assert.equal(s.euler[2], 1.5);
  assert.equal(s.controls.gear, GEAR.FIRST);
  assert.equal(s.rpm, 800);
  assert.deepEqual(structuredClone(s).pos, s.pos);
});

test("joystick: dead zone, 1.11 gain, power curve and Rookie scale on steering", () => {
  const ctx = { dt: 1 / 60, autoShift: true, forwardSpeed: 0, dragMode: false, segments: 0 };
  const c = createControlState();
  applyJoystick(c, { x: 0.5, y: 0 }, ctx);
  // e = 3 at low speed with the default response.
  assert.ok(Math.abs(c.steer - 0.45 * Math.pow(0.555, 3)) < 1e-12);
  assert.ok(Math.abs(c.rearSteer - c.steer * -0.33) < 1e-12);
  applyJoystick(c, { x: -0.95, y: 0 }, ctx);
  assert.equal(c.steer, -0.45);
  applyJoystick(c, { x: 0.05, y: 0, deadZone: 0.1 }, ctx);
  assert.equal(c.steer, 0);
  applyJoystick(c, { x: 0.55, y: 0, deadZone: 0.1 }, ctx);
  assert.ok(Math.abs(c.steer - 0.45 * Math.pow(0.5 * 1.11, 3)) < 1e-12);
  applyJoystick(c, { x: 0.5, y: 0 }, { ...ctx, difficulty: 0 });
  assert.ok(Math.abs(c.steer - 0.45 * Math.pow(0.375 * 1.11, 3)) < 1e-12);
  applyJoystick(c, { x: 0.5, y: 0 }, { ...ctx, forwardSpeed: 60 });
  assert.ok(Math.abs(c.steer - 0.45 * Math.pow(0.555, 3.3)) < 1e-12);
});

test("joystick pedals: throttle forward, brake back, Reverse when stopped, first again", () => {
  const ctx = { dt: 1 / 60, autoShift: true, forwardSpeed: 10, dragMode: false, segments: 0 };
  const c = createControlState(GEAR.FIRST);
  applyJoystick(c, { x: 0, y: -0.7 }, ctx);
  assert.equal(c.throttle, 0.7); assert.equal(c.brakeFront, 0);
  applyJoystick(c, { x: 0, y: 0.6 }, ctx);
  assert.equal(c.throttle, 0); assert.equal(c.brakeFront, 0.6); assert.equal(c.brakeRear, 0.6);
  assert.equal(c.gear, GEAR.FIRST);
  applyJoystick(c, { x: 0, y: 0.6 }, { ...ctx, forwardSpeed: 0 });
  assert.equal(c.gear, GEAR.REVERSE); assert.equal(c.throttle, 0.6); assert.equal(c.brakeFront, 0);
  applyJoystick(c, { x: 0, y: 0.2 }, { ...ctx, forwardSpeed: -5 });
  assert.equal(c.throttle, 0); assert.equal(c.brakeFront, 0.2);
  applyJoystick(c, { x: 0, y: -0.3 }, { ...ctx, forwardSpeed: -5 });
  assert.equal(c.gear, GEAR.FIRST); assert.equal(c.throttle, 0.3);
  // In a drag race the gear stays until three segments are passed.
  const d = createControlState(GEAR.FIRST);
  applyJoystick(d, { x: 0, y: 0.8 }, { ...ctx, forwardSpeed: 0, dragMode: true });
  assert.equal(d.gear, GEAR.FIRST); assert.equal(d.brakeFront, 0.8);
});
