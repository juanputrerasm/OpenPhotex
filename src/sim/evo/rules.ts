/*
  4x4 Evolution 1 and 2 rules and tables (OpenMTM2 docs/EVO2_PHYSICS.md; the analysed builds are
  4x4LE.exe of 16 August 2001 and 4x42.exe of 25 September 2001).

  Both games run one vehicle model with the same constants. The four differences found (§10)
  are the named switches below. The world rules that the shared MTM2 code reads (water drag,
  deep water, weather grip) are the same in both games and equal MTM2's; truck against truck
  is not traced in Evo, so MTM2's applies.
*/
import { G, MTM2_RULES, type Mtm2Rules } from "../mtm2/constants.ts";

export interface EvoRules extends Mtm2Rules {
  id: "evo1" | "evo2";
  /** Weight over mass with all four tires off the ground: g (Evo 1), 56.3045 (Evo 2, 0x554600). */
  airborneG: number;
  /** The default CG's forward offset, ft: 0 (Evo 1), 2 (Evo 2, 0x5e9c80). */
  defaultCgZ: number;
  /** Rear grip falls when steering hard above 20 mph (Evo 2 only, 0x553920). */
  steerRearGripCut: boolean;
  /** Hull friction limit's factor on the support: 0.5 (Evo 1, as MTM2), 1.5 (Evo 2, 0x667090). */
  hullFrictionFactor: number;
}

export const EVO1_RULES: EvoRules = Object.freeze({
  ...MTM2_RULES, id: "evo1", airborneG: G, defaultCgZ: 0, steerRearGripCut: false, hullFrictionFactor: 0.5,
});
export const EVO2_RULES: EvoRules = Object.freeze({
  ...MTM2_RULES, id: "evo2", airborneG: 56.3045, defaultCgZ: 2, steerRearGripCut: true, hullFrictionFactor: 1.5,
});

/** The rules by name: "evo1" or "evo2" (anything else is Evo 2's). */
export function evoRules(id: string | null | undefined): EvoRules {
  return id === "evo1" ? EVO1_RULES : EVO2_RULES;
}

export function isEvoRules(id: string | null | undefined): id is "evo1" | "evo2" {
  return id === "evo1" || id === "evo2";
}

/**
 * Friction coefficient by ground type (index = surface value / 100), the same in both games
 * (Evo 2 0x545ac0, Evo 1 0x504850). It differs from MTM2's on water, mud, ice, snow and deep
 * water, and adds type 14, train track. Unknown types read 1.0.
 */
export const EVO_SURFACE_MU: readonly number[] = Object.freeze([
  1.0, 1.0, 0.9, 0.5, 0.5, 0.7, 0.7, 0.6, 0.3, 0.5, 0.8, 0.8, 0.6, 0.5, 1.0,
]);

export function evoSurfaceMu(type: number): number {
  return EVO_SURFACE_MU[type] ?? 1;
}

/** Tire tread: 0 shallow, 1 medium, 2 deep, 3 studded (the garage's tire cut). */
export const EVO_TREAD = Object.freeze({ SHALLOW: 0, MEDIUM: 1, DEEP: 2, STUDDED: 3 });

/** Grip by tread per ground type (Evo 2 0x559500); unknown types read 1.0. */
export const EVO_TREAD_FACTORS: readonly (readonly [number, number, number, number])[] = Object.freeze([
  [1.0, 1.0, 1.0, 1.0], // 0 default
  [1.0, 0.9, 0.8, 0.7], // 1 cement
  [0.9, 1.0, 0.9, 0.8], // 2 dirt
  [0.7, 0.9, 1.0, 0.8], // 3 water
  [0.8, 0.9, 1.0, 0.9], // 4 mud
  [0.8, 0.9, 1.0, 0.9], // 5 sand
  [0.9, 1.0, 0.9, 0.9], // 6 grass
  [0.8, 0.9, 1.0, 0.9], // 7 gravel
  [0.6, 0.8, 0.8, 1.0], // 8 ice
  [0.6, 0.8, 0.9, 1.0], // 9 snow
  [0.9, 1.0, 0.9, 0.6], // 10 metal
  [0.9, 1.0, 0.9, 0.8], // 11 wood
  [0.8, 0.9, 1.0, 0.7], // 12 rock
]);

export function evoTreadFactor(type: number, tread: number): number {
  return EVO_TREAD_FACTORS[type]?.[tread] ?? 1;
}
