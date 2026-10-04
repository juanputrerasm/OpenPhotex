/*
  The Monster Truck Madness 2 simulation, as specified in OpenMTM2's docs/MTM2_PHYSICS.md.
  Exported from the package root as the `mtm2Sim` namespace; see docs/SIM_MTM2.md.
*/
export * from "./constants.ts";
export * from "./math.ts";
export * from "./time.ts";
export * from "./world/terrain.ts";
export * from "./world/surface.ts";
export * from "./world/water.ts";
export * from "./world/course.ts";
export * from "./world/ground.ts";
export {
  CHECKPOINT_TYPE, DETECTOR_WIDTH_SCALE, DETECTOR_HEIGHT_SCALE, SPHERE_PRETEST_FACTOR, buildCheckpoints,
  withinCheckpointReach, speedThroughCheckpoint, checkpointCrossingTime, pointInCheckpointBox,
} from "./world/checkpoints.ts";
export type {
  CheckpointBox, Mtm2Checkpoint, CheckpointBoxInput, ModelExtentsFn,
} from "./world/checkpoints.ts";
export * from "./truck/params.ts";
export * from "./truck/state.ts";
export * from "./truck/controls.ts";
export * from "./truck/drivetrain.ts";
export { stepTruck, postStepTruck, tireGeometry, probeGround, lateralCoefficient, truckWeight } from "./truck/dynamics.ts";
export type { StepContext } from "./truck/dynamics.ts";
export { solveHullContacts } from "./truck/contacts.ts";
export type { ContactResult } from "./truck/contacts.ts";
