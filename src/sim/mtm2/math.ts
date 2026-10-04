/*
  Small vector and rotation helpers for the MTM2 simulation.

  Axes (§1): world y up; body x right, y up, z forward. Orientation is the Euler triple theta
  (pitch, about x), phi (roll, about z), psi (yaw, about y), with the body-to-world matrix
  M = Ry(psi) · Rx(theta) · Rz(phi), stored row-major in 9 numbers. world = M · body,
  body = Mᵀ · world. The body's forward axis in world is (cosθ sinψ, −sinθ, cosθ cosψ).

  Everything writes into caller-supplied arrays so a simulation step allocates nothing.
*/

export type Vec3 = Float64Array | number[];
export type Mat3 = Float64Array | number[];

export const TWO_PI = Math.PI * 2;

/** Fill `m` with M = Ry(psi) · Rx(theta) · Rz(phi). */
export function eulerToMatrix(theta: number, phi: number, psi: number, m: Mat3): Mat3 {
  const st = Math.sin(theta), ct = Math.cos(theta);
  const sp = Math.sin(phi), cp = Math.cos(phi);
  const ss = Math.sin(psi), cs = Math.cos(psi);
  m[0] = ss * sp * st + cs * cp;
  m[1] = st * cp * ss - cs * sp;
  m[2] = ct * ss;
  m[3] = ct * sp;
  m[4] = cp * ct;
  m[5] = -st;
  m[6] = cs * sp * st - cp * ss;
  m[7] = sp * ss + st * cs * cp;
  m[8] = cs * ct;
  return m;
}

/** out = M · v (body to world). `out` may not alias `v`. */
export function bodyToWorld(m: Mat3, v: Vec3, out: Vec3): Vec3 {
  out[0] = m[0] * v[0] + m[1] * v[1] + m[2] * v[2];
  out[1] = m[3] * v[0] + m[4] * v[1] + m[5] * v[2];
  out[2] = m[6] * v[0] + m[7] * v[1] + m[8] * v[2];
  return out;
}

/** out = Mᵀ · v (world to body). `out` may not alias `v`. */
export function worldToBody(m: Mat3, v: Vec3, out: Vec3): Vec3 {
  out[0] = m[0] * v[0] + m[3] * v[1] + m[6] * v[2];
  out[1] = m[1] * v[0] + m[4] * v[1] + m[7] * v[2];
  out[2] = m[2] * v[0] + m[5] * v[1] + m[8] * v[2];
  return out;
}

/** Euler angles back from a matrix built by eulerToMatrix (theta within ±π/2). */
export function matrixToEuler(m: Mat3, out: Vec3): Vec3 {
  const theta = Math.asin(Math.max(-1, Math.min(1, -m[5])));
  out[0] = theta;
  out[1] = Math.atan2(m[3], m[4]);
  out[2] = Math.atan2(m[2], m[8]);
  return out;
}

/** Wrap to [−π, π]. */
export function wrapPi(a: number): number {
  a -= TWO_PI * Math.round(a / TWO_PI);
  return a;
}

/** Wrap to [0, 2π). */
export function wrapTwoPi(a: number): number {
  a %= TWO_PI;
  return a < 0 ? a + TWO_PI : a;
}

/** The game's heading of a horizontal direction: atan2(dx, dz), 0 = +z, π/2 = +x. */
export function heading(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** out = a × b. `out` may not alias `a` or `b`. */
export function cross(a: Vec3, b: Vec3, out: Vec3): Vec3 {
  out[0] = a[1] * b[2] - a[2] * b[1];
  out[1] = a[2] * b[0] - a[0] * b[2];
  out[2] = a[0] * b[1] - a[1] * b[0];
  return out;
}

export function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

/** Normalise in place; a zero vector becomes (0, 1, 0), as the game's helper does. */
export function normalize(v: Vec3): Vec3 {
  const len = length(v);
  if (len === 0) { v[0] = 0; v[1] = 1; v[2] = 0; return v; }
  v[0] /= len; v[1] /= len; v[2] /= len;
  return v;
}
