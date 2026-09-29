/**
 * The POD container generations OpenPhotex reads.
 *
 * - `pod1`: the original Terminal Reality archive (Monster Truck Madness 1 and 2, CART Precision
 *   Racing, Terminal Velocity, Fury3, Hellbender). No signature; fixed 40-byte directory records.
 * - `pod2`: 4x4 Evolution 1 and 2. `"POD2"` signature, 20-byte records and a separate name table.
 * - `epd`: Fly!. `"dtxe"` signature and 80-byte records.
 */
export type PodFormat = "pod1" | "pod2" | "epd";

/**
 * One file stored in a POD archive.
 *
 * Plain data only: an entry holds no reference to the archive's bytes, so it can be posted
 * between workers, serialized or kept after the bytes are gone. Read its payload with
 * `readPodEntry(bytes, entry)`.
 */
export interface PodEntry {
  /** Zero-based position in the archive directory. */
  index: number;
  /** The path exactly as the archive stores it, trimmed of NULs, spaces and control bytes at either end. Usually backslash-separated. */
  name: string;
  /** `name` with `\` turned into `/`, trimmed and upper-cased: the key lookups compare against. */
  normalizedName: string;
  /** The last path component of `normalizedName`. */
  title: string;
  /** Payload length in bytes. */
  length: number;
  /** Absolute file offset of the payload. */
  offset: number;
  /** Absolute file offset of this entry's directory record. */
  recordOffset: number;
  /**
   * POD1 only: the `.ACT` palette a `.RAW` texture was authored against, when the packer wrote
   * it as a second NUL-terminated string in the name field. `null` otherwise, and always for POD2.
   */
  paletteName: string | null;
  /** POD2 and EPD: the entry's Unix timestamp (seconds) as stored. `null` for POD1. */
  timestamp: number | null;
  /** POD2 only: the entry's stored payload CRC-32/MPEG-2, not verified. `null` for POD1 and EPD. */
  crc: number | null;
}

/** A parsed POD directory. Plain data, like `PodEntry`. */
export interface PodArchive {
  format: PodFormat;
  /** The header comment (EPD: its four-character title). For a track archive this is often the track's display name. */
  comment: string;
  /** Directory entries, in directory order. */
  entries: PodEntry[];
  /** Size of the archive the directory was read from. */
  byteLength: number;
  /** Absolute offset of the first directory record. */
  directoryOffset: number;
  /** First byte after all directory metadata: the records for POD1; the records and name table for POD2. */
  directoryEnd: number;
  /** POD2 only: the stored archive CRC-32/MPEG-2 over 0x08..EOF, not verified. `null` otherwise. */
  checksum: number | null;
  /** POD2 only: the audit record count from the header. The audit records themselves are not decoded. `null` otherwise. */
  auditCount: number | null;
}
