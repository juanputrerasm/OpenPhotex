/*
  The optional trick handling shared by the vehicle models (src/sim/mtm2/truck/trick.ts): MTM2's step, 4x4 Evolution's
  and CART Precision Racing's read the same three fields; none set is each game's handling.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { trickDamping, trickPitchMoment } from "../src/sim/mtm2/truck/trick.ts";

test("trick handling: neutral without rules, scaled with them", () => {
  assert.deepEqual(trickDamping(null, true), [1, 1]);
  assert.deepEqual(trickDamping({ airRotationDamping: 0.25, groundYawDamping: 0.5 }, true), [0.25, 0.25]);
  assert.deepEqual(trickDamping({ airRotationDamping: 0.25, groundYawDamping: 0.5 }, false), [1, 0.5]);
  assert.equal(trickPitchMoment(null, true, 1, 0, 0, 5000), 0);
  assert.equal(trickPitchMoment({ airPitchControl: 5 }, false, 1, 0, 0, 5000), 0);
  assert.equal(trickPitchMoment({ airPitchControl: 5 }, true, 1, 0, 0, 5000), -25000, "throttle: nose up");
  assert.equal(trickPitchMoment({ airPitchControl: 5 }, true, 0, 1, 1, 5000), 25000, "brakes: nose down");
});

test("trick handling: every vehicle model's step takes it", () => {
  for (const f of ["../src/sim/mtm2/truck/dynamics.ts", "../src/sim/evo/step.ts", "../src/sim/cpr/step.ts"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.ok(src.includes("trickDamping(") && src.includes("trickPitchMoment("), f);
  }
});
