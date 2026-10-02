# Roadmap: one format implementation for every tool

JSPod, JSTruckViewer, JSMTM2Converter and JSTrackViewer each grew their own readers for the same Terminal Reality formats, as forks of shared ancestors that then drifted. The goal is for all four to use OpenPhotex for format knowledge and keep only what is theirs: user interface, rendering (Three.js), OPFS and worker plumbing, and application policy.

## Where the format code is today

Line counts in the table are the number of changed lines between copies (`diff -w`, blank lines ignored). 0 means the copies are identical.

| Format | JSPod | JSTruckViewer | JSMTM2Converter | JSTrackViewer | Divergence |
|---|---|---|---|---|---|
| POD1, POD2, EPD | **OpenPhotex** | **OpenPhotex** | **OpenPhotex** | **OpenPhotex** | |
| RAW, ACT, OPA | **OpenPhotex** | **OpenPhotex** | **OpenPhotex** | **OpenPhotex** | |
| TIFF (Evo textures) | **OpenPhotex** | **OpenPhotex** | **OpenPhotex** | **OpenPhotex** | |
| SMF (Evo models) | **OpenPhotex** | **OpenPhotex** | **OpenPhotex** | **OpenPhotex** | |
| Evo TRK (vehicle manifest) | | **OpenPhotex** | **OpenPhotex** | | |
| Evo SIT, LVL, WAT, TEX, VEG | | | **OpenPhotex** | **OpenPhotex** | |
| MTM TRK (truck manifest) | | **OpenPhotex** | | **OpenPhotex** | |
| CPR CMD, CAR (car models) | CMD (adapter ready) | **OpenPhotex** | | | |
| BIN (MTM/TV/F3/HB models) | **OpenPhotex** (+ rendering) | **OpenPhotex** | **OpenPhotex** (writer) | **OpenPhotex** | |
| BinaryReader | removed | removed | | removed | |
| MTM/CPR SIT, TV/F3/HB LVL, DEF, NAV, PUP, TDF, ANI, CPR TRK/TTX, terrain | | | | **OpenPhotex** | |
| Palette choice (which .ACT), bundled palettes | **OpenPhotex** | **OpenPhotex** | | **OpenPhotex** | |
| Writers: BIN, RAW/ACT, MTM2 SIT/LVL/TEX/LTE/TRK, level palette, fog map | | | **OpenPhotex** | | |
| Nocturne DFM, SKL, KFM, CTH, SET, GEO, FOG, THM, ZTH | **OpenPhotex** (+ DFM/KFM rendering) | | | | New native readers |

## Principles for every extraction

These are the same rules the POD and RAW/ACT extractions followed.

1. **Choose the baseline.** Read every copy and use the most advanced one. Behaviour the other copies have that it lacks is merged in only with evidence from stock data.
2. **Neutral data out.** OpenPhotex returns typed arrays and plain objects, never Three.js geometry. Rendering stays in the consumer.
3. **Prove equivalence.** Before a consumer switches, decode every stock file of that format with both the old code and OpenPhotex and compare the results byte for byte. Any difference is explained and documented, or fixed.
4. **Thin adapters.** Consumers keep their exported function names, so call sites don't change, and delegate to the vendored OpenPhotex.
5. **Consumer-only concerns stay put.** Rendering, OPFS, UI and game-specific policy remain in the consumer until a second consumer needs the same policy. (The four stock palettes moved in Phase 5, when three consumers carried the same copies.)
6. **Document the evidence.** Every format gets a `docs/<FORMAT>.md`, and the CLI gains an inspection command when that helps agents.

## Phases

### Phase 1: move every consumer onto the existing POD and RAW/ACT support
- **JSPod:** POD and EPD reading, RAW/ACT decoding. This also brings JSPod up to the evidence-based 6-bit palette rule.
- **JSTruckViewer:** POD reading, RAW/ACT decoding.

### Phase 2: 4x4 Evolution data
- **Level data:** LVL, TEX and VEG, which are identical in the converter and JSTrackViewer, and SIT, which has diverged by 35 lines.
- **SMF models:** four copies, two of them identical.
- **TIFF textures:** four copies.
- **Evo TRK vehicle manifests:** JSTruckViewer and the converter.

### Phase 3: truck and car manifests
- **MTM TRK:** JSTruckViewer's copy is the baseline, merged with JSTrackViewer's.
- **CPR CMD and CAR:** JSTruckViewer and JSPod.

### Phase 4: BIN models
Merge the three decoders into one neutral model: vertices, faces, UVs, materials, animation frames and the model's own metadata. JSPod's `bin-preview` and each viewer's Three.js code stay in the consumers. This is the largest step and must be proven against every stock `.BIN`.

### Phase 5: JSTrackViewer's formats
MTM/CPR SIT, TV/F3/HB LVL, DEF, NAV, PUP, TDF, ANI and keyframes, CPR TRK/TTX, and the terrain representation. These have one implementation already, so extraction is about making them available to OpenMTM2 and the other tools. Palette choice is also consolidated here, by comparing JSPod's and JSTrackViewer's resolvers.

### Phase 6: writers
The converter's BIN, RAW/ACT, and MTM2 SIT/LVL/TRK writers. Each writer is checked by round-tripping through OpenPhotex's readers.

## Status

| Phase | Status |
|---|---|
| POD, RAW/ACT in OpenPhotex; JSTrackViewer and JSMTM2Converter migrated | done |
| 1: JSPod and JSTruckViewer on OpenPhotex POD and RAW/ACT | done |
| 2: 4x4 Evolution SIT, LVL, WAT, TEX, VEG, SMF, TIFF and TRK; all four consumers migrated | done |
| 3: MTM TRK, CPR CAR and CMD; JSTruckViewer and JSTrackViewer migrated (JSPod's CMD adapter waits for its untracked file) | done |
| 4: BIN models; JSTrackViewer, JSTruckViewer and JSPod migrated (BinaryReader no longer needed anywhere) | done |
| 5: MTM/CPR SIT and LVL, CPR TRK/TTX, TV/F3/HB LVL, DEF, NAV, PUP, TDF, ANI, briefings, terrain, ground boxes, Hellbender cavern, sky; palette ranking and bundled palettes; JSTrackViewer, JSPod and JSTruckViewer migrated | done |
| 6: BIN, RAW/ACT, MTM2 SIT, LVL, TEX, LTE, ground-box grids and TRK writers, level palette and fog map; JSMTM2Converter migrated, output byte-identical | done |
