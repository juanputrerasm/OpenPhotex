# 4x4 Evolution data

4x4 Evolution 1 and 2 ship their tracks and vehicles in POD2 archives (see [POD.md](POD.md)). Inside, the world data is line-oriented text, and models and textures are text and TIFF files. OpenPhotex reads all of them:

| File | Contents | Reader |
|---|---|---|
| `.SIT` | Scene script: header, placements ("boxes"), starting grid, courses | `parseEvoSit` (`isEvoSit` tells it from the MTM `.SIT`) |
| `.LVL` | Terrain manifest and environment | `parseEvoLvl` |
| `.WAT` | Evo 2 animated-water material | `parseEvoWat` |
| `.TEX` | Terrain and shadow texture table | `parseEvoTex` |
| `.VEG` | Evo 2 vegetation | `parseEvoVeg` |
| `.RTD` | Shade map (1024 x 1024 bits) | `parseEvoRtd`, `evoShadeAt` |
| `.SDW` | Shadow texture overlay (256 x 256 words) | `parseEvoSdw` |
| `.SMF` | Static models ("C3DModel") | `parseSmf` |
| `.TRK` | Vehicle manifest, v6 (Evo 1) and v7 (Evo 2) | `parseEvoTrk` |
| `PARTS.TXT` | Evo 2's parts list (PARTS.POD): codes and their aero, brake, CG, tire CF, torque and weight modifiers | `parseEvoParts` (`evoSim.applyEvoParts` fits them) |
| `.RAW` + `.ACT` + `.OPA` | Indexed textures with an opacity plane | see [RAW_ACT.md](RAW_ACT.md) |
| `.TIF` | Evo 2 textures and normal maps | `decodeTiff` |

Each reader was consolidated from copies that had drifted apart across JSTrackViewer, JSMTM2Converter, JSTruckViewer and JSPod. The source files carry detailed comments on every rule, taken from those copies. This document summarizes the evidence and the choices made in consolidating them.

## Text conventions

Every text file is CRLF-terminated 8-bit text. Label lines may carry a leading sigil (`!`, `@`, `#`, `$`, `%` or `&`) chosen per record, not per field. The same field is spelled `castShadowOnMe` in one file and `%castShadowOnMe` in another, so readers strip the sigil before matching (`evoLabel`). Evo 2 `.SIT` instances label every value line with a `// fieldName` comment, which lets the v7 reader need no per-class schema. This was checked across all 874 instances in the four stock Evo 2 tracks: 11 classes, and no unlabeled lines.

## .SIT

- **v6 (Evo 1):** sequential `Box N of M` records of label/value lines, read by label, so physics fields are skipped without losing place. The `@sound effect entries` label is followed by two value lines.
- **v7 (Evo 2):** a class registry (the integer after each class is its serialized schema version, not a count), a name list, then `{ N ClassName ... }` instances. The instance number is what a child's `parent` field refers to (`instanceId`). Unknown fields are kept in `sourceFields`.
- **Positions and headings:** `wPos` is (x, height, z) and `wOrient` is radians with the heading third. The starting grid proves that convention. Pushing each vehicle's heading through it gives a mean cosine against the nearest course segment of +1.00 on ASPEN, THEHILL and PEAK, and +0.96 on BAJBEACH and TRIBAJA.
- **Race types:** 2 is CIRCUIT, 3 is RALLY and 6 is MISSION (`evoTrackTypeName`), established from the stock tracks and the Evo editor manual. Other values are reported as numbers.
- **Object paths (`paths`):** a v7 `.SIT` ends with `#*** Paths ***`: `pathCount`, then per path `Path N of M` with `pointCount`, `type`, `direction`, `cycles`, `time`, `pauseTimeElapsed`, `t`, `tension`, `stopFlag`, `collisionType` and `object` (the moved box, counted from 1; 0 for an unused path), then per point `Point N of M` with `wPos`, `wOrient` (the boxes' order), `vel` (mph), `time`, `pauseTime`, seven flags (`segmentFlag`, `orientFlag`, `velFlag`, `followTerrainFlag`, `animationFlag`, `lightFlag`, `AIFlag`) and two sounds (`NULL.WAV` for none, read as ""). 4x42.exe reads the integers with `%d` and the rest with `%f` (`0x4f2840`); unused paths may carry anything in their integers. About 40 of the stock Evo 2 tracks move objects this way: PEAK's F-15s, ALASKA's helicopters, VULTURE's vultures, boats, animals and vehicles. How the game moves them is OpenMTM2's `docs/EVO2_EXE_ANALYSIS.md` 6.7.
- **Consolidation:** JSTrackViewer's reader was a strict superset of JSMTM2Converter's, adding `instanceId`, `bvel` (a type 10 box's velocity, as on THEHILL's train) and the race type names. The converter's output is unchanged apart from those added fields.

## Track scripts (.SC)

`SCRIPTS\<track>.SC` (`parseEvoScript`) holds a track's rules, one per line: conditions, `->`, actions, or actions alone. Conditions are joined by `&&` or `&`, may be negated with `!`, and are calls (`objectsIntersect(trigger,vehicle1)`, against a CTriggerBox's `name`) or flags set by `raise(flag,forever)`. Actions are calls separated by `;`; quoted arguments lose their quotes, and `//` comments to the end of the line. The stock calls are `raise`, `objectsIntersect`, `Message`, `giveMoney`, `foundSecret`, `completedObjective`, `startPathObject`, `stopPathObject`, `unlockObjective`, `displayObjective`, `unlockMission`, `setWaterTidePeriod` and `setWaterTideHeight` (the game also reads `togglePathObject`, `0x450170`). The reader keeps whatever a line names.

## .LVL, .WAT, .TEX, .VEG

These were identical in JSTrackViewer and JSMTM2Converter.

- **`.TEX`:** holds `ordinaryCount + shadowCount` records exactly, in all four stock tracks. The `.CLR` grid indexes the ordinary group, and `.SDW` indexes the shadow group offset by `ordinaryCount`. The two numbers of a record are `surfaceValue` (MTM2's `type * 100 + depth`) and `vegClass` (0 none, 1 sparse, 2 medium, 3 dense), as 4x4 Evolution 2 reads them (`CTextureList::load`, 0x5cb530; OpenMTM2 `docs/EVO2_EXE_ANALYSIS.md` 4.1). The old names `param0` and `param1` stay as aliases.
- **`.VEG`:** has exactly 256 `treeGrid` blocks, one per 512 ft sector of a 16 x 16 grid: block b is the sector at x `b % 16`, z `b / 16` (0x466af0; the earlier "one per terrain row" was wrong). Each tree carries its `sector` and its `index` in the block. The fourth value is the byte `rand()` gave the tree, and the game uses it as the yaw, `value * pi / 128` (`evoTreeYaw`); the model slot is `index & 3` (`evoTreeSlot`). Stored heights already sit `treeBiasY * (1 - r)` under the ground, and the game draws the model a further `treeBiasY` down.

## Shade, shadows, grass and generated trees

`src/evo/vegetation.ts`, from OpenMTM2 `docs/EVO2_EXE_ANALYSIS.md` 2 and 3:

- **`.RTD`** is 131,072 bytes: one bit per 8 ft square, bit `x8 + z8 * 1024`, least significant bit first. Set means shade (terrain light 0.35, no sun shadow for a truck). Checked on ALASKA1: every one of its 13,660 trees stands on a set bit, against 12% of the map, which fixes the bit order.
- **`.SDW`** is 256 x 256 words: a `.TEX` index in the shadow group, or 0x8000 for none (0x4000 is kept by the game, meaning not traced).
- **Grass** (`evoGrassPattern`, `evoGrassCount`, `evoGrassIndex`): 2,048 tufts repeating every 8 x 8 cells; offsets from the Watcom `rand()` (`evoRand`, the ANSI generator) seeded with 873, slots and sizes redrawn from the `.VEG` sizes. A cell of class c draws `1 << c` tufts.
- **Generated trees** (`evoGenerateTrees`): what Evo 2 does for a level without a `.VEG`. The game's `rand()` is unseeded there, so the caller gives the seed.

## World space and terrain

Evo is Y-up: a `.SIT` `wPos`, `.SMF` vertices and `.VEG` records are all (x, height, z). The terrain grid is always 256 square (`EVO_GRID_SIZE`) at 32 world units a cell (`EVO_CELL_SIZE`), so the world is 8192 units across. Heights are uint16 little-endian 11.5 fixed point (`EVO_HEIGHT_DIVISOR`, 32), indexed `x + z * 256`: against every `wPos` in the four stock tracks that order lands objects within 12-33 units of the ground, where the transposed and flipped readings miss by 65-407. `evoHeightAtCell` and `evoHeightAt` sample it.

The `.LVL` water height is on a half-unit scale (`EVO_WATER_HEIGHT_DIVISOR`, 2). Taken at face value it would put every stock track's racing line underwater; halved, BAJBEACH's sea sits just above its flat sea floor, under its floating raft and its piers' decks.

## AI lines

`AI\CLASSc\AI_cnTRACK.TXT` is a recorded lap for computer driver line `n` of truck class `c` (`matchEvoAiLineName`). It is a text header (driver, lap time, class, counts) followed by samples of a position line, a speed line and a target checkpoint line (`parseEvoAiLine`, which keeps the header's driver and lap time and the positions).

These are the lines the trucks drive, so they settle what the `.SIT` course cannot say alone: which runs make up a lap. `lapRuns` drops runs at the end of the course list that no recorded line goes near. TERRAMAR's course lists its 23 lap runs and then two on the parallel road beside the start, 96 and 193 units off every line, where lap runs sit 40 or less.

## .SMF

The four copies shared one parsing layer, a counted state machine with the same validation, and differed only in how they reshaped the result for their renderers:

| Copy | Output |
|---|---|
| JSTrackViewer, JSMTM2Converter | Three.js axes (Z negated), winding reversed, indexed |
| JSTruckViewer | Z-up truck space (Y and Z swapped), normals negated for BackSide drawing, V inverted, triangle soup |
| JSPod | Same transform as JSTruckViewer, plus LOD filtering |

`parseSmf` returns the model **as the file states it**:

- **Axes:** Evo's own (Y up, feet). A model's XYZ extent is exactly the `size` its `.SIT` placement records, checked on all 57 distinct stock track models.
- **Winding and indexing:** faces keep the file's winding and index the group's vertices. A face that indexes outside the group is dropped with a warning.
- **UVs:** V as written, running top-down. Over every stock track group with a clear vertical gradient, 50 of 53 map higher Y to lower V.
- **Frames:** every frame is kept. All four copies read only frame 0. There are 18 multi-frame groups in the stock and community corpus, among them the 30-frame `ISSHK`.
- **Precision:** numbers are the float64 the text denotes. Each consumer's arithmetic (negating an axis, `1 - v`) therefore produces the same float32 it always did. All four consumers' adapters reproduce their old output **bit for bit** on all 839 distinct stock and community models (5,715 groups).
- **Texture names:** material fields are kept verbatim. `smfTextureReference` applies JSTruckViewer's rule for a usable texture reference: quotes removed, upper case, and `NULL`, `NULL.RAW` and `NULL.TIF` meaning no texture.
- **LOD:** reduced-detail track groups are named with a trailing `L` (`OPAQUEL`, `TRANSPL`), exposed as `lodGroup`. Trucks keep LOD in a separate file (`TRBLAZ.SMF` and `TRBLAZ0.SMF`).

The corpus covers the 118 track models (115 v4, 2 v2, 1 v3) and the 567 truck models (246 Evo 1 with `.RAW` art, and 321 Evo 2, all in the `v1` bump-material form with `.TIF` art). Every file is consumed exactly to its end.

## .TRK

This is the same label/value text MTM2 uses, with a `version` / `6` or `7` header. The differences from MTM2:

- **Wheel anchors:** one vec3 line each, where MTM2 uses three `.x`/`.y`/`.z` pairs.
- **Models:** `.SMF` stems.
- **Counted lists:** `<label>[]` followed by N bare values, with the count taken from an earlier field. The exception is `sc[].pt`, whose run ends at the first line that is not a vec3.

All 271 stock manifests (121 v6, 150 v7) read to their signature line.

JSTruckViewer's and JSMTM2Converter's readers were algorithmically identical and differed only in output shape. `parseEvoTrk` keeps everything either one did:
- absent fields are `null`;
- paint swatch channels are kept unrounded;
- `rawValues` and `fieldOrder` hold the file's own values and label order.

Both adapters reproduce their old output exactly, including key order, on all 271 manifests.

Evo has no axle model, axle bars, driveshaft or instrument cluster: `axleModelName` is `NULL.BIN` in every stock manifest. `truckManifestLines` prepares lines for any truck manifest. It drops NUL padding and the `0x1A` end-of-file marker found in shipped MTM1 manifests, and splits on any line ending.

## .TIF

A minimal reader for the forms Evo 2 ships:
- little-endian, uncompressed, chunky, 8-bit samples;
- palette color with 1 or 2 samples, where the second sample is opacity;
- RGB with 3 or 4 samples: the `_BUMP` tangent-space normal maps, whose R and G average 128 and B 253.

Anything else is refused with a reason. The ColorMap stores all reds, then all greens, then all blues as 16-bit values. When no entry exceeds 255, it is read as already 8-bit.

JSMTM2Converter's and JSTruckViewer's copies handled both forms. JSTrackViewer's and JSPod's handled palette images only. On the 800 distinct stock TIFFs (463 palette, 337 RGB), `decodeTiff` matches every copy on every image that copy could read, and the 337 normal maps now also decode in JSTrackViewer and JSPod.

## Open questions

- **Material scalars:** the meaning of `.SMF` material scalars 0 to 2. They are consistent with specular strength, specular level and a Phong exponent, but unconfirmed.
- **Unnamed values:** the `.SMF` counts line's fourth field. (The `.TEX` record numbers and the `.VEG` per-tree value are now named, from the executable.)
- **Paint decals:** whether any Evo vehicle ever uses a paint-scheme decal texture. Every stock one is `NULL`.
