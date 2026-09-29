/*
  Telling truck and car manifest dialects apart.

  All of them are label/value text and several open alike, so the order of the checks matters:

    1. 4x4 Evolution opens with a "version" / 6|7 pair.
    2. A CPR car opens with "truckName" like an MTM1 truck, but carries a helmet or pace-car
       label no truck has.
    3. MTM2 opens with an "MTM2..." header; MTM1 with the bare "truckName" label.
*/
import { truckManifestLines } from "./common.ts";
import { isCprCarLines, parseCprCarLines, type CprCar } from "./cpr-car.ts";
import { parseMtmTrkLines, type MtmTrk } from "./mtm-trk.ts";
import { isEvoTrkLines, parseEvoTrkLines, type EvoTrk } from "../evo/trk.ts";

export type TruckManifestKind = "evo" | "cpr-car" | "mtm";

export type TruckManifest =
  | { kind: "mtm"; manifest: MtmTrk }
  | { kind: "cpr-car"; manifest: CprCar }
  | { kind: "evo"; manifest: EvoTrk };

/** Which dialect these manifest lines are. Anything not Evo or CPR is read as MTM. */
export function detectTruckManifest(lines: readonly string[]): TruckManifestKind {
  if (isEvoTrkLines(lines)) return "evo";
  if (isCprCarLines(lines)) return "cpr-car";
  return "mtm";
}

/** Parse any truck or car manifest, whichever dialect it is. */
export function parseTruckManifest(input: Uint8Array | string, sourceName = "manifest"): TruckManifest {
  const lines = truckManifestLines(input);
  const kind = detectTruckManifest(lines);
  if (kind === "evo") return { kind, manifest: parseEvoTrkLines(lines, sourceName) };
  if (kind === "cpr-car") return { kind, manifest: parseCprCarLines(lines) };
  return { kind, manifest: parseMtmTrkLines(lines) };
}
