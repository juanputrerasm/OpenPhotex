/*
  The BIN writer, checked by reading its output back with parseBin: synthetic models, and a
  rewrite of every stock model whose faces this writer can emit.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  BIN_MAPPED_FACETS, BIN_UNMAPPED_FACETS, MRGL, MRGLMAT, binFaceNormal, binPlaneTerm, parseBin, parsePod, readPodEntry, writeBin,
} from "../src/index.ts";
import type { BinModel, BinWriteGroup } from "../src/index.ts";

// A unit square in the file's (x, height, depth) word order, lying flat at height 0.
const square = [0, 0, 0, 256, 0, 0, 256, 0, 256, 0, 0, 256];

test("a written model reads back: vertices, textures, facets, materials", () => {
  const { bytes, degenerateFaces } = writeBin({
    vertices: square,
    groups: [
      { texture: "GRASS.RAW", opcode: MRGL.ZFACETTMAP, faces: [{ vertexIndices: [0, 1, 2], u: [0, 0xff0000, 0xff0000], v: [0, 0, 0xff0000] }] },
      {
        texture: "A_TEXTURE_NAME_OVER_15.RAW", opcode: MRGL.MATFACET,
        material: { flags: MRGLMAT.LIT | MRGLMAT.ALPHATEST, specPower: 16, tint: [1, 0.5, 0.25], alphaRef: 128 },
        material2: { flags2: 1, normalStrength: 0.5 },
        faces: [{ vertexIndices: [0, 2, 3], u: [1.4, 2, 3], v: [4, 5, 6] }],
      },
      { texture: "A_TEXTURE_NAME_OVER_15.RAW", opcode: MRGL.ZFACET, faces: [{ vertexIndices: [0, 1, 2, 3] }] },
    ],
  });
  assert.equal(degenerateFaces, 0);
  const model = parseBin(bytes);
  assert.equal(model.kind, "mrgl");
  assert.equal(model.incomplete, false);
  assert.equal(model.magnify, 65536);
  assert.deepEqual([...model.vertices], square);
  assert.equal(model.faces.length, 3);
  const [a, b, c] = model.faces;
  assert.equal(a.opcode, MRGL.ZFACETTMAP);
  assert.equal(a.textureName, "GRASS.RAW");
  assert.equal(a.textureOpcode, MRGL.TEXTURE);
  assert.deepEqual(a.u, [0, 0xff0000, 0xff0000]);
  assert.equal(b.textureOpcode, MRGL.TEXTURE64);
  assert.equal(b.textureName, "A_TEXTURE_NAME_OVER_15.RAW");
  assert.deepEqual(b.u, [1, 2, 3]);
  const material = model.materials[b.material ?? -1];
  assert.equal(material.flags, MRGLMAT.LIT | MRGLMAT.ALPHATEST);
  assert.equal(material.specPower, 16);
  assert.deepEqual(material.tint, [1, 0.5, 0.25]);
  assert.equal(material.baseAlpha, 1);
  assert.equal(material.alphaRef, 128);
  assert.equal(model.materials2[b.material2 ?? -1].normalStrength, 0.5);
  // One texture record serves both groups that share it.
  assert.equal(c.textureOpcode, MRGL.TEXTURE64);
  assert.equal(c.mapped, false);
  assert.deepEqual(c.vertexIndices, [0, 1, 2, 3]);
});

test("stored normals follow the stock convention and plane terms the first corner", () => {
  // Corners 0, 1, 2 as written: the plain cross of the words.
  assert.deepEqual(binFaceNormal(square, [0, 1, 2]), [0, -65536, 0]);
  assert.deepEqual(binFaceNormal(square, [0, 2, 1]), [0, 65536, 0]);
  assert.equal(binFaceNormal(square, [0, 0, 1]), null);
  const lifted = [0, 512, 0, 256, 512, 0, 256, 512, 256];
  assert.equal(binPlaneTerm([0, 65536, 0], lifted, 0), (65536 * 512) | 0);
  const face = parseBin(writeBin({ vertices: lifted, groups: [{ texture: "X", opcode: MRGL.ZFACET, faces: [{ vertexIndices: [0, 2, 1] }] }] }).bytes).faces[0];
  assert.deepEqual(face.storedNormal, [0, 65536, 0]);
  assert.equal(face.magic, (65536 * 512) | 0);
});

test("degenerate faces are dropped and counted; bad input throws", () => {
  const result = writeBin({ vertices: square, groups: [{ texture: "X", opcode: MRGL.ZFACET, faces: [{ vertexIndices: [0, 0, 1] }, { vertexIndices: [0, 1, 2] }] }] });
  assert.equal(result.degenerateFaces, 1);
  assert.equal(parseBin(result.bytes).faces.length, 1);
  const one = (group: Partial<BinWriteGroup>) => () => writeBin({ vertices: square, groups: [{ texture: "X", opcode: MRGL.ZFACET, faces: [], ...group }] });
  assert.throws(one({ opcode: MRGL.TEXTURE }), RangeError);
  assert.throws(one({ faces: [{ vertexIndices: [0, 1] }] }), RangeError);
  assert.throws(one({ faces: [{ vertexIndices: [0, 1, 4] }] }), RangeError);
});

/** A parsed model as writer groups: one per run of faces drawn the same way. */
function asGroups(model: BinModel): BinWriteGroup[] {
  const groups: BinWriteGroup[] = [];
  let key = "";
  for (const face of model.faces) {
    const next = `${face.textureName}|${face.opcode}|${face.material}|${face.material2}`;
    if (next !== key) {
      const material = face.material === null ? null : model.materials[face.material];
      const material2 = face.material2 === null ? null : model.materials2[face.material2];
      groups.push({ texture: face.textureName, opcode: face.opcode, material, material2, faces: [] });
      key = next;
    }
    groups[groups.length - 1].faces.push({ vertexIndices: face.vertexIndices, u: face.u, v: face.v });
  }
  return groups;
}

const GAMES = process.env.OPENPHOTEX_GAMES ?? join(process.env.HOME ?? "", "games");

/*
  Every stock model that walks cleanly is rewritten from what parseBin read and read again. The
  geometry, every face that has area, its texture, facet and material flags come back as they
  went in.
*/
test("every stock .BIN survives a rewrite", { skip: existsSync(GAMES) ? false : `no ${GAMES}` }, () => {
  let models = 0;
  let faces = 0;
  for (const game of ["mtm1", "mtm2", "cpr", "tv", "tf", "hb"]) {
    const folder = join(GAMES, game);
    if (!existsSync(folder)) continue;
    for (const name of readdirSync(folder).filter((n) => /\.pod$/i.test(n))) {
      const bytes = new Uint8Array(readFileSync(join(folder, name)));
      const pod = parsePod(bytes);
      for (const entry of pod.entries.filter((e) => e.title.endsWith(".BIN"))) {
        const original = parseBin(readPodEntry(bytes, entry));
        if (original.kind !== "mrgl" || original.incomplete || !original.faces.length) continue;
        if (!original.faces.every((f) => BIN_MAPPED_FACETS.has(f.opcode) || BIN_UNMAPPED_FACETS.has(f.opcode))) continue;
        const where = `${game}/${name}:${entry.name}`;
        const written = writeBin({ magnify: original.magnify ?? 65536, vertices: original.vertices, groups: asGroups(original) });
        const copy = parseBin(written.bytes);
        assert.equal(copy.incomplete, false, where);
        assert.deepEqual(copy.vertices, original.vertices, where);
        const kept = original.faces.filter((f) => binFaceNormal(original.vertices, f.vertexIndices));
        assert.equal(copy.faces.length, kept.length, where);
        assert.equal(written.degenerateFaces, original.faces.length - kept.length, where);
        kept.forEach((face, i) => {
          const back = copy.faces[i];
          assert.deepEqual([back.opcode, back.textureName, back.vertexIndices, back.u, back.v], [face.opcode, face.textureName, face.vertexIndices, face.u, face.v], where);
          const flags = (m: BinModel, f: typeof face) => (f.material === null ? null : m.materials[f.material].flags);
          assert.equal(flags(copy, back), flags(original, face), where);
        });
        models++;
        faces += kept.length;
      }
    }
  }
  assert.ok(models > 0 && faces > 0);
});
