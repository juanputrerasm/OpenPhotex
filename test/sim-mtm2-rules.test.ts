// The rules that differ in Monster Truck Madness 1 (constants.ts `Mtm2Rules`; OpenMTM2
// docs/MTM1_MONSTER_EXE_ANALYSIS.md 4.3). MTM2's are the default everywhere and must not move.

import test from "node:test";
import assert from "node:assert/strict";
import { mtm2Sim as S } from "../src/index.ts";

type T3 = [number, number, number];
const TRK_HULL: T3[] = [
  [-3.67, 0, 9.2], [3.67, 0, 9.2], [-3.67, 2.56, 9.2], [3.67, 2.56, 9.2],
  [-2.61, 5.23, 1.89], [2.61, 5.23, 1.89], [-2.14, 5.23, -0.8], [2.1, 5.23, -0.8],
  [-3.67, 2.82, -9.2], [3.67, 2.82, -9.2], [-3.67, 0, -9.2], [3.67, 0, -9.2],
];

test("the two rule sets, by name; an unknown name is MTM2's", () => {
  assert.equal(S.simRules("mtm1"), S.MTM1_RULES);
  assert.equal(S.simRules("mtm2"), S.MTM2_RULES);
  assert.equal(S.simRules(undefined), S.MTM2_RULES);
  assert.equal(S.simRules("else"), S.MTM2_RULES);
  assert.deepEqual({ ...S.MTM2_RULES }, {
    id: "mtm2", waterDragDensity: 0.15, deepWater: true, weatherGrip: true, crashDamage: true,
    wheelImpact: "half", wheelSpinClimb: 0.05, wheelSpinNeedsGround: true,
  });
  assert.deepEqual({ ...S.MTM1_RULES }, {
    id: "mtm1", waterDragDensity: 1, deepWater: false, weatherGrip: false, crashDamage: false,
    wheelImpact: "smaller", wheelSpinClimb: 0.1, wheelSpinNeedsGround: false,
  });
});

test("water: MTM1 has no deep water below the level, and its water drags at density 1", () => {
  const terrain = S.createTerrain(new Uint8Array(65536).fill(5)); // 10 ft
  const map = S.createSurfaceMap(new Uint16Array(65536).fill(1), new Int32Array([100, 712, 300]));
  assert.equal(S.createTerrainGround(terrain, map, 0, 12).surface(1, 0, 1), 1300);
  assert.equal(S.createTerrainGround(terrain, map, 0, 12, S.MTM2_RULES).surface(1, 0, 1), 1300);
  assert.equal(S.createTerrainGround(terrain, map, 0, 12, S.MTM1_RULES).surface(1, 0, 1), 712);
  // Snow freezes nothing either: there is no weather.
  assert.equal(S.createTerrainGround(terrain, map, S.WEATHER.SNOW, 12, S.MTM1_RULES).surface(1, 0, 1), 712);
  assert.equal(S.surfaceDragDensity(3), 0.15);
  assert.equal(S.surfaceDragDensity(3, S.MTM1_RULES.waterDragDensity), 1);
  assert.equal(S.surfaceDragDensity(2, S.MTM1_RULES.waterDragDensity), S.AIR_DENSITY);
});

test("weather: Rain and Snow cut the grip under MTM2's rules only", () => {
  const terrain = S.createTerrain(new Uint8Array(65536).fill(5));
  const grip = (weather: number, rules?: S.Mtm2Rules) => S.groundWeatherGrip(S.createTerrainGround(terrain, null, weather, null, rules));
  assert.equal(grip(S.WEATHER.RAIN), 0.8);
  assert.equal(grip(S.WEATHER.SNOW), 0.6);
  assert.equal(grip(S.WEATHER.RAIN, S.MTM1_RULES), 1);
  assert.equal(grip(S.WEATHER.SNOW, S.MTM1_RULES), 1);
  // A ground a host built without rules is MTM2's.
  assert.equal(S.groundWeatherGrip({ weather: S.WEATHER.RAIN } as S.Mtm2Ground), 0.8);
});

test("a tire against a tire, the velocity the force is made from", () => {
  const v = (vA: T3, vB: T3, rules: S.Mtm2Rules) => S.impactVelocity(vA, vB, [vB[0] - vA[0], vB[1] - vA[1], vB[2] - vA[2]], rules);
  // MTM2: half the relative velocity.
  assert.deepEqual(v([0, 0, 0], [-10, 0, 4], S.MTM2_RULES), [-5, 0, 2]);
  // MTM1, a mover against a standing truck: the whole of it, twice MTM2's.
  assert.deepEqual(v([0, 0, 0], [-10, 0, 4], S.MTM1_RULES), [-10, 0, 4]);
  // Head-on at equal speeds the relative velocity is the larger, so one truck's own is taken: as MTM2.
  assert.deepEqual(v([10, 0, 0], [-10, 0, 0], S.MTM1_RULES), [-10, 0, 0]);
  assert.deepEqual(v([10, 0, 0], [-10, 0, 0], S.MTM2_RULES), [-10, 0, 0]);
  // Side by side at nearly the same speed: the small difference, not the trucks' speed.
  assert.deepEqual(v([0, 0, 50], [0, 0, 52], S.MTM1_RULES), [0, 0, 2]);
  // Each axis on its own; the faster point is A here.
  assert.deepEqual(v([8, 0, -3], [2, 0, 1], S.MTM1_RULES), [-6, 0, -3]);
});

test("wheels against wheels: a truck sliding into a standing one's tires is hit twice as hard in MTM1", () => {
  const terrain = S.createTerrain(new Uint8Array(65536).fill(50));
  const ground = S.createTerrainGround(terrain, null, 0, null);
  const ctx = { ground, human: false, difficulty: S.DIFFICULTY.INTERMEDIATE, sonicTrack: false };
  const dt = 1 / 60;
  const hit = (rules?: S.Mtm2Rules) => {
    const make = (x: number) => {
      const p = S.createTruckParams({ scrapePoints: TRK_HULL }, { difficulty: S.DIFFICULTY.INTERMEDIATE });
      return { s: S.createTruckState([x, 106.2, 1000], 0, S.GEAR.NEUTRAL, p), p };
    };
    const a = make(1000), b = make(1100);
    for (let i = 0; i < 90; i++) for (const t of [a, b]) { S.stepTruck(t.s, t.p, ctx, dt); S.postStepTruck(t.s, t.p, ground, dt); }
    for (const t of [a, b]) { t.s.bvel.fill(0); t.s.rates.fill(0); t.s.extForce.fill(0); t.s.extMoment.fill(0); }
    b.s.pos[0] = a.s.pos[0] + 9;
    b.s.bvel[0] = -5;
    const met = rules ? S.collideTrucks(a, b, dt, rules) : S.collideTrucks(a, b, dt);
    // Side by side the tires overlap and the hulls do not: the host is told so.
    assert.deepEqual(met, { hull: false, wheels: true });
    return { a: a.s.extForce[0], b: b.s.extForce[0] };
  };
  const mtm2 = hit(), same = hit(S.MTM2_RULES), mtm1 = hit(S.MTM1_RULES);
  assert.deepEqual(same, mtm2, "MTM2's rules are the default");
  assert.ok(mtm2.a < 0 && mtm2.b > 0);
  assert.ok(Math.abs(mtm1.a / mtm2.a - 2) < 1e-6, `MTM1 ${mtm1.a} against MTM2 ${mtm2.a}`);
  assert.ok(Math.abs(mtm1.b / mtm2.b - 2) < 1e-6);
});

test("tire size: MTM's 3 ft by 4 ft unless another game's vehicle gives its own", () => {
  const stock = S.createTruckParams({});
  assert.deepEqual([stock.tireRadiusFt, stock.tireWidthFt], [3, 4]);
  const car = S.createTruckParams({ tireRadiusFt: 1.1, tireWidthFt: 1.2 });
  assert.deepEqual([car.tireRadiusFt, car.tireWidthFt], [1.1, 1.2]);
  assert.equal(S.createTruckParams({ tireRadiusFt: 0, tireWidthFt: null }).tireRadiusFt, 3);
  // A truck on small tires rests lower: its body sits nearer the ground.
  const terrain = S.createTerrain(new Uint8Array(65536).fill(50));
  const ground = S.createTerrainGround(terrain, null, 0, null);
  const rest = (p: S.Mtm2TruckParams) => {
    const s = S.createTruckState([1000, 108, 1000], 0, S.GEAR.NEUTRAL, p);
    const ctx = { ground, human: false, difficulty: S.DIFFICULTY.INTERMEDIATE, sonicTrack: false };
    for (let i = 0; i < 240; i++) { S.stepTruck(s, p, ctx, 1 / 60); S.postStepTruck(s, p, ground, 1 / 60); }
    return s.pos[1];
  };
  const hi = rest(stock), lo = rest(car);
  assert.ok(Number.isFinite(lo) && lo < hi - 1, `small tires rest at ${lo}, MTM's at ${hi}`);
});

// Optional handling (constants.ts `Mtm2Rules`: airPitchControl, airRotationDamping, groundYawDamping), which neither
// game has: left out, or at its neutral value, the step is the game's to the bit.
const handling = (rules: S.Mtm2Rules, pos: T3, setup: (s: S.Mtm2TruckState) => void, steps: number, settle = 0) => {
  const terrain = S.createTerrain(new Uint8Array(65536).fill(50)); // 100 ft
  const ground = S.createTerrainGround(terrain, null, 0, null, rules);
  const p = S.createTruckParams();
  const s = S.createTruckState(pos, 0, S.GEAR.FIRST, p);
  const ctx = { ground, human: true, difficulty: S.DIFFICULTY.INTERMEDIATE, sonicTrack: false };
  // Settled on its wheels first, when asked (still, so no setting changes the fall).
  for (let i = 0; i < settle; i++) { S.stepTruck(s, p, ctx, 1 / 60); S.postStepTruck(s, p, ground, 1 / 60); }
  setup(s);
  for (let i = 0; i < steps; i++) { S.stepTruck(s, p, ctx, 1 / 60); S.postStepTruck(s, p, ground, 1 / 60); }
  return s;
};
const ALOFT: T3 = [1000, 400, 1000];

test("optional handling: neutral values are the game's handling, to the bit", () => {
  const spin = (s: S.Mtm2TruckState) => { s.rates.set([0.5, 2, 1]); s.bvel.set([0, 0, 40]); s.controls.throttle = 1; };
  const neutral = { ...S.MTM2_RULES, airPitchControl: 0, airRotationDamping: 1, groundYawDamping: 1 };
  for (const pos of [ALOFT, [1000, 106, 1000] as T3]) {
    const a = handling(S.MTM2_RULES, pos, spin, 90), b = handling(neutral, pos, spin, 90);
    assert.deepEqual([...b.rates, ...b.bvel, ...b.pos, ...b.euler], [...a.rates, ...a.bvel, ...a.pos, ...a.euler]);
  }
});

test("optional handling: less damping in the air keeps a spin going", () => {
  const pitch = (s: S.Mtm2TruckState) => { s.rates.set([0, 2, 0]); };
  const game = handling(S.MTM2_RULES, ALOFT, pitch, 30);
  const light = handling({ ...S.MTM2_RULES, airRotationDamping: 0.25 }, ALOFT, pitch, 30);
  // The game's damping (about 9,100 lb ft per rad/s on 5,000 slug ft²) halves the rate in about 0.4 s.
  assert.ok(game.rates[1] > 0.6 && game.rates[1] < 1.2, `${game.rates[1]}`);
  assert.ok(light.rates[1] > 1.5, `${light.rates[1]}`);
  // On the ground it is the game's.
  const grounded = (rules: S.Mtm2Rules) => handling(rules, [1000, 106, 1000], (s) => { s.rates.set([0, 0, 1]); s.bvel.set([0, 0, 30]); }, 60, 120);
  assert.deepEqual([...grounded({ ...S.MTM2_RULES, airRotationDamping: 0.25 }).rates], [...grounded(S.MTM2_RULES).rates]);
});

test("optional handling: in the air the throttle lifts the nose and the brakes drop it", () => {
  const pedal = (throttle: number, brake: number) => handling({ ...S.MTM2_RULES, airPitchControl: 4 }, ALOFT, (s) => {
    s.controls.throttle = throttle; s.controls.brakeFront = brake; s.controls.brakeRear = brake;
  }, 6);
  assert.ok(pedal(1, 0).rates[1] < -0.2, "nose up");
  assert.ok(pedal(0, 1).rates[1] > 0.2, "nose down");
  assert.equal(pedal(0, 0).rates[1], 0);
  // Without the rule the pedals do nothing to the body in the air.
  assert.equal(handling(S.MTM2_RULES, ALOFT, (s) => { s.controls.throttle = 1; }, 6).rates[1], 0);
});

test("optional handling: less yaw damping with the wheels down", () => {
  const turn = (rules: S.Mtm2Rules) => handling(rules, [1000, 106, 1000], (s) => { s.rates.set([0, 0, 1.5]); s.bvel.set([0, 0, 30]); }, 6, 120);
  assert.ok(Math.abs(turn({ ...S.MTM2_RULES, groundYawDamping: 0.5 }).rates[2]) > Math.abs(turn(S.MTM2_RULES).rates[2]));
  // In the air it is the air's damping that counts.
  const aloft = (rules: S.Mtm2Rules) => handling(rules, ALOFT, (s) => { s.rates.set([0, 0, 1.5]); }, 30);
  assert.equal(aloft({ ...S.MTM2_RULES, groundYawDamping: 0.5 }).rates[2], aloft(S.MTM2_RULES).rates[2]);
});
