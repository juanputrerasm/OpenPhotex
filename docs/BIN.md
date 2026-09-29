# .BIN models (MRGL)

The model format of Monster Truck Madness 1 and 2, CART Precision Racing, Terminal Velocity, Fury3 and Hellbender. A `.BIN` is a stream of 32-bit little-endian records, each an opcode word followed by its payload. The opcode names are the engine's own, from `3D.H` by way of Traxx's `TrackPODModel.cpp`, and they are exported as `MRGL`. The engine writes them in decimal.

```
MRGL_MAGNIFY  power                          the model's scale power
MRGL_VLIST    slot, n, then n (x, z, y)      the vertex list
...           texture, colour, material and facet records
MRGL_EOL                                     the end
```

`parseBin(bytes)` returns the model as the file states it:

- **`vertices`:** the raw words, three per vertex in file order. The engine shifts each right by one, and the three are (x, z, y) with z up.
- **`faces`:** in file order. Each face carries:
  - its opcode, byte offset and corners (vertex index, plus u and v for mapped faces);
  - the facet header's stored normal and fourth word;
  - the texture, `MRGL_COLOR` and material **in force when it was read**, plus which record set that texture.
- **`materials` and `materials2`:** the `MRGL_MATERIAL` and `MRGL_MATERIAL2` records. Their 16.16 fields are decoded, and the flags are named by `MRGLMAT` and `MRGLMAT2`.
- **`frameNames`:** for an `ANIMATED_BIN`. It is not geometry but a keyframe control file naming its frame models, which are separate `.BIN` entries.

Scaling, axes, batching into meshes, triangulation and shading are left to the consumer.

## The record walk

The walk follows the engine's own stride table (`MRGLSizeRaw()`, via Traxx's `mrglSkipInts`). A record the walk does not interpret is **stepped over** by its known length, and the walk stops only at `MRGL_EOL`, at an opcode with no known length, or at a record that runs past the end. A model that stops early is still a valid model with fewer faces, so `incomplete` and `stopReason` say so.

Stopping at the first record a decoder doesn't draw is how `MRGL_MATERIAL2` and `MRGL_NORMALMAP` once truncated models without any warning. `MRGL_MATERIAL`, `MRGL_TEXTURE64` and `MRGL_MATERIAL2` exist because the Community Patch engine added them.

The walk also encodes these rules:

- **Texture names:** `MRGL_TEXTURE` has a 16-byte name and `MRGL_TEXTURE64` a 64-byte one. The fork caps stored names at 31 characters (`BIN_TEXTURE_NAME_MAX`), and a full 64-byte name has no NUL. `MRGL_TEXTURECYCLE`'s first frame name becomes the current texture.
- **`MRGL_COLOR`:** sets the colour for the flat `0x19` faces that follow and **does not clear the texture**. Traxx's editor does clear it, which ends texture mapping partway through a model. JSPod established the correct behaviour against real models.
- **One-based indices:** a face whose indices are out of range as zero-based but valid as one-based is corrected (`oneBased`). Any other out-of-range face is dropped.
- **Bad corner counts:** a face with an implausible corner count consumes only its count word, exactly as every earlier decoder read it.

## Evidence

The code was consolidated from JSTrackViewer's, JSTruckViewer's and JSPod's decoders, which had diverged by up to 942 lines. Three findings settled the differences:

- **The walks agree on real data.** On all 2,335 stock and community models (2,277 geometry, 53 animated), all three walks produce the same faces and none stops early. The records they disagreed on never occur: a second vertex list, `MRGL_OUTLINE`, `MRGL_KEYFRAME`, and opcodes with no handling. JSTrackViewer's engine-derived walk is therefore the canonical one, being identical on the data and strictly safer on the unknown.
- **The adapters are exact.** Each viewer's adapter reproduces its old decoder **bit for bit** on every model: JSTrackViewer under the MTM2, Hellbender and Terminal Velocity scales, JSPod under two, and JSTruckViewer. Every stock model walks to `MRGL_EOL` (`test/stock.test.ts`).
- **Animated models are frame lists.** All 53 animated models carry a frame count, a magnify word (6,553 to 131,072), a zero vertex count and `MRGL_EOL`. Their frame names agree across decoders. JSTruckViewer's reading of them as geometry never produced any.

Twelve face opcodes occur in the corpus: `FACET` (5), `GFACET` (6), `FACETTMAP` (14), `TTFACET` (15), `FACETTTMAP` (17), `ZFACETTMAP` (24), `ZFACET` (25), `ZPFACETTMAP` (34), `ZGFACETTMAP` (41), `UZFACETTTMAP` (51), `UZFACETTMAP` (52) and `MATFACET` (64). The legacy colour-keyed transparent types are `0x11` and `0x33` (`BIN_TRANSPARENT_FACE_TYPES`).

## Scale

Editor units per vertex are `(raw >> 1) * 65536 / (magnify * divisor)` (`BIN_GEOMETRY_DIVISOR`):

| Games | Divisor | World units per 64-unit editor cell |
|---|---|---|
| MTM1, MTM2, CPR | 64 | |
| Hellbender | 4096 | 2^19 |
| Terminal Velocity, Fury3 | 8192 | 2^20 |

The TV-family engines size a model as `world = raw * 65536 / magnify`. FuryEdit.exe computes model extents exactly that way (at `0x4053b0`). Every `.DEF` hit radius across 193 TV and Fury3 definitions equals the model's vertex radius at that scale, times 1.00 to 1.4 (median 1.15). The same derivation reproduces Hellbender's divisor. JSPod used `10922.667` (2^15 / 3, the vertical height step), which drew TV and Fury3 models at 75% of their width. It now uses 8192.

## Writing

`writeBin` takes what `parseBin` reads back: the raw vertex words, and faces grouped under the texture, facet opcode and optional `MRGL_MATERIAL`/`MRGL_MATERIAL2` they are drawn with. It writes `MRGL_MAGNIFY`, the vertex list, a `MRGL_TEXTURE` (or `MRGL_TEXTURE64` for a name over 15 bytes) whenever the texture changes, each group's materials, the facets and `MRGL_EOL`. Only the facets `parseBin` reads are accepted (`BIN_MAPPED_FACETS`, `BIN_UNMAPPED_FACETS`).

The two per-face values the format stores are derived, never taken from the caller:

- **The stored normal** (`binFaceNormal`) is the unit cross product of the first three corners' words as stored, in 16.16. On every stock model of all six games it points the same way as the stored normal on 99.9 to 100% of faces, and matches to within 1/1000 on 74 to 96%. A face with no area has no normal and is left out (`degenerateFaces` counts them).
- **The plane term** (`binPlaneTerm`), the header's fourth word, is that normal dotted with the first corner, wrapped to 32 bits. Stock files hold it on 99.96% of 21,053 faces across eight stock tracks, to within rounding.

The writer came from JSMTM2Converter, which keeps its own policy on top: how Evo `.SMF` axes and scale become vertex words, which facet and material each mesh gets for the engine's fast paths, and which repeated faces to drop. Its output is byte-identical to the converter's previous writer on all 793 distinct stock and community Evo models under every option set it uses, and every stock model this writer can express (2,211 models, 214,914 faces) comes back from a rewrite with the same geometry, textures, facets and material flags.

## Open questions

- **Facet header:** the meaning of its fourth word ("funk", `magic`) and whether any engine uses the stored normal.
- **`MRGL_NORMALMAP`:** its layout beyond its 18-word length. It is stepped over, and no stock model uses it.
- **Non-zero values:** whether any real model carries non-zero `MRGL_MATERIAL2` reserved words.
