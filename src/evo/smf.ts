import { splitEvoLines } from "./text.ts";

/*
  .SMF v1-v4, the 4x4 Evolution static model format ("C3DModel").

    "C3DModel"
    fileVersion
    objectCount
    if fileVersion >= 4: lodEnabled,lodSwitchHeight

    repeat objectCount:
        groupName
        if fileVersion >= 2: visible
        objectVersion
        vertexCount,frameCount,faceCount,objectInfo
        ["v1"]                                        Evo 2 bump-material marker
        material0,material1,material2,transparent,reflective,textureName
        if v1: "bumpTextureName"
        repeat frameCount:
            repeat vertexCount: x,y,z,nx,ny,nz,u,v
        repeat faceCount: i0,i1,i2

  Read as a counted state machine rather than by sniffing where the vertex block ends: a vertex
  line and a face line are both just comma-separated numbers, and the counts are the only thing
  that distinguishes them. Every count and every face index is validated.

  Consolidated from the four copies that had drifted apart (JSTrackViewer, JSMTM2Converter,
  JSTruckViewer, JSPod). They shared this parsing layer exactly and differed only in how they
  reshaped the result for their renderers, which is why this returns the model as the file
  states it and leaves every such transform to the consumer:

    - Axes are Evo's own: Y up, in feet. The model's XYZ extent is exactly the `size` triple
      the Evo 2 .SIT records for it, checked on all 57 distinct stock track models.
    - Faces keep the file's winding and index their group's vertices.
    - V is as written. Evo's V runs top-down; measured over every stock track .SMF group, 50 of
      the 53 with a clear vertical gradient map higher Y to LOWER V.
    - Every frame is kept. The copies above read only frame 0, skipping the rest to stay
      aligned; the corpus includes a genuine 30-frame animated group (ISSHK).
    - Numbers are kept as the float64 the text denotes, so a consumer's own arithmetic
      (negating an axis, 1 - v) gives the same float32 it always did.

  Verified against every stock model: the 118 in the ASPEN, THEHILL, BAJBEACH and PEAK tracks
  (115 v4, 2 v2, 1 v3) and the 567 in both TRUCK.PODs (246 Evo 1 with .RAW textures, 321
  Evo 2 all in the "v1" bump form with .TIF textures), every file consumed exactly to its end.
*/

const SMF_MAGIC = "C3DModel";
const MAX_OBJECTS = 4096;
const MAX_VERTICES = 1 << 20;
const MAX_FACES = 1 << 20;

/*
  A reduced-detail group is its high-detail partner's name suffixed with "L": OPAQUE/OPAQUEL,
  TRANSP/TRANSPL. Observed stock spellings are case variants of OPAQUE, OPAQUEL, TRANSP,
  TRANSPI, TRANSPE and TRANSPL, so TRANSPI and TRANSPE are full-detail groups and only the
  trailing L is significant. Trucks instead keep their LOD in a separate file (TRBLAZ.SMF and
  TRBLAZ0.SMF), whose groups carry the L names.
*/
const LOD_GROUP_PATTERN = /^(opaque|transp)l$/i;

/** One animation frame of a group: per-vertex data in Evo axes, as written. */
export interface SmfFrame {
  /** x, y (up), z per vertex. */
  positions: Float64Array;
  /** nx, ny, nz per vertex. */
  normals: Float64Array;
  /** u, v per vertex; v runs top-down. */
  uvs: Float64Array;
}

export interface SmfMaterial {
  /** The material line's comma-separated fields, trimmed, verbatim. */
  fields: string[];
  /**
   * Fields 0-2: lighting scalars. Stock values are a small set (1/0.25/32, 1/1/64, 1/1/32,
   * 1/0/0, 1.25/0/0) consistent with specular strength, specular level and a Phong exponent,
   * but that reading is not confirmed, so they are not named.
   */
  scalars: [number, number, number];
  /** Field 3. Only glass and light lenses carry it in the stock trucks. */
  transparent: boolean;
  /** Field 4. */
  reflective: boolean;
  /** Field 5, trimmed, as written (may be empty or a NULL sentinel; see smfTextureReference). */
  textureName: string;
  /** Whether the group used the Evo 2 "v1" bump-material form. */
  bumpForm: boolean;
  /** The bump form's texture line, trimmed, as written (usually quoted). Null without the form. */
  bumpTextureName: string | null;
}

export interface SmfGroup {
  name: string;
  /** False when the group's visible line is "0". Always true before file version 2. */
  visible: boolean;
  objectVersion: number;
  /** The fourth field of the counts line, verbatim; meaning unknown. */
  objectInfo: string;
  vertexCount: number;
  /** Declared frame count, at least 1; `frames.length`. */
  frameCount: number;
  /** Declared face count. `indices` may hold fewer when faces were invalid (see warnings). */
  faceCount: number;
  /** Whether the name marks a reduced-detail track group (OPAQUEL, TRANSPL). */
  lodGroup: boolean;
  material: SmfMaterial;
  frames: SmfFrame[];
  /** Valid faces, three vertex indices each, in the file's winding. */
  indices: Uint32Array;
}

export interface SmfModel {
  fileVersion: number;
  lodEnabled: boolean;
  lodSwitchHeight: number;
  groups: SmfGroup[];
  warnings: string[];
}

/** True when these bytes begin with the C3DModel magic line. */
export function isSmfModel(bytes: Uint8Array | null | undefined): boolean {
  if (!bytes || bytes.length < SMF_MAGIC.length) return false;
  for (let i = 0; i < SMF_MAGIC.length; i++) {
    if (bytes[i] !== SMF_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Parse an .SMF model.
 *
 * @throws Error when the file is not a C3DModel, has an unsupported version, implausible counts,
 *   or ends inside a vertex or face block. Recoverable problems go to `warnings`.
 */
export function parseSmf(bytes: Uint8Array, sourceName: string): SmfModel {
  const lines = splitEvoLines(bytes);
  let cursor = 0;
  const warnings: string[] = [];
  const next = (): string | null => (cursor < lines.length ? lines[cursor++].trim() : null);
  const peek = (): string | null => (cursor < lines.length ? lines[cursor].trim() : null);

  if (next() !== SMF_MAGIC) throw new Error(`${sourceName}: not a C3DModel`);
  const fileVersion = int(next());
  if (!(fileVersion >= 1 && fileVersion <= 4)) {
    throw new Error(`${sourceName}: unsupported .SMF version ${fileVersion}`);
  }
  const objectCount = int(next());
  if (!(objectCount >= 0 && objectCount <= MAX_OBJECTS)) {
    throw new Error(`${sourceName}: implausible object count ${objectCount}`);
  }

  let lodEnabled = false;
  let lodSwitchHeight = 0;
  if (fileVersion >= 4) {
    const parts = (next() ?? "").split(",");
    lodEnabled = (parts[0] ?? "0").trim() !== "0";
    lodSwitchHeight = float(parts[1]);
  }

  const groups: SmfGroup[] = [];
  for (let o = 0; o < objectCount; o++) {
    const name = next();
    if (name === null) {
      warnings.push(`ran out of lines at group ${o + 1} of ${objectCount}`);
      break;
    }
    const visible = fileVersion >= 2 ? next() !== "0" : true;
    const objectVersion = int(next());

    const counts = (next() ?? "").split(",");
    const vertexCount = int(counts[0]);
    const frameCount = Math.max(1, int(counts[1]));
    const faceCount = int(counts[2]);
    const objectInfo = counts[3]?.trim() ?? "";
    if (!(vertexCount >= 0 && vertexCount <= MAX_VERTICES) || !(faceCount >= 0 && faceCount <= MAX_FACES)) {
      throw new Error(`${sourceName}: implausible counts in group "${name}" (${vertexCount} verts, ${faceCount} faces)`);
    }

    // The Evo 2 bump form announces itself with a bare "v1" line before the material.
    const bumpForm = peek() === "v1";
    if (bumpForm) next();
    const fields = (next() ?? "").split(",").map((field) => field.trim());
    const bumpTextureName = bumpForm ? (next() ?? "") : null;

    const frames: SmfFrame[] = [];
    for (let f = 0; f < frameCount; f++) {
      const positions = new Float64Array(vertexCount * 3);
      const normals = new Float64Array(vertexCount * 3);
      const uvs = new Float64Array(vertexCount * 2);
      for (let v = 0; v < vertexCount; v++) {
        const line = next();
        if (line === null) throw new Error(`${sourceName}: truncated vertex block in "${name}"`);
        const p = line.split(",");
        positions[v * 3] = float(p[0]);
        positions[v * 3 + 1] = float(p[1]);
        positions[v * 3 + 2] = float(p[2]);
        normals[v * 3] = float(p[3]);
        normals[v * 3 + 1] = float(p[4]);
        normals[v * 3 + 2] = float(p[5]);
        uvs[v * 2] = float(p[6]);
        uvs[v * 2 + 1] = float(p[7]);
      }
      frames.push({ positions, normals, uvs });
    }

    const indices = new Uint32Array(faceCount * 3);
    let kept = 0;
    for (let f = 0; f < faceCount; f++) {
      const line = next();
      if (line === null) throw new Error(`${sourceName}: truncated face block in "${name}"`);
      const parts = line.split(",");
      const i0 = int(parts[0]), i1 = int(parts[1]), i2 = int(parts[2]);
      if (i0 < 0 || i1 < 0 || i2 < 0 || i0 >= vertexCount || i1 >= vertexCount || i2 >= vertexCount) {
        warnings.push(`"${name}" face ${f} indexes outside its ${vertexCount} vertices`);
        continue;
      }
      indices[kept * 3] = i0;
      indices[kept * 3 + 1] = i1;
      indices[kept * 3 + 2] = i2;
      kept++;
    }

    groups.push({
      name,
      visible,
      objectVersion,
      objectInfo,
      vertexCount,
      frameCount,
      faceCount,
      lodGroup: LOD_GROUP_PATTERN.test(name),
      material: {
        fields,
        scalars: [float(fields[0]), float(fields[1]), float(fields[2])],
        transparent: (fields[3] ?? "0") !== "0",
        reflective: (fields[4] ?? "0") !== "0",
        textureName: fields[5] ?? "",
        bumpForm,
        bumpTextureName,
      },
      frames,
      indices: kept === faceCount ? indices : indices.slice(0, kept * 3),
    });
  }

  return { fileVersion, lodEnabled, lodSwitchHeight, groups, warnings };
}

/**
 * A texture reference from an .SMF material, as an upper-case archive file name, or null when
 * there is none: empty, or one of the NULL sentinels the stock trucks write (NULL, NULL.RAW,
 * NULL.TIF). Quotes are removed.
 */
export function smfTextureReference(field: string | null | undefined): string | null {
  const name = (field ?? "").replace(/"/g, "").trim().toUpperCase();
  return name && name !== "NULL" && name !== "NULL.RAW" && name !== "NULL.TIF" ? name : null;
}

function int(value: string | undefined | null): number {
  const parsed = Number.parseInt((value ?? "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function float(value: string | undefined | null): number {
  const parsed = Number.parseFloat((value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}
