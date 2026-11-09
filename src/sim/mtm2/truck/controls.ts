/*
  The player's keyboard controls (MONSTER_EXE_ANALYSIS.md §7, routine 0x584490).

  - Keys ramp the pedals rather than switching them. The routine scales the frame time by
    0x7fff / 0x10000 first, so every rate below runs at about half its stored value: the
    throttle and brakes rise at 3.5 × dt′ and fall at 8 × dt′, dt′ ≈ dt / 2.
  - With automatic shifting, braking while stopped or rolling backwards selects Reverse and
    the brake key then drives; accelerating in Reverse selects first gear again. In a drag race
    this waits until the truck has passed more than 3 course segments.
  - Without automatic shifting, releasing the accelerator leaves the throttle where it is
    (only braking clears it). That is what the code does; it is noted for checking in play.
  - Steering keeps the shaped angle s. Each frame the linear angle 0.45 · (|s| / 0.45)^(1/e)
    is recovered with the previous exponent, moved by dt′ while a turn key is held (and back
    towards 0 at 4 × dt′ when not), clamped to ±0.45, and shaped again:
    s = sign · 0.45 · (|lin| / 0.45)^e, e = (1 + 0.25 · response) · clamp(|v_fwd| · 0.025, 1, 1.1).
  - The rear wheels steer −0.33 × the front, and −0.4125 × in drag mode.

  A joystick or wheel (MONSTER_EXE_ANALYSIS.md §7, routine 0x5853b0) sets the controls directly,
  with no ramps, after the keyboard routine and once per sub-step: see `applyJoystick`.

  Community Patch 3 (OpenMTM2's CP3_EXE_ANALYSIS.md, "Steering model") keeps that routine as its
  "Original (1998)" steering model and adds an "Expo" one, with a steering range (the share of the
  stick's throw that reaches full lock, 90 % in both) and, for Expo, a cubic blend and an ease-off
  with speed. Its steering response reaches 2, where the game's INI stops at 1.
*/
import { CONTROLS, DIFFICULTY, GEAR } from "../constants.ts";

/** The routine's frame-time scale: a 16.16 multiply by 0x7fff. */
export const KEY_DT_SCALE = 0x7fff / 0x10000;

export interface KeyInput {
  accelerate: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
  /** Edge-triggered manual shift keys. */
  shiftUp?: boolean;
  shiftDown?: boolean;
}

export interface ControlState {
  throttle: number;
  brakeFront: number;
  brakeRear: number;
  /** Front steering angle, rad (positive right). */
  steer: number;
  rearSteer: number;
  gear: number;
  shiftRequest: number;
  /** Optional handling (not the game's): the automatic box takes shift requests too, then holds the gear (drivetrain.ts). */
  autoOverride?: boolean;
  shiftHold?: boolean;
  /** The steering exponent from the previous frame. */
  steerExponent: number;
}

export interface ControlContext {
  dt: number;
  autoShift: boolean;
  /** Body forward speed, ft/s. */
  forwardSpeed: number;
  dragMode: boolean;
  /** Course segments passed (the drag-race gate). */
  segments: number;
  /** MONSTER.INI steering response / 10 (1 by default; Community Patch 3 takes it to 2). */
  steeringResponse?: number;
  /** Community Patch 3's `steerCurveMode`: 0 the game's power curve ("Original (1998)", the default), 1 "Expo". */
  steerCurveMode?: number;
  /** Community Patch 3's `steerRange`, 5 to 100: the percentage of the stick's throw that reaches full lock (90). */
  steerRange?: number;
  /** Community Patch 3's `steerExpo`, 0 to 100: the Expo curve's share of x³ against x. */
  steerExpo?: number;
  /** Community Patch 3's `steerSpeedSens`, 0 to 100: how much the Expo curve eases off up to 88 ft/s (35). */
  steerSpeedSens?: number;
  /** Difficulty (the joystick's Rookie steering scale); Intermediate when absent. */
  difficulty?: number;
}

/** A joystick or wheel, each axis -1..1 from its calibrated centre. */
export interface JoystickInput {
  /** Steering, positive right. */
  x: number;
  /** Pedals: negative is the throttle, positive the brake. */
  y: number;
  /** The dead zone as a fraction of the throw (MONSTER.INI `nullZone` / 65536). */
  deadZone?: number;
  shiftUp?: boolean;
  shiftDown?: boolean;
}

export function createControlState(gear: number = GEAR.FIRST): ControlState {
  return {
    throttle: 0, brakeFront: 0, brakeRear: 0, steer: 0, rearSteer: 0, gear, shiftRequest: 0,
    steerExponent: 1 + 0.25,
  };
}

/** Apply one frame of keyboard input to the pedals, gear selection and steering. */
export function applyKeyboard(c: ControlState, keys: KeyInput, ctx: ControlContext): void {
  const dt = ctx.dt * KEY_DT_SCALE;
  const up = CONTROLS.rampUpPerSec * dt;
  const down = CONTROLS.rampDownPerSec * dt;
  const dragGate = ctx.dragMode && ctx.segments < 4;

  if (keys.accelerate) {
    if (ctx.autoShift && !dragGate && c.gear === GEAR.REVERSE) c.gear = GEAR.FIRST;
    c.brakeFront = 0;
    c.brakeRear = 0;
    c.throttle = Math.min(1, c.throttle + up);
  } else if (c.gear !== GEAR.REVERSE && ctx.autoShift && c.throttle !== 0) {
    c.throttle = Math.max(0, c.throttle - down);
  }

  if (!keys.brake) {
    if (c.brakeFront !== 0 || c.brakeRear !== 0) {
      c.brakeFront = Math.max(0, c.brakeFront - down);
      c.brakeRear = Math.max(0, c.brakeRear - down);
    }
    if (c.gear === GEAR.REVERSE && ctx.autoShift && c.throttle !== 0) c.throttle = Math.max(0, c.throttle - down);
  } else if (!ctx.autoShift || c.gear === GEAR.PARK || dragGate || ctx.forwardSpeed > 0) {
    c.throttle = 0;
    c.brakeFront = Math.min(1, c.brakeFront + up);
    c.brakeRear = Math.min(1, c.brakeRear + up);
  } else {
    c.gear = GEAR.REVERSE;
    c.brakeFront = 0;
    c.brakeRear = 0;
    c.throttle = Math.min(1, c.throttle + up);
  }

  steerKeys(c, keys.left, keys.right, dt, ctx);

  if (keys.shiftDown) c.shiftRequest = -1;
  if (keys.shiftUp) c.shiftRequest = 1;
}

function steerKeys(c: ControlState, left: boolean, right: boolean, dt: number, ctx: ControlContext): void {
  const lock = CONTROLS.steerLock;
  const sign = c.steer < 0 ? -1 : 1;
  let lin = sign * lock * Math.pow(Math.abs(c.steer) / lock, 1 / c.steerExponent);
  const back = dt * CONTROLS.steerReturnFactor;
  if (left) {
    lin -= dt;
    if (lin < -lock) lin = -lock;
  } else if (lin < 0) {
    lin += back;
    if (lin > 0) lin = 0;
  }
  if (right) {
    lin += dt;
    if (lin > lock) lin = lock;
  } else if (lin > 0) {
    lin -= back;
    if (lin < 0) lin = 0;
  }
  const speedFactor = Math.min(1.1, Math.max(1, Math.abs(ctx.forwardSpeed * 0.025)));
  c.steerExponent = ((ctx.steeringResponse ?? 1) * 0.25 + 1) * speedFactor;
  c.steer = (lin < 0 ? -1 : 1) * lock * Math.pow(Math.abs(lin) / lock, c.steerExponent);
  c.rearSteer = rearSteer(c.steer, ctx.dragMode);
}

/** An axis with the dead zone taken out and the rest stretched back to -1..1. */
function deadZoned(v: number, n: number): number {
  let out: number;
  if (v <= 0) {
    out = v + n;
    if (out > 0) out = 0;
  } else {
    out = v - n;
    if (out < 0) out = 0;
  }
  return out / (1 - n);
}

/** Community Patch 3's steering defaults (its INI and its Reset Steering & Feedback). */
export const CP3_STEER = Object.freeze({ range: 90, speedSens: 35, easeOff: 0.6, easeSpeed: 88 });

/**
 * The shaped steering of a stick at `x` (-1..1, dead zone already out), 0..1 of full lock: the
 * game's power curve, or Community Patch 3's Expo curve (`steerCurveMode` 1).
 */
export function joystickSteer(x: number, ctx: ControlContext): number {
  const speedFactor = Math.min(1.1, Math.max(1, Math.abs(ctx.forwardSpeed * 0.025)));
  const range = ctx.steerRange !== undefined && ctx.steerRange > 4 && ctx.steerRange < 101 ? 100 / ctx.steerRange : 1.11;
  const m = Math.min(1, Math.abs(x) * range);
  if (ctx.steerCurveMode === 1) {
    const expo = Math.min(1, Math.max(0, (ctx.steerExpo ?? 0) / 100));
    const sens = Math.min(1, Math.max(0, (ctx.steerSpeedSens ?? CP3_STEER.speedSens) / 100));
    const speed = Math.min(1, Math.abs(ctx.forwardSpeed) / CP3_STEER.easeSpeed);
    return (1 - speed * sens * CP3_STEER.easeOff) * (m * m * m * expo + (1 - expo) * m);
  }
  const e = ((ctx.steeringResponse ?? 1) * 2 + 1) * speedFactor;
  return Math.pow(m, e);
}

/**
 * Apply one sub-step of joystick or wheel input (MONSTER_EXE_ANALYSIS.md §7). Steering follows
 * the stick through a steep power curve (`joystickSteer`); the pedal axis sets the throttle or the
 * brakes directly, selecting Reverse or first gear as the keyboard does with autoShift.
 */
export function applyJoystick(c: ControlState, j: JoystickInput, ctx: ControlContext): void {
  const n = j.deadZone ?? 0;
  let x = deadZoned(Math.max(-1, Math.min(1, j.x)), n);
  if ((ctx.difficulty ?? DIFFICULTY.INTERMEDIATE) === DIFFICULTY.ROOKIE && !ctx.dragMode) x *= 0.75;
  const s = joystickSteer(x, ctx);
  c.steer = (x < 0 ? -s : s) * CONTROLS.steerLock;
  c.rearSteer = rearSteer(c.steer, ctx.dragMode);

  if (j.shiftUp) c.shiftRequest = 1;
  if (j.shiftDown) c.shiftRequest = -1;

  const y = deadZoned(Math.max(-1, Math.min(1, j.y)), n);
  const gateOpen = !ctx.dragMode || ctx.segments > 3;
  if (y <= 0) {
    if (ctx.autoShift && gateOpen && c.gear === GEAR.REVERSE) c.gear = GEAR.FIRST;
    c.throttle = -y;
    c.brakeFront = 0;
    c.brakeRear = 0;
    return;
  }
  if (ctx.autoShift && c.gear !== GEAR.PARK && gateOpen && y > 0.25 && ctx.forwardSpeed <= 0) {
    c.gear = GEAR.REVERSE;
    c.brakeFront = 0;
    c.brakeRear = 0;
    c.throttle = y;
    return;
  }
  c.throttle = 0;
  c.brakeFront = y;
  c.brakeRear = y;
}

/** The rear axle's steering angle for a front angle. */
export function rearSteer(front: number, dragMode: boolean): number {
  const rear = front * CONTROLS.rearSteerFactor;
  return dragMode ? rear * CONTROLS.rearSteerDragFactor : rear;
}

