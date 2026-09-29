/*
  CART Precision Racing car manifests (VEHICLE\<car>.CAR).

  The same label/value text as an MTM1 truck manifest, which is why detection needs more than
  the first line: a CAR opens with "truckName" (or "gtruckName") exactly as an MTM1 TRK does,
  and is told apart by carrying a "Helmet name" or "paceCarFlag" label, which no truck has.

  Differences from a TRK:

    - "tireModelName" is followed by FOUR model names, one per wheel, in the file order front
      left, front right, rear left, rear right (the TRK wheel keys' left-first order).
    - A helmet model and its position; the pace car flag and its tire radius.
    - "Wave File" is followed directly by its run of names, with no first value of its own.

  Ported from JSTruckViewer's src/worker/cpr/car-parser.js, the only implementation.
*/
import type { Vec3 } from "./common.ts";

export interface CprCar {
  /** "truckName" or "gtruckName", as written. */
  headerLabel: string;
  truckName: string;
  /** The body model: "truckModelName". */
  truckModelName: string | null;
  /** The four wheel models, in file order (front left, front right, rear left, rear right). */
  tireModelNames: string[];
  /** The same models keyed by wheel anchor key. */
  wheelModelNames: Record<string, string>;
  helmetModelName: string | null;
  helmetPosition: Vec3 | null;
  paceCarFlag: number | null;
  paceCarTireRadius: number | null;
  wheelAnchors: Record<string, Vec3>;
  scrapePoints: Vec3[];
  instrumentCluster: string | null;
  waveFiles: string[];
  unknownFields: Record<string, string>;
}

/** The order a CAR lists its four wheel models in. */
export const CPR_WHEEL_KEYS_IN_FILE_ORDER = [
  "faxle.ltire.static_bpos",
  "faxle.rtire.static_bpos",
  "raxle.ltire.static_bpos",
  "raxle.rtire.static_bpos",
] as const;

/** True when these manifest lines are a CPR car rather than an MTM1 truck. */
export function isCprCarLines(lines: readonly string[]): boolean {
  return (lines[0] === "truckName" || lines[0] === "gtruckName")
    && lines.some((line) => line === "Helmet name" || line === "paceCarFlag");
}

/**
 * Parse a CPR CAR already split by `truckManifestLines`.
 *
 * @throws Error when the first line is not "truckName" or "gtruckName".
 */
export function parseCprCarLines(lines: readonly string[]): CprCar {
  let index = 0;
  const headerLabel = lines[index++] ?? "";
  if (headerLabel !== "truckName" && headerLabel !== "gtruckName") {
    throw new Error(`Unsupported CPR CAR header: ${headerLabel || "<empty>"}`);
  }
  const car: CprCar = {
    headerLabel,
    truckName: lines[index++] ?? "",
    truckModelName: null,
    tireModelNames: [],
    wheelModelNames: {},
    helmetModelName: null,
    helmetPosition: null,
    paceCarFlag: null,
    paceCarTireRadius: null,
    wheelAnchors: {},
    scrapePoints: [],
    instrumentCluster: null,
    waveFiles: [],
    unknownFields: {},
  };

  const partialAnchors = new Map<string, Vec3>();
  while (index < lines.length) {
    const label = lines[index++];
    if (label === "truckModelName") { car.truckModelName = lines[index++] ?? ""; continue; }
    if (label === "tireModelName") {
      car.tireModelNames = lines.slice(index, index + 4);
      index += car.tireModelNames.length;
      car.tireModelNames.forEach((name, i) => (car.wheelModelNames[CPR_WHEEL_KEYS_IN_FILE_ORDER[i]] = name));
      continue;
    }
    if (label.startsWith("Scrape point ")) { car.scrapePoints.push(vec3(lines[index++])); continue; }
    if (label === "Instrument Cluster") { car.instrumentCluster = lines[index++] ?? ""; continue; }
    if (label === "Wave File") {
      while (index < lines.length && !isCarLabel(lines[index])) car.waveFiles.push(lines[index++]);
      continue;
    }
    if (label === "Helmet name") { car.helmetModelName = lines[index++] ?? ""; continue; }
    if (label === "Helmet pos") { car.helmetPosition = vec3(lines[index++]); continue; }
    if (label === "paceCarFlag") { car.paceCarFlag = Number.parseInt(lines[index++] ?? "0", 10) || 0; continue; }
    if (label === "paceCarTireRadius") { car.paceCarTireRadius = Number.parseFloat(lines[index++] ?? "0") || 0; continue; }

    const axisMatch = label.match(/^(.*)\.(x|y|z)$/i);
    if (axisMatch) {
      const key = axisMatch[1];
      const axis = axisMatch[2].toLowerCase() as "x" | "y" | "z";
      const current = partialAnchors.get(key) ?? { x: 0, y: 0, z: 0 };
      current[axis] = Number.parseFloat(lines[index++] ?? "0") || 0;
      partialAnchors.set(key, current);
      continue;
    }
    car.unknownFields[label] = lines[index++] ?? "";
  }
  for (const [key, value] of partialAnchors) car.wheelAnchors[key] = value;
  return car;
}

function isCarLabel(line: string): boolean {
  return line === "truckModelName" || line === "tireModelName" || line === "Instrument Cluster"
    || line === "Wave File" || line === "Helmet name" || line === "Helmet pos" || line === "paceCarFlag"
    || line === "paceCarTireRadius" || line.startsWith("Scrape point ") || /^(.*)\.(x|y|z)$/i.test(line);
}

function vec3(value = ""): Vec3 {
  const [x = "0", y = "0", z = "0"] = value.split(",");
  return { x: Number.parseFloat(x) || 0, y: Number.parseFloat(y) || 0, z: Number.parseFloat(z) || 0 };
}
