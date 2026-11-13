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

**What an editor carries over.** A few fields no engine reading needs are kept so a writer can put them back: each box's `rates` (`p,q,r`) and `lightFields` (the `L` block's data line as written, on any box that has one, where `light` is the engine's clamped reading for type 12 only), each vehicle's `courseToFollow` (the player slot's included: its record opens on its own delimiter line, which the reader once took for the record's end, so they missed its course and live lines), each extended course's `slot` (0..3, since empty slots are not listed), `longitudeLatitude`, and `cylinders`: the `*** Cylinders ***` count and its lines verbatim, as no engine draws or collides with cylinders. The header's saved race-state lines are kept as written in `viewState`, `controlFlags` and `stageFlags`, and the backdrop's type in `backdropType`. `arena.placed` tells the MTM2 `!stadiumFlag,x,z,sx,sz` form from the older `stadiumFlag,stadiumModelName`, which has no placement.

Neither the `.SIT` nor its `.LVL` names its game. **`detectSitOrigin(lines, title)`** decides between MTM1, MTM2 and CPR from what the file contains, and `sitTrackTypeName` names the track type code for that game.

**`parseMtmLvl(bytes)`** reads the positional `.LVL`: every named file by line (`textName`, `rawName`, `clrName`, `actName`, `texName`, `zeroRawName`, `pupName`, `aniName`, `tdfName`, the sky pair, `defName`, `navName`, `musicName`, `fogName`, `lteName`), then the sun lines and `!waterHeight`. **`parseTexList`** reads a `.TEX` texture list and **`parseTty`** its `.TTY` type table.

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

**`buildCprRoad(surfaces, textureCount)`** lays the records out as geometry, once, for whatever draws the track and whatever drives on it: the road's quads (one a visible slot of each stretch, the closing stretch included, with its `.TTX` texture and the record's own U) and the walls (each with its stack of panels, a strip of a wall texture or the catch fence). Positions are the file's `[x, altitude, along]` in feet; `along` is the game's z, which puts the road a median 2 ft over Laguna's terrain.

The height of one wall panel is not in the data: `CPR_WALL_PART_HEIGHT_FT` (4.5 ft) is JSTrackViewer's calibration against the game's screenshots.

### Writing an MTM2 level

The writers lay a file out the way the stock ones are, with the stock value in every field the caller leaves out, and each reads back with the matching reader.

| Writer | File | Notes |
|---|---|---|
| `writeMtm2Sit` | `.SIT` | Header, the "Your Truck" slot and the grid, ramps, boxes (a model, or a checkpoint's extents; motion, priority, sounds and the optional `L` light block), cylinders as given lines, top crush (model form), the primary course and the four extended courses (with each segment's `ctype,cspeed_type` and `cdec_point,cspeed,lastentry` and each course's direction), the stadium in either form and the backdrop. Whatever the caller leaves out takes the stock value: no ramps, cylinders or top crush, stadium off, no backdrop. `ambientLine: false` leaves out the MTM2 ambient line, as an MTM1 SIT has none. A number is written with two decimals and a string as given, so a caller with its own number format passes strings. Every line ends CRLF, and the text is windows-1252, one byte per character, as the readers decode it. Mass zero means "cannot be moved". |
| `mtm2SitFromParsed` | `.SIT` | A parsed MTM2 SIT as `writeMtm2Sit` input, so an editor reads a level, changes its data and writes it back. All fifteen stock MTM2 SITs read back with the same data (`test/stock.test.ts`). Positions come from the game's view in feet, so a negative x or z is written wrapped by +8192, the place the game puts it. A course segment gets the game's track width (32 where the `&` line was missing). Coordinates keep two decimals where those hold the value and six where they do not, as TRI's editor wrote; mass, speeds and lengths get six. A grid slot without a `@damageCode` line keeps the stock layout with its own values. An unused stadium is written in the short `0,none` form. It refuses an MTM1 or CPR SIT and a top-crush car in the size form, which no stock MTM2 level uses and `writeMtm2Sit` cannot write. |
| `writeMtm2Lvl` | `.LVL` | The positional header, with the sun on line 17 as 16.16 (east, up, north) and the value after `!waterHeight`. Lines 18-21 default to the values all fifteen stock MTM2 levels share. |
| `writeTexList`, `writeEmptyList` | `.TEX`; `.TTY`, `.PUP`, `.ANI`, `.TDF`, `.DEF`, `.NAV` | A count, then one name per line; `0` for a list with nothing in it. |
| `buildMtm2Lte` | `.LTE` | The baked light grid, seven bytes a cell, ground first: Traxx's BuildLte from the heightfield and the sun's horizontal direction, in the 160-255 range stock levels use. |
| `emptyGroundBoxGrids` | `.RA0`-`.RA5`, `.CL0`-`.CL2` | MTM2 reads all nine for every level. The stock "no boxes" values: zeros, and 0xFF in `.RA2`/`.RA3` for solid rock. |
| `writeTty` | `.TTY` | The count, then `name,value` per typed texture (type * 100 + depth). |
| `writeAnimations` | `.ANI` | The count, then each animation's base texture, `frameCount,rate` and frames: the TV layout, which MTM2 levels share (`parseAnimations` reads both). |
| `encodeClrGrid`, `encodeClrWord` | `.CLR` | One little-endian word per cell, row by row: bits 0-11 the texture, 12-13 mirror, 14-15 quarter turns. `decodeClrGrid` reads it. |
| `encodeGroundBoxes` | `.RA0`, `.RA1`, `.CL0` | The inverse of `decodeGroundBoxes`: lower and upper height per cell (upper 0 is no box) and six face words per cell, zero where there is no box. |
| `writeTxv` | `.TXV` | The Community Patch 3 track version record: `key=value` lines and `#` comments, CRLF. `parseTxv` keeps every line in order, unknown keys included, since keeping them is how the record stays forward compatible; `txvValue` looks a key up without case. |

What goes into the fields (where an object stands, which box type it gets, which course the field follows) is the caller's. JSMTM2Converter's placement rules stay in the converter.

## Terminal Velocity, Fury3 and Hellbender

**`parseTvLvl(bytes)`** reads the positional `.LVL` header (the slot table is in `src/tv/lvl.ts`). `NULL.xxx` in a slot means none (`isNullAssetName`). Hellbender's `.LVL` carries a `!New ground additions` block, which is how `detectTvLvlOrigin` tells it apart; the origin matters because Hellbender reads its side files on its own placement scale.

| Reader | File | Notes |
|---|---|---|
| `parseDef` | `.DEF` object definitions and placements | TV and Fury3 use a 14-line definition record; Hellbender extends the same record to 25 lines. `defPlacementToEditor` places a placement using its definition's Y offset. |
| `parseNavPoints`, `findStartPoint` | TV and Fury3 `.NAV` | Seven entry types, the F!Zone editor's own menu. All 69 stock files read to EOF. |
| `parseHbNavPoints` | Hellbender `.NAV` | Same header slot, different record. All 26 stock files read exactly to EOF, and all 786 placement indices resolve. Types 10 and 11 exist in the game's loader but in no shipped level. `autoAdded` marks the sync points the game inserted itself (29 of the 69 shipped). |
| `parsePowerups` | `.PUP` pickups | TV and Fury3 type names from TVCAD.INI (`TV_POWERUPS`); Hellbender's 31 types from HELLBEND.EXE (`HB_POWERUPS`). |
| `parseTunnelDefs` | `.TDF` tunnels | The complete tunnel list, including the hidden ones `.NAV` leaves out. |
| `parseTvTunnel`, `tunnelSegmentGeometry` | TV and Fury3 `.TNL` tunnel geometry | Segments of two elliptical rings, one terrain cell long each; see below. All 148 stock files read to their end. |
| `parseHbQuakes` | Hellbender `.QKE` | Ground and box quakes: cells and ground boxes that move between two heights. See below. |
| `parseAnimations` | `.ANI` animated textures | The rate is 16.16 fixed point relative to `ANIMATION_BASE_FPS`. |
| `parseHbBriefing` | Hellbender briefing `.TXT` | The two labelled lines Hellbender has instead of a track name. |

`TV_LOGIC_NAMES`, `TV_WEAPON_NAMES`, `TV_POWERUPS` and `HB_POWERUPS` name the codes in these files.

A definition's `hitRadius` is the editor's copy: all three games recompute it at load as the radius of the simple model's bounding-box corner. `groundOffsetX`, `groundOffsetY` and `groundOffsetZ` are the header's placement offsets (slots 3 to 5). Where a game then puts a placement (TV and Fury3 replace a surface placement's Y with the terrain height and add the offsets; Hellbender keeps Y and lifts it onto the floor) is engine behaviour and is left to consumers; JSTrackViewer's `docs/TV_GAME_EXE_ANALYSIS.md` and `docs/HELLBENDER_EXE_ANALYSIS.md` record it.

### Tunnels (`.TNL`)

A tunnel level names a `.TNL` where a surface level names its heightfield. The file is a segment count (at most 90) and then 13 + N lines per segment, in the order Terminal Velocity's loader (GAME.EXE `0x34770`) scans them: the two ring centres and the side count N; ring A's start and end angle; its radii; ring B's angles; its radii; a door timer; an unnamed value; how many sides are left open; the segment type; the tunnel texture list index; N side textures; three trailing values. Angles are 65536 per turn, centres and radii are in units of 256 world units, and a segment is `0x1000` of those long, 2^20 world units, which is one terrain cell. `tunnelSegmentGeometry` builds the rings as the engine's builder (`0x33f00`) does: `N - open` vertices on each ellipse, and, for an open ring, the remaining vertices on the tube's centre line.

### Moving terrain (Hellbender `.QKE`)

Hellbender's `.QKE` is a labelled script, written by the game's own editor code (HELLBEND.EXE `0x410260`): ground quakes, each a rectangle of cells on one layer (1 surface, 2 cavern floor, 3 cavern ceiling), and box quakes, each one ground box, optionally a switch. Every entry moves between two height limits stored at 128 per height step (cavern limits carry the cavern bias), with rise, wait and fall times, an end mode (loop, run once) and five sound names. Terminal Velocity and Fury3 ship a `.QKE` too, but it is a different, unlabelled table, a single 0 in 181 of their 190 files, and has no reader.

### Coordinates

TV and Fury3 place things at 2^20 units per terrain cell and 2^15 per height step (`tvPlacementToEditor`). Hellbender's side files use its `.DEF` space instead: 16.16 fixed point, 8 world units per cell, and heights that may be negative for its underground (`hbPlacementToEditor`). Read at the TV scale, Hellbender's `.NAV` target lists miss the objects they name by a median of 23 cells; at its own scale, by 0. `placementToEditor` picks by origin rather than guessing from the values, because the ranges overlap.

## Terrain

**`decodeHeightSample`** turns one heightfield sample into a legacy height step. MTM, TV, Fury3 and Hellbender store one byte per cell. CPR stores uint16 10.6 fixed point (`CPR_HEIGHT_DIVISOR` 64), and one CPR step is two MTM steps (`CPR_HEIGHT_UNIT_SCALE`). Evo also stores uint16, but 11.5, so the cell width cannot tell the two apart and the caller says which it has. `heightAtCell` samples a grid corner. `heightAtPoint` samples between corners the way the games do, on the plane of the cell's triangle rather than a bilinear blend; `cellTriangleHeight` is the same for four given corners. The split is `"fixed"` (every cell along `(cx, cz)` to `(cx + 1, cz + 1)`) or `"checkerboard"` (that diagonal where `cx + cz` is even, the other where it is odd), which is how CPR, Terminal Velocity, Fury3 and Hellbender split their cells.

**`decodeGroundBoxes(ra0, ra1, cl0, gridSize, heightOffset)`** decodes the solid blocks a level stands on the grid: lower and upper heights from `.RA0`/`.RA1`, six face textures per cell from `.CL0`. Each face is a `.CLR` texture word (`decodeClrWord`): bits 0-11 texture, 12-13 mirror, 14-15 rotation. Hellbender's loader also accepts a narrow form, chosen by file size, with one byte per `.CLR` cell, `.CL0` face or `.CL1` word (a bare texture index); `decodeClrGrid`, `decodeGroundBoxes` and `decodeHbUnderground` read it, though no shipped level uses it.

**`decodeHbUnderground(ra2, ra3, cl1, gridSize)`** decodes Hellbender's cavern: a floor and a ceiling heightfield biased so that byte 255 is altitude 0 (`HB_UNDERGROUND_BIAS`, -255: the game's loader stores each cavern byte as `(byte - 255) << 7`; an earlier, measured value of -256 was one step off), a mask of the hollow cells grown by one so the cavern closes itself, and the floor (first) and ceiling (second) texture words split out of `.CL1`, an order the game's floor and ceiling renderers confirm. The cavern's own ground boxes are `.RA4`/`.RA5`/`.CL2`, decoded by `decodeGroundBoxes` with the bias as the height offset.

### Community Patch 4 terrain grids (MTM2)

Community Patch 4 (beta 0.52) and Traxx 1.7.0 add 16-bit heights. **`decodeMtm2Heights(bytes, terrainGrid)`** reads `DATA\<stem>.RAW` of an MTM2 level and **`decodeMtm2HeightPng(bytes, terrainGrid)`** the height PNG a `.TXV` names with `terrainHeights` (grey or grey + alpha, 8 or 16 bits, 256 or 1024 square; RGB and palette are refused, as the engine refuses them). Both return 1/128 ft units (`MTM2_H16_PER_FT`): feet = v / 128, 0 to 511.99 ft, the classic ceiling at a 2.4 mm step. A classic byte b is b << 8. The CP4 engine keeps only v >> 1 in signed 16 bits (1/64 ft, about 4.8 mm; OpenMTM2 docs/CP4_EXE_ANALYSIS.md), shifting after the spline expansion: **`mtm2EngineHeightsFt`** gives the heights the game drives on, `mtm2HeightsToFeet` the file's.

| Height file | Mode | Surface |
| --- | --- | --- |
| 65,536 bytes, u8 256 x 256 | `classic8` | flat 32 ft triangles (the original game) |
| 131,072 bytes, u16 LE 256 x 256 | `classic16` | flat 32 ft triangles |
| the same, `terrainGrid=spline` | `spline` | expanded to 1024 x 1024 at 8 ft, rounded; trucks drive on it |
| 2,097,152 bytes, u16 LE 1024 x 1024 | `fine` ("Full Map") | 8 ft heights as authored, rounded or sharp |

The mode rules are Traxx 1.7's `ResolveTerrainMode`, written to the engine's contract: a 1024-square file is always `fine`, a 256-square one is classic by width unless the key says `spline`, and `fine` on a 256-square file falls back to classic with a warning. Any other length throws. CPR's 131,072-byte terrain has the same length at another scale, so use this only for MTM2 levels. Ground boxes, `.CLR` and `.LTE` stay 256 x 256 at 32 ft in every mode.

**`terrainSplineExpand(coarse)`** is the engine's spline (terrainspline.c version 2, shared verbatim by the CP4 engine and Traxx): each 32 ft segment a monotone cubic Hermite curve with harmonic-mean tangents, sampled at quarter points with integer weights over 64, pass 1 along X on the coarse rows, pass 2 along Z on every fine column, indices wrapping at 256. The port is exact (BigInt where the products pass 2^53) and reproduces Traxx's published test vectors (`test/terrain-spline.test.ts`). Evo 2's smoothing (`sim/evo/ground.ts`) fills the same 8 ft grid but with a Catmull-Rom spline, which can overshoot; the two are related, not identical.

### Community Patch 4 lakes, vegetation, fog, surfaces

- **`parseWtr` / `writeWtr`** (`WORLD\<stem>.WTR`, "MWTR"): extra water bodies above the `.LVL` water (body 0). Per lake a height in 0.5 ft units, flags (1 reflective), up to 8 seed tiles, a wrapping bounding box and a tile count; then a 256 x 256 tile map (x + z * 256) of lake ids. The engine uses the map as written. `wtrLakeAt` looks a tile up.
- **`parseWfl` / `writeWfl`** (`WORLD\<stem>.WFL`, "MWFL", beta 0.53 and Traxx 1.7.1): up to 64 waterfalls. Each is a crest of 2 to 8 points (u32 x/z in 1/16 ft) that water pours over, fed by a lake (source = lake index + 1) or by nothing (source 0, a spring at its own height in 0.5 ft units); a flow speed at the crest in 1/16 ft/s, flags (1 freeze in snow, 2 splash, 4 sound), opacity, mist and sound volume %, and 16-byte sound and texture stems (empty = none of its own / the default water). v1.0 records are 128 bytes; v1.1 (minor 1, 132 bytes) adds mist depth and height % (0 means 100, capped at 250), and Traxx writes it only when one is neither 0 nor 100. The reader keeps Traxx's refusals: a major of 0 or above 1, terrain other than 256 x 256, a bad header, the first `FALL` entry unusable, a stride below 128, more than 64 falls, or any record with a point count outside 2..8. The engine builds the sheet itself from these; the file holds no geometry. That build (validation, the column walk, the mesh, mist and sound) is `buildFallMeshes` and its helpers in `cp4Sim` (`src/sim/cp4/falls.ts`, docs/SIM_MTM2.md "Community Patch 4 beta 0.53 waterfalls").
- **`parseMtm2Veg` / `writeMtm2Veg`** (`WORLD\<stem>.VEG`, "MVEG"; the same extension as 4x4 Evolution's text .VEG, told apart by `isMtm2Veg`): placed trees (1/256 ft positions, 1/65536 turn headings, scale x 4096) sorted by tile, grass clumps grouped by 32 ft tile, and up to 60 species with far-card model, collision and shadow flags. RULE is Traxx's planting recipe, kept as text; the engine never reads it, nor the `_V` / `_G` mask PNGs.
- **Fog volumes** are box type 14 (`BOX_FOG`) with an `F` block after the box's sounds: the header `SIT_FOG_HEADER`, then 18 values (`parseSitFog`: missing trailing fields take the engine's defaults, values clamped as Traxx clamps them; `formatSitFogLine` writes them as C's `%f`, `wmask` as `%d`). `parseMtmSit` fills `fog` on type 14 boxes and `fogFields` on any box with a block; `writeMtm2Sit` writes `fog`.
- **`readTxvInfo`** types the `.TXV` keys: `formatVersion` (1 classic, 2 lights or movers, 3 vegetation, 4 fog, 5 16-bit terrain), `terrainGrid`, `terrainHeights`, `fogVolumes`, `vegetation`, `vegTrees`, `vegClumps`, `legacyFallback`, `hdTextures`, `waterfalls` (beta 0.53; Traxx 1.7.1 writes it only with the `.WFL`).
- **`parseSrf`** (`MODELS\<model>.SRF`): `material=type` lines making a placed model a drivable surface; `*` is the default, `water2` is refused, the later of two lines wins. **`parseCpt`** (`DATA\<name>_CP.CPT`): the 3D cockpit layout (cab, eye, gauge needles, wheel, shifter, gear lamps, shift light, mirror); the meaning of each part's trailing numbers is kept as written until confirmed in the engine.
- **`decodePngSamples`** reads PNG samples at their stored depth (browsers flatten 16-bit grey to 8 bits), with a synchronous inflate (`inflateZlib`) so the core stays portable. Palette images (colour type 3, 1, 2, 4 or 8 bits) come back as their indices, with `palette` (the PLTE triplets) and `paletteAlpha` (tRNS) beside them; a grey or RGB image's tRNS key is `transparentKey`. Expanding the indices is the caller's choice (Traxx 1.7's vegetation masks are read as stb_image does, palette to RGB).

## Sky

Every TV, Fury3, Hellbender and MTM1 sky texture is drawn only in palette slots 240-254, which are black in every `.ACT`. The engine copies 16 colours from colour 192 of the level's sky `.ACT` into slots 240-255, so one shared sky RAW is recoloured per level. **`skyGradient(act)`** returns those 16 colours and **`skyHorizon`** the last, which the engine clears the screen to before drawing the sky.
