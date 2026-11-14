# The MTM2 simulation (`mtm2Sim`)

`src/sim/mtm2/` reimplements how Monster Truck Madness 2 (MONSTER.EXE 2.00.42) moves trucks.
It is exported from the package root as the `mtm2Sim` namespace:

```js
import { mtm2Sim } from "openphotex";
const terrain = mtm2Sim.createTerrain(rawHeights, waterFt);
const h = mtm2Sim.groundHeightAt(terrain, x, z);
```

The rules come from OpenMTM2's `docs/MTM2_PHYSICS.md` and `docs/MONSTER_EXE_ANALYSIS.md`, which
were read from the game's code. Nothing here is fitted to recordings. Section references in
the sources (`§n`) point into those documents.

Like the rest of OpenPhotex, the module is portable: no DOM, worker or Node APIs, and only
plain arrays and objects, so a state can be posted between workers or saved as it is.

## Frame and units

- Feet, seconds, radians; weights in pounds, masses in slugs (`G` = 32.174).
- World y is up. Body axes: x right, y up, z forward.
- Orientation is `theta` (pitch about x), `phi` (roll about z), `psi` (yaw about y), and the
  body-to-world matrix is `M = Ry(psi) Rx(theta) Rz(phi)`, row-major (`eulerToMatrix`).
- Headings are `atan2(dx, dz)`: 0 faces +z, pi/2 faces +x.
- Game time is 16.16 fixed point (`secondsToFixed`).

## What is there

| File | Contents |
|---|---|
| `constants.ts` | every number, with its source section |
| `math.ts` | rotations, body/world transforms, angle wraps; no allocation |
| `time.ts` | 16.16 fixed-point seconds |
| `world/terrain.ts` | the 256 x 256 grid of 32 ft cells, checkerboard triangles (rows along z), wrap at 8192 ft, triangle normals, Snow freezing water |
| `world/surface.ts` | texture to `.TTY` type, water below the level, friction, drag density, tire grip |
| `world/water.ts` | the water level and its 8 s, +-1 ft bob |
| `world/course.ts` | the driven course: SIT straights plus the arcs, bank and corner speeds the game builds at load time |
| `world/checkpoints.ts` | checkpoint gates and their enlarged detectors, the pretest, direction and crossing-time rules; the footprint rule that makes a type 0 box inside a gate's full width and length type 11 (`checkpointFootprintType`, retail 0x552a93, CP4 0x1403ba223, not in Summit Rumble), which a computer truck does not bring into the object list (`listedByComputerTruck` in `collide/box.ts`, retail 0x554802, CP4 0x1403b39c0) |
| `truck/params.ts` | per-truck constants, the 11.6 ft wheelbase clamp, springs from sag, transfer ratio, grip and torque gains |
| `truck/state.ts` | the dynamic state |
| `truck/controls.ts` | keyboard pedals and steering, including automatic Reverse |
| `truck/drivetrain.ts` | torque curve, rpm targets, drive force, the gearbox |
| `world/ground.ts` | the ground a truck queries: height, normal, surface value (terrain only for now) |
| `world/road.ts` | not MTM2's: triangles laid over a ground that are the ground where they cover it (`createRoadGround`), for CART Precision Racing's road layer and 4x4 Evolution's rocks and decks. `below(limit)` is the same ground for one body, counting only what is at or under a height, so a deck over a truck is not its ground and one under it is |
| `truck/dynamics.ts` | `stepTruck` (tire geometry, loads, longitudinal and lateral forces, drag, damping, sums, integration, contact probing) and `postStepTruck` (push-out, wheel probes, solid axles, bottoming) |
| `truck/contacts.ts` | hull contacts: support split for 1 to 4 contacts, recovery, friction |
| `truck/recovery.ts` | the stuck timer, the player reset, the helicopter lift-off and flight, the Helicopter key |
| `truck/water-drag.ts` | `fluidAreas`: density times area per body axis from submerged wheels and hull faces, the rest at air density; the splash flag |
| `truck/object-support.ts` | the game's in-water rule for the sounds (`inWaterForSound`, retail 0x41bbd0: a hub under the water there, or a tire on the ground on 300 or 1300); and a host choice that is not the game's, StepContext `dryOnObjects` (OpenMTM2's): a tire held up by anything but the terrain reads Default (0) in place of the terrain's water or deep water (`tireOnObject`, `objectSurfaceValue`) |
| `collide/truck-pair.ts` | what the truck-box pair tests share: the contact record, the pushable force law, last step's hubs |
| `../cp4/rules.ts` | Community Patch 4's rules (`CP4_RULES`, `CP4_CLASSIC_RULES`, `cp4Substeps`) |
| `../cp4/coll-shape.ts` | CP4's collision shapes: k-DOP hull test, grid, ray, tire-cylinder and point queries |
| `../cp4/truck-tri.ts` | CP4's truck against a box's triangles: hull points, the nine-spoke support, cylinder and hold, walls, phantom corners |
| `../cp4/surface-mesh.ts` | CP4's .SRF grip: the typed model face under a tire (`withSurfaceMeshes`, `Mtm2Ground.tireSurface`) |
| `../cp4/falls.ts` | CP4 beta 0.53's waterfall build from a .WFL: validation, the walk, the sheet and foam mesh, mist, sound, looks (never read by the step) |
| `../../model/coll-soup.ts` | a .BIN's faces as a collision triangle soup |

A step is `applyKeyboard` (or the autopilot), `stepTruck`, then (after collisions)
`postStepTruck`. Still to come, in OpenMTM2's plan order: ground boxes and ramps in
the ground, collisions, the autopilot and the race rules.

## Notes on fidelity

Where the original does something surprising, the code does it too and the source says so:

- keyboard rates run at about half their stored values (the frame time is scaled by 0x7fff / 0x10000);
- without automatic shifting, releasing the accelerator keeps the throttle;
- the engine rpm is pulled once per tire per step, four times;
- ground at exactly 0 ft (in 1/256 ft, floored; in Snow after the bed is raised to the water level) is Default,
  surface 0, whatever its texture and whether or not water is over it: the game sets that height apart (`0x502210`
  returns 3) and reads its type past the end of its table, into memory that is always zero (`0x503060`);
- ground above 0 and at or below the water level reads deep water;
- an axis-aligned line in the course intersection takes the game's shortcut;
- the two-contact support split is the reverse of the lever rule, and sliding friction uses
  |vt + v|;
- the lateral tire force acts at the axle's height, about the CG at rest.

The tests (`test/sim-mtm2-*.test.ts`) check the formulas against hand-computed values;
`test/stock.test.ts` builds every stock course and checks that each arc meets its straights.

## Community Patch 3's AI Speed

CP3 (OpenMTM2 `docs/CP3_EXE_ANALYSIS.md` section 5) scales the computer trucks by its AI Speed setting, a percent from
70 to 130. The library takes the factor (`aiSpeed / 100`, default 1) in two places, and the caller passes it for
computer trucks only:

- `AutopilotContext.aiSpeed`: `applyAutopilot` multiplies the target speed by it last, after the 17 ft/s floor and the
  segment's speed limit;
- `StepContext.aiSpeed`: `deliveredTorque` multiplies a computer truck's torque by it (never a human driver's).

## Crash damage

`truck/damage.ts` holds the rules of `core/TruckDmg.c` (OpenMTM2 `docs/MONSTER_EXE_ANALYSIS.md`
section 10): `damageLevelForForce` (0, then 1 up to 10000 lb, 2 up to 30000, 3 above),
`recordZoneHit` (a zone's two bits of the damage code only rise), `zoneDent` (push radius and
direction of each of the 12 hull-point zones) and `dentVertices`, which pushes the vertices of a
model near a zone's point, in feet, by `dentUnits(level)` model units (1/256 ft). The simulation
itself does not change; callers sample the hull points' contact depth after `postStepTruck`.

## Rules of the 1996 game

Monster Truck Madness 1 (version 1.00) runs the same vehicle model. `constants.ts` names the
differences read from its executable (OpenMTM2 `docs/MTM1_MONSTER_EXE_ANALYSIS.md` 4.3) as a set of
rules, `Mtm2Rules`: `MTM2_RULES` (the default everywhere), `MTM1_RULES`, and `simRules(id)`.

| Rule | MTM2 | MTM1 |
|---|---|---|
| `waterDragDensity` | 0.15 | 1.0 |
| `deepWater` (ground below the water level reads type 13, or ice in Snow) | yes | no |
| `weatherGrip` (Rain 0.8, Snow 0.6) | yes | no |
| `crashDamage` (for the host to honour) | yes | no |
| `wheelImpact` (a tire against a tire: the velocity the force is made from) | half the relative velocity | per axis, the relative velocity unless the faster point's own is smaller |
| `wheelSpinClimb`, `wheelSpinNeedsGround` | 0.05, tires on the ground | 0.1, always |

A ground carries its rules (`createTerrainGround(..., rules)`, `Mtm2Ground.rules`; a host that
wraps a ground sets the field on its own), and `collideTrucks(a, b, dt, rules)` takes them.

A road ground's per-truck view (`createRoadGround(...).below`) passes on the road ground's `rules`,
else its base's.

## Community Patch 4's rules

Community Patch 4 (CP4 beta 0.52, monster.exe 2.0.52.2) runs MTM2's vehicle model unchanged and adds a fixed tick,
some clamps, computer-truck grip and a triangle collision solver (OpenMTM2 `docs/CP4_EXE_ANALYSIS.md` 10 and 11, read
from the executable; its author published no source code). `src/sim/cp4` holds them as rules over this module:
`CP4_RULES` (triangles, `collisionMode` 1) and `CP4_CLASSIC_RULES` (box faces, `collisionMode` 0, the clamps kept).
Every field is optional on `Mtm2Rules`; absent is MTM2's behaviour, so MTM2 and MTM1 are unchanged to the bit.

| Field | CP4 | Effect |
|---|---|---|
| `tickS`, `substepS` | 0xa3d / 65536 s, 0.01 s | for the host: one step per 40 ms tick, or `cp4Substeps(rules, true)` steps of 10 ms (online, or `simSubstepOffline`) |
| `suspVelMaxFtPerSec` | 20 | the axle solve's extension rate clamped, which the damper reads |
| `terrainComprMaxFt` | 6 | the post-step's terrain wheel penetration capped (values between 0 and 1 read 1, above 500 read 500) |
| `restNeedsContacts` | 3 | the rest freeze needs that many ground contacts, wheels down plus `contactCount` |
| `surfaceAtPoint` | yes | the tire's surface is asked at its bottom, and the ground's lake test uses the queried height |
| `aiGrip` | 1.3 | a computer truck's `mu` times this, offline (`StepContext.online` false) and outside drag races |
| `dragCpuGrip`, `dragCpuSteerSlew` | 1.5, 1.5 | in a drag race (`StepContext.dragMode`, `AutopilotContext.dragMode`): a computer truck's grip limit, and its autopilot's steering slew |
| `sonicTireCf`, `sonicStraightBrake`, `sonicCurveSpeed` | 3, 0.45, 1.25 | the Sonic values of the grip constant (step and autopilot), the straight's brake factor and the curve speed factor |
| `impulseCap` | yes | the hull solver's recovery capped at the force that stops the closing speed, `m max(0, -n.v) / dt` |
| `bottomPropShare`, `smallPropRatio` | 0.4, 2 | bottoming cancels 0.4 of its usual share on a prop shorter than 2 tire radii |
| `offCentreCollision` | yes | for the host: a box model whose vertical centre is further from its origin than its height gets its box moved onto it |
| `collisionMode`, `triangles` | 1, `CP4_TRIANGLES` | boxes with a usable `SimBox.shape` collide by their triangles |

**Triangle collision.** A level box (not a ground box, `type` not -1) whose `shape` passes `shapeUsable` (k-DOP volume of
at least 1e-4 ft^3, more than 3 hull vertices, a grid within CP4's limits) is tested by `sim/cp4/truck-tri.ts` in place
of the four box-face routines of `collide/truck-box.ts`: hull points 1 to 12 as rays against the triangles; the
wheel's support from nine spokes (gate n.y > 0.5 in the truck frame, depth along body y, the wheel's circle profile,
deepest wins), then the tire cylinder, then a three-tick hold, capped at 2 ft on small props; the tire's wall from nine
rays (a drivable face under a supported tire is a spring, not a wall; climb blend; at most 1 ft, times 0.3 each tick);
and the box's corners against the wheels without the phantom corners (more than 3 ft from every triangle). Box
against box casts the mover's corners at the base's triangles (`boxOnTri`). The rest of the contact model is
MTM2's: the deepest support wins at the tire, then the post-step and the hull solver. `collideTruckBox`,
`collideTruckImmovableBox` and `collideBoxes` take the rules as an optional last argument; without it every box is
a box. A tire's `supportSource` (1 terrain, 2 box or ramp, 3 triangle prop) and `propHeight` record what holds it up.

**Shapes.** `binCollisionSoup` fans a .BIN's faces in the game frame, as CP4 does. CP4 also reads eight facet opcodes
`parseBin` strides over (7, 8, 21, 26, 27, 30, 33, 56); none occurs in the 2,277 models the BIN walk was checked on.
`buildCollShape(positions, surfaceTypes)` takes the triangles in the box's frame about its position. CP4's on-disk
shape cache is speed only and is not kept.

**Surfaces.** `withSurfaceMeshes(ground, boxes)` gives a ground `tireSurface`, which the tire step prefers to
`surface`: a ray from 4 ft above the point 10 ft down into the boxes' typed faces (up component at least 0.25, the
hit nearest the point's height), the terrain where the hit is more than 1/4 ft under it and the terrain is nearer. Only the
first `limit` boxes count, in their order: 64 by default, as CP4 keeps them (`MAX_SURFACE_BOXES`); a host may pass more
(`withSurfaceMeshes(ground, boxes, { limit: Infinity })`).

**Not here.** CP4's tree collisions (vegetation collide 1 and 2) are the host's walls, as before; how CP4's trunk
cylinder meets a truck is not traced.

## Community Patch 4 beta 0.53 waterfalls

Beta 0.53 adds waterfalls (`WORLD\<stem>.WFL`, read by `parseWfl`, docs/LEVELS.md). The file holds only crests; the
engine builds each fall's sheet at load by walking water from the crest over the terrain into the water. `src/sim/cp4/falls.ts`
is that build, from OpenMTM2 `docs/CP4_EXE_ANALYSIS.md` 12 (read from monster.exe and trid3d11.dll; the CP4 author
published no source code). Section numbers below are that document's. Falls never touch the simulation (12.10): this
is load-time geometry and parameters for a renderer, sound and fog. Exported from `cp4Sim` and the package root.

```js
import { parseWfl, parseWtr, decodeMtm2Heights, buildFallMeshes, fallGround, fallWater, fallMist, fallSound } from "openphotex";
const wtr = parseWtr(wtrBytes);
const m = buildFallMeshes(parseWfl(wflBytes).falls, {
  ...wtr,                                        // lakes + tileMap, for the validation
  ground: fallGround(decodeMtm2Heights(rawBytes, txv.terrainGrid)),
  water: fallWater(wtr, lvl.waterHeight === null ? null : lvl.waterHeight * 0.5),
});
// m.vertices (Float32Array, 16 floats a vertex), m.indices (Uint32Array, global), m.falls, m.refused, m.dropped
const mist = fallMist(m.falls[0], m.falls[0]);   // or null
```

| Function | Does |
|---|---|
| `readFallFile(bytes, { cells })` | the engine's parser (12.1.2), which never throws: `status` 0..7 (`FALL_FILE_STATUS_TEXT` names those the "damaged (%s)" message shows, 12.1.3; 4 is the "newer build" one), only the first FALL entry, the count clamped to the chunk (`counters.truncated`), and bad records kept for `checkFallRecords` (a point count outside 2..8, a name without a NUL), where Traxx's `parseWfl` refuses the whole file |
| `checkFallRecords(falls)` | the parser's record checks (12.1.2) in its order: id 1..255 and unique (taken before the later checks), 2..8 points, coordinates below 0x20000, speed 16..1600, height 1..4096, flags within 7, names within 15 characters, 64 accepted (`over`); opacity clamped to 100, mist and volume to 200. Returns the accepted records, the rejected ones and the counters |
| `validateFall(fall, { lakes, tileMap })` | null or the REFUSED reason (12.1.4) in the engine's order: `FALL_POINTS` (a segment under 2 ft, wrapped differences), `FALL_TURN` (consecutive segments with a negative dot), `FALL_WIDTH` (crest over 1024 ft), then for a lake-fed fall `FALL_SOURCE` (no loaded lake with that id), `FALL_HEIGHT` (stored height not exactly the lake's), `FALL_DIRECTION` (some point's 1 ft probe behind the crest, nudged up to 0.5 ft along an adjacent segment, is not on a source-lake tile) |
| `fallGround(heights)` | the walk's ground (12.2.3) from `decodeMtm2Heights`: terrain only, the engine's integer triangles on v >> 1 at 1/64 ft, times 4, 16.16 fractions, `(a * b) >> 16`, the parity split; the 32 ft grid for classic, the 1024 x 1024 8 ft grid for spline and Full Map. `fallTerrainHeight(corners, cells, x, z)` is the same on a raw grid. Any `(x, z) => ft` callback may stand in |
| `fallWater(wtr, lvlWaterFt)` | the walk's water (12.2.3): the tile's lake surface, but the track's .LVL water on a dry tile or on the fall's own source lake, and none when that is below 1/256 ft |
| `buildFallMeshes(falls, { ground, water, lakes, tileMap })` | the loader (12.1.5, 12.2): record checks, validation, then each fall in order into one track buffer. `skipped` and `tooBig` are the two on-screen messages of 12.1.3 |
| `fallDebugColumns(fall, spacing, { ground, water })` | the walk's rows of every column before the row cut, with the trim's verdict (what `waterfallDebug` re-walks, 12.1.6) |
| `fallMist(built, record, { waterfallMistPct })` | null or the mist fog volume (12.4); `fallMists(built, { sitFogVolumes })` applies the 64 slots shared with the .SIT fog volumes (`fallMistSlotFree`) |
| `fallSound(built, record, { snow })` | `{ silent: "no-sound-flag" \| "no-stem" \| "frozen" }` or the loop: `sound\<stem>.WAV` at the landing (x, z wrapped), volume and hearing (12.7). The 30-loop room (`FALL_SOUND_LOOP_ROOM`, shared with the SIT continuous sounds) and the distance order are the host's; `fallSoundGain` is the falloff |
| `fallLook(...)`, `FALL_RIPPLE_FRAMES`, `fallTextureName` | the look rule (12.8.3), the default ripple (RIPPL100 .. RIPPL800 .. RIPPL200, 14 frames of 0.25 s, 12.8.1), ".RAW" for a stem without a '.' |

**The walk** (12.2.4), per column at 1/60 s steps, at most 4000: move, add -32/60 to vy; under ground + 0.3 ft the
water is draped (put on it, the into-ground velocity removed, all of v times 0.98, air 0); otherwise air is 1 when more
than 0.05 ft above that. Water is reached when the surface is above the ground and at or above y (snapped to it);
else it rests when draped on ground within 5 deg of flat below 2 ft/s; else step 4000 is the limit. A row is emitted
each time the path since the last row reaches the spacing, and at the end.

**Rows and trim** (12.2.5). A column that does not end in water keeps only 8 ft of chord path past where it got within
1 ft of its final height, counted from the start of its trailing run of flat contacts (air 0, ground within 10 deg of
flat). A water column gets one more row, the sink (4 ft down, carried along the last step when that step is steeper
than 30 deg).

**Budget** (12.2.6). Spacings 2, 3, 4, 6, 8 ft in turn (more than 1100 columns: none); the first whose vertices
(rows + 3 per column of each run of two or more kept water columns, the foam) fit min(16384, track room) and whose
indices fit the track's 1,572,864 is used. Else the 8 ft columns are cut at R rows, R the largest that fits by
bisection from 2 (SHORTENED); when even 2 rows do not fit, or no room is left, the fall is DROPPED. The track holds
262,144 vertices; falls are built in file order, so one dropped fall does not stop a later smaller one.

**Vertex** (16 floats, `FALL_VERTEX`): position in 1/256 ft from the anchor (crest point 0 at the crest height,
`anchorFt`), u (ft along the crest), tau (s since the crest), smoothed speed, air, edge (column distance from the
outer columns / 3, at most 1), end (1 on a water column with its sink, 0 on the sink; else the fade over the last 6 ft
of path), kind (0 sheet, 1 foam), the fall's slot, drop below the crest, normal (12.2.8), chord path. The foam strip
(12.2.10) follows the sheet: three vertices a kept water column, 0.1 ft above the surface, clamp(1.5 * drop, 4, 40) ft
wide across the last step. Indices (12.2.9) zip neighbouring columns of unequal length, then the foam's quads.

**Landing** (12.2.11): over the kept water columns, the mean surface height and drop, the summed unit last steps for
the direction (else the crest's point directions, else (0, 1)), and the width across it plus the spacing used; with no
kept water column, the lowest last row with no width.

**Mist** (12.4): density (mist / 100) * clamp(speed * crest length * drop / 7200, 0.25, 2) * waterfallMist / 100; a
box W = max(width + 0.6 drop, 20), L = max(0.6 drop, 20) * mist depth %, H = min(0.7 drop, 120) * mist height %, at
most 240; centre 0.3 L ahead of the landing, wrapped; floor 2 ft below the landing; vis clamp(120 / density, 20, 1000)
and the SIT fog defaults the engine sets (colour 0.75, 0.78, 0.82, edge 20, top 5, wisps 0.6 of 25 ft at 2 ft/s); the
weather mask without Snow on a FREEZE fall.

**Fidelity.** The rules, constants and counts are the engine's. It computes in floats; this module in doubles,
stored as Float32Array, so positions agree to float precision and a column that lands within a rounding error of a
threshold could emit one row more or less than the game.

**Ambiguous in 12, chosen here.** `rowsMin` / `rowsMax` (the log's "rows %d..%d") are the vertices written per column,
sink included. The normals' 1e-6 degeneracy tests run on the stored vertex positions (1/256 ft units). The landing's
"unit horizontal last step" skips a step shorter than 1e-6 ft, and its fallback direction needs more than 1e-6. A tile
naming a lake the WTR loader did not keep has no water (the engine reads a cleared body, surface 0, which no ground
lies under). Fine-grid falls use the classic diagonal formulas over 8 ft cells, as 12.2.3 says ("the same parity
split"). The droplets (12.5), foam zones and landing rings (12.6) and the per-frame draw (12.9) are per-frame renderer
work and are not built here; their inputs (landing, width, drop, direction, flags) are in each built fall.

## Optional handling

Three optional `Mtm2Rules` fields change the handling for a host that asks (OpenMTM2's Freestyle "Trick physics").
Neither game has them. Left out, or at the neutral value, the step is the game's to the bit. The 4x4 Evolution and
CART Precision Racing steps (`sim/evo`, `sim/cpr`) read the same three fields from the session ground's rules, on
their own aero damping, so a host's trick handling works under every vehicle model (`sim/mtm2/truck/trick.ts`).

| Field | Neutral | Effect |
|---|---|---|
| `airPitchControl` | 0 | With all four wheels off, the pedals pitch the truck: `(throttle - (brakeFront + brakeRear) / 2) * airPitchControl * I_pitch` lb ft, throttle nose up, brakes nose down. |
| `airRotationDamping` | 1 | With all four wheels off, the aero damping of the roll, pitch and yaw rates (§14.7) is multiplied by this. |
| `groundYawDamping` | 1 | With a wheel down, the aero damping of the yaw rate is multiplied by this. |

Why they exist: §14.7's damping uses `q_bar` floored at its value at 150 ft/s. Below about 102 mph that damps
pitch in the air with a time constant of about 0.55 s (about 9,100 lb ft per rad/s on 5,000 slug ft²) and roll
with about 0.66 s, so a truck can't turn much past half a flip from a ramp's take-off rate. The pedals do nothing to
the body in the air, and at full lock the truck circles at about 1 rad/s.

## Summit Rumble

`createRace(..., "summit")` always scores a Rumble (OpenMTM2 `docs/MONSTER_EXE_ANALYSIS.md` 6.3):
mode 4 never tests checkpoints, so a level with one type 6 box has that box as the scoring zone and
no summit, and one with none has neither (a box no truck is ever inside). Run as a Circuit, every
pass through the box would count as a lap.

## What a host is told, and what it must pass

- `collideTrucks` returns `{ hull, wheels }`: whether the two trucks' hulls met and whether only their tires did.
- `postStepTruck` must be given the same ground as that truck's `stepTruck`. Where a level has surfaces over the
  terrain (`createRoadGround(...).below(...)`, one view a truck), the wheels are measured against it there; given the
  terrain alone, a truck on a deck rests on its hull with its wheels hanging.
- `raceTick` runs the game's off-course re-pick (`offCourseRepick`, `0x486630`): a truck 160 ft off its segment's line
  or 10% past its end goes to the arc whose centre is nearest it.
- Ground boxes (`groundBoxesAround`) are the game's: every face solid, the face a point meets chosen by the ray from
  where it was last step. A wheel lands on a top only when its hub was above it; a taller step is a wall.

## Wall faces (the port's)

`collide/truck-face.ts`. MTM2 meets only boxes; a host with walls that are not boxes (OpenMTM2's 4x4 Evolution rocks,
whose steep faces are walls) gives each as a triangle: `createFace(a, b, c, outward)` and
`collideTruckFace(s, p, face, dt)`, called where `collideTruckImmovableBox` is. A face is solid for `FACE_DEPTH_FT` (2 ft)
behind it. A hull point or a tire contact point behind it, over the triangle, takes it as an immovable box's side
would: its depth behind the face and the face's normal, which the post-step pushes the truck out along. A point that
crossed the face's plane over the triangle since the last step counts however deep it is, so a fast truck cannot pass
through. Nothing reaches past the triangle's edges, which a box laid on the face would: a box round a triangle is
twice its area, and what of it stands past the rock's outline is a wall in the air. A wall carries no wheel.

## The world as a torus

`world/wrap.ts`. The game wraps a truck's x and z into the 8192 ft world every frame (`0x5559c0`; OpenMTM2
`docs/MONSTER_EXE_ANALYSIS.md`, "The wrapping world"): `wrapTruck(s)` does that and returns what it added, for a host to
move whatever it draws from. The game takes no distance the short way round. The port does, in its pair tests:
`collideTrucks` tests the second truck as the copy nearest the first, `withNearest(s, x, z, test)` does the same for a
truck against anything at (x, z), `groundBoxesAround` places a box beside the point across the map's edge, and
`createRoadGround` reads its triangles wrapped. `wrapCoord`, `wrapDelta` and `nearestShift` are the arithmetic.

**World size (track format version 6).** A version 6 track may have N = 512 cells a side instead of 256, a world
W = 32 N = 16,384 ft (https://openmtm2.github.io/proposals/track-format-v6, section 8.1). The cell stays 32 ft and the
fine cell 8 ft; only the constants follow N, and every one has a parameter that defaults to the retail world:

| Constant | Where | Parameter |
| --- | --- | --- |
| cell mask `& (N - 1)`, row stride N | terrain, lakes (`terrain.ts`), surface (`surface.ts`), ground boxes (`box.ts`, `moving-object.ts`) | `createTerrain(heights, water, cells)`, `createTerrainFt(heightsFt, water, fine, cells)`, `createSurfaceMap(clr, values, cells)`, `groundBoxesAround(..., stepFt, cells, baseFt)`; the terrain's `cells` for `groundBoxHeightAt` and `stepMovingObject` |
| fine grid 4N | `terrain.ts` | a fine grid must be a multiple of N |
| position wrap every frame at W | `wrapTruck(s, worldFt)`, `stepMovingObject` (from the terrain) | `worldFt` |
| negative load positions + W | `wrapLoadCoord(v, worldFt)`, `createTopCrush(..., worldFt)` | `worldFt` |
| nearest copy at W / 2 | `wrapDelta`, `nearestShift`, `withNearest`, `collideTrucks(..., rules, worldFt)` | `worldFt` |

`terrainCells(t)` and `terrainWorldFt(t)` read a terrain's N and W; `createTerrainGround` puts W on the ground as
`worldFt`, which `createRoadGround` uses. `worldFtOf(cells)` is 32 N. A 16-bit ground box layer (section 8.3) passes its
u16 grids with `stepFt = 1 / terrainHeightStep` and the terrain's base (`baseFt`, or `GroundBoxScale` for
`groundBoxHeightAt`). Heights of a version 6 terrain go in through `createTerrainFt` in feet
(`mtm2V6HeightsFt`, exact). The waterfall build (`cp4Sim`, `falls.ts`) takes the world too (section 9.3): `readFallFile(bytes, { cells })` reads
major 1 (a 256 world only) and major 2 (N x N), `fallGround(heights, { cells, h128: true })` walks the version 6 heights
in their 32-bit h128 store (`mtm2V6HeightsH128`, the coarse N x N or fine 4N x 4N grid), `fallWater` and
`validateFall` take `cells` beside `lakes` and `tileMap` (the N x N map, segments wrapped at W), and `buildFallMeshes`
takes `cells` and `heightRange` (`fallHeightRange(major, { step, base })`: 1..4096 half-feet for version 1, a version 2
lake's range for version 2). A built fall carries `worldFt`, which `fallMist` and `fallSound` wrap at.

## Vehicles of other games

`createTruckParams` takes `tireRadiusFt` and `tireWidthFt` beside the wheel anchors and hull
points, for a CPR car or a 4x4 Evolution truck driven by this model; every MTM truck has the
game's fixed 3 ft by 4 ft. Nothing else of the truck changes.

## Levels finer than MTM2's

`createTerrainFt(heightsFt, waterLevelFt)` makes the same terrain (256 cells of 32 ft, the checkerboard split, the wrap) from corner heights in feet, for a heightfield finer than MTM2's 2 ft steps: CART Precision Racing's is 16 bits a corner in sixteenths of a foot, 4x4 Evolution's in thirty-seconds. MTM2's byte heightfield is read as before.
