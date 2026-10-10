# MTM2 game data files

Small text files Monster Truck Madness 2 reads besides its levels and trucks. Each reader
follows how MONSTER.EXE 2.00.42 reads the file (routine addresses in brackets); the stock files
are checked in `test/stock.test.ts`.

## `.KLP`: loop points (`parseKlp`, 0x524730)

Beside a `.WAV` in `SOUND\` (SOUND.POD, MUSIC.POD): when the game loads a sample, it looks for
the `.KLP` of the same stem. Whitespace-separated integers:

| Type | Then | Meaning |
|---|---|---|
| 0 | | no loop |
| 1, 2 | `start end` | one loop; the game keeps `end - 1` |
| 3 to 6 | `count`, then `count` lines `end start` | 1 to 20 loops (note the order) |

An end of 0 or less means "to the end of the sample". The game drops the loop points when a
start is negative or past the sample's length, an end is past it, or a single loop is shorter
than 200. Types 1, 3 and 4 set playback mode 1, types 2, 5 and 6 mode 2, and types 4 and 6 a
flag; what the modes and the flag do is not traced yet. `parseKlp` returns `null` where the game
would ignore the file, and leaves the length checks to the caller, who has the WAV.

Stock: 32 files. 26 are type 1 (most `1 0 0`, a whole-sample loop; engine idles start partway,
`IDLE2M1.KLP` at 86339); six are type 3 with 4 to 9 loops (engine acceleration, helicopter,
jungle, rain, train).

## `SOUNDnnn.TXT`: a level's ambient sounds (`parseMtmAmbientSounds`, 0x42a1a0)

`DATA\SOUNDnnn.TXT` in SOUND.POD, where `nnn` is the SIT's ambient sound number (the first value
of `!ambient sound,track length,weather mask`). Positional, a label line before each value:

```
checkpoint wav file          airhorn.wav
finish lap wav file          check2.wav
number of one-shots          n, then the column labels and n lines
    wavName, vol, timerMin, timerMax, weatherMask
number of looping sounds     m, then the column labels and m lines
    wavName, vol, weatherMask
```

One-shots play at random intervals between `timerMin` and `timerMax` seconds. A weather mask
has one bit per weather state, bit 0 Clear to bit 8 Pitch Black (`weatherMaskIncludes`): 511 is
every weather, 64 Dusk only, 384 Night and Pitch Black.

## `SUN.TXT`: sun and lens flare (`parseMtmSun`, 0x578a50)

`DATA\SUN.TXT` in STARTUP.POD, loaded only in Clear and Cloudy weather. Positional, each value
after a `//` comment line: type (0 point, 1 offset), the initial position `x,y,z` in 1/256 ft,
the master radius (a radius that fills the screen), the layer count and layers
(`texture, axis position, radius, texX1, texY1, texX2, texY2`, no comments between them), then
the ray count and rays (`x, y, z` in 1/256 ft, the points tested for the sun's visibility).
A layer's axis position places it on the line from the sun through the screen centre.

## `.LOC`: TRI Message System (`parseLoc`, 0x522f50)

`UI\MTM2-FUN.LOC` (93 joke wordings) and `UI\MTM2-PIG.LOC` (142, Pig Latin) in UI.POD. The
first three lines must be `TRI Message System`, `256`, `LOC`. Then `@@TAG` (the message as the
game writes it), `@@STRING` (the replacement) and `@@COMMENT` (ignored) blocks of one or more
lines, joined with `\n`, until `@@END`. A pair is kept when the next `@@TAG` or the end arrives.

## `POWERBIG.200`, `.400`, `.480`: cockpit layout (`parseCockpitLayout`)

`DATA\POWERBIG.<screen height>` in COCKPIT.POD. Each value or group follows a `;` comment
naming it; the three stock files share the same 28 comments. `parseCockpitSections` keeps them
as written, and `parseCockpitLayout` reads them in order: background images, the 3D window,
speedometer and tachometer (centre, radius, needle model, zero angle, degrees per mph or rpm,
face redraw rectangle), steering wheel and erase rectangles, the steering wheel base name, the
mirrors (location, angles, translation, zoom, bitmap rectangle and name), the shifter and the
shift light. The game's reader is not traced yet; the mirror's angles (0, 0, 32768) and zoom
(49152) suggest 1/65536 turns and 16.16 fixed point.

## `.rpl`: instant replays and demos (`parseMtmReplay`, `writeMtmReplay`, 0x565050, 0x5659f0)

The engine's record of a race, as CRLF text (`core/Demo.c`): `demoLevel`, the track, `weather`,
`vehicleCount` and a truck file and driver name per vehicle, `detailLevel`, `demoRecordPtr` and
`demoRecordCount`, `Original object locations` with each SIT box's x, y, z, theta, phi, psi, then
records every 0x4000 ticks (0.25 s; time is in 1/65536 s). A `type,time` line starts a record, then
label and value pairs: type 0 a vehicle (position, body velocity, angles, rates, number, steering,
four tire angles, throttle and brakes and course segment, damage code and gear), type 1 an object
(the same up to the number). The game's ring holds 2240 records. See JSTrackViewer's
`docs/MTM2_REPLAY_FORMAT.md` for measurements made from replays.
