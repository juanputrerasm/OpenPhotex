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
export { fluidAreas, hullFaceWaterArea, wheelWaterAreas, SPLASH_SPEED } from "./truck/water-drag.ts";
export type { FluidAreas } from "./truck/water-drag.ts";
export * from "./truck/recovery.ts";
export * from "./truck/autopilot.ts";
export * from "./truck/traffic.ts";
export * from "./collide/box.ts";
export { collideTruckBox, collideTruckImmovableBox, truckBoxSeparated } from "./collide/truck-box.ts";
export { stepBox, postStepBox, boxInertia } from "./collide/box-step.ts";
export { stepMovingObject, groundBoxHeightAt } from "./collide/moving-object.ts";
export { collideTruckRamp, createRamp, insideRamp, rampEdges, rampHeightAt, rampSlopeNormal } from "./collide/ramp.ts";
export { createEdgeState, edgeAgainstTruck, lineDistance } from "./collide/edges.ts";
export type { EdgeContext, EdgeForces, EdgeObstacle, EdgeState } from "./collide/edges.ts";
export { collideTrucks } from "./collide/truck-truck.ts";
export { collideBoxes } from "./collide/box-box.ts";
export * from "./race/race.ts";
export type { TruckBody } from "./collide/truck-truck.ts";
export type { SimRamp } from "./collide/ramp.ts";
export type { ContactResult, ContactBody } from "./truck/contacts.ts";
