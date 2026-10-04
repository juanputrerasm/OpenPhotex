/*
  A truck's dynamic state (MTM2_PHYSICS.md §1, §14): plain arrays and numbers, structured-cloneable.

  Position `pos` is world feet, `bvel` body-axis velocity (z forward), `euler` the angles
  (theta pitch, phi roll, psi yaw) and `rates` the body rates (p roll, q pitch, r yaw), as the
  game names them. `matrix` is the body-to-world rotation the step keeps in step with `euler`.

  Tires are in the order FR, FL, RR, RL; axles front, rear. The 16 contact points are the 12 hull
  (scrape) points followed by the 4 tire contact points, all in body feet.
*/
import { GEAR, ENGINE } from "../constants.ts";
import { eulerToMatrix } from "../math.ts";
import { createControlState, type ControlState } from "./controls.ts";
import type { Mtm2TruckParams } from "./params.ts";

export interface TireState {
  /** Suspension compression (ft) and its extension rate (ft/s). */
  compression: number;
  extensionRate: number;
  /** Penetration along body y found by the wheel probe; -9999 when none. */
  penetration: number;
  /** Lever from the axle centre to the probe point. */
  lever: number;
  /** Ground normal under the wheel (world). */
  normal: [number, number, number];
  onGround: boolean;
  /** Wheel spin (rad/s) and roll angle (rad). */
  spin: number;
  angle: number;
  /** Ground tilt under the tire in body axes, pitch about x and roll about z. */
  pitchG: number;
  rollG: number;
  /** Spring load and grip limit this step. */
  load: number;
  grip: number;
  /** The grip factor `K mu weather cut` (tire +0x8c); kept from the last contact in the air. */
  mu: number;
  /** Hub and contact point, body feet; contact velocity, body ft/s. */
  hub: [number, number, number];
  contact: [number, number, number];
  velocity: [number, number, number];
  /** Tire force in body axes this step. */
  force: [number, number, number];
  /** Water depth at the last wheel probe (positive in water) and that probe's world point. */
  waterDepth: number;
  waterPoint: [number, number, number];
}

export interface AxleState {
  /** Articulation (rad) and the hub height in body y. */
  articulation: number;
  travel: number;
}

export interface Mtm2TruckState {
  pos: Float64Array;
  /** The position before this step's move (collision rays start there, §14.14). */
  prevPos: Float64Array;
  bvel: Float64Array;
  /** theta, phi, psi. */
  euler: Float64Array;
  /** p, q, r. */
  rates: Float64Array;
  /** Body-to-world rotation, row-major. */
  matrix: Float64Array;
  /** The rotation at the start of this step (collision rays, §14.17). */
  prevMatrix: Float64Array;
  /** Forces and moments from the pair tests (body axes), applied and cleared next step (§14.17). */
  extForce: Float64Array;
  extMoment: Float64Array;
  rpm: number;
  controls: ControlState;
  tires: TireState[];
  axles: AxleState[];
  /** The 16 contact points in body feet (12 hull, 4 tire contacts). */
  points: Float64Array;
  /** Per point: stored depth along its normal, the normal (world), the water depth. */
  depths: Float64Array;
  normals: Float64Array;
  waterDepths: Float64Array;
  /** Points touching the ground after the last post-step. */
  contactCount: number;
  /** Seconds left of a helicopter lift (positive), or the stuck count-down (negative). */
  heliTimer: number;
  /** The helicopter's carry rates (per second) and hover height above the ground (§10.3). */
  carry: { pitch: number; roll: number; heading: number; x: number; z: number };
  hover: number;
  /** Impulse moment accumulated by collisions this step. */
  impulseMoment: number;
  /** The last contact force magnitude (crash-damage input). */
  impactForce: number;
  /** Water was met fast enough to splash this step (§14.7.1). */
  splash: boolean;
  /** The autopilot's course state (§14.22, §14.23). */
  ap: AutopilotState;
}

export interface AutopilotState {
  /** The course segment being followed, 0-based (the game's ap.cnumber - 1). */
  segment: number;
  /** The course integrator (+0x8ac), built up in the air, cleared on each new segment. */
  integral: number;
  /** The difficulty gain G (+0x8b8): 0.5, 0.75, 1.0, less any rubber-band bonus. */
  gain: number;
  /** Segments passed (+0x8f0). */
  segmentsPassed: number;
  /** The last target speed (+0x89c), ft/s. */
  target: number;
  /** Progress in the segment (+0x8c8, §14.24) and the time to its end (+0x8dc), seconds. */
  progress: number;
  eta: number;
  /** The cross-track error e (+0x8e8) and the unclamped correction c (+0x8d0) of §14.22. */
  crossTrack: number;
  correction: number;
  /** The braking deceleration (+0x8bc, §14.22) and the last forward acceleration (+0x8c4). */
  decel: number;
  accel: number;
  /** Traffic (§14.25): the side (+0x8d8, -1, 0, 1), the truck to pass (+0x8e0) and to follow (+0x8e4), -1 none. */
  side: number;
  passTarget: number;
  follow: number;
  /** The candidate count (+0x8ec). */
  candidates: number;
}

/** The difficulty gain for a difficulty (0 Rookie, 1 Intermediate, 2 Professional). */
export function autopilotGain(difficulty: number): number {
  return difficulty === 0 ? 0.5 : difficulty === 2 ? 1.0 : 0.75;
}

function tire(): TireState {
  return {
    compression: 0, extensionRate: 0, penetration: -9999, lever: 0, normal: [0, 1, 0], onGround: false,
    spin: 0, angle: 0, pitchG: 0, rollG: 0, load: 0, grip: 0, mu: 0,
    hub: [0, 0, 0], contact: [0, 0, 0], velocity: [0, 0, 0], force: [0, 0, 0],
    waterDepth: 0, waterPoint: [0, 0, 0],
  };
}

/**
 * A truck at `pos`, facing `heading` (psi, 0 = +z). With `params` the axles start at rest on their
 * static anchors and the contact points are the truck's hull and tire points.
 */
export function createTruckState(
  pos: ArrayLike<number>, heading = 0, gear: number = GEAR.FIRST, params?: Mtm2TruckParams,
): Mtm2TruckState {
  const points = new Float64Array(16 * 3);
  params?.scrapePoints.slice(0, 12).forEach((p, i) => points.set(p, i * 3));
  const axles: AxleState[] = [0, 2].map((t) => ({ articulation: 0, travel: params ? params.hubs[t][1] : -4 }));
  const state: Mtm2TruckState = {
    pos: Float64Array.from([pos[0], pos[1], pos[2]]),
    prevPos: Float64Array.from([pos[0], pos[1], pos[2]]),
    bvel: new Float64Array(3),
    euler: Float64Array.from([0, 0, heading]),
    rates: new Float64Array(3),
    matrix: new Float64Array(9),
    prevMatrix: new Float64Array(9),
    extForce: new Float64Array(3),
    extMoment: new Float64Array(3),
    rpm: ENGINE.idleRpm,
    controls: createControlState(gear),
    tires: [tire(), tire(), tire(), tire()],
    axles,
    points,
    depths: new Float64Array(16).fill(-9999),
    normals: new Float64Array(16 * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)),
    waterDepths: new Float64Array(16),
    contactCount: 0,
    heliTimer: 0,
    carry: { pitch: 0, roll: 0, heading: 0, x: 0, z: 0 },
    hover: 0,
    impulseMoment: 0,
    impactForce: 0,
    splash: false,
    ap: {
      segment: 0, integral: 0, gain: autopilotGain(params?.difficulty ?? 1), segmentsPassed: 0, target: 0,
      progress: 0, eta: 0, crossTrack: 0, correction: 0, decel: 0, accel: 0, side: 0, passTarget: -1, follow: -1, candidates: 0,
    },
  };
  eulerToMatrix(0, 0, heading, state.matrix);
  state.prevMatrix.set(state.matrix);
  return state;
}
