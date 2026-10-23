/*
  A CPR track's centreline from its cross sections (cprCentreline).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { cprCentreline } from "../src/index.ts";

const section = (z: number, offs: number[], types: number[]) => ({
  points: offs.map((o) => [o, 10, z]), pointOffsets: offs, segmentTypes: types,
}) as never;

test("the centreline is each section's place at offset 0, with the road's reach either side of it", () => {
  // Laguna's shape: curb, road, road, curb either side, the middle slots of no width.
  const offs = [-51, -51, -51, -41, -20, -20, -10, 0, 0, 0, 0, 0, 0, 10, 20, 20, 35, 45, 45, 40];
  const types = [0, 0, 0, 0, 1, 2, 2, 1, 0, 0, 0, 1, 2, 2, 1, 0, 0, 0, 0];
  const line = cprCentreline([section(0, offs, types), section(30, offs.map((o) => o + 5), types)]);
  assert.equal(line.length, 2);
  assert.deepEqual(line[0]!.pos, [0, 10, 0]);
  assert.equal(line[0]!.left, 20);
  assert.equal(line[0]!.right, 20);
  // Offsets shifted by 5: offset 0 now lies 5 ft left of the points' x (they were moved with it).
  assert.deepEqual(line[1]!.pos, [0, 10, 30]);
  assert.deepEqual(cprCentreline([{ points: [], pointOffsets: [], segmentTypes: [] } as never]), []);
});
