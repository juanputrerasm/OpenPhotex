# The 4x4 Evolution vehicle model (`evoSim`)

`src/sim/evo/` implements the vehicle of 4x4 Evolution 1 and 2 as OpenMTM2's
`docs/EVO2_PHYSICS.md` specifies it (from `4x4LE.exe`, 16 August 2001, and `4x42.exe`,
25 September 2001). It is exported from the package root as `evoSim`, beside `mtm2Sim`, and runs
on MTM2's world, collisions and post-step: Evo's step descends from MTM2's, and only the force
section differs.

## Use

```ts
import { evoSim as E, mtm2Sim as S, parseEvoTrk } from "openphotex";

const rules = E.evoRules("evo2");                       // or "evo1"
const spec = E.evoSpecFromTrk(parseEvoTrk(bytes, name)); // an Evo vehicle
// const spec = E.evoSpecFromMtm2({ wheelAnchors, scrapePoints, suspension }); // any other vehicle
const params = E.createEvoParams(spec, rules, { tireRadiusFt, tireWidthFt }, { tread: 1, autoShift: true });
const state = E.createEvoTruckState(pos, heading, S.GEAR.FIRST, params);
ground.rules = rules;
// each step: the MTM2 controls, then
E.stepEvoTruck(state, params, ctx, dt);
S.postStepTruck(state, params, ground, dt);
```

`EvoTruckParams` is MTM2's params shape with an `evo` block, and `EvoTruckState` MTM2's state with
an `evo` block, so the MTM2 controls, autopilot, recovery and collisions take them unchanged.
Gear numbers are MTM2's in both games (1 Park, 2 Reverse, 3 Neutral, 4 first); a `.TRK`'s
`xm.gear_ratio[i]` is gear `i + 1`.

## The two rule sets

| Switch | Evo 1 | Evo 2 |
|---|---|---|
| `airborneG` | 32.174 | 56.3045 (1.75 g with every tire off the ground) |
| `defaultCgZ` | 0 | 2 ft |
| `steerRearGripCut` | no | yes |
| `hullFrictionFactor` | 0.5 | 1.5 |

The surface mu (`EVO_SURFACE_MU`) and tread tables (`EVO_TREAD_FACTORS`) are the same in both.

## Non-Evo vehicles

`evoSpecFromMtm2` is the port's rule for an MTM truck or a CPR car under Evo physics: MTM2's own
figures (10,000 lb, inertia, CG, aero, engine curve sampled every 500 rpm, gears, transfer
ratio, springs, grip factor, rear steering) run through Evo's tires and driveline.

## Not reproduced

Evo's catch-up for computer vehicles (OpenMTM2's autopilot has its own), the misfire and the
crash timer (not traced), independent suspension (the solid-axle post-step serves every
vehicle), `axleBias` (not traced). A torque table shorter than the rev range holds its last
entry. Computer-driven vehicles use MTM2's autopilot, whose speed look-ahead assumes MTM2's
engine.
