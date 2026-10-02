# Nocturne formats

OpenPhotex reads nine formats from Terminal Reality's 1999 *Nocturne*. The evidence is the retail archive set in `~/games/nocturne`: 113 DFM, 70 SKL, 577 KFM, 25 CTH, 20 SET, 20 GEO, 1,611 FOG, 20 THM and 20 ZTH files. `test/stock.test.ts` reads every one when that install is present.

## Character data

### DFM: deformable model

The shipped files are text version 7. A DFM names its SKL and textures, then stores one to four LODs, named body parts, vertices made from weighted bone-local positions, textured triangles, cap triangles, bone origins, root scale, bias and a bone-to-part table.

UV coordinates use a 24-bit fixed-point scale (`value / 16777216`). A LOD's triangle stream contains `triangleCount + capTriangleCount` records; `capTriangleParts` describes the final cap records. `parseDfm` returns stored numbers without changing coordinate systems or normalising weights.

### SKL: skeleton and animation bank

Nocturne ships text SKL version 3. It contains parented bones, a quaternion for every bone in every frame, per-frame root translation and cancelled movement, state names, and motions. Motions hold their frame span, exits, state transitions, signals and marker frames. Version 3 ends with reference bone origins.

`parseSkl` accepts text versions 2 and 3. The version 4 hybrid text/binary dialect found in later Blair Witch games is intentionally not claimed yet.

### KFM: key-frame/morph model

KFM is the simpler model used for props and cloth surfaces. `parseKfm` supports binary versions 3–4 and text versions 5–8, including multiple vertex frames, triangles/quads, textures, parts, collision flags and v7+ environment-map opacity.

Text UVs use a 24-bit fixed-point scale. Binary UVs and plane fields use 16.16 fixed point; binary vertex positions use `value / 256`. OpenPhotex exposes stored integers so callers choose when to lose precision.

### CTH: cloth properties

`parseCth` supports versions 1–3. It links a KFM to cloth simulation values, locked vertices and optional bone collision shapes. Version 1 has six physical values and no `doubleSided`; version 3 adds wind area and moment of inertia.

## Pre-rendered scenes

### SET: scene manifest

Nocturne SET files are text version 26. `parseNocturneSet` reads global fog/water/environment settings, every light (including animated filters and camera visibility rectangles), and every camera (pose, view matrix, local fog, bounds and reverb preset).

The nonblank post-camera lines for room dimensions, default ground/reverb, virtual-director boxes and PVS tables are retained in `trailingLines`. Their syntax is visible, but several values still lack enough semantic evidence to assign stable names.

### GEO: collision geometry

Binary GEO version 4 is a uniform 3-D spatial grid. Each cell has bounds and may carry float vertices, indexed triangles, triangle planes/dominant axes, one ground-type byte per triangle and a 64-byte occupancy grid. `parseNocturneGeo` validates all counts and requires the file to end exactly after the final cell.

### FOG: per-camera fog

Every FOG starts with a 4,096-byte `16 x 16 x 16` density cube. The remainder is absent, raw, or begins with an `EFD`/`LZW` tag. `parseNocturneFog` separates the density and returns the payload and encoding without pretending to decompress the proprietary camera-image stream. Its associated backdrop is 320 by 240.

### THM: location thumbnails

Every location has a fixed ten-slot THM bank. Each slot is a 320x240 RGB image stored as RGBX, with the fourth byte always zero. Unused trailing slots are entirely black. `parseNocturneThm` converts each slot to opaque RGBA and reports whether it is empty; the stock locations use between one and nine slots.

### ZTH: camera depth thumbnails

ZTH is a concatenation of 64x48 depth maps in SET camera order. Each sample is a little-endian 24-bit value in a four-byte word; zero denotes no sampled surface. Every retail ZTH contains exactly one map per camera named by its location's SET. `parseNocturneZth` preserves those integer depth values because their world-space scale is not yet established.

## Scene composition and open questions

Each location has one SET, GEO, THM and ZTH. Each SET camera corresponds to a pre-rendered 640x480 RAW/ACT backdrop, a FOG record, and one ZTH depth thumbnail. This confirms that an ordinary Nocturne scene is not an MTM-style live-rendered track. `TGROUND.POD` is the exceptional MTM2-compatible track used by one scene.

Mission scripts, the ZTH depth scale, and EFD/LZW decompression remain open. They need further evidence before receiving stronger semantic APIs.
