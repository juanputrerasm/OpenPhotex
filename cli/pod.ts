/*
  `openphotex pod ...`: inspect and extract POD archives.
*/
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { findPodEntry, normalizePodPath, parsePod, readPod2AuditTrail, readPodEntry, verifyPodChecksums, type PodArchive, type PodEntry } from "openphotex";
import { CliError, EXIT, hex, printJson, usageError, warn } from "./output.ts";

export interface PodOptions {
  json: boolean;
  raw: boolean;
  filter: string | undefined;
  output: string | undefined;
  stdout: boolean;
  all: boolean;
  force: boolean;
}

interface LoadedPod {
  file: string;
  bytes: Uint8Array;
  archive: PodArchive;
}

function load(file: string | undefined): LoadedPod {
  if (!file) throw usageError("Missing POD file argument.");
  const bytes = new Uint8Array(readFileSync(file));
  return { file, bytes, archive: parsePod(bytes) };
}

/* ---- JSON documents. Every key is always present, in this order, so the shape never varies. ---- */

function archiveJson(archive: PodArchive) {
  return {
    format: archive.format,
    comment: archive.comment,
    byteLength: archive.byteLength,
    entryCount: archive.entries.length,
    directoryOffset: archive.directoryOffset,
    directoryEnd: archive.directoryEnd,
    checksum: archive.checksum,
    auditCount: archive.auditCount,
  };
}

function entryJson(entry: PodEntry, bytes: Uint8Array, archive: PodArchive, raw: boolean) {
  const json: Record<string, unknown> = {
    index: entry.index,
    name: entry.name,
    normalizedName: entry.normalizedName,
    title: entry.title,
    offset: entry.offset,
    length: entry.length,
    recordOffset: entry.recordOffset,
    paletteName: entry.paletteName,
    timestamp: entry.timestamp,
    crc: entry.crc,
  };
  if (raw) {
    const recordSize = RECORD_SIZE[archive.format];
    json.record = toHex(bytes.subarray(entry.recordOffset, entry.recordOffset + recordSize));
  }
  return json;
}

/** Directory record sizes, for --raw. */
const RECORD_SIZE: Record<PodArchive["format"], number> = { pod1: 40, pod2: 20, epd: 80 };

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---- Entry selection ---- */

/**
 * `--filter` pattern: `*` matches any run of characters and `?` any one, ignoring case. A
 * pattern containing `/` or `\` is matched against the whole path, otherwise against the file name.
 */
function filterEntries(entries: PodEntry[], pattern: string | undefined): PodEntry[] {
  if (!pattern) return entries;
  const matches = pathMatcher(pattern);
  return entries.filter((entry) => matches(entry.normalizedName));
}

/** A test for normalized paths (`ART/GRASS.RAW`) against a `--filter` pattern. */
function pathMatcher(pattern: string): (normalizedPath: string) => boolean {
  const normalized = pattern.replace(/\\/g, "/").toUpperCase();
  const regex = new RegExp(
    "^" + normalized.replace(/[.+^${}()|[\]]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
  );
  const byPath = normalized.includes("/");
  return (path) => regex.test(byPath ? path : path.slice(path.lastIndexOf("/") + 1));
}

/**
 * Resolve an entry argument: an exact path first, then `#<index>`, then a file name that must
 * match exactly one entry.
 */
export function selectEntry(archive: PodArchive, selector: string): PodEntry {
  const exact = findPodEntry(archive, selector);
  if (exact) return exact;
  const indexMatch = /^#(\d+)$/.exec(selector);
  if (indexMatch) {
    const entry = archive.entries[Number(indexMatch[1])];
    if (entry) return entry;
    throw new CliError("ENTRY_NOT_FOUND", `No entry at index ${indexMatch[1]} (archive has ${archive.entries.length}).`, EXIT.NOT_FOUND, { selector });
  }
  const title = selector.replace(/\\/g, "/").trim().toUpperCase();
  const byTitle = archive.entries.filter((entry) => entry.title === title);
  if (byTitle.length === 1) return byTitle[0];
  if (byTitle.length > 1) {
    throw new CliError(
      "AMBIGUOUS_ENTRY",
      `'${selector}' matches ${byTitle.length} entries; give the full path: ${byTitle.map((e) => e.name).join(", ")}`,
      EXIT.NOT_FOUND,
      { selector, candidates: byTitle.map((e) => e.name) },
    );
  }
  throw new CliError("ENTRY_NOT_FOUND", `No entry '${selector}' in the archive.`, EXIT.NOT_FOUND, { selector });
}

/**
 * Where an entry lands under an output directory: the stored path with `\` as a separator and
 * its original case, minus any component that could escape the directory.
 */
function safeRelativePath(entry: PodEntry): string {
  const parts = entry.name.split(/[\\/]+/).filter((part) => part && part !== "." && part !== "..");
  return parts.length ? join(...parts) : `entry-${entry.index}`;
}

function writeOutput(path: string, bytes: Uint8Array, force: boolean): void {
  if (!force && existsSync(path)) {
    throw new CliError("OUTPUT_EXISTS", `Refusing to overwrite ${path} (use --force).`, EXIT.IO, { path });
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

/* ---- Commands ---- */

export function podInfo(file: string | undefined, options: PodOptions): void {
  const { archive } = load(file);
  if (options.json) {
    printJson({ command: "pod info", file, archive: archiveJson(archive) });
    return;
  }
  const lines = [
    ["File", file!],
    ["Format", archive.format],
    ["Comment", archive.comment || "(none)"],
    ["Size", `${archive.byteLength} bytes`],
    ["Entries", String(archive.entries.length)],
    ["Directory", `${hex(archive.directoryOffset)}..${hex(archive.directoryEnd)}`],
  ];
  if (archive.checksum !== null) lines.push(["Checksum", `${hex(archive.checksum, 8)} (stored, not verified)`]);
  if (archive.auditCount !== null) lines.push(["Audit records", String(archive.auditCount)]);
  process.stdout.write(lines.map(([k, v]) => `${(k + ":").padEnd(15)}${v}`).join("\n") + "\n");
}

export function podList(file: string | undefined, options: PodOptions): void {
  const { bytes, archive } = load(file);
  const entries = filterEntries(archive.entries, options.filter);
  if (options.json) {
    printJson({
      command: "pod list",
      file,
      filter: options.filter ?? null,
      archive: archiveJson(archive),
      entries: entries.map((entry) => entryJson(entry, bytes, archive, options.raw)),
    });
    return;
  }
  const indexWidth = Math.max(1, String(archive.entries.length - 1).length);
  const out = [`${"#".padStart(indexWidth)}  ${"OFFSET".padEnd(10)}  ${"LENGTH".padStart(10)}  NAME`];
  for (const entry of entries) {
    let line = `${String(entry.index).padStart(indexWidth)}  ${hex(entry.offset, 8)}  ${String(entry.length).padStart(10)}  ${entry.name}`;
    if (entry.paletteName) line += `  [palette ${entry.paletteName}]`;
    out.push(line);
  }
  process.stdout.write(out.join("\n") + "\n");
  if (options.filter) process.stderr.write(`${entries.length} of ${archive.entries.length} entries match '${options.filter}'.\n`);
}

export function podExtract(file: string | undefined, selector: string | undefined, options: PodOptions): void {
  if (options.all && selector) throw usageError("Give either an entry or --all, not both.");
  if (!options.all && !selector) throw usageError("Missing entry argument (a path, file name or #index), or --all.");
  if (options.filter && !options.all) throw usageError("--filter only applies to --all.");
  if (options.stdout && (options.all || options.output || options.json)) {
    throw usageError("--stdout cannot be combined with --all, -o or --json.");
  }
  if (options.all && !options.output) throw usageError("--all needs -o <directory>.");

  const { bytes, archive } = load(file);
  const results: { index: number; name: string; normalizedName: string; length: number; output: string | null }[] = [];

  if (options.all) {
    const root = resolve(options.output!);
    const written = new Map<string, string>();
    for (const entry of filterEntries(archive.entries, options.filter)) {
      const relative = safeRelativePath(entry);
      const key = relative.toUpperCase();
      if (written.has(key)) {
        warn(`entry ${entry.index} (${entry.name}) has the same path as ${written.get(key)}; skipped.`);
        continue;
      }
      const target = join(root, relative);
      writeOutput(target, readPodEntry(bytes, entry), options.force);
      written.set(key, entry.name);
      results.push({ index: entry.index, name: entry.name, normalizedName: entry.normalizedName, length: entry.length, output: target });
    }
  } else {
    const entry = selectEntry(archive, selector!);
    const data = readPodEntry(bytes, entry);
    if (options.stdout) {
      process.stdout.write(data);
      return;
    }
    const target = resolve(options.output ?? entry.title);
    writeOutput(target, data, options.force);
    results.push({ index: entry.index, name: entry.name, normalizedName: entry.normalizedName, length: entry.length, output: target });
  }

  if (options.json) {
    printJson({ command: "pod extract", file, extracted: results });
  } else {
    for (const r of results) process.stdout.write(`${r.name} -> ${r.output} (${r.length} bytes)\n`);
  }
}

function requirePod2(archive: PodArchive, what: string): void {
  if (archive.format !== "pod2") {
    throw new CliError("UNSUPPORTED_FORMAT", `${what} exists only in POD2 archives; this is ${archive.format}.`, EXIT.FORMAT, { format: archive.format });
  }
}

function isoDate(seconds: number): string {
  return seconds ? new Date(seconds * 1000).toISOString().replace(".000Z", "Z") : "-";
}

/** Check a POD2's stored CRCs. Exit 5 (CHECKSUM_MISMATCH) when any differs. */
export function podVerify(file: string | undefined, options: PodOptions): void {
  const { bytes, archive } = load(file);
  requirePod2(archive, "CRC verification");
  const report = verifyPodChecksums(bytes, archive);
  const ok = report.archive.ok && report.mismatches.length === 0;
  if (options.json) {
    printJson({
      command: "pod verify",
      file,
      format: archive.format,
      ok,
      archive: report.archive,
      entriesChecked: report.entriesChecked,
      mismatches: report.mismatches,
    });
  } else {
    process.stdout.write(
      `Archive CRC:    ${hex(report.archive.stored, 8)} ${report.archive.ok ? "ok" : `MISMATCH (computed ${hex(report.archive.computed, 8)})`}\n` +
      `Entry CRCs:     ${report.entriesChecked - report.mismatches.length} of ${report.entriesChecked} ok\n` +
      report.mismatches.map((m) => `  MISMATCH #${m.index} ${m.name}: stored ${hex(m.stored, 8)}, computed ${hex(m.computed, 8)}\n`).join(""),
    );
  }
  if (!ok) {
    // Already reported on stdout; the error only sets the exit status and a stderr line.
    throw new CliError("CHECKSUM_MISMATCH", `${file}: stored CRCs do not match the data.`, EXIT.CHECK_FAILED);
  }
}

/** A POD2's audit trail: who added, removed or changed which entry, and when. */
export function podAudit(file: string | undefined, options: PodOptions): void {
  const { bytes, archive } = load(file);
  requirePod2(archive, "An audit trail");
  const matches = options.filter ? pathMatcher(options.filter) : () => true;
  const records = readPod2AuditTrail(bytes, archive).filter((r) => matches(normalizePodPath(r.path)));
  if (options.json) {
    printJson({ command: "pod audit", file, filter: options.filter ?? null, auditCount: archive.auditCount, records });
    return;
  }
  const out = records.map((r) =>
    `${String(r.index).padStart(5)}  ${isoDate(r.timestamp)}  ${(r.action ?? `#${r.actionCode}`).padEnd(6)}  ${r.user.padEnd(10)}  ${r.path}  ` +
    (r.action === "add" ? `(${r.newSize} bytes)` : r.action === "remove" ? `(was ${r.oldSize} bytes)` : `(${r.oldSize} -> ${r.newSize} bytes)`));
  process.stdout.write(out.join("\n") + (out.length ? "\n" : ""));
}
