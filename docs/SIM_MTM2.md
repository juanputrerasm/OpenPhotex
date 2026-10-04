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
| `truck/dynamics.ts` | `stepTruck` (tire geometry, loads, longitudinal and lateral forces, drag, damping, sums, integration, contact probing) and `postStepTruck` (push-out, wheel probes, solid axles, bottoming) |
| `truck/contacts.ts` | hull contacts: support split for 1 to 4 contacts, recovery, friction |
| `truck/water-drag.ts` | `fluidAreas`: density times area per body axis from submerged wheels and hull faces, the rest at air density; the splash flag |

A step is `applyKeyboard` (or the autopilot), `stepTruck`, then (after collisions)
`postStepTruck`. Still to come, in OpenMTM2's plan order: the player reset and helicopter, ground boxes and ramps in
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
