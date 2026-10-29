import { toDataLines } from "./coords.ts";

/*
  .TNL tunnel geometry (Terminal Velocity / Fury3 / F!Zone).

  A tunnel level (.LVL line 0 = 1) names its .TNL where a surface level names its .RAW. Read by
  TV GAME.EXE 0x34770 and built into geometry by 0x33f00 (Fury3 TF.EXE 0x435020); the layout
  below is the order the loader scans the fields in, and the record offsets are the engine's.
  Plain ASCII, CRLF:

    <segmentCount>                  at most 90 ("Tunnel is too big!")
    per segment, 13 + N lines:
      ax, ay, bx, by, N             ring A centre, ring B centre, sides
      a0, a1, unk28                 ring A start and end angle; a value the builder does not use
      rxA, ryA                      ring A radii
      b0, b1                        ring B start and end angle
      rxB, ryB                      ring B radii
      timer                         door countdown (65535 when unused)
      unk48
      open                          sides left out of the ring (0 = a closed ring)
      type                          segment behaviour, 0 = plain
      textureList                   index into the level's tunnel texture list
      N side textures               one per face
      unk234, unk23C, unk240        typically 0, 65535, 32768

  Units. Angles are 65536 per turn. Centres and radii are in units of 256 world units, and each
  segment is 0x1000 of those long: 2^20 world units, exactly one terrain cell. Segment i runs
  from z = i * 0x1000 to (i + 1) * 0x1000; the tube is laid along +z with no rotation, only its
  centre moving between segments. See tunnelSegmentGeometry for the rings.

  Segment types handled by the engine (TV 0x38820): 2 is a door that opens into type 3 when its
  timer runs out; 4 to 15 hold the craft to one side of the centre line; 0x12 is a blocker at a
  random angle; 0x13 a horizontal band. The shipped files use 0 to 30, so the higher values
  remain unread.

  Validated against all 148 shipped files (65 in TV's CDROM.POD, 52 in FURY3.POD, 31 in
  FURYSE.POD): every one reads to its end, with N in {4, 5, 6, 8} and at most 82 segments.
  Hellbender's executable keeps the tunnel engine but the game ships no .TNL.
*/

/** One ring of a segment: start and end angle (65536 per turn) and radii (256 world units). */
export interface TunnelRing {
  startAngle: number;
  endAngle: number;
  radiusX: number;
  radiusY: number;
}

/** One tunnel segment, as the file stores it. */
export interface TunnelSegment {
  index: number;
  /** Ring A (segment start) centre, in 256 world units. */
  centreA: [number, number];
  /** Ring B (segment end) centre, in 256 world units. */
  centreB: [number, number];
  sides: number;
  ringA: TunnelRing;
  ringB: TunnelRing;
  /** Sides left out of the ring; 0 is a closed tube. */
  open: number;
  type: number;
  timer: number;
  textureList: number;
  /** One texture index per face, `sides` long. */
  sideTextures: number[];
  /** Fields the builder does not use, in file order: unk28, unk48, unk234, unk23C, unk240. */
  unknown: [number, number, number, number, number];
}

export interface TvTunnel {
  segments: TunnelSegment[];
  /** True when the file ended exactly after the last declared segment. */
  complete: boolean;
}

/** The longest tunnel the engine accepts. */
export const TUNNEL_MAX_SEGMENTS = 90;

/** Segment length along the tube, in the file's 256-world-unit units: one terrain cell. */
export const TUNNEL_SEGMENT_LENGTH = 0x1000;

/** World units per .TNL coordinate unit. */
export const TUNNEL_UNIT = 256;

const ints = (line: string | undefined): number[] | null => {
  if (line === undefined || line === "") return null;
  const values = line.split(",").map((v) => Number.parseInt(v.trim(), 10));
  return values.every(Number.isFinite) ? values : null;
};

/**
 * Parses a .TNL file. Returns null when the segment count is missing or out of range; a file
 * that ends early keeps the segments read so far, with `complete` false.
 */
export function parseTvTunnel(bytes: Uint8Array | null | undefined): TvTunnel | null {
  if (!bytes || !bytes.length) return null;
  const lines = toDataLines(bytes).filter((line) => line !== "");
  const count = ints(lines[0])?.[0];
  if (count === undefined || count < 0 || count > TUNNEL_MAX_SEGMENTS) return null;

  const segments: TunnelSegment[] = [];
  let i = 1;
  for (let n = 0; n < count; n++) {
    const head = ints(lines[i]);
    const angA = ints(lines[i + 1]);
    const radA = ints(lines[i + 2]);
    const angB = ints(lines[i + 3]);
    const radB = ints(lines[i + 4]);
    const singles = [5, 6, 7, 8, 9].map((k) => ints(lines[i + k])?.[0]);
    if (!head || head.length < 5 || !angA || angA.length < 2 || !radA || radA.length < 2 ||
        !angB || angB.length < 2 || !radB || radB.length < 2 || singles.some((v) => v === undefined)) break;
    const sides = head[4];
    if (sides < 1 || sides > 64) break;
    const textures: number[] = [];
    for (let k = 0; k < sides; k++) {
      const t = ints(lines[i + 10 + k])?.[0];
      if (t === undefined) break;
      textures.push(t);
    }
    const tail = [0, 1, 2].map((k) => ints(lines[i + 10 + sides + k])?.[0]);
    if (textures.length < sides || tail.some((v) => v === undefined)) break;
    const [timer, unk48, open, type, textureList] = singles as number[];
    segments.push({
      index: n,
      centreA: [head[0], head[1]],
      centreB: [head[2], head[3]],
      sides,
      ringA: { startAngle: angA[0], endAngle: angA[1], radiusX: radA[0], radiusY: radA[1] },
      ringB: { startAngle: angB[0], endAngle: angB[1], radiusX: radB[0], radiusY: radB[1] },
      open,
      type,
      timer,
      textureList,
      sideTextures: textures,
      unknown: [angA[2] ?? 0, unk48, tail[0]!, tail[1]!, tail[2]!],
    });
    i += 13 + sides;
  }
  return { segments, complete: segments.length === count && i === lines.length };
}

/** A segment's two rings and faces, in 256-world-unit tunnel coordinates. */
export interface TunnelSegmentGeometry {
  /** `sides` vertices [x, y, z] at the segment start (z = index * TUNNEL_SEGMENT_LENGTH). */
  ringA: [number, number, number][];
  /** `sides` vertices at the segment end. */
  ringB: [number, number, number][];
  /** Face k joins ring vertices k and (k + 1) % sides on both rings, textured sideTextures[k]. */
  faces: { a: number; b: number; texture: number }[];
}

/**
 * The geometry TV's tunnel builder (0x33f00) makes from a segment.
 *
 * Each ring has `sides - open` vertices on its ellipse, vertex k at angle
 * `start + k * (end - start) / (sides - open)`, x = cos * radiusX, y = sin * radiusY, relative
 * to ring A's centre; ring B adds its own centre's offset. When the ring is open, the vertices
 * from `sides - open` onwards sit on the tube's centre line, so the faces that reach them close
 * the cut side towards the axis; on both rings that point is ring A's centre, as the builder
 * writes it. Coordinates are absolute (centre added) and z advances one segment length per index.
 */
export function tunnelSegmentGeometry(segment: TunnelSegment): TunnelSegmentGeometry {
  const ringCount = Math.max(1, segment.sides - Math.max(0, segment.open));
  const z0 = segment.index * TUNNEL_SEGMENT_LENGTH;
  const turn = (angle: number) => (angle / 65536) * 2 * Math.PI;
  const ring = (r: TunnelRing, centre: [number, number], z: number) => {
    // The builder steps by the truncated quotient, accumulated.
    const step = Math.trunc((r.endAngle - r.startAngle) / ringCount);
    const out: [number, number, number][] = [];
    for (let k = 0; k < segment.sides; k++) {
      if (k < ringCount) {
        const t = turn(r.startAngle + k * step);
        out.push([centre[0] + Math.cos(t) * r.radiusX, centre[1] + Math.sin(t) * r.radiusY, z]);
      } else {
        out.push([segment.centreA[0], segment.centreA[1], z]);
      }
    }
    return out;
  };
  const ringA = ring(segment.ringA, segment.centreA, z0);
  const ringB = ring(segment.ringB, segment.centreB, z0 + TUNNEL_SEGMENT_LENGTH);
  const faces = Array.from({ length: segment.sides }, (_, k) => ({
    a: k, b: (k + 1) % segment.sides, texture: segment.sideTextures[k] ?? 0,
  }));
  return { ringA, ringB, faces };
}
