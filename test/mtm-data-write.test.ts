/*
  The level side-file encoders and writers, each checked against the bytes the format lays down
  and read back with OpenPhotex's own readers.
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeClrGrid, decodeClrWord, decodeGroundBoxes, encodeClrGrid, encodeClrWord, encodeGroundBoxes,
  parseAnimations, parseKlp, parseTty, parseTxv, txvValue, writeAnimations, writeKlp, writeTty, writeTxv,
} from "../src/index.ts";
import { latin1 } from "./fixtures/build.ts";

const text = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

test("encodeClrWord is decodeClrWord's inverse, and a face with no texture is word 0", () => {
  assert.equal(encodeClrWord(0x123, 1, 3), 0xd123);
  const { texture, mirror, rotation } = decodeClrWord(0xd123);
  assert.equal(encodeClrWord(texture, mirror, rotation), 0xd123);
  assert.equal(encodeClrWord(-1), 0);
});

test("a .CLR grid is one little-endian word per cell", () => {
  const bytes = Uint8Array.from([0x23, 0xd1, 0x05, 0x00, 0xff, 0x0f, 0x00, 0x40]);
  const words = decodeClrGrid(bytes, 2)!;
  assert.deepEqual([...words], [0xd123, 0x0005, 0x0fff, 0x4000]);
  assert.deepEqual(encodeClrGrid(words), bytes);
  assert.equal(decodeClrGrid(bytes.subarray(0, 7), 2), null);
});

test("encodeGroundBoxes writes the grids decodeGroundBoxes reads", () => {
  const ra0 = Uint8Array.from([0, 10, 0, 0]);
  const ra1 = Uint8Array.from([0, 20, 0, 5]);
  const cl0 = new Uint8Array(48);
  // Cell 1's six faces: textures 1..6, the top mirrored and turned once.
  for (let face = 0; face < 6; face++) { cl0[12 + face * 2] = face + 1; }
  cl0[12 + 4 * 2 + 1] = 0x50;
  const boxes = decodeGroundBoxes(ra0, ra1, cl0, 2, -256);
  const encoded = encodeGroundBoxes(boxes, 2, -256);
  assert.deepEqual(encoded.ra0, ra0);
  assert.deepEqual(encoded.ra1, ra1);
  assert.deepEqual(encoded.cl0, cl0);
  assert.throws(() => encodeGroundBoxes([{ ...boxes[0], upper: 300 }], 2), RangeError);
  assert.throws(() => encodeGroundBoxes([{ ...boxes[0], x: 2 }], 2), RangeError);
});

test("writeTty writes the count and name,value lines parseTty reads", () => {
  const bytes = writeTty([{ name: "GOLFGRAS.RAW", value: 608 }, { name: "TRAC2.RAW", value: 101 }]);
  assert.equal(text(bytes), "2\r\nGOLFGRAS.RAW,608\r\nTRAC2.RAW,101\r\n");
  assert.deepEqual(parseTty(bytes).map((e) => [e.name, e.type, e.depth]), [["GOLFGRAS.RAW", 6, 8], ["TRAC2.RAW", 1, 1]]);
  assert.equal(text(writeTty([])), "0\r\n");
});

test("writeKlp is parseKlp's inverse", () => {
  assert.equal(text(writeKlp({ type: 1, loops: [{ start: 0, end: null }] })), "1 0 0\r\n");
  for (const source of ["0", "1 0 0", "2 100 5000", "3 2 900 10 4000 1000", "6 1 0 50"]) {
    const klp = parseKlp(source)!;
    assert.deepEqual(parseKlp(writeKlp(klp)), klp, source);
  }
});

test("writeAnimations lays out the .ANI parseAnimations reads, as MTM2 levels ship it", () => {
  const stock = "1\r\nDWATA1.RAW\r\n4,9830\r\nDWATA1.RAW\r\nDWATA2.RAW\r\nDWATA3.RAW\r\nDWATA4.RAW\r\n";
  const animations = parseAnimations(latin1(stock));
  assert.equal(text(writeAnimations(animations)), stock);
  assert.equal(text(writeAnimations([])), "0\r\n");
});

test("a .TXV keeps its comments and every key, known or not, in order", () => {
  const record = "# MTM2 track version record - written by Traxx\r\nformatVersion=1\r\ntool=Traxx\r\ntoolVersion=1.6.5\r\nfutureKey=7\r\n";
  const lines = parseTxv(latin1(`${record}\r\n\x1a`));
  assert.equal(txvValue(lines, "TOOLVERSION"), "1.6.5");
  assert.equal(txvValue(lines, "missing"), null);
  assert.equal(text(writeTxv(lines)), record);
});
