/*
  MTM2's saved game (src/mtm/saved-game.ts) and the live truck record it carries in its SIT (MONSTER.EXE 0x4c0360,
  0x553230, 0x41ae80, 0x41a557), each read back with OpenPhotex's own readers.
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  MTM2_SAVED_GAME_HEADER, parseMtm2SavedGame, parseMtmSit, replaceSitVehicles, writeMtm2SavedGame, writeMtm2Sit,
} from "../src/index.ts";
import type { Mtm2SitTruck } from "../src/index.ts";

const level = (): string => new TextDecoder("latin1").decode(writeMtm2Sit({
  lvlName: "TEST.LVL", trackName: "Test Track", localeName: "Here", pictureBmp: "UI\\TESTS.BMP", iconBmp: "UI\\TESTL.BMP",
  descriptionTxt: "TEST.TXT", yourTruck: { position: [0, 0, 0], orient: [0, 0, 0] },
  vehicles: [{ position: [1, 0, 1], orient: [0, 0, 0] }, { position: [2, 0, 2], orient: [0, 0, 0] }],
  boxes: [{ position: [10, 20, 30], orient: [0, 0, 0.5], modelName: "ROCK.BIN", type: 0 }],
  course: [{ start: [0, 0, 0], end: [100, 0, 0] }], extendedCourses: [],
}));

const racing = (x: number): Mtm2SitTruck => ({
  truckFile: "BIGFOOT.TRK", position: [x, 12.5, 300.25], orient: [0.1, -0.2, 1.5], courseToFollow: 2,
  state: {
    bvel: [1, 2, 60.5], rates: [0.01, 0.02, 0.3], gear: 5, autopilot: 1, cnumber: 7, damageCode: 0xc0000003,
    segments: 9, laps: 1, finished: 0, nextCheckpoint: 3, totalRaceTime: 101.25, fastestLap: 88.5,
    lapTimes: [88.5], checkpointTimes: [[20, 21, 22, 25.5]],
  },
});

test("a live truck record carries its motion, damage and race progress, as the game's writer prints it", () => {
  const text = replaceSitVehicles(level(), [racing(5), racing(6)], { raceTimes: [123.5, 3, 0] });
  assert.ok(text.includes("@damageCode\r\n3221225475\r\n"), "the damage code unsigned");
  const sit = parseMtmSit(text, "TEST.SIT");
  const grid = sit.trucks.filter((t) => !t.playerSlot);
  assert.equal(grid.length, 2);
  const s = grid[0].state!;
  assert.deepEqual(grid[0].positionFt, [5, 12.5, 300.25]);
  assert.deepEqual(s.bvel, [1, 2, 60.5]);
  assert.equal(s.gear, 5);
  assert.equal(s.autopilot, 1);
  assert.equal(s.cnumber, 7);
  assert.equal(s.damageCode, 0xc0000003);
  assert.equal(s.laps, 1);
  assert.equal(s.segments, 9);
  assert.equal(s.nextCheckpoint, 3);
  assert.equal(s.totalRaceTime, 101.25);
  assert.equal(s.fastestLap, 88.5);
  assert.equal(s.lapTimes.length, 20);
  assert.equal(s.lapTimes[0], 88.5);
  assert.deepEqual(s.checkpointTimes[0].slice(0, 4), [20, 21, 22, 25.5]);
  assert.ok(/\$racetime[^\n]*\r\n123\.500000,3\.000000,0\.000000\r\n/.test(text), "the race clock line");
  assert.deepEqual(sit.raceTimes, [123.5, 3, 0]);
  assert.equal(sit.boxes.length, 1, "the rest of the level kept");
  assert.equal(sit.primaryCourse?.segments.length, 1);
});

test("a level's own grid record reads as at rest, with no damage code line", () => {
  const sit = parseMtmSit(level(), "TEST.SIT");
  const s = sit.trucks[1].state!;
  assert.deepEqual(s.bvel, [0, 0, 0]);
  assert.equal(s.damageCode, null);
  assert.equal(s.laps, 0);
});

test("a saved game round-trips its head and its situation", () => {
  const sit = replaceSitVehicles(level(), [racing(5)], { raceTimes: [50, 3, 0] });
  const bytes = writeMtm2SavedGame({
    playerTruck: "BIGFOOT.TRK", raceIndex: 4, laps: 3, weather: 2, sit,
    trucks: [{ file: "BIGFOOT.TRK", tireCut: 1, suspension: 2, transfer: 1500 }, { file: "GRAVEDIG.TRK", tireCut: 0, suspension: 1, transfer: 600 }],
  });
  const text = new TextDecoder("latin1").decode(bytes);
  assert.ok(text.startsWith(`${MTM2_SAVED_GAME_HEADER}\r\nBIGFOOT.TRK\r\n4\r\n3\r\n2\r\nBIGFOOT.TRK\r\n1\r\n2\r\n1500\r\nGRAVEDIG.TRK\r\n0\r\n1\r\n600\r\n2\r\nTEST.LVL\r\n`));
  const game = parseMtm2SavedGame(bytes);
  assert.equal(game.playerTruck, "BIGFOOT.TRK");
  assert.equal(game.raceIndex, 4);
  assert.equal(game.laps, 3);
  assert.equal(game.weather, 2);
  assert.deepEqual(game.trucks[1], { file: "GRAVEDIG.TRK", tireCut: 0, suspension: 1, transfer: 600 });
  const back = parseMtmSit(game.sit, "TEST.SIT");
  assert.equal(back.lvlName, "TEST.LVL");
  assert.equal(back.trucks.filter((t) => !t.playerSlot)[0].state!.damageCode, 0xc0000003);
});

test("a file without the version line is refused, as the game refuses it", () => {
  assert.throws(() => parseMtm2SavedGame("MonsterTruckMadness 1.00\r\nX\r\n"), /Invalid saved game version string/);
});
