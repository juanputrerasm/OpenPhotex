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
| `world/checkpoints.ts` | checkpoint gates and their enlarged detectors, the pretest, direction and crossing-time rules |
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

A step is `applyKeyboard` (or the autopilot), `stepTruck`, then (after collisions)
`postStepTruck`. Still to come, in OpenMTM2's plan order: ground boxes and ramps in
the ground, collisions, the autopilot and the race rules.

## Notes on fidelity

Where the original does something surprising, the code does it too and the source says so:

- keyboard rates run at about half their stored values (the frame time is scaled by 0x7fff / 0x10000);
- without automatic shifting, releasing the accelerator keeps the throttle;
- the engine rpm is pulled once per tire per step, four times;
- ground at exactly the water level reads deep water, even on a level with no water (level 0);
- an axis-aligned line in the course intersection takes the game's shortcut;
- the two-contact support split is the reverse of the lever rule, and sliding friction uses
  |vt + v|;
- the lateral tire force acts at the axle's height, about the CG at rest.

The tests (`test/sim-mtm2-*.test.ts`) check the formulas against hand-computed values;
`test/stock.test.ts` builds every stock course and checks that each arc meets its straights.

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

## What a host is told, and what it must pass

- `collideTrucks` returns `{ hull, wheels }`: whether the two trucks' hulls met and whether only their tires did.
- `postStepTruck` must be given the same ground as that truck's `stepTruck`. Where a level has surfaces over the
  terrain (`createRoadGround(...).below(...)`, one view a truck), the wheels are measured against it there; given the
  terrain alone, a truck on a deck rests on its hull with its wheels hanging.
- A smoothed ground box (`groundBoxesAround`'s `smoothFt`) whose bottom is over a truck's centre is a bridge to that
  truck: it carries none of its wheels and its bottom is a ceiling.

## The world as a torus

`world/wrap.ts`. The game wraps a truck's x and z into the 8192 ft world every frame (`0x5559c0`; OpenMTM2
`docs/MONSTER_EXE_ANALYSIS.md`, "The wrapping world"): `wrapTruck(s)` does that and returns what it added, for a host to
move whatever it draws from. The game takes no distance the short way round. The port does, in its pair tests:
`collideTrucks` tests the second truck as the copy nearest the first, `withNearest(s, x, z, test)` does the same for a
truck against anything at (x, z), `groundBoxesAround` places a box beside the point across the map's edge, and
`createRoadGround` reads its triangles wrapped. `wrapCoord`, `wrapDelta` and `nearestShift` are the arithmetic.

## Vehicles of other games

`createTruckParams` takes `tireRadiusFt` and `tireWidthFt` beside the wheel anchors and hull
points, for a CPR car or a 4x4 Evolution truck driven by this model; every MTM truck has the
game's fixed 3 ft by 4 ft. Nothing else of the truck changes.

## Levels finer than MTM2's

`createTerrainFt(heightsFt, waterLevelFt)` makes the same terrain (256 cells of 32 ft, the checkerboard split, the wrap) from corner heights in feet, for a heightfield finer than MTM2's 2 ft steps: CART Precision Racing's is 16 bits a corner in sixteenths of a foot, 4x4 Evolution's in thirty-seconds. MTM2's byte heightfield is read as before.
