/*
  Community Patch 4's physics (OpenMTM2 docs/CP4_EXE_ANALYSIS.md 10 and 11): MTM2's step read through CP4's
  rules, and CP4's triangle collision; and beta 0.53's waterfall build (12, falls.ts), which the simulation never
  reads. Its author published no source code.
*/
export * from "./rules.ts";
export * from "./coll-shape.ts";
export * from "./truck-tri.ts";
export * from "./surface-mesh.ts";
export * from "./falls.ts";
export { binCollisionSoup, binBytesCollisionSoup, type CollSoup } from "../../model/coll-soup.ts";
