#!/usr/bin/env node
/*
  openphotex: command-line access to the OpenPhotex format library.

  Built for people and for automated agents alike: every inspection command has a --json form
  with a fixed shape (see README "JSON output"), results go to stdout, diagnostics to stderr,
  and the exit code says what kind of failure occurred.
*/
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { EXIT, toCliError, reportError, usageError } from "./output.ts";
import { podAudit, podExtract, podInfo, podList, podVerify, type PodOptions } from "./pod.ts";
import { texture } from "./texture.ts";
import { read, READ_FORMATS } from "./read.ts";

const HELP = `openphotex: Terminal Reality format tools

Usage:
  openphotex pod info <file.pod> [--json]
  openphotex pod list <file.pod> [--json] [--raw] [--filter <pattern>]
  openphotex pod extract <file.pod> <entry> [-o <file> | --stdout] [--force] [--json]
  openphotex pod extract <file.pod> --all -o <dir> [--filter <pattern>] [--force] [--json]
  openphotex pod verify <file.pod> [--json]          (POD2: check the stored CRCs)
  openphotex pod audit <file.pod> [--json] [--filter <pattern>]   (POD2: the edit history)
  openphotex texture <file.pod> <entry.raw> -o <out.png> [--palette <entry> | --act <file>]
                     [--opa <entry>] [--family classic|evo] [--cutout] [--force] [--json]
  openphotex texture <file.raw> --act <file.act> -o <out.png> [...]
  openphotex read <file.pod> <entry> [--json] [--full] [--as <format>]
  openphotex read <file> [--json] [--full] [--as <format>]     (a loose file)

<entry> is an archive path (any case, / or \\), a file name that matches exactly one
entry, or #<index>. <pattern> uses * and ?; with a / it matches the full path, otherwise
the file name.

Options:
  --json            Machine-readable output on stdout (errors as JSON on stderr)
  --raw             pod list: include each directory record's bytes as hex
  --filter <pat>    pod list / extract --all / audit: only matching entries
  -o, --output <p>  Output file (single entry) or directory (--all)
  --stdout          Write the entry's bytes to stdout
  --palette <e>     texture: the .ACT entry to draw with (default: same-stem .ACT, then the
                    POD1 palette record)
  --act <file>      texture: a loose .ACT file to draw with
  --opa <e>         texture: a 4x4 Evolution .OPA opacity plane (entry, or file for a loose .RAW)
  --family <f>      texture: size rules, classic (MTM/CPR/TV/F3/HB) or evo; default from the POD
  --cutout          texture: classic colour key, palette-black texels transparent
  --as <format>     read: the reader to use instead of detecting it (see below)
  --full            read --json: typed arrays in full rather than as a type and length
  --force           Overwrite existing output files
  -h, --help        Show this help
  -v, --version     Show the version

read formats: ${READ_FORMATS.join(", ")}.

Exit codes: 0 ok, 1 usage, 2 file/IO, 3 unreadable or unsupported format, 4 entry or palette
not found (or ambiguous), 5 verification failed.
`;

function version(): string {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  return pkg.version;
}

function main(argv: string[]): number {
  const json = argv.includes("--json");
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        json: { type: "boolean", default: false },
        raw: { type: "boolean", default: false },
        filter: { type: "string" },
        output: { type: "string", short: "o" },
        stdout: { type: "boolean", default: false },
        all: { type: "boolean", default: false },
        force: { type: "boolean", default: false },
        palette: { type: "string" },
        act: { type: "string" },
        opa: { type: "string" },
        family: { type: "string" },
        cutout: { type: "boolean", default: false },
        as: { type: "string" },
        full: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    });

    if (values.version) {
      process.stdout.write(version() + "\n");
      return EXIT.OK;
    }
    if (values.help || positionals.length === 0) {
      process.stdout.write(HELP);
      return values.help ? EXIT.OK : EXIT.USAGE;
    }

    const [group, command, ...rest] = positionals;
    if (group === "texture") {
      if (positionals.length > 3) throw usageError(`Unexpected argument '${positionals[3]}'.`);
      texture(positionals[1], positionals[2], {
        json: values.json!, output: values.output, act: values.act, palette: values.palette, opa: values.opa,
        family: values.family, cutout: values.cutout!, force: values.force!,
      });
      return EXIT.OK;
    }
    if (group === "read") {
      if (positionals.length > 3) throw usageError(`Unexpected argument '${positionals[3]}'.`);
      read(positionals[1], positionals[2], { json: values.json!, full: values.full!, as: values.as });
      return EXIT.OK;
    }
    const readOnly = (["as", "full"] as const).find((k) => values[k]);
    if (readOnly) throw usageError(`--${readOnly} only applies to 'read'.`);
    const textureOnly = (["palette", "act", "opa", "family", "cutout"] as const).find((k) => values[k]);
    if (textureOnly) throw usageError(`--${textureOnly} only applies to 'texture'.`);
    if (group !== "pod") throw usageError(`Unknown command '${group}'. Supported: pod, texture, read.`);
    const options: PodOptions = {
      json: values.json!,
      raw: values.raw!,
      filter: values.filter,
      output: values.output,
      stdout: values.stdout!,
      all: values.all!,
      force: values.force!,
    };
    const [file, entry] = rest;
    const maxPositionals = command === "extract" ? 2 : 1;
    if (rest.length > maxPositionals) throw usageError(`Unexpected argument '${rest[maxPositionals]}'.`);
    if (options.raw && command !== "list") throw usageError("--raw only applies to 'pod list'.");

    switch (command) {
      case "info": podInfo(file, options); break;
      case "list": podList(file, options); break;
      case "extract": podExtract(file, entry, options); break;
      case "verify": podVerify(file, options); break;
      case "audit": podAudit(file, options); break;
      default: throw usageError(command ? `Unknown pod command '${command}'. Supported: info, list, extract, verify, audit.` : "Missing pod command: info, list, extract, verify or audit.");
    }
    return EXIT.OK;
  } catch (error) {
    // parseArgs reports bad options as TypeErrors carrying an ERR_PARSE_ARGS_* code.
    const code = (error as NodeJS.ErrnoException)?.code;
    const cliError = typeof code === "string" && code.startsWith("ERR_PARSE_ARGS")
      ? usageError((error as Error).message)
      : toCliError(error);
    reportError(cliError, json);
    return cliError.exitCode;
  }
}

// A reader that closes the pipe early (`| head`) is not an error.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(EXIT.OK);
  throw error;
});

process.exitCode = main(process.argv.slice(2));
