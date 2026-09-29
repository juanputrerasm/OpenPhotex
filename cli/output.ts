/*
  Output conventions shared by every command.

  stdout carries the result and nothing else: JSON with --json, readable text without, or raw
  bytes with --stdout. Diagnostics, warnings and errors always go to stderr, so a caller can
  parse stdout without filtering.
*/
import { PodFormatError } from "openphotex";

/**
 * Version of the JSON documents the CLI prints. Bumped only for incompatible changes (a field
 * removed, renamed or retyped); adding a field is not a breaking change.
 */
export const JSON_SCHEMA_VERSION = 1;

export const EXIT = {
  OK: 0,
  USAGE: 1,
  IO: 2,
  FORMAT: 3,
  NOT_FOUND: 4,
  CHECK_FAILED: 5,
} as const;

export type ErrorCode =
  | "USAGE"
  | "FILE_NOT_FOUND"
  | "IO_ERROR"
  | "OUTPUT_EXISTS"
  | "ENTRY_NOT_FOUND"
  | "AMBIGUOUS_ENTRY"
  | "UNSUPPORTED_FORMAT"
  | "CHECKSUM_MISMATCH"
  | "PALETTE_REQUIRED"
  | PodFormatError["code"];

/** An error the CLI reports and exits on. */
export class CliError extends Error {
  readonly code: ErrorCode;
  readonly exitCode: number;
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, exitCode: number, details: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

export function usageError(message: string): CliError {
  return new CliError("USAGE", message, EXIT.USAGE);
}

/** Map anything thrown to a CliError: format errors, file-system errors, then the unexpected. */
export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  if (error instanceof PodFormatError) {
    const details = error.entryIndex === null ? {} : { entryIndex: error.entryIndex };
    return new CliError(error.code, error.message, EXIT.FORMAT, details);
  }
  const errno = (error as NodeJS.ErrnoException)?.code;
  if (errno === "ENOENT") {
    const path = (error as NodeJS.ErrnoException).path;
    return new CliError("FILE_NOT_FOUND", `No such file: ${path}`, EXIT.IO, { path });
  }
  if (typeof errno === "string") {
    return new CliError("IO_ERROR", (error as Error).message, EXIT.IO, { errno });
  }
  return new CliError("IO_ERROR", String((error as Error)?.message ?? error), EXIT.IO);
}

export function printJson(document: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify({ schemaVersion: JSON_SCHEMA_VERSION, ...document }, null, 2) + "\n");
}

export function reportError(error: CliError, json: boolean): void {
  if (json) {
    const body = { schemaVersion: JSON_SCHEMA_VERSION, error: { code: error.code, message: error.message, ...error.details } };
    process.stderr.write(JSON.stringify(body, null, 2) + "\n");
  } else {
    process.stderr.write(`openphotex: ${error.message}\n`);
    if (error.code === "USAGE") process.stderr.write("Run 'openphotex --help' for usage.\n");
  }
}

export function warn(message: string): void {
  process.stderr.write(`openphotex: warning: ${message}\n`);
}

export function hex(value: number, width = 0): string {
  return "0x" + value.toString(16).toUpperCase().padStart(width, "0");
}
