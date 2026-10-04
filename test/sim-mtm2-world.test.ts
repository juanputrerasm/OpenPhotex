/*
  MTM2 simulation foundations: rotations, fixed-point time and the terrain sampler, against
  hand-computed values (OpenMTM2 docs/MTM2_PHYSICS.md §1, §2.1, §2.2).
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  bodyToWorld, eulerToMatrix, matrixToEuler, worldToBody, wrapPi, wrapTwoPi, heading,
} from "../src/sim/mtm2/math.ts";
import { fixedToSeconds, secondsToFixed } from "../src/sim/mtm2/time.ts";
import {
  cellSplitsMainDiagonal, createTerrain, groundHeightAt, groundNormalAt, terrainHeightAt,
} from "../src/sim/mtm2/world/terrain.ts";

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const nearVec = (a: ArrayLike<number>, b: ArrayLike<number>, eps = 1e-9) => {
  for (let i = 0; i < b.length; i++) near(a[i], b[i], eps);
};

test("M = Ry Rx Rz: forward column, yaw to +x, pitch nose down", () => {
  const m = new Float64Array(9);
  const out = new Float64Array(3);
  eulerToMatrix(0, 0, Math.PI / 2, m);
  nearVec(bodyToWorld(m, [0, 0, 1], out), [1, 0, 0]);
  // Positive theta turns the nose down (forward column y = -sin theta).
  eulerToMatrix(0.3, 0, 0, m);
  nearVec(bodyToWorld(m, [0, 0, 1], out), [0, -Math.sin(0.3), Math.cos(0.3)]);
  // Positive phi raises the body x axis: world y = sin phi.
  eulerToMatrix(0, 0.2, 0, m);
  nearVec(bodyToWorld(m, [1, 0, 0], out), [Math.cos(0.2), Math.sin(0.2), 0]);
  // The general forward column.
  const [t, p, s] = [0.4, -0.7, 2.1];
  eulerToMatrix(t, p, s, m);
  nearVec(bodyToWorld(m, [0, 0, 1], out), [Math.cos(t) * Math.sin(s), -Math.sin(t), Math.cos(t) * Math.cos(s)]);
});

test("the matrix is orthonormal, worldToBody inverts it, and the angles come back", () => {
  const m = new Float64Array(9);
  const a = new Float64Array(3), b = new Float64Array(3), e = new Float64Array(3);
  for (const [t, p, s] of [[0.1, 0.2, 0.3], [-1.2, 2.5, -3], [1.5, -0.1, 0]]) {
    eulerToMatrix(t, p, s, m);
    worldToBody(m, bodyToWorld(m, [1.5, -2, 3.25], a), b);
    nearVec(b, [1.5, -2, 3.25]);
    nearVec(matrixToEuler(m, e), [t, p, s]);
  }
});

test("angle helpers", () => {
  near(wrapPi(3 * Math.PI / 2), -Math.PI / 2);
  near(wrapPi(-3 * Math.PI / 2), Math.PI / 2);
  near(wrapTwoPi(-Math.PI / 2), 3 * Math.PI / 2);
  near(heading(1, 0), Math.PI / 2);
  near(heading(0, 1), 0);
});

test("16.16 fixed-point time", () => {
  assert.equal(secondsToFixed(1), 0x10000);
  assert.equal(secondsToFixed(3), 0x30000);
  assert.equal(secondsToFixed(1 / 3), 21845);
  near(fixedToSeconds(0x18000), 1.5);
});

/** A terrain whose corner (row, col) is set from a function of both, in 2 ft steps. */
function terrainFrom(fn: (row: number, col: number) => number, water: number | null = null) {
  const h = new Uint8Array(65536);
  for (let r = 0; r < 256; r++) for (let c = 0; c < 256; c++) h[r * 256 + c] = fn(r, c);
  return createTerrain(h, water);
}

test("terrain rows follow z and columns follow x, 2 ft per step, 32 ft cells", () => {
  const t = terrainFrom((r, c) => (r === 3 && c === 5 ? 10 : 0));
  assert.equal(terrainHeightAt(t, 5 * 32, 3 * 32), 20);
  assert.equal(terrainHeightAt(t, 3 * 32, 5 * 32), 0);
});

test("checkerboard split: even cells along (r,c)-(r+1,c+1), odd along the other diagonal", () => {
  assert.equal(cellSplitsMainDiagonal(0, 0), true);
  assert.equal(cellSplitsMainDiagonal(0, 1), false);
  assert.equal(cellSplitsMainDiagonal(7, 3), true);
  // Only corner (r+1, c) raised to 8 ft. In an even cell the triangle fz >= fx holds it, so at
  // (fx, fz) = (0.25, 0.75) the height is 8 * (fz - fx) = 4 ft.
  const even = terrainFrom((r, c) => (r === 1 && c === 0 ? 4 : 0));
  near(terrainHeightAt(even, 0.25 * 32, 0.75 * 32), 4);
  // In the other triangle (fz < fx) the raised corner is not a vertex: height 0.
  near(terrainHeightAt(even, 0.75 * 32, 0.25 * 32), 0);
  // Odd cell (row 0, col 1): corner (1, 1) is h10. Triangle fz < 1 - fx has vertices
  // h00, h01, h10, so at (0.25, 0.5) the height is 8 * fz = 4 ft.
  const odd = terrainFrom((r, c) => (r === 1 && c === 1 ? 4 : 0));
  near(terrainHeightAt(odd, 32 + 0.25 * 32, 0.5 * 32), 4);
  // Triangle fz >= 1 - fx has vertices h01, h10, h11: at (0.75, 0.75), h = 8 * (1 - fx) = 2 ft.
  near(terrainHeightAt(odd, 32 + 0.75 * 32, 0.75 * 32), 2);
});

test("terrain matches each corner and is continuous across the diagonals", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 8) & 0xff;
  const t = terrainFrom(() => rnd());
  for (const [r, c] of [[0, 0], [10, 11], [200, 3], [255, 255]]) {
    near(terrainHeightAt(t, c * 32, r * 32), t.heights[r * 256 + c] * 2);
  }
  // Both sides of a diagonal agree on it.
  for (let i = 0; i < 200; i++) {
    const r = rnd(), c = rnd(), f = (rnd() + 0.5) / 256;
    const x0 = c * 32, z0 = r * 32;
    const a = cellSplitsMainDiagonal(r, c)
      ? [x0 + f * 32, z0 + f * 32] : [x0 + f * 32, z0 + (1 - f) * 32];
    const eps = 1 / 64;
    near(terrainHeightAt(t, a[0] + eps, a[1]), terrainHeightAt(t, a[0], a[1] + eps), 1);
  }
});

test("terrain wraps at 8192 ft, negative positions included", () => {
  const t = terrainFrom((r, c) => (r * 7 + c * 3) & 0xff);
  near(terrainHeightAt(t, 100.5, 300.25), terrainHeightAt(t, 100.5 + 8192, 300.25 - 8192));
  near(terrainHeightAt(t, -10, -20), terrainHeightAt(t, 8182, 8172));
  // The far edge interpolates to row/column 0.
  const edge = terrainFrom((r, c) => (r === 0 && c === 0 ? 5 : 0));
  near(terrainHeightAt(edge, 8191.5, 0), 10 - 10 * (0.5 / 32));
});

test("positions are truncated to 1/256 ft", () => {
  const t = terrainFrom((_r, c) => c);
  near(terrainHeightAt(t, 1 + 1 / 1024, 0), terrainHeightAt(t, 1, 0));
});

test("normals: flat, x slope and z slope, per triangle", () => {
  const out = new Float64Array(3);
  nearVec(groundNormalAt(terrainFrom(() => 10), 50, 50, out), [0, 1, 0]);
  // Height rising 2 ft per 32 ft along x: normal (-2, 32, 0) normalised.
  const len = Math.hypot(2, 32);
  nearVec(groundNormalAt(terrainFrom((_r, c) => c), 40, 70, out), [-2 / len, 32 / len, 0]);
  nearVec(groundNormalAt(terrainFrom((r) => r), 70, 40, out), [0, 32 / len, -2 / len]);
  // A single raised corner (r+1, c) of an even cell tilts only the fz >= fx triangle.
  const t = terrainFrom((r, c) => (r === 1 && c === 0 ? 4 : 0));
  const l2 = Math.hypot(8, 32, 8);
  nearVec(groundNormalAt(t, 8, 24, out), [8 / l2, 32 / l2, -8 / l2]);
  nearVec(groundNormalAt(t, 24, 8, out), [0, 1, 0]);
});

test("snow freezes water: ground floors at the water level, flat", () => {
  const t = terrainFrom((_r, c) => c, 20);
  const out = new Float64Array(3);
  near(groundHeightAt(t, 5 * 32, 0), 10);
  near(groundHeightAt(t, 5 * 32, 0, true), 20);
  near(groundHeightAt(t, 15 * 32, 0, true), 30);
  nearVec(groundNormalAt(t, 5 * 32, 0, out, true), [0, 1, 0]);
  assert.notEqual(groundNormalAt(t, 15 * 32 + 4, 4, out, true)[0], 0);
  // No water level: snow changes nothing.
  near(groundHeightAt(terrainFrom(() => 0), 5, 5, true), 0);
});
