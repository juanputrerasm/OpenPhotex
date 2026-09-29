# 4x4 Evolution data

4x4 Evolution 1 and 2 ship their tracks and vehicles in POD2 archives (see [POD.md](POD.md)). Inside, the world data is line-oriented text, and models and textures are text and TIFF files. OpenPhotex reads all of them:

| File | Contents | Reader |
|---|---|---|
| `.SIT` | Scene script: header, placements ("boxes"), starting grid, courses | `parseEvoSit` (`isEvoSit` tells it from the MTM `.SIT`) |
| `.LVL` | Terrain manifest and environment | `parseEvoLvl` |
| `.WAT` | Evo 2 animated-water material | `parseEvoWat` |
| `.TEX` | Terrain and shadow texture table | `parseEvoTex` |
| `.VEG` | Evo 2 vegetation | `parseEvoVeg` |
| `.SMF` | Static models ("C3DModel") | `parseSmf` |
| `.TRK` | Vehicle manifest, v6 (Evo 1) and v7 (Evo 2) | `parseEvoTrk` |
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
- **Consolidation:** JSTrackViewer's reader was a strict superset of JSMTM2Converter's, adding `instanceId`, `bvel` (a type 10 box's velocity, as on THEHILL's train) and the race type names. The converter's output is unchanged apart from those added fields.

## .LVL, .WAT, .TEX, .VEG

These were identical in JSTrackViewer and JSMTM2Converter.

- **`.TEX`:** holds `ordinaryCount + shadowCount` records exactly, in all four stock tracks. The `.CLR` grid indexes the ordinary group, and `.SDW` indexes the shadow group offset by `ordinaryCount`. The two per-record parameters are kept verbatim because their meaning is unknown.
- **`.VEG`:** has exactly 256 `treeGrid` blocks, one per terrain row. Each tree's fourth value spans 0 to 255 and its meaning is unknown.

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
- **Unnamed values:** the `.SMF` counts line's fourth field, the `.TEX` record parameters, and the `.VEG` per-tree value.
- **Paint decals:** whether any Evo vehicle ever uses a paint-scheme decal texture. Every stock one is `NULL`.
