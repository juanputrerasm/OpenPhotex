/*
  A paved layer over the terrain: triangles a truck drives on where they lie above the ground.

  Not MTM2's: CART Precision Racing lays its road, curbs and shoulders as a mesh a couple of feet
  over the heightfield (`cpr/road.ts`), and a truck must stand on that mesh, not on the ground
  under it. `createRoadGround` wraps a ground (terrain, ramps, water) so that the height, the
  normal and the surface value at a point come from the road wherever a road triangle covers the
  point and is not below the ground there; everywhere else the wrapped ground answers.

  Triangles are looked up through a grid of square buckets, so a query tests the few triangles
  near it. A triangle too steep to stand on (a wall) is left out: walls are collision boxes.
*/
import type { Vec3 } from "../math.ts";
import type { Mtm2Ground } from "./ground.ts";

/** Bucket side in feet. */
const BUCKET_FT = 32;
/** The steepest a triangle may be and still carry a wheel: its unit normal's y. */
const MIN_NORMAL_Y = 0.5;

export interface RoadTriangles {
  /** Nine numbers a triangle: three corners (x, y, z), game feet. */
  positions: ArrayLike<number>;
  /** One TTY surface value (`type * 100 + depth`) a triangle. */
  surfaceValues: ArrayLike<number>;
}

export interface RoadGround extends Mtm2Ground {
  /** The road's height at (x, z), or null where no road triangle covers the point. */
  roadHeight(x: number, z: number): number | null;
  /**
   * The same ground for one body: only triangles at or below `limit()` count, so a deck over the
   * body (a bridge it drives under, an arch) is not its ground and one under it is. `limit` is read
   * at every query; a truck gives a height a little under its own.
   */
  below(limit: () => number): Mtm2Ground;
}

export function createRoadGround(base: Mtm2Ground, road: RoadTriangles): RoadGround {
  const p = road.positions;
  const count = Math.floor(p.length / 9);
  // Per triangle: the plane y = y0 + sx * (x - x0) + sz * (z - z0), and its unit normal.
  const plane = new Float64Array(count * 6);
  const usable = new Uint8Array(count);
  const buckets = new Map<number, number[]>();
  const key = (bx: number, bz: number) => bx * 65536 + bz;
  for (let t = 0; t < count; t++) {
    const o = t * 9;
    const ax = p[o]!, ay = p[o + 1]!, az = p[o + 2]!;
    const ux = p[o + 3]! - ax, uy = p[o + 4]! - ay, uz = p[o + 5]! - az;
    const vx = p[o + 6]! - ax, vy = p[o + 7]! - ay, vz = p[o + 8]! - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len === 0) continue;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    nx /= len; ny /= len; nz /= len;
    if (ny < MIN_NORMAL_Y) continue;
    usable[t] = 1;
    plane.set([-nx / ny, -nz / ny, nx, ny, nz, 0], t * 6);
    const x0 = Math.floor(Math.min(ax, ax + ux, ax + vx) / BUCKET_FT), x1 = Math.floor(Math.max(ax, ax + ux, ax + vx) / BUCKET_FT);
    const z0 = Math.floor(Math.min(az, az + uz, az + vz) / BUCKET_FT), z1 = Math.floor(Math.max(az, az + uz, az + vz) / BUCKET_FT);
    for (let bx = x0; bx <= x1; bx++) {
      for (let bz = z0; bz <= z1; bz++) {
        const k = key(bx, bz);
        let list = buckets.get(k);
        if (!list) buckets.set(k, (list = []));
        list.push(t);
      }
    }
  }

  /** The highest road triangle over (x, z): its index, with its height left in `found`; -1 for none. */
  let found = 0;
  function triangleAt(x: number, z: number, limit = Infinity): number {
    const list = buckets.get(key(Math.floor(x / BUCKET_FT), Math.floor(z / BUCKET_FT)));
    if (!list) return -1;
    let best = -1;
    for (const t of list) {
      const o = t * 9;
      const ax = p[o]!, az = p[o + 2]!, bx = p[o + 3]!, bz = p[o + 5]!, cx = p[o + 6]!, cz = p[o + 8]!;
      // Inside when the point is on one side of all three edges (either winding).
      const d1 = (x - ax) * (bz - az) - (z - az) * (bx - ax);
      const d2 = (x - bx) * (cz - bz) - (z - bz) * (cx - bx);
      const d3 = (x - cx) * (az - cz) - (z - cz) * (ax - cx);
      if ((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)) continue;
      const y = p[o + 1]! + plane[t * 6]! * (x - ax) + plane[t * 6 + 1]! * (z - az);
      if (y > limit) continue;
      if (best < 0 || y > found) { best = t; found = y; }
    }
    return best;
  }

  /** The road triangle that is the ground at (x, z), or -1 where the wrapped ground is; `found` is its height. */
  function onRoad(x: number, z: number, limit = Infinity): number {
    const t = triangleAt(x, z, limit);
    return t >= 0 && found >= base.height(x, z) ? t : -1;
  }

  const view = (limit: () => number): Mtm2Ground => ({
    get waterLevelFt() { return base.waterLevelFt; },
    get weather() { return base.weather; },
    set weather(value: number) { base.weather = value; },
    ramps: base.ramps,
    height: (x, z) => {
      const h = base.height(x, z);
      return triangleAt(x, z, limit()) >= 0 && found > h ? found : h;
    },
    normal: (x: number, z: number, out: Vec3) => {
      const t = onRoad(x, z, limit());
      if (t < 0) return base.normal(x, z, out);
      out[0] = plane[t * 6 + 2]!; out[1] = plane[t * 6 + 3]!; out[2] = plane[t * 6 + 4]!;
      return out;
    },
    surface: (x, y, z) => {
      const t = onRoad(x, z, limit());
      return t < 0 ? base.surface(x, y, z) : Number(road.surfaceValues[t] ?? 100);
    },
  });

  return {
    below: view,
    get waterLevelFt() { return base.waterLevelFt; },
    get weather() { return base.weather; },
    set weather(value: number) { base.weather = value; },
    ramps: base.ramps,
    roadHeight: (x, z) => (triangleAt(x, z) >= 0 ? found : null),
    height: (x, z) => {
      const h = base.height(x, z);
      return triangleAt(x, z) >= 0 && found > h ? found : h;
    },
    normal: (x: number, z: number, out: Vec3) => {
      const t = onRoad(x, z);
      if (t < 0) return base.normal(x, z, out);
      out[0] = plane[t * 6 + 2]!; out[1] = plane[t * 6 + 3]!; out[2] = plane[t * 6 + 4]!;
      return out;
    },
    surface: (x, y, z) => {
      const t = onRoad(x, z);
      return t < 0 ? base.surface(x, y, z) : Number(road.surfaceValues[t] ?? 100);
    },
  };
}
