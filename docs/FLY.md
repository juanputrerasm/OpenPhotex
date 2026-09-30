# Fly! data

What the stock Fly! (1999) EPD archives contain, as far as it is understood. OpenPhotex reads the archives themselves (see [POD.md](POD.md)), the textures (`.RAW` with a same-stem `.ACT`) and the `.BIN` models, and the scenery formats below through `src/fly/`:

| Reader | Reads |
|---|---|
| `parseFlyTagged`, `parseFlyAngle` | the tagged text all the text formats share, and its latitude/longitude spellings |
| `parseFlyScf` | a set's `.SCF` manifest |
| `parseFlySceneryObjects` | `SCENERY.Sxx` object placements |
| `parseFlyQuadrant` (`parseFlyAlt`, `parseFlyTyp`, `parseFlyTex`, `parseFlyRef`, `parseFlyAl2`) | a quadrant's terrain files |
| `flyRowLatitude`, `flyTileBounds`, `flyTileAt`, `parseFlyTextureName` | the globe tile grid and texture names |

The sectional charts, `.BSP` and `.GTP` have no reader.

The evidence is the stock install: `Maps\SC01.EPD` to `SC37.EPD`, and the five scenery sets `Scenery\SANFRAN`, `LA`, `NEWYORK`, `CHICAGO` and `DALLAS`. Unless noted, examples come from San Francisco.

## Sectional charts (`Maps\SCnn.EPD`)

Each archive holds one or two FAA VFR sectional charts (`SC24N`, `SC24S`: north and south halves of the Los Angeles sectional). A chart is:

| Entry | Content |
|---|---|
| `MAPS\<prefix>.ACT` | the chart's palette |
| `MAPS\<prefix>.MAP` | text description, below |
| `MAPS\<prefix><n>.RAW` | 256x256 image tiles, numbered from 1 |

The `.MAP` file is tagged text, one tag per line followed by its values:

```
<bgno> ----begin map ----
<name> ---- map name ----       Los Angeles Sectional Chart - North
<size> ---- size in pixels ---- 4996 / 1592
<tile> ---- tile size in pixels ---- 256
<prfx> ---- tile prefix ----    Sc24N
<type> ---- map type ----       1
<area> ---- coverage area ----  34 17'N / 120 10'W / 36 00'N / 115 00'W
<grid> ---- lat lon grid map ---- 13 / 4
<bgno> ---- grid entry ----
    <mpll> ---- lat lon ----    36 00'N / 121 30'W
    <mpxy> ---- x y ----        100 / 77
<endo> ---- end entry ----
...
```

The grid entries tie latitude/longitude to chart pixels (13 columns by 4 rows here), so a position can be placed on the chart by interpolation. The tiles are numbered from 1, row by row from the top left: `ceil(width / 256)` per row.

## Scenery sets

A set is a folder holding a manifest and seven archives:

| File | Content |
|---|---|
| `<SET>.SCF` | tagged text manifest: name, coverage area, load area and the EPD list |
| `<SET>1.EPD` to `<SET>4.EPD` | terrain, one globe tile per archive, plus the textures of its detail cells |
| `<xx>MODELS.EPD` | `.BIN` models, `.BSP` structures, their textures and the object placement files |
| `<xx>COASTS.EPD` | coastline data (`.GTP`) |
| `<xx>NIGHT.EPD` | night light textures |

`SANFRAN.SCF`:

```
<bgno> ==== BEGIN SCENERY FILE ====
    <name> San Francisco
    <call> coverage area lower left    36 43 17.33 N / 123 45 00.00 W
    <caur> coverage area upper right   38 57 32.71 N / 120 56 15.00 W
    <ldll> load lower left             35 34 39.87 N / 125 09 22.50 W
    <ldur> load upper right            40 03 09.29 N / 119 31 52.50 W
    <file> sanfran1.epd  (and six more)
<endo>
```

Every coverage area is exactly 2x2 globe tiles, and the load area adds one tile on every side.

### Globe tiles

Terrain lives in folders `DATA\Dxxxyyy\`, one per globe tile:

- `xxx` is the longitude column: `(lon + 360) / 1.40625`, so 256 columns around the world. San Francisco's `D168156` starts at 123.75 W.
- `yyy` is the latitude row. Row 128 starts at the equator, and each row is 1.40625 x cos(its southern edge) degrees tall, so row `k + 1` starts at `lat(k) + 1.40625 * cos(lat(k))`. This reproduces every tile edge named in the five `.SCF` files to within 0.01 arcseconds (row 152 starts at 32.0496 N, row 158 at 38.9591 N).

A globe tile is 64x64 cells, about 2 km each at these latitudes. It is stored as four quadrants of 32x32 cells, `G00`, `G01`, `G10` and `G11`: the first digit is the column half counted from the west, the second the row half counted from the south.

### Quadrant files (`G<x><y>.*`)

| File | Content |
|---|---|
| `.ALT` | 33x33 little-endian float32 corner heights in feet, column by column: index `x * 33 + y`, with `x` counted from the west and `y` from the south |
| `.TYP` | text, 1024 lines, one per cell: `type:<k>: <n>,<n>` |
| `.TEX` | text: a count, then that many texture file names |
| `.REF` | text: indices into the `.TEX` list, below |
| `.AL2` | text: extra heights for subdivided cells, below; empty for flat quadrants |

Every file is column-major: cell `i` is at `x = floor(i / 32)`, `y = i % 32`, as `.ALT` is. The texture names prove it for `.REF` (next section): in all 80 stock quadrants, every one of the 37,842 named textures a cell uses names that very cell.

The `.TYP` kinds seen are:

| Line | Meaning |
|---|---|
| `type:0: 1,1` | a plain cell |
| `type:1: 2,2` or `4,4` | the cell's surface is subdivided 2x2 or 4x4; its `(n+1)x(n+1)` heights are in `.AL2` |
| `type:2: 2,2` | subdivided 2x2 as above, and also given a 2x2 block of sub-textures in `.REF` |

`.REF` has one line per cell, holding one texture index. After the line of a `type:2` cell come two more lines of two indices each, the 2x2 sub-textures, also column-major: the first line is the western column (south, then north). `-1` means none, and the cell's own texture shows. In `SANFRAN1.EPD`'s `D168156\G11` this gives 1024 single lines plus 9 x 2 pair lines, matching its 9 `type:2` cells.

`.AL2` holds one block for every cell whose kind is not 0 (kind 2 included), in cell order: `n + 1` lines of `n + 1` space-separated decimals, 5x5 for a 4x4 cell and 3x3 for a 2x2 one. A block is column-major too (each line is one x), and its corners repeat the cell's `.ALT` corners, which is how the orientation was fixed. A quadrant with no subdivided cells has an empty `.AL2`.

### Terrain textures

Terrain textures are 128x128 `.RAW` files, each with its own `.ACT`, and are satellite imagery. Their names are hexadecimal numbers that encode their place: `643A9672` is 1681561202 in decimal, which reads as globe tile `168156` and cell `1202`, where the cell number is `rowFromSouth * 64 + columnFromWest` (here row 18, column 50).

Placing every texture of the four San Francisco tiles by its name alone gives a seamless picture of the Bay Area, correctly oriented, which confirms the reading. Note that the texture numbering is row-major while `.ALT` is column-major.

The `.ALT` layout was checked against known summits. Sampled at the nearest grid points, it gives Mount Diablo 2624 ft (3849 real), Mount Tamalpais 2396 (2571), Mount Saint Helena 3656 (4342) and Mount Hamilton 3740 (4265), and 0 on the open ocean. The row-major reading and the other quadrant order put Mount Tamalpais and Montara Mountain at 0. The peaks read low because the grid points are about 2 km apart; `.AL2` refines some cells.

Sub-folders such as `DATA\D168156\D061050\` are detail folders: `D<x><y>` names the `type:2` cell they refine, here cell (61, 50) of the tile. They hold that cell's 2x2 sub-textures, named by the same scheme with the detail folder in place of the tile: `24637DA0` is 0610500000, folder `D061050`, index 0, and its neighbours are 0001 (x 1), 0064 (y 1) and 0065.

Cells outside a set's photographed area name generic textures, `wt000s1.raw` to `wt888s4.raw`, which are in no scenery archive; presumably they ship with the game itself. The three digits run 0 to 8 and look like terrain classes: 0 is water (on San Francisco, `wt000` cells are water where the coastline map says so in 4,961 of 5,459 cases), and the other digits are kinds of land whose meaning is unknown (`wt444` across the Mojave, `wt888` around New York, `wt555` around Dallas). Mixed names such as `wt550` sit on shorelines. The `s1` to `s4` suffix is presumably a variant.

Outside the photographed area the heights are mostly 0 as well: the sets carry real relief only where they carry imagery.

### Objects

`DATA\Dxxxyyy\SCENERY.S<r><c>` (in `*MODELS.EPD`) places the objects of one quadrant. It is tagged text:

```
<wobj> mobj
<bgno>
    <geop> 37 54'43.8401"N / 122 22'41.5354"W / 139.93359375   (latitude, longitude, altitude)
    <type> mobj
    <flag> -2147483339
    <detl> 1
    <id  > mobj2
    <name> Blue Gas Tank
    <mmgr>
    <bgno>
        <simu> comp
        <modl> comp / BLUTANK.BIN
    <endo>
    <iang> 0.000000,0.067196,0.000000   (orientation, apparently radians)
<endo>
```

Across the five stock sets there are 1,580 objects in 24 files. The `<wobj>` kind is `mobj` (a model, 1,456), `becn` (a beacon, 43, with a `<lens>` value) or `wdsk` (a windsock, 81). An `<mmgr>` block (and, three times, `<nmgr>`) lists the object's models in one of two forms:

- `<modl>` with a part name and a file: `comp` for a whole model, or `pole`, `sck1` ... `sck4` for the parts of a windsock.
- `<mdst>` with a part name, a file and a distance range: the Golden Gate Bridge is `GOLD1.BSP` from 0 to 14000 and `GOLD2.BSP` from 14000 to 1000000.

The files are `.BIN` (2,013), `.ARM` (54, beacons and the like, not decoded) and `.BSP` (22).

`D168156\SCENERY.S11` places 118 objects. The `.BIN` models are MRGL models that OpenPhotex's `parseBin` reads, all 100 in `SFMODELS.EPD`. They take their texture from shared atlases such as `SANFRAN1.RAW`. Larger structures such as bridges are `.BSP` files, a tagged binary format starting `<bgno>\0<vbin>\0`, which is not decoded.

### Coastlines

`*COASTS.EPD` holds `T\H<tile>.GTP` for the globe tiles that have a coastline (four in San Francisco, not every tile elsewhere), and many small `T\T<hex>.GTP` files that look like coastline shapes.

`H<tile>.GTP` is 4096 bytes, one per cell, row-major from the south-west corner: index `y * 64 + x`, unlike the quadrant files. The values are 1 land, 2 water and 3 coast; San Francisco's traces the Marin and Sonoma shore and the Farallon Islands. The `T` files are not decoded.

## Open questions

- Whether cells are equal subdivisions of their tile in latitude (assumed).
- The units of `<geop>` altitudes and the `<iang>` axis order.
- The `.BSP` format, the `T*.GTP` coastline shapes and the `<flag>` bits.
- Where the generic `wt*.raw` textures come from, and what their digits mean.
