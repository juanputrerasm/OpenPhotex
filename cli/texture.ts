/*
  `openphotex texture ...`: render an indexed .RAW texture to PNG.

  The source is either a POD and an entry in it, or a loose .RAW file. The palette is chosen by
  the rules the archives themselves state (see docs/RAW_ACT.md), and the JSON output says which
  one was used, so a caller never has to guess why a texture came out the colour it did:

    1. --act <file> or --palette <entry>, when given;
    2. the same-stem .ACT beside the texture in the archive;
    3. the POD1 palette record (PodEntry.paletteName), resolved by file name in the archive.

  Nothing else is guessed: with none of these the command fails with PALETTE_REQUIRED.
*/
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import {
  actPaletteDepth,
  applyOpacityPlane,
  decodeActPalette,
  decodeRawTexture,
  findPodEntry,
  parsePod,
  podPathTitle,
  rawTextureSide,
  readPodEntry,
  type PodArchive,
  type PodEntry,
  type RawTextureFamily,
} from "openphotex";
import { CliError, EXIT, printJson, usageError } from "./output.ts";
import { selectEntry } from "./pod.ts";

export interface TextureOptions {
  json: boolean;
  output: string | undefined;
  act: string | undefined;
  palette: string | undefined;
  opa: string | undefined;
  family: string | undefined;
  cutout: boolean;
  force: boolean;
}

type PaletteSource = "act-file" | "palette-entry" | "same-stem" | "palette-record";

export function texture(source: string | undefined, selector: string | undefined, options: TextureOptions): void {
  if (!source) throw usageError("Missing source: a POD and an entry, or a loose .RAW file.");
  if (!options.output) throw usageError("texture needs -o <file.png>.");
  if (options.family && options.family !== "classic" && options.family !== "evo") {
    throw usageError(`--family is classic or evo, not '${options.family}'.`);
  }
  const bytes = new Uint8Array(readFileSync(source));
  const archive = tryParsePod(bytes);
  if (!archive && selector) throw new CliError("UNSUPPORTED_FORMAT", `${source} is not a POD archive, so it has no entry '${selector}'.`, EXIT.FORMAT);
  if (archive && !selector) throw usageError(`${source} is a POD archive: name the .RAW entry to render.`);
  if (!archive && options.palette) throw usageError("--palette names an archive entry; for a loose .RAW use --act <file>.");

  const family: RawTextureFamily = (options.family as RawTextureFamily | undefined) ?? (archive?.format === "pod2" ? "evo" : "classic");
  const entry = archive ? selectEntry(archive, selector!) : null;
  const raw = entry ? readPodEntry(bytes, entry) : bytes;
  if (!rawTextureSide(raw.length, family)) {
    throw new CliError("UNSUPPORTED_FORMAT", `${entry?.name ?? source}: ${raw.length} bytes is not a ${family} .RAW texture size.`, EXIT.FORMAT, { length: raw.length, family });
  }

  const { act, source: paletteSource, name: paletteName } = choosePalette(bytes, archive, entry, options);
  const palette = decodeActPalette(act);
  if (!palette) throw new CliError("UNSUPPORTED_FORMAT", `${paletteName} is ${act.length} bytes; an .ACT palette needs 768.`, EXIT.FORMAT);

  let image = decodeRawTexture(raw, palette, { family, cutout: options.cutout });
  let opacityName: string | null = null;
  if (options.opa) {
    const opa = archive ? readPodEntry(bytes, selectEntry(archive, options.opa)) : readFileSync(options.opa);
    opacityName = options.opa;
    const before = image;
    image = applyOpacityPlane(image, new Uint8Array(opa));
    if (image === before) throw new CliError("UNSUPPORTED_FORMAT", `${options.opa} is ${opa.length} bytes; the texture has ${image.width * image.height} texels.`, EXIT.FORMAT);
  }

  const target = resolve(options.output);
  if (!options.force && existsSync(target)) throw new CliError("OUTPUT_EXISTS", `Refusing to overwrite ${target} (use --force).`, EXIT.IO, { path: target });
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, encodePng(image.width, image.height, image.rgba));

  if (options.json) {
    printJson({
      command: "texture",
      file: source,
      entry: entry ? entry.name : null,
      family,
      width: image.width,
      height: image.height,
      hasAlpha: image.hasAlpha,
      palette: { source: paletteSource, name: paletteName, depth: actPaletteDepth(act) },
      opacity: opacityName,
      output: target,
    });
  } else {
    process.stdout.write(`${entry?.name ?? source} -> ${target} (${image.width}x${image.height}, palette ${paletteName} [${paletteSource}])\n`);
  }
}

function tryParsePod(bytes: Uint8Array): PodArchive | null {
  try {
    return parsePod(bytes);
  } catch {
    return null;
  }
}

function choosePalette(bytes: Uint8Array, archive: PodArchive | null, entry: PodEntry | null, options: TextureOptions): { act: Uint8Array; source: PaletteSource; name: string } {
  if (options.act) return { act: new Uint8Array(readFileSync(options.act)), source: "act-file", name: options.act };
  if (archive && options.palette) {
    const chosen = selectEntry(archive, options.palette);
    return { act: readPodEntry(bytes, chosen), source: "palette-entry", name: chosen.name };
  }
  if (archive && entry) {
    const sameStem = findPodEntry(archive, entry.normalizedName.replace(/\.[^./]*$/, ".ACT"));
    if (sameStem) return { act: readPodEntry(bytes, sameStem), source: "same-stem", name: sameStem.name };
    if (entry.paletteName) {
      const title = podPathTitle(entry.paletteName);
      const named = archive.entries.find((e) => e.title === title);
      if (named) return { act: readPodEntry(bytes, named), source: "palette-record", name: named.name };
    }
  }
  const hint = entry?.paletteName
    ? `its palette record names ${entry.paletteName}, which is not in this archive; pass it with --act`
    : "pass --act <file.act> or --palette <entry>";
  throw new CliError("PALETTE_REQUIRED", `No palette for ${entry?.name ?? "this texture"}: ${hint}.`, EXIT.NOT_FOUND, {
    paletteName: entry?.paletteName ?? null,
  });
}

/** A minimal RGBA PNG: one IDAT, no filtering. */
function encodePng(width: number, height: number, rgba: Uint8ClampedArray): Uint8Array {
  const stride = width * 4;
  const scanlines = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    scanlines[y * (stride + 1)] = 0;
    scanlines.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit, RGBA, deflate, no filter, no interlace
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines)),
    chunk("IEND", new Uint8Array(0)),
  ];
  return Buffer.concat(parts);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  const typed = Buffer.from(type, "latin1");
  out.set(typed, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
