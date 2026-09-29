/*
  .BIN (MRGL) models from synthetic record streams written word by word.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { BIN_GEOMETRY_DIVISOR, MRGL, MRGLMAT, parseBin } from "../src/index.ts";
import { latin1 } from "./fixtures/build.ts";

/** Little-endian int32 words, with strings written into fixed-width fields. */
class Words {
  private readonly parts: number[] = [];
  int(...values: number[]) { this.parts.push(...values); return this; }
  name(text: string, width: number) {
    const bytes = new Uint8Array(width);
    bytes.set(latin1(text).subarray(0, width));
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < width; i += 4) this.parts.push(view.getInt32(i, true));
    return this;
  }
  bytes() {
    const out = new Uint8Array(this.parts.length * 4);
    const view = new DataView(out.buffer);
    this.parts.forEach((value, i) => view.setInt32(i * 4, value, true));
    return out;
  }
}

const fixed = (value: number) => Math.round(value * 65536);

function model() {
  return new Words()
    .int(MRGL.MAGNIFY, 1024)
    .int(MRGL.VLIST, 0, 4, 0, 0, 0, 200, 0, 0, 200, 0, 200, 0, 0, 200) // (x, z, y) words, low bit dropped by the engine
    .int(MRGL.TEXTURE, 0).name("body.raw", 16)
    .int(MRGL.COLOR, 0x7f112233)
    .int(MRGL.MATERIAL, MRGLMAT.BLEND, fixed(0.5), 0, 0, fixed(1), fixed(32), 0, fixed(1), fixed(1), fixed(1), (7 << 16) | 128)
    .int(MRGL.MATERIAL2, 1, fixed(0.75), 0, 0, 0, 0, 0)
    .int(MRGL.MATFACET, 4, 0, 65536, 0, 0x29, 0, 0, 0, 1, 0xff0000, 0, 2, 0xff0000, 0xff0000, 3, 0, 0xff0000)
    .int(MRGL.OPACITY, 5) // no bespoke handling: stepped over by its engine stride
    .int(MRGL.TEXTURE64, 0).name("a-very-long-texture-name-beyond-thirty-one.png", 64)
    .int(MRGL.FACET, 3, 0, 0, 0, 0, 2, 3, 4) // one-based: 4 is out of range as zero-based
    .int(MRGL.ZFACET, 3, 0, 0, 0, 0, 0, 1, 9) // index out of range: dropped
    .int(MRGL.MAGNIFY, 2048)
    .int(MRGL.EOL);
}

test("the header, raw vertex words and the state each face was read under", () => {
  const bin = parseBin(model().bytes());
  assert.equal(bin.kind, "mrgl");
  assert.equal(bin.magnify, 1024);
  assert.deepEqual(bin.magnifyRecords, [2048]);
  assert.equal(bin.vertexListValid, true);
  assert.deepEqual([...bin.vertices.subarray(3, 6)], [200, 0, 0]);
  assert.equal(bin.incomplete, false);
  assert.equal(bin.faces.length, 2);

  const [quad, tri] = bin.faces;
  assert.equal(quad.opcode, MRGL.MATFACET);
  assert.equal(quad.mapped, true);
  assert.equal(quad.textureName, "body.raw");
  assert.equal(quad.textureOpcode, MRGL.TEXTURE);
  assert.equal(quad.solidColor, 0x112233);
  assert.deepEqual(quad.storedNormal, [0, 65536, 0]);
  assert.equal(quad.magic, 0x29);
  assert.deepEqual(quad.vertexIndices, [0, 1, 2, 3]);
  assert.deepEqual(quad.u, [0, 0xff0000, 0xff0000, 0]);
  assert.equal(quad.material, 0);
  assert.equal(quad.material2, 0);

  assert.equal(tri.mapped, false);
  assert.equal(tri.oneBased, true);
  assert.deepEqual(tri.vertexIndices, [1, 2, 3]);
  assert.deepEqual(tri.u, [0, 0, 0]);
  assert.equal(tri.material, null);
  assert.equal(tri.textureName, "a-very-long-texture-name-beyond-thirty-one.png");
  assert.equal(tri.textureOpcode, MRGL.TEXTURE64);
});

test("materials: 16.16 fields decoded, flags and the foliage word split", () => {
  const bin = parseBin(model().bytes());
  const [material] = bin.materials;
  assert.equal(material.id, 1);
  assert.equal(material.flags, MRGLMAT.BLEND);
  assert.equal(material.reflectivity, 0.5);
  assert.equal(material.specPower, 32);
  assert.deepEqual(material.tint, [1, 1, 1]);
  assert.equal(material.alphaRef, 128);
  assert.equal(material.translucency, 7);
  assert.deepEqual(bin.materials2[0], { flags2: 1, normalStrength: 0.75, reserved: [0, 0, 0, 0, 0] });
});

test("an opcode with no known stride stops the walk and says why", () => {
  const bytes = new Words().int(MRGL.MAGNIFY, 1024, MRGL.VLIST, 0, 1, 0, 0, 0, 999, 1, 2, 3).bytes();
  const bin = parseBin(bytes);
  assert.equal(bin.incomplete, true);
  assert.equal(bin.stopReason, "unknown record type 999");
});

test("a truncated record stops the walk", () => {
  const bytes = new Words().int(MRGL.MAGNIFY, 1024, MRGL.VLIST, 0, 1, 0, 0, 0, MRGL.MATERIAL, 1, 2).bytes();
  const bin = parseBin(bytes);
  assert.equal(bin.incomplete, true);
  assert.deepEqual(bin.warnings, ["Truncated MRGL_MATERIAL record"]);
});

test("an out-of-range vertex count reads no faces", () => {
  const bin = parseBin(new Words().int(MRGL.MAGNIFY, 1024, MRGL.VLIST, 0, -5).bytes());
  assert.equal(bin.vertexListValid, false);
  assert.equal(bin.faces.length, 0);
});

test("ANIMATED_BIN: the frame names, and nothing else", () => {
  const bytes = new Words().int(0x20, 0, 2, 32768, 0, 0).name("CAB1.BIN", 16).name("CAB2.BIN", 16).bytes();
  const bin = parseBin(bytes);
  assert.equal(bin.kind, "animated");
  assert.equal(bin.magnify, 32768);
  assert.deepEqual(bin.frameNames, ["CAB1.BIN", "CAB2.BIN"]);
  assert.equal(bin.faces.length, 0);
});

test("LWO and unknown signatures are identified, not decoded", () => {
  assert.equal(parseBin(new Words().int(0x4d524f46, 0).bytes()).kind, "lwo");
  const unknown = parseBin(new Words().int(0x12345678).bytes());
  assert.equal(unknown.kind, "unknown");
  assert.equal(unknown.signature, 0x12345678);
  assert.equal(parseBin(new Uint8Array(2)).signature, null);
});

test("geometry divisors", () => {
  assert.deepEqual(BIN_GEOMETRY_DIVISOR, { legacy: 64, hellbender: 4096, terminalVelocity: 8192 });
});
