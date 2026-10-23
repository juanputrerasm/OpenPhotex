/*
  CART Precision Racing's setups and car model (OpenMTM2 docs/CPR_PHYSICS.md 14.1, 16.2).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { CPR_DEFAULT_SETUP, cloneCprSetup, cprSim as C, mtm2Sim as S, parseCprGarage, writeCprGarage } from "../src/index.ts";

type T3 = [number, number, number];
const near = (a: number, b: number, eps: number, what = "") => assert.ok(Math.abs(a - b) <= eps, `${what} ${a} != ${b}`);

test("a .gar setup reads and writes back: labels, corner rows, pit stops and mirrors (0x4ab7f0)", () => {
  const setup = cloneCprSetup();
  setup.springRate = [16800, 16800, 9600, 9600];
  setup.wingAngle = [23, 12];
  setup.pitStops = [{ lapMin: 26, lapMax: 29, fuel: 35, type: 0 }];
  const text = writeCprGarage(setup);
  assert.ok(text.startsWith("tireCompound\r\n0,0,0,0\r\ntirePressure\r\n26.000000,26.000000,22.000000,22.000000\r\n"));
  assert.ok(text.includes("wingType\r\n3,3\r\nwingAngle\r\n23.000000,12.000000\r\n"));
  assert.ok(text.includes("pitStopCount\r\n1\r\npitLapMin,pitLapMax,pitFuelAmount,pitStopType\r\n26,29,35.000000,0\r\n"));
  assert.deepEqual(parseCprGarage(text), setup);
  assert.equal(parseCprGarage("nothing here\n"), null);
  const partial = parseCprGarage("fuelAmount\n12.5\n")!;
  assert.equal(partial.fuelAmount, 12.5);
  assert.deepEqual(partial.gearRatio, CPR_DEFAULT_SETUP.gearRatio, "what a file lacks stays stock");
});

test("the stock car and setup: the constructor's figures (0x4b2b00)", () => {
  assert.deepEqual(CPR_DEFAULT_SETUP.gearRatio, [19, 12.4, 9.3, 7.6, 6.4, 5.5]);
  near(CPR_DEFAULT_SETUP.springRate[0], 14723.37, 0.01);
  near(CPR_DEFAULT_SETUP.springRate[2], 20870.38, 0.01);
  assert.deepEqual(CPR_DEFAULT_SETUP.wingAngle, [12, 15]);
  const spec = C.cprSpec(anchors(), scrape());
  near(spec.weightLb, 1911.25, 1e-9, "1,675 lb and 35 gallons");
  assert.deepEqual(spec.inertia, [200, 400, 400]);
});

test("the tables: mu by load, the force curve, dampers and the draft (CPR_PHYSICS.md 6, 7)", () => {
  near(C.cprMu(0, true), 2.3 * 1.1875, 1e-9);
  near(C.cprMu(1200, true), 1.3 * 1.1875, 1e-9);
  near(C.cprMu(5000, true), 1.22 * 1.1875, 1e-9, "held at the last entry");
  near(C.cprMu(1900, false), 1.4 * 1.1875, 1e-9);
  near(C.cprForceFactor(0), 0, 1e-12);
  near(C.cprForceFactor(0.25), 0.245, 1e-9);
  near(C.cprForceFactor(2.75), 1, 1e-9);
  near(C.cprForceFactor(6), 0.941, 1e-9);
  assert.ok(C.cprForceFactor(100) >= 0.82);
  // The slow line rules at speed, the fast slope near zero.
  near(C.cprDamperForce(1, 3, 3), Math.min(60 + 13.33 * 3 + 175, (700 + 0.5 * ((60 + 13.33 * 3 + 30) * 2.39981 - 700))), 1e-6);
  near(C.cprDraft(0, 0), 0.4, 1e-12, "right behind: 40% less drag");
  near(C.cprDraft(1, 0), 1, 1e-12);
  near(C.cprDraft(0, 1), 1, 1e-12);
  assert.equal(C.cprSurfaceGrip(6), 0.6, "grass");
  assert.equal(C.cprCompoundGrip(4, true), 0.9, "the rain tire in the rain");
});

function anchors(): T3[] {
  return [[2.87, -0.33, 5], [-2.87, -0.33, 5], [2.64, -0.33, -5], [-2.64, -0.33, -5]];
}
function scrape(): T3[] {
  const out: T3[] = [];
  for (const z of [8, -8]) for (const x of [-3.17, 3.17]) for (const y of [0, 2.3, 4.3]) out.push([x, y, z]);
  return out;
}

function flatCar(setup = cloneCprSetup(), aids: Partial<C.CprAids> | undefined = undefined) {
  const terrain = S.createTerrain(new Uint8Array(65536).fill(50));
  const ground = S.createTerrainGround(terrain, null, 0, null);
  const params = C.createCprParams(C.cprSpec(anchors(), scrape(), setup), { radiusFt: 1.15, widthFt: 1.2 }, { aids });
  const state = C.createCprTruckState([2000, 101.5, 2000], 0, S.GEAR.FIRST, params);
  const ctx = { ground, human: true, difficulty: S.DIFFICULTY.INTERMEDIATE, sonicTrack: false };
  const step = (dt = 1 / 60) => {
    C.stepCprTruck(state, params, ctx, dt);
    S.postStepTruck(state, params, ground, dt);
  };
  return { state, params, step };
}

test("a car on level ground settles on its springs, then accelerates through the gears to racing speeds", () => {
  const car = flatCar();
  for (let i = 0; i < 180; i++) car.step();
  assert.ok(Math.abs(car.state.bvel[1]) < 0.5, `settled: ${car.state.bvel[1]} ft/s up`);
  car.state.controls.throttle = 1;
  let t = 0;
  let at100: number | null = null;
  for (; t < 20; t += 1 / 60) {
    car.state.controls.throttle = 1;
    car.step();
    if (at100 === null && car.state.bvel[2] * 0.681818 >= 100) at100 = t;
    for (const v of car.state.pos) assert.ok(Number.isFinite(v));
  }
  const mph = car.state.bvel[2] * 0.681818;
  assert.ok(at100 !== null && at100 < 8, `0 to 100 mph in ${at100?.toFixed(1)} s`);
  assert.ok(mph > 150 && mph < 240, `${mph.toFixed(0)} mph after 20 s`);
  assert.ok(car.state.controls.gear >= S.GEAR.FIRST + 4, `in gear ${car.state.controls.gear - S.GEAR.FIRST + 1}`);
  assert.ok(car.state.cpr.downforce > 1500, `${car.state.cpr.downforce.toFixed(0)} lb of downforce`);
});

test("more wing is more downforce and more drag", () => {
  const low = C.cprAero({ ...cloneCprSetup(), wingAngle: [4, 6] });
  const high = C.cprAero({ ...cloneCprSetup(), wingAngle: [20, 25] });
  assert.ok(high.cl > low.cl && high.cd > low.cd);
});

test("a car steered at speed turns, and stays on its wheels", () => {
  const car = flatCar();
  for (let i = 0; i < 120; i++) car.step();
  car.state.bvel[2] = 120;
  for (let i = 0; i < 180; i++) {
    car.state.controls.throttle = 0.6;
    car.state.controls.steer = 0.06;
    car.step();
  }
  const heading = car.state.euler[2];
  assert.ok(Math.abs(heading) > 0.3, `turned ${heading.toFixed(2)} rad`);
  assert.ok(car.state.matrix[4] > 0.9, "upright");
  assert.ok(car.state.bvel[2] > 60, `${car.state.bvel[2].toFixed(0)} ft/s`);
});

test("a car in gear with the throttle shut stays where it stands: the engine's friction only holds it back", () => {
  const car = flatCar();
  for (let i = 0; i < 600; i++) car.step();
  assert.ok(Math.hypot(car.state.bvel[0], car.state.bvel[2]) < 0.1, `rolling at ${car.state.bvel[2]} ft/s`);
  const front = car.state.tires[0].compression * car.params.cpr.wheelRate[0], rear = car.state.tires[2].compression * car.params.cpr.wheelRate[2];
  const share = front / (front + rear);
  assert.ok(share > 0.4 && share < 0.5, `front share ${share}`);
});

test("the aids (CPR_PHYSICS.md 14.3): ABS holds a braked wheel to 20% slip, the skill grip scales mu, computer cars brake with ABS", () => {
  const brakeFrom = (aids: Partial<C.CprAids>) => {
    const car = flatCar(cloneCprSetup(), aids);
    for (let i = 0; i < 120; i++) car.step();
    car.state.bvel[2] = 150;
    let worst = 0;
    for (let i = 0; i < 60; i++) {
      car.state.controls.throttle = 0;
      car.state.controls.brakeFront = car.state.controls.brakeRear = 1;
      car.step();
      if (car.state.bvel[2] > 20) worst = Math.min(worst, ...car.state.cpr.slipRatio);
    }
    return worst;
  };
  const locked = brakeFrom({ abs: false }), held = brakeFrom({ abs: true });
  assert.ok(held >= -C.CPR_ABS_SLIP - 1e-9, `ABS slip ${held}`);
  assert.ok(locked < held, `without ABS ${locked}, with ${held}`);
  const cpu = C.createCprParams(C.cprSpec(anchors(), scrape()), {}, { cpu: true });
  assert.equal(cpu.cpr.aids.abs, true);
  const car = flatCar(cloneCprSetup(), { gripScale: 0.8 });
  for (let i = 0; i < 120; i++) car.step();
  const rookie = flatCar();
  for (let i = 0; i < 120; i++) rookie.step();
  near(car.state.tires[0].mu / rookie.state.tires[0].mu, 0.8, 1e-3, "x0.8 above Rookie");
});

test("traction control: a full-throttle launch keeps the rear slip near 15%", () => {
  const launch = (tractionControl: boolean) => {
    const car = flatCar(cloneCprSetup(), { tractionControl });
    for (let i = 0; i < 120; i++) car.step();
    let worst = 0;
    for (let i = 0; i < 120; i++) {
      car.state.controls.throttle = 1;
      car.step();
      worst = Math.max(worst, car.state.cpr.slipRatio[2], car.state.cpr.slipRatio[3]);
    }
    return worst;
  };
  const off = launch(false), on = launch(true);
  assert.ok(on <= off, `with TC ${on}, without ${off}`);
  assert.ok(on < C.CPR_TC_SLIP + 0.12, `with TC ${on}`);
});
