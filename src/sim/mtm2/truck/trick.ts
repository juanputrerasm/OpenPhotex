/*
  The optional trick handling (constants.ts `Mtm2Rules` airPitchControl, airRotationDamping, groundYawDamping; SIM_MTM2.md,
  "Optional handling"), shared by every vehicle model that steps a body by MTM2's integration: MTM2's (and MTM1's and
  Community Patch 4's), 4x4 Evolution's and CART Precision Racing's. Leaving the rules out is each game's handling.
*/

/** The trick strengths a host may set (any model's rules may carry them). */
export interface TrickRules {
  airPitchControl?: number;
  airRotationDamping?: number;
  groundYawDamping?: number;
}

/** The aero damping's scale: `[rot, yaw]`, rot for the roll and pitch rates, yaw for the yaw rate. */
export function trickDamping(rules: TrickRules | null | undefined, aloft: boolean): [number, number] {
  const rot = aloft ? rules?.airRotationDamping ?? 1 : 1;
  return [rot, aloft ? rot : rules?.groundYawDamping ?? 1];
}

/**
 * The pitch moment the pedals give with all four wheels off, for moment[0] (body x): throttle nose up, brakes nose
 * down, `airPitchControl` rad/s² a full pedal on the pitch inertia `pitchInertia`. 0 on the ground or without the rule.
 */
export function trickPitchMoment(rules: TrickRules | null | undefined, aloft: boolean, throttle: number, brakeFront: number, brakeRear: number, pitchInertia: number): number {
  const k = aloft ? rules?.airPitchControl ?? 0 : 0;
  return k === 0 ? 0 : -(throttle - 0.5 * (brakeFront + brakeRear)) * k * pitchInertia;
}
