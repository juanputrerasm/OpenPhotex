/*
  The 4x4 Evolution 1 and 2 vehicle model, as specified in OpenMTM2's docs/EVO2_PHYSICS.md. It
  runs on the MTM2 simulation's world, collisions and post-step (`mtm2Sim`); exported from the
  package root as the `evoSim` namespace. See docs/SIM_EVO.md.
*/
export * from "./rules.ts";
export * from "./spec.ts";
export * from "./ground.ts";
export * from "./params.ts";
export * from "./driveline.ts";
export * from "./step.ts";
export { postStepTruck as postStepEvoTruck } from "../mtm2/truck/dynamics.ts";
