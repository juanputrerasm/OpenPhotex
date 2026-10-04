/*
  The MTM-family scene script (.SIT) and its level file (.LVL): Monster Truck Madness 1 and 2,
  and CART Precision Racing, which forked the format.

  A .SIT is label/value text. Its line 0 names the .LVL; after that come the header labels,
  then sections: *** Ramps ***, *** Boxes ***, *** Top Crush ***, *** Course *** (with the MTM2
  extended courses), *** Stadium ***, *** Backdrop ***, and the vehicles. A .LVL is positional:
  terrain, colour grid, palette, texture list, sky, music, lighting. Neither carries a version
  field or names its game; see detectSitOrigin.

  Ported from JSTrackViewer's src/worker/sit-parser.js, which read these files and resolved the
  assets they name in one pass. This is the reading half: it returns what the files say, and
  resolving names against an archive is the caller's.

  Positions are converted as the engine stores them (see sitWorldTriplet): editor space, 2 units
  per foot horizontally and the 2 ft legacy height step vertically.
*/
import { normalizePodPath } from "../pod/paths.ts";
import { LEGACY_ALTITUDE_DIVISOR } from "../terrain/height.ts";

export type SitOrigin = "MTM1" | "MTM2" | "CPR";

/** A placement. `type` is the box type (99 for a ramp, 98 for a top-crush part). */
export interface SitBox {
  position: [number, number, number];
  theta: number;
  phi: number;
  psi: number;
  length: number;
  width: number;
  height: number;
  modelName: string;
  mass: number;
  type: number;
  flags: number;
  /** Pass order among the checkpoints (type 6) of the Boxes section; -1 otherwise. */
  checkpointSequence: number;
  /** Velocity in ft/s as written, when the record carries one. */
  bvel?: [number, number, number];
  /** The game loader's view (MONSTER.EXE 0x5495e0): feet, negative x and z wrapped by +8192. */
  positionFt?: [number, number, number];
  /** Full length, width and height in feet as written, unrounded (a model's extents replace them in game). */
  sizeFt?: [number, number, number];
  /**
   * The box's `priority` line: the game draws it only when this is at most the MONSTER.INI
   * detailLevel (MONSTER.EXE 0x54ec00). Absent means 0.
   */
  priority?: number;
  /** Top-crush parts: which record they came from, and which part they are. */
  crushGroup?: number;
  crushRole?: "body" | "cab";
}

export interface SitCourseSegment {
  /** Editor space, as sitWorldTriplet gives (2 units per foot horizontally, 2 ft height steps). */
  start: [number, number, number];
  end: [number, number, number];
  speedLimit: number;
  /** As stored; the parser's historical default when the `&` line is absent is 64. */
  trackWidth: number;
  /** The game loader's view (MONSTER.EXE 0x4e0970): feet, negative x and z wrapped by +8192. */
  startFt: [number, number, number];
  endFt: [number, number, number];
  /** 1 in every stock SIT: the file holds straights only; the game builds the arcs between them. */
  ctype: number;
  cspeedType: number;
  cdecPoint: number;
  cspeed: number;
  lastEntry: number;
  /** cTrackWidth in feet; the game defaults it to 32 when the `&` line is absent. */
  trackWidthFt: number;
}

export interface SitCourse {
  segments: SitCourseSegment[];
  /** course_direction from the `c1Count,course_direction` line. */
  direction: number;
}

export interface SitTruck {
  position: [number, number, number];
  theta: number;
  phi: number;
  psi: number;
  name: string;
  /** The "Your Truck (Not used anymore)" slot: a saved player slot, not a grid vehicle. */
  playerSlot?: boolean;
}

export interface SitArena {
  modelName: string;
  x: number;
  y: number;
  sx: number;
  sy: number;
}

export interface MtmSit {
  origin: SitOrigin;
  /** Line 0: the level file, normalized. */
  lvlName: string;
  lineCount: number;
  trackName: string | null;
  localeName: string | null;
  /** "Track Race Type" as stored; see sitTrackTypeName. */
  trackTypeCode: number | null;
  /** MTM1 and CPR: the CD audio track. */
  redbookTrack: number | null;
  /** MTM2 only. */
  ambientSound: number | null;
  weatherMask: number | null;
  /** Ramps, then boxes, then top-crush parts (body, cab) in file order. */
  boxes: SitBox[];
  primaryCourse: SitCourse | null;
  extendedCourses: SitCourse[];
  arena: SitArena | null;
  /** Null when the file has no *** Backdrop *** section. */
  backdropModelNames: string[] | null;
  trucks: SitTruck[];
  /** What does not add up, such as a section declaring more records than it holds. */
  warnings: string[];
}

/*
  Which game a SIT came from.

  A SIT carries no version field and never names its game. The families are told apart by their
  record schema, which is stable because MTM2 added records to the MTM1 format and CPR forked
  that format for open wheel racing:

    CPR   adds a pit stop and driver aid block
    MTM2  adds weather and stadium records
    MTM1  has neither

  Every marker below appears in all of its own family's stock SITs and in none of the other two
  families' (47 stock SITs: MTM1 14, MTM2 15, CPR 18). MTM1 is the residual, because its schema
  is a strict subset of MTM2's. Community Patch 3 writes .SI2 only for MTM2, so that extension
  settles it on its own.
*/
const CPR_SIT_MARKERS = ["^currentPitStop", "@ap.guy2follow,ap.lineOffset,ap.place,ap.pit", "*** VARLOW ***"];
const MTM2_SIT_MARKERS = ["!ambient sound,track length,weather mask", "!stadiumFlag,x,z,sx,sz,stadiumModelName"];

export function detectSitOrigin(lines: readonly string[], sitTitle = ""): SitOrigin {
  if (sitTitle.toUpperCase().endsWith(".SI2")) return "MTM2";
  const set = new Set(lines.map((line) => line.trim()));
  if (CPR_SIT_MARKERS.some((marker) => set.has(marker))) return "CPR";
  if (MTM2_SIT_MARKERS.some((marker) => set.has(marker))) return "MTM2";
  return "MTM1";
}

/*
  "Track Race Type" means different things in the two games that write it.

    MTM1 / MTM2   0 = unset, 1 = drag, 2 = circuit, 3 = rally, 4 = rumble
    CPR           4 = road, 5 = speedway, 6 = short oval, 7 = street

  The CPR names are CPREDIT's own ("4 = road, 5 = speedway, 6 = short oval, 7 = street :"), and
  the 17 stock tracks bear them out: Laguna Seca, Mid-Ohio, Road America, Portland and Detroit
  are 4; California and Michigan 5; Gateway, Homestead, Milwaukee, Nazareth and Rio 6; Surfers
  Paradise, Long Beach, Cleveland, Toronto and Vancouver 7.
*/
const MTM_TRACK_TYPES: Record<number, string> = { 1: "DRAG", 2: "CIRCUIT", 3: "RALLY", 4: "RUMBLE" };
const CPR_TRACK_TYPES: Record<number, string> = { 4: "ROAD", 5: "SPEEDWAY", 6: "SHORT OVAL", 7: "STREET" };

export function sitTrackTypeName(code: number, origin: SitOrigin): string {
  return (origin === "CPR" ? CPR_TRACK_TYPES : MTM_TRACK_TYPES)[code] ?? "UNKNOWN";
}

/*
  .SIT positions are feet; Traxx stores them as ipos = 2*feet horizontally and feet/2 vertically,
  wrapping negatives into the 16384-unit world (TrackPODFile.cpp Pod1SitToIpos). That holds for
  CPR too: its own altitude / 4 gives 4 ft CPR steps, carried as 2 ft legacy steps like the
  terrain, so the divisor is 2 for all three games.

  Traxx has to quantise, because ipos is an int: the original truncated with `2*(int)atof(..)`,
  which lost half-steps and walked positions downward on every load/save round trip, and the
  Community Patch 3 fork added a 1/256-step fraction per axis. Keeping the value as a float is
  strictly more precise than either.
*/
/*
  The same triplet as the game's course loader keeps it (MONSTER.EXE 0x4e0970): feet, with a
  negative x or z wrapped by +8192 ft (the 256 x 32 ft world) and y untouched.
*/
export function sitFeetTriplet(value: string): [number, number, number] {
  const parts = value.split(",");
  if (parts.length < 3) return [0, 0, 0];
  const num = (v: string) => { const n = parseFloat(v.trim()); return Number.isFinite(n) ? n : 0; };
  let x = num(parts[0]);
  const y = num(parts[1]);
  let z = num(parts[2]);
  if (x < 0) x += 8192;
  if (z < 0) z += 8192;
  return [x, y, z];
}

export function sitWorldTriplet(value: string): [number, number, number] {
  const parts = value.split(",");
  if (parts.length < 3) return [0, 0, 0];
  let x = 2 * parseFloat(parts[0].trim());
  let y = 2 * parseFloat(parts[2].trim());
  const z = parseFloat(parts[1].trim()) / LEGACY_ALTITUDE_DIVISOR;
  if (!Number.isFinite(x)) x = 0;
  if (!Number.isFinite(y)) y = 0;
  if (x < 0) x += 16384;
  if (y < 0) y += 16384;
  return [x, y, Number.isFinite(z) ? z : 0];
}

const decoder = new TextDecoder("latin1");

/** Parse a .SIT (MTM1, MTM2 or CPR). `sitTitle` lets the .SI2 extension settle the origin. */
export function parseMtmSit(input: Uint8Array | string, sitTitle = ""): MtmSit {
  const lines = toLines(typeof input === "string" ? input : decoder.decode(input));
  const origin = detectSitOrigin(lines, sitTitle);
  const valueAfter = (label: string) => {
    const at = indexOfLine(lines, label);
    return at >= 0 && at + 1 < lines.length ? lines[at + 1] : null;
  };

  const sit: MtmSit = {
    origin,
    lvlName: normalizePodPath(lines[0]),
    lineCount: lines.length,
    trackName: valueAfter("!Race Track Name")?.trim() ?? null,
    localeName: valueAfter("Race Track Locale")?.trim() ?? null,
    trackTypeCode: null,
    redbookTrack: null,
    ambientSound: null,
    weatherMask: null,
    boxes: [],
    primaryCourse: null,
    extendedCourses: [],
    arena: parseArena(lines),
    backdropModelNames: parseBackdrop(lines),
    trucks: parseTrucks(lines),
    warnings: [],
  };
  const trackType = valueAfter("Track Race Type");
  if (trackType !== null) sit.trackTypeCode = parseLeadingInt(trackType);
  /*
    @Redbook Audio Track: the CD audio track the game plays on this course. MTM1 and CPR have no
    ambient-sound field at all (that line is one of the two MTM2 markers), and carry this instead.
  */
  const redbook = valueAfter("@Redbook Audio Track");
  if (redbook !== null) sit.redbookTrack = parseLeadingInt(redbook);
  const ambient = valueAfter("!ambient sound,track length,weather mask");
  if (ambient !== null) {
    const parts = ambient.split(",");
    if (parts.length >= 3) {
      sit.ambientSound = parseLeadingInt(parts[0]);
      sit.weatherMask = parseLeadingInt(parts[2]);
    }
  }

  parseBoxSection(lines, "*** Ramps ***", sit.boxes, true, sit.warnings);
  parseBoxSection(lines, "*** Boxes ***", sit.boxes, false, sit.warnings);
  parseTopCrushSection(lines, sit.boxes);
  parseCourses(lines, sit);
  return sit;
}

/*
  The records are read up to the next "*** Name ***" header only. The engine and Traxx read as
  many records as the count line declares, so a file declaring more than it holds sends them
  into the next section: a hand-edited Roanoke River declared 4096 boxes, held 4095, and the
  first course segment's "*****" line was read as the missing box. Such a file is reported, and
  only the records that are there are read.
*/
function parseBoxSection(lines: string[], sectionHeader: string, boxes: SitBox[], isRamp: boolean, warnings: string[]): void {
  const section = indexOfLine(lines, sectionHeader);
  if (section < 0 || section + 1 >= lines.length) return;
  const count = parseLeadingInt(lines[section + 1]);
  let sectionEnd = section + 2;
  while (sectionEnd < lines.length && !/^\*\*\* \S/.test(lines[sectionEnd])) sectionEnd++;
  let present = 0;
  for (let i = section + 2; i < sectionEnd; i++) if (lines[i].startsWith("********")) present++;
  if (present !== count) {
    const kind = isRamp ? "Ramp" : "Box";
    warnings.push(`${kind} count ${count} and real ${isRamp ? "ramp" : "object"} count ${present} doesn't match`);
  }
  let cursor = section + 2;
  let checkpointSequence = 0;
  for (let i = 0; i < Math.min(count, present); i++) {
    cursor = nextBlockStart(lines, cursor);
    if (cursor < 0) return;
    const box = parseBoxBlock(lines, cursor, isRamp);
    if (!isRamp && box.type === 6) box.checkpointSequence = checkpointSequence++;
    boxes.push(box);
    cursor++;
  }
}

function parseBoxBlock(lines: string[], blockStart: number, isRamp: boolean): SitBox {
  // BOXTYPE_RAMP is 99 (Include/TrackPODBox.h:37). 8 is TYPE_NO_COLLIDE_FACING, the billboard.
  const box: SitBox = { position: [0, 0, 0], theta: 0, phi: 0, psi: 0, length: 64, width: 64, height: 64, modelName: "", mass: 0, type: isRamp ? 99 : 0, flags: 0, checkpointSequence: -1 };
  const blockEnd = nextBlockStart(lines, blockStart + 1);
  const endIndex = blockEnd >= 0 ? blockEnd : lines.length;

  const iposIdx = indexOfLinePrefix(lines, "ipos", blockStart, endIndex);
  if (iposIdx >= 0 && iposIdx + 1 < lines.length) {
    box.position = sitWorldTriplet(lines[iposIdx + 1]);
    box.positionFt = sitFeetTriplet(lines[iposIdx + 1]);
  }

  const anglesIdx = indexOfLinePrefix(lines, "theta,phi,psi", blockStart, endIndex);
  if (anglesIdx >= 0 && anglesIdx + 1 < lines.length) {
    const a = parseFloatTriplet(lines[anglesIdx + 1]);
    box.theta = a[0]; box.phi = a[1]; box.psi = a[2];
  }

  const modelIdx = indexOfLinePrefix(lines, "model", blockStart, endIndex);
  if (modelIdx >= 0 && modelIdx + 1 < lines.length) box.modelName = normalizePodPath(lines[modelIdx + 1]);
  const dimIdx = indexOfLinePrefix(lines, "length,width,height", blockStart, endIndex);
  if (dimIdx >= 0 && dimIdx + 1 < lines.length) {
    const sz = parseFloatTriplet(lines[dimIdx + 1]);
    box.length = Math.round(sz[0]); box.width = Math.round(sz[1]); box.height = Math.round(sz[2]);
    box.sizeFt = [sz[0], sz[1], sz[2]];
  }

  if (!isRamp) {
    const typeFlagsIdx = indexOfLinePrefix(lines, "!type,flags", blockStart, endIndex);
    if (typeFlagsIdx >= 0 && typeFlagsIdx + 1 < lines.length) {
      const parts = lines[typeFlagsIdx + 1].split(",");
      box.type = parseLeadingInt(parts[0] ?? "0");
      box.flags = parseLeadingInt(parts[1] ?? "0");
    }
  }

  const priorityIdx = indexOfLinePrefix(lines, "priority", blockStart, endIndex);
  if (priorityIdx >= 0 && priorityIdx + 1 < lines.length) box.priority = parseLeadingInt(lines[priorityIdx + 1]);

  const massIdx = indexOfLinePrefix(lines, "mass", blockStart, endIndex);
  if (massIdx >= 0 && massIdx + 1 < lines.length) box.mass = parseFloat(lines[massIdx + 1]) || 0;

  // Type 10 objects ("moving - use bvel" in Traxx's notes) travel along it: TPARK's train.
  const bvelIdx = indexOfLinePrefix(lines, "bvel", blockStart, endIndex);
  if (bvelIdx >= 0 && bvelIdx + 1 < lines.length) box.bvel = parseFloatTriplet(lines[bvelIdx + 1]);
  return box;
}

/*
  *** Top Crush *** - the cars a truck flattens by driving over them. Traxx writes these as their
  own section (TrackPODFile.cpp:2594-2680), and each record is two objects: ipos / modelName, the
  part that never changes, and ipos2 / cabModelName, an animated BIN with two frames (before and
  after crushing) that the game morphs between. ipos2 is ipos plus the editor's crush offset.
  Each part becomes a box of type BOXTYPE_CRUSH (98, Include/TrackPODBox.h).
*/
const BOXTYPE_CRUSH = 98;

function parseTopCrushSection(lines: string[], boxes: SitBox[]): void {
  const section = indexOfLine(lines, "*** Top Crush ***");
  if (section < 0 || section + 1 >= lines.length) return;
  const count = parseLeadingInt(lines[section + 1]);
  const sectionEnd = indexOfLine(lines, "*** Course ***");
  const limit = sectionEnd > section ? sectionEnd : lines.length;
  let cursor = section + 2;
  for (let i = 0; i < count; i++) {
    cursor = nextBlockStart(lines, cursor);
    if (cursor < 0 || cursor >= limit) return;
    const next = nextBlockStart(lines, cursor + 1);
    const blockEnd = Math.min(limit, next >= 0 ? next : limit);
    const start = cursor;
    const valueAfter = (label: string) => {
      for (let k = start + 1; k < blockEnd - 1; k++) if (lines[k].trim() === label) return lines[k + 1].trim();
      return null;
    };
    const ipos = valueAfter("ipos");
    const ipos2 = valueAfter("ipos2") ?? ipos;
    const angles = parseFloatTriplet(valueAfter("theta,phi,psi") ?? "0,0,0");
    const modelOf = (value: string | null) => {
      const name = value ? normalizePodPath(value) : "";
      return name && !name.startsWith("NULL") ? name : "";
    };
    const common = {
      theta: angles[0], phi: angles[1], psi: angles[2],
      length: 64, width: 64, height: 64, mass: 0, type: BOXTYPE_CRUSH, flags: 0,
      checkpointSequence: -1, crushGroup: i,
    };
    if (ipos) {
      boxes.push({ ...common, position: sitWorldTriplet(ipos), positionFt: sitFeetTriplet(ipos), modelName: modelOf(valueAfter("modelName")), crushRole: "body" });
      boxes.push({ ...common, position: sitWorldTriplet(ipos2!), positionFt: sitFeetTriplet(ipos2!), modelName: modelOf(valueAfter("cabModelName")), crushRole: "cab" });
    }
    cursor = blockEnd;
  }
}

function parseCourses(lines: string[], sit: MtmSit): void {
  const courseSection = indexOfLine(lines, "*** Course ***");
  if (courseSection < 0 || courseSection + 2 >= lines.length) return;
  sit.primaryCourse = { segments: [], direction: parseLeadingInt(lines[courseSection + 2]?.split(",")[1]) };
  const count = parseLeadingInt(lines[courseSection + 2]);
  parseCourseBlocks(lines, courseSection + 3, count, sit.primaryCourse);
  const extSection = indexOfLine(lines, "@*********** Extended Course Definitions *************");
  if (extSection >= 0 && extSection + 1 < lines.length) {
    const extCount = Math.min(4, parseLeadingInt(lines[extSection + 1]));
    let c = extSection + 2;
    for (let i = 0; i < extCount && c < lines.length; i++) {
      const course: SitCourse = {
        segments: [],
        direction: c + 1 < lines.length ? parseLeadingInt(lines[c + 1].split(",")[1]) : 0,
      };
      const segCount = c + 1 < lines.length ? parseLeadingInt(lines[c + 1]) : 0;
      c = parseCourseBlocks(lines, c + 2, segCount, course);
      if (course.segments.length) sit.extendedCourses.push(course);
    }
  }
}

/*
  Each segment's lines are looked up within its own block (up to the next "****" line). The
  `&cSpeedLimit,cTrackWidth` line is optional: the game reads it only when the next character is
  `&` and otherwise uses 0 and 32 ft (MONSTER.EXE 0x4e0970), so a search that ran on into the next
  segment would borrow its values.
*/
function parseCourseBlocks(lines: string[], startCursor: number, count: number, course: SitCourse): number {
  let cursor = startCursor;
  for (let i = 0; i < count; i++) {
    cursor = nextBlockStart(lines, cursor);
    if (cursor < 0) return lines.length;
    const next = nextBlockStart(lines, cursor + 1);
    const blockEnd = next < 0 ? lines.length : next;
    const segment: SitCourseSegment = {
      start: [0, 0, 0], end: [0, 0, 0], speedLimit: 0, trackWidth: 64,
      startFt: [0, 0, 0], endFt: [0, 0, 0], ctype: 0, cspeedType: 0, cdecPoint: 0, cspeed: 0, lastEntry: 0,
      trackWidthFt: 32,
    };
    const valueLine = (label: string) => {
      const at = indexOfLinePrefix(lines, label, cursor, blockEnd);
      return at >= 0 && at + 1 < blockEnd ? lines[at + 1] : null;
    };
    const types = valueLine("ctype,cspeed_type");
    if (types !== null) {
      const parts = types.split(",");
      segment.ctype = parseLeadingInt(parts[0]);
      segment.cspeedType = parseLeadingInt(parts[1]);
    }
    const cstart = valueLine("cstart");
    if (cstart !== null) {
      segment.start = sitWorldTriplet(cstart);
      segment.startFt = sitFeetTriplet(cstart);
    }
    const cend = valueLine("cend");
    if (cend !== null) {
      segment.end = sitWorldTriplet(cend);
      segment.endFt = sitFeetTriplet(cend);
    }
    const speeds = valueLine("cdec_point,cspeed,lastentry");
    if (speeds !== null) {
      const parts = speeds.split(",");
      segment.cdecPoint = parseLeadingFloat(parts[0]);
      segment.cspeed = parseLeadingFloat(parts[1]);
      segment.lastEntry = parseLeadingInt(parts[2]);
    }
    const limits = valueLine("&cSpeedLimit,cTrackWidth");
    if (limits !== null) {
      const parts = limits.split(",");
      segment.speedLimit = parseLeadingFloat(parts[0] ?? "0");
      segment.trackWidth = parseLeadingFloat(parts[1] ?? "64");
      segment.trackWidthFt = parseLeadingFloat(parts[1] ?? "32");
    }
    course.segments.push(segment);
    cursor++;
  }
  // Extended-course callers need the next [Course N] header, not a position inside the final
  // segment body; returning at its delimiter made every later course read `1,0` as its count.
  while (cursor < lines.length && !lines[cursor].startsWith("[Course ")) cursor++;
  return cursor;
}

/*
  *** Stadium *** - the arena. An arena track carries its model here rather than in the Backdrop
  block, and the writer then emits backdropCount 0 (TrackPODFile.cpp:5288-5318). Two line
  formats, discriminated by the leading '!' (TrackPODFile.cpp:2686-2737):

    !stadiumFlag,x,z,sx,sz,stadiumModelName      MTM2: placed, with a grid footprint
    stadiumFlag,stadiumModelName                 older form: model only, placed at 0,0

  A leading flag of 0 means the block is present but the track is not an arena. sx/sz are the
  footprint in grid cells, used by the editor and the game's terrain flattening.
*/
function parseArena(lines: string[]): SitArena | null {
  const section = indexOfLine(lines, "*** Stadium ***");
  if (section < 0 || section + 2 >= lines.length) return null;
  const header = (lines[section + 1] ?? "").trim();
  const fields = (lines[section + 2] ?? "").split(",");
  if (!parseLeadingInt(fields[0])) return null;
  if (header.startsWith("!stadiumFlag")) {
    if (fields.length < 6) return null;
    const modelName = normalizePodPath(fields[5]);
    if (!modelName) return null;
    return { modelName, x: parseLeadingInt(fields[1]), y: parseLeadingInt(fields[2]), sx: parseLeadingInt(fields[3]), sy: parseLeadingInt(fields[4]) };
  }
  if (header.startsWith("stadiumFlag")) {
    if (fields.length < 2) return null;
    const modelName = normalizePodPath(fields[1]);
    if (!modelName) return null;
    return { modelName, x: 0, y: 0, sx: 0, sy: 0 };
  }
  return null;
}

function parseBackdrop(lines: string[]): string[] | null {
  const section = indexOfLine(lines, "*** Backdrop ***");
  if (section < 0 || section + 4 >= lines.length) return null;
  const countLine = lines[section + 2];
  const comma = countLine.indexOf(",");
  const backdropCount = comma >= 0 ? parseLeadingInt(countLine.slice(comma + 1)) : 0;
  const names: string[] = [];
  for (let i = 0; i < Math.min(backdropCount, 64); i++) {
    const line = lines[section + 4 + i];
    if (!line || line.startsWith("***")) break;
    const modelName = normalizePodPath(line);
    if (modelName) names.push(modelName);
  }
  return names;
}

function parseTrucks(lines: string[]): SitTruck[] {
  const trucks: SitTruck[] = [];
  // Slot 0, under "*** Your Truck (Not used anymore) ***" with no block delimiter, is a saved
  // player slot rather than a vehicle standing on the grid.
  const playerSection = indexOfLine(lines, "*** Your Truck (Not used anymore) ***");
  if (playerSection >= 0) trucks.push({ ...parseTruckBlock(lines, playerSection + 1), playerSlot: true });
  const vehicleSection = indexOfLine(lines, "*** Vehicles ***");
  if (vehicleSection < 0 || vehicleSection + 1 >= lines.length) return trucks;
  const count = parseLeadingInt(lines[vehicleSection + 1]);
  let cursor = vehicleSection + 2;
  for (let i = 0; i < count; i++) {
    cursor = nextBlockStart(lines, cursor);
    if (cursor < 0) return trucks;
    trucks.push(parseTruckBlock(lines, cursor + 1));
    cursor++;
  }
  return trucks;
}

function parseTruckBlock(lines: string[], startIdx: number): SitTruck {
  const truck: SitTruck = { position: [0, 0, 0], theta: 0, phi: 0, psi: 0, name: "" };
  const nameIdx = indexOfLinePrefix(lines, "truckFile", startIdx);
  if (nameIdx >= 0 && nameIdx + 1 < lines.length) truck.name = lines[nameIdx + 1].trim();
  const iposIdx = indexOfLinePrefix(lines, "ipos", startIdx);
  if (iposIdx >= 0 && iposIdx + 1 < lines.length) truck.position = sitWorldTriplet(lines[iposIdx + 1]);
  const anglesIdx = indexOfLinePrefix(lines, "theta,phi,psi", startIdx);
  if (anglesIdx >= 0 && anglesIdx + 1 < lines.length) {
    const a = parseFloatTriplet(lines[anglesIdx + 1]);
    truck.theta = a[0]; truck.phi = a[1]; truck.psi = a[2];
  }
  return truck;
}

/** An MTM-family .LVL: the level's asset references and environment, by line. */
export interface MtmLvl {
  lineCount: number;
  /**
   * Line 1. MONSTER.EXE (0x4d4d70) treats 4 as an old MTM level: the old MTM palette, and
   * checkpoint models drawn. Every stock MTM2 level has 0.
   */
  levelType: number;
  /** Line 2: the heightfield .RAW. */
  rawName: string;
  /** Line 3: the colour (texture index) grid .CLR. */
  clrName: string;
  /** Line 4: the level palette .ACT; its fog map is the same stem with .MAP. */
  actName: string;
  /** Line 5: the terrain texture list .TEX; its type table is the same stem with .TTY. */
  texName: string;
  /** Line 10: the sky .RAW, when the line is a .RAW that is not NULL. */
  skyRawName: string | null;
  /** Line 11: the sky's .ACT. */
  skyActName: string | null;
  /** Line 14: the music file as written (null when absent). */
  musicName: string | null;
  /** Line 16: the lighting map .LTE. */
  lteName: string | null;
  /** Lines 17-21. */
  sunVector: [number, number, number] | null;
  shadowIntensity: number | null;
  sunPosition: [number, number, number] | null;
  sunIntensity: number | null;
  levelValue: number | null;
  /** MTM2 only: the raw value after the !waterHeight label. */
  waterHeight: number | null;
}

/** Parse an MTM-family .LVL. Returns null when it has fewer than six lines. */
export function parseMtmLvl(input: Uint8Array | string): MtmLvl | null {
  const lines = toLines(typeof input === "string" ? input : decoder.decode(input));
  if (lines.length < 6) return null;
  const at = (i: number) => (lines.length > i ? lines[i] : null);
  const skyRaw = at(10) === null ? null : normalizePodPath(at(10));
  const lvl: MtmLvl = {
    lineCount: lines.length,
    levelType: parseLeadingInt(lines[0]),
    rawName: normalizePodPath(lines[2]),
    clrName: normalizePodPath(lines[3]),
    actName: normalizePodPath(lines[4]),
    texName: normalizePodPath(lines[5]),
    skyRawName: skyRaw && !skyRaw.startsWith("NULL") && skyRaw.endsWith(".RAW") ? skyRaw : null,
    skyActName: lines.length > 11 ? normalizePodPath(lines[11]) : null,
    musicName: at(14),
    lteName: lines.length > 16 ? normalizePodPath(lines[16]) : null,
    sunVector: lines.length > 17 ? parseIntTriplet(lines[17]) : null,
    shadowIntensity: lines.length > 18 ? parseLeadingInt(lines[18]) : null,
    sunPosition: lines.length > 19 ? parseIntTriplet(lines[19]) : null,
    sunIntensity: lines.length > 20 ? parseLeadingInt(lines[20]) : null,
    levelValue: lines.length > 21 ? parseLeadingInt(lines[21]) : null,
    waterHeight: null,
  };
  const waterIdx = indexOfLine(lines, "!waterHeight");
  if (waterIdx >= 0 && waterIdx + 1 < lines.length) lvl.waterHeight = parseLeadingInt(lines[waterIdx + 1]);
  return lvl;
}

/**
 * The names a .TEX terrain texture list declares, normalized, in slot order. The same format in
 * every SIT- and LVL-family game: a count, then one name per line.
 */
export function parseTexList(input: Uint8Array | string): string[] {
  const lines = toNonEmptyLines(typeof input === "string" ? input : decoder.decode(input));
  const count = parseInt(lines[0] ?? "0", 10);
  const names: string[] = [];
  for (let i = 0; i < count && i + 1 < lines.length; i++) names.push(normalizePodPath(lines[i + 1]));
  return names;
}

/** A .TTY entry: a texture's surface type (value / 100) and depth (value % 100). */
export interface TtyEntry {
  name: string;
  value: number;
  type: number;
  depth: number;
}

export function parseTty(input: Uint8Array | string): TtyEntry[] {
  const lines = toNonEmptyLines(typeof input === "string" ? input : decoder.decode(input));
  const count = parseInt(lines[0] ?? "0", 10);
  const out: TtyEntry[] = [];
  for (let i = 0; i < count && i + 1 < lines.length; i++) {
    const line = lines[i + 1].toUpperCase();
    const comma = line.indexOf(",");
    if (comma < 0) continue;
    const value = parseInt(line.slice(comma + 1), 10) || 0;
    out.push({ name: line.slice(0, comma), value, type: Math.floor(value / 100), depth: value % 100 });
  }
  return out;
}

function indexOfLine(lines: readonly string[], value: string): number {
  for (let i = 0; i < lines.length; i++) if (lines[i] === value) return i;
  return -1;
}

function indexOfLinePrefix(lines: readonly string[], prefix: string, startIndex = 0, endIndex = lines.length): number {
  for (let i = startIndex; i < endIndex && i < lines.length; i++) if (lines[i].startsWith(prefix)) return i;
  return -1;
}

function nextBlockStart(lines: readonly string[], startIndex: number): number {
  for (let i = Math.max(0, startIndex); i < lines.length; i++) if (lines[i].startsWith("********")) return i;
  return -1;
}

function parseIntTriplet(value: string): [number, number, number] | null {
  const parts = value.split(",");
  if (parts.length < 3) return null;
  return [parseInt(parts[0].trim(), 10), parseInt(parts[1].trim(), 10), parseInt(parts[2].trim(), 10)];
}

function parseFloatTriplet(value: string): [number, number, number] {
  const parts = value.split(",");
  return [parseLeadingFloat(parts[0] ?? "0"), parseLeadingFloat(parts[1] ?? "0"), parseLeadingFloat(parts[2] ?? "0")];
}

function parseLeadingInt(value: string | undefined): number {
  return parseInt((value ?? "").trim(), 10) || 0;
}

function parseLeadingFloat(value: string | undefined): number {
  return parseFloat((value ?? "").trim()) || 0;
}

function toLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function toNonEmptyLines(text: string): string[] {
  return toLines(text).map((l) => l.trim()).filter(Boolean);
}

