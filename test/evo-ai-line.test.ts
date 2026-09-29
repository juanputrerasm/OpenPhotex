/*
  4x4 Evolution AI lines: reading the recorded laps, and using them to find which .SIT course
  runs a lap uses.

  Ported from JSTrackViewer's tests/evo-ai-lines.test.mjs, with Evo terrain sampling added.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { EVO_HEIGHT_DIVISOR, EVO_WORLD_SIZE, evoHeightAt, evoHeightAtCell, lapRuns, matchEvoAiLineName, parseEvoAiLine } from "../src/index.ts";

const encode = (text: string) => new TextEncoder().encode(text);

test("an AI line file reads as its driver, lap time and positions", () => {
  const line = parseEvoAiLine(encode([
    "File Version:     12", "Driver Name:      Antigoon", "Lap Time:         01m48s07ms",
    "Class:            Class_3", "Checkpoint Count: 9", "Point Count:      2",
    "3197.96, 167.77, 4351.55", "139.59", "8",
    "3194.17, 167.77, 4363.26", "137.53", "8",
  ].join("\r\n")));
  assert.equal(line.driver, "Antigoon");
  assert.equal(line.lapTime, "01m48s07ms");
  // Speed and checkpoint lines are single numbers and are not taken for positions.
  assert.deepEqual(line.points, [[3197.96, 167.77, 4351.55], [3194.17, 167.77, 4363.26]]);
});

test("AI line files are found by class, line and track", () => {
  assert.deepEqual(matchEvoAiLineName("AI\\CLASS2\\AI_23TERRAMAR.TXT", "TERRAMAR"), { truckClass: 2, line: 3 });
  assert.deepEqual(matchEvoAiLineName("ai/class1/ai_11terramar.txt", "TERRAMAR"), { truckClass: 1, line: 1 });
  assert.equal(matchEvoAiLineName("AI\\CLASS1\\AI_11OTHER.TXT", "TERRAMAR"), null);
  assert.equal(matchEvoAiLineName("DATA\\TERRAMAR.TXT", "TERRAMAR"), null);
});

/*
  A square lap of four runs, with the recorded line driving it, and two stray runs listed
  after it on a road 200 units off to the side, the way TERRAMAR's course ends.
*/
const run = (x0: number, z0: number, x1: number, z1: number) => ({ start: [x0, 0, z0], end: [x1, 0, z1] });
const square = [run(0, 0, 0, 1000), run(0, 1000, 1000, 1000), run(1000, 1000, 1000, 0), run(1000, 0, 0, 0)];
const recorded: { points: number[][] } = { points: [] };
for (let t = 0; t <= 1000; t += 10) recorded.points.push([0, 0, t], [t, 0, 1000], [1000, 0, 1000 - t], [1000 - t, 0, 0]);

test("runs listed after the lap that no driver goes near are not part of it", () => {
  const strays = [run(-200, 100, -200, 900), run(-150, 900, -150, 100)];
  assert.deepEqual(lapRuns([...square, ...strays], [recorded]), square);
});

test("a lap is kept whole, and nothing is dropped without recorded lines", () => {
  assert.deepEqual(lapRuns(square, [recorded]), square);
  const strays = [run(-200, 100, -200, 900)];
  assert.deepEqual(lapRuns([...square, ...strays], []), [...square, ...strays]);
});

test("an off-line run in the middle of the lap stays: only trailing runs are judged", () => {
  const detour = run(-300, 400, -300, 600);
  const runs = [square[0], detour, ...square.slice(1)];
  assert.deepEqual(lapRuns(runs, [recorded]), runs);
});

test("Evo terrain is 256 square, 32 units a cell, heights uint16 / 32, indexed x + z * 256", () => {
  assert.equal(EVO_WORLD_SIZE, 8192);
  const raw = new Uint8Array(256 * 256 * 2);
  const put = (x: number, z: number, value: number) => { raw[(x + z * 256) * 2] = value & 0xff; raw[(x + z * 256) * 2 + 1] = value >> 8; };
  put(1, 0, 64 * EVO_HEIGHT_DIVISOR);
  put(0, 1, 32 * EVO_HEIGHT_DIVISOR);
  assert.equal(evoHeightAtCell(raw, 1, 0), 64);
  assert.equal(evoHeightAtCell(raw, -5, 1), 32);
  assert.equal(evoHeightAt(raw, 16, 0), 32);
  assert.equal(evoHeightAt(raw, 0, 16), 16);
  assert.equal(evoHeightAtCell(null, 0, 0), 0);
});
