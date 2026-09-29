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
  type PodArchive,
} from "openphotex";
import { CliError, EXIT, printJson, usageError } from "./output.ts";
import { selectEntry } from "./pod.ts";

export interface ReadOptions {
  json: boolean;
  full: boolean;
  as: string | undefined;
}

/** The readers `read` can apply, by the id `--as` takes and the JSON reports. */
const READERS: Record<string, { reader: string; read: (bytes: Uint8Array, name: string) => unknown }> = {
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
};

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
  const data = reader.read(bytes, podPathTitle(name));
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
    case "TEX": return evoArchive ? "evo-tex" : "tex";
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
    case "TXT":
      if (matchEvoAiLineName(name, title.replace(/^AI_\d\d/, "").replace(/\.TXT$/, ""))) return "evo-ai-line";
      return "";
    case "TIF": case "TIFF": return "tiff";
    case "ACT": return "act";
    case "RAW": return "raw";
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
