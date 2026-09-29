/*
  Indexed .RAW textures, and 4x4 Evolution's .OPA opacity planes.

  A .RAW texture is unheadered: one palette index per texel, row by row, square, with the side
  implied by the byte count. It is drawn through an .ACT palette (see act.ts); which .ACT is
  the caller's decision (see docs/RAW_ACT.md), so decoding takes the palette as given.

  Ported from JSTrackViewer's src/worker/texture-decoder.js (classic) and
  src/worker/evo/evo-image.js (Evo), the behavioural baselines.
*/
import { ACT_PALETTE_SIZE } from "./act.ts";

/**
 * Which games' size rules apply.
 *
 * - `classic`: Monster Truck Madness 1 and 2, CART Precision Racing, Terminal Velocity, Fury3,
 *   Hellbender. Square power-of-two sides from 32 to 1024.
 * - `evo`: 4x4 Evolution 1 and 2. Square power-of-two sides from 8 to 2048.
 */
export type RawTextureFamily = "classic" | "evo";

const SIDE_LIMITS: Record<RawTextureFamily, [number, number]> = {
  /*
    Square power-of-two 8-bit tiles, 32..1024: the MTM2 fork's POD1_RAW_MIN_SIDE and
    POD1_RAW_MAX_SIDE. Its Pod1RawSide (TrackPOD/TrackPODFile.cpp:635-645) replaced eleven
    copies of a hardcoded `switch (size) { case 4096: 64; case 65536: 256; }`. Stock art really
    does use other sizes: ART\CYLWH.RAW in game.pod is 1024 bytes, i.e. 32x32, and was reported
    as a bad texture while the renderer drew it perfectly well.
  */
  classic: [32, 1024],
  evo: [8, 2048],
};

/** A decoded texture: `width * height` RGBA texels, row by row. */
export interface RgbaImage {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  /** Whether any texel may be less than fully opaque. */
  hasAlpha: boolean;
}

export interface DecodeRawTextureOptions {
  /** Size rules to apply. Defaults to `classic`. */
  family?: RawTextureFamily;
  /**
   * Classic colour-key transparency: make every texel whose palette colour is pure black fully
   * transparent (and keep it black). For glass, trees, fences and grilles only; see below.
   */
  cutout?: boolean;
}

/**
 * Side length of a square 8-bit .RAW texture with this many bytes, or 0 if the byte count is
 * not one the family's games accept.
 */
export function rawTextureSide(byteLength: number, family: RawTextureFamily = "classic"): number {
  const [min, max] = SIDE_LIMITS[family];
  for (let side = min; side <= max; side <<= 1) {
    if (byteLength === side * side) return side;
  }
  return 0;
}

/**
 * Decode an indexed .RAW through an 8-bit RGB palette (as `decodeActPalette` returns).
 *
 * @throws RangeError when the byte count is not a texture size for the family, or the palette
 *   is shorter than 768 bytes.
 */
export function decodeRawTexture(raw: Uint8Array, palette: Uint8Array, options: DecodeRawTextureOptions = {}): RgbaImage {
  const family = options.family ?? "classic";
  const side = rawTextureSide(raw.length, family);
  if (!side) throw new RangeError(`${raw.length} bytes is not a ${family} .RAW texture size.`);
  return decodeIndexedImage(raw, palette, side, side, { cutout: options.cutout });
}

/**
 * Map palette indices to RGBA at any size, for 8-bit images that are not textures (screens,
 * heightfields viewed as images, or a size a user picks). Texels beyond the end of `indices`
 * are left fully transparent black; indices beyond `width * height` are ignored.
 *
 * @throws RangeError for a non-positive size or a palette shorter than 768 bytes.
 */
export function decodeIndexedImage(
  indices: Uint8Array,
  palette: Uint8Array,
  width: number,
  height: number,
  options: { cutout?: boolean } = {},
): RgbaImage {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`Invalid image size ${width}x${height}.`);
  }
  if (palette.length < ACT_PALETTE_SIZE) throw new RangeError(`A palette needs ${ACT_PALETTE_SIZE} bytes, not ${palette.length}.`);
  /*
    Cutout transparency.

    MTM2 has no alpha channel anywhere. The engine cuts a texel STRICTLY by face type, and
    the key is the texel resolving to pure black in the palette, not a particular index:

      Traxx_OnGoing_Updates OpenGLTerrainRenderer.cpp:9048
        BYTE a = (r == 0 && g == 0 && b == 0) ? 0 : 255;

    Two things follow:

      - `cutout` is opt-in per texture. It applies only to faces of type 0x11 / 0x33 (glass,
        trees, fences, grilles). Punching holes in every texture that happens to contain
        index 0 is not what the engine does, and neither is guessing the key from the
        top-left pixel.

      - A cut texel keeps BLACK RGB rather than whatever colour sat underneath it. Linear
        filtering bleeds the colour of transparent texels into their opaque neighbours, and
        black is what the legacy colour-key look bleeds. The engine says so outright for its
        own glass sampler: "index-0 texels contribute alpha 0 AND black RGB".
  */
  const cutout = options.cutout === true;
  const texels = Math.min(indices.length, width * height);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < texels; i++) {
    const ci = indices[i] * 3;
    const o = i * 4;
    const r = palette[ci], g = palette[ci + 1], b = palette[ci + 2];
    const cut = cutout && r === 0 && g === 0 && b === 0;
    rgba[o] = cut ? 0 : r;
    rgba[o + 1] = cut ? 0 : g;
    rgba[o + 2] = cut ? 0 : b;
    rgba[o + 3] = cut ? 0 : 255;
  }
  return { width, height, rgba, hasAlpha: cutout || texels < width * height };
}

/*
  4x4 Evolution's .OPA: an unheadered byte per pixel, paired with its texture by stem, holding
  a real gradient rather than a mask. Every stock .OPA uses the full range (AS3PINE1.OPA uses
  all 256 levels), which is the difference from the classic games, which have no alpha anywhere
  and cut texels by colour key instead. Routing an .OPA through a colour key would harden every
  soft foliage edge into a stencil.

  A plane whose length does not match the image's texel count means the pairing was wrong, not
  that the plane needs resampling, so it is ignored rather than stretched.
*/
/**
 * Put an .OPA opacity plane into an image's alpha channel, in place. Returns the image with
 * `hasAlpha` set, or the image untouched when the plane is missing or the wrong size.
 */
export function applyOpacityPlane<T extends RgbaImage>(image: T, opacity: Uint8Array | null | undefined): T {
  const texels = image.width * image.height;
  if (!opacity || opacity.length !== texels) return image;
  for (let i = 0; i < texels; i++) image.rgba[i * 4 + 3] = opacity[i];
  return { ...image, hasAlpha: true };
}
