/*
  Track ambience keys in the .TXV (track format version 6, "Ambience"): a track's own sky, haze
  and light tint. Synthetic fixtures only.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readTxvAmbience, TXV_AMBIENCE_KEYS, readTxvInfo } from "../src/index.ts";

const RED_ROCK = "# MTM2 track version record\r\nformatVersion=2\r\nskyTopColor=71,13,14\r\nskyBottomColor=129,38,15\r\nskyHorizon=0.24\r\nskyImage=ART\\MHRRSKY.PNG\r\nfogColor=130,39,16\r\nfogStartFt=157\r\nfogEndFt=785\r\nlightTint=0.89,1.19,1.34\r\n";

test("the ambience keys read as written: colours, horizon, picture, haze", () => {
  const a = readTxvAmbience(RED_ROCK)!;
  assert.deepEqual(a.skyTop, [71, 13, 14]);
  assert.deepEqual(a.skyBottom, [129, 38, 15]);
  assert.equal(a.skyHorizon, 0.24);
  assert.equal(a.skyImage, "ART\\MHRRSKY.PNG");
  assert.deepEqual(a.fogColor, [130, 39, 16]);
  assert.equal(a.fogStartFt, 157);
  assert.equal(a.fogEndFt, 785);
  assert.equal(a.sky, true);
});

test("the light tint keeps its hue and is scaled to a mean of 1", () => {
  const t = readTxvAmbience(RED_ROCK)!.lightTint!;
  assert.ok(Math.abs((t[0] + t[1] + t[2]) / 3 - 1) < 1e-9);
  assert.ok(Math.abs(t[2] / t[0] - 1.34 / 0.89) < 1e-9);
});

test("no ambience keys: null; bad values are dropped, colours clamped, the horizon defaulted", () => {
  assert.equal(readTxvAmbience("formatVersion=1\r\n"), null);
  assert.equal(readTxvAmbience(null), null);
  const a = readTxvAmbience("skyTopColor=300,-5,10\r\nskyHorizon=x\r\nfogColor=1,2\r\nlightTint=0,0,0\r\n")!;
  assert.deepEqual(a.skyTop, [255, 0, 10]);
  assert.equal(a.skyHorizon, 0.25);
  assert.equal(a.fogColor, null);
  assert.equal(a.lightTint, null);
});

test("ambience keys sit beside the record's other keys", () => {
  assert.equal(TXV_AMBIENCE_KEYS.length, 8);
  assert.equal(readTxvInfo(RED_ROCK).formatVersion, 2);
});
