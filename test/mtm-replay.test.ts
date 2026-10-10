import test from "node:test";
import assert from "node:assert/strict";
import { parseMtmReplay, writeMtmReplay, REPLAY_FRAME_TICKS, type MtmReplay } from "../src/index.ts";

const replay: MtmReplay = {
  level: "tpark.sit", weather: 4, detailLevel: 2,
  vehicles: [{ truck: "DIGGER.TRK", driver: "You" }, { truck: "BIGFOOT.TRK", driver: "Mark" }],
  objects: [[1677.515625, 178.841797, 4028.761719, 0, 0, 7.88121], [10, 20, 30, 0, 0, 0]],
  records: [
    { type: 0, time: 16792, ipos: [1382.27, 174.59, 4048.19], bvel: [-0.006759, -1.951834, 0.072111], angles: [-0.0909, -0.000672, 1.585044], rates: [-0.006778, -0.665915, -0.000057], number: 0,
      steering: [0.1, -0.05], tires: [-1.047745, 1.746877, 2.729159, 2.26487], throttle: 0.5, brakeFront: 1, brakeRear: 1, course: 3, damageCode: 21, gear: 4 },
    { type: 1, time: 16792, ipos: [1487.0625, 192.496094, 3965.414062], bvel: [0, 0, -70], angles: [0, 0, 3.167191], rates: [0, 0, 0], number: 179 },
    { type: 0, time: 16792 + REPLAY_FRAME_TICKS, ipos: [1383, 174.6, 4050], bvel: [0, 0, 5], angles: [0, 0, 1.58], rates: [0, 0, 0], number: 1,
      steering: [0, 0], tires: [0, 0, 0, 0], throttle: 1, brakeFront: 0, brakeRear: 0, course: 1, damageCode: 0, gear: 5 },
  ],
};

test("a replay is written with CRLF lines in the game's header and record layout", () => {
  const text = writeMtmReplay(replay);
  assert.ok(text.startsWith("demoLevel\r\ntpark.sit\r\nweather\r\n4\r\nvehicleCount\r\n2\r\nDIGGER.TRK\r\nYou\r\nBIGFOOT.TRK\r\nMark\r\ndetailLevel\r\n2\r\ndemoRecordPtr\r\n3\r\ndemoRecordCount\r\n3\r\nOriginal object locations\r\n2\r\n"));
  assert.ok(text.includes("1677.515625,178.841797,4028.761719,0.000000,0.000000,7.881210\r\n10.000000,20.000000,30.000000,0.000000,0.000000,0.000000\r\ntype,time\r\n0,16792\r\nipos\r\n"));
  assert.ok(text.includes("eng_throttle,faxle_brake_pct,raxle_brake_pct,ap_cnumber\r\n0.500000,1.000000,1.000000,3\r\ndamageCode,gear\r\n21,4\r\n"));
  // An object record has no vehicle fields.
  const object = text.split("type,time\r\n")[2]!;
  assert.ok(object.startsWith("1,16792\r\n") && !object.includes("gear"));
});

test("what is written is read back, vehicles and objects alike", () => {
  const back = parseMtmReplay(writeMtmReplay(replay))!;
  assert.equal(back.level, "tpark.sit");
  assert.deepEqual([back.weather, back.detailLevel], [4, 2]);
  assert.deepEqual(back.vehicles, replay.vehicles);
  assert.equal(back.objects.length, 2);
  assert.equal(back.records.length, 3);
  const [a, b, c] = back.records;
  assert.equal(a!.type, 0);
  assert.equal(a!.damageCode, 21);
  assert.equal(a!.gear, 4);
  assert.deepEqual(a!.tires, [-1.047745, 1.746877, 2.729159, 2.26487]);
  assert.equal(b!.type, 1);
  assert.equal(b!.number, 179);
  assert.equal(b!.gear, undefined);
  assert.equal(c!.time, 16792 + REPLAY_FRAME_TICKS);
  assert.ok(Math.abs(a!.ipos[0] - 1382.27) < 1e-6);
});

test("a file that is not a replay is refused, and records of any length are read", () => {
  assert.equal(parseMtmReplay("TRI Message System\r\n256\r\n"), null);
  const odd = "demoLevel\ntpark.sit\nweather\n0\nvehicleCount\n0\ndetailLevel\n2\ndemoRecordPtr\n1\ndemoRecordCount\n1\nOriginal object locations\n0\ntype,time\n1,5\nipos\n1,2,3\nnumber\n7\n";
  const r = parseMtmReplay(odd)!;
  assert.deepEqual([r.records.length, r.records[0]!.number, r.records[0]!.ipos], [1, 7, [1, 2, 3]]);
});
