/*
  Community Patch 4's rules on MTM2's step (OpenMTM2 docs/CP4_EXE_ANALYSIS.md 10; its author published no
  source code). Each test checks one rule read from the CP4 executable against MTM2's behaviour.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { cp4Sim as C, mtm2Sim as S } from "../src/index.ts";

type T3 = [number, number, number];

function scrapePoints(): T3[] {
  const out: T3[] = [];
  for (const z of [9.2, -9.2]) for (const x of [-3.67, 3.67]) for (const y of [0, 2.56, -1]) out.push([x, y, z]);
  return out;
}

function ground(rules: S.Mtm2Rules, heights = new Uint8Array(65536).fill(50)) {
  return S.createTerrainGround(S.createTerrain(heights), null, 0, null, rules);
}

function truck(g: S.Mtm2Ground, pos: T3, ctxExtra: Partial<S.StepContext> = {}) {
  const params = S.createTruckParams({ scrapePoints: scrapePoints() }, { difficulty: S.DIFFICULTY.INTERMEDIATE });
  const state = S.createTruckState(pos, 0, S.GEAR.FIRST, params);
  const ctx: S.StepContext = { ground: g, human: true, difficulty: S.DIFFICULTY.INTERMEDIATE, sonicTrack: false, ...ctxExtra };
  const keys = { accelerate: false, brake: false, left: false, right: false };
  const step = (dt: number) => {
    S.applyKeyboard(state.controls, keys, { dt, autoShift: true, forwardSpeed: state.bvel[2], dragMode: false, segments: 0 });
    S.stepTruck(state, params, ctx, dt);
    S.postStepTruck(state, params, g, dt);
  };
  return { params, state, ctx, step };
}

test("the rule set: CP4's defaults, MTM2 underneath, and the classic-box variant", () => {
  assert.equal(C.CP4_RULES.id, "cp4");
  assert.equal(C.isCp4Rules("cp4"), true);
  assert.equal(C.isCp4Rules("mtm2"), false);
  // MTM2's own rules come through unchanged.
  for (const k of Object.keys(S.MTM2_RULES) as (keyof S.Mtm2Rules)[]) {
    if (k !== "id") assert.equal(C.CP4_RULES[k], S.MTM2_RULES[k], k);
  }
  assert.equal(C.CP4_RULES.tickS, 0xa3d / 65536);
  assert.equal(C.CP4_RULES.suspVelMaxFtPerSec, 20);
  assert.equal(C.CP4_RULES.terrainComprMaxFt, 6);
  assert.equal(C.CP4_RULES.aiGrip, 1.3);
  assert.equal(C.CP4_RULES.collisionMode, 1);
  assert.equal(C.cp4Rules("classic").collisionMode, 0);
  assert.equal(C.cp4Rules("triangles"), C.CP4_RULES);
  // The clamps stay with classic boxes (11.10).
  assert.equal(C.cp4Rules(0).terrainComprMaxFt, 6);
});

test("substeps: one 40 ms step offline, four of 10 ms online or when asked", () => {
  assert.deepEqual(C.cp4Substeps(C.CP4_RULES, false), { n: 1, dt: C.CP4_RULES.tickS });
  const on = C.cp4Substeps(C.CP4_RULES, true);
  assert.equal(on.n, 4);
  assert.ok(Math.abs(on.dt - C.CP4_RULES.tickS! / 4) < 1e-12);
  // No split when the tick is not more than 1.25 substeps, nor with the substep off.
  assert.equal(C.cp4Substeps({ ...C.CP4_RULES, substepS: 0.035 }, true).n, 1);
  assert.equal(C.cp4Substeps({ ...C.CP4_RULES, substepS: 0 }, true).n, 1);
  // Clamped to 2..8.
  assert.equal(C.cp4Substeps({ ...C.CP4_RULES, substepS: 0.001 }, true).n, 8);
});

test("at 40 ms ticks a dropped truck lands and comes to rest", () => {
  const g = ground(C.CP4_RULES);
  const { state, step } = truck(g, [4000, 108, 4000]);
  for (let i = 0; i < 200; i++) step(C.CP4_RULES.tickS!);
  assert.ok([...state.pos, ...state.bvel].every(Number.isFinite));
  assert.deepEqual(Array.from(state.bvel), [0, 0, 0]);
  assert.ok(state.tires.every((t) => t.onGround));
});

test("the suspension's extension rate is clamped to 20 ft/s", () => {
  let worst = 0, worstMtm2 = 0;
  for (const rules of [C.CP4_RULES, S.MTM2_RULES]) {
    const g = ground(rules);
    const { state, step } = truck(g, [4000, 140, 4000]);
    for (let i = 0; i < 180; i++) {
      step(1 / 60);
      for (const t of state.tires) {
        if (rules === C.CP4_RULES) worst = Math.max(worst, Math.abs(t.extensionRate));
        else worstMtm2 = Math.max(worstMtm2, Math.abs(t.extensionRate));
      }
    }
  }
  assert.ok(worstMtm2 > 20, `MTM2 lands harder than the clamp: ${worstMtm2}`);
  assert.ok(worst <= 20 + 1e-9, `${worst}`);
});

test("the terrain's penetration is capped at 6 ft: a buried truck rises less in one post-step", () => {
  const rise = (rules: S.Mtm2Rules) => {
    const g = ground(rules);
    const { params, state } = truck(g, [4000, 100 - 9, 4000]);
    const y0 = state.pos[1];
    S.postStepTruck(state, params, g, 1 / 60);
    return state.pos[1] - y0;
  };
  const cp4 = rise(C.CP4_RULES), mtm2 = rise(S.MTM2_RULES);
  assert.ok(cp4 < mtm2, `${cp4} < ${mtm2}`);
});

test("a computer truck grips 1.3 times harder offline, not online, and 1.5 times in drag races", () => {
  // Settle once under MTM2, then take one step from that same state under each rule set.
  const g0 = ground(S.MTM2_RULES);
  const settled = truck(g0, [4000, 100 + 3.5, 4000], { human: false });
  for (let i = 0; i < 240; i++) settled.step(1 / 60);
  const mu = (rules: S.Mtm2Rules, extra: Partial<S.StepContext>) => {
    const state = structuredClone(settled.state);
    const ctx: S.StepContext = { ...settled.ctx, ground: ground(rules), ...extra };
    S.stepTruck(state, settled.params, ctx, 1 / 60);
    return state.tires[0];
  };
  const base = mu(S.MTM2_RULES, { human: false });
  const off = mu(C.CP4_RULES, { human: false });
  const online = mu(C.CP4_RULES, { human: false, online: true });
  const human = mu(C.CP4_RULES, { human: true });
  assert.ok(base.mu > 0);
  assert.ok(Math.abs(off.mu / base.mu - 1.3) < 1e-9, `${off.mu / base.mu}`);
  assert.ok(Math.abs(online.mu - base.mu) < 1e-12);
  assert.ok(Math.abs(human.mu - base.mu) < 1e-12);
  // Rookie has no friction circle, so the grip limit is read as set.
  const rookie = { human: false, difficulty: S.DIFFICULTY.ROOKIE };
  const dragBase = mu(S.MTM2_RULES, { ...rookie, dragMode: true });
  const drag = mu(C.CP4_RULES, { ...rookie, dragMode: true });
  assert.ok(Math.abs(drag.mu - dragBase.mu) < 1e-12, "no aiGrip in drag races");
  assert.ok(Math.abs(drag.grip / dragBase.grip - 1.5) < 1e-9, `${drag.grip / dragBase.grip}`);
});

test("Sonic: a computer truck on Professional grips at 3.0 instead of 2.0", () => {
  const read = (rules: S.Mtm2Rules) => {
    const g = ground(rules);
    const { state, params, ctx } = truck(g, [4000, 100 + 3.5, 4000], { human: false, online: true, difficulty: S.DIFFICULTY.PROFESSIONAL, sonicTrack: true });
    for (let i = 0; i < 120; i++) { S.stepTruck(state, params, ctx, 1 / 60); S.postStepTruck(state, params, g, 1 / 60); }
    S.stepTruck(state, params, ctx, 1 / 60);
    return state.tires[0].mu;
  };
  assert.ok(Math.abs(read(C.CP4_RULES) / read(S.MTM2_RULES) - 1.5) < 1e-9);
});

test("a lake is deep water at the tire's bottom under CP4, at the ground otherwise", () => {
  const terrain = S.createTerrain(new Uint8Array(65536).fill(5)); // 10 ft
  const tiles = new Uint8Array(65536).fill(1);
  S.setTerrainLakes(terrain, tiles, new Float32Array([0, 14])); // lake 1 at 14 ft
  const map = S.createSurfaceMap(new Uint16Array(65536).fill(1), new Int32Array([100, 712]));
  const cp4 = S.createTerrainGround(terrain, map, 0, null, C.CP4_RULES);
  const mtm2 = S.createTerrainGround(terrain, map, 0, null, S.MTM2_RULES);
  // A tire bottom at 20 ft (on a prop) is above the lake: its texture under CP4, water under MTM2.
  assert.equal(cp4.surface(100, 20, 100), 712);
  assert.equal(mtm2.surface(100, 20, 100), 1300);
  // At 12 ft it is in the lake for both.
  assert.equal(cp4.surface(100, 12, 100), 1300);
});

test("at rest the truck is frozen only with three ground contacts", () => {
  // Flat ground: four wheels down, so CP4 still freezes it, as the drop test shows. Airborne it never does.
  const g = ground(C.CP4_RULES);
  const { state, params, ctx } = truck(g, [4000, 300, 4000]);
  state.bvel.fill(0);
  S.stepTruck(state, params, ctx, C.CP4_RULES.tickS!);
  // MTM2 would zero a velocity under 0.1 ft/s; CP4 keeps gravity's first step in the air.
  assert.ok(state.bvel[1] < 0, `${state.bvel[1]}`);
});
