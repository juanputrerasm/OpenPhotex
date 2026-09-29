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
} from "./model/bin.ts";
export type { BinModel, BinFace, BinMaterial, BinMaterial2 } from "./model/bin.ts";
export { PodFormatError } from "./errors.ts";
export type { PodErrorCode } from "./errors.ts";

/** The library version, as published in package.json. */
export const VERSION = "0.1.0";
