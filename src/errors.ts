/**
 * Why a POD could not be read. Stable identifiers: the CLI reports them in its JSON errors.
 */
export type PodErrorCode =
  /** The input is shorter than the fixed header of the format it looks like. */
  | "TOO_SMALL"
  /** The header's entry count is zero, negative or implausibly large. */
  | "BAD_ENTRY_COUNT"
  /** The directory does not fit inside the file. */
  | "DIRECTORY_OUT_OF_BOUNDS"
  /** An entry's name is missing, unterminated, empty or not a plausible archive path. */
  | "BAD_ENTRY_NAME"
  /** An entry's payload lies outside the file. */
  | "ENTRY_OUT_OF_BOUNDS";

export class PodFormatError extends Error {
  readonly code: PodErrorCode;
  /** The directory index of the offending entry, when the error concerns one. */
  readonly entryIndex: number | null;

  constructor(code: PodErrorCode, message: string, entryIndex: number | null = null) {
    super(message);
    this.name = "PodFormatError";
    this.code = code;
    this.entryIndex = entryIndex;
  }
}
