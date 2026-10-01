import { flyTag, flyTags, parseFlyAngle, parseFlyTagged, type FlyTag } from "./tagged.ts";
import type { FlyBounds } from "./globe.ts";

/*
  A Fly! scenery set's manifest (<SET>.SCF) and its object placement files (SCENERY.Sxx).
  See docs/FLY.md.
*/

/** A parsed .SCF scenery manifest. */
export interface FlySceneryManifest {
  name: string;
  /** The area the set's detailed scenery covers (<call>, <caur>). */
  coverage: FlyBounds | null;
  /** The area within which the game loads the set (<ldll>, <ldur>). */
  load: FlyBounds | null;
  /** The archives the set is made of, as written (lower case in the stock files). */
  files: string[];
}

/*
    <bgno> ==== BEGIN SCENERY FILE ====
      <name>  San Francisco
      <call>  36 43 17.33 N / 123 45 00.00 W     coverage, lower left
      <caur>  38 57 32.71 N / 120 56 15.00 W     coverage, upper right
      <ldll>  35 34 39.87 N / 125 09 22.50 W     load area, lower left
      <ldur>  40 03 09.29 N / 119 31 52.50 W     load area, upper right
      <file>  sanfran1.epd                       one per archive
    <endo>
*/
export function parseFlyScf(input: Uint8Array | string, sourceName = ".SCF"): FlySceneryManifest {
  const tags = parseFlyTagged(input, sourceName);
  return {
    name: flyTag(tags, "name")?.values[0] ?? "",
    coverage: bounds(flyTag(tags, "call"), flyTag(tags, "caur")),
    load: bounds(flyTag(tags, "ldll"), flyTag(tags, "ldur")),
    files: flyTags(tags, "file").flatMap((t) => t.values),
  };
}

function bounds(lowerLeft: FlyTag | null, upperRight: FlyTag | null): FlyBounds | null {
  if (!lowerLeft || !upperRight) return null;
  const [south, west] = lowerLeft.values.map(parseFlyAngle);
  const [north, east] = upperRight.values.map(parseFlyAngle);
  if ([south, west, north, east].some((v) => v === null || v === undefined)) return null;
  return { south: south!, west: west!, north: north!, east: east! };
}

/** One model of an object: a named part, or a model shown within a range of distances. */
export interface FlyObjectModel {
  /** The part name (<modl>: `comp`, or `pole`, `sck1`... on a windsock). */
  part: string;
  /** The file, as written: .BIN, .BSP or .ARM. */
  file: string;
  /** For a <mdst> model, the distance range it is shown in, in the file's units. Else null. */
  near: number | null;
  far: number | null;
}

/** `<flag>` bit 0: relocate the model vertically so its lowest point rests on the terrain. */
export const FLY_OBJECT_SNAP_TO_GROUND = 0x00000001;

/** One placed object from a SCENERY.Sxx file. */
export interface FlySceneryObject {
  /** The <wobj> kind: `mobj` (model), `becn` (beacon) or `wdsk` (windsock) in the stock files. */
  kind: string;
  /** <type>: `mobj` or `becn`. */
  type: string;
  id: string;
  /** <name>; `NO-NAME` for most objects. */
  name: string;
  /** <flag>, preserved as the signed 32-bit word written in the file. */
  flag: number | null;
  /** Whether `<flag>` bit 0 requests that the model's lowest point rest on the terrain. */
  snapToGround: boolean;
  /** <detl>, the detail level. */
  detail: number | null;
  latitude: number;
  longitude: number;
  /** The third <geop> value: presumably feet above sea level. */
  altitude: number;
  /** <iang>, three angles, presumably radians, with the heading in the middle one. */
  orientation: [number, number, number];
  /** The models in the object's <mmgr> (and <nmgr>) blocks, in file order. */
  models: FlyObjectModel[];
  /** <lens>, on beacons. */
  lens: number | null;
}

/*
    <wobj> mobj
    <bgno>
      <geop>  37 54'43.8401"N / 122 22'41.5354"W / 139.93359375
      <type>  mobj
      <flag>  -2147483339
      <detl>  1
      <id  >  mobj2
      <name>  Blue Gas Tank
      <mmgr>
      <bgno>
        <simu>  comp
        <modl>  comp / BLUTANK.BIN               a part and its file
        <mdst>  comp / GOLD1.BSP / 0 / 14000     or a file and its distance range
      <endo>
      <iang>  0.000000,0.067196,0.000000
      <lens>  2                                  beacons only
    <endo>

  An object whose position cannot be read is skipped with a warning rather than failing the
  file.
*/
export function parseFlySceneryObjects(input: Uint8Array | string, sourceName = "SCENERY.Sxx"): {
  objects: FlySceneryObject[];
  warnings: string[];
} {
  const objects: FlySceneryObject[] = [];
  const warnings: string[] = [];
  for (const wobj of flyTags(parseFlyTagged(input, sourceName), "wobj")) {
    const body = wobj.blocks[0] ?? [];
    const geop = flyTag(body, "geop")?.values ?? [];
    const latitude = parseFlyAngle(geop[0] ?? "");
    const longitude = parseFlyAngle(geop[1] ?? "");
    const id = flyTag(body, "id")?.values[0] ?? "";
    if (latitude === null || longitude === null) {
      warnings.push(`${sourceName}: object ${id || objects.length} has no readable <geop>`);
      continue;
    }
    const angles = (flyTag(body, "iang")?.values[0] ?? "").split(",").map(Number);
    const models: FlyObjectModel[] = [];
    for (const manager of [...flyTags(body, "mmgr"), ...flyTags(body, "nmgr")]) {
      for (const tag of manager.blocks.flat()) {
        if (tag.tag === "modl" && tag.values.length >= 2) {
          models.push({ part: tag.values[0], file: tag.values[1], near: null, far: null });
        } else if (tag.tag === "mdst" && tag.values.length >= 4) {
          models.push({ part: tag.values[0], file: tag.values[1], near: Number(tag.values[2]), far: Number(tag.values[3]) });
        }
      }
    }
    const flag = numberOrNull(flyTag(body, "flag")?.values[0]);
    objects.push({
      kind: wobj.values[0] ?? "",
      type: flyTag(body, "type")?.values[0] ?? "",
      id,
      name: flyTag(body, "name")?.values[0] ?? "",
      flag,
      snapToGround: flag !== null && (flag & FLY_OBJECT_SNAP_TO_GROUND) !== 0,
      detail: numberOrNull(flyTag(body, "detl")?.values[0]),
      latitude,
      longitude,
      altitude: Number(geop[2] ?? 0) || 0,
      orientation: [angles[0] || 0, angles[1] || 0, angles[2] || 0],
      models,
      lens: numberOrNull(flyTag(body, "lens")?.values[0]),
    });
  }
  return { objects, warnings };
}

function numberOrNull(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
