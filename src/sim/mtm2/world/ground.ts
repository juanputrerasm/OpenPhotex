/*
  What a truck stands on, as the step queries it (MTM2_PHYSICS.md §2, §14.10).

  The game asks three things of the world at a point: the ground height under it (terrain,
  plus ramp and ground-box tops), the ground normal there, and the surface value (TTY type and
  depth, water below the water level). This interface is those three, so the truck step does
  not care what the ground is made of. `createTerrainGround` is the terrain-only world; ground
  boxes are separate collision objects (§14.14); the frame's listed ramps (`ramps`, §14.19) raise
  the height query where they stand, but not the normal.
*/
import type { Vec3 } from "../math.ts";
import { rampHeightAt, type SimRamp } from "../collide/ramp.ts";
import { groundHeightAt, groundNormalAt, type Mtm2Terrain } from "./terrain.ts";
import { terrainSurfaceValue, type Mtm2SurfaceMap } from "./surface.ts";

export interface Mtm2Ground {
  /** Ground height in feet under (x, z). */
  height(x: number, z: number): number;
  /** Upward unit ground normal at (x, z), into `out`. */
  normal(x: number, z: number, out: Vec3): Vec3;
  /** TTY value (`type * 100 + depth`) of the surface at a point. */
  surface(x: number, y: number, z: number): number;
  /** The water level in feet, or null. */
  waterLevelFt: number | null;
  /** Weather state 0..8. */
  weather: number;
  /** This frame's listed ramps, in list order; the caller keeps it up to date. */
  ramps: SimRamp[];
}

export function createTerrainGround(
  terrain: Mtm2Terrain, surface: Mtm2SurfaceMap | null, weather = 0, waterLevelFt: number | null = terrain.waterLevelFt,
): Mtm2Ground {
  const snow = weather === 5;
  const ramps: SimRamp[] = [];
  return {
    height: (x, z) => {
      for (const r of ramps) {
        const h = rampHeightAt(r, x, z);
        if (h !== null) return h;
      }
      return groundHeightAt(terrain, x, z, snow);
    },
    normal: (x, z, out) => groundNormalAt(terrain, x, z, out, snow),
    surface: (x, _y, z) => (surface ? terrainSurfaceValue(terrain, surface, x, z, waterLevelFt, snow) : 200),
    waterLevelFt,
    weather,
    ramps,
  };
}
