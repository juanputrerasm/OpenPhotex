# OpenPhotex

OpenPhotex reads the data formats of Terminal Reality games: Monster Truck Madness 1 and 2, CART Precision Racing, Terminal Velocity, Fury3, Hellbender, 4x4 Evolution 1 and 2, Fly! and Nocturne. It is written in TypeScript and runs in browsers and Node.js, and it ships a command-line tool, `openphotex`, for people, scripts and AI agents.

The aim is for OpenPhotex to be the one place where understood format behaviour lives. Viewers, converters and tools use it rather than carrying their own parsers, and new reverse-engineering findings are added here with tests. JSPod, JSTrackViewer, JSTruckViewer and JSMTM2Converter all read their game data through it.

**Version 1.0.** Every reader is checked against the retail archives of the game it belongs to, and every writer by reading its output back. The formats below are complete as listed; [docs/ROADMAP.md](docs/ROADMAP.md) records how the four apps moved onto the library.

## Supported formats

Each format has one example on the command line, using a stock file name; run it from the folder holding the archive. `read` prints a short summary; add `--json` for the reader's full result (see [Command line](#command-line)). An entry can be named by its path, by its file name when that is unique, or as `#<index>`.

### Archives

| Format | Games | What OpenPhotex does | Example |
|---|---|---|---|
| POD1 | MTM1, MTM2, CPR, TV, Fury3, Hellbender | List, extract, write (library: `writePod1`) | `openphotex pod list TRUCK2.POD --filter '*.TRK'` |
| POD2 | 4x4 Evolution 1 and 2, Nocturne | List, extract, check CRCs, read the edit history | `openphotex pod verify PEAK.pod` |
| | | | `openphotex pod audit PEAK.pod --filter '*.act'` |
| EPD | Fly! | List, extract | `openphotex pod info SC07.EPD` |
| Any of them | | Extract one entry or all of them | `openphotex pod extract TRUCK2.POD TRUCK/BIGFOOT.TRK -o bigfoot.trk` |

Details: [docs/POD.md](docs/POD.md).

### Textures and palettes

| Format | Games | Contents | Example |
|---|---|---|---|
| `.RAW` with `.ACT` | MTM, CPR, TV, Fury3, Hellbender, Evo, Fly! | 8-bit texture drawn through its palette, to PNG | `openphotex texture GAME.POD ART/01BAKGLS.RAW -o bakgls.png` |
| `.RAW` with a named palette | Fly! charts, anything without a same-stem `.ACT` | The same, with the palette chosen | `openphotex texture SC07.EPD SC07N1.RAW --palette SC07N.ACT -o chart.png` |
| `.OPA` | 4x4 Evolution | Opacity plane merged into the texture's alpha | `openphotex texture ASPEN.POD AS3PINE1.RAW --opa AS3PINE1.OPA -o pine.png` |
| `.ACT` | All | 256-colour palette, 6- or 8-bit | `openphotex read GAME.POD 01BAKGLS.ACT` |
| `.RAW` size | All | The square side a texture of that size has | `openphotex read GAME.POD 01BAKGLS.RAW` |
| `.TIF` | 4x4 Evolution 2 | Palette art and `_BUMP` normal maps, as RGBA | `openphotex read TRUCK.POD 31X10_08L.TIF` |

`texture` writes only square `.RAW` art. A `.TIF` decodes through `read`, and Nocturne's 640x480 backdrops are not rendered by the command line yet. Palette choice (`paletteCandidates`) and the four stock METALCR2 and VGA palettes (`bundledPalette`) are library functions. Details: [docs/RAW_ACT.md](docs/RAW_ACT.md).

### Models

| Format | Games | Contents | Example |
|---|---|---|---|
| `.BIN` | MTM1, MTM2, CPR, TV, Fury3, Hellbender, Fly! | MRGL model: vertices, faces, textures, materials, animated frame lists | `openphotex read TRUCK2.POD BIGFOOT.BIN` |
| `.SMF` | 4x4 Evolution 1 and 2 | Model with every animation frame and its materials | `openphotex read PEAK.pod CO1DROP.SMF` |
| `.CMD` | CPR | High-detail car model, with its wing packages | `openphotex read RACECAR.POD AARACE1.CMD` |
| `.BSP` | Fly! | Structure such as a bridge, as one model | `openphotex read NYMODELS.EPD NYBRIG01.BSP` |
| `.DFM` | Nocturne | Skeletal character mesh with its LODs | `openphotex read enemy.pod ARMOUR.DFM` |
| `.KFM` | Nocturne | Key-frame/morph prop and cloth model, binary or text | `openphotex read ACT1.POD A1-BOTTLE.KFM` |

Details: [docs/BIN.md](docs/BIN.md), [docs/EVO.md](docs/EVO.md), [docs/TRUCKS.md](docs/TRUCKS.md), [docs/FLY.md](docs/FLY.md), [docs/NOCTURNE.md](docs/NOCTURNE.md).

### Trucks and cars

| Format | Games | Contents | Example |
|---|---|---|---|
| `.TRK` (truck) | MTM1, MTM2, MTM2.1 | Truck manifest: models, wheels, scrape points, lights | `openphotex read TRUCK2.POD TRUCK/BIGFOOT.TRK` |
| `.TRK` (vehicle) | 4x4 Evolution 1 and 2 | Vehicle manifest with specs and paint schemes | `openphotex read TRUCK.POD AJWS.TRK` |
| `.CAR` | CPR | Car manifest | `openphotex read RACECAR.POD AARACE1.CAR` |

Details: [docs/TRUCKS.md](docs/TRUCKS.md).

### MTM and CPR levels

| Format | Games | Contents | Example |
|---|---|---|---|
| `.SIT`, `.SI2` | MTM1, MTM2, CPR | Scene script: ramps, boxes, checkpoints, courses, trucks | `openphotex read SUMMIT1.POD SUMMIT1.SIT` |
| `.LVL` | MTM1, MTM2, CPR | Level file: terrain, colours, palette, textures, sky, sun | `openphotex read SUMMIT1.POD SUMMIT1.LVL` |
| `.TEX` | MTM, CPR, TV family | Terrain texture list | `openphotex read SUMMIT1.POD SUMMIT1.TEX` |
| `.TTY` | MTM, CPR, TV family | Terrain texture types | `openphotex read SUMMIT1.POD SUMMIT1.TTY` |
| `.TRK` (track) | CPR | Road layer: 20-point cross sections, walls, textures | `openphotex read LAGUNA.POD LAGUNA.TRK` |
| `.TTX` | CPR | Road texture list with surface types | `openphotex read LAGUNA.POD LAGUNA.TTX` |

Heightfields (8-bit, and CPR's 10.6 fixed point) and ground boxes (`.RA0`, `.RA1`, `.CL0`) are decoded by the library (`decodeHeightSample`, `decodeGroundBoxes`); a lone grid means nothing without its level, so `read` does not take them. Details: [docs/LEVELS.md](docs/LEVELS.md).

### MTM2 game data

| Format | Games | Contents | Example |
|---|---|---|---|
| `.KLP` | MTM2 | Loop points for the `.WAV` of the same name | `openphotex read SOUND.POD ACCEL3B.KLP` |
| `SOUNDnnn.TXT` | MTM2 | A level's ambient sounds, checkpoint and lap sounds | `openphotex read SOUND.POD SOUND002.TXT` |
| `SUN.TXT` | MTM2 | Sun position and lens-flare layers | `openphotex read STARTUP.POD SUN.TXT` |
| `.LOC` | MTM2 | TRI Message System replacements (joke and Pig Latin wordings) | `openphotex read UI.POD MTM2-PIG.LOC` |
| `.MOD` | MTM2 | ProTracker modules (`parseMod`, and `renderMod` plays one into stereo PCM) | library only |
| `POWERBIG.200`/`.400`/`.480` | MTM2 | Cockpit layout per screen height | `openphotex read COCKPIT.POD POWERBIG.480` |

Details: [docs/MTM2_FILES.md](docs/MTM2_FILES.md). The game's own simulation rules are in the library as `mtm2Sim` ([docs/SIM_MTM2.md](docs/SIM_MTM2.md)).

### Terminal Velocity, Fury3 and Hellbender levels

| Format | Games | Contents | Example |
|---|---|---|---|
| `.LVL` | TV, Fury3, Hellbender | Level header: every side file, sky, sun | `openphotex read CDROM.POD ALIEN-T1.LVL` |
| `.DEF` | TV, Fury3, Hellbender | Object definitions and placements | `openphotex read CDROM.POD ALIEN-T1.DEF` |
| `.NAV` | TV, Fury3 | Navigation points | `openphotex read CDROM.POD ALIEN.NAV` |
| `.NAV` | Hellbender | Navigation points, Hellbender's record | `openphotex read GAME.POD FLOAT.NAV` |
| `.PUP` | TV, Fury3, Hellbender | Powerup placements | `openphotex read CDROM.POD ALIEN-T1.PUP` |
| `.TDF` | TV, Fury3, Hellbender | Tunnel definitions | `openphotex read CDROM.POD ALIEN-T1.TDF` |
| `.ANI` | TV, Fury3 | Animated textures | `openphotex read CDROM.POD ALIEN-T1.ANI` |
| `.TXT` briefing | Hellbender | Mission briefing labels | `openphotex read GAME.POD FLOAT.TXT --as hb-briefing` |

Hellbender's cavern (`.RA2`, `.RA3`, `.CL1`) and the sky gradient are library functions (`decodeHbUnderground`, `skyGradient`). Details: [docs/LEVELS.md](docs/LEVELS.md).

### 4x4 Evolution levels

| Format | Games | Contents | Example |
|---|---|---|---|
| `.SIT` | Evo 1 and 2 | Scene: placements, courses, vehicles | `openphotex read PEAK.pod PEAK.SIT` |
| `.LVL` | Evo 1 and 2 | Level settings, water, light | `openphotex read PEAK.pod PEAK.LVL` |
| `.WAT` | Evo 2 | Animated water material | `openphotex read BAJBEACH.pod BAJBEACH.WAT` |
| `.TEX` | Evo 1 and 2 | Terrain texture records | `openphotex read PEAK.pod PEAK.TEX` |
| `.VEG` | Evo 2 | Tree placements | `openphotex read BAJBEACH.pod BAJBEACH.VEG` |
| AI line `.TXT` | Evo 1 and 2 | A recorded lap for a computer driver (community tracks) | `openphotex read TERRAMAR.pod 'AI\CLASS1\AI_11TERRAMAR.TXT'` |

Details: [docs/EVO.md](docs/EVO.md).

### Fly! scenery

| Format | Contents | Example |
|---|---|---|
| `.SCF` | A scenery set's manifest | `openphotex read SANFRAN.SCF` |
| `SCENERY.Sxx` | Object placements in a quadrant | `openphotex read CHMODELS.EPD 'DATA\D192161\SCENERY.S10'` |
| `.ALT` | Terrain heights | `openphotex read CHICAGO1.EPD G00.ALT` |
| `.TYP` | Terrain cell types | `openphotex read CHICAGO1.EPD G00.TYP` |
| `.TEX` | Terrain texture names | `openphotex read CHICAGO1.EPD G00.TEX` |
| `.REF` | Texture references, laid out by the `.TYP` | `openphotex read CHICAGO1.EPD G00.REF` |
| `.AL2` | Detail heights, laid out by the `.TYP` | `openphotex read CHICAGO1.EPD G00.AL2` |

A `.REF` or `.AL2` is read from its archive, because its layout comes from the quadrant's `.TYP`. The globe tile grid and texture names are library functions (`flyTileAt`, `parseFlyTextureName`). Details: [docs/FLY.md](docs/FLY.md).

### Nocturne

| Format | Contents | Example |
|---|---|---|
| `.SKL` | Skeleton and animation bank | `openphotex read enemy.pod ARMOUR.SKL` |
| `.CTH` | Cloth properties for a `.KFM` | `openphotex read enemy.pod BATWING.CTH` |
| `.SET` | Scene manifest: fog, lights, cameras | `openphotex read DUNGEON.POD DUNGEON.SET` |
| `.GEO` | Collision geometry grid | `openphotex read DUNGEON.POD DUNGEON.GEO` |
| `.FOG` | Per-camera fog density | `openphotex read DUNGEON.POD DUN03.FOG` |
| `.THM` | Location thumbnails | `openphotex read DUNGEON.POD DUNGEON.THM` |
| `.ZTH` | Per-camera depth thumbnails | `openphotex read DUNGEON.POD DUNGEON.ZTH` |

`.DFM` and `.KFM` are under Models. Details: [docs/NOCTURNE.md](docs/NOCTURNE.md).

### Writers

The writers are library functions; the command line does not write game files. Each output is checked by reading it back with OpenPhotex's own reader.

| Writes | Function |
|---|---|
| POD1 archives | `writePod1`, `buildPod1Directory` |
| `.BIN` models | `writeBin` |
| `.RAW` with its own `.ACT` | `encodeRawTexture` |
| MTM2 `.SIT`, `.LVL`, `.TEX`, empty side files | `writeMtm2Sit`, `writeMtm2Lvl`, `writeTexList`, `writeEmptyList` |
| MTM2 `.LTE` light grid and ground-box grids | `buildMtm2Lte`, `emptyGroundBoxGrids` |
| MTM2 level palette and `FOG\<track>.MAP` | `mtm2LevelPalette`, `buildFogMap` |
| MTM2 2.1 truck `.TRK` | `writeMtm2Trk` |

Details: [docs/BIN.md](docs/BIN.md), [docs/RAW_ACT.md](docs/RAW_ACT.md), [docs/LEVELS.md](docs/LEVELS.md), [docs/TRUCKS.md](docs/TRUCKS.md).

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
| `parseDfm`, `parseSkl`, `parseKfm`, `parseCth` | Nocturne character meshes, skeleton animations, morph models and cloth definitions. |
| `parseNocturneSet`, `parseNocturneGeo`, `parseNocturneFog` | Nocturne pre-rendered scene manifests, collision grids and per-camera fog data. |
| `parseNocturneThm`, `parseNocturneZth` | Nocturne location thumbnails and per-camera depth thumbnails. |
| `parseMtmSit`, `parseMtmLvl`, `parseTexList`, `parseTty` | MTM1, MTM2 and CPR scene scripts and level files; `detectSitOrigin` tells the three apart. |
| `parseKlp`, `parseMtmAmbientSounds`, `parseMtmSun`, `parseLoc`, `parseCockpitLayout`, `parseMod`, `renderMod` | MTM2 loop points, ambient sounds, sun and flare, message replacements and cockpit layouts. |
| `mtm2Sim` | The MTM2 simulation: terrain, surfaces, water, courses, checkpoints, truck parameters, controls and drivetrain ([docs/SIM_MTM2.md](docs/SIM_MTM2.md)). |
| `parseCprTrk`, `parseCprTtx` | CPR's road layer and its texture list, with the cross-section schema (`CPR_POINT_NAMES`, `CPR_WALL_LAYERS`, `cprVisibleSlots`, `cprTrackIsClosed`). |
| `parseTvLvl`, `parseDef`, `parseNavPoints`, `parseHbNavPoints`, `parsePowerups`, `parseTunnelDefs`, `parseAnimations`, `parseHbBriefing` | Terminal Velocity, Fury3 and Hellbender level files; `placementToEditor` converts their coordinates. |
| `decodeHeightSample`, `decodeGroundBoxes`, `decodeHbUnderground`, `skyGradient` | Heightfields, ground boxes, Hellbender's cavern and the sky gradient. |
| `parseEvoAiLine`, `lapRuns`, `evoHeightAt` | 4x4 Evolution AI lines, the course runs that make a lap, and terrain sampling. |
| `paletteCandidates`, `bundledPalette` | Which `.ACT` a texture should use, ranked, and the four stock METALCR2 and VGA palettes. |
| `parseFlyScf`, `parseFlySceneryObjects`, `parseFlyQuadrant`, `parseFlyBsp`, `flyTileAt` | Fly! scenery manifests, object placements, terrain quadrants, structures and the globe tile grid. |
| `writeBin`, `encodeRawTexture`, `writeMtm2Sit`, `writeMtm2Lvl`, `writeMtm2Trk`, `buildMtm2Lte`, `mtm2LevelPalette`, `buildFogMap` | The writers listed under [Writers](#writers). |
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

- **Reading a game file:** run `openphotex read <archive> <entry> --json`, or `pod` and `texture`, never a parser written for the occasion. That includes disposable Python scripts; Python is for analysing OpenPhotex's JSON, not for decoding the bytes.
- **Bulk work:** import the library from a Node script rather than running the command line thousands of times.
- **Unknown bytes:** exploring a format or field OpenPhotex does not read yet is fine, with the bytes taken from `openphotex pod extract --stdout`.
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
  pod/        POD1, POD2 and EPD parsing, POD1 writing, lookup, path rules, POD2 integrity data
  texture/    .RAW, .ACT, .OPA and .TIF decoding, palette ranking, bundled palettes, encoding
  model/      .BIN reading and writing
  truck/      truck and car manifests
  mtm/        MTM and CPR .SIT and .LVL, MTM2 writers, level palette
  cpr/        CPR .CMD models and the .TRK road layer
  tv/         Terminal Velocity, Fury3 and Hellbender level files and coordinates
  terrain/    heightfields, ground boxes, Hellbender's cavern
  evo/        4x4 Evolution world files, models, manifests, AI lines
  fly/        Fly! scenery, terrain quadrants, globe grid, structures
  nocturne/   Nocturne models, animation, cloth and scene files
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
