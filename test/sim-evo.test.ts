/*
  The 4x4 Evolution vehicle model (src/sim/evo; OpenMTM2 docs/EVO2_PHYSICS.md): the rules and
  tables, the driveline pieces, and invariants of the step on synthetic ground. The vehicle is a
  made-up one written as a .TRK, not a stock manifest.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { evoSim as E, mtm2Sim as S, parseEvoTrk } from "../src/index.ts";
import { latin1 } from "./fixtures/build.ts";

const TRK = latin1([
  "version", "7", "truckName", "Test SUV",
  "faxle.rtire.static_bpos", "+2.5,-0.7,+5.0", "faxle.ltire.static_bpos", "-2.5,-0.7,+5.0",
  "raxle.rtire.static_bpos", "+2.5,-0.7,-4.0", "raxle.ltire.static_bpos", "-2.5,-0.7,-4.0",
  "faxle.rtire.spring_arm", "5", "faxle.rtire.CF", "1.75", "faxle.ltire.CF", "1.75", "raxle.rtire.CF", "1.75", "raxle.ltire.CF", "1.75",
  "faxle.maxangle", "0.5", "raxle.maxangle", "0.5", "faxle.maxcompr", "1.25", "raxle.maxcompr", "1.25",
  "faxle.spring_rate", "1400", "raxle.spring_rate", "800", "faxle.torque_pct", "0.4", "raxle.torque_pct", "0.6",
  "faxle.slipDiffType", "1", "raxle.slipDiffType", "2", "xm.maxGear", "7",
  "xm.gear_ratio[]", "0", "-2.3", "0", "3.0", "1.6", "1.0", "0.7",
  "xm.gearInertia[]", "0", "1.3", "0", "1.1", "0.9", "0.7", "0.5",
  "xm.final_drive", "3.7", "xm.axle_ratio", "1", "xm.xfrLowRatio", "2.7",
  "eng.redline", "5600", "eng.torqueTableCount", "13", "eng.torqueTable[]", "190", "200", "210", "220", "230", "250", "245", "245", "240", "220", "200", "180", "150",
  "eng.upshift_rpm", "4500", "eng.dnshift_rpm", "2000", "dry_weight", "3000", "ixx,iyy,izz", "2500,2500,3750",
  "refArea", "130,165,60", "CL", "0.1", "CD", "0.4", "CY", "5", "drive_type", "1", "max_brake_force_pct", "1",
  "clp,cmq,cnr", "-0.2,-0.2,-0.4",
  "sc[].pt", "-3,0.5,7", "3,0.5,7", "-3,2,7", "3,2,7", "-1.3,5,1.7", "1.3,5,1.7", "-1.6,5,-0.9", "1.6,5,-0.9",
  "-3,3.5,-7", "3,3.5,-7", "-3,0.5,-7", "3,0.5,-7",
  "signature: 0 0",
].join("\r\n"));

const spec = () => E.evoSpecFromTrk(parseEvoTrk(TRK, "TEST.TRK"));

function world() {
  const terrain = S.createTerrain(new Uint8Array(65536).fill(50));
  return S.createTerrainGround(terrain, null, 0, null);
}

function vehicle(rules: E.EvoRules, pos: [number, number, number], gear = S.GEAR.FIRST) {
  const ground = world();
  ground.rules = rules;
  const params = E.createEvoParams(spec(), rules, { tireRadiusFt: 1.4, tireWidthFt: 1 });
  const state = E.createEvoTruckState(pos, 0, gear, params);
  const ctx = { ground, human: true, difficulty: 1, sonicTrack: false };
  const keys = { accelerate: false, brake: false, left: false, right: false };
  const run = (seconds: number, held: Partial<typeof keys> = {}, dt = 1 / 60) => {
    for (let i = 0; i < Math.round(seconds / dt); i++) {
      S.applyKeyboard(state.controls, { ...keys, ...held }, { dt, autoShift: true, forwardSpeed: state.bvel[2], dragMode: false, segments: 0 });
      E.stepEvoTruck(state, params, ctx, dt);
      S.postStepTruck(state, params, ground, dt);
    }
  };
  return { params, state, run };
}

test("the two rule sets: the four switches that differ, by name", () => {
  assert.equal(E.evoRules("evo1"), E.EVO1_RULES);
  assert.equal(E.evoRules("evo2"), E.EVO2_RULES);
  assert.deepEqual(
    [E.EVO1_RULES.airborneG, E.EVO1_RULES.defaultCgZ, E.EVO1_RULES.steerRearGripCut, E.EVO1_RULES.hullFrictionFactor],
    [32.174, 0, false, 0.5]);
  assert.deepEqual(
    [E.EVO2_RULES.airborneG, E.EVO2_RULES.defaultCgZ, E.EVO2_RULES.steerRearGripCut, E.EVO2_RULES.hullFrictionFactor],
    [56.3045, 2, true, 1.5]);
  // The world rules the shared code reads are MTM2's.
  assert.equal(E.EVO2_RULES.waterDragDensity, S.MTM2_RULES.waterDragDensity);
  assert.equal(E.isEvoRules("evo1"), true);
  assert.equal(E.isEvoRules("mtm2"), false);
});

test("surfaces: Evo's mu and the tread table", () => {
  assert.deepEqual([3, 4, 8, 9, 13, 14, 99].map(E.evoSurfaceMu), [0.5, 0.5, 0.3, 0.5, 0.5, 1.0, 1.0]);
  assert.equal(E.evoTreadFactor(1, E.EVO_TREAD.SHALLOW), 1.0);
  assert.equal(E.evoTreadFactor(8, E.EVO_TREAD.STUDDED), 1.0);
  assert.equal(E.evoTreadFactor(8, E.EVO_TREAD.SHALLOW), 0.6);
  assert.equal(E.evoTreadFactor(10, E.EVO_TREAD.STUDDED), 0.6);
  assert.equal(E.evoTreadFactor(14, 2), 1.0);
});

test("a .TRK's gear i is gear i + 1: Park, Reverse, Neutral, then first", () => {
  const s = spec();
  assert.equal(E.evoGearRatio(s, S.GEAR.PARK), 0);
  assert.equal(E.evoGearRatio(s, S.GEAR.REVERSE), -2.3);
  assert.equal(E.evoGearRatio(s, S.GEAR.NEUTRAL), 0);
  assert.equal(E.evoGearRatio(s, S.GEAR.FIRST), 3.0);
  assert.equal(E.evoGearRatio(s, 7), 0.7);
  assert.equal(E.evoGearRatio(s, 8), 0);
});

test("torque table: an entry every 500 rpm, linear between", () => {
  assert.equal(E.evoTorqueAt([200, 250, 220], 0), 200);
  assert.equal(E.evoTorqueAt([200, 250, 220], 250), 225);
  assert.equal(E.evoTorqueAt([200, 250, 220], 750), 235);
  // Past the last entry, the last entry.
  assert.equal(E.evoTorqueAt([200, 250, 220], 4000), 220);
});

test("drivetrain inertia", () => {
  const s = spec();
  const fr = 3.7;
  const ratio = 3.0 * 0.8 * fr;
  assert.ok(Math.abs(E.evoDriveInertia(s, S.GEAR.FIRST, fr) - ((1.1 + 0.8) * ratio * ratio + 1.2 * fr * fr + 11)) < 1e-9);
});

test("gearbox: up at the upshift rpm past the shift speed, down under the downshift rpm; Park holds the brakes", () => {
  const s = spec();
  const box = { gear: S.GEAR.FIRST, shiftRequest: 0, brakeFront: 0, brakeRear: 0 };
  // 4,600 rpm in first on 1.4 ft tires: 41 mph at the wheels.
  E.stepEvoGearbox(box, s, 4600, 30, 3.7, 1.4, true);
  assert.equal(box.gear, S.GEAR.FIRST, "the speed is not yet past the upshift speed");
  E.stepEvoGearbox(box, s, 4600, 62, 3.7, 1.4, true);
  assert.equal(box.gear, S.GEAR.FIRST + 1);
  E.stepEvoGearbox(box, s, 1500, 5, 3.7, 1.4, true);
  assert.equal(box.gear, S.GEAR.FIRST);
  // The automatic does not go below first.
  E.stepEvoGearbox(box, s, 1000, 0, 3.7, 1.4, true);
  assert.equal(box.gear, S.GEAR.FIRST);
  const manual = { gear: S.GEAR.NEUTRAL, shiftRequest: -1, brakeFront: 0, brakeRear: 0 };
  E.stepEvoGearbox(manual, s, 1000, 0, 3.7, 1.4, false);
  assert.equal(manual.gear, S.GEAR.REVERSE);
  manual.shiftRequest = -1;
  E.stepEvoGearbox(manual, s, 1000, 0, 3.7, 1.4, false);
  assert.equal(manual.gear, S.GEAR.PARK);
  assert.deepEqual([manual.brakeFront, manual.brakeRear], [1, 1]);
});

test("wheelspin: decays within the threshold, grows past it, capped at 100", () => {
  assert.equal(E.evoStepSlip(0, 10, 0, 1.75, 1000, true, 90, 1 / 60), 0);
  const grown = E.evoStepSlip(0, 100000, 0, 1.75, 1000, true, 90, 1 / 60);
  assert.ok(grown > 1);
  assert.equal(E.evoStepSlip(99, 1e9, 0, 1.75, 1000, true, 1, 1), 100);
});

test("differentials: open, force sensing, slip sensing", () => {
  const sh = [0.5, 0.5];
  E.evoDifferential(0, sh, 100, 300, 0, 0);
  assert.deepEqual(sh, [0.5, 0.5]);
  E.evoDifferential(1, sh, 300, 100, 0, 0);
  assert.deepEqual(sh, [0, 1]);
  E.evoDifferential(1, sh, -1, 100, 0, 0);
  assert.deepEqual(sh, [0.5, 0.5]);
  E.evoDifferential(2, sh, 0, 0, 20, 10);
  assert.ok(Math.abs(sh[0] - (0.5 - 10 / 30)) < 1e-12 && Math.abs(sh[0] + sh[1] - 1) < 1e-12);
  E.evoDifferential(2, sh, 0, 0, 10, 12);
  assert.deepEqual(sh, [0.5, 0.5]);
});

test("centre split: torque_pct, or drive type 2 moving 0.1 a step to the axle that slips less", () => {
  const s = { ...spec(), driveType: 2 };
  const off = [0, 0], split = [0.4, 0.6];
  E.evoCentreSplit(s, off, split, [10, 10, 0, 0]);
  assert.ok(Math.abs(split[0] - 0.3) < 1e-12 && Math.abs(split[1] - 0.7) < 1e-12);
  E.evoCentreSplit({ ...s, driveType: 1 }, off, split, [10, 10, 0, 0]);
  assert.deepEqual(split, [0.4, 0.6]);
});

test("Evo 2 pulls an airborne vehicle down at 1.75 g, Evo 1 at 1 g", () => {
  for (const [rules, g] of [[E.EVO1_RULES, 32.174], [E.EVO2_RULES, 56.3045]] as const) {
    const { state, run } = vehicle(rules, [4000, 400, 4000]);
    run(0.5);
    assert.ok(Math.abs(state.bvel[1] + g * 0.5) < 0.5, `${rules.id}: ${state.bvel[1]}`);
  }
});

test("Evo 2's default CG is 2 ft forward of Evo 1's; a translated truck keeps MTM2's", () => {
  assert.equal(E.createEvoParams(spec(), E.EVO1_RULES).cgOffset[2], 0);
  assert.equal(E.createEvoParams(spec(), E.EVO2_RULES).cgOffset[2], 2);
  assert.deepEqual(E.createEvoParams(E.evoSpecFromMtm2(), E.EVO2_RULES).cgOffset, [0, -3, 0]);
});

test("a dropped vehicle lands, comes to rest and stays finite", () => {
  for (const rules of [E.EVO1_RULES, E.EVO2_RULES]) {
    const { state, run } = vehicle(rules, [4000, 104, 4000]);
    run(6);
    assert.ok([...state.pos, ...state.bvel, ...state.rates, state.rpm].every(Number.isFinite));
    assert.ok(state.tires.every((t) => t.onGround), rules.id);
    assert.ok(Math.hypot(state.bvel[0], state.bvel[1], state.bvel[2]) < 0.5, `${rules.id} ${Array.from(state.bvel)}`);
  }
});

test("with the throttle held it drives forward and shifts up", () => {
  const { state, run } = vehicle(E.EVO2_RULES, [4000, 104, 4000]);
  run(2);
  run(10, { accelerate: true });
  assert.ok(state.bvel[2] > 20, `${state.bvel[2]}`);
  assert.ok(state.pos[2] > 4050);
  assert.ok(state.controls.gear > S.GEAR.FIRST);
  assert.ok(Math.abs(state.pos[0] - 4000) < 20, "straight ahead");
});

test("an MTM truck translated to the Evo model keeps MTM2's figures", () => {
  const s = E.evoSpecFromMtm2();
  assert.equal(s.dryWeightLb + s.axleWeightLb[0] + s.axleWeightLb[1], 10000);
  assert.deepEqual(s.inertia, [5000, 5000, 7500]);
  assert.equal(E.evoGearRatio(s, S.GEAR.FIRST), 40.467);
  assert.equal(E.evoGearRatio(s, S.GEAR.REVERSE), -60);
  assert.equal(s.maxGear, 6);
  assert.equal(s.redline, 8500);
  assert.ok(Math.abs(E.evoTorqueAt(s.torqueTable, 4000) - 1700 * ((-2.367e-8 * 4000 + 9.467e-5) * 4000 + 0.905)) < 1e-6);
  assert.equal(s.rearSteer, true);
});
