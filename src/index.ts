/*
  OpenPhotex: reference implementation of Terminal Reality game data formats.

  Environment-neutral: everything here takes bytes and returns plain data, and runs unchanged
  in browsers, Web Workers and Node.js. Reading files is the caller's job.
*/
export { parsePod, podDirectoryEnd } from "./pod/parse.ts";
export type { ParsePodOptions } from "./pod/parse.ts";
export { findPodEntry, findPodEntryByTitle, findPodEntriesByExtension, readPodEntry } from "./pod/lookup.ts";
export { normalizePodPath, podPathTitle } from "./pod/paths.ts";
export { buildPod1Directory, writePod1, pod1DirectoryEntries, PodWriteError } from "./pod/write.ts";
export type { Pod1DirectoryEntry, PodWriteErrorCode } from "./pod/write.ts";
export { crc32Mpeg2, verifyPodChecksums, readPod2AuditTrail } from "./pod/pod2.ts";
export type { PodChecksumReport, Pod2AuditRecord, Pod2AuditAction } from "./pod/pod2.ts";
export type { PodArchive, PodEntry, PodFormat } from "./pod/types.ts";
export { ACT_PALETTE_SIZE, decodeActPalette, actPaletteDepth } from "./texture/act.ts";
export { rawTextureSide, decodeRawTexture, decodeIndexedImage, applyOpacityPlane } from "./texture/raw.ts";
export type { RawTextureFamily, RgbaImage, DecodeRawTextureOptions } from "./texture/raw.ts";
export { isTiff, decodeTiff } from "./texture/tiff.ts";
export type { TiffImage } from "./texture/tiff.ts";
export { splitEvoLines, evoLabel, evoNumbers, evoUnquote, evoFieldLine } from "./evo/text.ts";
export { parseEvoLvl, parseEvoWat } from "./evo/lvl.ts";
export type { EvoLvl, EvoWat } from "./evo/lvl.ts";
export { parseEvoTex } from "./evo/tex.ts";
export type { EvoTex, EvoTexRecord } from "./evo/tex.ts";
export { parseEvoVeg } from "./evo/veg.ts";
export type { EvoVeg, EvoTree } from "./evo/veg.ts";
export { isEvoSit, evoGameForSitVersion, parseEvoSit, evoTrackTypeName } from "./evo/sit.ts";
export type { EvoSit, EvoSitBox, EvoSitVehicle, EvoCourseSegment } from "./evo/sit.ts";
export { isSmfModel, parseSmf, smfTextureReference } from "./evo/smf.ts";
export type { SmfModel, SmfGroup, SmfFrame, SmfMaterial } from "./evo/smf.ts";
export { truckManifestLines, isEvoTrk, isEvoTrkLines, parseEvoTrk, parseEvoTrkLines, trkSpecValue, EVO_WHEEL_KEYS } from "./evo/trk.ts";
export type { EvoTrk, EvoTrkLight, EvoTrkColor, EvoTrkSpec } from "./evo/trk.ts";
export type { Vec3 } from "./truck/common.ts";
export { parseMtmTrkLines, MTM_WHEEL_KEYS } from "./truck/mtm-trk.ts";
export type { MtmTrk, MtmTrkLight, MtmTrkDialect } from "./truck/mtm-trk.ts";
export { isCprCarLines, parseCprCarLines, CPR_WHEEL_KEYS_IN_FILE_ORDER } from "./truck/cpr-car.ts";
export type { CprCar } from "./truck/cpr-car.ts";
export { detectTruckManifest, parseTruckManifest } from "./truck/manifest.ts";
export {
  parseCprCmd, cmdWingPackages, cmdFaceTriangles, CMD_POSITION_SCALE, CMD_NORMAL_SCALE, CMD_UV_SCALE, CMD_FACE_TYPE,
} from "./cpr/cmd.ts";
export type { CmdModel, CmdPart, CmdFace, CmdCorner } from "./cpr/cmd.ts";
export type { TruckManifest, TruckManifestKind } from "./truck/manifest.ts";
export {
  parseBin, MRGL, MRGLMAT, MRGLMAT2, BIN_GEOMETRY_DIVISOR, BIN_TRANSPARENT_FACE_TYPES, BIN_SOLID_FACE_TYPE, BIN_TEXTURE_NAME_MAX,
  BIN_MAPPED_FACETS, BIN_UNMAPPED_FACETS,
} from "./model/bin.ts";
export type { BinModel, BinFace, BinMaterial, BinMaterial2 } from "./model/bin.ts";
export { writeBin, binFaceNormal, binPlaneTerm } from "./model/bin-write.ts";
export type { BinWriteModel, BinWriteGroup, BinWriteFace, BinWriteMaterial, BinWriteMaterial2, BinWriteResult } from "./model/bin-write.ts";
export {
  TV_UNITS_PER_CELL, TV_UNITS_PER_HEIGHT_STEP, tvPlacementToEditor, tvHeightToAltitude, parseIntTriple, toDataLines,
  hbPlacementToEditor, placementToEditor,
} from "./tv/coords.ts";
export { TV_POWERUPS, tvPowerup, TV_LOGIC_NAMES, TV_WEAPON_NAMES, tvLogicName, tvWeaponName } from "./tv/tables.ts";
export type { TvPowerup } from "./tv/tables.ts";
export {
  NAV_TARGET_LIST, NAV_TUNNEL_ENTRANCE, NAV_CHECKPOINT, NAV_JUMP_ZONE, NAV_TUNNEL_EXIT, NAV_BOSS, NAV_START_POINT,
  NAV_TYPE_NAMES, parseNavPoints, findStartPoint,
} from "./tv/nav.ts";
export type { NavPoint } from "./tv/nav.ts";
export {
  HBNAV_TARGET_LIST, HBNAV_TUNNEL_ENTRANCE, HBNAV_CHECKPOINT, HBNAV_JUMP_ZONE, HBNAV_TUNNEL_EXIT, HBNAV_BOSS,
  HBNAV_START_POINT, HBNAV_SYNC_POINT, HBNAV_RESCUE_BEACON, HBNAV_END_OF_NAVS, HBNAV_ESCORT, HBNAV_RETRIEVE,
  HBNAV_PURSUE, HBNAV_TYPE_NAMES, parseHbNavPoints,
} from "./tv/hb-nav.ts";
export type { HbNavPoint } from "./tv/hb-nav.ts";
export { parsePowerups } from "./tv/pup.ts";
export type { Powerup } from "./tv/pup.ts";
export { TUNNEL_LOGIC_NAMES, parseTunnelDefs } from "./tv/tdf.ts";
export type { TunnelDef } from "./tv/tdf.ts";
export { ANIMATION_BASE_FPS, parseAnimations } from "./tv/ani.ts";
export type { TextureAnimation } from "./tv/ani.ts";
export { parseHbBriefing } from "./tv/hb-briefing.ts";
export type { HbBriefing } from "./tv/hb-briefing.ts";
export {
  CPR_HEIGHT_DIVISOR, CPR_ALTITUDE_DIVISOR, CPR_HEIGHT_UNIT_SCALE, LEGACY_ALTITUDE_DIVISOR, decodeHeightSample,
  legacyWholeHeight16, heightAtCell,
} from "./terrain/height.ts";
export type { HeightGrid } from "./terrain/height.ts";
export {
  parseMtmSit, parseMtmLvl, parseTexList, parseTty, detectSitOrigin, sitTrackTypeName, sitWorldTriplet, sitFeetTriplet,
} from "./mtm/sit.ts";
export type { MtmSit, MtmLvl, TtyEntry, SitBox, SitCourse, SitCourseSegment, SitTruck, SitArena, SitOrigin } from "./mtm/sit.ts";
export { parseTvLvl, detectTvLvlOrigin, isNullAssetName, tvLvlFallbackName } from "./tv/lvl.ts";
export type { TvLvl, TvLvlOrigin } from "./tv/lvl.ts";
export { parseDef, defPlacementToEditor, TR_ANGLE_TO_RAD } from "./tv/def.ts";
export type { DefFile, DefDefinition, DefPlacement } from "./tv/def.ts";
export { SKY_PALETTE_FIRST_SLOT, SKY_ACT_FIRST_COLOUR, SKY_GRADIENT_COLOURS, skyGradient, skyHorizon } from "./texture/sky.ts";
export { decodeClrWord, decodeGroundBoxes } from "./terrain/ground-boxes.ts";
export type { GroundBox } from "./terrain/ground-boxes.ts";
export { HB_UNDERGROUND_BIAS, decodeHbUnderground } from "./terrain/hb-underground.ts";
export type { HbUnderground } from "./terrain/hb-underground.ts";
export {
  CPR_POINT_NAMES, CPR_SLOT_OFF_TRACK, CPR_SLOT_CURB, CPR_SLOT_ROAD, CPR_SLOT_NAMES, CPR_CROSS_SECTION_MIDPOINT,
  CPR_SURFACE_TYPES, CPR_WALL_TYPE_NAMES, CPR_TEXTURE_INDEX_MASK, CPR_TEXTURE_SLICE_COUNT, cprTextureIndex,
  cprTextureSlice, cprTextureU, CPR_WALL_LAYERS, CPR_CATCH_FENCE_NAMES, parseCprTrk, parseCprTtx, isDegenerateSlot,
  cprTrackIsClosed, cprSegmentPairs, cprVisibleSlots, CPR_COURSE_PURPOSES, CPR_CHECKPOINT_ROLES, cprCheckpointRole,
  isCprPitCheckpoint,
} from "./cpr/track.ts";
export type { CprTrk, CprTrackSurface, CprTtxEntry, CprWallLayer, CprCheckpointRole } from "./cpr/track.ts";
export { BUNDLED_PALETTE_IDS, bundledPalette } from "./texture/bundled-palettes.ts";
export type { BundledPaletteId } from "./texture/bundled-palettes.ts";
export {
  BUNDLED_PALETTE_BY_ORIGIN, TEXTURE_SIBLING_DIRS, findTextureSibling, paletteCandidates, textureStem,
} from "./texture/palette-rank.ts";
export type { PaletteCandidate, PaletteCandidateOptions, PaletteOrigin, PaletteTextureKind } from "./texture/palette-rank.ts";
export {
  EVO_CELL_SIZE, EVO_HEIGHT_DIVISOR, EVO_WATER_HEIGHT_DIVISOR, EVO_GRID_SIZE, EVO_WORLD_SIZE, evoHeightAtCell, evoHeightAt,
} from "./evo/coords.ts";
export { parseEvoAiLine, matchEvoAiLineName, lapRuns } from "./evo/ai-line.ts";
export type { EvoAiLine } from "./evo/ai-line.ts";
export { sampleForPalette, medianCutPalette, colourCube, encodeRawTexture } from "./texture/encode.ts";
export type { ColourHistogram } from "./texture/encode.ts";
export {
  MTM2_PALETTE_WHITE_INDEX, MTM2_PALETTE_FIRST_AUTHORED, MTM2_PALETTE_AUTHORED_COUNT, mtm2LevelPalette, buildFogMap,
} from "./mtm/level-palette.ts";
export {
  writeMtm2Sit, writeMtm2Lvl, writeTexList, writeEmptyList, emptyGroundBoxGrids, buildMtm2Lte, writeMtm2Trk,
} from "./mtm/write.ts";
export type {
  SitValue, SitTriple, Mtm2Sit, Mtm2SitTruck, Mtm2SitBox, Mtm2SitCourseSegment, Mtm2Lvl, Mtm2Trk, Mtm2TrkLight,
} from "./mtm/write.ts";
export { parseFlyTagged, flyTag, flyTags, parseFlyAngle } from "./fly/tagged.ts";
export type { FlyTag } from "./fly/tagged.ts";
export {
  FLY_TILE_DEGREES, FLY_TILE_COLUMNS, FLY_EQUATOR_ROW, FLY_TILE_CELLS, FLY_QUADRANT_CELLS, flyRowLatitude,
  flyColumnLongitude, flyTileBounds, flyTileAt, parseFlyFolderName, flyFolderName, parseFlyTextureName,
} from "./fly/globe.ts";
export type { FlyBounds, FlyTextureName } from "./fly/globe.ts";
export { FLY_OBJECT_SNAP_TO_GROUND, parseFlyScf, parseFlySceneryObjects } from "./fly/scenery.ts";
export type { FlySceneryManifest, FlySceneryObject, FlyObjectModel } from "./fly/scenery.ts";
export {
  FLY_ALT_SIDE, parseFlyAlt, parseFlyTex, parseFlyTyp, parseFlyRef, parseFlyAl2, parseFlyQuadrant,
} from "./fly/quadrant.ts";
export type { FlyQuadrant, FlyCellType } from "./fly/quadrant.ts";
export { parseFlyBsp } from "./fly/bsp.ts";
export type { FlyBsp } from "./fly/bsp.ts";
export { parseDfm } from "./nocturne/dfm.ts";
export type { DfmModel, DfmLod, DfmPart, DfmInfluence, DfmTriangle } from "./nocturne/dfm.ts";
export { parseSkl } from "./nocturne/skl.ts";
export type { SklSkeleton, SklMotion } from "./nocturne/skl.ts";
export { parseKfm } from "./nocturne/kfm.ts";
export type { KfmModel, KfmPolygon, KfmCorner } from "./nocturne/kfm.ts";
export { parseCth } from "./nocturne/cth.ts";
export type { CthCloth } from "./nocturne/cth.ts";
export { parseNocturneGeo } from "./nocturne/geo.ts";
export type { NocturneGeo, GeoCell, GeoTriangle } from "./nocturne/geo.ts";
export { parseNocturneFog, NOCTURNE_FOG_GRID_SIDE, NOCTURNE_FOG_GRID_BYTES } from "./nocturne/fog.ts";
export type { NocturneFog } from "./nocturne/fog.ts";
export { parseNocturneSet } from "./nocturne/set.ts";
export type { NocturneSet, SetLight, SetCamera } from "./nocturne/set.ts";
export { parseNocturneThm, NOCTURNE_THM_WIDTH, NOCTURNE_THM_HEIGHT, NOCTURNE_THM_SLOTS } from "./nocturne/thm.ts";
export type { NocturneThm, NocturneThumbnail } from "./nocturne/thm.ts";
export { parseNocturneZth, NOCTURNE_ZTH_WIDTH, NOCTURNE_ZTH_HEIGHT, NOCTURNE_ZTH_MAP_BYTES } from "./nocturne/zth.ts";
export type { NocturneZth } from "./nocturne/zth.ts";
export * as mtm2Sim from "./sim/mtm2/index.ts";
export { PodFormatError } from "./errors.ts";
export type { PodErrorCode } from "./errors.ts";

/** The library version, as published in package.json. */
export const VERSION = "1.0.0";
