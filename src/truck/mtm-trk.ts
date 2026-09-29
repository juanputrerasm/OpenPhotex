/*
  The Monster Truck Madness truck manifest (.TRK): MTM1, MTM2 and the Community Patch "MTM2.1"
  form.

  It is an assembly manifest: model names, the four static wheel centres, the scrape hull,
  axle-bar and driveshaft layout, lights and sounds, as label/value line pairs. It holds no mass,
  spring rate, gearing or even a tire radius. Units are feet; axes are x lateral (+ right), y up,
  z longitudinal (+ forward). BinEdit's Truck.h labels the light fields "(ft)" outright, and the
  stock corpus agrees: BIGFOOT's anchors are +-4.292 ft apart with a 6.00 ft tire.

    MTM2    "MTM2 truckName" or "MTM2.1 truckName" header, then the truck name, unlabelled.
    MTM1    no header: it opens with the bare "truckName" label, then the name. It stores full
            model file names ("bigfoot.bin") where MTM2 stores stems ("bigfoot").

  Wheel anchors are three ".x"/".y"/".z" label/value pairs each ("faxle.rtire.static_bpos.x").
  Any label of that shape is gathered as an anchor, so the four wheels need no special case.

  Consolidated from JSTruckViewer's src/worker/trk-parser.js and JSTrackViewer's
  src/worker/truck/trk-parser.js (a port of it), which differed only in dialect dispatch, in
  whether a light's type property is matched exactly, and in output shape. See docs/TRUCKS.md.
*/
import type { Vec3 } from "./common.ts";

export type MtmTrkDialect = "MTM1" | "MTM2" | "MTM2.1";

export interface MtmTrkLight {
  index: number;
  /**
   * BinEdit's Truck.h enumerates 0 headlight, 1 brake, 3 roof, 4 special, 5 backup.
   * The property label is "type", matched here by prefix.
   */
  type?: number;
  pos?: Vec3;
  /** The fourth "body axis pos" value; null when the line has only three. */
  bitmapRadius?: number | null;
  heading?: number;
  pitch?: number;
  spinSpeed?: number;
  coneLength?: number;
  coneBaseRadius?: number;
  coneRimRadius?: number;
  coneTexture?: string;
  sourceBitmap?: string;
  msOn?: number;
  msOff?: number;
  /** Property labels exactly as written, for each property read. */
  propertyLabels: string[];
}

export interface MtmTrk {
  dialect: MtmTrkDialect;
  /** The header line as written ("MTM2 truckName"), or null for headerless MTM1. */
  header: string | null;
  truckName: string;
  /** "truckModelBaseName" (MTM2 stem) or "truckModelName" (MTM1 file name). */
  truckModelBaseName: string | null;
  /** "tireModelBaseName" or "tireModelName". */
  tireModelBaseName: string | null;
  axleModelName: string | null;
  shockTextureName: string | null;
  barTextureName: string | null;
  axlebarOffset: Vec3 | null;
  /** The MTM2.1 three-value form: front axle, rear axle and middle bar heights. */
  superiorAxlebarOffset: { frontAxleY: number; rearAxleY: number; middleY: number } | null;
  driveshaftPos: Vec3 | null;
  /** Every "<key>.x/.y/.z" group, keyed by <key>; the four wheels are "faxle.rtire.static_bpos" etc. */
  wheelAnchors: Record<string, Vec3>;
  scrapePoints: Vec3[];
  instrumentCluster: string | null;
  waveFiles: string[];
  numberOfLights: number | null;
  lights: MtmTrkLight[];
  /** Any other label/value pair, verbatim, last occurrence wins. */
  unknownFields: Record<string, string>;
}

/** The four wheel anchor keys: front pair first, right before left, as the TRK lists them. */
export const MTM_WHEEL_KEYS = [
  "faxle.rtire.static_bpos",
  "faxle.ltire.static_bpos",
  "raxle.rtire.static_bpos",
  "raxle.ltire.static_bpos",
] as const;

/**
 * Parse an MTM1/MTM2 TRK already split by `truckManifestLines`.
 *
 * Any line set that is not an MTM2 header is read as MTM1, the headerless dialect; use
 * `detectTruckManifest` first to refuse Evo and CPR manifests.
 */
export function parseMtmTrkLines(input: readonly string[]): MtmTrk {
  const lines = [...input];
  const headerLine = lines[0] ?? "";
  const upperHeader = headerLine.toUpperCase();
  const isMtm2 = upperHeader.startsWith("MTM2");
  const isMtm1 = !isMtm2 && upperHeader.startsWith("TRUCKNAME");
  if (isMtm2 || isMtm1) lines.shift();
  const truckName = lines.shift() ?? "";

  const trk: MtmTrk = {
    dialect: isMtm1 ? "MTM1" : upperHeader.startsWith("MTM2.1") ? "MTM2.1" : "MTM2",
    header: isMtm2 ? headerLine : null,
    truckName,
    truckModelBaseName: null,
    tireModelBaseName: null,
    axleModelName: null,
    shockTextureName: null,
    barTextureName: null,
    axlebarOffset: null,
    superiorAxlebarOffset: null,
    driveshaftPos: null,
    wheelAnchors: {},
    scrapePoints: [],
    instrumentCluster: null,
    waveFiles: [],
    numberOfLights: null,
    lights: [],
    unknownFields: {},
  };
  const lights: (MtmTrkLight | null)[] = [];
  const partialAnchors = new Map<string, Vec3>();

  for (let i = 0; i < lines.length; i++) {
    const label = lines[i];
    const value = lines[i + 1] ?? "";

    if (label === "truckModelBaseName" || label === "truckModelName") { trk.truckModelBaseName = value; i++; continue; }
    if (label === "tireModelBaseName" || label === "tireModelName") { trk.tireModelBaseName = value; i++; continue; }
    if (label === "axleModelName") { trk.axleModelName = value; i++; continue; }
    if (label === "shockTextureName") { trk.shockTextureName = value; i++; continue; }
    if (label === "barTextureName") { trk.barTextureName = value; i++; continue; }
    if (label === "axlebarOffset") { trk.axlebarOffset = vec3(value); i++; continue; }
    if (label === "superiorAxlebarOffset") {
      const [frontAxleY = "0", rearAxleY = "0", middleY = "0"] = value.split(",");
      trk.superiorAxlebarOffset = { frontAxleY: float(frontAxleY), rearAxleY: float(rearAxleY), middleY: float(middleY) };
      i++;
      continue;
    }
    if (label === "driveshaftPos") { trk.driveshaftPos = vec3(value); i++; continue; }
    if (label.startsWith("Scrape point ")) { trk.scrapePoints.push(vec3(value)); i++; continue; }
    if (label === "Instrument Cluster") { trk.instrumentCluster = value; i++; continue; }
    if (label === "Wave File") {
      trk.waveFiles.push(value);
      i++;
      while (i + 1 < lines.length && !isMtmTrkLabel(lines[i + 1])) trk.waveFiles.push(lines[++i]);
      continue;
    }
    if (label === "Number of Lights") { trk.numberOfLights = Number.parseInt(value, 10) || 0; i++; continue; }

    const lightMatch = label.match(/^Light (\d+) /);
    if (lightMatch) {
      const index = Number.parseInt(lightMatch[1], 10);
      while (lights.length <= index) lights.push(null);
      const light = (lights[index] ??= { index, propertyLabels: [] });
      const property = label.slice(lightMatch[0].length).trim();
      light.propertyLabels.push(property);
      if (property.startsWith("body axis pos")) {
        const parts = value.split(",").map((v) => float(v));
        light.pos = { x: parts[0] ?? 0, y: parts[1] ?? 0, z: parts[2] ?? 0 };
        light.bitmapRadius = parts[3] ?? null;
      } else if (property.startsWith("type")) {
        light.type = Number.parseInt(value, 10) || 0;
      } else if (property.startsWith("heading")) {
        const parts = value.split(",").map((v) => float(v));
        light.heading = parts[0] ?? 0;
        light.pitch = parts[1] ?? 0;
        light.spinSpeed = parts[2] ?? 0;
      } else if (property.startsWith("cone:")) {
        const parts = value.split(",");
        light.coneLength = float(parts[0]);
        light.coneBaseRadius = float(parts[1]);
        light.coneRimRadius = float(parts[2]);
        light.coneTexture = (parts[3] ?? "").trim();
      } else if (property.startsWith("source:")) {
        light.sourceBitmap = value.trim();
      } else if (property.startsWith("ms on")) {
        const [on, off] = value.split(",").map((v) => Number.parseInt(v, 10) || 0);
        light.msOn = on;
        light.msOff = off;
      }
      i++;
      continue;
    }

    const axisMatch = label.match(/^(.*)\.(x|y|z)$/i);
    if (axisMatch) {
      const key = axisMatch[1];
      const axis = axisMatch[2].toLowerCase() as "x" | "y" | "z";
      const current = partialAnchors.get(key) ?? { x: 0, y: 0, z: 0 };
      current[axis] = float(value);
      partialAnchors.set(key, current);
      i++;
      continue;
    }

    trk.unknownFields[label] = value;
    i++;
  }

  for (const [key, vec] of partialAnchors) trk.wheelAnchors[key] = vec;
  trk.lights = lights.filter((light): light is MtmTrkLight => light !== null);
  return trk;
}

/** The labels that end a "Wave File" run. */
function isMtmTrkLabel(line: string): boolean {
  return line === "truckModelBaseName" || line === "truckModelName" || line === "tireModelBaseName"
    || line === "tireModelName" || line === "axleModelName" || line === "shockTextureName"
    || line === "barTextureName" || line === "axlebarOffset" || line === "superiorAxlebarOffset"
    || line === "driveshaftPos" || line === "Instrument Cluster" || line === "Wave File"
    || line === "Number of Lights" || line.startsWith("Scrape point ") || /^Light \d+ /.test(line)
    || /^(.*)\.(x|y|z)$/i.test(line);
}

/** `parseFloat(v) || 0`: NaN and -0 become 0, as every copy of this reader has always read them. */
function float(value: string | undefined): number {
  return Number.parseFloat(value ?? "") || 0;
}

function vec3(value: string): Vec3 {
  const [x = "0", y = "0", z = "0"] = value.split(",");
  return { x: float(x), y: float(y), z: float(z) };
}
