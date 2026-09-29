# Truck and car manifests, and CPR car models

A vehicle is assembled from a manifest that names its models and places its parts. OpenPhotex reads every dialect:

| Dialect | Games | Opens with | Reader |
|---|---|---|---|
| MTM1 `.TRK` | Monster Truck Madness | the bare `truckName` label | `parseMtmTrkLines` |
| MTM2 `.TRK` | Monster Truck Madness 2, Community Patch "MTM2.1" | an `MTM2 truckName` or `MTM2.1 truckName` header | `parseMtmTrkLines` |
| CPR `.CAR` | CART Precision Racing | `truckName` or `gtruckName`, plus a helmet or pace-car label | `parseCprCarLines` |
| Evo `.TRK` | 4x4 Evolution 1 and 2 | `version` / `6` or `7` | `parseEvoTrk` (see [EVO.md](EVO.md)) |

`parseTruckManifest(bytes)` detects the dialect and parses it (`detectTruckManifest` is the detection alone). Every dialect is label/value text, prepared by `truckManifestLines`: it drops the NUL padding and `0x1A` end-of-file markers found in shipped MTM1 manifests, and trims lines and skips blank ones. The checks run in a fixed order because the dialects open alike. A CAR opens exactly like an MTM1 truck and is told apart only by carrying a `Helmet name` or `paceCarFlag` label.

Units are feet. The axes are x lateral (+ right), y up and z forward. BinEdit's `Truck.h` labels the light fields "(ft)", and the stock data agrees: BIGFOOT's wheel anchors are ±4.292 ft apart with a 6.00 ft tire. A manifest holds no mass, spring rates, gearing or tire radius.

## MTM TRK

- **Model names:** MTM2 stores stems (`bigfoot`), and MTM1 stores file names (`bigfoot.bin`) under `truckModelName` and `tireModelName`. Both land in `truckModelBaseName` and `tireModelBaseName`.
- **Wheel anchors:** three label/value pairs each, `faxle.rtire.static_bpos.x`, `.y` and `.z`. Any `<key>.x/.y/.z` group is gathered, and the four wheels are `MTM_WHEEL_KEYS`: front right, front left, rear right, rear left, in the order the TRK lists them.
- **Lights:** `Light N <property>` lines, with properties `type`, `body axis pos`, `heading`, `cone:`, `source:` and `ms on`. BinEdit's `Truck.h` enumerates `type` as 0 headlight, 1 brake, 3 roof, 4 special and 5 backup. `bitmapRadius` is `null` when the position line has only three values. JSTruckViewer draws such a flare 0.25 ft across, which is a viewer default, not part of the file.
- **Wave files:** `Wave File` starts a run of sound names that ends at the next known label.
- **Other fields:** anything else is kept verbatim in `unknownFields`.

The code was consolidated from JSTruckViewer's parser and JSTrackViewer's port of it. The two differed only in:
- **Dialect dispatch:** JSTrackViewer refuses Evo, because drive mode is MTM-only.
- **The light `type` property:** JSTruckViewer matched it exactly and JSTrackViewer by prefix.
- **Output shape.**

Both adapters reproduce their old output exactly, key order included, on all 382 manifests in the stock and community archives (82 MTM, 29 CPR car, 271 Evo).

## CPR CAR

These are `VEHICLE\<car>.CAR` files:
- **Wheel models:** `tireModelName` is followed by four model names, one per wheel, in the order front left, front right, rear left, rear right (`CPR_WHEEL_KEYS_IN_FILE_ORDER`).
- **CPR-only fields:** the manifest adds a helmet model and its position, a pace car flag and the pace car's tire radius.
- **Wave files:** `Wave File` is followed directly by its run of names.
- **Body model:** the body is usually a `.CMD` model, described below.

## CPR CMD

This is a text model of individually positioned parts:
- **Header:** `name`, `lowDetailName` (the low-detail `.BIN`), `lowDetailCenterZ` and `material` (a `.RAW` texture).
- **Parts:** each has a centre, an angle, a vertex list, a normal list and faces. A face is a `type,cornerCount` line, a four-value plane line, and `cornerCount` lines of `vertexIndex,u,v`.
- **Fixed-point numbers:** positions and centres are in 1/256 ft (`CMD_POSITION_SCALE`), normals in 1/65536 (`CMD_NORMAL_SCALE`), and texture coordinates over `0xFF0000` (`CMD_UV_SCALE`) with V top-down.
- **Axes:** native axes are X lateral, Y up and Z forward. `lowDetailCenterZ` is added to Z to seat the model on its low-detail counterpart.

`parseCprCmd` returns the file's own numbers and faces. Scaling, axes and triangulation are left to the consumer.

In the stock set, all faces are type `0x29` with three or four corners, and every part angle is zero. The convention for a non-zero angle is unknown, so such parts carry a warning.

**Wing packages.** Every stock car stores both aero packages in one CMD:
- the road and street-course wings: `LFWING`, `RFWING` and `RWING`;
- the speedway and oval wings: `LFWING1`, `RFWING1`, `RWING1` and `SPDFIN`.

The game draws one package, chosen by the race setup, and drawing both makes the coincident parts z-fight. `cmdWingPackages` returns the two sets. An alternate counts only when its unsuffixed partner exists.

**Quads.** Faces with four corners are not always planar, and the wrong diagonal folds them. `cmdFaceTriangles` keeps the split whose two triangles face the same way, and on a tie the one with the larger area. Faces with more corners are fanned. The choice depends on the coordinates passed in, so callers pass the positions they draw with.

The code was consolidated from JSTruckViewer's and JSPod's decoders, which differed only in two display fields. Both adapters reproduce their old models bit for bit on all 28 stock CMDs: 18,680 faces, of which 12,244 are quads.
