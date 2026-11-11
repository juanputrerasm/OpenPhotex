/*
  What a truck-box pair test shares (MTM2_PHYSICS.md §14.14, §14.17): the pair's contact record, its
  force law against a pushable box, and where the hubs were last step. Used by the box faces
  (truck-box.ts) and by Community Patch 4's triangles (sim/cp4/truck-tri.ts).
*/
import type { Mtm2TruckParams } from "../truck/params.ts";
import type { Mtm2TruckState } from "../truck/state.ts";
import type { SimBox } from "./box.ts";
import { truckWeight } from "../truck/dynamics.ts";
import { INV_G } from "../constants.ts";

export type V3 = [number, number, number];

export const toWorld = (m: ArrayLike<number>, x: number, y: number, z: number): V3 =>
  [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
export const toBody = (m: ArrayLike<number>, x: number, y: number, z: number): V3 =>
  [m[0] * x + m[3] * y + m[6] * z, m[1] * x + m[4] * y + m[7] * z, m[2] * x + m[5] * y + m[8] * z];

/** The truck's mass in slugs. */
export function truckMass(p: Mtm2TruckParams): number {
  return truckWeight(p) * INV_G;
}

/**
 * A contact of the truck with the box, as MONSTER.EXE plays the box's sound for one (`0x428bc0`, MONSTER_EXE_ANALYSIS.md
 * "Object sounds"): a hull point that goes deeper into it, a wheel or tire contact point inside it, or one of its
 * corners against a wheel. `speed` is the hardest closing speed of those contacts, ft/s (0 when none closes).
 */
export interface BoxTouch { speed: number }
export type Touch = { hit: BoxTouch | null };

/** Records a contact along `normalWorld` (outward from the box), at the truck's speed against the box. */
export function touched(touch: Touch, s: Mtm2TruckState, box: SimBox, normalWorld: ArrayLike<number>): void {
  const iv = toWorld(s.matrix, s.bvel[0], s.bvel[1], s.bvel[2]);
  const closing = -((iv[0] - box.vel[0]) * normalWorld[0] + (iv[1] - box.vel[1]) * normalWorld[1] + (iv[2] - box.vel[2]) * normalWorld[2]);
  const speed = closing > 0 ? closing : 0;
  if (!touch.hit) touch.hit = { speed };
  else if (speed > touch.hit.speed) touch.hit.speed = speed;
}

/**
 * How the pair works (§14.17): pushable when the box has a mass below the truck's (the box's mass
 * is then the effective mass), else immovable with the truck's mass.
 */
export interface Pair {
  pushable: boolean;
  /** The contact this pair test found, for the object's sound (null: none). */
  touch: Touch;
  mEff: number;
  /**
   * The pair's force and moment on the box (box axes) and on the truck (body axes). Every
   * contact replaces them; they are applied once, after the whole pair test (§14.17).
   */
  box: { f: V3; m: V3 } | null;
  truck: { f: V3; m: V3 } | null;
}

/**
 * The pushable force law (§14.17) at a truck point `body` (truck axes) that is `depth` inside the
 * face with outward normal `n`, at `cur` (both box axes). Returns whether the box was pushed.
 */
export function pushPoint(
  s: Mtm2TruckState, box: SimBox, body: V3, cur: V3, n: V3, depth: number, pair: Pair, dt: number,
): boolean {
  const m = s.matrix, bm = box.matrix;
  const [p, q, r] = s.rates;
  const vt = [s.bvel[0] + (r * body[2] - p * body[1]), s.bvel[1] + (p * body[0] - q * body[2]), s.bvel[2] + (q * body[1] - r * body[0])];
  const vw = toWorld(m, vt[0], vt[1], vt[2]);
  const vtb = toBody(bm, vw[0], vw[1], vw[2]);
  const [pb, qb, rb] = box.rates;
  const vb = [box.bvel[0] + (rb * cur[2] - pb * cur[1]), box.bvel[1] + (pb * cur[0] - qb * cur[2]), box.bvel[2] + (qb * cur[1] - rb * cur[0])];
  const closing = -(n[0] * (vtb[0] - vb[0]) + n[1] * (vtb[1] - vb[1]) + n[2] * (vtb[2] - vb[2]));
  if (!(closing >= 0)) return false;
  const F = (closing / dt) * pair.mEff;
  setBoxForce(pair, cur, [-F * n[0], -F * n[1], -F * n[2]]);
  const fw = toWorld(bm, F * n[0], F * n[1], F * n[2]);
  setTruckForce(pair, body, toBody(m, fw[0], fw[1], fw[2]));
  const nw = toWorld(bm, n[0], n[1], n[2]);
  box.pos[0] -= depth * nw[0]; box.pos[1] -= depth * nw[1]; box.pos[2] -= depth * nw[2];
  return true;
}

export const crossV = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The pair's force on the box, `f` at `at` (box axes), replacing the last one. */
export function setBoxForce(pair: Pair, at: V3, f: V3): void {
  pair.box = { f, m: crossV(at, f) };
}

/** The pair's force on the truck, `f` at `at` (body axes), replacing the last one. */
export function setTruckForce(pair: Pair, at: V3, f: V3): void {
  pair.truck = { f, m: crossV(at, f) };
}

export function unit(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l === 0 ? [0, 1, 0] : [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * Where tire `i`'s hub was last step, world feet (tire +0x24, §14.14 step 3): the truck's last position and rotation,
 * and the hub as the step began. The wheels' rays start here, not at the truck's centre.
 */
export function lastHub(s: Mtm2TruckState, i: number): V3 {
  const h = s.tires[i].hub;
  const w = toWorld(s.prevMatrix, h[0], h[1], h[2]);
  return [s.prevPos[0] + w[0], s.prevPos[1] + w[1], s.prevPos[2] + w[2]];
}

