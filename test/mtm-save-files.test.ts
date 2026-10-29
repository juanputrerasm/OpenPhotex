import test from "node:test";
import assert from "node:assert/strict";
import {
  parseMtmPlayerPro, writeMtmPlayerPro, newMtmDriver, PLAYER_PRO_VERSION,
  parseMtmHighScores, writeMtmHighScores, decipherHighScores, encipherHighScores, type MtmHighScoreTrack,
} from "../src/index.ts";

test("player.pro: version 103 is written in the game's order and read back", () => {
  const driver = { ...newMtmDriver("Juan", "DIGGER.TRK", "Farm Road 29"), settings: [2, 0, 1500, 1] as [number, number, number, number], pairs: [{ text: "x", value: 3 }] };
  const text = writeMtmPlayerPro({ selected: 1, drivers: [driver, newMtmDriver("Ana")] });
  const lines = text.split("\r\n");
  assert.deepEqual(lines.slice(0, 5), [String(PLAYER_PRO_VERSION), "2", "1", "Juan", "0"]);
  // The flag, seven text lines, the pairs, three numbers, the truck and track, and the four settings.
  assert.deepEqual(lines.slice(5, 22), ["0", "", "", "", "", "", "", "", "1", "x", "3", "0", "0", "0", "DIGGER.TRK", "Farm Road 29", "2"]);
  const back = parseMtmPlayerPro(text)!;
  assert.equal(back.drivers.length, 2);
  assert.deepEqual(back.drivers[0], driver);
  assert.deepEqual(back.drivers[1]!.settings, [1, 1, 600, 1]);
});

test("player.pro: an older version stops early and keeps the defaults; a newer one is refused", () => {
  const v100 = ["100", "1", "1", "Old", "5", "6", "7", "BIGFOOT.TRK", "Tpark", "0", "2", "900", "1", ""].join("\r\n");
  const old = parseMtmPlayerPro(v100)!.drivers[0]!;
  assert.deepEqual([old.name, old.numbers, old.truck, old.track, old.settings], ["Old", [5, 6, 7], "BIGFOOT.TRK", "Tpark", [0, 2, 900, 1]]);
  assert.deepEqual(old.texts, ["", "", "", "", "", "", ""]);
  assert.equal(parseMtmPlayerPro("104\r\n0\r\n1\r\n"), null);
  assert.equal(parseMtmPlayerPro("hello"), null);
});

test("MTM2 High Scores: the cipher undoes itself, whatever the text's length", () => {
  for (const n of [0, 1, 7, 8, 9, 16, 23, 100]) {
    const plain = Uint8Array.from({ length: n }, (_, i) => 32 + ((i * 37) % 90));
    const sealed = encipherHighScores(plain);
    // The game's closing block: one past the text, always.
    assert.equal(sealed.length, (Math.floor(n / 8) + 1) * 8);
    assert.deepEqual(decipherHighScores(sealed).subarray(0, n), plain);
    if (n) assert.notDeepEqual(sealed.subarray(0, Math.min(8, n)), plain.subarray(0, Math.min(8, n)));
  }
});

test("MTM2 High Scores: tracks and entries are written and read back", () => {
  const hall: MtmHighScoreTrack[] = [
    { track: "Farm Road 29", entries: [
      { date: "10/28/26", driver: "Juan", truck: "Bigfoot", time: 83.27, points: 1050, skill: 1, summit: false },
      { date: "10/28/26", driver: "Mark", truck: "Grave Digger", time: 91.5, points: 700, skill: 1, summit: false },
    ] },
    { track: "Summit Rumble 1", entries: [{ date: "01/02/98", driver: "Ana", truck: "Snake Bite", time: 300, points: 42, skill: 2, summit: true }] },
  ];
  assert.deepEqual(parseMtmHighScores(writeMtmHighScores(hall)), hall);
  assert.deepEqual(parseMtmHighScores(writeMtmHighScores([])), []);
});
