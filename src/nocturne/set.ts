import { LineReader, nocturneLines, numbers } from "./text.ts";

export interface SetLight { name: string; position: number[]; orientation: number[]; fov: number; aspect: number; intensity: number; type: number; colourAndAttenuation: number[]; size: number[]; filters: string[]; blendFilter: number; filterFrame: number; filterMotion: number[]; timing: number[]; visibleIn: number[][] }
export interface SetCamera { name: string; position: number[]; orientation: number[]; fov: number; viewMatrix: number[][]; usesGlobalFog: boolean; fog: { colour: number[]; velocity: number[]; range: number[]; temperature: number } | null; boxMin: number[]; boxMax: number[]; reverbPreset: number }
export interface NocturneSet { version: number; unitScale: number; palette: string; geometry: string; geometryScale: number; fog: { colour: number[]; velocity: number[]; range: number[]; temperature: number }; water: number[]; environmentModel: string; transparentWater: boolean; hasSky: boolean; sky: string; worldGeometry: string; weatherType: number; lights: SetLight[]; cameras: SetCamera[]; trailingLines: string[] }

export function parseNocturneSet(bytes: Uint8Array, name = "SET"): NocturneSet {
  const r = new LineReader(nocturneLines(bytes), name);
  const label = (expected: string) => { const got = r.next(expected); if (!got.toLowerCase().startsWith(expected.toLowerCase())) throw new Error(`${name}: expected ${expected}, got '${got}'.`); };
  const version = r.count("version");
  if (version !== 26) throw new Error(`${name}: unsupported SET version ${version}.`);
  const unitScale = Number(r.next("unit scale")), palette = r.next("palette"), geometry = r.next("geometry"), geometryScale = Number(r.next("geometry scale"));
  label("fogR"); const colour = numbers(r.next("fog colour")); label("fogVel"); const velocity = numbers(r.next("fog velocity")); const range = numbers(r.next("fog range")); const temperature = Number(r.next("fog temperature"));
  label("waterHeight"); const water = numbers(r.next("water"));
  label("useEnviroModel"); const environment = r.next("environment model").split(",");
  label("transparentWaterFlag"); const transparentWater = r.count("transparent water") !== 0;
  label("hasSky"); const hasSky = r.count("has sky") !== 0; const skyFields = r.next("sky").split(",");
  label("useWorldGeometryFlag"); const worldFields = r.next("world geometry").split(",");
  label("weatherType"); const weatherType = r.count("weather type");
  label("lightCount"); const lights: SetLight[] = [];
  for (let i = 0, count = r.count("light count"); i < count; i++) {
    label("-- light name"); const lightName = r.next("light name");
    label("pos"); const position = numbers(r.next("position")); label("orient"); const orientation = numbers(r.next("orientation"));
    label("fov"); const fov = Number(r.next("fov")); label("aspect"); const aspect = Number(r.next("aspect")); label("intensity"); const intensity = Number(r.next("intensity")); label("type"); const type = Number(r.next("type"));
    label("R,G,B"); const colourAndAttenuation = numbers(r.next("colour and attenuation")); label("sizeX"); const size = numbers(r.next("size"));
    label("filterCount"); const filterCount = r.count("filter count");
    label("blendFilter"); const blendFilter = Number(r.next("blend filter"));
    const filters = Array.from({ length: filterCount }, () => r.next("filter"));
    label("filterFrame"); const filterFrame = Number(r.next("filter frame"));
    label("moveFilter"); const filterMotion = numbers(r.next("filter motion")); label("onTime"); const timing = numbers(r.next("timing"));
    label("visible"); const visibleIn = Array.from({ length: r.count("visibility count") }, () => numbers(r.next("visibility record")));
    lights.push({ name: lightName, position, orientation, fov, aspect, intensity, type, colourAndAttenuation, size, filters, blendFilter, filterFrame, filterMotion, timing, visibleIn });
  }
  label("cameraCount"); const cameras: SetCamera[] = [];
  for (let i = 0, count = r.count("camera count"); i < count; i++) {
    label("-- camera name"); const cameraName = r.next("camera name"); label("pos"); const position = numbers(r.next("position")); label("orient"); const orientation = numbers(r.next("orientation")); label("fov"); const fov = Number(r.next("fov"));
    label("vmat"); const viewMatrix = [numbers(r.next("view matrix row")), numbers(r.next("view matrix row")), numbers(r.next("view matrix row"))];
    const usesGlobalFog = r.count("global fog flag") !== 0;
    let cameraFog: SetCamera["fog"] = null;
    if (!usesGlobalFog) { label("fogR"); const c = numbers(r.next("fog colour")); label("fogVel"); const v = numbers(r.next("fog velocity")); const d = numbers(r.next("fog range")); const t = Number(r.next("fog temperature")); cameraFog = { colour: c, velocity: v, range: d, temperature: t }; }
    label("box min"); const boxMin = numbers(r.next("box min")), boxMax = numbers(r.next("box max")); label("reverbPreset"); const reverbPreset = Number(r.next("reverb preset"));
    cameras.push({ name: cameraName, position, orientation, fov, viewMatrix, usesGlobalFog, fog: cameraFog, boxMin, boxMax, reverbPreset });
  }
  return { version, unitScale, palette, geometry, geometryScale, fog: { colour, velocity, range, temperature }, water, environmentModel: environment.slice(1).join(","), transparentWater, hasSky, sky: skyFields.slice(1).join(","), worldGeometry: worldFields.slice(1).join(","), weatherType, lights, cameras, trailingLines: r.lines.slice(r.index) };
}
