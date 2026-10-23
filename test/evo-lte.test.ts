import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EVO_LITE_GRID, EVO_LITE_TERRAIN_BYTES, decodeEvoLzw, isEvoLite, parseEvoLte, parseEvoSit } from "../src/index.ts";

/**
 * The game's LZW coder written out on its own, for fixtures: codes of the dictionary's count `n` as the reader takes
 * them (a bit where `n - 1` has a 0 left out until a stored 0 meets a 1 of `n - 1`), bits least significant first.
 */
function encodeLzw(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  let acc = 0, filled = 0;
  const put = (b: number) => { acc |= b << filled; filled++; if (filled === 8) { out.push(acc); acc = 0; filled = 0; } };
  const emit = (code: number, n: number) => {
    const top = n - 1;
    const width = top.toString(2).length;
    let free = false;
    for (let b = width - 1; b >= 0; b--) {
      const m = (top >> b) & 1, c = (code >> b) & 1;
      if (!free && m === 0) continue;
      put(c);
      if (!free && m === 1 && c === 0) free = true;
    }
  };
  const dict = new Map<string, number>();
  for (let i = 0; i < 256; i++) dict.set(String.fromCharCode(i), i);
  let next = 256, emitted = 0, w = "";
  const send = (code: number) => { emit(code, 256 + Math.max(0, emitted - 1)); emitted++; };
  for (const byte of input) {
    const c = String.fromCharCode(byte);
    // The newest entry is never sent: the reader's count is one short of it then, and its codes cannot name it.
    const known = dict.get(w + c);
    if (known !== undefined && (known < 256 || known !== next - 1)) { w += c; continue; }
    send(dict.get(w)!);
    if (!dict.has(w + c)) dict.set(w + c, next);
    next++;
    w = c;
  }
  if (w) send(dict.get(w)!);
  if (filled) out.push(acc);
  return Uint8Array.from(out);
}

const SIT = "version\n6\nbase.lvl\na\nUnknown\nd\nNew lite track\n";

function liteBytes(hMin: number, hMax: number) {
  const cells = EVO_LITE_GRID * EVO_LITE_GRID;
  const terrain = new Uint8Array(EVO_LITE_TERRAIN_BYTES);
  const view = new DataView(terrain.buffer);
  view.setInt32(0, hMin, true);
  view.setInt32(4, hMax, true);
  // Mostly flat, so the fixture stays inside one dictionary (this encoder does not empty it at 0x8000 entries).
  for (let i = 0; i < 256; i++) terrain[8 + i] = i;
  for (let i = 0; i < 16; i++) terrain[8 + cells + i] = i * 7;
  terrain[8 + 2 * cells] = 0x11;
  const text = new TextEncoder().encode(`LTE 1\nBASE\n${SIT}`);
  const plain = new Uint8Array(text.length + terrain.length);
  plain.set(text);
  plain.set(terrain, text.length);
  return { plain, packed: encodeLzw(plain) };
}

test("the LZW stream decodes as the game's coder wrote it", () => {
  const { plain, packed } = liteBytes(32000, 40000);
  assert.ok(packed.length < plain.length / 4, "the terrain compresses");
  assert.deepEqual(decodeEvoLzw(packed), plain);
});

test("a Lite track gives its base world, its .SIT and the terrain as .RAW and .CLR grids", () => {
  const { packed } = liteBytes(32000, 40000);
  assert.ok(isEvoLite(packed));
  const lite = parseEvoLte(packed, "TEST.LTE");
  assert.equal(lite.version, 1);
  assert.equal(lite.baseWorld, "BASE");
  assert.equal(new TextDecoder().decode(lite.sitBytes), SIT);
  assert.equal(parseEvoSit(lite.sitBytes, "TEST.LTE").lvlName?.toLowerCase(), "base.lvl");
  assert.equal(lite.hMin, 32000);
  assert.equal(lite.heights[0], 32000);
  assert.equal(lite.heights[255], 40000);
  assert.equal(lite.heights[100], 32000 + Math.trunc((100 * 8000) / 255));
  assert.equal(lite.tiles[0], 0x100, "the high byte's top bits are dropped (& 0xFFF)");
  assert.equal(lite.tiles[1], 7);
  assert.equal(lite.tiles[3], 21);
  assert.equal(lite.tiles[300], 0);
});

test("an even field rises from one under its height", () => {
  const lite = parseEvoLte(liteBytes(500, 500).packed);
  assert.equal(lite.heights[0], 499);
  assert.equal(lite.heights[255], 500);
});

test("MTM2's light grid of the same extension is not a Lite track", () => {
  assert.equal(isEvoLite(new Uint8Array(4096).fill(7)), false);
  assert.throws(() => parseEvoLte(encodeLzw(new TextEncoder().encode("not a lite track"))));
});

const EVO1 = join(process.env.OPENPHOTEX_GAMES ?? join(process.env.HOME ?? "", "games"), "evo1");
for (const [file, base, size] of [["Caverav.lte", "ZONA", 249176], ["WORKAHEAD.LTE", "CON2", 349288]] as const) {
  test(`stock Lite track ${file} decodes in full`, { skip: !existsSync(join(EVO1, file)) }, () => {
    const bytes = new Uint8Array(readFileSync(join(EVO1, file)));
    assert.equal(decodeEvoLzw(bytes).length, size);
    const lite = parseEvoLte(bytes, file);
    assert.equal(lite.baseWorld, base);
    assert.equal(parseEvoSit(lite.sitBytes, file).version, 6);
  });
}
