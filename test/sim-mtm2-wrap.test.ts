// The world as a torus (src/sim/mtm2/world/wrap.ts; OpenMTM2 docs/MONSTER_EXE_ANALYSIS.md "The wrapping world").

import test from "node:test";
import assert from "node:assert/strict";
import { mtm2Sim as S } from "../src/index.ts";

type T3 = [number, number, number];
const TRK_HULL: T3[] = [
  [-3.67, 0, 9.2], [3.67, 0, 9.2], [-3.67, 2.56, 9.2], [3.67, 2.56, 9.2],
  [-2.61, 5.23, 1.89], [2.61, 5.23, 1.89], [-2.14, 5.23, -0.8], [2.1, 5.23, -0.8],
  [-3.67, 2.82, -9.2], [3.67, 2.82, -9.2], [-3.67, 0, -9.2], [3.67, 0, -9.2],
];
const truck = (pos: T3, heading = 0) => {
  const p = S.createTruckParams({ scrapePoints: TRK_HULL }, { difficulty: S.DIFFICULTY.INTERMEDIATE });
  return { s: S.createTruckState(pos, heading, S.GEAR.NEUTRAL, p), p };
};

test("coordinates and differences on the torus", () => {
  assert.equal(S.wrapCoord(8200), 8);
  assert.equal(S.wrapCoord(-8), 8184);
  assert.equal(S.wrapCoord(100), 100);
  assert.equal(S.wrapDelta(8190 - 5), -7, "the short way round");
  assert.equal(S.wrapDelta(5 - 8190), 7);
  assert.equal(S.wrapDelta(300), 300);
  assert.equal(S.nearestShift(5, 8190), 8192, "the copy of 5 nearest 8190 is 8197");
  assert.equal(S.nearestShift(8190, 5), -8192);
  assert.equal(S.nearestShift(4000, 4100), 0);
});

test("a truck is wrapped as the game wraps it: x and z, a world at a time, its height and speed untouched", () => {
  const { s } = truck([8195, 106, -3]);
  s.bvel.set([1, 2, 30]);
  assert.deepEqual(S.wrapTruck(s), [-8192, 8192]);
  assert.deepEqual([...s.pos], [3, 106, 8189]);
  assert.deepEqual([...s.prevPos], [3, 106, 8189], "its last position goes with it");
  assert.deepEqual([...s.bvel], [1, 2, 30]);
  assert.deepEqual(S.wrapTruck(s), [0, 0]);
  // The game's own bounds: 8192 itself and 0 stay.
  const edge = truck([8192, 106, 0]);
  assert.deepEqual(S.wrapTruck(edge.s), [0, 0]);
});

test("two trucks either side of the seam collide as two side by side do", () => {
  const terrain = S.createTerrain(new Uint8Array(65536).fill(50));
  const ground = S.createTerrainGround(terrain, null, 0, null);
  const ctx = { ground, human: false, difficulty: S.DIFFICULTY.INTERMEDIATE, sonicTrack: false };
  const dt = 1 / 60;
  const meet = (ax: number, bx: number) => {
    const a = truck([ax, 106, 1000]), b = truck([bx, 106, 1000]);
    for (let i = 0; i < 90; i++) for (const t of [a, b]) { S.stepTruck(t.s, t.p, ctx, dt); S.postStepTruck(t.s, t.p, ground, dt); }
    for (const t of [a, b]) { t.s.bvel.fill(0); t.s.rates.fill(0); t.s.extForce.fill(0); t.s.extMoment.fill(0); }
    a.s.pos[0] = ax; b.s.pos[0] = bx; a.s.pos[2] = b.s.pos[2] = 1000;
    b.s.bvel[0] = -5;
    const met = S.collideTrucks(a, b, dt);
    return { met, fa: a.s.extForce[0], fb: b.s.extForce[0], bx: b.s.pos[0] };
  };
  const inside = meet(1000, 1006), across = meet(8189, 3);
  assert.ok(inside.met.hull || inside.met.wheels, "side by side they meet");
  assert.deepEqual(across.met, inside.met);
  assert.ok(Math.abs(across.fa - inside.fa) < 1e-6 && Math.abs(across.fb - inside.fb) < 1e-6, `forces ${across.fa} and ${inside.fa}`);
  assert.ok(across.bx < 100, `b stays on its own side of the seam, at ${across.bx}`);
  // Far apart they do not.
  assert.deepEqual(meet(1000, 5000).met, { hull: false, wheels: false });
});

test("ground boxes are placed beside the truck across the map's edge", () => {
  const ra0 = new Uint8Array(65536).fill(50), ra1 = new Uint8Array(65536).fill(50);
  ra1[5 * 256 + 0] = 60; // a box in column 0
  const boxes = S.groundBoxesAround(ra0, ra1, 8190, 5 * 32 + 16, []);
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0].pos[0], 8192 + 16, "beside a truck at the far edge, not a world away");
  const own = S.groundBoxesAround(ra0, ra1, 20, 5 * 32 + 16, []);
  assert.equal(own[0].pos[0], 16);
  // A truck not yet wrapped (a little past the edge) finds it in its own copy too.
  assert.equal(S.groundBoxesAround(ra0, ra1, 8192 + 20, 5 * 32 + 16, [])[0].pos[0], 8192 + 16);
});

test("a road or a deck over the terrain is the same a world away", () => {
  const terrain = S.createTerrain(new Uint8Array(65536).fill(50));
  const base = S.createTerrainGround(terrain, null, 0, null);
  const road = S.createRoadGround(base, { positions: new Float32Array([0, 110, 0, 0, 110, 64, 64, 110, 64, 0, 110, 0, 64, 110, 64, 64, 110, 0]), surfaceValues: new Int32Array([100, 100]) });
  assert.equal(road.height(10, 10), 110);
  assert.equal(road.height(8192 + 10, 10), 110);
  assert.equal(road.height(10, -8192 + 10), 110);
  assert.equal(road.height(-10, 10), 100, "off the road");
});

test("a truck against a box across the seam, by the copy nearest the box", () => {
  const box = S.createBox([4, 106, 1000], [8, 12, 40]);
  const near = truck([8186, 106, 1000], Math.PI / 2);
  near.s.bvel[2] = 30;
  const before = [...near.s.pos];
  const hit = () => { S.collideTruckImmovableBox(near.s, near.p, box, 1 / 60); return [...near.s.depths].some((d) => d > 0); };
  assert.equal(hit(), false, "by their numbers they are a world apart");
  near.s.depths.fill(-1e9);
  assert.equal(S.withNearest(near.s, box.pos[0], box.pos[2], hit), true, "as the nearest copy, the hull is in the box");
  assert.deepEqual([...near.s.pos], before, "and the truck is back where it was");
});
