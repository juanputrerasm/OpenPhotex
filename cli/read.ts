/*
  `openphotex read`: what a file inside a POD (or a loose file) says, through the reader
  OpenPhotex has for it.

  The format is chosen from the extension, then the content, then the archive the file came
  from, and `--as` overrides it for the cases those cannot settle: an MTM .LVL and a Terminal
  Velocity .LVL share an extension and a line layout, so a lone .LVL outside its archive needs
  telling. The result is the reader's own return value, so the JSON shape is the library's
  documented type for that reader; typed arrays are summarised unless --full asks for them.
*/
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import {
  actPaletteDepth, decodeActPalette, decodeTiff, isEvoSit, isSmfModel, matchEvoAiLineName, parseAnimations, parseBin,
  parseCprCmd, parseCprTrk, parseCprTtx, parseDef, parseEvoAiLine, parseEvoLvl, parseEvoSit, parseEvoTex, parseEvoVeg,
  parseEvoWat, parseHbBriefing, parseHbNavPoints, parseMtmLvl, parseMtmSit, parseNavPoints, parsePod, parsePowerups,
  parseSmf, parseTexList, readPodEntry, parseTruckManifest, parseTty, parseTunnelDefs, parseTvLvl, podPathTitle, rawTextureSide,
  parseFlyScf, parseFlySceneryObjects, parseFlyBsp, parseFlyAlt, parseFlyTex, parseFlyTyp, parseFlyRef, parseFlyAl2, findPodEntry,
  parseDfm, parseSkl, parseKfm, parseCth, parseNocturneGeo, parseNocturneFog, parseNocturneSet,
  parseNocturneThm, parseNocturneZth, parseKlp, parseMtmAmbientSounds, parseMtmSun, parseLoc, parseCockpitLayout,
  type PodArchive, type PodEntry,
} from "openphotex";
import { CliError, EXIT, printJson, usageError } from "./output.ts";
import { selectEntry } from "./pod.ts";

export interface ReadOptions {
  json: boolean;
  full: boolean;
  as: string | undefined;
}

/** The readers `read` can apply, by the id `--as` takes and the JSON reports. */
/** Where the bytes came from, for readers that need a sibling file. */
interface ReadContext {
  archive: PodArchive | null;
  archiveBytes: Uint8Array;
  entry: PodEntry | null;
}

const READERS: Record<string, { reader: string; read: (bytes: Uint8Array, name: string, context: ReadContext) => unknown }> = {
  "bin": { reader: "parseBin", read: (b) => parseBin(b) },
  "mtm-sit": { reader: "parseMtmSit", read: (b, n) => parseMtmSit(b, n) },
  "evo-sit": { reader: "parseEvoSit", read: (b, n) => parseEvoSit(b, n) },
  "mtm-lvl": { reader: "parseMtmLvl", read: (b) => parseMtmLvl(b) },
  "tv-lvl": { reader: "parseTvLvl", read: (b) => parseTvLvl(b) },
  "evo-lvl": { reader: "parseEvoLvl", read: (b, n) => parseEvoLvl(b, n) },
  "evo-wat": { reader: "parseEvoWat", read: (b, n) => parseEvoWat(b, n) },
  "tex": { reader: "parseTexList", read: (b) => parseTexList(b) },
  "evo-tex": { reader: "parseEvoTex", read: (b, n) => parseEvoTex(b, n) },
  "tty": { reader: "parseTty", read: (b) => parseTty(b) },
  "klp": { reader: "parseKlp", read: (b) => parseKlp(b) },
  "mtm-sounds": { reader: "parseMtmAmbientSounds", read: (b) => parseMtmAmbientSounds(b) },
  "mtm-sun": { reader: "parseMtmSun", read: (b) => parseMtmSun(b) },
  "loc": { reader: "parseLoc", read: (b) => parseLoc(b) },
  "mtm-cockpit": { reader: "parseCockpitLayout", read: (b) => parseCockpitLayout(b) },
  "evo-veg": { reader: "parseEvoVeg", read: (b, n) => parseEvoVeg(b, n) },
  "smf": { reader: "parseSmf", read: (b, n) => parseSmf(b, n) },
  "cpr-trk": { reader: "parseCprTrk", read: (b) => parseCprTrk(b) },
  "cpr-ttx": { reader: "parseCprTtx", read: (b) => parseCprTtx(b) },
  "cpr-cmd": { reader: "parseCprCmd", read: (b, n) => parseCprCmd(b, n) },
  "truck": { reader: "parseTruckManifest", read: (b, n) => parseTruckManifest(b, n) },
  "def": { reader: "parseDef", read: (b) => parseDef(b) },
  "tv-nav": { reader: "parseNavPoints", read: (b) => parseNavPoints(b, 256) },
  "hb-nav": { reader: "parseHbNavPoints", read: (b) => parseHbNavPoints(b, 128) },
  "tv-pup": { reader: "parsePowerups", read: (b) => parsePowerups(b, 256, "TV/F3") },
  "hb-pup": { reader: "parsePowerups", read: (b) => parsePowerups(b, 128, "HB") },
  "tv-tdf": { reader: "parseTunnelDefs", read: (b) => parseTunnelDefs(b, 256, "TV/F3") },
  "hb-tdf": { reader: "parseTunnelDefs", read: (b) => parseTunnelDefs(b, 128, "HB") },
  "ani": { reader: "parseAnimations", read: (b) => parseAnimations(b) },
  "hb-briefing": { reader: "parseHbBriefing", read: (b) => parseHbBriefing(b) },
  "evo-ai-line": { reader: "parseEvoAiLine", read: (b) => parseEvoAiLine(b) },
  "tiff": { reader: "decodeTiff", read: (b, n) => decodeTiff(b, n) },
  "act": { reader: "decodeActPalette", read: (b) => ({ depth: actPaletteDepth(b), palette: decodeActPalette(b) }) },
  "raw": { reader: "rawTextureSide", read: (b) => ({ byteLength: b.length, side: rawTextureSide(b.length) }) },
  "fly-scf": { reader: "parseFlyScf", read: (b, n) => parseFlyScf(b, n) },
  "fly-objects": { reader: "parseFlySceneryObjects", read: (b, n) => parseFlySceneryObjects(b, n) },
  "fly-bsp": { reader: "parseFlyBsp", read: (b, n) => parseFlyBsp(b, n) },
  "fly-alt": { reader: "parseFlyAlt", read: (b, n) => parseFlyAlt(b, n) },
  "fly-tex": { reader: "parseFlyTex", read: (b, n) => parseFlyTex(b, n) },
  "fly-typ": { reader: "parseFlyTyp", read: (b, n) => parseFlyTyp(b, n) },
  "fly-ref": { reader: "parseFlyRef", read: (b, n, c) => parseFlyRef(b, siblingTyp(c, n), n) },
  "fly-al2": { reader: "parseFlyAl2", read: (b, n, c) => parseFlyAl2(b, siblingTyp(c, n), n) },
  "dfm": { reader: "parseDfm", read: (b, n) => parseDfm(b, n) },
  "skl": { reader: "parseSkl", read: (b, n) => parseSkl(b, n) },
  "kfm": { reader: "parseKfm", read: (b, n) => parseKfm(b, n) },
  "cth": { reader: "parseCth", read: (b, n) => parseCth(b, n) },
  "nocturne-geo": { reader: "parseNocturneGeo", read: (b, n) => parseNocturneGeo(b, n) },
  "nocturne-fog": { reader: "parseNocturneFog", read: (b, n) => parseNocturneFog(b, n) },
  "nocturne-set": { reader: "parseNocturneSet", read: (b, n) => parseNocturneSet(b, n) },
  "nocturne-thm": { reader: "parseNocturneThm", read: (b, n) => parseNocturneThm(b, n) },
  "nocturne-zth": { reader: "parseNocturneZth", read: (b, n) => parseNocturneZth(b, n) },
};

/** A .REF or .AL2 is laid out by its quadrant's .TYP, so it is only readable from its archive. */
function siblingTyp(context: ReadContext, name: string) {
  const typ = context.archive && context.entry
    ? findPodEntry(context.archive, context.entry.normalizedName.replace(/\.[^.]*$/, ".TYP"))
    : null;
  if (!typ) throw new CliError("UNSUPPORTED_FORMAT", `${name} needs its quadrant's .TYP, so read it from its archive.`, EXIT.FORMAT, { name });
  return parseFlyTyp(readPodEntry(context.archiveBytes, typ), typ.name);
}

export const READ_FORMATS = Object.keys(READERS);

export function read(source: string | undefined, selector: string | undefined, options: ReadOptions): void {
  if (!source) throw usageError("Missing file argument.");
  const fileBytes = new Uint8Array(readFileSync(source));
  const archive = selector === undefined ? null : parsePod(fileBytes);
  const entry = archive ? selectEntry(archive, selector!) : null;
  const bytes = entry ? readPodEntry(fileBytes, entry) : fileBytes;
  const name = entry ? entry.name : basename(source);

  const format = options.as ?? detect(name, bytes, archive, fileBytes);
  const reader = READERS[format];
  if (!reader) {
    throw new CliError("UNSUPPORTED_FORMAT", options.as
      ? `Unknown --as '${options.as}'. Supported: ${READ_FORMATS.join(", ")}.`
      : `No reader for '${name}'. Give --as <format>: ${READ_FORMATS.join(", ")}.`, options.as ? EXIT.USAGE : EXIT.FORMAT, { name });
  }
  const data = reader.read(bytes, podPathTitle(name), { archive, archiveBytes: fileBytes, entry });
  if (data === null) throw new CliError("UNSUPPORTED_FORMAT", `${reader.reader} could not read '${name}' as ${format}.`, EXIT.FORMAT, { name, format });

  if (options.json) {
    printJson({
      command: "read", file: source, entry: entry ? entry.name : null, format, reader: reader.reader,
      data: plain(data, options.full),
    });
    return;
  }
  process.stdout.write(`${name}: ${format} (${reader.reader})\n${summary(data)}`);
}

/*
  Which reader a file wants. Extensions come first; content settles the extensions two games
  share (.SIT, .TRK, .NAV, .TEX); the archive settles .LVL, where the content cannot: a POD2 is
  4x4 Evolution, and a POD1 carrying any .SIT or .SI2 belongs to the MTM family.
*/
function detect(name: string, bytes: Uint8Array, archive: PodArchive | null, archiveBytes: Uint8Array): string {
  const title = podPathTitle(name);
  const ext = title.slice(title.lastIndexOf(".") + 1);
  const text = () => new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
  const evoArchive = archive?.format === "pod2";
  switch (ext) {
    case "BIN": return "bin";
    case "SIT": case "SI2": return isEvoSit(bytes) ? "evo-sit" : "mtm-sit";
    case "LVL": {
      if (evoArchive || text().includes("$")) return "evo-lvl";
      if (archive) return archive.entries.some((e) => /\.SI[T2]$/.test(e.title)) ? "mtm-lvl" : "tv-lvl";
      return "";
    }
    case "WAT": return "evo-wat";
    case "TEX": return evoArchive ? "evo-tex" : archive?.format === "epd" ? "fly-tex" : "tex";
    case "TTY": return "tty";
    case "VEG": return "evo-veg";
    case "SMF": return isSmfModel(bytes) ? "smf" : "";
    case "TRK": return text().includes("CRaceTrack.trackCount") ? "cpr-trk" : "truck";
    case "CAR": return "truck";
    case "TTX": return "cpr-ttx";
    case "CMD": return "cpr-cmd";
    case "DEF": return "def";
    case "NAV": return text().includes("!priority,time") ? "hb-nav" : "tv-nav";
    case "PUP": return isHellbender(archive, archiveBytes) ? "hb-pup" : "tv-pup";
    case "TDF": return isHellbender(archive, archiveBytes) ? "hb-tdf" : "tv-tdf";
    case "ANI": return "ani";
    case "KLP": return "klp";
    case "LOC": return "loc";
    case "200": case "400": case "480": return title.startsWith("POWERBIG.") ? "mtm-cockpit" : "";
    case "TXT":
      if (/^SOUND\d+\.TXT$/.test(title)) return "mtm-sounds";
      if (title === "SUN.TXT") return "mtm-sun";
      if (matchEvoAiLineName(name, title.replace(/^AI_\d\d/, "").replace(/\.TXT$/, ""))) return "evo-ai-line";
      return "";
    case "TIF": case "TIFF": return "tiff";
    case "ACT": return "act";
    case "RAW": return "raw";
    case "SCF": return "fly-scf";
    case "BSP": return "fly-bsp";
    case "ALT": return "fly-alt";
    case "TYP": return "fly-typ";
    case "REF": return "fly-ref";
    case "AL2": return "fly-al2";
    case "DFM": return "dfm";
    case "SKL": return "skl";
    case "KFM": return "kfm";
    case "CTH": return "cth";
    case "GEO": return "nocturne-geo";
    case "FOG": return "nocturne-fog";
    case "SET": return "nocturne-set";
    case "THM": return "nocturne-thm";
    case "ZTH": return "nocturne-zth";
    case "S00": case "S01": case "S10": case "S11": return "fly-objects";
    // Anything else has no reader of its own. Content alone is not enough: an Evo replay
    // (.RPL) embeds whole truck manifests after its own header and would pass for one.
    default: return "";
  }
}

/** A Hellbender archive carries a .LVL with its "!New ground additions" block. */
function isHellbender(archive: PodArchive | null, archiveBytes: Uint8Array): boolean {
  if (!archive) return false;
  return archive.entries.some((e) => e.title.endsWith(".LVL") && parseTvLvl(readPodEntry(archiveBytes, e)).origin === "HB");
}

/** JSON-ready: typed arrays become plain arrays with --full, otherwise a type and length. */
function plain(value: unknown, full: boolean): unknown {
  if (ArrayBuffer.isView(value)) {
    const array = value as unknown as ArrayLike<number>;
    return full ? Array.from(array) : { typedArray: value.constructor.name, length: array.length };
  }
  if (Array.isArray(value)) return value.map((item) => plain(item, full));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item, full)]));
  }
  return value;
}

/** A few readable lines: scalars as they are, arrays and objects by size. */
function summary(data: unknown): string {
  if (Array.isArray(data)) return `  ${data.length} records\n`;
  if (!data || typeof data !== "object") return `  ${String(data)}\n`;
  const lines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    let shown: string;
    if (ArrayBuffer.isView(value)) shown = `${value.constructor.name}(${(value as unknown as ArrayLike<number>).length})`;
    else if (Array.isArray(value)) shown = `${value.length} items`;
    else if (value && typeof value === "object") shown = `{${Object.keys(value).length} fields}`;
    else shown = JSON.stringify(value) ?? "undefined";
    lines.push(`  ${(key + ":").padEnd(22)}${shown}`);
  }
  return lines.join("\n") + "\n";
}
