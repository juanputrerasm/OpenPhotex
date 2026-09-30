# OpenPhotex

OpenPhotex reads the data formats of Terminal Reality games: Monster Truck Madness 1 and 2, CART Precision Racing, Terminal Velocity, Fury3, Hellbender, 4x4 Evolution 1 and 2, and related titles. It is written in TypeScript and runs in browsers and Node.js, and it also ships a command-line tool for people, scripts and AI agents.

The aim is for OpenPhotex to be the one place where understood format behaviour lives. Viewers, games and tools use it rather than carrying their own parsers, and new reverse-engineering findings are added here with tests.

**v0.1 covers:**

- **POD archives:** reads POD1, POD2 and EPD, and writes POD1. POD2 CRCs can be verified and its audit trail decoded. See [docs/POD.md](docs/POD.md).
- **8-bit textures:** `.RAW` textures, `.ACT` palettes and 4x4 Evolution `.OPA` opacity planes. See [docs/RAW_ACT.md](docs/RAW_ACT.md).
- **4x4 Evolution data:** `.SIT`, `.LVL`, `.WAT`, `.TEX` and `.VEG` world files, `.SMF` models, `.TRK` vehicle manifests, `.TIF` textures, AI lines and terrain sampling. See [docs/EVO.md](docs/EVO.md).
- **Fly! scenery:** `.SCF` manifests, `SCENERY.Sxx` object placements, the terrain quadrant files (`.ALT`, `.TYP`, `.TEX`, `.REF`, `.AL2`) and the globe tile grid. See [docs/FLY.md](docs/FLY.md).
- **Models:** `.BIN` (MRGL) models of every MTM, CPR, TV, Fury3 and Hellbender title, including animated frame lists. See [docs/BIN.md](docs/BIN.md).
- **Levels:** MTM1, MTM2 and CPR `.SIT`, `.LVL`, `.TEX` and `.TTY`; CPR's `.TRK` road layer and `.TTX`; Terminal Velocity, Fury3 and Hellbender `.LVL`, `.DEF`, `.NAV`, `.PUP`, `.TDF`, `.ANI` and briefings; heightfields, ground boxes, Hellbender's cavern and the sky gradient. See [docs/LEVELS.md](docs/LEVELS.md).
- **Writers:** `.BIN` models, `.RAW`/`.ACT` texture pairs, and MTM2 `.SIT`, `.LVL`, `.TEX`, `.LTE`, ground-box grids, level palette, fog map and 2.1 `.TRK`, each checked by reading its output back. See [docs/BIN.md](docs/BIN.md), [docs/RAW_ACT.md](docs/RAW_ACT.md), [docs/LEVELS.md](docs/LEVELS.md) and [docs/TRUCKS.md](docs/TRUCKS.md).
- **Palette choice:** which `.ACT` an 8-bit texture should use, as a ranked list, plus the four stock METALCR2 and VGA palettes a single archive lacks. See [docs/RAW_ACT.md](docs/RAW_ACT.md).
- **Truck and car manifests:** MTM1, MTM2 and MTM2.1 `.TRK`, CPR `.CAR`, and Evo `.TRK`, with dialect detection; CPR `.CMD` car models. See [docs/TRUCKS.md](docs/TRUCKS.md).

[docs/ROADMAP.md](docs/ROADMAP.md) tracks moving the remaining formats out of JSPod, JSTruckViewer, JSMTM2Converter and JSTrackViewer.

## Using the library

```js
import { parsePod, findPodEntry, readPodEntry } from "openphotex";

const bytes = new Uint8Array(await file.arrayBuffer());   // or fs.readFileSync(path)
const pod = parsePod(bytes);

pod.format;            // "pod1" | "pod2" | "epd"
pod.comment;           // header comment, e.g. "MTM2 Trucks"
pod.entries.length;

const entry = findPodEntry(pod, "truck/bigfoot.trk");    // case and / vs \ insensitive
const data = readPodEntry(bytes, entry);                 // a copy of the payload
```

The core is environment-neutral. It takes a `Uint8Array` or `ArrayBuffer` and returns plain data. It never touches the DOM, OPFS, `fetch` or the file system, so reading files is left to the caller. A parsed archive holds no reference to the bytes, so it can be posted between workers or serialized as JSON.

### API

| Export | Description |
|---|---|
| `parsePod(bytes, { byteLength? })` | Parse the header and directory and return a `PodArchive`. Throws `PodFormatError`. |
| `podDirectoryEnd(prefix, byteLength)` | How many leading bytes `parsePod` needs, for reading only the directory of a large file (see below). |
| `readPodEntry(bytes, entry)` | A copy of an entry's payload. Pass `{ offset, length }` to read part of one. |
| `findPodEntry(pod, path)` | Look up an entry by path, ignoring case and `/` vs `\`. |
| `findPodEntryByTitle(pod, name)` | The first entry whose file name matches. |
| `findPodEntriesByExtension(pod, ".RAW")` | Entries whose file name ends with the suffix. |
| `normalizePodPath`, `podPathTitle` | The path normalization that lookups use. |
| `buildPod1Directory(comment, entries)` | Encode a POD1 header and directory for `{ name, length, paletteName? }` entries. The payloads follow it in the same order. Throws `PodWriteError`. |
| `writePod1(comment, entries)` | A complete POD1 from `{ name, data, paletteName? }` entries. |
| `pod1DirectoryEntries(entries)` | A parsed archive's entries in the form the writer takes. Rebuilding a stock POD1 from it reproduces the original directory byte for byte. |
| `verifyPodChecksums(bytes, pod)` | POD2: compare the stored archive and entry CRCs with the data. `crc32Mpeg2` is the checksum itself. |
| `readPod2AuditTrail(bytes, pod)` | POD2: the packer's edit history, one `add`, `remove` or `change` record per edit. |
| `decodeActPalette(bytes)` | An `.ACT` as 768 bytes of 8-bit RGB, scaling a 6-bit VGA table (see [RAW_ACT.md](docs/RAW_ACT.md)). `actPaletteDepth` reports which reading applies. |
| `decodeRawTexture(raw, palette, { family?, cutout? })` | A `.RAW` texture as `{ width, height, rgba, hasAlpha }`. `family` is `classic` or `evo`. `cutout` applies the classic color key. |
| `rawTextureSide(byteLength, family?)` | The side of a square texture of this size, or 0. |
| `applyOpacityPlane(image, opa)` | Put a 4x4 Evolution `.OPA` into the alpha channel. |
| `parseEvoSit`, `parseEvoLvl`, `parseEvoWat`, `parseEvoTex`, `parseEvoVeg` | 4x4 Evolution world files as plain objects; `isEvoSit` tells an Evo `.SIT` from an MTM one. |
| `parseSmf(bytes, name)` | An `.SMF` model in Evo's own axes (Y up) and the file's winding: groups with every animation frame as `Float64Array`s, indexed faces, and verbatim material fields. `smfTextureReference` normalizes a texture field. |
| `parseEvoTrk(bytes, name)` | A v6/v7 vehicle manifest: wheel anchors, scrape points, lights, paint schemes, counted lists and every other field (`specs`, `rawValues`, `fieldOrder`). `truckManifestLines` prepares any truck manifest's lines. |
| `parseBin(bytes)` | A `.BIN` model as the file states it: raw vertex words, faces in file order with the texture, colour and material in force for each, decoded materials, or an animated model's frame names. `MRGL`, `MRGLMAT`, `MRGLMAT2`, `BIN_GEOMETRY_DIVISOR` and friends name the constants. |
| `parseTruckManifest(bytes)` | Any truck or car manifest, as `{ kind, manifest }` with `kind` `mtm`, `cpr-car` or `evo`. `detectTruckManifest`, `parseMtmTrkLines` and `parseCprCarLines` are the parts. |
| `parseCprCmd(bytes, name)` | A CPR `.CMD` car model: parts with their raw fixed-point vertices, normals and faces. `CMD_POSITION_SCALE`, `CMD_NORMAL_SCALE` and `CMD_UV_SCALE` convert them; `cmdWingPackages` and `cmdFaceTriangles` hold the aero-package and quad-split rules. |
| `decodeTiff(bytes, name)` | An Evo 2 `.TIF` as RGBA, with `kind` `palette` (diffuse art) or `rgb` (`_BUMP` normal maps). |
| `PodFormatError` | Has `.code` (`TOO_SMALL`, `BAD_ENTRY_COUNT`, `DIRECTORY_OUT_OF_BOUNDS`, `BAD_ENTRY_NAME`, `ENTRY_OUT_OF_BOUNDS`) and `.entryIndex`. |
| `PodWriteError` | Has `.code` (`BAD_ENTRY_COUNT`, `BAD_NAME`, `NAME_TOO_LONG`, `DUPLICATE_NAME`, `BAD_PALETTE`, `BAD_TEXT`, `TOO_LARGE`) and `.entryIndex`. |
| `PodArchive` | `format`, `comment` (EPD: its title, the archive's own stem), `entries`, `byteLength`, `directoryOffset`, `directoryEnd`, `checksum`, `auditCount`. The last two are POD2 only and `null` otherwise. |
| `PodEntry` | `index`, `name` (as stored), `normalizedName`, `title`, `length`, `offset`, `recordOffset`, `paletteName` (POD1 `.RAW` only), `timestamp` (POD2 and EPD), `crc` (POD2 only). |

### Reading only the directory

To index a large `File` or `Blob` without loading it:

```js
let prefix = new Uint8Array(0);
for (;;) {
  const need = podDirectoryEnd(prefix, file.size);
  if (need <= prefix.length) break;
  prefix = new Uint8Array(await file.slice(0, need).arrayBuffer());
}
const pod = parsePod(prefix, { byteLength: file.size });
// then read payloads with file.slice(entry.offset, entry.offset + entry.length)
```

### Using it without a bundler

The build is plain ES modules with relative imports. Projects served as static files, such as [JSTrackViewer](https://github.com/juanputrerasm/JSTrackViewer), vendor the core:

```sh
npm run build
npm run vendor -- ../JSTrackViewer/src/vendor/openphotex
```

This copies `dist/` without the CLI, adds the license, and writes a `VERSION` file naming the version and commit. The copy is generated output: change OpenPhotex and re-vendor it rather than editing the copy.

## Command line

```sh
npm install && npm run build && npm link      # puts `openphotex` on PATH
```

```sh
openphotex pod info GAME.POD
openphotex pod list GAME.POD
openphotex pod list GAME.POD --filter '*.RAW'          # file-name pattern
openphotex pod list GAME.POD --filter 'art/*' --json   # path pattern
openphotex pod extract GAME.POD TRUCK/BIGFOOT.TRK      # writes ./BIGFOOT.TRK
openphotex pod extract GAME.POD BIGFOOT.TRK -o out.trk # a file name works if unique
openphotex pod extract GAME.POD '#12' --stdout | xxd | head
openphotex pod extract GAME.POD --all -o extracted/
openphotex pod verify TRACK.POD                        # POD2: check the stored CRCs
openphotex pod audit TRACK.POD --filter '*.act'        # POD2: who changed what, and when
openphotex texture GAME.POD ART/GRASS.RAW -o grass.png # render a texture to PNG
openphotex texture TRACK.POD ART/PINE.RAW --opa ART/PINE.OPA -o pine.png
openphotex texture LOOSE.RAW --act LOOSE.ACT -o loose.png
openphotex read LAGUNA.POD LAGUNA.TRK                  # what a file says, through its reader
openphotex read GAME.POD FLOAT.NAV --json              # the reader's result as JSON
openphotex read TRUCK2.POD BIGFOOT.BIN --json --full   # typed arrays in full
openphotex read LOOSE.LVL --as tv-lvl                  # a loose file, reader named
```

`read` picks the reader from the file's extension, then its content, then the archive it came from: `.SIT` is 4x4 Evolution or MTM by content, a CPR road `.TRK` by its `CRaceTrack.trackCount` label, a Hellbender `.NAV` by its `!priority,time` sections, and a `.LVL` by the archive (POD2 is Evo; a POD1 carrying a `.SIT` or `.SI2` is MTM, any other is the Terminal Velocity family). A `.TEX` inside an EPD is a Fly! texture list. A Fly! `.REF` or `.AL2` is laid out by its quadrant's `.TYP`, so it is read from its archive, never loose. A loose `.LVL` has no archive to ask, so give `--as`. `openphotex --help` lists every format id. Files with no standalone reader (grids such as `.CLR` and `.RA0`, sound, video) fail with `UNSUPPORTED_FORMAT`.

`texture` draws with, in order:

1. `--palette <entry>` or `--act <file>`, when given;
2. the same-stem `.ACT` in the archive;
3. the POD1 palette record.

With none of these it fails with `PALETTE_REQUIRED` rather than guessing. Its JSON output reports which palette it used and why. The texture's size rules come from the POD (POD2 means `evo`) unless `--family` says otherwise. `--cutout` applies the classic color key.

An `<entry>` can be given three ways:

- an archive path, in any case, with `/` or `\`;
- a file name that matches exactly one entry;
- `#<index>`.

Output files are never overwritten unless `--force` is given. `pod list --raw` adds each directory record's bytes as hex.

### JSON output

`--json` prints one JSON document on stdout and nothing else. The document has these properties:

- Every key is always present, with `null` when a value does not apply, and keys come in a fixed order.
- Entries come in directory order.
- `schemaVersion` changes only on an incompatible change, never for an added field.

The `pod list` shape:

```json
{
  "schemaVersion": 1,
  "command": "pod list",
  "file": "TRUCK2.POD",
  "filter": null,
  "archive": {
    "format": "pod1", "comment": "MTM2 Trucks", "byteLength": 5515571, "entryCount": 439,
    "directoryOffset": 84, "directoryEnd": 17644, "checksum": null, "auditCount": null
  },
  "entries": [
    {
      "index": 420, "name": "TRUCK\\BIGFOOT.TRK", "normalizedName": "TRUCK/BIGFOOT.TRK",
      "title": "BIGFOOT.TRK", "offset": 5420955, "length": 6156, "recordOffset": 16884,
      "paletteName": null, "timestamp": null, "crc": null
    }
  ]
}
```

- **`pod info`:** prints `schemaVersion`, `command`, `file` and `archive`.
- **`pod extract`:** prints `extracted: [{ index, name, normalizedName, length, output }]`.
- **`pod verify`:** prints `format`, `ok`, `archive: { stored, computed, ok }`, `entriesChecked` and `mismatches: [{ index, name, stored, computed }]`. The command exits with 5 when `ok` is false.
- **`pod audit`:** prints `filter`, `auditCount` and `records: [{ index, offset, user, timestamp, actionCode, action, path, oldTimestamp, oldSize, newTimestamp, newSize }]`.
- **`read`:** prints `file`, `entry` (null for a loose file), `format`, `reader` (the library function used) and `data`, which is that function's return value: its shape is the function's documented type. Typed arrays appear as `{ "typedArray": "Int32Array", "length": n }` unless `--full` is given.
- **`texture`:** prints `file`, `entry`, `family`, `width`, `height`, `hasAlpha`, `palette: { source, name, depth }`, `opacity` and `output`. The palette `source` is one of `act-file`, `palette-entry`, `same-stem` or `palette-record`.

### Errors and exit codes

Errors go to stderr. With `--json` an error is also a JSON document, and stdout stays empty:

```json
{ "schemaVersion": 1, "error": { "code": "ENTRY_NOT_FOUND", "message": "No entry 'X' in the archive.", "selector": "X" } }
```

| Exit | Meaning | `error.code` |
|---|---|---|
| 0 | Success | |
| 1 | Bad usage | `USAGE` |
| 2 | File or I/O problem | `FILE_NOT_FOUND`, `IO_ERROR`, `OUTPUT_EXISTS` |
| 3 | Not a readable POD, or the wrong kind of data for the command | `TOO_SMALL`, `BAD_ENTRY_COUNT`, `DIRECTORY_OUT_OF_BOUNDS`, `BAD_ENTRY_NAME`, `ENTRY_OUT_OF_BOUNDS` (with `entryIndex`), `UNSUPPORTED_FORMAT` |
| 4 | Entry or palette not found, or ambiguous | `ENTRY_NOT_FOUND`, `AMBIGUOUS_ENTRY` (with `candidates`), `PALETTE_REQUIRED` (with `paletteName`) |
| 5 | A check failed | `CHECKSUM_MISMATCH` |

## For AI agents

OpenPhotex is meant to replace one-off parsers written in the middle of an investigation. Agents get their operating instructions from the `openphotex` skill, which is kept in the user's personal skills folder (`~/.claude/skills/openphotex/SKILL.md`, symlinked for Codex) so that it applies in every repository. In short:

- **Inspecting a POD or texture:** run `openphotex pod ... --json` or `openphotex texture ...` rather than writing a parser.
- **Exploratory scripts:** these are fine for hypotheses and byte analysis, but a second permanent parser for a format OpenPhotex reads is not.
- **Something missing:** when OpenPhotex lacks information an investigation needs, extend it here with tests.

[AGENTS.md](AGENTS.md) covers working on OpenPhotex itself.

## Development

Requires Node.js 22.18 or newer, because the tests run TypeScript directly through Node's type stripping.

```sh
npm install
npm run build       # dist/: the core and dist/cli/
npm test            # builds, then runs node --test test/
npm run typecheck   # core, CLI and tests
```

```
src/          core library: no DOM, no Node; compiled against the bare ES2022 lib
  pod/        POD parsing, writing, lookup, path rules and POD2 integrity data
  texture/    .RAW, .ACT and .OPA decoding
cli/          the openphotex command (Node only); imports the core as "openphotex"
test/         node:test suites; fixtures/ builds synthetic PODs byte by byte
docs/         format documentation
scripts/      vendor.mjs
```

The tests use synthetic archives built in `test/fixtures/build.ts`, and no game data is committed. `test/stock.test.ts` also checks retail archives when they are present in `~/games/<game>/`, or in the folder named by `OPENPHOTEX_GAMES`, and skips itself otherwise.

The core is kept portable in two ways. `tsconfig.json` gives `src/` no DOM or Node types, and `test/portability.test.ts` fails if `src/` uses Node or browser APIs or third-party imports. The core has no runtime dependencies.

When adding format knowledge:

1. Write a fixture test that states the behaviour.
2. Implement it.
3. Record the evidence and any remaining uncertainty in `docs/`.

Preserve behaviour that real archives depend on, and change it only with evidence.

## License

Apache 2.0. See [LICENSE](LICENSE).
