/*
  Writing MTM2 levels and trucks: the .SIT scene script, the .LVL, the .TEX list, the .LTE light
  grid, the empty ground-box grids, and the 2.1 truck manifest.

  Each writer lays out a file the way the stock ones are laid out, with the stock values in
  every field the caller does not supply. What goes into the fields (where a converted object
  stands, which box type it gets, which course the field follows) is the caller's.

  Ported from JSMTM2Converter's src/formats/mtm2/track-writer.js and truck-writer.js, the only
  writers, which keep their conversion policy. Every writer here is checked by reading its output
  back with parseMtmSit, parseMtmLvl, parseTexList and parseMtmTrkLines.
*/
import type { Vec3 } from "../truck/common.ts";
import { MTM_WHEEL_KEYS } from "../truck/mtm-trk.ts";
import { encodeWindows1252 } from "../text.ts";

const CRLF = "\r\n";

/**
 * A SIT value: a number is written with two decimals, as stock SITs write positions and angles;
 * a string is written as given, for a caller that has already formatted it.
 */
export type SitValue = number | string;
export type SitTriple = readonly [SitValue, SitValue, SitValue];

/** A truck record: the "Your Truck" slot or a grid vehicle. */
export interface Mtm2SitTruck {
  /** Default "POWERBIG.TRK", the stock grid's placeholder; the player's pick replaces it. */
  truckFile?: string;
  /** ipos: x, altitude, z in the SIT's own units. */
  position: SitTriple;
  /** theta, phi, psi. */
  orient: SitTriple;
  /** "!ap.courseToFollow": every racer follows extended course 2 in all fifteen stock levels. */
  courseToFollow?: number;
  /**
   * A truck in the middle of a race, as MONSTER.EXE's own writer (0x4c0360) prints it for "Save situation" and a
   * saved game: its motion, gear, autopilot, damage and race progress. Without it the record is a stock grid slot,
   * at rest with a zeroed race state and no `@damageCode` line.
   */
  state?: Mtm2SitTruckState;
}

/** A truck's live state in a SIT record (0x4c0360). Times are seconds; positions and speeds feet. */
export interface Mtm2SitTruckState {
  /** bvel: body-axis velocity, ft/s. */
  bvel: readonly [number, number, number];
  /** p, q, r: body rates, rad/s. */
  rates: readonly [number, number, number];
  /** faxle.angle, faxle.steering_angle and the rear axle's. */
  frontAxle?: readonly [number, number];
  rearAxle?: readonly [number, number];
  /** The tires' on-ground flags, right then left, as the game keeps them (-1 and 1 at rest). */
  frontOnGround?: readonly [number, number];
  rearOnGround?: readonly [number, number];
  /** xm.gear (`+0x58c`): 0 reverse ... 4 first; the game's numbering. */
  gear: number;
  /** ap.autopilot (1 on) and ap.cnumber, the course segment it follows. */
  autopilot: number;
  cnumber: number;
  /** ap.speed_control, ap.course_control, ap.lasterror. */
  apControl?: readonly [number, number, number];
  /** `@damageCode` (`+0x1764`), the 32-bit crash damage code. */
  damageCode: number;
  /** heliTimer, heliTheta, heliPhi, heliPsi, and heliPos. */
  heli?: readonly [number, number, number, number];
  heliPos?: readonly [number, number, number];
  /** segments (`+0x8f0`), laps (`+0x8f4`), staged (`+0x8fc`), bonusLaps (`+0x900`), finishedRace (`+0x904`), nextcheckpoint (`+0xfa8`). */
  segments: number;
  laps: number;
  staged?: number;
  bonusLaps?: number;
  finished: number;
  nextCheckpoint: number;
  /** totalracetime (`+0xfa4`), fastestLap (`+0xfa0`), dragTimer (`+0x90c`). */
  totalRaceTime: number;
  fastestLap: number;
  dragTimer?: number;
  /** Up to 20 laps' times (`+0xf50`), and each lap's up to 20 checkpoint times (`+0x910`); missing ones are 0. */
  lapTimes: readonly number[];
  checkpointTimes: readonly (readonly number[])[];
}

/** A *** Ramps *** record: a model, or a wedge's length, width and height. */
export interface Mtm2SitRamp {
  position: SitTriple;
  orient: SitTriple;
  modelName?: string;
  extents?: SitTriple;
  /** A number is written with six decimals. */
  mass?: SitValue;
  /** Default "0,0,0". */
  bvel?: SitTriple;
  /** p, q, r. Default "0,0,0". */
  rates?: SitTriple;
}

/** A *** Boxes *** record: a model, or a checkpoint's extents. */
export interface Mtm2SitBox extends Mtm2SitRamp {
  /** 0 normal, 6 checkpoint, 7 drive thru, 8 always face. */
  type: number;
  flags?: number;
  /** Default 0. */
  priority?: number;
  /** The "@sound effect entries": the sound when something hits the box, then its own loop. Default "NULL.WAV". */
  hitSound?: string;
  loopSound?: string;
  /**
   * The `L` block's twelve fields (rad, hgt, r, g, b, glow, glowRad, coneLen, coneRim, coneBase,
   * bright, aimOff), written after the sounds when given. Community Patch 3 reads it on type 12.
   */
  light?: readonly SitValue[];
}

/** A *** Top Crush *** record: the base model at `position`, the keyframed cab at `position2`. */
export interface Mtm2SitTopCrush {
  position: SitTriple;
  position2: SitTriple;
  orient: SitTriple;
  /** Written "NULL" when absent. */
  modelName?: string;
  cabModelName?: string;
  mass?: SitValue;
  bvel?: SitTriple;
  rates?: SitTriple;
}

export interface Mtm2SitCourseSegment {
  start: SitTriple;
  end: SitTriple;
  speedLimit?: SitValue;
  trackWidth?: SitValue;
  /** The `ctype,cspeed_type` value. Default "1,0", a straight. */
  types?: string;
  /** The `cdec_point,cspeed,lastentry` value. Default "30,0,0". */
  speeds?: string;
}

/** The *** Stadium *** record. */
export interface Mtm2SitStadium {
  /** The MTM2 form `!stadiumFlag,x,z,sx,sz,stadiumModelName`; false writes `stadiumFlag,stadiumModelName`. Default true. */
  placed?: boolean;
  /** 1 for an arena. */
  flag: number;
  x?: number;
  z?: number;
  sx?: number;
  sz?: number;
  modelName: string;
}

export interface Mtm2Sit {
  /** Line 0: the level file. */
  lvlName: string;
  trackName: string;
  /** Default "EVO CONVERSION" is the converter's; stock files name a place. */
  localeName: string;
  /** Default "7947984,7947988". */
  longitudeLatitude?: string;
  /** Write the MTM2 "!ambient sound,track length,weather mask" lines. Default true; MTM1 has none. */
  ambientLine?: boolean;
  /** The saved race-state values, as written. Defaults "0,16384,-16383,24832,98304", "0,0,0", "0,1,0,0,0" and "0,0". */
  viewState?: string;
  raceTimes?: string;
  controlFlags?: string;
  stageFlags?: string;
  /** The track PICTURE (257x210): "Track Logo" holds it in every stock level, despite the name. */
  pictureBmp: string;
  /** The 32x24 list ICON, in the slot named "Track Map". */
  iconBmp: string;
  /** Default "Sonic". */
  flyByAvi?: string;
  /** Default "Track". */
  announcerWav?: string;
  descriptionTxt: string;
  raceType?: number;
  /** Default 2. */
  redbookTrack?: number;
  ambientSound?: number;
  trackLength?: SitValue;
  weatherMask?: number;
  yourTruck: Mtm2SitTruck;
  /** The grid; stock levels have 8. */
  vehicles: Mtm2SitTruck[];
  /** Default none. */
  ramps?: Mtm2SitRamp[];
  boxes: Mtm2SitBox[];
  /** The *** Cylinders *** count and its lines, written as given. Default none. */
  cylinders?: { count: number; lines: readonly string[] };
  /** Default none. */
  topCrush?: Mtm2SitTopCrush[];
  course: Mtm2SitCourseSegment[];
  /** Default 0. */
  courseDirection?: number;
  /** The four extended courses; a null or missing slot is written empty ("0,0"). */
  extendedCourses: (Mtm2SitCourseSegment[] | null)[];
  /** Default 0 for each slot. */
  extendedCourseDirections?: readonly number[];
  /** Default off: "stadiumFlag,stadiumModelName" / "0,none". */
  stadium?: Mtm2SitStadium;
  /** Default type 0 and no models. */
  backdrop?: { type?: number; modelNames: readonly string[] };
}

/*
  An MTM2 .SIT. Unless the caller gives them, ramps, cylinders and top-crush parts are written
  empty, the stadium off and the backdrop empty; the truck records carry a zeroed race state and
  20 empty laps of 20 checkpoint times each, as the stock files do. Every line ends CRLF.
*/
export function writeMtm2Sit(sit: Mtm2Sit): Uint8Array {
  const out = [
    sit.lvlName, "!Race Track Name", clean(sit.trackName), "Race Track Locale", sit.localeName,
    "Track Longtitude, Latitude", sit.longitudeLatitude ?? "7947984,7947988", "Track Logo .BMP file", sit.pictureBmp,
    "Track Map .BMP file", sit.iconBmp, "Track Fly-By .AVI file", sit.flyByAvi ?? "Sonic", "Track Announcer .WAV file", sit.announcerWav ?? "Track",
    "Track Description .TXT file", sit.descriptionTxt, "Track Race Type", String(sit.raceType ?? 0), "@Redbook Audio Track", String(sit.redbookTrack ?? 2),
  ];
  if (sit.ambientLine ?? true) {
    out.push("!ambient sound,track length,weather mask", `${sit.ambientSound ?? 0},${num(sit.trackLength)},${sit.weatherMask ?? 0}`);
  }
  out.push("viewmode,spotd,spotp,spoth,zoom", sit.viewState ?? "0,16384,-16383,24832,98304",
    "$racetime, raceStartTime, dragDebugTimer", sit.raceTimes ?? "0,0,0",
    "controlflag, autoShift, autoStage, bothStaged, bothStagedPrev", sit.controlFlags ?? "0,1,0,0,0",
    "stageComFlag, bonusLapFlag", sit.stageFlags ?? "0,0");
  out.push("*** Your Truck (Not used anymore) ***", "*********************************************");
  truck(out, sit.yourTruck);
  out.push("*** Vehicles ***", String(sit.vehicles.length));
  for (const vehicle of sit.vehicles) { out.push("*********************************************"); truck(out, vehicle); }
  const ramps = sit.ramps ?? [];
  out.push("*** Ramps ***", String(ramps.length));
  for (const ramp of ramps) record(out, ramp);
  out.push("*** Boxes ***", String(sit.boxes.length));
  for (const box of sit.boxes) {
    record(out, box);
    out.push("!type,flags", `${box.type},${box.flags ?? 0}`, "priority", String(box.priority ?? 0),
      "@sound effect entries", box.hitSound ?? "NULL.WAV", box.loopSound ?? "NULL.WAV", "0,0");
    if (box.light) out.push("Llight rad,hgt,r,g,b,glow,glowRad,coneLen,coneRim,coneBase,bright,aimOff", box.light.map(num).join(","));
  }
  out.push("*** Cylinders ***", String(sit.cylinders?.count ?? 0), ...(sit.cylinders?.lines ?? []));
  const crushes = sit.topCrush ?? [];
  out.push("*** Top Crush ***", String(crushes.length));
  for (const car of crushes) {
    out.push("*********************************************", "ipos", triple(car.position), "ipos2", triple(car.position2),
      "theta,phi,psi", triple(car.orient), "modelName", car.modelName || "NULL", "cabModelName", car.cabModelName || "NULL",
      "mass", mass(car.mass), "bvel", car.bvel ? triple(car.bvel) : "0,0,0", "p,q,r", car.rates ? triple(car.rates) : "0,0,0");
  }
  out.push("*** Course ***", "c1Count,course_direction");
  course(out, sit.course, sit.courseDirection ?? 0);
  out.push("@*********** Extended Course Definitions *************", "4");
  for (let i = 0; i < 4; i++) {
    out.push(`[Course ${i + 1}] c1Count,course_direction`);
    course(out, sit.extendedCourses[i] ?? [], sit.extendedCourseDirections?.[i] ?? 0);
  }
  const stadium = sit.stadium;
  if (!stadium) out.push("*** Stadium ***", "stadiumFlag,stadiumModelName", "0,none");
  else if (stadium.placed ?? true) {
    out.push("*** Stadium ***", "!stadiumFlag,x,z,sx,sz,stadiumModelName",
      `${stadium.flag},${stadium.x ?? 0},${stadium.z ?? 0},${stadium.sx ?? 0},${stadium.sz ?? 0},${stadium.modelName}`);
  } else out.push("*** Stadium ***", "stadiumFlag,stadiumModelName", `${stadium.flag},${stadium.modelName}`);
  const backdrops = sit.backdrop?.modelNames ?? [];
  out.push("*** Backdrop ***", "backdropType,backdropCount", `${sit.backdrop?.type ?? 0},${backdrops.length}`, "backdropModelName",
    ...(backdrops.length ? backdrops : [""]));
  return text(out.map((line) => `${line}\n`).join(""));
}

/** The lines a ramp and a box share: placement, model or size, mass and motion. */
function record(out: string[], box: Mtm2SitRamp): void {
  out.push("*********************************************", "ipos", triple(box.position), "theta,phi,psi", triple(box.orient));
  if (box.extents) out.push("length,width,height", triple(box.extents));
  else out.push("model", box.modelName ?? "");
  out.push("mass", mass(box.mass), "bvel", box.bvel ? triple(box.bvel) : "0,0,0", "p,q,r", box.rates ? triple(box.rates) : "0,0,0");
}

function mass(value: SitValue | undefined): string {
  return typeof value === "string" ? value : (value ?? 0).toFixed(6);
}

function truck(out: string[], vehicle: Mtm2SitTruck): void {
  const s = vehicle.state;
  if (!s) {
    out.push("truckFile", vehicle.truckFile ?? "POWERBIG.TRK", "ipos", triple(vehicle.position), "bvel", "0,0,0", "theta,phi,psi", triple(vehicle.orient),
      "p,q,r", "0,0,0", "faxle.angle,faxle.steering_angle", "0,0", "faxle.rtire.on_gnd,faxle.ltire.on_gnd", "-1,1",
      "raxle.angle,raxle.steering_angle", "0,0", "raxle.rtire.on_gnd,raxle.ltire.on_gnd", "-1,1", "xm.gear", "4",
      "ap.autopilot,ap.cnumber", "0,1", "ap.speed_control,ap.course_control,ap.lasterror", "0,0,0", "!ap.courseToFollow", String(vehicle.courseToFollow ?? 2),
      "$heliTimer,heliTheta,heliPhi,heliPsi", "0,0,0,0", "heliPos", "0,0,0", "^segments,laps,staged,bonusLaps,finishedRace,nextcheckpoint", "0,0,0,0,0,0", "totalracetime,fastestLap,dragTimer", "0,0,0");
    for (let lap = 0; lap < 20; lap++) out.push("***Lap time***", "0", "*****Checkpoint times*****", ...Array<string>(20).fill("0"));
    return;
  }
  // As 0x4c0360 prints a live truck: floats with six decimals (`%f`), the damage code unsigned (`%u`).
  const f = (v: number | undefined) => Number(v || 0).toFixed(6);
  const fs = (vs: readonly (number | undefined)[]) => vs.map(f).join(",");
  const i = (v: number | undefined) => String(Math.trunc(Number(v || 0)));
  out.push("truckFile", vehicle.truckFile ?? "POWERBIG.TRK", "ipos", fs(vehicle.position.map(Number)), "bvel", fs(s.bvel),
    "theta,phi,psi", fs(vehicle.orient.map(Number)), "p,q,r", fs(s.rates),
    "faxle.angle,faxle.steering_angle", fs(s.frontAxle ?? [0, 0]), "faxle.rtire.on_gnd,faxle.ltire.on_gnd", (s.frontOnGround ?? [-1, 1]).map(i).join(","),
    "raxle.angle,raxle.steering_angle", fs(s.rearAxle ?? [0, 0]), "raxle.rtire.on_gnd,raxle.ltire.on_gnd", (s.rearOnGround ?? [-1, 1]).map(i).join(","),
    "xm.gear", i(s.gear), "ap.autopilot,ap.cnumber", `${i(s.autopilot)},${i(s.cnumber)}`,
    "ap.speed_control,ap.course_control,ap.lasterror", fs(s.apControl ?? [0, 0, 0]), "!ap.courseToFollow", String(vehicle.courseToFollow ?? 2),
    "@damageCode", String(s.damageCode >>> 0),
    "$heliTimer,heliTheta,heliPhi,heliPsi", fs(s.heli ?? [0, 0, 0, 0]), "heliPos", fs(s.heliPos ?? [0, 0, 0]),
    "^segments,laps,staged,bonusLaps,finishedRace,nextcheckpoint",
    [s.segments, s.laps, s.staged, s.bonusLaps, s.finished, s.nextCheckpoint].map(i).join(","),
    "totalracetime,fastestLap,dragTimer", fs([s.totalRaceTime, s.fastestLap, s.dragTimer]));
  for (let lap = 0; lap < 20; lap++) {
    out.push("***Lap time***", f(s.lapTimes[lap]), "*****Checkpoint times*****", ...Array.from({ length: 20 }, (_, k) => f(s.checkpointTimes[lap]?.[k])));
  }
}

/**
 * The lines of one SIT truck record (after its delimiter), as `writeMtm2Sit` writes it: for a caller that rewrites
 * the vehicles of an existing SIT (`replaceSitVehicles`).
 */
export function sitTruckLines(vehicle: Mtm2SitTruck): string[] {
  const out: string[] = [];
  truck(out, vehicle);
  return out;
}

const RECORD_DELIMITER = "*********************************************";

/**
 * An existing SIT's text with its `*** Vehicles ***` section put in place of `vehicles`, and, when given, its
 * `$racetime, raceStartTime, dragDebugTimer` line: what MONSTER.EXE's "Save situation" writer (0x553230) changes in a
 * level's SIT, the live trucks and the race clock. The rest is kept line for line. Lines end CRLF.
 */
export function replaceSitVehicles(sitText: string, vehicles: readonly Mtm2SitTruck[], { raceTimes }: { raceTimes?: readonly number[] } = {}): string {
  const lines = sitText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim() === "*** Vehicles ***");
  if (start < 0) throw new Error("The SIT has no *** Vehicles *** section");
  let end = start + 1;
  while (end < lines.length && !/^\*\*\* \S/.test(lines[end].trim())) end++;
  const section = ["*** Vehicles ***", String(vehicles.length)];
  for (const vehicle of vehicles) section.push(RECORD_DELIMITER, ...sitTruckLines(vehicle));
  lines.splice(start, end - start, ...section);
  if (raceTimes) {
    const label = lines.findIndex((line) => line.trim().startsWith("$racetime"));
    if (label >= 0 && label + 1 < lines.length) lines[label + 1] = raceTimes.map((v) => Number(v || 0).toFixed(6)).join(",");
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.join(CRLF) + CRLF;
}

function course(out: string[], segments: readonly Mtm2SitCourseSegment[], direction: number): void {
  out.push(`${segments.length},${direction}`);
  segments.forEach((segment, i) => out.push(`********************************************* ${2 * i + 1}`, "ctype,cspeed_type", segment.types ?? "1,0",
    "cstart", triple(segment.start), "cend", triple(segment.end),
    // Stock levels record 0 here (WAR's arena is the one exception at 16).
    "cdec_point,cspeed,lastentry", segment.speeds ?? "30,0,0", "&cSpeedLimit,cTrackWidth", `${num(segment.speedLimit)},${num(segment.trackWidth)}`));
}

/** An MTM2 .LVL. Every name is written as given; the side files share the level's stem in stock levels. */
export interface Mtm2Lvl {
  /** Line 1. */
  descriptionTxt: string;
  rawName: string;
  clrName: string;
  /** The level palette; its fog map is `fogName`. */
  actName: string;
  texName: string;
  /** Line 6. Default "ZERO.RAW". */
  line6?: string;
  pupName: string;
  aniName: string;
  tdfName: string;
  /** Default "CLOUDY2.RAW" and "CLOUDY2.ACT". */
  skyRawName?: string;
  skyActName?: string;
  defName: string;
  navName: string;
  /** Default "ROCKX.WAV". */
  musicName?: string;
  fogName: string;
  lteName: string;
  /** Line 17: the direction the sunlight travels, (east, up, north), 16.16 fixed point. */
  sunVector: readonly [number, number, number];
  /**
   * Lines 18-21. The same in all fifteen stock MTM2 levels apart from the shade scalar
   * (23000..40960): defaults 40960, "32000,-46333,0", 64000 and 255.
   */
  shadowIntensity?: number;
  sunPosition?: readonly [number, number, number];
  sunIntensity?: number;
  levelValue?: number;
  /** The value after the !waterHeight label, in the level's own height units. */
  waterHeight: number;
}

export function writeMtm2Lvl(lvl: Mtm2Lvl): Uint8Array {
  return text([
    "0", lvl.descriptionTxt, lvl.rawName, lvl.clrName, lvl.actName, lvl.texName,
    lvl.line6 ?? "ZERO.RAW", lvl.pupName, lvl.aniName, lvl.tdfName, lvl.skyRawName ?? "CLOUDY2.RAW", lvl.skyActName ?? "CLOUDY2.ACT",
    lvl.defName, lvl.navName, lvl.musicName ?? "ROCKX.WAV", lvl.fogName, lvl.lteName,
    lvl.sunVector.join(","), String(lvl.shadowIntensity ?? 40960), (lvl.sunPosition ?? [32000, -46333, 0]).join(","),
    String(lvl.sunIntensity ?? 64000), String(lvl.levelValue ?? 255), "!waterHeight", String(lvl.waterHeight), "",
  ].join("\n"));
}

/** A .TEX texture list: the count, then one name per line. */
export function writeTexList(names: readonly string[]): Uint8Array {
  return text(`${names.length}\n${names.join("\n")}\n`);
}

/**
 * A .TTY texture type table: the count, then `name,value` per typed texture, where the value is
 * the surface type * 100 + its depth (see parseTty). An empty list writes "0".
 */
export function writeTty(entries: readonly { name: string; value: number }[]): Uint8Array {
  return text(`${entries.length}\n${entries.map((e) => `${e.name},${Math.trunc(e.value)}\n`).join("")}`);
}

/** A count-prefixed side file with no records (.TTY, .PUP, .ANI, .TDF, .DEF, .NAV). */
export function writeEmptyList(): Uint8Array {
  return text("0\n");
}

/*
  The ground-box grids, with no boxes anywhere.

  MTM2 derives these nine names from the .LVL's RAW entry and reads them for every level, so
  they are not optional: all fifteen stock MTM2 terrain sets ship the complete set, and a
  level that omits them leaves the engine's grids holding whatever the previous level put
  there. The "no boxes" values are the stock ones: zero lower and upper heights (RA0, RA1),
  zero face textures (CL0, CL1, CL2), and 0xFF in RA2 and RA3, which marks the second layer as
  solid rock rather than an open cavern at height zero. RA4 and RA5 are zero in every stock
  track. See decodeGroundBoxes and decodeHbUnderground for what the grids mean.
*/
export function emptyGroundBoxGrids(gridSize = 256): Record<"RA0" | "RA1" | "RA2" | "RA3" | "RA4" | "RA5" | "CL0" | "CL1" | "CL2", Uint8Array> {
  const cells = gridSize * gridSize;
  return {
    RA0: new Uint8Array(cells), RA1: new Uint8Array(cells),
    RA2: new Uint8Array(cells).fill(0xff), RA3: new Uint8Array(cells).fill(0xff),
    RA4: new Uint8Array(cells), RA5: new Uint8Array(cells),
    CL0: new Uint8Array(12 * cells), CL1: new Uint8Array(4 * cells), CL2: new Uint8Array(12 * cells),
  };
}

/*
  DATA\<stem>.LTE, MTM2's baked terrain light grid: seven bytes per cell, of which the first is
  the ground's and the other six a ground box's faces (left zero here).

  This is Traxx's BuildLte: the cell normal from four cross products over the 64-unit
  neighbourhood, wrapped at the grid's edges as MTM2's grid wraps, |nz| / length as the overhead
  term, plus a horizontal term. The 160..255 range is what stock MTM2 ships (ROCKQRY, SUMMIT1-3
  and TPARK).

  The horizontal term belongs to the .LVL sun vector. Traxx offers it as a five-way compass
  (Noon adds nothing, the other four add or subtract nx or ny), which is the sun's normalised
  horizontal direction dotted with (nx, ny). Regressing the stock grids against their own RAW
  settles the sign: levels whose vector starts +46333 match +nx (TPARK r=0.87, SUMMIT1 r=0.86)
  and the ones starting -46333 match -nx (BAJA r=0.90).

  `sun` is the .LVL line 17 direction in any scale; only its horizontal direction is used.
*/
export function buildMtm2Lte(raw: Uint8Array, sun: readonly [number, number, number]): Uint8Array {
  const out = new Uint8Array(256 * 256 * 7);
  const dark = 160, bright = 255;
  // The sun's compass direction in the grid's own axes: LVL east is grid x, LVL north grid y.
  const horizontal = Math.hypot(sun[0], sun[2]);
  const sunX = horizontal ? sun[0] / horizontal : 0, sunY = horizontal ? sun[2] / horizontal : 0;
  for (let y = 0; y < 256; y++) {
    const row = y << 8;
    for (let x = 0; x < 256; x++) {
      const height = raw[x + row];
      // West, south, east and north neighbours.
      const ring = [
        [-64, 0, raw[((x - 1) & 255) + row]],
        [0, 64, raw[x + (((y + 1) & 255) << 8)]],
        [64, 0, raw[((x + 1) & 255) + row]],
        [0, -64, raw[x + (((y - 1) & 255) << 8)]],
      ];
      let nx = 0, ny = 0, nz = 0;
      for (let i = 0; i < 4; i++) {
        const [x1, y1, z1] = ring[i], [x2, y2, z2] = ring[(i + 1) & 3];
        nx += y1 * (z2 - height) - y2 * (z1 - height);
        ny += x1 * (z2 - height) - x2 * (z1 - height);
        nz += x1 * y2 - x2 * y1;
      }
      const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      const facing = (Math.abs(nz) + sunX * nx + sunY * ny) / length;
      out[(x + row) * 7] = Math.max(8, Math.min(255, dark + Math.trunc((bright - dark) * facing)));
    }
  }
  return out;
}

/** The MTM2 2.1 truck manifest's fields, in the shape parseMtmTrkLines reads back. */
export interface Mtm2Trk {
  truckName: string;
  truckModelBaseName: string;
  tireModelBaseName: string;
  axleModelName: string;
  shockTextureName: string;
  barTextureName: string;
  axlebarOffset: Partial<Vec3> | null;
  driveshaftPos: Partial<Vec3> | null;
  /** Keyed by MTM_WHEEL_KEYS; a missing wheel is written at the origin. */
  wheelAnchors: Record<string, Partial<Vec3> | undefined>;
  scrapePoints: Partial<Vec3>[];
  instrumentCluster: string;
  waveFiles: string[];
  lights: Mtm2TrkLight[];
  /** The 2.1 second axle-bar set, written last as the extension appends it. */
  superiorAxlebarOffset?: { frontAxleY: number; rearAxleY: number; middleY: number } | null;
}

export interface Mtm2TrkLight {
  type?: number;
  pos?: Partial<Vec3>;
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
}

/*
  The MTM2 2.1 truck manifest: label/value lines, CRLF, no terminator. The field order is the
  stock order (a stock BIGFOOT.TRK ends on its last light's "0,0"), which the readers do not
  need but which keeps a written truck diffable against a hand-authored one.

    - Wheel anchors are grouped by AXIS, all four x, then all four y, then all four z.
    - Scrape points are one "Scrape point N body axis x,y,z" label per point, numbered from 1.
    - Numbers are written with six decimals.

  The "MTM2.1" header is what activates the patched engine's extended loading.

  Every value has to be on its own non-blank line: the readers drop blank lines and pair what is
  left, so one empty name (an MTM1 truck has no axle, shock or bar texture) shifts every later
  label onto the wrong value. An empty name, wave file or light bitmap therefore throws.
*/
export function writeMtm2Trk(truck: Mtm2Trk): Uint8Array {
  const lines: string[] = [];
  const pair = (label: string, value: string | number) => { lines.push(label, filled(label, value)); };
  const vec = (value: Partial<Vec3> | null | undefined) => `${six(value?.x)},${six(value?.y)},${six(value?.z)}`;

  pair("MTM2.1 truckName", truck.truckName);
  pair("truckModelBaseName", truck.truckModelBaseName);
  pair("tireModelBaseName", truck.tireModelBaseName);
  pair("axleModelName", truck.axleModelName);
  pair("shockTextureName", truck.shockTextureName);
  pair("barTextureName", truck.barTextureName);
  pair("axlebarOffset", vec(truck.axlebarOffset));
  pair("driveshaftPos", vec(truck.driveshaftPos));
  for (const axis of ["x", "y", "z"] as const) {
    for (const key of MTM_WHEEL_KEYS) pair(`${key}.${axis}`, six(truck.wheelAnchors[key]?.[axis]));
  }
  truck.scrapePoints.forEach((point, i) => pair(`Scrape point ${i + 1} body axis x,y,z`, vec(point)));
  pair("Instrument Cluster", truck.instrumentCluster);
  lines.push("Wave File", ...truck.waveFiles.map((name) => filled("Wave File", name)));
  pair("Number of Lights", truck.lights.length);
  truck.lights.forEach((light, i) => {
    pair(`Light ${i} type`, light.type ?? 0);
    pair(`Light ${i} body axis pos x,y,z (ft), bitmap radius (ft)`, `${vec(light.pos)},${six(light.bitmapRadius)}`);
    pair(`Light ${i} heading (rad), pitch (rad), heading spin speed (rad/sec)`, `${six(light.heading)},${six(light.pitch)},${six(light.spinSpeed)}`);
    pair(`Light ${i} cone: length (ft), base radius (ft), rim radius (ft), texture name`,
      `${six(light.coneLength)},${six(light.coneBaseRadius)},${six(light.coneRimRadius)},${light.coneTexture ?? ""}`);
    pair(`Light ${i} source: bitmap name`, light.sourceBitmap ?? "");
    pair(`Light ${i} ms on, ms off (0 if light doesn't blink)`, `${light.msOn ?? 0},${light.msOff ?? 0}`);
  });
  if (truck.superiorAxlebarOffset) {
    const { frontAxleY, rearAxleY, middleY } = truck.superiorAxlebarOffset;
    pair("superiorAxlebarOffset", `${six(frontAxleY)},${six(rearAxleY)},${six(middleY)}`);
  }
  return singleByte(lines.join(CRLF) + CRLF);
}

function filled(label: string, value: string | number | null | undefined): string {
  const text = String(value ?? "");
  if (!text.trim()) throw new RangeError(`${label} has no value; a truck manifest cannot carry an empty line.`);
  return text;
}

function six(value: unknown): string {
  const n = Number(value);
  return (Number.isFinite(n) ? n : 0).toFixed(6);
}

function num(value: SitValue | null | undefined): string {
  return typeof value === "string" ? value : Number(value || 0).toFixed(2);
}

function triple(values: SitTriple): string {
  return values.map(num).join(",");
}

/** Display text on one line, cut to the 80 characters the stock fields hold. */
function clean(value: string): string {
  return String(value).replace(/[\r\n]/g, " ").slice(0, 80);
}

function text(value: string): Uint8Array {
  return singleByte(value.replace(/\r?\n/g, CRLF));
}

/*
  The games' text files are single-byte windows-1252, as the readers decode them ("latin1" is
  windows-1252 to a TextDecoder): a name such as "Champs-Élysées" has to be one byte per letter.
*/
function singleByte(value: string): Uint8Array {
  const bytes = encodeWindows1252(value);
  if (typeof bytes === "number") throw new RangeError(`"${value[bytes]}" cannot be written in a windows-1252 text file.`);
  return bytes;
}
