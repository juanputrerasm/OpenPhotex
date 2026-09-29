# RAW textures and ACT palettes

Terminal Reality's 8-bit art is stored as a pair of files:

- **`.RAW`**: palette indices with no header.
- **`.ACT`**: the palette, 256 RGB triples.

4x4 Evolution adds a third, optional file: an **`.OPA`** opacity plane. The implementation is `src/texture/`, pinned by `test/texture.test.ts` and, when the games are present, `test/stock.test.ts`. The code was ported from JSTrackViewer's `src/worker/texture-decoder.js` and `src/worker/evo/evo-image.js`, which are the behavioral baselines. On every stock texture OpenPhotex decodes to the same pixels as they did: 17,504 classic textures (with and without the color key) and 6,973 Evo textures, 263 of them with an `.OPA`.

## .RAW

A `.RAW` texture is one byte per texel, row by row, from the top. It is square, and the side follows from the byte count.

| Family | Games | Sides accepted |
|---|---|---|
| `classic` | MTM1, MTM2, CPR, Terminal Velocity, Fury3, Hellbender | powers of two, 32 to 1024 |
| `evo` | 4x4 Evolution 1 and 2 | powers of two, 8 to 2048 |

The classic limits are the MTM2 fork's `POD1_RAW_MIN_SIDE` and `POD1_RAW_MAX_SIDE` (`Pod1RawSide`, TrackPOD/TrackPODFile.cpp). Stock art uses more than the 64 and 256 that older readers hardcoded. For example, `ART\CYLWH.RAW` in MTM1's `GAME.POD` is 1024 bytes, 32 by 32. The Evo limits cover every Evo texture, whose sides run from 32 to 512.

Not every `.RAW` is a texture. Terrain heightfields and other data share the extension. There are 524 classic and 59 Evo `.RAW` entries whose sizes are not square, plus two 16x16 classic ones that the fork's rule excludes. `rawTextureSide` returns 0 for all of these, and `decodeRawTexture` refuses them.

## .ACT

An `.ACT` is 768 bytes: 256 triples of red, green and blue. Longer files carry other data after the palette, and only the first 768 bytes are read. Some archives contain 0-byte `.ACT` entries, and those are not palettes.

### 6-bit or 8-bit

The file doesn't say which bit depth its channels use.

- **Adobe ACT palettes** use full 8-bit channels, 0 to 255.
- **VGA DAC tables** use 6-bit channels, 0 to 63. Read as 8-bit, such a palette renders at about a quarter of its brightness.

`decodeActPalette` treats a palette as 6-bit **only when its brightest channel is exactly 63**. It scales such a palette with `round((v * 255 + 31) / 63)`, so 0 stays 0 and 63 becomes exactly 255 rather than 252. Every other palette is used as stored.

The older rule, still in JSPod, called a palette 6-bit whenever no channel exceeded 63. That brightened every genuinely dark palette about fourfold. The stock data shows it was wrong:

- **Classic games:** of 7,356 palettes, 40 stay at or below 63, and every one is a dark 8-bit palette. They include `MI4BLACK` and `RA4BLACK` (all zeros), `NITESKY`, the `TSHADOW` truck shadows, Hellbender's `CAVSKY`, and Laguna Seca's `LAGQ28CC`, `LAGQ28D9` and `LAGQ799`, which bake the walkway's shadow into three road quads. The brightest of the 40 is 60. Under the old rule those three road quads rendered as bright tan dirt.
- **4x4 Evolution:** of 7,038 palettes, 10 stay below 63: `NITESKY` (brightest channel 17), `RAINSKY` (45), `GLARE` (47), and all-zero `BOMB` and `DETAIL`.
- **No palette is 6-bit.** No stock palette in either family has 63 as its brightest channel, so the 6-bit branch applies to none of them. It stays for community art made with VGA tools.

JSMTM2Converter used the old rule, and its scaling (`v * 4`) also capped at 252. After moving to OpenPhotex it draws Evo's `NITESKY`, `RAINSKY` and `GLARE` as stored rather than four times brighter. Those three palettes ship only in the `STARTUP.POD` archives, which the converter does not read, so no stock conversion changes.

`actPaletteDepth` reports which reading applies.

### Which palette a texture uses

Choosing a palette is not a property of the `.RAW`, so `decodeRawTexture` takes it as an argument. The archives state the answer in these ways, strongest first:

1. **A same-stem `.ACT`** beside the texture (`FOO.ACT` next to `FOO.RAW`). The archive puts it there deliberately, and it is never overridden. Every one of the 3,757 terrain slots across the four stock Evo tracks has one.
2. **The POD1 palette record:** the second string in a `.RAW` entry's name field, returned as `PodEntry.paletteName` (see [POD.md](POD.md)). It is a file name, so resolve it by entry file name. It may name a palette from another archive: MTM1's `TRUCK.POD` names `METALCR2.ACT`, which ships in `GAME.POD`.

Beyond those two, the answer depends on the game, and **`paletteCandidates(archive, { name, entry }, options)`** returns the ranked list. It names entries and bundled palettes rather than holding bytes; the caller reads each in turn and skips any shorter than 768 bytes.

3. **The archive's own `METALCR2.ACT`, then its `VGA.ACT`.** A POD carrying either says which family it belongs to, and its copy beats a bundled one, because CPR's METALCR2 is not MTM1's.
4. **A bundled palette** (`bundledPalette`): MTM1's METALCR2 (MTM2 uses the same), CPR's METALCR2, Hellbender's VGA, and Terminal Velocity and Fury3's VGA. Shared MTM and CPR model art is authored against METALCR2, which ships in STARTUP.POD and is never inside a track or truck POD, so a tool given one archive cannot reach the real file.
5. **Another `.ACT` in the texture's folder.** Offered to a person, never chosen automatically.

Without `origin` the result is a picker list: every rule, all four bundled palettes, the same-folder palettes last, and no entry twice. This is JSPod's palette dropdown.

With `origin` (the caller has read the `.SIT` or `.LVL`) it is an automatic chain: the bundled palette for that game only, no same-folder guesses, and the level's own palette when the caller passes `trackPalette: true`. Where that goes depends on `kind`:

- **Model art in MTM1, MTM2 and CPR, and MTM2 terrain:** the shared palette outranks the level's. The level palette is what the terrain was built against, not the shared object art. Ranking them the other way drew ROCKQRY's checkpoint chevron and start lights as coloured speckle, and CRAZY98's start line as blue.
- **Everything else, including MTM1 terrain and every flight-game texture:** the level's palette first. The flight games have one global palette and the `.LVL` names it. MTM1 levels name their palette on purpose (Arizona's `DEMO.ACT`).

This consolidates JSPod's picker and JSTrackViewer's resolver, and JSTruckViewer's shorter chain. Both JSPod and JSTrackViewer resolve identically on it: the same option list for all 18,348 stock and community RAWs, and the same palette and source for over a million JSTrackViewer lookups. `openphotex texture` still applies only rules 1 and 2 and otherwise asks for a palette rather than guessing one.

## The classic color key

MTM2 has no alpha channel. For the face types that need see-through texels (glass, trees, fences and grilles, face types `0x11` and `0x33`), the engine cuts every texel whose **palette color is pure black**, whatever its index:

```
Traxx_OnGoing_Updates OpenGLTerrainRenderer.cpp:9048
  BYTE a = (r == 0 && g == 0 && b == 0) ? 0 : 255;
```

`decodeRawTexture(raw, palette, { cutout: true })` does the same. The cutout is opt-in because the face type decides it, not the texture. A cut texel keeps black RGB, because linear filtering bleeds the color of transparent texels into their neighbors, and the engine's own glass sampler gives "alpha 0 and black RGB".

## .OPA (4x4 Evolution)

An `.OPA` holds one byte per texel with no header, and pairs with its texture by stem. It is a real alpha gradient, not a mask: `AS3PINE1.OPA` uses all 256 levels. It must therefore not be turned into a color key, or every soft foliage edge becomes a hard stencil. `applyOpacityPlane` writes it into the alpha channel. A plane whose length differs from the texel count means the pairing is wrong, so it is ignored rather than stretched.

Evo can also ship `.TIF` textures. TIFF decoding still lives in JSTrackViewer and JSMTM2Converter, in two copies, and has not been extracted to OpenPhotex yet.

## Open questions

- **16x16 textures:** whether the classic engines really reject 16x16 textures, of which there are two stock examples. The 32-texel minimum comes from the fork.
- **Community VGA art:** whether any community art uses true 6-bit palettes, the only case where the 6-bit branch matters.
