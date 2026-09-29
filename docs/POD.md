# POD archives

POD is the container Terminal Reality games ship their data in: one file holding a flat directory of named entries followed by their payloads. There is no compression. OpenPhotex reads three members of the family and writes POD1.

| Format id | Games | Identified by | Read | Write |
|---|---|---|---|---|
| `pod1` | Monster Truck Madness 1 and 2, CART Precision Racing, Terminal Velocity, Fury3, Hellbender | No signature; a directory that validates | yes | yes |
| `pod2` | 4x4 Evolution 1 and 2 (also Nocturne, per upstream references) | `"POD2"` at offset 0 | yes | no |
| `epd` | Fly! | `"dtxe"` at offset 0 | yes | no |

Conventions shared by all three:

- All integers are little-endian.
- Strings are 8-bit and NUL-terminated inside fixed-width fields. A reader stops at the first `0x00` or at the field edge. Bytes after a terminator are not guaranteed to be zero.
- OpenPhotex decodes text as windows-1252: the WHATWG `latin1` label maps to windows-1252, so byte `0x80` becomes `€`. It encodes with the exact inverse when writing. No shipped archive uses a byte above `0x7E` in a name.
- Names are trimmed of code points `U+0000` to `U+0020` at both ends.

This document records what the implementation relies on and the evidence for it. The companion specification is JPod's [`docs/POD_FORMAT.md`](https://github.com/juanputrerasm/JPod/blob/main/docs/POD_FORMAT.md), a survey of 67 archives that includes the engine-derived POD1 hand-over. The code is `src/pod/parse.ts` and `src/pod/write.ts`, and the tests in `test/` pin every rule below.

## Format dispatch

The signatures are checked first: `dtxe` is EPD and `POD2` is POD2. Anything else is POD1, accepted only if its directory validates. POD1 has no signature.

## POD1

```
0x00  4      int32 entry count
0x04  80     comment, NUL-terminated
0x54  n*40   directory records
...          payloads, contiguous, in directory order
```

Each 40-byte record:

```
+0x00  32  name field: path NUL [palette NUL] remainder
+0x20  4   payload length
+0x24  4   absolute payload offset
```

The engine reads the record straight into its entry struct (`engine\pod.h`, `CPod::validatePodFile`), so it is always 40 bytes. The longest path is 31 bytes plus its terminator, and every character of the stored path counts toward that, including any `ART\` or `MODELS\` prefix.

### Validation

A file is POD1 only when all of these hold. The first failure raises a `PodFormatError` with a code and the entry index.

- The entry count is between 1 and 8192. It is read signed, so a set high bit reads negative and is rejected. Hellbender's `GAME.POD` has 4,341 entries, so a lower cap would be wrong.
- The directory fits in the file.
- Every name field contains a NUL: the path ends inside its 32 bytes.
- Every path, after trimming, is non-empty, contains no control character below `0x20`, and contains no `:`.
- Every payload satisfies `offset <= fileSize && length <= fileSize - offset`, a form that cannot overflow. A zero-length entry at EOF is allowed.

Length and offset are read as unsigned. The engine reads them as signed, and for any file under 2 GiB the two readings accept and reject exactly the same archives.

### The palette record

The name field may hold a second NUL-terminated string after the path: the bare file name of the `.ACT` palette a `.RAW` texture was authored against.

```
"ART\BASHP.RAW" 00 "BIONSHIP.ACT" 00 00 00 00 00 00
```

The packers used by MTM1, Terminal Velocity, Fury3 and Hellbender wrote one on every `.RAW` entry. MTM2 and CPR zero the field after the path. JPod's survey found 9,967 such records in 9 archives from 4 games, and in every one:

- The record appears only on `.RAW` entries.
- There is never a third string.
- The value ends in `.ACT` and has no directory part.
- It starts right after the path's terminator.
- The rest of the field is zero.

OpenPhotex returns it as `PodEntry.paletteName` only when the path ends in `.RAW` and the second string is terminated and ends in `.ACT`. That guard is needed: the community archive `POWER.POD` has leftover heap bytes after 30 of its names, 21 of them on non-`.RAW` entries, and none ending in `.ACT`. Everything else after a terminator is opaque and never affects lookup.

The name is a file name, so it resolves against entry file names, not full paths: `BIONSHIP.ACT` means `ART\BIONSHIP.ACT`. It may not resolve inside the same archive. MTM1's `TRUCK.POD` names `METALCR2.ACT`, which ships in `GAME.POD`. Where a record exists it is the archive stating the answer outright. Name-based heuristics such as "the first `.ACT` in the archive" disagree with it on 8,221 of 8,224 `.RAW` entries in the four palette-writing games.

### Writing POD1

`buildPod1Directory(comment, entries)` encodes the header and directory, and `writePod1` appends the payloads. The rules follow the POD1 writer contract that JPod, JSPod and JSMTM2Converter share:

- **Record size:** exactly 40 bytes, never widened.
- **Names:** a name that does not fit 31 bytes is refused with `NAME_TOO_LONG`, never truncated. A truncated name packs fine and then silently never resolves in game.
- **Palette records:** written only when given, which should mean preserved from an existing archive. They must be a bare `.ACT` name on a `.RAW` entry, and the path, the palette and both terminators must fit in 32 bytes.
- **Refused inputs:**
  - Duplicate paths, compared ignoring case and separator style. A duplicate can never be looked up. Some community archives do contain duplicates (see below).
  - Names the reader would reject.
  - Comments over 79 bytes.
  - Text windows-1252 cannot store.
  - More than 8192 entries.
  - Archives larger than `2^31 - 1` bytes, because the engine reads sizes and offsets signed.
- **Order and case:** entries are stored in the order given, with payloads contiguous from the end of the directory. Names are stored exactly as given. Every shipped archive uses upper case with backslashes, and the engine upper-cases names when it mounts an archive.
- **Leftover bytes:** the remainder of every field is zero-filled. Leftover producer bytes are not reproduced.

**Round trip:** all 66 stock POD1 archives (MTM1, MTM2, CPR, TV, Fury3 and Hellbender) rebuild byte for byte from their parsed comment, entries and palette records. `test/stock.test.ts` checks this whenever the games are present. Among 19 community archives, 9 rebuild exactly and 10 do not:

- 6 have heap junk in the comment field, for example `POWER.POD`.
- 1 has junk after a name's terminator and gaps between payloads (`DEJAVUD0.pod`).
- 3 contain a duplicate path, for example `7whatsit.pod`, which stores `ART\DOZRTRAK.ACT` twice. The engine serves the first copy.

## POD2

```
0x00  4      "POD2"
0x04  4      archive CRC-32/MPEG-2 over 0x08..EOF
0x08  80     comment, NUL-terminated; for a track, its display name
0x58  4      uint32 entry count
0x5c  4      uint32 audit record count
0x60  n*20   directory records
...          name table: NUL-terminated paths
...          payloads
```

Each 20-byte record holds five uint32 values:

- name offset, relative to the start of the name table;
- payload length;
- absolute payload offset;
- Unix timestamp;
- payload CRC-32/MPEG-2.

### Validation

- The entry count is between 1 and 65536.
- The records fit in the file.
- The name table runs from the end of the records to the lowest payload offset at or after that point, or to EOF if there is none. Bounding it by the first payload keeps a corrupt name offset from scanning megabytes of payload for a NUL.
- Every name offset lies inside the name table, and every name ends inside it and is non-empty.
- Every payload lies inside the file.

Entries may share name-table strings.

### CRCs and the audit trail

Parsing returns the stored CRCs (`checksum`, `crc`) but never checks them. A reader that refused a track because one byte of a `.WAV` it never plays went bad would be worse than one that draws the track. Checking is a separate, explicit step: `verifyPodChecksums`, or `openphotex pod verify`.

- **CRC:** the algorithm is CRC-32/MPEG-2: polynomial `0x04C11DB7`, initial value `0xFFFFFFFF`, not reflected, no final XOR. Its check value for `"123456789"` is `0x0376E6E7`. The archive CRC covers `0x08..EOF`, which includes the audit trail. Each entry CRC covers only that entry's payload.
- **Audit trail:** `auditCount` 312-byte records fill the last bytes of the file, directly after the payloads. Decode them with `readPod2AuditTrail` or `openphotex pod audit`:

```
+0x000  32   user, NUL-terminated
+0x020  4    timestamp of the edit
+0x024  4    action: 0 add, 1 remove, 2 change
+0x028  256  entry path, NUL-terminated
+0x128  4    old timestamp
+0x12c  4    old size
+0x130  4    new timestamp
+0x134  4    new size
```

JPod's specification described both layouts but had no POD2 archive to check them on. They are verified here against all 11 stock 4x4 Evolution 1 and 2 archives:

- Every archive CRC matches, and so do all 16,461 entry CRCs.
- Every audit trail fills exactly the bytes from the last payload to EOF: 37,501 records.
- The action codes are only 0, 1 and 2, and they behave as named: 21,683 adds carry only new values, 5,222 removes carry only old values, and 10,596 changes carry both.
- The first record in `ASPEN.POD` reads `david`, 2000-08-31, add `ART\AS1DROP.ACT`, 768 bytes.

`test/stock.test.ts` repeats this check whenever the games are present.

## EPD

Fly!'s container. It is known from one archive, `SC24.EPD` (54 entries), and OpenPhotex matches JSPod on it entry for entry.

```
0x00   4      "dtxe"
0x04   4      four-character archive title, returned as the comment
0x08   136    unidentified, non-zero
0x90   4      uint32 entry count
0x94   124    unidentified, non-zero
0x110  n*80   directory records
...           payloads
```

Each 80-byte record:

```
+0x00  4   path prefix
+0x04  60  path remainder
+0x40  4   payload length
+0x44  4   absolute payload offset
+0x48  4   Unix timestamp
+0x4c  4   unidentified, distinct per entry, probably a checksum (not exposed)
```

The path is rebuilt from the prefix and remainder:

- If the prefix matches `[A-Z0-9_]+` and the remainder starts with `\`, the path is the two joined, for example `MAPS` + `\SC24N.ACT`.
- Otherwise, if the remainder is not empty, the remainder alone is the path.
- Failing that, the path is the whole 64-byte field read as one string.

In `SC24.EPD` every timestamp falls in 1999, the year Fly! shipped, which supports the timestamp reading. The padding after every string is the Windows debug-heap pattern `BA AD F0 0D`, so it carries no meaning.

EPD validation covers the count (1 to 65536), the directory bounds and the payload bounds. Empty names are not rejected, matching JSPod. There is only one sample, so the bounds stay lenient.

## Reading only the directory

`parsePod(prefix, { byteLength })` parses from the first bytes of a file, so a browser can index a large `File` or `Blob` without loading its payloads. `podDirectoryEnd(prefix, byteLength)` says how many leading bytes are needed:

- POD1 is complete after a read past the header.
- EPD is complete after a read to its count and then its table.
- POD2 needs a further read for its name table, which ends where the first payload begins. That is only known once the records are read.

## Not a format: "Extended POD1"

At one point, JSTrackViewer and JSMTM2Converter retried a failed POD1 directory with 64-byte names and 72-byte records. No such format exists. The engine's record is fixed at 40 bytes, and the "64-byte name" in the C-Pod long-name notes refers to `.bin` model records, not the POD directory. OpenPhotex rejects that layout, usually with `BAD_ENTRY_NAME` on entry 1. The only files known to use it came from early JSMTM2Converter builds.

## Open questions

- **EPD:** the meaning of the unidentified EPD header regions and of the last word of each record.
- **Palette records:** whether any engine reads the POD1 palette record. It is safe to use as a hint, but nothing should depend on it.
- **Entry limits:** whether the engines impose real limits on entry counts. 8192 and 65536 are sanity bounds.
