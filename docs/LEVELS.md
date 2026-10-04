# Levels: MTM, CPR, Terminal Velocity, Fury3 and Hellbender

The files a level is made of, apart from its models (`docs/BIN.md`) and textures (`docs/RAW_ACT.md`). 4x4 Evolution levels are in `docs/EVO.md`.

Every reader here takes the file's bytes (or text) and returns what the file says. None of them looks anything up in an archive: a caller finds the files a level names, reads them, and passes the bytes in. The evidence for each rule is in the comment above the code that applies it; this page is the map.

All of this was ported from JSTrackViewer, which had the only implementation of each, and checked against it over every stock level (75 SIT and 338 TV-family LVL documents, identical down to typed-array bytes and key order).

## Which file is which

| Game | Level entry point | Names |
|---|---|---|
| MTM1, MTM2, CPR | `.SIT` scene script | its `.LVL` on line 0 |
| MTM1, MTM2, CPR | `.LVL` | terrain `.RAW`, colour grid `.CLR`, palette `.ACT`, texture list `.TEX` and `.TTY`, sky, music, lighting |
| CPR | `.TRK` beside the terrain `.RAW` | the road layer, with its `.TTX` texture list |
| TV, Fury3, Hellbender | `.LVL` | heightfield or tunnel spine, `.CLR`, `.ACT`, `.TEX`, `.PUP`, `.ANI`, `.TDF`, sky, `.DEF`, `.NAV`, lighting |

Companion grids that no level names are found beside the heightfield by stem: `.RA0`, `.RA1` and `.CL0` (ground boxes, every game), and Hellbender's `.RA2`, `.RA3`, `.CL1`, `.RA4`, `.RA5` and `.CL2` (the cavern).

## MTM and CPR

**`parseMtmSit(bytes, title)`** reads a `.SIT`: label/value text with a header, then `*** Ramps ***`, `*** Boxes ***`, `*** Top Crush ***`, `*** Course ***` (with MTM2's extended courses), `*** Stadium ***`, `*** Backdrop ***` and the vehicles. It returns positions in editor space, as the engine stores them: 2 units per foot horizontally and the 2 ft legacy height step vertically (`sitWorldTriplet`).

The header's `Track Fly-By .AVI file` line comes back as `flyBy`. The field is a leftover: MTM1's alpha and beta track selection had a fly-by button meant to play an `.AVI` preview of the track, never implemented and dropped from MTM1, so nothing plays a fly-by. On MTM2 the line doubles as a switch: `sonicTrack` is true when it reads `Sonic`, which MONSTER.EXE takes as a hidden hard-track flag (stronger CPU trucks on Professional). In the stock game only Crazy '98 (`CRAZY98.SIT`) and Torture Pit (`WAR.SIT`) set it; `stock.test.ts` checks that.

The MTM2 line after `!ambient sound,track length,weather mask` comes back as `ambientSound`, `trackLength` (feet, a float) and `weatherMask`. MONSTER.EXE sets a Circuit's default lap count from the length, `trunc(15000 / length + 1)`, taking 6000 ft when the line is missing.

**Courses.** Each segment keeps the editor-space `start`/`end` (as above) and also the game loader's view (MONSTER.EXE 0x4e0970): `startFt`/`endFt` in feet with a negative x or z wrapped by +8192 ft, `ctype`, `cspeedType`, `cdecPoint`, `cspeed`, `lastEntry` and `trackWidthFt` (32 ft when the optional `&cSpeedLimit,cTrackWidth` line is absent). Each course also records its `direction`. A segment's lines are looked up within its own block, so a missing optional line never borrows the next segment's values. The stored segments are only the course's **straights** (`ctype 1, cspeed_type 0` in all 15 stock SITs, three courses each); the game numbers them 1, 3, 5... and builds an arc between each pair at load time. OpenMTM2's `docs/MTM2_PHYSICS.md` section 12 describes that construction. `mtm2Sim.buildCourse` implements it (see `SIM_MTM2.md`).

**Boxes.** Besides the editor-space `position` and rounded sizes, each box (and each top-crush part) carries `positionFt`, the loader's feet with a negative x or z wrapped by +8192, and `sizeFt`, the `length,width,height` line unrounded. These are full extents; a box with a model takes its size from the model in game. `priority` is the box's priority line: MONSTER.EXE draws a box only when it is at most the MONSTER.INI `detailLevel` (stock: 0, 1 or 2). A `.LVL`'s first line is `levelType`; 4 marks an old MTM level.

**Top-crush cars.** Besides their two parts in `boxes` (body and cab, `crushRole`), `topCrush` lists each car as MONSTER.EXE reads it (`0x551660`): the record is positional (label and value lines after the delimiter): `ipos`, `ipos2` (feet), the angles, then either `modelName` and `cabModelName` (when that label reads exactly `modelName`) or the body and cab `length, width, height` (`sizeFt`, `size2Ft`), then `mass`, `bvel` and `p,q,r`. No stock SIT has one. OpenMTM2's `docs/MTM2_PHYSICS.md` 14.27 describes how the game uses them.

Neither the `.SIT` nor its `.LVL` names its game. **`detectSitOrigin(lines, title)`** decides between MTM1, MTM2 and CPR from what the file contains, and `sitTrackTypeName` names the track type code for that game.

**`parseMtmLvl(bytes)`** reads the positional `.LVL`. **`parseTexList`** reads a `.TEX` texture list and **`parseTty`** its `.TTY` type table.

### CPR's road layer

A CPR track is not a free-form mesh. It is a fixed 20-point cross section extruded along up to 700 records, and every point and slot has a role that CPREDIT.EXE names on screen. The tables are transcribed from CPREDIT.EXE's string tables and cross-checked against `LAGUNA.TRK`.

**`parseCprTrk(bytes)`** reads the `.TRK`, which is labelled text. The header gives `trackCount`, `trackBackground` (the terrain RAW), `scale` and `length` (the lap in feet: 11816.64 at Laguna). Each record then runs `pointCount`, `segmentCount`, `curveFlag`, `p`, `type`, `plist`, `!texture`, `wallType`, `wallTexture`, `h`, `pointOffset`, `!altitude` and `^heightOffset`. A record that breaks that order ends the list. **`parseCprTtx(bytes)`** reads the `.TTX`: texture names and their painted surface type.

| Name | Meaning |
|---|---|
| `CPR_POINT_NAMES` | The 20 cross section points, `Left unused 1` to `Right unused 2`, mirrored about `CPR_CROSS_SECTION_MIDPOINT` (10). |
| `CPR_SLOT_NAMES` | The per-slot `type`: off track, curb, road. This is the slot's role, not its painted surface. |
| `CPR_SURFACE_TYPES` | The painted surface, from the `.TTX`: Road, Curb, Grass, Dirt, Rocks. |
| `CPR_WALL_TYPE_NAMES`, `CPR_WALL_LAYERS` | Wall types 0 to 7 and how each stacks its four texture parts and the implied catch fence. |
| `cprTextureIndex`, `cprTextureSlice` | A packed texture reference: bits 0-11 index the `.TTX`, bits 12-13 pick one of four 256x64 strips stacked vertically in the RAW. |
| `cprTextureU` | Section texture coordinates are 16.16 fixed point over 0..256. |
| `CPR_CATCH_FENCE_NAMES` | The fence texture is never in a `.TTX`; it is `ART/CATCH3D.RAW` or `ART/CATCH.RAW` from STARTUP.POD. |

The helpers that interpret the records: **`isDegenerateSlot`** (a slot collapsed to zero width), **`cprVisibleSlots`** (the slots between the outermost walls, which is all the game draws), **`cprTrackIsClosed`** and **`cprSegmentPairs`** (nothing in the file says a track is a circuit, but all 17 stock tracks end one ordinary segment short of their start), **`CPR_COURSE_PURPOSES`** (what the five AI courses are for), and **`cprCheckpointRole`** (checkpoints 0 to 3 are pit entry, pit speed limit, pit speed limit end and start/finish on every stock track).

The height of one wall panel is not in the data and stays with the viewer that calibrated it.

### Writing an MTM2 level

The writers lay a file out the way the stock ones are, with the stock value in every field the caller leaves out, and each reads back with the matching reader.

| Writer | File | Notes |
|---|---|---|
| `writeMtm2Sit` | `.SIT` | Header, the "Your Truck" slot and the grid, boxes (a model, or a checkpoint's extents), the primary course and the four extended courses. Ramps, cylinders and top crush are written empty. A number is written with two decimals; a string as given. Mass zero means "cannot be moved". |
| `writeMtm2Lvl` | `.LVL` | The positional header, with the sun on line 17 as 16.16 (east, up, north) and the value after `!waterHeight`. Lines 18-21 default to the values all fifteen stock MTM2 levels share. |
| `writeTexList`, `writeEmptyList` | `.TEX`; `.TTY`, `.PUP`, `.ANI`, `.TDF`, `.DEF`, `.NAV` | A count, then one name per line; `0` for a list with nothing in it. |
| `buildMtm2Lte` | `.LTE` | The baked light grid, seven bytes a cell, ground first: Traxx's BuildLte from the heightfield and the sun's horizontal direction, in the 160-255 range stock levels use. |
| `emptyGroundBoxGrids` | `.RA0`-`.RA5`, `.CL0`-`.CL2` | MTM2 reads all nine for every level. The stock "no boxes" values: zeros, and 0xFF in `.RA2`/`.RA3` for solid rock. |

What goes into the fields (where an object stands, which box type it gets, which course the field follows) is the caller's. JSMTM2Converter's placement rules stay in the converter.

## Terminal Velocity, Fury3 and Hellbender

**`parseTvLvl(bytes)`** reads the positional `.LVL` header (the slot table is in `src/tv/lvl.ts`). `NULL.xxx` in a slot means none (`isNullAssetName`). Hellbender's `.LVL` carries a `!New ground additions` block, which is how `detectTvLvlOrigin` tells it apart; the origin matters because Hellbender reads its side files on its own placement scale.

| Reader | File | Notes |
|---|---|---|
| `parseDef` | `.DEF` object definitions and placements | TV and Fury3 use a 14-line definition record; Hellbender extends the same record to 25 lines. `defPlacementToEditor` places a placement using its definition's Y offset. |
| `parseNavPoints`, `findStartPoint` | TV and Fury3 `.NAV` | Seven entry types, the F!Zone editor's own menu. All 69 stock files read to EOF. |
| `parseHbNavPoints` | Hellbender `.NAV` | Same header slot, different record. All 26 stock files read exactly to EOF, and all 786 placement indices resolve. |
| `parsePowerups` | `.PUP` pickups | Type names from TVCAD.INI (`TV_POWERUPS`). |
| `parseTunnelDefs` | `.TDF` tunnels | The complete tunnel list, including the hidden ones `.NAV` leaves out. |
| `parseAnimations` | `.ANI` animated textures | The rate is 16.16 fixed point relative to `ANIMATION_BASE_FPS`. |
| `parseHbBriefing` | Hellbender briefing `.TXT` | The two labelled lines Hellbender has instead of a track name. |

`TV_LOGIC_NAMES`, `TV_WEAPON_NAMES` and `TV_POWERUPS` name the codes in these files.

### Coordinates

TV and Fury3 place things at 2^20 units per terrain cell and 2^15 per height step (`tvPlacementToEditor`). Hellbender's side files use its `.DEF` space instead: 16.16 fixed point, 8 world units per cell, and heights that may be negative for its underground (`hbPlacementToEditor`). Read at the TV scale, Hellbender's `.NAV` target lists miss the objects they name by a median of 23 cells; at its own scale, by 0. `placementToEditor` picks by origin rather than guessing from the values, because the ranges overlap.

## Terrain

**`decodeHeightSample`** turns one heightfield sample into a legacy height step. MTM, TV, Fury3 and Hellbender store one byte per cell. CPR stores uint16 10.6 fixed point (`CPR_HEIGHT_DIVISOR` 64), and one CPR step is two MTM steps (`CPR_HEIGHT_UNIT_SCALE`). Evo also stores uint16, but 11.5, so the cell width cannot tell the two apart and the caller says which it has. `heightAtCell` samples a grid.

**`decodeGroundBoxes(ra0, ra1, cl0, gridSize, heightOffset)`** decodes the solid blocks a level stands on the grid: lower and upper heights from `.RA0`/`.RA1`, six face textures per cell from `.CL0`. Each face is a `.CLR` texture word (`decodeClrWord`): bits 0-11 texture, 12-13 mirror, 14-15 rotation.

**`decodeHbUnderground(ra2, ra3, cl1, gridSize)`** decodes Hellbender's cavern: a floor and a ceiling heightfield biased down by a full byte (`HB_UNDERGROUND_BIAS`, -256, which puts 97% of Hellbender's negative-altitude placements between floor and ceiling), a mask of the hollow cells grown by one so the cavern closes itself, and the floor and ceiling texture words split out of `.CL1`. The cavern's own ground boxes are `.RA4`/`.RA5`/`.CL2`, decoded by `decodeGroundBoxes` with the bias as the height offset.

## Sky

Every TV, Fury3, Hellbender and MTM1 sky texture is drawn only in palette slots 240-254, which are black in every `.ACT`. The engine copies 16 colours from colour 192 of the level's sky `.ACT` into slots 240-255, so one shared sky RAW is recoloured per level. **`skyGradient(act)`** returns those 16 colours and **`skyHorizon`** the last, which the engine clears the screen to before drawing the sky.
